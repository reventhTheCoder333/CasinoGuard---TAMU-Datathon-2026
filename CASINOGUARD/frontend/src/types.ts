export type Severity = "high" | "medium";

export type DetectorKey =
  | "transaction_chains"
  | "transaction_structuring"
  | "rapid_cashouts"
  | "unusual_volume"
  | "circular_transactions"
  | "multiple_accounts";

export interface Transaction {
  id: string;
  account: string;
  from: string;
  to: string;
  amount: number;
  timestamp: string;
  type: string;
  source: "seed" | "simulator" | "api" | "databricks";
  synthetic: boolean;
}

export interface SharedIdentifier {
  field: string;
  value: string;
  accounts: string[];
}

export interface Alert {
  id: string;
  detector: DetectorKey;
  detector_label: string;
  pattern: string;
  title: string;
  summary: string;
  severity: Severity;
  severity_reason: string;
  exposure: number | null;
  accounts_involved: string[];
  first_detected_at: string;
  last_updated_at: string;
  revision: number;
  merged_alert_ids: string[];
  disclaimer: string;
  source?: "databricks";
  transaction_ids?: string[];
  deposit_id?: string;
  withdrawal_ids?: string[];
  shared_identifiers?: SharedIdentifier[];
}

export interface Rule {
  label: string;
  observed: number;
  comparator: ">=" | "<=";
  threshold: number;
  unit: string;
  met: boolean;
}

export interface AccountProfile {
  account: string;
  transaction_count: number;
  total_sent: number;
  total_received: number;
  first_activity: string | null;
  last_activity: string | null;
  other_alerts: {
    id: string;
    title: string;
    detector: DetectorKey;
    severity: Severity;
  }[];
}

export interface Investigation {
  alert: Alert;
  disclaimer: string;
  data_classification: string;
  why_flagged: Rule[];
  detector_notes: string[];
  detector_parameters: Record<string, number>;
  detector_output: Record<string, unknown>;
  timeline: Transaction[];
  accounts: AccountProfile[];
  alternative_explanations: string[];
  recommended_steps: string[];
  data_source?: { kind: string; table: string; alert_id: string };
}

export interface Summary {
  total_transactions: number;
  total_accounts: number;
  total_alerts: number;
  total_volume: number;
  high_priority_alerts: number;
  flagged_accounts: number;
  detector_summary: Record<DetectorKey, number>;
  detector_errors: Record<string, string>;
  data_classification: string;
  source: SourceInfo;
}

export interface SourceInfo {
  kind: "local" | "databricks";
  read_only: boolean;
  status: "loading" | "ready" | "error";
  error?: string | null;
  last_refreshed_at?: string | null;
  host?: string | null;
  warehouse?: string | null;
  tables?: Record<string, string>;
  alert_rows?: number;
  enabled_detectors?: DetectorKey[];
  skipped_rows?: { alert_id: string | null; pattern: string | null; reason: string }[];
}

export interface DetectorInfo {
  key: DetectorKey;
  label: string;
  description: string;
  parameters: Record<string, number>;
}

export interface GraphNode {
  id: string;
  kind: "house" | "account";
  total_sent: number;
  total_received: number;
  volume: number;
  transaction_count: number;
  cluster: number | null;
  alert_ids: string[];
  detectors: DetectorKey[];
  top_severity: Severity | null;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
}

export interface GraphEdge {
  id: string;
  /** Node id from the API; the graph library replaces it with the node. */
  source: string | GraphNode;
  target: string | GraphNode;
  kind: "flow" | "identity";
  transaction_count: number;
  total_amount: number;
  last_timestamp: string | null;
  transaction_ids: string[];
  alert_ids: string[];
  shared_fields?: string[];
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphState extends GraphPayload {
  /** Changes only when nodes or edges are added or removed. */
  version: number;
}

export interface Scenario {
  key: string;
  name: string;
  description: string;
  target_detector: DetectorKey;
}

export interface SimulatorRun {
  id: string;
  scenario: string;
  name: string;
  target_detector: DetectorKey;
  state: "queued" | "running" | "finished" | "stopped" | "failed";
  emitted: number;
  total: number;
  alerts_raised: { id: string; title: string; detector: DetectorKey; severity: Severity }[];
  alerts_updated: string[];
  error: string | null;
}

export interface SimulatorStatus {
  busy: boolean;
  traffic: { enabled: boolean; interval: number; emitted: number };
  runs: SimulatorRun[];
}

export interface IntegrationStatus {
  name: string;
  purpose: string;
  configured: boolean;
  required_env: string[];
  missing_env: string[];
  export_available?: boolean;
  publish_implemented?: boolean;
}

export type SimulationState =
  | "generating"
  | "uploading"
  | "running_job"
  | "verifying"
  | "loading_results"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SimulationScenario =
  | "full"
  | "transaction_structuring"
  | "transaction_chains"
  | "rapid_cashouts"
  | "unusual_volume"
  | "circular_transactions";

export interface ScenarioCheck {
  matched: boolean;
  expected: { pattern: string; accounts: string[]; detected: boolean; alert_id: string | null }[];
  unexpected: { pattern: string | null; alert_id: string; title: string }[];
}

export interface DatabricksSimulation {
  id: string;
  scenario: SimulationScenario;
  scenario_label: string;
  seed: number;
  check: ScenarioCheck | null;
  state: SimulationState;
  started_at: string;
  finished_at: string | null;
  job_run_id: number | null;
  job_run_url: string | null;
  job_state: string | null;
  uploaded: { transactions: number; accounts: number } | null;
  alerts_loaded: number | null;
  failed_step: SimulationState | null;
  error: string | null;
}

export interface DatabricksSimulationStatus {
  configured: boolean;
  busy: boolean;
  current: DatabricksSimulation | null;
  steps: { key: SimulationState; label: string }[];
  scenarios: { key: SimulationScenario; label: string }[];
}

export type ConnectionState = "connecting" | "live" | "reconnecting";
