import { db } from "./db.js";

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

// Cricket overs format parser: decimal digit is balls (0-5), not base-10 fraction.
export function oversToBalls(oversInput) {
  const raw = String(oversInput).trim();
  if (!raw) throw new Error("Overs value is required.");

  if (raw.includes(".")) {
    const [overPart, ballPart] = raw.split(".", 2);
    if (!/^\d+$/.test(overPart) || !/^\d+$/.test(ballPart)) {
      throw new Error(`Invalid overs value: ${oversInput}`);
    }

    const balls = Number(ballPart);
    if (balls < 0 || balls > 5) {
      throw new Error("Invalid overs format. Ball part must be between 0 and 5.");
    }

    return Number(overPart) * 6 + balls;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid overs value: ${oversInput}`);
  }

  return Number(raw) * 6;
}

export function oversToFloat(oversInput) {
  const balls = oversToBalls(oversInput);
  return balls / 6;
}

export function ballsToOvers(balls) {
  const value = Number(balls);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Balls cannot be negative.");
  }
  return `${Math.floor(value / 6)}.${value % 6}`;
}

export function calculateNrr(runsFor, ballsFaced, runsAgainst, ballsBowled) {
  if (ballsFaced <= 0 || ballsBowled <= 0) return 0;
  const oversFaced = ballsFaced / 6;
  const oversBowled = ballsBowled / 6;
  return (runsFor / oversFaced) - (runsAgainst / oversBowled);
}

function getSettingInt(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return fallback;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getSettings() {
  return {
    qualifyingSpots: Math.max(1, getSettingInt("qualifying_spots", 2)),
    oversPerInnings: Math.max(1, getSettingInt("overs_per_innings", 20)),
    matchesPerTeam: Math.max(1, getSettingInt("matches_per_team", 2))
  };
}

export function updateSettings({ qualifyingSpots, oversPerInnings, matchesPerTeam }) {
  const upsert = db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  if (qualifyingSpots !== undefined) {
    if (qualifyingSpots < 1) throw new Error("Qualifying spots must be at least 1.");
    upsert.run("qualifying_spots", String(qualifyingSpots));
  }
  if (oversPerInnings !== undefined) {
    if (oversPerInnings < 1) throw new Error("Overs per innings must be at least 1.");
    upsert.run("overs_per_innings", String(oversPerInnings));
  }
  if (matchesPerTeam !== undefined) {
    if (matchesPerTeam < 1) throw new Error("Matches per team must be at least 1.");
    upsert.run("matches_per_team", String(matchesPerTeam));
  }
}

export function listTeams() {
  return db.prepare("SELECT name FROM teams ORDER BY name COLLATE NOCASE").all().map((r) => r.name);
}

export function ensureTeam(teamName) {
  const name = String(teamName).trim();
  if (!name) throw new Error("Team name cannot be empty.");
  db.prepare("INSERT OR IGNORE INTO teams(name) VALUES(?)").run(name);
}

export function deleteTeam(teamName) {
  const name = String(teamName).trim();
  if (!name) throw new Error("Team name cannot be empty.");

  const team = db.prepare("SELECT id FROM teams WHERE name = ?").get(name);
  if (!team) throw new Error(`Team '${name}' does not exist.`);

  const countRow = db
    .prepare("SELECT COUNT(*) AS count FROM matches WHERE team1_id = ? OR team2_id = ?")
    .get(team.id, team.id);
  db.prepare("DELETE FROM matches WHERE team1_id = ? OR team2_id = ?").run(team.id, team.id);
  db.prepare("DELETE FROM teams WHERE id = ?").run(team.id);

  return countRow.count;
}

function getTeamIds(team1, team2) {
  const team1Id = db.prepare("SELECT id FROM teams WHERE name = ?").get(team1)?.id;
  const team2Id = db.prepare("SELECT id FROM teams WHERE name = ?").get(team2)?.id;
  if (!team1Id || !team2Id) throw new Error("Could not resolve team IDs.");
  return { team1Id, team2Id };
}

function getTypicalInningsRuns(oversPerInnings) {
  const row = db.prepare(
    "SELECT AVG(team1_runs) AS avg_first_innings, COUNT(*) AS c FROM matches WHERE result_type = 'completed'"
  ).get();

  if (row && Number(row.c) > 0 && row.avg_first_innings) {
    return Math.max(1, Math.round(Number(row.avg_first_innings)));
  }

  if (oversPerInnings === 10) {
    return 90;
  }

  // Fallback for non-10 over formats if no historical data exists.
  return Math.max(30, Math.round(oversPerInnings * 9));
}

export function evaluateFeasibility(runMargin, chaseOvers, totalOvers, avgScore) {
  const hasRunMargin = Number.isFinite(runMargin) && runMargin > 0;
  const hasChaseOvers = Number.isFinite(chaseOvers) && chaseOvers > 0;

  const runUnrealistic = hasRunMargin && runMargin > (0.8 * avgScore);
  const chaseHighlyAggressive = hasChaseOvers && chaseOvers < (0.5 * totalOvers);

  let status = "Realistic";
  if (runUnrealistic && chaseHighlyAggressive) {
    status = "Practically Impossible";
  } else if (runUnrealistic) {
    status = "Unrealistic";
  } else if (chaseHighlyAggressive) {
    status = "Highly Aggressive";
  }

  let confidence = "High";
  if (status === "Highly Aggressive") confidence = "Medium";
  if (status === "Unrealistic" || status === "Practically Impossible") confidence = "Low";

  let warning = "";
  if (status === "Unrealistic") {
    warning = "This qualification scenario is mathematically valid but highly unlikely in real match conditions.";
  }
  if (status === "Practically Impossible") {
    warning = "This scenario is practically impossible under standard match constraints.";
  }

  return {
    status,
    confidence,
    warning,
    thresholds: {
      runMarginUnrealisticAbove: Number((0.8 * avgScore).toFixed(2)),
      chaseOversHighlyAggressiveBelow: Number((0.5 * totalOvers).toFixed(2))
    },
    checks: {
      runUnrealistic,
      chaseHighlyAggressive
    }
  };
}

function validateOversWithinLimit(balls, oversPerInnings, label) {
  const limitBalls = oversPerInnings * 6;
  if (balls > limitBalls) {
    throw new Error(`${label} cannot exceed ${oversPerInnings} overs.`);
  }
}

function isDuplicateMatch({
  matchDate,
  team1Id,
  team2Id,
  team1Runs,
  team1Balls,
  team2Runs,
  team2Balls,
  resultType
}) {
  const row = db.prepare(
    `SELECT id FROM matches
     WHERE match_date = ?
       AND team1_id = ?
       AND team2_id = ?
       AND team1_runs = ?
       AND team1_overs_balls = ?
       AND team2_runs = ?
       AND team2_overs_balls = ?
       AND result_type = ?`
  ).get(
    matchDate,
    team1Id,
    team2Id,
    team1Runs,
    team1Balls,
    team2Runs,
    team2Balls,
    resultType
  );
  return Boolean(row);
}

export function addMatch(payload) {
  const settings = getSettings();
  const {
    team1,
    team2,
    team1Runs,
    team1Overs,
    team2Runs,
    team2Overs,
    matchDate,
    resultType = "completed",
    team1AllOut = false,
    team2AllOut = false
  } = payload;

  const a = String(team1 || "").trim();
  const b = String(team2 || "").trim();
  if (!a || !b) throw new Error("Both teams are required.");
  if (a === b) throw new Error("A team cannot play against itself.");

  const normalizedResultType = resultType === "no_result" ? "no_result" : "completed";

  const t1Runs = Number(team1Runs);
  const t2Runs = Number(team2Runs);
  assertNonNegativeInteger(t1Runs, "Team 1 runs");
  assertNonNegativeInteger(t2Runs, "Team 2 runs");

  ensureTeam(a);
  ensureTeam(b);
  const { team1Id, team2Id } = getTeamIds(a, b);

  const t1Balls = oversToBalls(team1Overs);
  const t2Balls = oversToBalls(team2Overs);

  if (t1Balls <= 0 || t2Balls <= 0) {
    throw new Error("Overs must be greater than 0.");
  }

  validateOversWithinLimit(t1Balls, settings.oversPerInnings, "Team 1 overs");
  validateOversWithinLimit(t2Balls, settings.oversPerInnings, "Team 2 overs");

  const dateValue = matchDate || new Date().toISOString().slice(0, 10);

  if (isDuplicateMatch({
    matchDate: dateValue,
    team1Id,
    team2Id,
    team1Runs: t1Runs,
    team1Balls: t1Balls,
    team2Runs: t2Runs,
    team2Balls: t2Balls,
    resultType: normalizedResultType
  })) {
    throw new Error("Duplicate match detected. This match already exists.");
  }

  const result = db
    .prepare(
      `INSERT INTO matches (
        match_date,
        team1_id,
        team2_id,
        team1_runs,
        team1_overs_balls,
        team2_runs,
        team2_overs_balls,
        team1_all_out,
        team2_all_out,
        result_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      dateValue,
      team1Id,
      team2Id,
      t1Runs,
      t1Balls,
      t2Runs,
      t2Balls,
      team1AllOut ? 1 : 0,
      team2AllOut ? 1 : 0,
      normalizedResultType,
      new Date().toISOString()
    );

  return { id: result.lastInsertRowid };
}

export function listMatches() {
  return db
    .prepare(
      `SELECT
        m.id,
        m.match_date AS date,
        t1.name AS team1,
        t2.name AS team2,
        m.team1_runs,
        m.team1_overs_balls,
        m.team2_runs,
        m.team2_overs_balls,
        m.team1_all_out,
        m.team2_all_out,
        m.result_type
      FROM matches m
      JOIN teams t1 ON t1.id = m.team1_id
      JOIN teams t2 ON t2.id = m.team2_id
      ORDER BY m.id ASC`
    )
    .all();
}

export function pointsTable() {
  const teams = listTeams();
  const matches = listMatches();
  const settings = getSettings();

  const table = Object.fromEntries(
    teams.map((team) => [team, {
      team,
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      runsFor: 0,
      ballsFaced: 0,
      runsAgainst: 0,
      ballsBowled: 0,
      oversFacedFloat: 0,
      oversBowledFloat: 0,
      nrr: 0
    }])
  );

  for (const m of matches) {
    const t1 = table[m.team1];
    const t2 = table[m.team2];
    if (!t1 || !t2) continue;

    t1.played += 1;
    t2.played += 1;

    t1.runsFor += m.team1_runs;
    t1.ballsFaced += m.team1_overs_balls;
    t1.runsAgainst += m.team2_runs;
    t1.ballsBowled += m.team2_overs_balls;

    t2.runsFor += m.team2_runs;
    t2.ballsFaced += m.team2_overs_balls;
    t2.runsAgainst += m.team1_runs;
    t2.ballsBowled += m.team1_overs_balls;

    if (m.result_type === "no_result") {
      t1.noResult += 1;
      t2.noResult += 1;
      continue;
    }

    if (m.team1_runs > m.team2_runs) {
      t1.won += 1;
      t2.lost += 1;
      t1.points += 2;
    } else if (m.team2_runs > m.team1_runs) {
      t2.won += 1;
      t1.lost += 1;
      t2.points += 2;
    } else {
      t1.tied += 1;
      t2.tied += 1;
      t1.points += 1;
      t2.points += 1;
    }
  }

  const rows = teams.map((team) => {
    const row = table[team];
    row.oversFacedFloat = row.ballsFaced / 6;
    row.oversBowledFloat = row.ballsBowled / 6;
    row.nrr = Number(calculateNrr(row.runsFor, row.ballsFaced, row.runsAgainst, row.ballsBowled).toFixed(3));
    return row;
  });

  rows.sort((a, b) => (b.points - a.points) || (b.nrr - a.nrr));

  rows.forEach((row, index) => {
    row.rank = index + 1;
    row.qualified = row.rank <= settings.qualifyingSpots;
    row.targetMatches = settings.matchesPerTeam;
    row.remainingMatches = Math.max(0, settings.matchesPerTeam - row.played);
  });

  return rows;
}

function projectRowsAfterMatch(team1, team2, team1Runs, team1Balls, team2Runs, team2Balls, resultType = "completed") {
  const rows = pointsTable().map((r) => ({ ...r }));
  const table = Object.fromEntries(rows.map((r) => [r.team, r]));

  if (!table[team1] || !table[team2]) {
    return rows;
  }

  const t1 = table[team1];
  const t2 = table[team2];

  t1.played += 1;
  t2.played += 1;

  t1.runsFor += team1Runs;
  t1.ballsFaced += team1Balls;
  t1.runsAgainst += team2Runs;
  t1.ballsBowled += team2Balls;

  t2.runsFor += team2Runs;
  t2.ballsFaced += team2Balls;
  t2.runsAgainst += team1Runs;
  t2.ballsBowled += team1Balls;

  if (resultType === "no_result") {
    t1.noResult += 1;
    t2.noResult += 1;
  } else if (team1Runs > team2Runs) {
    t1.won += 1;
    t2.lost += 1;
    t1.points += 2;
  } else if (team2Runs > team1Runs) {
    t2.won += 1;
    t1.lost += 1;
    t2.points += 2;
  } else {
    t1.tied += 1;
    t2.tied += 1;
    t1.points += 1;
    t2.points += 1;
  }

  rows.forEach((row) => {
    row.oversFacedFloat = row.ballsFaced / 6;
    row.oversBowledFloat = row.ballsBowled / 6;
    row.nrr = Number(calculateNrr(row.runsFor, row.ballsFaced, row.runsAgainst, row.ballsBowled).toFixed(3));
  });

  rows.sort((a, b) => (b.points - a.points) || (b.nrr - a.nrr));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return rows;
}

function findWinByRunsScenario(challenger, opponent, targetTeam, settings) {
  const inningsBalls = settings.oversPerInnings * 6;
  const baseRuns = getTypicalInningsRuns(settings.oversPerInnings);

  for (let requiredMargin = 1; requiredMargin <= Math.max(baseRuns * 2, 60); requiredMargin += 1) {
    const challengerRuns = baseRuns;
    const opponentRuns = Math.max(0, baseRuns - requiredMargin);

    const projected = projectRowsAfterMatch(
      challenger,
      opponent,
      challengerRuns,
      inningsBalls,
      opponentRuns,
      inningsBalls,
      "completed"
    );

    const challengerRow = projected.find((r) => r.team === challenger);
    const targetRow = projected.find((r) => r.team === targetTeam);
    if (!challengerRow || !targetRow) continue;

    if (challengerRow.rank <= settings.qualifyingSpots && challengerRow.rank < targetRow.rank) {
      return {
        mode: "batting_first",
        targetTeam,
        requiredMargin,
        projectedNrr: challengerRow.nrr,
        targetCurrentNrr: targetRow.nrr,
        requiredNrr: Number((targetRow.nrr + 0.001).toFixed(3)),
        mathematicalReasoning: `To surpass ${targetTeam} (${targetRow.nrr.toFixed(3)}), ${challenger} needs at least ${(targetRow.nrr + 0.001).toFixed(3)} NRR. A ${requiredMargin}-run win reaches ${challengerRow.nrr.toFixed(3)}.`
      };
    }
  }

  return null;
}

function findChaseWithinOversScenario(challenger, opponent, targetTeam, settings) {
  const inningsBalls = settings.oversPerInnings * 6;
  const targetRuns = getTypicalInningsRuns(settings.oversPerInnings);
  const chaseRuns = targetRuns + 1;

  for (let ballsFaced = inningsBalls; ballsFaced >= 1; ballsFaced -= 1) {
    const projected = projectRowsAfterMatch(
      challenger,
      opponent,
      chaseRuns,
      ballsFaced,
      targetRuns,
      inningsBalls,
      "completed"
    );

    const challengerRow = projected.find((r) => r.team === challenger);
    const targetRow = projected.find((r) => r.team === targetTeam);
    if (!challengerRow || !targetRow) continue;

    if (challengerRow.rank <= settings.qualifyingSpots && challengerRow.rank < targetRow.rank) {
      return {
        mode: "batting_second",
        targetTeam,
        chaseWithinBalls: ballsFaced,
        chaseWithinOvers: ballsToOvers(ballsFaced),
        chaseWithinOversFloat: Number((ballsFaced / 6).toFixed(3)),
        projectedNrr: challengerRow.nrr,
        targetCurrentNrr: targetRow.nrr,
        requiredNrr: Number((targetRow.nrr + 0.001).toFixed(3)),
        mathematicalReasoning: `To surpass ${targetTeam} (${targetRow.nrr.toFixed(3)}), ${challenger} needs at least ${(targetRow.nrr + 0.001).toFixed(3)} NRR. Chasing ${chaseRuns} within ${ballsToOvers(ballsFaced)} overs reaches ${challengerRow.nrr.toFixed(3)}.`
      };
    }
  }

  return null;
}

export function qualificationPlan(challengerInput, opponentInput) {
  const challenger = String(challengerInput || "").trim();
  const opponent = String(opponentInput || "").trim();
  if (!challenger || !opponent) {
    throw new Error("Choose both teams for qualification calculation.");
  }

  const settings = getSettings();
  const table = pointsTable();
  const challengerRow = table.find((r) => r.team === challenger);
  if (!challengerRow) {
    throw new Error(`Team '${challenger}' not found.`);
  }

  const relevantTargets = table
    .filter((r) => r.qualified && r.team !== challenger)
    .slice(0, settings.qualifyingSpots);

  const avgScore = getTypicalInningsRuns(settings.oversPerInnings);

  const scenarios = relevantTargets.map((target) => {
    const battingFirst = findWinByRunsScenario(challenger, opponent, target.team, settings);
    const battingSecond = findChaseWithinOversScenario(challenger, opponent, target.team, settings);

    const battingFirstFeasibility = evaluateFeasibility(
      battingFirst?.requiredMargin,
      undefined,
      settings.oversPerInnings,
      avgScore
    );
    const battingSecondFeasibility = evaluateFeasibility(
      undefined,
      battingSecond?.chaseWithinOversFloat,
      settings.oversPerInnings,
      avgScore
    );
    const overallFeasibility = evaluateFeasibility(
      battingFirst?.requiredMargin,
      battingSecond?.chaseWithinOversFloat,
      settings.oversPerInnings,
      avgScore
    );

    const finalNote = overallFeasibility.status === "Practically Impossible"
      ? "Mathematically possible, but effectively impossible in realistic gameplay."
      : overallFeasibility.status === "Unrealistic" || overallFeasibility.status === "Highly Aggressive"
        ? "Mathematically possible, but difficult in realistic gameplay."
        : "Mathematically possible and within realistic match ranges.";

    return {
      targetTeam: target.team,
      currentTargetNrr: Number(target.nrr.toFixed(3)),
      requiredNrrToQualify: Number((target.nrr + 0.001).toFixed(3)),
      averageFirstInningsScore: avgScore,
      battingFirst: battingFirst ? {
        ...battingFirst,
        feasibility: battingFirstFeasibility
      } : null,
      battingSecond: battingSecond ? {
        ...battingSecond,
        feasibility: battingSecondFeasibility
      } : null,
      overallFeasibility,
      finalNote,
      finalCondition: battingFirst || battingSecond
        ? `Outqualify ${target.team} by meeting either batting-first or chase condition.`
        : `No qualifying route found against ${target.team} under current assumptions.`
    };
  });

  return {
    assumption: `Standard full-overs match (${settings.oversPerInnings} overs each side)`,
    challenger,
    opponent,
    realismModel: {
      totalOvers: settings.oversPerInnings,
      averageFirstInningsScore: avgScore,
      rules: {
        runMarginUnrealisticAbove: Number((0.8 * avgScore).toFixed(2)),
        chaseHighlyAggressiveBelowOvers: Number((0.5 * settings.oversPerInnings).toFixed(2))
      }
    },
    currentTeamNrr: Number(challengerRow.nrr.toFixed(3)),
    standings: table.map((r) => ({
      team: r.team,
      points: r.points,
      nrr: Number(r.nrr.toFixed(3)),
      rank: r.rank,
      qualified: r.qualified
    })),
    scenarios,
    relevantScenarios: scenarios
  };
}
