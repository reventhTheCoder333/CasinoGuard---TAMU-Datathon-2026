import { describe, expect, it } from "vitest";
import { addTransaction, flaggedTransactionIds, MAX_STREAM_ROWS, mergeGraph, shortId, upsertAlert } from "./state";
import type { Alert, GraphEdge, GraphNode, GraphPayload, Transaction } from "./types";

const alert = (id: string, revision = 1, extra: Partial<Alert> = {}) =>
  ({ id, revision, merged_alert_ids: [], ...extra }) as Alert;

const node = (id: string, volume = 1) => ({ id, volume }) as GraphNode;
const edge = (id: string, source: string, target: string, total_amount = 1) =>
  ({ id, source, target, total_amount }) as GraphEdge;

describe("upsertAlert", () => {
  it("adds new alerts, newest first", () => {
    const list = upsertAlert([alert("CG-0001")], alert("CG-0002"));
    expect(list.map((a) => a.id)).toEqual(["CG-0002", "CG-0001"]);
  });

  it("replaces an alert with a newer revision", () => {
    const list = upsertAlert([alert("CG-0001", 1)], alert("CG-0001", 2));
    expect(list).toHaveLength(1);
    expect(list[0].revision).toBe(2);
  });

  it("ignores a stale revision", () => {
    const list = upsertAlert([alert("CG-0001", 3)], alert("CG-0001", 2));
    expect(list[0].revision).toBe(3);
  });

  it("removes alerts merged into the incoming one", () => {
    const list = upsertAlert(
      [alert("CG-0002"), alert("CG-0001")],
      alert("CG-0001", 2, { merged_alert_ids: ["CG-0002"] }),
    );
    expect(list.map((a) => a.id)).toEqual(["CG-0001"]);
  });
});

describe("addTransaction", () => {
  const tx = (id: string) => ({ id }) as Transaction;

  it("ignores duplicates", () => {
    expect(addTransaction([tx("a")], tx("a"))).toHaveLength(1);
  });

  it("caps the number of rows", () => {
    let rows: Transaction[] = [];
    for (let i = 0; i < MAX_STREAM_ROWS + 5; i++) rows = addTransaction(rows, tx(`t${i}`));
    expect(rows).toHaveLength(MAX_STREAM_ROWS);
    expect(rows[0].id).toBe(`t${MAX_STREAM_ROWS + 4}`);
  });
});

describe("flaggedTransactionIds", () => {
  it("collects evidence from every alert shape", () => {
    const ids = flaggedTransactionIds([
      alert("a", 1, { transaction_ids: ["t1"] }),
      alert("b", 1, { deposit_id: "t2", withdrawal_ids: ["t3"] }),
    ]);
    expect([...ids].sort()).toEqual(["t1", "t2", "t3"]);
  });
});

describe("mergeGraph", () => {
  const first: GraphPayload = { nodes: [node("A"), node("B")], edges: [edge("A->B", "A", "B")] };

  it("keeps layout positions and version on ordinary updates", () => {
    const state = mergeGraph(null, first);
    state.nodes[0].x = 42;
    // The layout library swaps ids for node objects.
    state.edges[0].source = state.nodes[0];

    const next = mergeGraph(state, {
      nodes: [node("A", 99), node("B")],
      edges: [edge("A->B", "A", "B", 500)],
    });

    expect(next.version).toBe(state.version);
    expect(next.nodes[0].x).toBe(42);
    expect(next.nodes[0].volume).toBe(99);
    expect(next.edges[0].total_amount).toBe(500);
    expect(next.edges[0].source).toBe(state.nodes[0]);
  });

  it("changes version when the structure changes", () => {
    const state = mergeGraph(null, first);
    const grown = mergeGraph(state, {
      nodes: [...first.nodes, node("C")],
      edges: first.edges,
    });
    expect(grown.version).toBe(state.version + 1);
  });

  it("changes version when a same-sized graph has different members", () => {
    const state = mergeGraph(null, first);
    const swapped = mergeGraph(state, { nodes: [node("X"), node("Y")], edges: [edge("X->Y", "X", "Y")] });
    expect(swapped.version).toBe(state.version + 1);
  });
});

describe("Databricks alerts", () => {
  it("orders by detection time, not by hash ID", () => {
    const older = alert("ffff", 1, { first_detected_at: "2026-11-07T10:00:00+00:00" });
    const newer = alert("0000", 1, { first_detected_at: "2026-11-07T11:00:00+00:00" });
    expect(upsertAlert([older], newer).map((a) => a.id)).toEqual(["0000", "ffff"]);
  });

  it("shortens hash IDs only", () => {
    expect(shortId("a".repeat(64))).toBe("aaaaaaaa");
    expect(shortId("CG-0007")).toBe("CG-0007");
  });
});
