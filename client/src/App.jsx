import { useEffect, useMemo, useState } from "react";

const defaultPlan = { relevantScenarios: [], standings: [], assumption: "", currentTeamNrr: 0 };

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error: `Unexpected response from server (${response.status})` };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  if (!raw) {
    return { ok: true };
  }

  return payload;
}

export default function App() {
  const [summary, setSummary] = useState({
    teams: [],
    matches: [],
    table: [],
    settings: { qualifyingSpots: 2, oversPerInnings: 20, matchesPerTeam: 2 }
  });
  const [plan, setPlan] = useState(defaultPlan);
  const [status, setStatus] = useState({ message: "", error: "" });
  const [loading, setLoading] = useState(false);

  const [teamName, setTeamName] = useState("");
  const [matchForm, setMatchForm] = useState({
    team1: "",
    team2: "",
    team1Runs: "",
    team1Overs: "",
    team2Runs: "",
    team2Overs: "",
    matchDate: new Date().toISOString().slice(0, 10),
    resultType: "completed",
    team1AllOut: false,
    team2AllOut: false
  });
  const [settingsForm, setSettingsForm] = useState({
    qualifyingSpots: 2,
    oversPerInnings: 20,
    matchesPerTeam: 2
  });
  const [calcForm, setCalcForm] = useState({ challenger: "", opponent: "" });

  const formatNrr = (value) => {
    const n = Number(value);
    if (Number.isNaN(n)) return "0.000";
    return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
  };

  const statusClass = (status) => {
    if (status === "Practically Impossible") return "impossible";
    if (status === "Unrealistic") return "unrealistic";
    if (status === "Highly Aggressive") return "aggressive";
    return "realistic";
  };

  const metrics = useMemo(() => ({
    teams: summary.teams.length,
    matches: summary.matches.length,
    overs: summary.settings.oversPerInnings
  }), [summary]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await api("/api/summary");
      setSummary(data);
      setSettingsForm({
        qualifyingSpots: data.settings.qualifyingSpots,
        oversPerInnings: data.settings.oversPerInnings,
        matchesPerTeam: data.settings.matchesPerTeam
      });
      setCalcForm((prev) => ({
        challenger: prev.challenger || data.teams[0] || "",
        opponent: prev.opponent || data.teams[1] || data.teams[0] || ""
      }));
    } catch (error) {
      setStatus({ message: "", error: error.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const setMessage = (message) => setStatus({ message, error: "" });
  const setError = (error) => setStatus({ message: "", error });

  async function handleAddTeam(event) {
    event.preventDefault();
    try {
      await api("/api/teams", { method: "POST", body: JSON.stringify({ teamName }) });
      setTeamName("");
      setMessage("Team saved.");
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }

  async function handleDeleteTeam(team) {
    if (!window.confirm("Delete this team and all related matches?")) return;
    try {
      await api(`/api/teams/${encodeURIComponent(team)}`, { method: "DELETE" });
      setMessage("Team deleted.");
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }

  async function handleSaveSettings(event) {
    event.preventDefault();
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          qualifyingSpots: Number(settingsForm.qualifyingSpots),
          oversPerInnings: Number(settingsForm.oversPerInnings),
          matchesPerTeam: Number(settingsForm.matchesPerTeam)
        })
      });
      setMessage("Settings updated.");
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }

  async function handleAddMatch(event) {
    event.preventDefault();
    if (matchForm.team1 === matchForm.team2) {
      setError("Team 1 and Team 2 cannot be the same.");
      return;
    }

    try {
      await api("/api/matches", {
        method: "POST",
        body: JSON.stringify({
          team1: matchForm.team1,
          team2: matchForm.team2,
          team1Runs: Number(matchForm.team1Runs),
          team1Overs: matchForm.team1Overs,
          team2Runs: Number(matchForm.team2Runs),
          team2Overs: matchForm.team2Overs,
          matchDate: matchForm.matchDate,
          resultType: matchForm.resultType,
          team1AllOut: matchForm.team1AllOut,
          team2AllOut: matchForm.team2AllOut
        })
      });
      setMessage("Match added successfully.");
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }

  async function handleCalculate(event) {
    event.preventDefault();
    try {
      const payload = await api("/api/qualification/calculate", {
        method: "POST",
        body: JSON.stringify(calcForm)
      });
      setPlan(payload);
      setMessage("Qualification logic calculated.");
    } catch (error) {
      setError(error.message);
    }
  }

  return (
    <main className="container">
      <header className="hero">
        <p className="eyebrow">Tournament Control Room</p>
        <h1>Net Run Rate Calculator</h1>
        <p className="subtitle">React frontend + Node API + SQLite database.</p>
        <div className="chips">
          <span>{metrics.teams} teams</span>
          <span>{metrics.matches} matches</span>
          <span>{metrics.overs} overs format</span>
        </div>
      </header>

      {status.message && <div className="alert success">{status.message}</div>}
      {status.error && <div className="alert error">{status.error}</div>}
      {loading && <div className="alert">Refreshing data...</div>}

      <section className="grid">
        <article className="card">
          <h2>Teams</h2>
          <form onSubmit={handleAddTeam} className="stack">
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" required />
            <button type="submit">Add Team</button>
          </form>
          <div className="list">
            {summary.teams.map((team) => (
              <div key={team} className="row">
                <span>{team}</span>
                <button onClick={() => handleDeleteTeam(team)} className="danger" type="button">Delete</button>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Tournament Settings</h2>
          <form onSubmit={handleSaveSettings} className="stack">
            <label>Qualifying Spots</label>
            <input type="number" min="1" value={settingsForm.qualifyingSpots} onChange={(e) => setSettingsForm((s) => ({ ...s, qualifyingSpots: e.target.value }))} />
            <label>Overs Per Innings</label>
            <input type="number" min="1" value={settingsForm.oversPerInnings} onChange={(e) => setSettingsForm((s) => ({ ...s, oversPerInnings: e.target.value }))} />
            <label>Matches Per Team</label>
            <input type="number" min="1" value={settingsForm.matchesPerTeam} onChange={(e) => setSettingsForm((s) => ({ ...s, matchesPerTeam: e.target.value }))} />
            <button type="submit">Save Settings</button>
          </form>
        </article>

        <article className="card">
          <h2>Add Match</h2>
          <form onSubmit={handleAddMatch} className="stack">
            <label>Team 1</label>
            <select value={matchForm.team1} onChange={(e) => setMatchForm((s) => ({ ...s, team1: e.target.value }))} required>
              <option value="">Choose team</option>
              {summary.teams.map((team) => <option key={team} value={team}>{team}</option>)}
            </select>
            <label>Team 2</label>
            <select value={matchForm.team2} onChange={(e) => setMatchForm((s) => ({ ...s, team2: e.target.value }))} required>
              <option value="">Choose team</option>
              {summary.teams.map((team) => <option key={team} value={team} disabled={team === matchForm.team1}>{team}</option>)}
            </select>

            <label>Result Type</label>
            <select value={matchForm.resultType} onChange={(e) => setMatchForm((s) => ({ ...s, resultType: e.target.value }))}>
              <option value="completed">Completed</option>
              <option value="no_result">No Result</option>
            </select>

            <label>Team 1 Runs / Overs</label>
            <div className="split">
              <input type="number" min="0" value={matchForm.team1Runs} onChange={(e) => setMatchForm((s) => ({ ...s, team1Runs: e.target.value }))} required />
              <input value={matchForm.team1Overs} onChange={(e) => setMatchForm((s) => ({ ...s, team1Overs: e.target.value }))} placeholder="20 or 19.3" required />
            </div>
            <label className="checkline">
              <input type="checkbox" checked={matchForm.team1AllOut} onChange={(e) => setMatchForm((s) => ({ ...s, team1AllOut: e.target.checked }))} />
              Team 1 all out
            </label>
            <label>Team 2 Runs / Overs</label>
            <div className="split">
              <input type="number" min="0" value={matchForm.team2Runs} onChange={(e) => setMatchForm((s) => ({ ...s, team2Runs: e.target.value }))} required />
              <input value={matchForm.team2Overs} onChange={(e) => setMatchForm((s) => ({ ...s, team2Overs: e.target.value }))} placeholder="20 or 18.5" required />
            </div>
            <label className="checkline">
              <input type="checkbox" checked={matchForm.team2AllOut} onChange={(e) => setMatchForm((s) => ({ ...s, team2AllOut: e.target.checked }))} />
              Team 2 all out
            </label>
            <label>Date</label>
            <input type="date" value={matchForm.matchDate} onChange={(e) => setMatchForm((s) => ({ ...s, matchDate: e.target.value }))} />
            <button type="submit" disabled={matchForm.team1 && matchForm.team1 === matchForm.team2}>Save Match</button>
          </form>
        </article>
      </section>

      <section className="card">
        <h2>Qualification Calculator</h2>
        <form onSubmit={handleCalculate} className="stack two">
          <div>
            <label>Team to Qualify</label>
            <select value={calcForm.challenger} onChange={(e) => setCalcForm((s) => ({ ...s, challenger: e.target.value }))} required>
              <option value="">Choose team</option>
              {summary.teams.map((team) => <option key={team} value={team}>{team}</option>)}
            </select>
          </div>
          <div>
            <label>Upcoming Opponent</label>
            <select value={calcForm.opponent} onChange={(e) => setCalcForm((s) => ({ ...s, opponent: e.target.value }))} required>
              <option value="">Choose team</option>
              {summary.teams.map((team) => <option key={team} value={team} disabled={team === calcForm.challenger}>{team}</option>)}
            </select>
          </div>
          <button type="submit">Calculate</button>
        </form>

        {!!plan.relevantScenarios.length && (
          <div className="results">
            <p className="muted">{plan.assumption}</p>
            <p className="muted">Current NRR of {calcForm.challenger}: {formatNrr(plan.currentTeamNrr)}</p>
            {!!plan.realismModel && (
              <p className="muted">
                Realism model: Avg 1st innings {plan.realismModel.averageFirstInningsScore}, run-margin unrealistic above {plan.realismModel.rules.runMarginUnrealisticAbove}, chase highly aggressive below {plan.realismModel.rules.chaseHighlyAggressiveBelowOvers} overs.
              </p>
            )}
            {!!plan.standings?.length && (
              <div className="row block">
                <strong>Current Team NRRs</strong>
                <div className="mono details">
                  {plan.standings.map((row) => (
                    <span key={row.team}>{row.team}: {row.nrr >= 0 ? "+" : ""}{Number(row.nrr).toFixed(3)}</span>
                  ))}
                </div>
              </div>
            )}
            {plan.relevantScenarios.map((scenario) => (
              <div key={scenario.targetTeam} className="row block">
                <strong>{scenario.targetTeam}</strong>
                <div className="mono details">
                  <span>Current target NRR: {Number(scenario.currentTargetNrr).toFixed(3)}</span>
                  <span>Required NRR to qualify: {Number(scenario.requiredNrrToQualify).toFixed(3)}</span>

                  <span><strong>Batting First:</strong> {scenario.battingFirst ? `Win by ${scenario.battingFirst.requiredMargin} runs` : "N/A"}</span>
                  {scenario.battingFirst?.feasibility && (
                    <span className={`status ${statusClass(scenario.battingFirst.feasibility.status)}`}>
                      Status: {scenario.battingFirst.feasibility.status} | Confidence: {scenario.battingFirst.feasibility.confidence}
                    </span>
                  )}

                  <span><strong>Batting Second:</strong> {scenario.battingSecond ? `Chase within ${scenario.battingSecond.chaseWithinOvers} overs` : "N/A"}</span>
                  {scenario.battingSecond?.feasibility && (
                    <span className={`status ${statusClass(scenario.battingSecond.feasibility.status)}`}>
                      Status: {scenario.battingSecond.feasibility.status} | Confidence: {scenario.battingSecond.feasibility.confidence}
                    </span>
                  )}

                  {scenario.battingFirst?.feasibility?.warning && (
                    <span className="warning">WARNING: {scenario.battingFirst.feasibility.warning}</span>
                  )}
                  {scenario.battingSecond?.feasibility?.warning && (
                    <span className="warning">WARNING: {scenario.battingSecond.feasibility.warning}</span>
                  )}

                  {!!scenario.overallFeasibility && (
                    <span className={`status ${statusClass(scenario.overallFeasibility.status)}`}>
                      Overall Feasibility: {scenario.overallFeasibility.status}
                    </span>
                  )}
                  <span>{scenario.battingFirst?.mathematicalReasoning || scenario.battingSecond?.mathematicalReasoning || scenario.finalCondition}</span>
                  <span className="muted">Final Note: {scenario.finalNote || scenario.finalCondition}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Points Table</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>P</th>
                <th>W</th>
                <th>L</th>
                <th>Pts</th>
                <th>NRR</th>
                <th>Target</th>
                <th>Remain</th>
                <th>NR</th>
              </tr>
            </thead>
            <tbody>
              {summary.table.map((row) => (
                <tr key={row.team}>
                  <td>{row.team}</td>
                  <td>{row.played}</td>
                  <td>{row.won}</td>
                  <td>{row.lost}</td>
                  <td>{row.points}</td>
                  <td className="mono">{formatNrr(row.nrr)}</td>
                  <td>{row.targetMatches}</td>
                  <td>{row.remainingMatches}</td>
                  <td>{row.noResult ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Match Log</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Date</th>
                <th>Team 1</th>
                <th>Score</th>
                <th>Team 2</th>
                <th>Score</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {summary.matches.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>{m.date}</td>
                  <td>{m.team1}</td>
                  <td className="mono">{m.team1_runs}/{m.team1Overs}</td>
                  <td>{m.team2}</td>
                  <td className="mono">{m.team2_runs}/{m.team2Overs}</td>
                  <td>{m.result_type === "no_result" ? "No Result" : "Completed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
