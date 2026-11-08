import { useState } from "react";
import { api } from "../api";
import { DetectorIcon } from "../detectors";
import type { IntegrationStatus, Scenario, SimulatorRun, SimulatorStatus } from "../types";

interface Props {
  scenarios: Scenario[];
  status: SimulatorStatus | null;
  integrations: IntegrationStatus[];
  onOpenAlert: (id: string) => void;
}

function RunResult({ run, onOpenAlert }: { run: SimulatorRun; onOpenAlert: (id: string) => void }) {
  const progress = run.total ? (run.emitted / run.total) * 100 : 0;
  const active = run.state === "running" || run.state === "queued";

  return (
    <li className="run">
      <div className="run-top">
        <DetectorIcon detector={run.target_detector} size={13} />
        <span className="run-name">{run.name}</span>
        <span className="run-state">
          {run.state === "running" ? `${run.emitted}/${run.total}` : run.state}
        </span>
      </div>

      {active && (
        <div className="progress" role="progressbar" aria-valuenow={run.emitted} aria-valuemax={run.total} aria-label={run.name}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      {run.alerts_raised.map((alert) => (
        <button key={alert.id} className="run-alert" onClick={() => onOpenAlert(alert.id)}>
          <span className="mono">{alert.id}</span> {alert.title}
        </button>
      ))}

      {run.state === "finished" && run.alerts_raised.length === 0 && (
        <p className="run-none">The detectors raised no alert for this run.</p>
      )}

      {run.error && <p className="run-error">{run.error}</p>}
    </li>
  );
}

export function SimulatorPanel({ scenarios, status, integrations, onOpenAlert }: Props) {
  const [error, setError] = useState<string | null>(null);
  const busy = status?.busy ?? false;
  const trafficOn = status?.traffic.enabled ?? false;

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed");
    }
  };

  return (
    <aside className="panel simulator-panel" aria-label="Transaction simulator">
      <div className="panel-header">
        <h2>Simulator</h2>
        <span className="synthetic-tag">Synthetic</span>
      </div>

      <div className="simulator-scroll">
        <p className="panel-copy">
          Generates transactions only. Each one goes through the live pipeline, and the detectors decide whether to raise
          an alert.
        </p>

        <div className="simulator-actions">
          <button className="button primary" disabled={busy} onClick={() => act(() => api.runScenario("all"))}>
            Run all six scenarios
          </button>

          <label className="toggle">
            <input
              type="checkbox"
              checked={trafficOn}
              onChange={(event) => {
                const enabled = event.target.checked;
                act(() => api.setTraffic(enabled));
              }}
            />
            <span className="toggle-track" aria-hidden="true" />
            <span>
              Normal background traffic
              {trafficOn && <span className="toggle-detail"> · {status?.traffic.emitted} sent</span>}
            </span>
          </label>
        </div>

        {error && (
          <p className="run-error" role="alert">
            {error}
          </p>
        )}

        <h3>Scenarios</h3>
        <ul className="scenario-list">
          {scenarios.map((scenario) => (
            <li key={scenario.key}>
              <button
                className="scenario"
                disabled={busy}
                onClick={() => act(() => api.runScenario(scenario.key))}
                title={scenario.description}
              >
                <DetectorIcon detector={scenario.target_detector} />
                <span>
                  <span className="scenario-name">{scenario.name}</span>
                  <span className="scenario-description">{scenario.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {status && status.runs.length > 0 && (
          <>
            <h3>Run results</h3>
            <ul className="run-list">
              {status.runs.map((run) => (
                <RunResult key={run.id} run={run} onOpenAlert={onOpenAlert} />
              ))}
            </ul>
          </>
        )}

        <div className="simulator-footer">
          <button className="button" disabled={!busy && !trafficOn} onClick={() => act(api.stopSimulator)}>
            Stop
          </button>
          <button className="button" onClick={() => act(api.resetDemo)}>
            Reset demo
          </button>
        </div>

        <h3>Integrations</h3>
        <ul className="integration-list">
          {integrations.map((integration) => (
            <li key={integration.name} title={integration.purpose}>
              <span>{integration.name}</span>
              <span className={integration.configured ? "state-on" : "state-off"}>
                {integration.configured
                  ? "Configured"
                  : integration.export_available
                    ? "CSV export"
                    : "Not configured"}
              </span>
            </li>
          ))}
        </ul>
        <p className="export-links">
          Export for Tableau: <a href="/api/export/alerts.csv">alerts.csv</a> ·{" "}
          <a href="/api/export/transactions.csv">transactions.csv</a>
        </p>
      </div>
    </aside>
  );
}
