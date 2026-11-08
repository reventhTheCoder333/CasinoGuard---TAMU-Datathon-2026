import type { Alert, GraphEdge, GraphPayload, GraphState, Transaction } from "./types";

export const MAX_STREAM_ROWS = 80;

/** Add or replace an alert. An older copy never overwrites a newer one. */
export function upsertAlert(alerts: Alert[], incoming: Alert): Alert[] {
  const existing = alerts.find((alert) => alert.id === incoming.id);

  if (existing && existing.revision > incoming.revision) {
    return alerts;
  }

  const merged = new Set(incoming.merged_alert_ids);

  return [
    incoming,
    ...alerts.filter((alert) => alert.id !== incoming.id && !merged.has(alert.id)),
  ].sort(newestFirst);
}

/** Newest detection first; IDs break ties (local IDs are sequential). */
export function newestFirst(a: Alert, b: Alert): number {
  return (b.first_detected_at ?? "").localeCompare(a.first_detected_at ?? "") || b.id.localeCompare(a.id);
}

/** Databricks alert IDs are 64-character hashes; show a short reference. */
export function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

export function addTransaction(rows: Transaction[], incoming: Transaction): Transaction[] {
  if (rows.some((row) => row.id === incoming.id)) {
    return rows;
  }
  return [incoming, ...rows].slice(0, MAX_STREAM_ROWS);
}

/** IDs of every transaction named as evidence by the given alerts. */
export function flaggedTransactionIds(alerts: Alert[]): Set<string> {
  const ids = new Set<string>();

  for (const alert of alerts) {
    alert.transaction_ids?.forEach((id) => ids.add(id));
    alert.withdrawal_ids?.forEach((id) => ids.add(id));
    if (alert.deposit_id) ids.add(alert.deposit_id);
  }

  return ids;
}

/**
 * Merge new graph data while keeping existing objects, because the force
 * layout stores positions on them. `version` only changes for structural
 * changes, so ordinary updates do not make the layout jump.
 */
export function mergeGraph(previous: GraphState | null, next: GraphPayload): GraphState {
  const oldNodes = new Map(previous?.nodes.map((node) => [node.id, node]));
  const oldEdges = new Map(previous?.edges.map((edge) => [edge.id, edge]));

  const nodes = next.nodes.map((node) => {
    const existing = oldNodes.get(node.id);
    return existing ? Object.assign(existing, node) : node;
  });

  const edges = next.edges.map((edge) => {
    const existing = oldEdges.get(edge.id);

    if (!existing) return edge;

    const { source: _source, target: _target, ...fields } = edge;
    return Object.assign(existing, fields) as GraphEdge;
  });

  const changed =
    !previous ||
    nodes.length !== previous.nodes.length ||
    edges.length !== previous.edges.length ||
    nodes.some((node) => !oldNodes.has(node.id)) ||
    edges.some((edge) => !oldEdges.has(edge.id));

  return { nodes, edges, version: (previous?.version ?? 0) + (changed ? 1 : 0) };
}

export function edgeEndpoint(end: GraphEdge["source"]): string {
  return typeof end === "string" ? end : end.id;
}
