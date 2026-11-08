import type { DetectorKey, Severity } from "./types";

/**
 * Fixed detector order and colours, validated with the palette checker against
 * the panel surface. Colour always comes with an icon or a label.
 */
export const DETECTOR_ORDER: DetectorKey[] = [
  "transaction_chains",
  "transaction_structuring",
  "rapid_cashouts",
  "unusual_volume",
  "circular_transactions",
  "multiple_accounts",
];

export const DETECTOR_COLORS: Record<DetectorKey, string> = {
  transaction_chains: "#3987e5",
  transaction_structuring: "#d95926",
  rapid_cashouts: "#199e70",
  unusual_volume: "#c98500",
  circular_transactions: "#d55181",
  multiple_accounts: "#9085e9",
};

const ICONS: Record<DetectorKey, string> = {
  transaction_chains: "M3 12h4m4 0h4m4 0h2M7 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0m8 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  transaction_structuring: "M4 20V14m5 6V10m5 10V14m5 6V8M3 5h18",
  rapid_cashouts: "M12 3v12m0 0-4-4m4 4 4-4M5 20h14",
  unusual_volume: "M3 17l5-3 3 2 4-10 3 6h3",
  circular_transactions: "M20 12a8 8 0 1 1-2.6-5.9M20 3v4h-4",
  multiple_accounts: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-5 6-5s6 1.7 6 5m1-9a3 3 0 0 0 0-6m2 15h3c0-2.7-1.6-4.2-4-4.8",
};

export function DetectorIcon({ detector, size = 16 }: { detector: DetectorKey; size?: number }) {
  return (
    <svg
      className="detector-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={DETECTOR_COLORS[detector]}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[detector]} />
    </svg>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`severity severity-${severity}`}>
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
        {severity === "high" ? (
          <path d="M6 1 11.5 11H.5z" fill="currentColor" />
        ) : (
          <circle cx="6" cy="6" r="4.5" fill="currentColor" />
        )}
      </svg>
      {severity === "high" ? "High priority" : "Medium priority"}
    </span>
  );
}
