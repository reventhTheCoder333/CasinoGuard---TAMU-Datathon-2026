"""Read-only Databricks SQL client (SQL Statement Execution API).

Credentials come from the environment and are only ever sent to the
configured Databricks host. Error messages never include the token.
"""

import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request


logger = logging.getLogger("casinoguard.databricks")

REQUEST_TIMEOUT_SECONDS = 30
# A stopped serverless warehouse can take a while to start.
STATEMENT_DEADLINE_SECONDS = 180
POLL_INTERVAL_SECONDS = 2

TABLE_NAME = re.compile(r"^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$")


class DatabricksError(RuntimeError):
    """Databricks could not be reached or rejected the request."""


class DatabricksNotConfigured(DatabricksError):
    """Required environment variables are missing."""


def normalize_host(value):
    """Accept a workspace URL copied from the browser, keep only its origin."""
    parsed = urllib.parse.urlparse(value.strip())

    if parsed.scheme != "https" or not parsed.netloc:
        raise DatabricksNotConfigured(
            "DATABRICKS_HOST must be an https:// workspace URL"
        )

    return f"https://{parsed.netloc}"


def validate_table(name):
    if not TABLE_NAME.fullmatch(name):
        raise DatabricksNotConfigured(f"Invalid table name: {name!r}")
    return name


def _convert(value, type_name):
    """JSON_ARRAY results return every value as a string (or null)."""
    if value is None:
        return None

    kind = type_name.upper()

    if kind.startswith(("ARRAY", "MAP", "STRUCT")):
        return json.loads(value)
    if kind in ("DOUBLE", "FLOAT") or kind.startswith("DECIMAL"):
        return float(value)
    if kind in ("INT", "BIGINT", "SMALLINT", "TINYINT", "LONG", "INTEGER"):
        return int(value)
    if kind == "BOOLEAN":
        return value.lower() == "true"
    return value


def _error_detail(error):
    """Databricks' own error code and message; it never echoes the token."""
    try:
        body = json.loads(error.read() or b"{}")
    except (ValueError, OSError):
        return ""

    code = body.get("error_code", "")
    message = str(body.get("message", ""))[:300]
    return f": {code} {message}".rstrip() if code or message else ""


class DatabricksSQLClient:

    def __init__(self, host, token, warehouse_id=None, opener=None, sleep=time.sleep):
        self.host = normalize_host(host)
        self._token = token
        self.warehouse_id = warehouse_id
        self.warehouse_name = None
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep

    @classmethod
    def from_env(cls):
        host = os.getenv("DATABRICKS_HOST", "")
        token = os.getenv("DATABRICKS_TOKEN", "")

        if not host or not token:
            raise DatabricksNotConfigured(
                "Set DATABRICKS_HOST and DATABRICKS_TOKEN to use Databricks"
            )

        return cls(host, token, os.getenv("DATABRICKS_WAREHOUSE_ID") or None)

    def __repr__(self):
        return f"DatabricksSQLClient(host={self.host!r})"

    # --------------------------------------------------
    # HTTP
    # --------------------------------------------------

    def _request(self, method, path, body=None, raw=None, content_type="application/json"):
        if raw is None and body is not None:
            raw = json.dumps(body).encode()

        request = urllib.request.Request(
            self.host + path,
            data=raw,
            method=method,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": content_type,
            },
        )

        try:
            with self._open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                payload = response.read()
                return json.loads(payload) if payload else {}

        except urllib.error.HTTPError as error:
            detail = _error_detail(error)

            if error.code in (401, 403):
                raise DatabricksError(
                    "Databricks rejected the credentials "
                    f"(HTTP {error.code}). Check DATABRICKS_TOKEN."
                ) from None
            raise DatabricksError(
                f"Databricks returned HTTP {error.code}{detail}"
            ) from None

        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise DatabricksError(
                f"Databricks could not be reached ({type(error).__name__})"
            ) from None

    # --------------------------------------------------
    # Warehouse
    # --------------------------------------------------

    def resolve_warehouse(self):
        """Use DATABRICKS_WAREHOUSE_ID, or the workspace's only/running warehouse."""
        if self.warehouse_id:
            return self.warehouse_id

        warehouses = self._request("GET", "/api/2.0/sql/warehouses").get(
            "warehouses", []
        )

        if not warehouses:
            raise DatabricksError(
                "No SQL warehouse found. Create one or set DATABRICKS_WAREHOUSE_ID."
            )

        running = [w for w in warehouses if w.get("state") == "RUNNING"]
        chosen = (running or warehouses)[0]
        self.warehouse_id = chosen["id"]
        self.warehouse_name = chosen.get("name")
        return self.warehouse_id

    # --------------------------------------------------
    # Queries
    # --------------------------------------------------

    def query(self, statement):
        """Run a read query and return rows as dictionaries."""
        response = self._request("POST", "/api/2.0/sql/statements", {
            "warehouse_id": self.resolve_warehouse(),
            "statement": statement,
            "wait_timeout": "30s",
            "on_wait_timeout": "CONTINUE",
            "disposition": "INLINE",
            "format": "JSON_ARRAY",
        })

        deadline = time.monotonic() + STATEMENT_DEADLINE_SECONDS

        while response["status"]["state"] in ("PENDING", "RUNNING"):
            if time.monotonic() > deadline:
                self._request(
                    "POST",
                    f"/api/2.0/sql/statements/{response['statement_id']}/cancel",
                    {},
                )
                raise DatabricksError("The Databricks query timed out")

            self._sleep(POLL_INTERVAL_SECONDS)
            response = self._request(
                "GET", f"/api/2.0/sql/statements/{response['statement_id']}"
            )

        state = response["status"]["state"]

        if state != "SUCCEEDED":
            message = response["status"].get("error", {}).get("message", "")
            raise DatabricksError(
                f"The Databricks query {state.lower()}: {message[:300]}".rstrip(": ")
            )

        columns = response["manifest"]["schema"]["columns"]
        rows = list(response.get("result", {}).get("data_array") or [])
        next_link = response.get("result", {}).get("next_chunk_internal_link")

        while next_link:
            chunk = self._request("GET", next_link)
            rows.extend(chunk.get("data_array") or [])
            next_link = chunk.get("next_chunk_internal_link")

        return [
            {
                column["name"]: _convert(value, column["type_text"])
                for column, value in zip(columns, row)
            }
            for row in rows
        ]

    # --------------------------------------------------
    # Files (Unity Catalog volumes)
    # --------------------------------------------------

    def upload_file(self, volume_path, content):
        """Write bytes to a /Volumes/... path, replacing any existing file."""
        if not re.fullmatch(r"/Volumes/[A-Za-z0-9_./-]+", volume_path) or ".." in volume_path:
            raise DatabricksNotConfigured(f"Invalid volume path: {volume_path!r}")

        self._request(
            "PUT",
            f"/api/2.0/fs/files{urllib.parse.quote(volume_path)}?overwrite=true",
            raw=content,
            content_type="application/octet-stream",
        )

    # --------------------------------------------------
    # Jobs
    # --------------------------------------------------

    def active_job_runs(self, job_id):
        response = self._request(
            "GET", f"/api/2.2/jobs/runs/list?job_id={int(job_id)}&active_only=true"
        )
        return response.get("runs", [])

    def run_job(self, job_id):
        return self._request("POST", "/api/2.2/jobs/run-now", {"job_id": int(job_id)})["run_id"]

    def get_job_run(self, run_id):
        return self._request("GET", f"/api/2.2/jobs/runs/get?run_id={int(run_id)}")

    def cancel_job_run(self, run_id):
        self._request("POST", "/api/2.2/jobs/runs/cancel", {"run_id": int(run_id)})
