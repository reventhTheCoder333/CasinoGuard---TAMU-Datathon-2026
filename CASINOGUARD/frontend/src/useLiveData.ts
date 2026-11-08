import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { addTransaction, MAX_STREAM_ROWS, mergeGraph, upsertAlert } from "./state";
import type {
  Alert,
  ConnectionState,
  DatabricksSimulationStatus,
  DetectorInfo,
  GraphState,
  IntegrationStatus,
  Scenario,
  SimulatorStatus,
  Summary,
  Transaction,
} from "./types";

const GRAPH_REFRESH_MS = 300;
const FRESH_ALERT_MS = 6000;
const HEARTBEAT_MS = 25000;
const MAX_RECONNECT_MS = 10000;

export interface Pulse {
  edgeId: string;
  seq: number;
}

export function useLiveData() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [graph, setGraph] = useState<GraphState | null>(null);
  const [detectors, setDetectors] = useState<DetectorInfo[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [simulator, setSimulator] = useState<SimulatorStatus | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [freshAlerts, setFreshAlerts] = useState<Record<string, number>>({});
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [databricksSimulation, setDatabricksSimulation] = useState<DatabricksSimulationStatus | null>(null);
  const [freshTransactions, setFreshTransactions] = useState<Set<string>>(new Set());

  const pendingPulses = useRef<string[]>([]);
  const graphTimer = useRef<number | undefined>(undefined);
  const pulseSeq = useRef(0);

  const refreshGraph = useCallback(async () => {
    const payload = await api.graph();

    setGraph((previous) => mergeGraph(previous, payload));

    const edgeIds = pendingPulses.current;
    pendingPulses.current = [];
    setPulses(edgeIds.map((edgeId) => ({ edgeId, seq: ++pulseSeq.current })));
  }, []);

  const scheduleGraphRefresh = useCallback(() => {
    if (graphTimer.current !== undefined) return;

    graphTimer.current = window.setTimeout(() => {
      graphTimer.current = undefined;
      refreshGraph().catch(() => undefined);
    }, GRAPH_REFRESH_MS);
  }, [refreshGraph]);

  const loadAll = useCallback(async () => {
    try {
      const [nextSummary, nextAlerts, nextTransactions, nextGraph, nextDetectors, sim, nextIntegrations] =
        await Promise.all([
          api.summary(),
          api.alerts(),
          api.transactions(MAX_STREAM_ROWS),
          api.graph(),
          api.detectors(),
          api.simulator(),
          api.integrations(),
        ]);

      setSummary(nextSummary);
      setAlerts(nextAlerts);
      setTransactions(nextTransactions.slice().reverse());
      setGraph((previous) => mergeGraph(previous, nextGraph));
      setDetectors(nextDetectors);
      setScenarios(sim.scenarios);
      setSimulator(sim.status);
      setIntegrations(nextIntegrations);
      setLoadError(null);

      if (nextSummary.source?.kind === "databricks") {
        setDatabricksSimulation(await api.databricksSimulation());
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The API could not be reached");
    }
  }, []);

  const markFresh = useCallback((id: string) => {
    setFreshAlerts((current) => ({ ...current, [id]: performance.now() }));

    window.setTimeout(() => {
      setFreshAlerts((current) => {
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
    }, FRESH_ALERT_MS);
  }, []);

  const handleEvent = useCallback(
    (message: { event: string; data?: unknown }) => {
      switch (message.event) {
        case "connected":
          setConnection("live");
          loadAll();
          break;
        case "transaction_received": {
          const tx = message.data as Transaction;
          setTransactions((rows) => addTransaction(rows, tx));
          setFreshTransactions(new Set([tx.id]));
          pendingPulses.current.push(`${tx.from}->${tx.to}`);
          scheduleGraphRefresh();
          break;
        }
        case "account_registered":
          scheduleGraphRefresh();
          break;
        case "new_alert":
        case "alert_updated": {
          const alert = message.data as Alert;
          setAlerts((list) => upsertAlert(list, alert));
          if (message.event === "new_alert") markFresh(alert.id);
          scheduleGraphRefresh();
          break;
        }
        case "summary":
          setSummary(message.data as Summary);
          setLoadError(null);
          break;
        case "databricks_simulation":
          setDatabricksSimulation(message.data as DatabricksSimulationStatus);
          break;
        case "simulator_status":
          setSimulator(message.data as SimulatorStatus);
          break;
        case "state_reset":
          pendingPulses.current = [];
          setFreshAlerts({});
          setFreshTransactions(new Set());
          loadAll();
          break;
      }
    },
    [loadAll, markFresh, scheduleGraphRefresh],
  );

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeat: number | undefined;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${location.host}/ws`);

      socket.onopen = () => {
        attempts = 0;
        heartbeat = window.setInterval(() => socket?.send("ping"), HEARTBEAT_MS);
      };

      socket.onmessage = (event) => handleEvent(JSON.parse(event.data));

      socket.onclose = () => {
        window.clearInterval(heartbeat);
        if (closed) return;

        setConnection("reconnecting");
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(1000 * 2 ** attempts, MAX_RECONNECT_MS));
      };
    };

    loadAll();
    connect();

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeat);
      socket?.close();
    };
  }, [handleEvent, loadAll]);

  return {
    connection,
    loadError,
    summary,
    alerts,
    transactions,
    graph,
    detectors,
    scenarios,
    simulator,
    integrations,
    freshAlerts,
    freshTransactions,
    pulses,
    databricksSimulation,
  };
}
