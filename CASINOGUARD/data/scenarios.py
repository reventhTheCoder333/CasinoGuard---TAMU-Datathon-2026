"""Scenario-based synthetic data for the Databricks pipeline.

Generates a day of realistic, ordinary casino activity and embeds only the
suspicious patterns that were asked for. Detection is not done here: the
`expected` list only describes what was embedded, so a run can be compared
with what the detectors actually found.

The background is shaped so that none of the five detectors should fire on
it. Each rule below names the detector it keeps quiet:

- Deposits go to CASINO or a cage, never to another player.
- Sessions wager 40-90% of the deposit and withdraw at most 35% of it,
  so they are never a rapid cash-out.
- A player's sessions are at least 90 minutes apart and deposits are small,
  so no 60-minute window approaches $10,000 (structuring).
- Peer transfers go from a set of senders to a separate set of recipients
  who never send, so funds can't form a 3-hop chain or a loop.
- Regulars have at most 5 earlier active days, fewer than the 7 days of
  history that unusual-volume detection needs.
"""

import random
from datetime import datetime, time, timedelta, timezone


HOUSE = "CASINO"
CAGES = ["CAGE001", "CAGE002", "CAGE003", "CAGE004"]

SCENARIOS = {
    "transaction_structuring": "Transaction structuring",
    "transaction_chains": "Suspicious transaction chain",
    "rapid_cashouts": "Rapid cash-out",
    "unusual_volume": "Unusual transaction volume",
    "circular_transactions": "Circular transactions",
}

# The value Databricks writes in aml_alerts_gold.pattern for each scenario.
PATTERNS = {
    "transaction_structuring": "transaction_structuring",
    "transaction_chains": "suspicious_transaction_chain",
    "rapid_cashouts": "rapid_cashout",
    "unusual_volume": "unusual_transaction_volume",
    "circular_transactions": "circular_transaction",
}

FULL = "full"


class _Builder:

    def __init__(self, rng, day):
        self.rng = rng
        self.day = day
        self.transactions = []
        self.accounts = {}
        self._used_ids = set()

    # Identifiers -----------------------------------------------------

    def _unique(self, make):
        while True:
            value = make()
            if value not in self._used_ids:
                self._used_ids.add(value)
                return value

    def new_account(self):
        account = self._unique(lambda: f"PLAYER_{self.rng.randint(10000, 99999)}")
        number = account.split("_")[1]
        self.accounts[account] = {
            "account": account,
            "phone": f"555-{self.rng.randint(1000, 9999)}",
            "email": f"player{number}@example.com",
            "payment_card": self._unique(lambda: f"CARD-{self.rng.randint(100000, 999999)}"),
        }
        return account

    def at(self, hour, minute=0, second=0, days_before=0):
        moment = datetime.combine(self.day, time()) + timedelta(
            hours=hour, minutes=minute, seconds=second
        )
        return moment - timedelta(days=days_before)

    def add(self, account, sender, receiver, amount, when, tx_type):
        self.transactions.append({
            "id": self._unique(lambda: f"TX{self.rng.getrandbits(40):010X}"),
            "account": account,
            "from": sender,
            "to": receiver,
            "amount": int(round(amount)),
            "timestamp": when.replace(microsecond=0).isoformat(),
            "type": tx_type,
        })

    # Ordinary activity -------------------------------------------------

    def session(self, player, start):
        """Deposit, play through most of it, sometimes cash out a little."""
        rng = self.rng
        deposit = rng.randrange(100, 1500, 25)
        venue = HOUSE if rng.random() < 0.75 else rng.choice(CAGES)
        self.add(player, player, venue, deposit, start, "deposit")

        moment = start
        remaining = deposit * rng.uniform(0.4, 0.9)

        for _ in range(rng.randint(2, 6)):
            if remaining < 10:
                break
            moment += timedelta(minutes=rng.randint(2, 9), seconds=rng.randint(0, 59))
            bet = min(remaining, deposit * rng.uniform(0.08, 0.25))
            self.add(player, player, HOUSE, bet, moment, "wager")
            remaining -= bet

        if rng.random() < 0.6:
            moment += timedelta(minutes=rng.randint(3, 30))
            payout = deposit * rng.uniform(0.05, 0.35)
            self.add(player, HOUSE, player, payout, moment, "withdrawal")

    def background(self, players=28, regulars=6, transfers=6):
        rng = self.rng
        roster = [self.new_account() for _ in range(players)]

        for player in roster:
            start = self.at(8, rng.randint(0, 120))
            for _ in range(rng.randint(1, 3)):
                if start > self.at(21):
                    break
                self.session(player, start)
                start += timedelta(minutes=rng.randint(90, 240))

        # Regulars visit on a few earlier days; never 7 or more.
        for player in rng.sample(roster, regulars):
            for days_before in rng.sample(range(1, 12), rng.randint(2, 5)):
                self.session(player, self.at(rng.randint(10, 20), rng.randint(0, 59),
                                             days_before=days_before))

        # Small peer transfers. Recipients never send, so no paths form.
        senders, recipients = roster[:transfers], roster[transfers:2 * transfers]
        for sender, recipient in zip(senders, recipients):
            self.add(sender, sender, recipient, rng.randrange(20, 400, 5),
                     self.at(rng.randint(9, 21), rng.randint(0, 59)), "transfer")

    # Suspicious patterns -----------------------------------------------

    def structuring(self):
        rng = self.rng
        player = self.new_account()
        start = self.at(rng.randint(10, 19), rng.randint(0, 59))
        # Exactly three deposits: a fourth would make the pipeline's rolling
        # window report several overlapping alerts for one episode.
        amounts = [rng.randrange(3400, 4900, 50) for _ in range(3)]
        for index, (amount, cage) in enumerate(zip(amounts, rng.sample(CAGES, 3))):
            when = start + timedelta(minutes=index * rng.randint(12, 18))
            self.add(player, player, cage, amount, when, "deposit")
        return {"pattern": PATTERNS["transaction_structuring"], "accounts": [player]}

    def chain(self):
        rng = self.rng
        # Four accounts, three hops: longer chains are also reported as
        # their sub-chains, which would add overlapping alerts.
        accounts = [self.new_account() for _ in range(4)]
        amount = rng.randrange(8000, 15000, 50)
        moment = self.at(rng.randint(10, 19), rng.randint(0, 40))
        for sender, receiver in zip(accounts, accounts[1:]):
            self.add(sender, sender, receiver, amount, moment, "transfer")
            amount *= rng.uniform(0.96, 0.99)
            moment += timedelta(minutes=rng.randint(3, 5), seconds=rng.randint(0, 59))
        return {"pattern": PATTERNS["transaction_chains"], "accounts": accounts}

    def rapid_cashout(self):
        rng = self.rng
        player = self.new_account()
        deposit = rng.randrange(5000, 12000, 100)
        start = self.at(rng.randint(10, 19), rng.randint(0, 59))
        self.add(player, player, HOUSE, deposit, start, "deposit")
        self.add(player, player, HOUSE, deposit * rng.uniform(0.01, 0.05),
                 start + timedelta(minutes=rng.randint(3, 8)), "wager")
        self.add(player, HOUSE, player, deposit * rng.uniform(0.85, 0.97),
                 start + timedelta(minutes=rng.randint(12, 30)), "withdrawal")
        return {"pattern": PATTERNS["rapid_cashouts"], "accounts": [player]}

    def volume(self):
        rng = self.rng
        player = self.new_account()

        # A steady but varied week of history, so the score is meaningful.
        for days_before in range(1, 8):
            for _ in range(rng.randint(2, 3)):
                self.add(player, player, HOUSE, rng.randrange(20, 150, 5),
                         self.at(rng.randint(10, 21), rng.randint(0, 59), days_before=days_before),
                         "wager")

        # The spike: many small wagers on one day, and no withdrawals.
        start = self.at(rng.randint(9, 13), rng.randint(0, 59))
        for index in range(rng.randint(16, 24)):
            self.add(player, player, HOUSE, rng.randrange(20, 150, 5),
                     start + timedelta(minutes=index * rng.randint(4, 12)), "wager")
        return {"pattern": PATTERNS["unusual_volume"], "accounts": [player]}

    def circular(self):
        rng = self.rng
        accounts = [self.new_account() for _ in range(3)]
        amount = rng.randrange(5000, 9500, 50)
        moment = self.at(rng.randint(10, 19), rng.randint(0, 40))
        for index, sender in enumerate(accounts):
            receiver = accounts[(index + 1) % 3]
            self.add(sender, sender, receiver, amount, moment, "transfer")
            amount *= rng.uniform(0.95, 0.99)
            # Hops are spread out so the loop is not also a fast chain.
            moment += timedelta(minutes=rng.randint(20, 45))
        return {"pattern": PATTERNS["circular_transactions"], "accounts": accounts}


EMBEDDERS = {
    "transaction_structuring": _Builder.structuring,
    "transaction_chains": _Builder.chain,
    "rapid_cashouts": _Builder.rapid_cashout,
    "unusual_volume": _Builder.volume,
    "circular_transactions": _Builder.circular,
}


def generate_scenario_data(scenario=FULL, seed=None, now=None):
    """Return (transactions, accounts, expected) for one simulation.

    `scenario` is "full" for all five patterns, or one SCENARIOS key.
    Activity happens on the previous UTC day, so no timestamp is in the
    future whatever time the simulation runs.
    """
    if scenario != FULL and scenario not in SCENARIOS:
        raise ValueError(f"Unknown scenario: {scenario!r}")

    rng = random.Random(seed)
    now = now or datetime.now(timezone.utc)
    builder = _Builder(rng, (now - timedelta(days=1)).date())

    builder.background()

    keys = list(SCENARIOS) if scenario == FULL else [scenario]
    expected = [EMBEDDERS[key](builder) for key in keys]

    transactions = sorted(builder.transactions, key=lambda tx: tx["timestamp"])
    return transactions, list(builder.accounts.values()), expected
