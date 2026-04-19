import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.NRR_DB_PATH || path.join(dataDir, "tournament.sqlite");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_date TEXT NOT NULL,
    team1_id INTEGER NOT NULL,
    team2_id INTEGER NOT NULL,
    team1_runs INTEGER NOT NULL,
    team1_overs_balls INTEGER NOT NULL,
    team2_runs INTEGER NOT NULL,
    team2_overs_balls INTEGER NOT NULL,
    team1_all_out INTEGER NOT NULL DEFAULT 0,
    team2_all_out INTEGER NOT NULL DEFAULT 0,
    result_type TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    FOREIGN KEY(team1_id) REFERENCES teams(id),
    FOREIGN KEY(team2_id) REFERENCES teams(id),
    CHECK(team1_id <> team2_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)"
);
insertSetting.run("qualifying_spots", "2");
insertSetting.run("overs_per_innings", "20");
insertSetting.run("matches_per_team", "2");

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((c) => c.name === columnName);
}

if (!hasColumn("matches", "team1_all_out")) {
  db.exec("ALTER TABLE matches ADD COLUMN team1_all_out INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("matches", "team2_all_out")) {
  db.exec("ALTER TABLE matches ADD COLUMN team2_all_out INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("matches", "result_type")) {
  db.exec("ALTER TABLE matches ADD COLUMN result_type TEXT NOT NULL DEFAULT 'completed'");
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_dedup
  ON matches(
    match_date,
    team1_id,
    team2_id,
    team1_runs,
    team1_overs_balls,
    team2_runs,
    team2_overs_balls,
    result_type
  );
`);
