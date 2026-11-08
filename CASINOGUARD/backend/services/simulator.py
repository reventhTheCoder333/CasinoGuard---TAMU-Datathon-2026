"""Generate synthetic activity through the same pipeline as live transactions.

Scenarios only produce transactions and account records. Whether an alert is
raised is decided by the six detectors; a run reports what actually happened.
"""

import asyncio
import logging
import random
import zlib
from datetime import datetime, timedelta, timezone


logger = logging.getLogger("casinoguard.simulator")

MAX_RUN_HISTORY = 12


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class Plan:
    """Builds the ordered steps of one scenario run."""

    def __init__(self, run_number, code):
        self.prefix = f"SIM{run_number:03d}_{code}"
        self.steps = []
        self._count = 0

    def account(self, suffix):
        return f"{self.prefix}_{suffix}"

    def transaction(self, account, sender, receiver, amount, when, tx_type):
        self._count += 1
        self.steps.append(("transaction", {
            "id": f"{self.prefix}-{self._count:03d}",
            "account": account,
            "from": sender,
            "to": receiver,
            "amount": amount,
            "timestamp": when.isoformat(),
            "type": tx_type,
        }))

    def profile(self, suffix, phone, email, card):
        self.steps.append(("account", {
            "account": self.account(suffix),
            "phone": phone,
            "email": email,
            "payment_card": card,
        }))


def _chain(plan, now):
    # Four hops, so the alert visibly grows as the last hop arrives.
    names = [plan.account(s) for s in "ABCDE"]
    amounts = [12000, 11700, 11350, 11050]

    for i, amount in enumerate(amounts):
        plan.transaction(
            names[i], names[i], names[i + 1], amount,
            now - timedelta(minutes=(3 - i) * 4), "transfer",
        )


def _structuring(plan, now):
    account = plan.account("PLAYER")

    for i, amount in enumerate([4200, 3800, 3100, 2900]):
        plan.transaction(
            account, account, f"CAGE00{i + 1}", amount,
            now - timedelta(minutes=(3 - i) * 13), "deposit",
        )


def _cashout(plan, now):
    account = plan.account("PLAYER")
    plan.transaction(account, account, "CASINO", 9500, now - timedelta(minutes=14), "deposit")
    plan.transaction(account, account, "CASINO", 150, now - timedelta(minutes=9), "wager")
    plan.transaction(account, "CASINO", account, 9200, now, "withdrawal")


def _volume(plan, now):
    account = plan.account("PLAYER")
    rng = random.Random(plan.prefix)

    # A varied week of history gives the detector a meaningful baseline.
    for days_ago, count in zip(range(7, 0, -1), [2, 3, 2, 2, 3, 2, 3]):
        day = (now - timedelta(days=days_ago)).replace(hour=18, minute=0, second=0)

        for j in range(count):
            plan.transaction(
                account, account, "CASINO", rng.randint(40, 120),
                day + timedelta(minutes=j * 25), "wager",
            )

    # The spike must stay on today's UTC date, even just after midnight.
    midnight = now.replace(hour=0, minute=0, second=0)
    spike = 18
    spacing = min(120, (now - midnight).total_seconds() / spike)

    for j in range(spike):
        plan.transaction(
            account, account, "CASINO", rng.randint(40, 120),
            now - timedelta(seconds=spacing * (spike - 1 - j)), "wager",
        )


def _circular(plan, now):
    names = [plan.account(s) for s in "ABC"]

    for i, amount in enumerate([7500, 7300, 7050]):
        plan.transaction(
            names[i], names[i], names[(i + 1) % 3], amount,
            now - timedelta(minutes=(2 - i) * 5), "transfer",
        )


def _multiple(plan, now):
    run = plan.prefix
    phone = f"555-01{zlib.crc32(run.encode()) % 90 + 10}"
    card = f"SYN-CARD-{run}"

    plan.profile("A", phone, f"{run}.a@example.com".lower(), card)
    plan.profile("B", phone, f"{run}.b@example.com".lower(), f"SYN-CARD-{run}-B")
    plan.profile("C", f"555-02{zlib.crc32(run.encode()) % 90 + 10}", f"{run}.c@example.com".lower(), card)

    # Small deposits make the linked accounts visible as activity in the graph.
    for i, suffix in enumerate("ABC"):
        account = plan.account(suffix)
        plan.transaction(
            account, account, "CASINO", 300 + i * 75,
            now - timedelta(minutes=(2 - i) * 6), "deposit",
        )


SCENARIOS = {
    "chain": {
        "name": "Layered transfer chain",
        "target_detector": "transaction_chains",
        "description": "Similar amounts hop through five accounts in minutes.",
        "code": "CHAIN",
        "build": _chain,
    },
    "structuring": {
        "name": "Split cage deposits",
        "target_detector": "transaction_structuring",
        "description": "Four sub-$10k deposits at different cages within an hour.",
        "code": "STRUCT",
        "build": _structuring,
    },
    "cashout": {
        "name": "Deposit and quick cash-out",
        "target_detector": "rapid_cashouts",
        "description": "A large deposit, one small wager, then a near-full withdrawal.",
        "code": "CASH",
        "build": _cashout,
    },
    "volume": {
        "name": "Sudden activity spike",
        "target_detector": "unusual_volume",
        "description": "A quiet week of history, followed by a burst today.",
        "code": "VOL",
        "build": _volume,
    },
    "circular": {
        "name": "Funds in a loop",
        "target_detector": "circular_transactions",
        "description": "Transfers pass through three accounts and return to the first.",
        "code": "LOOP",
        "build": _circular,
    },
    "multiple": {
        "name": "Linked identities",
        "target_detector": "multiple_accounts",
        "description": "New accounts appear sharing a phone number and payment card.",
        "code": "LINK",
        "build": _multiple,
    },
}


class NormalTraffic:
    """Ordinary play: deposits, substantial wagers, modest withdrawals."""

    # Keeps a simulated player's hourly deposits at a plausible level. A player
    # at the limit sits out rather than funding yet another session.
    HOURLY_DEPOSIT_LIMIT = 8000
    MAX_DEPOSIT = 400

    def __init__(self, players=12, seed=None):
        self.rng = random.Random(seed)
        self.players = [f"PLAYER_{101 + i}" for i in range(players)]
        self.sessions = {}
        self.deposits = {player: [] for player in self.players}
        self.counter = 0

    def _can_deposit(self, player, now):
        recent = [
            (when, amount) for when, amount in self.deposits[player]
            if now - when < timedelta(hours=1)
        ]
        self.deposits[player] = recent
        spent = sum(amount for _, amount in recent)
        return spent + self.MAX_DEPOSIT <= self.HOURLY_DEPOSIT_LIMIT

    def next_transaction(self, now=None):
        """Return the next transaction, or None if every player is sitting out."""
        now = now or _now()

        available = [
            player for player in self.players
            if player in self.sessions or self._can_deposit(player, now)
        ]

        if not available:
            return None

        player = self.rng.choice(available)
        self.counter += 1

        def tx(sender, receiver, amount, tx_type):
            return {
                "id": f"TRAFFIC-{self.counter:06d}",
                "account": player,
                "from": sender,
                "to": receiver,
                "amount": amount,
                "timestamp": now.isoformat(),
                "type": tx_type,
            }

        session = self.sessions.get(player)

        if session is None:
            deposit = self.rng.randrange(100, self.MAX_DEPOSIT, 25)
            self.deposits[player].append((now, deposit))
            self.sessions[player] = {
                "deposit": deposit,
                "plays": self.rng.randint(2, 4),
            }
            return tx(player, "CASINO", deposit, "deposit")

        if session["plays"] > 0:
            session["plays"] -= 1
            amount = self.rng.randrange(
                int(session["deposit"] * 0.3),
                int(session["deposit"] * 0.45),
                5,
            )
            return tx(player, "CASINO", amount, "wager")

        del self.sessions[player]
        amount = self.rng.randrange(
            int(session["deposit"] * 0.1),
            int(session["deposit"] * 0.35),
            5,
        )
        return tx("CASINO", player, amount, "withdrawal")


class SimulatorManager:
    """Runs scenarios and background traffic as asyncio tasks."""

    def __init__(self, ingest_transaction, ingest_account, publish_status):
        self._ingest_transaction = ingest_transaction
        self._ingest_account = ingest_account
        self._publish_status = publish_status
        self._task = None
        self._traffic_task = None
        self._run_counter = 0
        self.runs = []
        self.traffic = {"enabled": False, "interval": 2.0, "emitted": 0}
        self.traffic_source = NormalTraffic()

    # --------------------------------------------------
    # Status
    # --------------------------------------------------

    @property
    def busy(self):
        return self._task is not None and not self._task.done()

    def status(self):
        return {
            "busy": self.busy,
            "traffic": dict(self.traffic),
            "runs": self.runs[:MAX_RUN_HISTORY],
            "data_classification": "synthetic",
        }

    async def _publish(self):
        await self._publish_status(self.status())

    # --------------------------------------------------
    # Scenarios
    # --------------------------------------------------

    def _build_run(self, key):
        self._run_counter += 1
        scenario = SCENARIOS[key]
        plan = Plan(self._run_counter, scenario["code"])
        scenario["build"](plan, _now())

        return {
            "id": plan.prefix,
            "scenario": key,
            "name": scenario["name"],
            "target_detector": scenario["target_detector"],
            "state": "queued",
            "emitted": 0,
            "total": len(plan.steps),
            "alerts_raised": [],
            "alerts_updated": [],
            "error": None,
        }, plan

    async def start(self, scenario_keys, interval=0.8):
        """Queue scenarios to run in order. Raises RuntimeError if already busy."""
        if self.busy:
            raise RuntimeError("A simulation is already running")

        runs = [self._build_run(key) for key in scenario_keys]
        self.runs = [run for run, _ in reversed(runs)] + self.runs
        del self.runs[MAX_RUN_HISTORY:]

        self._task = asyncio.create_task(self._execute(runs, interval))
        await self._publish()

        return [run for run, _ in runs]

    async def _execute(self, runs, interval):
        try:
            for run, plan in runs:
                await self._execute_run(run, plan, interval)

        except asyncio.CancelledError:
            for run, _ in runs:
                if run["state"] in ("queued", "running"):
                    run["state"] = "stopped"
            raise

        finally:
            self._task = None
            try:
                await self._publish()
            except Exception:
                logger.exception("Could not publish simulator status")

    async def _execute_run(self, run, plan, interval):
        run["state"] = "running"
        await self._publish()

        try:
            for kind, payload in plan.steps:
                ingest = (
                    self._ingest_transaction
                    if kind == "transaction"
                    else self._ingest_account
                )
                result = await ingest(payload, "simulator")

                run["emitted"] += 1
                run["alerts_raised"].extend(
                    _brief(alert) for alert in result["new_alerts"]
                )
                run["alerts_updated"].extend(
                    alert["id"] for alert in result["updated_alerts"]
                    if alert["id"] not in run["alerts_updated"]
                )

                await self._publish()

                # History is backfill, so it is sent faster than live events.
                await asyncio.sleep(_step_delay(interval, payload))

            run["state"] = "finished"

        except asyncio.CancelledError:
            raise

        except Exception as error:
            logger.exception("Simulator run %s failed", run["id"])
            run["state"] = "failed"
            run["error"] = str(error)

    # --------------------------------------------------
    # Background traffic
    # --------------------------------------------------

    async def set_traffic(self, enabled, interval=None):
        if interval is not None:
            self.traffic["interval"] = interval

        self.traffic["enabled"] = enabled

        if enabled and (
            self._traffic_task is None or self._traffic_task.done()
        ):
            self._traffic_task = asyncio.create_task(self._traffic_loop())

        if not enabled:
            await self._cancel(self._traffic_task)
            self._traffic_task = None

        await self._publish()
        return self.status()

    async def _traffic_loop(self):
        while self.traffic["enabled"]:
            try:
                transaction = self.traffic_source.next_transaction()

                if transaction is not None:
                    await self._ingest_transaction(transaction, "simulator")
                    self.traffic["emitted"] += 1

            except asyncio.CancelledError:
                raise

            except Exception:
                logger.exception("Background traffic stopped")
                self.traffic["enabled"] = False
                await self._publish()
                return

            await asyncio.sleep(self.traffic["interval"])

    # --------------------------------------------------
    # Stop and reset
    # --------------------------------------------------

    async def stop(self):
        await self._cancel(self._task)
        await self.set_traffic(False)

    async def reset(self):
        await self.stop()
        self._run_counter = 0
        self.runs = []
        self.traffic["emitted"] = 0
        self.traffic_source = NormalTraffic()

    @staticmethod
    async def _cancel(task):
        if task is None or task.done():
            return

        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass


def _step_delay(interval, payload):
    timestamp = payload.get("timestamp")

    if timestamp and timestamp[:10] != _now().date().isoformat():
        return min(interval, 0.04)
    return interval


def _brief(alert):
    return {
        "id": alert["id"],
        "title": alert["title"],
        "detector": alert["detector"],
        "severity": alert["severity"],
    }
