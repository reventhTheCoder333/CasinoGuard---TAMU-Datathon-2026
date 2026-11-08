import type {
  Alert,
  DatabricksSimulationStatus,
  DetectorInfo,
  GraphPayload,
  IntegrationStatus,
  Investigation,
  Scenario,
  SimulatorStatus,
  Summary,
  Transaction,
} from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${response.status})`;
    throw new Error(detail);
  }

  return response.json();
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  summary: () => request<Summary>("/api/summary"),
  alerts: () => request<Alert[]>("/api/alerts"),
  investigation: (id: string) => request<Investigation>(`/api/alerts/${encodeURIComponent(id)}`),
  transactions: (limit: number) => request<Transaction[]>(`/api/transactions?limit=${limit}`),
  allTransactions: () => request<Transaction[]>("/api/transactions"),
  graph: () => request<GraphPayload>("/api/graph"),
  detectors: () => request<DetectorInfo[]>("/api/detectors"),
  integrations: () => request<IntegrationStatus[]>("/api/integrations"),
  simulator: () => request<{ scenarios: Scenario[]; status: SimulatorStatus }>("/api/simulator"),
  runScenario: (scenario: string) => post("/api/simulator/run", { scenario }),
  setTraffic: (enabled: boolean) => post("/api/simulator/traffic", { enabled }),
  stopSimulator: () => post("/api/simulator/stop"),
  resetDemo: () => post("/api/simulator/reset"),
  refreshSource: () => post("/api/source/refresh"),
  databricksSimulation: () => request<DatabricksSimulationStatus>("/api/databricks/simulation"),
  simulateDatabricks: (scenario: string) => post("/api/databricks/simulate", { scenario }),
};
