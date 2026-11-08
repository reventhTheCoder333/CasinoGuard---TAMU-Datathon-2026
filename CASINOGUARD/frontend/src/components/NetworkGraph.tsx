import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, MutableRefObject } from "react";
import { forceX, forceY } from "d3-force";
import ForceGraph2D from "react-force-graph-2d";
import { DETECTOR_COLORS, DetectorIcon, SeverityBadge } from "../detectors";
import { compactMoney, money } from "../format";
import { edgeEndpoint, shortId } from "../state";
import type { Alert, GraphEdge, GraphNode, GraphState } from "../types";
import type { Pulse } from "../useLiveData";

interface ForceHandle {
  zoomToFit: (ms?: number, padding?: number) => void;
  centerAt: (x: number, y: number, ms?: number) => void;
  zoom: (k: number, ms?: number) => void;
  emitParticle: (link: GraphEdge) => void;
  d3Force: {
    (name: string): { strength?: (v: number) => void; distance?: (f: (l: GraphEdge) => number) => void } | undefined;
    (name: string, force: unknown): void;
  };
  d3ReheatSimulation: () => void;
}

// The library's generic props are not needed by this one call site.
const ForceGraph = ForceGraph2D as unknown as ComponentType<Record<string, unknown>>;

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

interface Props {
  graph: GraphState | null;
  alerts: Alert[];
  selectedAlert: Alert | null;
  freshAlerts: Record<string, number>;
  pulses: Pulse[];
  onOpenAlert: (id: string) => void;
  onClearAlert: () => void;
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function nodeRadius(node: GraphNode): number {
  if (node.kind === "house") return node.id === "CASINO" ? 9 : 4.5;
  return 3 + Math.min(4, Math.log10(node.volume + 1) * 0.85);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function NetworkGraph({ graph, alerts, selectedAlert, freshAlerts, pulses, onOpenAlert, onClearAlert }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const forceRef = useRef<ForceHandle | undefined>(undefined) as MutableRefObject<ForceHandle | undefined>;
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [hideHouse, setHideHouse] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [search, setSearch] = useState("");
  const [searchMissed, setSearchMissed] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container.current);

    return () => observer.disconnect();
  }, []);

  // Runs once the graph has data, when the library has created its forces.
  useEffect(() => {
    const force = forceRef.current;
    if (!force) return;

    // Gentle gravity keeps unconnected clusters on screen and easy to compare.
    force.d3Force("x", forceX(0).strength(0.07));
    force.d3Force("y", forceY(0).strength(0.09));
    force.d3Force("charge")?.strength?.(-130);
    force.d3Force("link")?.distance?.((edge) => {
      if (edge.kind === "identity") return 26;
      const touchesHouse = [edge.source, edge.target].some(
        (end) => typeof end !== "string" && end.kind === "house",
      );
      return touchesHouse ? 58 : 40;
    });
    force.d3ReheatSimulation();
  }, [Boolean(graph)]);

  const version = graph?.version ?? 0;

  // Structural changes only: new arrays restart the layout.
  const data = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };

    const nodes = graph.nodes.filter(
      (node) => !(hideHouse && node.kind === "house") && !(flaggedOnly && node.alert_ids.length === 0 && node.kind !== "house"),
    );
    const ids = new Set(nodes.map((node) => node.id));
    const links = graph.edges.filter(
      (edge) =>
        ids.has(edgeEndpoint(edge.source)) &&
        ids.has(edgeEndpoint(edge.target)) &&
        (!flaggedOnly || edge.alert_ids.length > 0),
    );

    // In flagged-only view, keep a cage or casino only if a flagged edge uses it.
    const used = new Set(links.flatMap((edge) => [edgeEndpoint(edge.source), edgeEndpoint(edge.target)]));

    return {
      nodes: nodes.filter((node) => !flaggedOnly || node.kind !== "house" || used.has(node.id)),
      links,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, hideHouse, flaggedOnly]);

  // Refit shortly after filters change the layout.
  useEffect(() => {
    if (!data.nodes.length) return;

    const timer = window.setTimeout(() => forceRef.current?.zoomToFit(500, 56), fitted.current ? 900 : 1400);
    fitted.current = true;

    return () => window.clearTimeout(timer);
  }, [data.nodes.length, hideHouse, flaggedOnly, size.width, size.height]);

  // Animate money moving along edges that just received a transaction.
  useEffect(() => {
    if (reducedMotion) return;

    for (const pulse of pulses) {
      const link = data.links.find((edge) => edge.id === pulse.edgeId);
      if (link && typeof link.source !== "string") forceRef.current?.emitParticle(link);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulses]);

  // Everything connected to the alert under investigation stays bright.
  const highlight = useMemo(() => {
    if (!selectedAlert || !graph) return null;

    const nodes = new Set(selectedAlert.accounts_involved);
    const edges = new Set<string>();

    for (const edge of graph.edges) {
      if (edge.alert_ids.includes(selectedAlert.id)) {
        edges.add(edge.id);
        nodes.add(edgeEndpoint(edge.source));
        nodes.add(edgeEndpoint(edge.target));
      }
    }

    return { nodes, edges };
  }, [selectedAlert, graph]);

  // Bring the alert's accounts into view when it is selected.
  useEffect(() => {
    if (!highlight || !graph) return;

    const members = graph.nodes.filter((node) => highlight.nodes.has(node.id) && node.x !== undefined);
    if (!members.length) return;

    const x = members.reduce((sum, node) => sum + node.x!, 0) / members.length;
    const y = members.reduce((sum, node) => sum + node.y!, 0) / members.length;

    forceRef.current?.centerAt(x, y, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlert?.id]);

  const freshAccounts = useMemo(() => {
    const started = new Map<string, number>();

    for (const alert of alerts) {
      const startedAt = freshAlerts[alert.id];
      if (startedAt !== undefined) {
        alert.accounts_involved.forEach((account) => started.set(account, startedAt));
      }
    }

    return started;
  }, [alerts, freshAlerts]);

  const edgeColorOf = useCallback(
    (edge: GraphEdge) => {
      const dimmed = highlight && !highlight.edges.has(edge.id);

      if (dimmed) return "rgba(255,255,255,0.03)";
      if (edge.kind === "identity") return DETECTOR_COLORS.multiple_accounts;

      if (edge.alert_ids.length > 0) {
        const alert = alerts.find((candidate) => edge.alert_ids.includes(candidate.id));
        if (alert) return DETECTOR_COLORS[alert.detector];
      }

      return "rgba(190,200,215,0.17)";
    },
    [alerts, highlight],
  );

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = nodeRadius(node);
      const flagged = node.alert_ids.length > 0;
      const dimmed = highlight && !highlight.nodes.has(node.id);
      const isSelected = selection?.kind === "node" && selection.id === node.id;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.14 : 1;

      // Expanding rings mark accounts in a brand-new alert.
      const startedAt = freshAccounts.get(node.id);
      if (startedAt !== undefined && !reducedMotion) {
        const phase = ((performance.now() - startedAt) % 1500) / 1500;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2 + phase * 14, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(250,178,25,${0.75 * (1 - phase)})`;
        ctx.lineWidth = 1.4 / Math.max(scale, 0.6);
        ctx.stroke();
      }

      if (node.kind === "house") {
        const side = radius * 1.8;
        ctx.beginPath();
        ctx.roundRect(x - side / 2, y - side / 2, side, side, radius * 0.35);
        ctx.fillStyle = "#232a36";
        ctx.fill();
        ctx.lineWidth = 1 / Math.max(scale, 0.6);
        ctx.strokeStyle = "#6d7889";
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = flagged ? "#10141c" : "#4a5566";
        ctx.fill();

        // One ring segment per detector that flagged this account.
        if (flagged) {
          const segments = node.detectors.length;
          const gap = segments > 1 ? 0.28 : 0;
          const arc = (2 * Math.PI) / segments;

          node.detectors.forEach((detector, index) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, -Math.PI / 2 + index * arc + gap / 2, -Math.PI / 2 + (index + 1) * arc - gap / 2);
            ctx.strokeStyle = DETECTOR_COLORS[detector];
            ctx.lineWidth = 2.2;
            ctx.stroke();
          });

          ctx.beginPath();
          ctx.arc(x, y, radius * 0.42, 0, 2 * Math.PI);
          ctx.fillStyle = DETECTOR_COLORS[node.detectors[0]];
          ctx.fill();
        }
      }

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = "#f0efec";
        ctx.lineWidth = 1.2 / Math.max(scale, 0.6);
        ctx.stroke();
      }

      const wantsLabel =
        node.kind === "house" ? node.id === "CASINO" || scale > 1.4 : flagged || scale > 1.6 || isSelected;

      if (wantsLabel && !dimmed) {
        const fontSize = Math.max(9.5 / scale, 2.2);
        ctx.font = `500 ${fontSize}px "JetBrains Mono Variable", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = flagged || highlight ? "#d9dce3" : "#8a93a3";
        ctx.fillText(scale < 1.8 ? node.id.replace(/^SIM\d+_/, "") : node.id, x, y + radius + 2.5);
      }

      ctx.restore();
    },
    [freshAccounts, highlight, selection],
  );

  const paintHitArea = useCallback((node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node) + 3, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const runSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim().toLowerCase();
    const match = graph?.nodes.find((node) => node.id.toLowerCase() === query)
      ?? graph?.nodes.find((node) => node.id.toLowerCase().includes(query));

    if (!query || !match || match.x === undefined) {
      setSearchMissed(Boolean(query));
      return;
    }

    setSearchMissed(false);
    setSelection({ kind: "node", id: match.id });
    forceRef.current?.centerAt(match.x, match.y!, 500);
    forceRef.current?.zoom(3, 500);
  };

  const selectedNode = selection?.kind === "node" ? graph?.nodes.find((node) => node.id === selection.id) : null;
  const selectedEdge = selection?.kind === "edge" ? graph?.edges.find((edge) => edge.id === selection.id) : null;

  const relatedAlerts = (ids: string[]) => alerts.filter((alert) => ids.includes(alert.id));

  return (
    <section className="panel graph-panel" aria-label="Transaction network graph">
      <div className="panel-header">
        <h2>Transaction network</h2>
        <div className="graph-controls">
          <form onSubmit={runSearch} role="search" className={searchMissed ? "search-missed" : ""}>
            <input
              type="search"
              placeholder="Find account…"
              aria-label="Find account"
              list="graph-accounts"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchMissed(false);
              }}
            />
            <datalist id="graph-accounts">
              {graph?.nodes.map((node) => <option key={node.id} value={node.id} />)}
            </datalist>
          </form>
          <label className="check">
            <input type="checkbox" checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} />
            Flagged only
          </label>
          <label className="check">
            <input type="checkbox" checked={hideHouse} onChange={(event) => setHideHouse(event.target.checked)} />
            Hide casino
          </label>
          <button className="button small" onClick={() => forceRef.current?.zoomToFit(400, 56)}>
            Fit
          </button>
        </div>
      </div>

      <div className="graph-canvas" ref={container}>
        <ForceGraph
          ref={forceRef}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintHitArea}
          nodeLabel={(node: GraphNode) =>
            `<div class="graph-tooltip"><b>${escapeHtml(node.id)}</b><br/>${node.transaction_count} transactions · ${compactMoney(node.volume)}</div>`
          }
          linkLabel={(edge: GraphEdge) =>
            edge.kind === "identity"
              ? `<div class="graph-tooltip">Shared ${escapeHtml((edge.shared_fields ?? []).join(", ").replace("_", " "))}</div>`
              : `<div class="graph-tooltip">${edge.transaction_count} × · ${compactMoney(edge.total_amount)}</div>`
          }
          linkColor={edgeColorOf}
          linkWidth={(edge: GraphEdge) => {
            if (highlight?.edges.has(edge.id)) return 2.4;
            if (edge.kind === "identity") return 1.2;
            return Math.min(2.2, 0.5 + Math.log10(edge.total_amount + 1) * 0.28) * (edge.alert_ids.length ? 1.3 : 1);
          }}
          linkLineDash={(edge: GraphEdge) => (edge.kind === "identity" ? [3, 3] : null)}
          linkCurvature={(edge: GraphEdge) => (edge.kind === "flow" && graph?.edges.some((other) => other.id === `${edgeEndpoint(edge.target)}->${edgeEndpoint(edge.source)}`) ? 0.22 : 0)}
          linkDirectionalArrowLength={(edge: GraphEdge) => (edge.kind === "flow" ? 3.2 : 0)}
          linkDirectionalArrowRelPos={0.92}
          linkDirectionalArrowColor={edgeColorOf}
          linkDirectionalParticleWidth={2.6}
          linkDirectionalParticleSpeed={0.016}
          linkDirectionalParticleColor={() => "#f0efec"}
          onNodeClick={(node: GraphNode) => setSelection({ kind: "node", id: node.id })}
          onLinkClick={(edge: GraphEdge) => setSelection({ kind: "edge", id: edge.id })}
          onBackgroundClick={() => {
            setSelection(null);
            onClearAlert();
          }}
          cooldownTicks={140}
          d3VelocityDecay={0.32}
          autoPauseRedraw={false}
          minZoom={0.3}
          maxZoom={10}
        />

        <div className="graph-legend" aria-label="Graph legend">
          <span><i className="legend-node" /> Account</span>
          <span><i className="legend-house" /> Casino or cage</span>
          <span><i className="legend-flagged" /> Flagged (ring colour = detector)</span>
          <span><i className="legend-flow" /> Funds</span>
          <span><i className="legend-identity" /> Shared identifier</span>
          <span className="legend-note">Synthetic data</span>
        </div>

        {selectedAlert && (
          <div className="graph-focus">
            Showing {shortId(selectedAlert.id)}
            <button className="link-button" onClick={onClearAlert}>Clear</button>
          </div>
        )}

        {(selectedNode || selectedEdge) && (
          <div className="graph-card">
            <button className="icon-button" aria-label="Close details" onClick={() => setSelection(null)}>
              <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>

            {selectedNode && (
              <>
                <div className="mono account-name">{selectedNode.id}</div>
                <dl>
                  <div><dt>Transactions</dt><dd className="mono">{selectedNode.transaction_count}</dd></div>
                  <div><dt>Sent</dt><dd className="mono">{money(selectedNode.total_sent)}</dd></div>
                  <div><dt>Received</dt><dd className="mono">{money(selectedNode.total_received)}</dd></div>
                </dl>
                <AlertLinks alerts={relatedAlerts(selectedNode.alert_ids)} onOpenAlert={onOpenAlert} emptyText="No alerts for this account." />
              </>
            )}

            {selectedEdge && (
              <>
                <div className="mono account-name">
                  {edgeEndpoint(selectedEdge.source)} {selectedEdge.kind === "flow" ? "→" : "↔"} {edgeEndpoint(selectedEdge.target)}
                </div>
                {selectedEdge.kind === "flow" ? (
                  <dl>
                    <div><dt>Transactions</dt><dd className="mono">{selectedEdge.transaction_count}</dd></div>
                    <div><dt>Total</dt><dd className="mono">{money(selectedEdge.total_amount)}</dd></div>
                  </dl>
                ) : (
                  <p className="muted">Shared {(selectedEdge.shared_fields ?? []).join(", ").replace(/_/g, " ")}</p>
                )}
                <AlertLinks alerts={relatedAlerts(selectedEdge.alert_ids)} onOpenAlert={onOpenAlert} emptyText="No alerts on this link." />
              </>
            )}
          </div>
        )}

        {!graph && <div className="graph-empty">Loading network…</div>}
      </div>

      <div className="sr-only">
        The network graph shows {graph?.nodes.length ?? 0} accounts. Every alert and transaction shown in it is also listed
        in the alert list and transaction stream.
        Detector types are distinguished by colour and named in the alert list.
      </div>
    </section>
  );
}

function AlertLinks({ alerts, onOpenAlert, emptyText }: { alerts: Alert[]; onOpenAlert: (id: string) => void; emptyText: string }) {
  if (alerts.length === 0) return <p className="muted">{emptyText}</p>;

  return (
    <ul className="graph-card-alerts">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <button onClick={() => onOpenAlert(alert.id)}>
            <DetectorIcon detector={alert.detector} size={13} />
            <span>{alert.title}</span>
            <SeverityBadge severity={alert.severity} />
          </button>
        </li>
      ))}
    </ul>
  );
}
