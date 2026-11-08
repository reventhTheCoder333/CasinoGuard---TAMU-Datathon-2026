import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DETECTOR_COLORS, DETECTOR_ORDER, DetectorIcon, SeverityBadge } from "../detectors";
import { compactMoney, dateTime, formatObserved, money, parseTime } from "../format";
import { shortId } from "../state";
import type { Alert, DetectorInfo, DetectorKey, Investigation, Severity, Summary, Transaction } from "../types";
import { HBarChart, StackedColumnChart } from "./charts";

/**
 * AML analytics: aggregates of the alerts and evidence the backend already
 * serves. Evidence for each alert comes from /api/alerts/{id} (its timeline
 * and rule checks), so no detection logic is repeated here.
 */

const EVIDENCE_COLOR = "#d95926";
const OTHER_COLOR = "rgba(190, 200, 215, 0.32)";

type SortKey = "detected" | "value" | "priority";

interface Props {
  alerts: Alert[];
  summary: Summary | null;
  detectors: DetectorInfo[];
  onOpenAlert: (id: string) => void;
}

export function AnalyticsPage({ alerts, summary, detectors, onOpenAlert }: Props) {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [investigations, setInvestigations] = useState<Record<string, Investigation>>({});
  const [error, setError] = useState<string | null>(null);
  const [detector, setDetector] = useState<DetectorKey | null>(null);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("detected");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Reload when alerts change (new run, update or reset) or transactions are added.
  const alertKey = alerts.map((a) => `${a.id}:${a.revision}`).join("|");
  const transactionCount = summary?.total_transactions ?? 0;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const [txs, details] = await Promise.all([
          api.allTransactions(),
          Promise.all(alerts.map((a) => api.investigation(a.id))),
        ]);
        if (cancelled) return;
        setTransactions(txs);
        setInvestigations(Object.fromEntries(details.map((d) => [d.alert.id, d])));
        setError(null);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "The analytics data could not be loaded");
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKey, transactionCount]);

  const enabled = useMemo(() => {
    const keys = new Set(detectors.map((d) => d.key));
    return DETECTOR_ORDER.filter((k) => !detectors.length || keys.has(k));
  }, [detectors]);
  const labelOf = (key: DetectorKey) => detectors.find((d) => d.key === key)?.label ?? key;

  // Evidence transactions per alert, as listed by the backend.
  const evidence = useMemo(() => {
    const byAlert = new Map<string, Transaction[]>();
    for (const alert of alerts) byAlert.set(alert.id, investigations[alert.id]?.timeline ?? []);
    return byAlert;
  }, [alerts, investigations]);

  const evidenceIds = useMemo(() => new Set([...evidence.values()].flat().map((t) => t.id)), [evidence]);
  const suspiciousValue = useMemo(() => {
    const seen = new Map<string, number>();
    for (const tx of [...evidence.values()].flat()) seen.set(tx.id, tx.amount);
    return [...seen.values()].reduce((a, b) => a + b, 0);
  }, [evidence]);

  const alertValue = (alert: Alert) => {
    const unique = new Map((evidence.get(alert.id) ?? []).map((t) => [t.id, t.amount]));
    return [...unique.values()].reduce((a, b) => a + b, 0);
  };

  const loaded = transactions !== null && alerts.every((a) => investigations[a.id]);

  // Charts -----------------------------------------------------------------
  const patternBars = enabled.map((key) => ({
    key,
    label: <><DetectorIcon detector={key} size={13} /> {labelOf(key)}</>,
    value: summary?.detector_summary[key] ?? alerts.filter((a) => a.detector === key).length,
    color: DETECTOR_COLORS[key],
    detail: detectors.find((d) => d.key === key)?.description,
  }));

  const valueBars = enabled.map((key) => {
    const unique = new Map<string, number>();
    alerts.filter((a) => a.detector === key).forEach((a) => (evidence.get(a.id) ?? []).forEach((t) => unique.set(t.id, t.amount)));
    return {
      key,
      label: <><DetectorIcon detector={key} size={13} /> {labelOf(key)}</>,
      value: [...unique.values()].reduce((a, b) => a + b, 0),
      color: DETECTOR_COLORS[key],
      detail: `${unique.size} evidence transactions`,
    };
  });

  const activity = useMemo(() => {
    if (!transactions?.length) return { columns: [], unit: "day" };
    const times = transactions.map((t) => parseTime(t.timestamp).getTime());
    const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
    const hourly = spanDays <= 2;
    const buckets = new Map<string, { evidence: number; other: number; amount: number }>();

    for (const tx of transactions) {
      const iso = parseTime(tx.timestamp).toISOString();
      const key = hourly ? iso.slice(0, 13) : iso.slice(0, 10);
      const b = buckets.get(key) ?? { evidence: 0, other: 0, amount: 0 };
      if (evidenceIds.has(tx.id)) b.evidence += 1;
      else b.other += 1;
      b.amount += tx.amount;
      buckets.set(key, b);
    }

    const columns = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, b]) => ({
      key,
      label: hourly ? `${key.slice(11, 13)}:00` : key.slice(5, 10),
      tooltip: `${hourly ? `${key.slice(0, 10)} ${key.slice(11, 13)}:00 UTC` : key} · ${b.evidence + b.other} transactions (${b.evidence} cited as evidence) · ${money(b.amount)}`,
      segments: [{ value: b.evidence, color: EVIDENCE_COLOR }, { value: b.other, color: OTHER_COLOR }],
    }));
    return { columns, unit: hourly ? "hour" : "day" };
  }, [transactions, evidenceIds]);

  // Investigation table ------------------------------------------------------
  const rank = { high: 2, medium: 1 } as const;
  const needle = query.trim().toLowerCase();
  const rows = alerts
    .filter((a) => !detector || a.detector === detector)
    .filter((a) => !severity || a.severity === severity)
    .filter((a) => !needle || a.id.toLowerCase().includes(needle) || a.accounts_involved.some((acc) => acc.toLowerCase().includes(needle)) || a.title.toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === "value" ? alertValue(b) - alertValue(a)
        : sort === "priority" ? rank[b.severity] - rank[a.severity] || b.first_detected_at.localeCompare(a.first_detected_at)
          : b.first_detected_at.localeCompare(a.first_detected_at));

  const highCount = alerts.filter((a) => a.severity === "high").length;
  const totalTx = transactions?.length ?? summary?.total_transactions ?? 0;

  return (
    <div className="analytics">
      <div className="analytics-head">
        <div>
          <h1>AML analytics</h1>
          <p className="muted small">
            Aggregates of the alerts and evidence served by the CASINOGUARD API
            {summary?.source?.kind === "databricks" ? " from Databricks" : ""}. Alerts are suspicious indicators, not proof of wrongdoing.
          </p>
        </div>
        <a className="button small" href="/api/export/alerts.csv">Export alerts CSV</a>
      </div>

      {error && <div className="banner" role="alert">Couldn't load analytics data: {error}</div>}

      <section className="tiles analytics-tiles" aria-label="AML summary">
        <Tile label="Total alerts" value={summary ? String(summary.total_alerts) : "–"} detail={`${highCount} high priority`} />
        <Tile label="Flagged accounts" value={summary ? String(summary.flagged_accounts) : "–"} detail={summary ? `of ${summary.total_accounts} known accounts` : ""} />
        <Tile label="Suspicious transaction value" value={loaded ? money(suspiciousValue) : "–"} detail="Distinct evidence transactions, each counted once" />
        <Tile label="Evidence transactions" value={loaded ? `${evidenceIds.size}` : "–"} detail={loaded && totalTx ? `${((evidenceIds.size / totalTx) * 100).toFixed(1)}% of ${totalTx.toLocaleString("en-US")} transactions` : ""} />
      </section>

      <div className="analytics-grid">
        <section className="panel">
          <div className="panel-header"><h2>Alerts by detection algorithm</h2><span className="panel-note">Click to filter the table</span></div>
          <div className="panel-body">
            <HBarChart data={patternBars} format={(v) => String(v)} selected={detector} onSelect={(k) => setDetector(detector === k ? null : (k as DetectorKey))} emptyText="No alerts yet." />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><h2>Suspicious amounts by algorithm</h2><span className="panel-note">Evidence transaction value</span></div>
          <div className="panel-body">
            {loaded ? (
              <HBarChart data={valueBars} format={compactMoney} selected={detector} onSelect={(k) => setDetector(detector === k ? null : (k as DetectorKey))} emptyText="No evidence transactions." />
            ) : <p className="chart-empty">Loading evidence…</p>}
          </div>
        </section>

        <section className="panel analytics-wide">
          <div className="panel-header"><h2>Transaction activity</h2><span className="panel-note">Transactions per {activity.unit} (UTC)</span></div>
          <div className="panel-body">
            {transactions ? (
              <StackedColumnChart
                data={activity.columns}
                format={(v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
                legend={[{ label: "Cited as alert evidence", color: EVIDENCE_COLOR }, { label: "Other transactions", color: OTHER_COLOR }]}
                emptyText="No transactions."
              />
            ) : <p className="chart-empty">Loading transactions…</p>}
          </div>
        </section>
      </div>

      <section className="panel analytics-table-panel">
        <div className="panel-header">
          <h2>Investigation table</h2>
          <div className="table-controls">
            <input type="search" placeholder="Search alert or account…" aria-label="Search alerts" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="segmented" role="group" aria-label="Filter by priority">
              {([null, "high", "medium"] as const).map((v) => (
                <button key={v ?? "all"} className={severity === v ? "active" : ""} aria-pressed={severity === v} onClick={() => setSeverity(v)}>
                  {v === null ? "All" : v === "high" ? "High" : "Medium"}
                </button>
              ))}
            </div>
            <label className="sort-select">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="detected">Newest</option>
                <option value="value">Evidence value</option>
                <option value="priority">Priority</option>
              </select>
            </label>
            {detector && <button className="link-button" onClick={() => setDetector(null)}>Clear {labelOf(detector)} filter</button>}
          </div>
        </div>

        <div className="table-scroll">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Algorithm</th>
                <th>Accounts</th>
                <th>Evidence</th>
                <th>Thresholds</th>
                <th className="numeric">Evidence value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((alert) => {
                const inv = investigations[alert.id];
                const open = expanded === alert.id;
                const txs = evidence.get(alert.id) ?? [];
                return (
                  <Fragment key={alert.id}>
                    <tr className={open ? "expanded" : ""}>
                      <td>
                        <div className="mono strong" title={alert.id}>{shortId(alert.id)}</div>
                        <SeverityBadge severity={alert.severity} />
                        <div className="muted small">{dateTime(alert.first_detected_at)} UTC</div>
                      </td>
                      <td><span className="alert-detector"><DetectorIcon detector={alert.detector} size={14} />{alert.detector_label}</span></td>
                      <td className="mono small accounts-cell">{alert.accounts_involved.join(", ")}</td>
                      <td className="evidence-cell">
                        <div>{alert.summary}</div>
                        {inv && (
                          <div className="chips">
                            {inv.why_flagged.map((r, i) => (
                              <span key={i} className={`chip ${r.met ? "" : "chip-fail"}`} title={r.label}>
                                {r.met ? "✓" : "✕"} {r.label}: {formatObserved(r.observed, r.unit)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="small threshold-cell">
                        {inv ? inv.why_flagged.map((r, i) => (
                          <div key={i}>{r.label} {r.comparator === ">=" ? "≥" : "≤"} {formatObserved(r.threshold, r.unit)}</div>
                        )) : <span className="muted">Loading…</span>}
                      </td>
                      <td className="numeric mono">{inv ? money(alertValue(alert)) : "–"}<div className="muted small">{txs.length} txns</div></td>
                      <td className="actions-cell">
                        <button className="button small" onClick={() => setExpanded(open ? null : alert.id)} aria-expanded={open}>{open ? "Hide" : "Evidence"}</button>
                        <button className="button small" onClick={() => onOpenAlert(alert.id)}>Investigate</button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={7}>
                          <div className="detail-grid">
                            <div>
                              <h3>Evidence transactions ({txs.length})</h3>
                              {txs.length ? (
                                <table className="stream-table">
                                  <thead><tr><th>Time (UTC)</th><th>ID</th><th>Flow</th><th>Type</th><th className="numeric">Amount</th></tr></thead>
                                  <tbody>{txs.map((t) => (
                                    <tr key={t.id}><td className="mono muted">{dateTime(t.timestamp)}</td><td className="mono">{t.id}</td><td className="mono">{t.from} → {t.to}</td><td className="capitalize">{t.type}</td><td className="mono numeric">{money(t.amount)}</td></tr>
                                  ))}</tbody>
                                </table>
                              ) : <p className="muted small">No transactions are listed for this alert.</p>}
                            </div>
                            <div>
                              <h3>Detector output</h3>
                              <pre className="raw-json">{inv ? JSON.stringify(inv.detector_output, null, 2) : "Loading…"}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="empty">{alerts.length ? "No alerts match these filters." : "No alerts yet."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-detail">{detail}</div>
    </div>
  );
}
