export function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function compactMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${(value / 1000).toFixed(1)}k`;
  return money(value);
}

/** Timestamps from the API are UTC; naive values are UTC as well. */
export function parseTime(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

export function clockTime(value: string): string {
  return parseTime(value).toISOString().slice(11, 19);
}

export function dateTime(value: string): string {
  const iso = parseTime(value).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

export function shortDate(value: string): string {
  return parseTime(value).toISOString().slice(5, 10);
}

export function relativeTime(value: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - parseTime(value).getTime()) / 1000));

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function formatObserved(value: number, unit: string): string {
  if (unit === "$") return money(value);
  const number = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return unit ? `${number} ${unit}` : number;
}
