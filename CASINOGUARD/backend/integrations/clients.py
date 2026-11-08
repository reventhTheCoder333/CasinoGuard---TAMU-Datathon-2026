"""Optional external integrations.

The platform runs fully without credentials. Each client reports whether it is
configured, and makes no network call unless it is. Credentials are read from
the environment only and are never included in status output.
"""

import csv
import io
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from dotenv import load_dotenv


load_dotenv()

REQUEST_TIMEOUT_SECONDS = 15
MAX_DATABRICKS_EXPORT = 500


class IntegrationNotConfigured(RuntimeError):
    """Required credentials are missing."""


class IntegrationError(RuntimeError):
    """The external service could not complete the request."""


def _http_json(url, payload=None, headers=None):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", **(headers or {})},
    )

    try:
        with urllib.request.urlopen(
            request, timeout=REQUEST_TIMEOUT_SECONDS
        ) as response:
            return json.loads(response.read())

    except urllib.error.HTTPError as error:
        # Only the status: URLs and bodies may contain credentials.
        raise IntegrationError(
            f"The service returned HTTP {error.code}"
        ) from None

    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise IntegrationError(
            f"The service could not be reached ({type(error).__name__})"
        ) from None


class _EnvIntegration:
    name = ""
    purpose = ""
    required_env = ()

    @property
    def configured(self):
        return all(os.getenv(key) for key in self.required_env)

    def status(self):
        return {
            "name": self.name,
            "purpose": self.purpose,
            "configured": self.configured,
            "required_env": list(self.required_env),
            "missing_env": [k for k in self.required_env if not os.getenv(k)],
        }

    def _require(self):
        if not self.configured:
            raise IntegrationNotConfigured(
                f"{self.name} is not configured. Set: "
                + ", ".join(self.status()["missing_env"])
            )


class DatabricksClient(_EnvIntegration):
    """Writes alerts to a Delta table via the SQL Statement Execution API."""

    name = "Databricks"
    purpose = "Export alerts to a Delta table"
    required_env = (
        "DATABRICKS_HOST",
        "DATABRICKS_TOKEN",
        "DATABRICKS_WAREHOUSE_ID",
        "DATABRICKS_EXPORT_TABLE",
    )

    def build_statement(self, alert):
        table = os.environ["DATABRICKS_EXPORT_TABLE"]

        if not re.fullmatch(r"[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}", table):
            raise IntegrationError("DATABRICKS_EXPORT_TABLE is not a valid name")

        return {
            "warehouse_id": os.environ["DATABRICKS_WAREHOUSE_ID"],
            "wait_timeout": "10s",
            "statement": (
                f"INSERT INTO {table} "
                "(alert_id, detector, severity, first_detected_at, payload) "
                "VALUES (:alert_id, :detector, :severity, "
                ":first_detected_at, :payload)"
            ),
            "parameters": [
                {"name": "alert_id", "value": alert["id"]},
                {"name": "detector", "value": alert["detector"]},
                {"name": "severity", "value": alert["severity"]},
                {"name": "first_detected_at", "value": alert["first_detected_at"]},
                {"name": "payload", "value": json.dumps(alert, default=str)},
            ],
        }

    def export_alerts(self, alerts):
        self._require()
        host = os.environ["DATABRICKS_HOST"].rstrip("/")
        headers = {"Authorization": f"Bearer {os.environ['DATABRICKS_TOKEN']}"}
        batch = alerts[:MAX_DATABRICKS_EXPORT]

        for alert in batch:
            _http_json(
                f"{host}/api/2.0/sql/statements",
                self.build_statement(alert),
                headers,
            )

        return {"exported": len(batch), "skipped": len(alerts) - len(batch)}


class SerpApiClient(_EnvIntegration):
    """Public-web lookups typed by an analyst. Nothing is sent automatically."""

    name = "SerpApi"
    purpose = "Analyst-initiated public-web lookups"
    required_env = ("SERPAPI_API_KEY",)

    def search(self, query, limit=5):
        self._require()
        params = urllib.parse.urlencode({
            "engine": "google",
            "q": query,
            "num": limit,
            "api_key": os.environ["SERPAPI_API_KEY"],
        })
        response = _http_json(f"https://serpapi.com/search.json?{params}")

        return {
            "query": query,
            "notice": (
                "Unverified public-web results. A name match does not "
                "establish identity or wrongdoing."
            ),
            "results": [
                {
                    "title": item.get("title"),
                    "link": item.get("link"),
                    "snippet": item.get("snippet"),
                }
                for item in response.get("organic_results", [])[:limit]
            ],
        }


class TableauExport(_EnvIntegration):
    """CSV extracts for Tableau. These need no credentials.

    Publishing directly to Tableau Server is not implemented: it needs the
    Hyper API and a real site to test against. The env vars are reserved for it.
    """

    name = "Tableau"
    purpose = "CSV extracts for Tableau data sources"
    required_env = ("TABLEAU_SERVER_URL", "TABLEAU_SITE", "TABLEAU_TOKEN")

    def status(self):
        return {
            **super().status(),
            "export_available": True,
            "publish_implemented": False,
        }


def _safe_cell(value):
    """Stop spreadsheet tools from treating a text cell as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def to_csv(rows, columns):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns)

    for row in rows:
        writer.writerow([_safe_cell(row.get(column)) for column in columns])

    return buffer.getvalue()


databricks = DatabricksClient()
serpapi = SerpApiClient()
tableau = TableauExport()
