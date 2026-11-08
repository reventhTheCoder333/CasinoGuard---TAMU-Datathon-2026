import type { ConnectionState, Summary } from "../types";

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
};

export function TopBar({ connection, summary }: { connection: ConnectionState; summary: Summary | null }) {
  const synthetic = (summary?.data_classification ?? "synthetic") === "synthetic";
  const fromDatabricks = summary?.source?.kind === "databricks";

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#3987e5" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" />
          <path fill="none" stroke="#0b0e14" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
        <span className="wordmark">CASINOGUARD</span>
        <span className="brand-sub">Financial intelligence</span>
      </div>

      <p className="topbar-note">Alerts are suspicious indicators, not proof of wrongdoing.</p>

      <div className="topbar-status">
        {fromDatabricks && (
          <span className="source-badge" title="Detection results are read from Databricks">
            Source: Databricks
          </span>
        )}
        {synthetic && (
          <span className="synthetic-badge" title="The records are generated. None describe real people or transactions.">
            Synthetic data
          </span>
        )}
        <span className={`connection connection-${connection}`} role="status">
          <span className="connection-dot" aria-hidden="true" />
          {CONNECTION_LABELS[connection]}
        </span>
      </div>
    </header>
  );
}
