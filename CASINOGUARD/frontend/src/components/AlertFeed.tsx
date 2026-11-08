import { useEffect, useState } from "react";
import { DETECTOR_ORDER, DetectorIcon, SeverityBadge } from "../detectors";
import { compactMoney, relativeTime } from "../format";
import { shortId } from "../state";
import type { Alert, DetectorInfo, DetectorKey, Severity, Summary } from "../types";

interface Props {
  alerts: Alert[];
  detectors: DetectorInfo[];
  summary: Summary | null;
  selectedId: string | null;
  freshAlerts: Record<string, number>;
  detectorFilter: DetectorKey | null;
  severityFilter: Severity | null;
  onDetectorFilter: (detector: DetectorKey | null) => void;
  onSeverityFilter: (severity: Severity | null) => void;
  onSelect: (id: string) => void;
  loading: boolean;
  sourceKind: "local" | "databricks";
}

export function AlertFeed(props: Props) {
  const { alerts, detectors, summary, selectedId, freshAlerts, detectorFilter, severityFilter } = props;

  // Keeps "2m ago" labels current between events.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [alerts]);

  const labels = new Map(detectors.map((detector) => [detector.key, detector]));

  const visible = alerts.filter(
    (alert) =>
      (!detectorFilter || alert.detector === detectorFilter) &&
      (!severityFilter || alert.severity === severityFilter),
  );

  return (
    <section className="panel alerts-panel" aria-label="Alerts">
      <div className="panel-header">
        <h2>Alerts</h2>
        <div className="segmented" role="group" aria-label="Filter by priority">
          {([null, "high", "medium"] as const).map((value) => (
            <button
              key={value ?? "all"}
              className={severityFilter === value ? "active" : ""}
              aria-pressed={severityFilter === value}
              onClick={() => props.onSeverityFilter(value)}
            >
              {value === null ? "All" : value === "high" ? "High" : "Medium"}
            </button>
          ))}
        </div>
      </div>

      <div className="detector-grid" role="group" aria-label="Filter by detector">
        {DETECTOR_ORDER.filter((key) => !detectors.length || labels.has(key)).map((key) => {
          const active = detectorFilter === key;
          return (
            <button
              key={key}
              className={`detector-chip ${active ? "active" : ""}`}
              aria-pressed={active}
              title={labels.get(key)?.description}
              onClick={() => props.onDetectorFilter(active ? null : key)}
            >
              <DetectorIcon detector={key} size={14} />
              <span className="detector-chip-label">{labels.get(key)?.label ?? key}</span>
              <span className="detector-chip-count">{summary?.detector_summary[key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <ul className="alert-list" aria-live="polite">
        {visible.map((alert) => (
          <li key={alert.id}>
            <button
              className={`alert-card ${selectedId === alert.id ? "selected" : ""} ${alert.id in freshAlerts ? "fresh" : ""}`}
              onClick={() => props.onSelect(alert.id)}
            >
              <span className="alert-card-top">
                <SeverityBadge severity={alert.severity} />
                <span className="alert-time">{relativeTime(alert.last_updated_at, now)}</span>
              </span>
              <span className="alert-title">{alert.title}</span>
              <span className="alert-summary">{alert.summary}</span>
              <span className="alert-card-bottom">
                <span className="alert-detector">
                  <DetectorIcon detector={alert.detector} size={13} />
                  {alert.detector_label}
                </span>
                <span className="alert-meta">
                  {alert.exposure !== null && <span>{compactMoney(alert.exposure)}</span>}
                  {alert.revision > 1 && <span>Updated ×{alert.revision - 1}</span>}
                  <span className="mono" title={alert.id}>{shortId(alert.id)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}

        {visible.length === 0 && (
          <li className="empty">
            {props.loading && alerts.length === 0
              ? props.sourceKind === "databricks"
                ? "Loading alerts from Databricks. A stopped SQL warehouse can take a minute to start…"
                : "Loading alerts…"
              : alerts.length === 0
                ? props.sourceKind === "databricks"
                  ? "The Databricks alerts table has no alerts."
                  : "The detectors haven't raised any alerts."
                : "No alerts match these filters."}
          </li>
        )}
      </ul>
    </section>
  );
}
