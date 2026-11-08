import { useMemo, useState } from "react";
import { AlertFeed } from "./components/AlertFeed";
import { InvestigationDrawer } from "./components/InvestigationDrawer";
import { NetworkGraph } from "./components/NetworkGraph";
import { SimulatorPanel } from "./components/SimulatorPanel";
import { SourcePanel, StaleResultsBanner } from "./components/SourcePanel";
import { StatTiles } from "./components/StatTiles";
import { TopBar } from "./components/TopBar";
import { TransactionStream } from "./components/TransactionStream";
import { flaggedTransactionIds } from "./state";
import type { DetectorKey, Severity } from "./types";
import { useLiveData } from "./useLiveData";

export default function App() {
  const live = useLiveData();
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [detectorFilter, setDetectorFilter] = useState<DetectorKey | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);

  const source = live.summary?.source;
  const flagged = useMemo(() => flaggedTransactionIds(live.alerts), [live.alerts]);

  // An alert can disappear after a reset or merge, which closes its panel.
  const selectedAlert = live.alerts.find((alert) => alert.id === selectedAlertId) ?? null;

  return (
    <div className="app">
      <TopBar connection={live.connection} summary={live.summary} />

      {live.loadError && (
        <div className="banner" role="alert">
          Can't load data from the API: {live.loadError}. Check that the backend is running on port 8000. Retrying when it
          reconnects.
        </div>
      )}

      {live.summary && Object.keys(live.summary.detector_errors).length > 0 && (
        <div className="banner" role="alert">
          Detection is degraded. These detectors failed on the last run and may be missing alerts:{" "}
          {Object.keys(live.summary.detector_errors).join(", ")}.
        </div>
      )}

      {source?.kind === "databricks" && source.status === "error" && (
        <div className="banner" role="alert">
          Couldn't load from Databricks: {source.error}{" "}
          {source.last_refreshed_at ? "Showing the data from the last successful load." : "No data has been loaded yet."}
        </div>
      )}

      <StaleResultsBanner simulation={live.databricksSimulation} lastLoaded={source?.last_refreshed_at} />

      <StatTiles summary={live.summary} />

      <main className="workspace">
        {source?.kind === "databricks" ? (
          <SourcePanel source={source} simulation={live.databricksSimulation} onOpenAlert={setSelectedAlertId} />
        ) : (
          <SimulatorPanel
            scenarios={live.scenarios}
            status={live.simulator}
            integrations={live.integrations}
            onOpenAlert={setSelectedAlertId}
          />
        )}

        <div className="center-column">
          <NetworkGraph
            graph={live.graph}
            alerts={live.alerts}
            selectedAlert={selectedAlert}
            freshAlerts={live.freshAlerts}
            pulses={live.pulses}
            onOpenAlert={setSelectedAlertId}
            onClearAlert={() => setSelectedAlertId(null)}
          />
          <TransactionStream
            transactions={live.transactions}
            flagged={flagged}
            fresh={live.freshTransactions}
            total={live.summary?.total_transactions ?? 0}
          />
        </div>

        <AlertFeed
          alerts={live.alerts}
          detectors={live.detectors}
          summary={live.summary}
          selectedId={selectedAlertId}
          freshAlerts={live.freshAlerts}
          detectorFilter={detectorFilter}
          severityFilter={severityFilter}
          onDetectorFilter={setDetectorFilter}
          onSeverityFilter={setSeverityFilter}
          onSelect={setSelectedAlertId}
          loading={!live.summary || source?.status === "loading"}
          sourceKind={source?.kind ?? "local"}
        />
      </main>

      {selectedAlert && (
        <InvestigationDrawer
          alert={selectedAlert}
          onClose={() => setSelectedAlertId(null)}
          onOpenAlert={setSelectedAlertId}
        />
      )}
    </div>
  );
}
