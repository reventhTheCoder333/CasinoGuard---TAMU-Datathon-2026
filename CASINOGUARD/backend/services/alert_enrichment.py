"""Turn raw detector findings into explainable alerts.

Nothing here decides whether an alert exists: only the detectors do. These
functions describe a finding using the values the detector returned and the
thresholds it actually ran with (read from its signature so they cannot drift).
"""

import inspect

from detectors.circular_transactions import detect_circular_transactions
from detectors.multiple_accounts import detect_multiple_accounts
from detectors.rapid_cashout import detect_rapid_cashouts
from detectors.transaction_chains import detect_suspicious_chains
from detectors.transaction_structuring import detect_structuring
from detectors.unusual_volume import detect_unusual_volume


DISCLAIMER = (
    "This alert is an automated suspicious indicator, not proof of wrongdoing. "
    "It requires review by a qualified analyst before any action is taken."
)


def _defaults(function):
    return {
        name: parameter.default
        for name, parameter in inspect.signature(function).parameters.items()
        if parameter.default is not inspect.Parameter.empty
    }


DETECTORS = {
    "transaction_chains": {
        "label": "Suspicious chains",
        "description": "Similar amounts passed quickly through a line of accounts.",
        "parameters": _defaults(detect_suspicious_chains),
    },
    "transaction_structuring": {
        "label": "Structuring",
        "description": "Several sub-threshold transactions that together cross it.",
        "parameters": _defaults(detect_structuring),
    },
    "rapid_cashouts": {
        "label": "Rapid cash-outs",
        "description": "Most of a deposit withdrawn soon after, with little play.",
        "parameters": _defaults(detect_rapid_cashouts),
    },
    "unusual_volume": {
        "label": "Unusual volume",
        "description": "Daily transaction count far above the account's history.",
        "parameters": _defaults(detect_unusual_volume),
    },
    "circular_transactions": {
        "label": "Circular flows",
        "description": "Funds that loop through accounts back to the origin.",
        "parameters": _defaults(detect_circular_transactions),
    },
    "multiple_accounts": {
        "label": "Multiple accounts",
        "description": "Separate accounts sharing a phone, email or payment card.",
        "parameters": _defaults(detect_multiple_accounts),
    },
}


GUIDANCE = {
    "transaction_chains": {
        "alternatives": [
            "Accounts in one family or business moving funds between themselves.",
            "A shared payment service or agent routing ordinary transfers.",
        ],
        "next_steps": [
            "Check who controls each account in the path and how they are related.",
            "Trace where the funds came from and where the final account sent them.",
            "Compare with each account's earlier transfer behaviour.",
        ],
    },
    "transaction_structuring": {
        "alternatives": [
            "A player topping up repeatedly during one long session.",
            "Deposits at several cages because of table moves or queue lengths.",
        ],
        "next_steps": [
            "Review the source of funds and cage records for each transaction.",
            "Check for similar patterns from this account on earlier days.",
            "Refer to the compliance team to assess any reporting obligations.",
        ],
    },
    "rapid_cashouts": {
        "alternatives": [
            "A player who changed their plans or left early.",
            "A deposit made in error and then returned.",
        ],
        "next_steps": [
            "Compare the deposit method with the withdrawal method.",
            "Review the session record to confirm how much was actually played.",
            "Check whether this account has repeated the deposit-withdraw cycle.",
        ],
    },
    "unusual_volume": {
        "alternatives": [
            "A tournament, promotion or special event on that date.",
            "A change in the player's habits, such as a holiday visit.",
        ],
        "next_steps": [
            "Check the date against the promotions and events calendar.",
            "Look at the amounts and counterparties behind the increase.",
            "Confirm the account is not being operated by someone new.",
        ],
    },
    "circular_transactions": {
        "alternatives": [
            "Friends or relatives settling shared expenses or repaying loans.",
            "Corrections or reversals recorded as new transfers.",
        ],
        "next_steps": [
            "Establish the stated purpose of each transfer in the loop.",
            "Check whether the accounts share owners, devices or identifiers.",
            "Look for the same loop recurring, which would suggest a routine.",
        ],
    },
    "multiple_accounts": {
        "alternatives": [
            "Members of one household sharing a phone number or payment card.",
            "Old contact details reused after an account was closed.",
        ],
        "next_steps": [
            "Verify identity documents for each linked account.",
            "Review activity across the linked accounts as a combined total.",
            "Check whether the casino's policies allow this link.",
        ],
    },
}


FIELD_LABELS = {
    "phone": "phone number",
    "email": "email address",
    "payment_card": "payment card",
}


def money(value):
    return f"${value:,.0f}"


def _rule(label, observed, comparator, threshold, unit=""):
    checks = {
        ">=": lambda: observed >= threshold,
        "<=": lambda: observed <= threshold,
    }
    return {
        "label": label,
        "observed": observed,
        "comparator": comparator,
        "threshold": threshold,
        "unit": unit,
        "met": bool(checks[comparator]()),
    }


# --------------------------------------------------
# Per-detector descriptions
# --------------------------------------------------

def _describe_chain(finding):
    hops = len(finding["accounts"]) - 1
    total = finding["total_amount"]
    severity = "high" if hops >= 4 or total >= 25000 else "medium"
    return {
        "title": f"{hops}-hop chain from {finding['accounts'][0]}",
        "summary": (
            f"{money(total)} moved through {' → '.join(finding['accounts'])} "
            f"in {finding['elapsed_minutes']:.0f} minutes, with each hop "
            f"similar in size."
        ),
        "severity": severity,
        "severity_reason": (
            f"{hops} hops and {money(total)} in total "
            "(high from 4 hops or $25,000)."
        ),
        "exposure": total,
    }


def _describe_structuring(finding):
    total = finding["total_amount"]
    return {
        "title": f"Possible structuring by {finding['account']}",
        "summary": (
            f"{finding['transaction_count']} transactions, each below the "
            f"threshold, totalled {money(total)} within "
            f"{finding['window_minutes']} minutes."
        ),
        "severity": "high" if total >= 25000 else "medium",
        "severity_reason": f"{money(total)} in total (high from $25,000).",
        "exposure": total,
    }


def _describe_cashout(finding):
    ratio = finding["cashout_ratio"]
    deposit = finding["deposit_amount"]
    severity = "high" if ratio >= 0.95 and deposit >= 5000 else "medium"
    return {
        "title": f"Rapid cash-out by {finding['account']}",
        "summary": (
            f"{ratio:.0%} of a {money(deposit)} deposit was withdrawn after "
            f"{finding['elapsed_minutes']:.0f} minutes, with only "
            f"{money(finding['total_wagered'])} wagered."
        ),
        "severity": severity,
        "severity_reason": (
            f"{ratio:.0%} withdrawn from {money(deposit)} "
            "(high from 95% of $5,000)."
        ),
        "exposure": deposit,
    }


def _describe_volume(finding):
    count = finding["transaction_count"]
    average = finding["historical_average"]
    multiple = count / average if average else count
    return {
        "title": f"Unusual volume on {finding['account']}",
        "summary": (
            f"{count} transactions on {finding['date']}, about "
            f"{multiple:.1f}× the account's usual {average:g} per active day."
        ),
        "severity": "high" if multiple >= 5 else "medium",
        "severity_reason": f"{multiple:.1f}× the usual count (high from 5×).",
        "exposure": None,
    }


def _describe_circular(finding):
    total = finding["total_amount"]
    accounts = finding["accounts"]
    return {
        "title": f"Circular flow across {len(set(accounts))} accounts",
        "summary": (
            f"{money(total)} in transfers formed a loop: "
            f"{' → '.join(accounts + accounts[:1])}."
        ),
        "severity": "high" if total >= 10000 else "medium",
        "severity_reason": f"{money(total)} in the loop (high from $10,000).",
        "exposure": total,
    }


def _describe_multiple(finding):
    count = finding["linked_account_count"]
    fields = sorted({
        FIELD_LABELS.get(shared["field"], shared["field"])
        for shared in finding.get("shared_identifiers", [])
    })
    shared_text = ", ".join(fields) or "identifiers"
    return {
        "title": f"{count} linked accounts",
        "summary": (
            f"{', '.join(finding['accounts'])} are linked by a shared "
            f"{shared_text}."
        ),
        "severity": "high" if count >= 4 else "medium",
        "severity_reason": f"{count} linked accounts (high from 4).",
        "exposure": None,
    }


_DESCRIBERS = {
    "transaction_chains": _describe_chain,
    "transaction_structuring": _describe_structuring,
    "rapid_cashouts": _describe_cashout,
    "unusual_volume": _describe_volume,
    "circular_transactions": _describe_circular,
    "multiple_accounts": _describe_multiple,
}


def describe(finding):
    return _DESCRIBERS[finding["detector"]](finding)


def accounts_involved(finding):
    if "accounts" in finding:
        return list(finding["accounts"])
    return [finding["account"]]


def why_flagged(finding, params=None):
    """Each condition the detector tested: observed value against threshold.

    `params` are the thresholds the detector actually ran with, when the
    source records them. Missing values fall back to the local defaults.
    """
    detector = finding["detector"]
    params = {**DETECTORS[detector]["parameters"], **(params or {})}

    if detector == "transaction_chains":
        return [
            _rule("Hops in the chain", len(finding["accounts"]) - 1, ">=", params["min_hops"]),
            _rule("Time from first to last hop", round(finding["elapsed_minutes"], 2), "<=", params["max_time_minutes"], "min"),
            _rule("Smallest ÷ largest amount", finding["amount_similarity"], ">=", params["amount_similarity"]),
        ]
    if detector == "transaction_structuring":
        return [
            _rule("Total in the time window", finding["total_amount"], ">=", params["threshold"], "$"),
            _rule("Transactions in the window", finding["transaction_count"], ">=", params["min_transactions"]),
            _rule("Length of the window", finding["window_minutes"], "<=", params["window_minutes"], "min"),
        ]
    if detector == "rapid_cashouts":
        return [
            _rule("Share of deposit withdrawn", finding["cashout_ratio"], ">=", params["min_cashout_ratio"]),
            _rule("Share of deposit wagered", finding["wager_ratio"], "<=", params["max_wager_ratio"]),
            _rule("Minutes to first withdrawal", finding["elapsed_minutes"], "<=", params["max_time_minutes"], "min"),
        ]
    if detector == "unusual_volume":
        return [
            _rule("Z-score against history", finding["z_score"], ">=", params["z_score_threshold"]),
        ]
    if detector == "circular_transactions":
        distinct = len(set(finding["accounts"]))
        return [
            _rule("Distinct accounts in the loop", distinct, ">=", params["min_accounts"]),
            _rule("Distinct accounts in the loop", distinct, "<=", params["max_accounts"]),
        ]
    return [
        _rule("Accounts linked by shared identifiers", finding["linked_account_count"], ">=", 2),
    ]


def detector_notes(finding):
    """Caveats an analyst needs in order to read the numbers correctly."""
    if (
        finding["detector"] == "unusual_volume"
        and finding.get("historical_std_dev") == 0
    ):
        return [
            "This account's history has no variation, so a true z-score cannot "
            "be calculated. The detector reports a nominal score just above "
            "the threshold whenever the count exceeds the historical average."
        ]
    if finding["detector"] == "circular_transactions":
        return [
            "This detector does not apply a time limit: loop transfers may be "
            "far apart. Check the dates in the timeline."
        ]
    return []
