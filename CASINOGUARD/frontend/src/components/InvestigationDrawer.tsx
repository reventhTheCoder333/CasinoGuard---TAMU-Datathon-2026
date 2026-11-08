import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DETECTOR_COLORS, DetectorIcon, SeverityBadge } from "../detectors";
import { dateTime, formatObserved, money } from "../format";
import { shortId } from "../state";
import type { Alert, Investigation } from "../types";

const FIELD_LABELS: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  payment_card: "Payment card",
};

interface Props {
  alert: Alert;
  onClose: () => void;
  onOpenAlert: (id: string) => void;
}

export function InvestigationDrawer({ alert, onClose, onOpenAlert }: Props) {
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);

  // Refetch whenever the detectors change this alert's evidence.
  useEffect(() => {
    let cancelled = false;

    api
      .investigation(alert.id)
      .then((data) => {
        if (!cancelled) {
          setInvestigation(data);
          setError(null);
        }
      })
      .catch((failure) => {
        if (!cancelled) setError(failure.message);
      });

    return () => {
      cancelled = true;
    };
  }, [alert.id, alert.revision]);

  useEffect(() => {
    closeButton.current?.focus();
    scrollArea.current?.scrollTo({ top: 0 });
  }, [alert.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = investigation?.alert.id === alert.id ? investigation : null;

  return (
    <aside className="drawer" role="dialog" aria-label={`Investigation of alert ${alert.id}`}>
      <div className="drawer-header">
        <div className="drawer-kicker">
          <span className="mono" title={alert.id}>{shortId(alert.id)}</span>
          {alert.source === "databricks" && <span className="source-tag-pill">Databricks</span>}
          {(data?.data_classification ?? "synthetic") === "synthetic" && <span className="synthetic-tag">Synthetic</span>}
          <button ref={closeButton} className="icon-button" aria-label="Close investigation" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <h2>{alert.title}</h2>
        <div className="drawer-tags">
          <SeverityBadge severity={alert.severity} />
          <span className="alert-detector">
            <DetectorIcon detector={alert.detector} size={14} />
            {alert.detector_label}
          </span>
        </div>
      </div>

      <div className="drawer-body" ref={scrollArea}>
        <p className="drawer-summary">{alert.summary}</p>

        {error && !data && <p className="run-error" role="alert">Couldn't load the investigation: {error}</p>}
        <p className="disclaimer">
          <strong>Indicator, not proof.</strong> Automated detection can't establish intent or wrongdoing. A qualified
          analyst must review this before any action is taken.
        </p>

        {!data && !error && <p className="muted">Loading investigation…</p>}

        {data && (
          <>
            <section>
              <h3>Why this was flagged</h3>
              {data.why_flagged.some((rule) => !rule.met) && (
                <p className="run-error">
                  Not every condition below is met by the evidence. Check this alert in the upstream pipeline.
                </p>
              )}
              <table className="rule-table">
                <thead>
                  <tr>
                    <th>Condition</th>
                    <th className="numeric">Observed</th>
                    <th className="numeric">Limit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.why_flagged.map((rule, index) => (
                    <tr key={`${rule.label}-${index}`}>
                      <td>
                        <span className={rule.met ? "rule-met" : "rule-unmet"}>{rule.met ? "✓" : "✕"}</span> {rule.label}
                      </td>
                      <td className="mono numeric">{formatObserved(rule.observed, rule.unit)}</td>
                      <td className="mono numeric muted">
                        {rule.comparator === ">=" ? "≥" : "≤"} {formatObserved(rule.threshold, rule.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.detector_notes.map((note) => (
                <p className="note" key={note}>
                  {note}
                </p>
              ))}
              <p className="note">
                <strong>Priority:</strong> {alert.severity_reason} This sets review order and isn't a measure of guilt.
              </p>
            </section>

            {alert.shared_identifiers && alert.shared_identifiers.length > 0 && (
              <section>
                <h3>Shared identifiers</h3>
                <ul className="identifier-list">
                  {alert.shared_identifiers.map((shared) => (
                    <li key={`${shared.field}-${shared.value}`}>
                      <span>
                        <span className="muted">{FIELD_LABELS[shared.field] ?? shared.field}</span>{" "}
                        <span className="mono">{shared.value}</span>
                      </span>
                      <span className="mono muted">{shared.accounts.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3>Transaction timeline</h3>
              {data.timeline.length === 0 ? (
                <p className="muted">These accounts have no recorded transactions.</p>
              ) : (
                <ol className="timeline" style={{ "--timeline-color": DETECTOR_COLORS[alert.detector] } as React.CSSProperties}>
                  {data.timeline.map((tx) => (
                    <li key={tx.id}>
                      <div className="timeline-top">
                        <span className="mono">
                          {tx.from} <span className="muted">→</span> {tx.to}
                        </span>
                        <span className="mono timeline-amount">{money(tx.amount)}</span>
                      </div>
                      <div className="timeline-meta">
                        <span className="mono">{dateTime(tx.timestamp)} UTC</span>
                        <span className="capitalize">{tx.type}</span>
                        <span className="mono">{tx.id}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section>
              <h3>Accounts involved</h3>
              <div className="account-cards">
                {data.accounts.map((account) => (
                  <div className="account-card" key={account.account}>
                    <div className="mono account-name">{account.account}</div>
                    <dl>
                      <div>
                        <dt>Transactions</dt>
                        <dd className="mono">{account.transaction_count}</dd>
                      </div>
                      <div>
                        <dt>Sent</dt>
                        <dd className="mono">{money(account.total_sent)}</dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd className="mono">{money(account.total_received)}</dd>
                      </div>
                    </dl>
                    {account.other_alerts.length > 0 && (
                      <div className="other-alerts">
                        <span className="muted">Also in:</span>
                        {account.other_alerts.map((other) => (
                          <button key={other.id} className="link-button" onClick={() => onOpenAlert(other.id)}>
                            {other.id}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Possible innocent explanations</h3>
              <ul className="plain-list">
                {data.alternative_explanations.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </section>

            <section>
              <h3>Suggested next steps</h3>
              <ol className="plain-list numbered">
                {data.recommended_steps.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ol>
            </section>

            <section>
              <details className="raw-output">
                <summary>Raw detector output</summary>
                <pre>{JSON.stringify(data.detector_output, null, 2)}</pre>
              </details>
              {data.data_source && (
                <p className="note">
                  Source: <span className="mono">{data.data_source.table}</span>, alert ID{" "}
                  <span className="mono">{data.data_source.alert_id}</span>
                </p>
              )}
              <p className="note">
                First detected {dateTime(alert.first_detected_at)} UTC · last updated {dateTime(alert.last_updated_at)} UTC
                · revision {alert.revision}
              </p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
