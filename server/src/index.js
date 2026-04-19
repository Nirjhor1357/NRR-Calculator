import express from "express";
import cors from "cors";
import {
  addMatch,
  ballsToOvers,
  deleteTeam,
  ensureTeam,
  getSettings,
  listMatches,
  listTeams,
  pointsTable,
  qualificationPlan,
  updateSettings
} from "./logic.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/summary", (_req, res) => {
  try {
    const settings = getSettings();
    const table = pointsTable();
    const matches = listMatches().map((m) => ({
      ...m,
      team1Overs: ballsToOvers(m.team1_overs_balls),
      team2Overs: ballsToOvers(m.team2_overs_balls),
      team1OversFloat: Number((m.team1_overs_balls / 6).toFixed(3)),
      team2OversFloat: Number((m.team2_overs_balls / 6).toFixed(3))
    }));

    res.json({
      teams: listTeams(),
      matches,
      table,
      qualificationTable: table,
      settings
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load summary." });
  }
});

app.post("/api/teams", (req, res) => {
  try {
    ensureTeam(req.body.teamName || "");
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/teams/:teamName", (req, res) => {
  try {
    const deletedMatches = deleteTeam(req.params.teamName);
    res.json({ ok: true, deletedMatches });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/matches", (req, res) => {
  try {
    const record = addMatch({
      team1: req.body.team1,
      team2: req.body.team2,
      team1Runs: Number(req.body.team1Runs),
      team1Overs: req.body.team1Overs,
      team2Runs: Number(req.body.team2Runs),
      team2Overs: req.body.team2Overs,
      matchDate: req.body.matchDate,
      resultType: req.body.resultType,
      team1AllOut: Boolean(req.body.team1AllOut),
      team2AllOut: Boolean(req.body.team2AllOut)
    });
    res.status(201).json({ ok: true, record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    updateSettings({
      qualifyingSpots: req.body.qualifyingSpots !== undefined ? Number(req.body.qualifyingSpots) : undefined,
      oversPerInnings: req.body.oversPerInnings !== undefined ? Number(req.body.oversPerInnings) : undefined,
      matchesPerTeam: req.body.matchesPerTeam !== undefined ? Number(req.body.matchesPerTeam) : undefined
    });
    res.json({ ok: true, settings: getSettings() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/qualification/calculate", (req, res) => {
  const challenger = String(req.body.challenger || "").trim();
  const opponent = String(req.body.opponent || "").trim();

  if (!challenger || !opponent) {
    return res.status(400).json({ error: "Choose both teams for qualification calculation." });
  }

  try {
    const plan = qualificationPlan(challenger, opponent);
    res.json(plan);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`NRR API running on http://localhost:${port}`);
});

app.use((err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }

  return res.status(500).json({ error: err?.message || "Internal server error." });
});
