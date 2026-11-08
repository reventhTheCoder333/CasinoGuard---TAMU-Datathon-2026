import { clockTime, money, shortDate } from "../format";
import type { Transaction } from "../types";

const SOURCE_LABELS: Record<Transaction["source"], string> = {
  seed: "Seed",
  simulator: "Simulated",
  api: "API",
  databricks: "Databricks",
};

interface Props {
  transactions: Transaction[];
  flagged: Set<string>;
  fresh: Set<string>;
  total: number;
}

export function TransactionStream({ transactions, flagged, fresh, total }: Props) {
  return (
    <section className="panel stream-panel" aria-label="Transaction stream">
      <div className="panel-header">
        <h2>Transaction stream</h2>
        <span className="panel-note">
          Latest {transactions.length} of {total.toLocaleString("en-US")} · times in UTC
        </span>
      </div>

      <div className="table-scroll" tabIndex={0}>
        <table className="stream-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>ID</th>
              <th>Flow</th>
              <th>Type</th>
              <th className="numeric">Amount</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className={fresh.has(tx.id) ? "fresh-row" : ""}>
                <td className="mono muted nowrap">
                  {shortDate(tx.timestamp)} {clockTime(tx.timestamp)}
                </td>
                <td className="mono nowrap">
                  {tx.id}
                  {flagged.has(tx.id) && (
                    <span className="flag-mark" title="Evidence in an alert">
                      Flagged
                    </span>
                  )}
                </td>
                <td className="mono nowrap">
                  {tx.from} <span className="muted">→</span> {tx.to}
                </td>
                <td className="capitalize">{tx.type}</td>
                <td className="mono numeric">{money(tx.amount)}</td>
                <td>
                  <span className={`source-tag source-${tx.source}`}>{SOURCE_LABELS[tx.source]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
