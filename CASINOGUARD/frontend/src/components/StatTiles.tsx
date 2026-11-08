import { money } from "../format";
import type { Summary } from "../types";

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-detail">{detail}</div>
    </div>
  );
}

export function StatTiles({ summary }: { summary: Summary | null }) {
  const placeholder = "–";
  const fromDatabricks = summary?.source?.kind === "databricks";
  const synthetic = (summary?.data_classification ?? "synthetic") === "synthetic";

  return (
    <section className="tiles" aria-label="Summary">
      <Tile
        label={fromDatabricks ? "Alerts from Databricks" : "Open alerts"}
        value={summary ? String(summary.total_alerts) : placeholder}
        detail={summary ? `${summary.high_priority_alerts} high priority` : ""}
      />
      <Tile
        label="Flagged accounts"
        value={summary ? String(summary.flagged_accounts) : placeholder}
        detail={summary ? `of ${summary.total_accounts} known accounts` : ""}
      />
      <Tile
        label="Transactions analysed"
        value={summary ? summary.total_transactions.toLocaleString("en-US") : placeholder}
        detail={fromDatabricks ? "Loaded from Databricks" : "Six detectors run on each one"}
      />
      <Tile
        label={synthetic ? "Synthetic volume" : "Transaction volume"}
        value={summary ? money(summary.total_volume) : placeholder}
        detail={synthetic ? "Sum of all generated amounts" : "Sum of all transaction amounts"}
      />
    </section>
  );
}
