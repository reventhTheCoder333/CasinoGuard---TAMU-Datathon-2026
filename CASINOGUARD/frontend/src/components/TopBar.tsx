import type { ConnectionState, Summary } from "../types";

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
};

export type View = "console" | "analytics" | "databricks";

const VIEW_LABELS: Record<View, string> = {
  console: "Live console",
  analytics: "AML analytics",
  databricks: "Databricks dashboard",
};

export function TopBar({
  connection,
  summary,
  view,
  onViewChange,
}: {
  connection: ConnectionState;
  summary: Summary | null;
  view: View;
  onViewChange: (view: View) => void;
}) {
  const synthetic = (summary?.data_classification ?? "synthetic") === "synthetic";
  const fromDatabricks = summary?.source?.kind === "databricks";

  return (
    <header className="topbar">
      <div className="brand">
        {/* Dashboard Royale's logo asset (public/favicon.svg), shared by both apps */}
        <img src="./favicon.svg" width={30} height={30} alt="" />
        <div className="brand-text">
          <span className="brand-name">CASINOGUARD</span>
          <span className="brand-sub">AML intelligence · The Gilded Ace</span>
        </div>
      </div>

      <nav className="segmented view-switch" aria-label="Pages">
        {(["console", "analytics", "databricks"] as const).map((v) => (
          <button key={v} className={view === v ? "active" : ""} aria-current={view === v ? "page" : undefined} onClick={() => onViewChange(v)}>
            {VIEW_LABELS[v]}
          </button>
        ))}
      </nav>

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
