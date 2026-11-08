import { useEffect, useRef, useState } from "react";
import { api, type DashboardEmbedConfig } from "../api";

/**
 * The published Databricks AI/BI dashboard, embedded for an external viewer.
 *
 * The browser never sees Databricks credentials: the backend exchanges the
 * service principal's secret for a short-lived token scoped to this one
 * dashboard, and the embed asks the backend for a fresh one before it expires.
 */

type Phase =
  | { kind: "checking" }
  | { kind: "unconfigured"; missing: string[] }
  | { kind: "authorizing" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; title: string; message: string };

// Past this, say it is slow rather than spin forever.
const SLOW_LOAD_MS = 30_000;

const PHASE_TEXT: Partial<Record<Phase["kind"], string>> = {
  checking: "Checking the embedding configuration…",
  authorizing: "Requesting a secure viewer token…",
  loading: "Loading the dashboard from Databricks…",
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function DatabricksDashboardPage() {
  const container = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [config, setConfig] = useState<DashboardEmbedConfig | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let dashboard: { destroy(): void } | null = null;
    let observer: MutationObserver | null = null;
    setSlow(false);
    setPhase({ kind: "checking" });

    const markReady = () => {
      if (!cancelled) setPhase((p) => (p.kind === "loading" ? { kind: "ready" } : p));
    };

    const slowTimer = window.setTimeout(() => !cancelled && setSlow(true), SLOW_LOAD_MS);

    (async () => {
      let cfg: DashboardEmbedConfig;
      try {
        cfg = await api.dashboardEmbedConfig();
      } catch (error) {
        if (!cancelled)
          setPhase({ kind: "error", title: "Can't reach the CASINOGUARD API", message: `${message(error)}. Check that the backend is running.` });
        return;
      }
      if (cancelled) return;
      setConfig(cfg);

      if (!cfg.configured || !cfg.instance_url || !cfg.workspace_id || !cfg.dashboard_id) {
        setPhase({ kind: "unconfigured", missing: cfg.missing });
        return;
      }

      setPhase({ kind: "authorizing" });
      let token: string;
      try {
        token = (await api.dashboardEmbedToken()).token;
      } catch (error) {
        if (!cancelled) setPhase({ kind: "error", title: "Couldn't get a viewer token from Databricks", message: message(error) });
        return;
      }
      if (cancelled || !container.current) return;

      setPhase({ kind: "loading" });
      try {
        const { DatabricksDashboard } = await import("@databricks/aibi-client");
        if (cancelled || !container.current) return;

        container.current.replaceChildren();
        // The embed renders an iframe; its load event means Databricks answered.
        observer = new MutationObserver(() => {
          const frame = container.current?.querySelector("iframe");
          if (frame) {
            frame.addEventListener("load", markReady, { once: true });
            frame.title = "Databricks AML dashboard";
            observer?.disconnect();
          }
        });
        observer.observe(container.current, { childList: true, subtree: true });

        const instance = new DatabricksDashboard({
          instanceUrl: cfg.instance_url,
          workspaceId: cfg.workspace_id,
          dashboardId: cfg.dashboard_id,
          container: container.current,
          token,
          getNewToken: async () => (await api.dashboardEmbedToken()).token,
          colorScheme: "dark",
          config: { version: 1 },
        });
        dashboard = instance;
        instance.onFiltersReady(markReady);
        instance.initialize();
      } catch (error) {
        if (!cancelled) setPhase({ kind: "error", title: "The dashboard couldn't be embedded", message: message(error) });
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      observer?.disconnect();
      try {
        dashboard?.destroy();
      } catch {
        // Already torn down.
      }
    };
  }, [attempt]);

  const busy = phase.kind === "checking" || phase.kind === "authorizing" || phase.kind === "loading";
  const showFrame = phase.kind === "loading" || phase.kind === "ready";

  return (
    <section className="analytics dbx-page" aria-labelledby="dbx-title">
      <div className="analytics-head">
        <div>
          <h1 id="dbx-title">Databricks AML dashboard</h1>
          <p className="muted">
            The published AI/BI dashboard, live from Databricks. Figures are computed in Databricks, not in this app.
            Alerts remain suspicious indicators, not proof of wrongdoing.
          </p>
        </div>
        <div className="dbx-actions">
          {phase.kind === "ready" && (
            <span className="connection connection-live" role="status">
              <span className="connection-dot" aria-hidden="true" />
              Connected
            </span>
          )}
          {config?.instance_url && config.dashboard_id && (
            <a
              className="button"
              href={`${config.instance_url}/dashboardsv3/${config.dashboard_id}/published`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open in Databricks
            </a>
          )}
          <button className="button" onClick={() => setAttempt((n) => n + 1)} disabled={busy}>
            Reload
          </button>
        </div>
      </div>

      <div className="panel dbx-frame-panel">
        <div ref={container} className={`dbx-frame ${showFrame ? "" : "dbx-hidden"}`} />

        {busy && (
          <div className="dbx-overlay" role="status" aria-live="polite">
            <span className="dbx-spinner" aria-hidden="true" />
            <p>{PHASE_TEXT[phase.kind]}</p>
            {slow && (
              <p className="muted">
                This is taking longer than usual. A stopped SQL warehouse can take a minute or two to start.
              </p>
            )}
          </div>
        )}

        {phase.kind === "unconfigured" && (
          <div className="dbx-overlay dbx-message">
            <h2>Embedding isn't configured yet</h2>
            <p>
              The backend needs a Databricks service principal to create secure viewer tokens. Add these to the backend{" "}
              <code>.env</code> file and restart the API:
            </p>
            <ul className="dbx-missing">
              {phase.missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
            <p className="muted">The service principal needs CAN RUN on the published dashboard. Its secret never reaches the browser.</p>
            <button className="button primary" onClick={() => setAttempt((n) => n + 1)}>Check again</button>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="dbx-overlay dbx-message" role="alert">
            <h2>{phase.title}</h2>
            <p>{phase.message}</p>
            <button className="button primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        )}
      </div>
    </section>
  );
}
