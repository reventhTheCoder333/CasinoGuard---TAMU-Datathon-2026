import { useState } from "react";
import { api } from "../api";
import { dateTime } from "../format";
import { DetectorIcon } from "../detectors";
import { shortId } from "../state";
import type {
  DatabricksSimulation,
  DatabricksSimulationStatus,
  DetectorKey,
  ScenarioCheck,
  SimulationScenario,
  SourceInfo,
} from "../types";

const PATTERN_LABELS: Record<string, string> = {
  transaction_structuring: "Transaction structuring",
  suspicious_transaction_chain: "Suspicious transaction chain",
  rapid_cashout: "Rapid cash-out",
  unusual_transaction_volume: "Unusual transaction volume",
  circular_transaction: "Circular transactions",
};

/** Embedded patterns against what Databricks actually detected. */
function ScenarioResult({ check, onOpenAlert }: { check: ScenarioCheck; onOpenAlert: (id: string) => void }) {
  return (
    <div className="scenario-check">
      <p className={check.matched ? "check-ok" : "check-warn"}>
        {check.matched
          ? "Databricks detected exactly the embedded patterns."
          : "Databricks' results differ from the embedded patterns. The alerts shown are what Databricks returned."}
      </p>
      <ul>
        {check.expected.map((item) => (
          <li key={item.pattern}>
            <span className={item.detected ? "rule-met" : "rule-unmet"}>{item.detected ? "✓" : "✕"}</span>{" "}
            {PATTERN_LABELS[item.pattern] ?? item.pattern}
            {item.alert_id ? (
              <button className="link-button mono" onClick={() => onOpenAlert(item.alert_id!)}>
                {shortId(item.alert_id)}
              </button>
            ) : (
              <span className="muted"> not detected</span>
            )}
          </li>
        ))}
        {check.unexpected.map((item) => (
          <li key={item.alert_id}>
            <span className="rule-unmet">!</span> Not embedded: {PATTERN_LABELS[item.pattern ?? ""] ?? item.pattern}{" "}
            <button className="link-button mono" onClick={() => onOpenAlert(item.alert_id)}>
              {shortId(item.alert_id)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACTIVE_STATES = ["generating", "uploading", "running_job", "verifying", "loading_results"];

function isActive(simulation: DatabricksSimulation | null | undefined) {
  return Boolean(simulation && ACTIVE_STATES.includes(simulation.state));
}

/** Tells the viewer when the results on screen are not from the latest simulation. */
export function StaleResultsBanner({
  simulation,
  lastLoaded,
}: {
  simulation: DatabricksSimulationStatus | null;
  lastLoaded?: string | null;
}) {
  const current = simulation?.current;
  const loadedText = lastLoaded ? ` (last loaded ${dateTime(lastLoaded)} UTC)` : "";

  if (isActive(current)) {
    return (
      <div className="banner banner-info" role="status">
        A Databricks simulation is running. The results on screen are the previous ones{loadedText} and will update
        when the pipeline finishes.
      </div>
    );
  }

  if (current?.state === "failed") {
    return (
      <div className="banner" role="alert">
        The last Databricks simulation failed, so the results on screen may be out of date{loadedText}. {current.error}
      </div>
    );
  }

  return null;
}

function SimulationProgress({
  status,
  onOpenAlert,
}: {
  status: DatabricksSimulationStatus;
  onOpenAlert: (id: string) => void;
}) {
  const current = status.current;
  if (!current) return null;

  const stoppedAt = current.state === "failed" ? current.failed_step : current.state;
  const activeIndex = status.steps.findIndex((step) => step.key === stoppedAt);
  const failed = current.state === "failed" || current.state === "cancelled";
  const finished = current.state === "succeeded";

  return (
    <div className="run" aria-live="polite">
      <p className="run-scenario">
        {current.scenario_label} <span className="muted mono">· seed {current.seed}</span>
      </p>
      <ol className="pipeline-steps">
        {status.steps.map((step, index) => {
          const done = finished || (activeIndex >= 0 && index < activeIndex);
          const active = index === activeIndex && !failed;
          const failedHere = index === activeIndex && failed;
          return (
            <li key={step.key} className={done ? "step-done" : active ? "step-active" : failedHere ? "step-failed" : ""}>
              <span className="step-mark" aria-hidden="true">
                {done ? "✓" : failedHere ? "✕" : active ? "" : "·"}
              </span>
              {step.label}
              {active && step.key === "running_job" && current.job_state && (
                <span className="muted"> · {current.job_state.toLowerCase().replace("_", " ")}</span>
              )}
            </li>
          );
        })}
      </ol>

      {current.uploaded && (
        <p className="run-none">
          Uploaded {current.uploaded.transactions} transactions and {current.uploaded.accounts} accounts.
        </p>
      )}
      {current.state === "succeeded" && (
        <p className="run-none">
          Finished {current.finished_at ? dateTime(current.finished_at) : ""} UTC. Loaded {current.alerts_loaded} alerts
          from Databricks.
        </p>
      )}
      {current.state === "succeeded" && current.check && (
        <ScenarioResult check={current.check} onOpenAlert={onOpenAlert} />
      )}
      {current.state === "cancelled" && <p className="run-error">The simulation was cancelled.</p>}
      {current.state === "failed" && <p className="run-error">{current.error}</p>}
      {current.job_run_url && (
        <p className="export-links">
          <a href={current.job_run_url} target="_blank" rel="noreferrer">
            Open job run {current.job_run_id} in Databricks
          </a>
        </p>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<SourceInfo["status"], string> = {
  loading: "Loading",
  ready: "Connected",
  error: "Refresh failed",
};

/** Shown instead of the simulator when Databricks is the source of truth. */
const SCENARIO_DETECTORS: Record<Exclude<SimulationScenario, "full">, DetectorKey> = {
  transaction_structuring: "transaction_structuring",
  transaction_chains: "transaction_chains",
  rapid_cashouts: "rapid_cashouts",
  unusual_volume: "unusual_volume",
  circular_transactions: "circular_transactions",
};

export function SourcePanel({
  source,
  simulation,
  onOpenAlert,
}: {
  source: SourceInfo;
  simulation: DatabricksSimulationStatus | null;
  onOpenAlert: (id: string) => void;
}) {
  const [mode, setMode] = useState<"full" | "individual">("full");
  const [detector, setDetector] = useState<Exclude<SimulationScenario, "full">>("transaction_structuring");
  const individualOptions = (simulation?.scenarios ?? []).filter((s) => s.key !== "full");
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const simulating = starting || isActive(simulation?.current);

  const simulate = async () => {
    setStarting(true);
    setError(null);
    setResult(null);
    try {
      await api.simulateDatabricks(mode === "full" ? "full" : detector);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The simulation couldn't start");
    } finally {
      setStarting(false);
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    setResult(null);
    try {
      const response = (await api.refreshSource()) as { changed: boolean };
      setResult(response.changed ? "Updated with new data." : "Already up to date.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const skipped = source.skipped_rows ?? [];

  return (
    <aside className="panel simulator-panel" aria-label="Data source">
      <div className="panel-header">
        <h2>Data source</h2>
        <span className={`source-status source-status-${source.status}`}>
          <span className="connection-dot" aria-hidden="true" />
          {STATUS_LABELS[source.status]}
        </span>
      </div>

      <div className="simulator-scroll">
        <p className="panel-copy">
          Detection runs in Databricks with five detectors. This dashboard reads the results and their evidence through the
          CASINOGUARD API and doesn't run the detectors itself.
        </p>

        <div className="segmented mode-switch" role="group" aria-label="Simulation mode">
          {(["full", "individual"] as const).map((value) => (
            <button
              key={value}
              className={mode === value ? "active" : ""}
              aria-pressed={mode === value}
              disabled={simulating}
              onClick={() => setMode(value)}
            >
              {value === "full" ? "Full simulation" : "Individual"}
            </button>
          ))}
        </div>

        {mode === "full" ? (
          <p className="run-none">Embeds all five suspicious patterns in a day of ordinary activity.</p>
        ) : (
          <fieldset className="detector-choice" disabled={simulating}>
            <legend className="run-none">Embed one pattern in a day of ordinary activity:</legend>
            {individualOptions.map((option) => {
              const key = option.key as Exclude<SimulationScenario, "full">;
              return (
                <label key={key} className={detector === key ? "selected" : ""}>
                  <input
                    type="radio"
                    name="scenario"
                    value={key}
                    checked={detector === key}
                    onChange={() => setDetector(key)}
                  />
                  <DetectorIcon detector={SCENARIO_DETECTORS[key]} size={14} />
                  {option.label}
                </label>
              );
            })}
          </fieldset>
        )}

        <button
          className="button primary"
          disabled={simulating || !simulation?.configured}
          onClick={simulate}
          title={simulation?.configured ? undefined : "Set DATABRICKS_PIPELINE_JOB_ID on the API server"}
        >
          {simulating ? "Simulation running…" : "Simulate data"}
        </button>
        <p className="run-none">
          All five Databricks detectors run on every simulation. A run usually takes about two minutes.
        </p>
        {simulation && !simulation.configured && (
          <p className="run-error">
            Simulation is off: set DATABRICKS_PIPELINE_JOB_ID on the API server to the Databricks job that runs the
            pipeline.
          </p>
        )}
        {simulation && <SimulationProgress status={simulation} onOpenAlert={onOpenAlert} />}

        <button
          className="button"
          disabled={refreshing || simulating || source.status === "loading"}
          onClick={refresh}
        >
          {refreshing || source.status === "loading" ? "Loading from Databricks…" : "Refresh from Databricks"}
        </button>

        {result && <p className="run-none">{result}</p>}
        {error && (
          <p className="run-error" role="alert">
            {error}
          </p>
        )}

        <h3>Connection</h3>
        <dl className="source-details">
          <div>
            <dt>Workspace</dt>
            <dd className="mono">{source.host?.replace("https://", "") ?? "–"}</dd>
          </div>
          <div>
            <dt>SQL warehouse</dt>
            <dd className="mono">{source.warehouse ?? "–"}</dd>
          </div>
          <div>
            <dt>Last loaded</dt>
            <dd className="mono">{source.last_refreshed_at ? `${dateTime(source.last_refreshed_at)} UTC` : "Not yet"}</dd>
          </div>
          <div>
            <dt>Alert rows read</dt>
            <dd className="mono">{source.alert_rows ?? 0}</dd>
          </div>
        </dl>

        {source.status === "error" && source.error && (
          <p className="run-error">
            {source.error}
            {source.last_refreshed_at ? " Showing the data from the last successful load." : ""}
          </p>
        )}

        <h3>Tables</h3>
        <dl className="source-details">
          {Object.entries(source.tables ?? {}).map(([role, table]) => (
            <div key={role}>
              <dt className="capitalize">{role}</dt>
              <dd className="mono">{table.split(".").pop()}</dd>
            </div>
          ))}
        </dl>

        {skipped.length > 0 && (
          <>
            <h3>Rows not shown</h3>
            <p className="panel-copy">
              {skipped.length} alert {skipped.length === 1 ? "row couldn't" : "rows couldn't"} be read and{" "}
              {skipped.length === 1 ? "isn't" : "aren't"} shown. Fix them in the Databricks pipeline.
            </p>
            <ul className="run-list">
              {skipped.map((row, index) => (
                <li key={`${row.alert_id}-${index}`} className="run">
                  <span className="mono">{row.alert_id?.slice(0, 8) ?? "No ID"}</span> · {row.pattern ?? "no pattern"}
                  <p className="run-none">{row.reason}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="export-links">
          Export for Tableau: <a href="/api/export/alerts.csv">alerts.csv</a> ·{" "}
          <a href="/api/export/transactions.csv">transactions.csv</a>
        </p>
      </div>
    </aside>
  );
}
