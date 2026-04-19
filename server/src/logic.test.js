import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.join(process.cwd(), "..", "data", "test-tournament.sqlite");
process.env.NRR_DB_PATH = testDbPath;

if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const logic = await import("./logic.js");
const { db } = await import("./db.js");

function resetDb() {
  db.exec("DELETE FROM matches;");
  db.exec("DELETE FROM teams;");
  db.exec("DELETE FROM settings;");
  db.prepare("INSERT INTO settings(key, value) VALUES('qualifying_spots','2')").run();
  db.prepare("INSERT INTO settings(key, value) VALUES('overs_per_innings','20')").run();
  db.prepare("INSERT INTO settings(key, value) VALUES('matches_per_team','2')").run();
}

test("overs conversion: 19.3 -> 19.5", () => {
  assert.equal(logic.oversToFloat("19.3"), 19.5);
  assert.equal(logic.oversToBalls("8.5"), 53);
  assert.throws(() => logic.oversToBalls("10.9"), /Invalid overs format/);
});

test("nrr calculation precision", () => {
  // (180/20) - (160/20) = 1.0
  const nrr = logic.calculateNrr(180, 120, 160, 120);
  assert.equal(Number(nrr.toFixed(3)), 1.0);
});

test("feasibility evaluation threshold behavior", () => {
  const realistic = logic.evaluateFeasibility(20, 7, 10, 90);
  assert.equal(realistic.status, "Realistic");
  assert.equal(realistic.confidence, "High");

  const aggressive = logic.evaluateFeasibility(undefined, 4.9, 10, 90);
  assert.equal(aggressive.status, "Highly Aggressive");
  assert.equal(aggressive.confidence, "Medium");

  const unrealistic = logic.evaluateFeasibility(80, undefined, 10, 90);
  assert.equal(unrealistic.status, "Unrealistic");
  assert.equal(unrealistic.confidence, "Low");
  assert.match(unrealistic.warning, /highly unlikely/i);

  const impossible = logic.evaluateFeasibility(80, 4, 10, 90);
  assert.equal(impossible.status, "Practically Impossible");
  assert.equal(impossible.confidence, "Low");
  assert.match(impossible.warning, /practically impossible/i);
});

test("qualification output contains both run and chase conditions", () => {
  resetDb();

  logic.ensureTeam("A");
  logic.ensureTeam("B");
  logic.ensureTeam("C");

  logic.addMatch({
    team1: "B",
    team2: "C",
    team1Runs: 170,
    team1Overs: "20",
    team2Runs: 150,
    team2Overs: "20",
    matchDate: "2026-04-19",
    resultType: "completed"
  });

  const plan = logic.qualificationPlan("A", "B");
  assert.ok(Array.isArray(plan.relevantScenarios));
  assert.ok(plan.relevantScenarios.length >= 1);

  const first = plan.relevantScenarios[0];
  assert.ok("battingFirst" in first);
  assert.ok("battingSecond" in first);
});
