"""Scoped tokens for embedding the Databricks AI/BI dashboard (external users).

Flow (Databricks "embedding for external users"):
  1. The service principal gets an OAuth token (client credentials).
  2. That token asks the published dashboard's tokeninfo endpoint which
     scope a viewer needs.
  3. The service principal exchanges its credentials for a token limited to
     that dashboard and viewer. Only this scoped token reaches the browser.

The service principal ID and secret are read from the environment and are
only ever sent to the configured Databricks host. Error messages never
include either of them or any token.
"""

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from backend.integrations.databricks_sql import DatabricksError, normalize_host


REQUEST_TIMEOUT_SECONDS = 20
# Renew the service principal token this long before it expires.
EXPIRY_MARGIN_SECONDS = 120

REQUIRED_SETTINGS = (
    "DATABRICKS_HOST",
    "DATABRICKS_WORKSPACE_ID",
    "DATABRICKS_DASHBOARD_ID",
    "DATABRICKS_SP_CLIENT_ID",
    "DATABRICKS_SP_CLIENT_SECRET",
)


class EmbedNotConfigured(DatabricksError):
    """Embedding settings are missing from the environment."""

    def __init__(self, missing):
        self.missing = missing
        super().__init__(
            "Dashboard embedding is not configured. Set "
            + ", ".join(missing)
            + " in the backend .env file and restart the API."
        )


class EmbedError(DatabricksError):
    """Databricks refused or could not complete the token exchange."""

    def __init__(self, message, status=502):
        self.status = status
        super().__init__(message)


def _setting(name):
    return (os.getenv(name) or "").strip()


def missing_settings():
    return [name for name in REQUIRED_SETTINGS if not _setting(name)]


def public_config():
    """What the browser may see: identifiers only, never credentials."""
    missing = missing_settings()
    instance_url = None

    if _setting("DATABRICKS_HOST"):
        try:
            instance_url = normalize_host(_setting("DATABRICKS_HOST"))
        except DatabricksError:
            missing = sorted(set(missing) | {"DATABRICKS_HOST"})

    return {
        "configured": not missing,
        "missing": missing,
        "instance_url": instance_url,
        "workspace_id": _setting("DATABRICKS_WORKSPACE_ID") or None,
        "dashboard_id": _setting("DATABRICKS_DASHBOARD_ID") or None,
    }


def _oauth_error(error):
    """The OIDC endpoint answers {"error", "error_description"}; APIs use error_code."""
    try:
        body = json.loads(error.read() or b"{}")
    except (ValueError, OSError):
        return ""

    code = body.get("error") or body.get("error_code") or ""
    message = str(body.get("error_description") or body.get("message") or "")[:300]
    return f"{code} {message}".strip()


class DashboardEmbedder:

    def __init__(self, opener=urllib.request.urlopen, clock=time.time):
        self._open = opener
        self._clock = clock
        self._lock = threading.Lock()
        self._sp_token = None
        self._sp_token_expires = 0.0

    def _settings(self):
        missing = missing_settings()
        if missing:
            raise EmbedNotConfigured(missing)

        return {
            "host": normalize_host(_setting("DATABRICKS_HOST")),
            "workspace_id": _setting("DATABRICKS_WORKSPACE_ID"),
            "dashboard_id": _setting("DATABRICKS_DASHBOARD_ID"),
            "client_id": _setting("DATABRICKS_SP_CLIENT_ID"),
            "client_secret": _setting("DATABRICKS_SP_CLIENT_SECRET"),
            # Written to Databricks audit logs; must not contain personal data.
            "viewer_id": _setting("DATABRICKS_EMBED_VIEWER_ID") or "casinoguard-local-analyst",
            # Available to dataset SQL as __aibi_external_value for row filtering.
            "external_value": _setting("DATABRICKS_EMBED_EXTERNAL_VALUE") or "casinoguard",
        }

    def _request(self, url, step, data=None, headers=None):
        request = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data else "GET")

        try:
            with self._open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            detail = _oauth_error(error)
            raise EmbedError(self._explain(step, error.code, detail), status=502) from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            reason = getattr(error, "reason", error)
            raise EmbedError(f"Could not reach Databricks while {step}: {reason}", status=504) from None
        except ValueError:
            raise EmbedError(f"Databricks returned an unreadable response while {step}.") from None

    @staticmethod
    def _explain(step, status, detail):
        hint = ""
        if status in (400, 401) and "client" in detail.lower():
            hint = " Check DATABRICKS_SP_CLIENT_ID and DATABRICKS_SP_CLIENT_SECRET."
        elif status == 403:
            hint = " Give the service principal CAN RUN on the published dashboard."
        elif status == 404:
            # Databricks answers 404, not 403, when the dashboard isn't shared with the caller.
            hint = (" Check that the dashboard is published, that DATABRICKS_DASHBOARD_ID is right,"
                    " and that the service principal has CAN RUN on it.")
        suffix = f" ({detail})" if detail else ""
        return f"Databricks refused the request while {step} (HTTP {status}){suffix}.{hint}"

    def _basic_auth(self, settings):
        pair = f"{settings['client_id']}:{settings['client_secret']}".encode()
        return {
            "Authorization": "Basic " + base64.b64encode(pair).decode(),
            "Content-Type": "application/x-www-form-urlencoded",
        }

    def _token_url(self, settings):
        query = urllib.parse.urlencode({"o": settings["workspace_id"]})
        return f"{settings['host']}/oidc/v1/token?{query}"

    def _service_principal_token(self, settings):
        """Step 1. Cached: this broad token never leaves the server."""
        with self._lock:
            if self._sp_token and self._clock() < self._sp_token_expires - EXPIRY_MARGIN_SECONDS:
                return self._sp_token

            body = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all-apis"}).encode()
            result = self._request(
                self._token_url(settings),
                "authenticating the service principal",
                data=body,
                headers=self._basic_auth(settings),
            )

            token = result.get("access_token")
            if not token:
                raise EmbedError("Databricks did not return a service principal token.")

            self._sp_token = token
            self._sp_token_expires = self._clock() + float(result.get("expires_in") or 3600)
            return token

    def scoped_token(self):
        """Steps 2 and 3: a token limited to this dashboard and viewer."""
        settings = self._settings()
        sp_token = self._service_principal_token(settings)

        query = urllib.parse.urlencode({
            "o": settings["workspace_id"],
            "external_viewer_id": settings["viewer_id"],
            "external_value": settings["external_value"],
        })
        dashboard = urllib.parse.quote(settings["dashboard_id"], safe="")
        info = self._request(
            f"{settings['host']}/api/2.0/lakeview/dashboards/{dashboard}/published/tokeninfo?{query}",
            "requesting the dashboard's token scope",
            headers={"Authorization": f"Bearer {sp_token}"},
        )

        authorization_details = info.pop("authorization_details", None)
        if authorization_details is None:
            raise EmbedError("Databricks did not return the dashboard's token scope.")

        params = {key: value for key, value in info.items() if isinstance(value, (str, int, float))}
        params["grant_type"] = "client_credentials"
        params["authorization_details"] = json.dumps(authorization_details)

        result = self._request(
            self._token_url(settings),
            "creating the scoped dashboard token",
            data=urllib.parse.urlencode(params).encode(),
            headers=self._basic_auth(settings),
        )

        token = result.get("access_token")
        if not token:
            raise EmbedError("Databricks did not return a scoped dashboard token.")

        return {
            "token": token,
            "expires_in": int(result.get("expires_in") or 3600),
        }


embedder = DashboardEmbedder()
