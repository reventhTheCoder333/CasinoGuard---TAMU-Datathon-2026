"""Shared detector configuration."""

# The operator's own ledger accounts. They legitimately touch almost every
# player, so treating them as ordinary participants produces false positives
# (payouts summed as "structuring", paths and loops routed through the hub).
HOUSE_ACCOUNT = "CASINO"
HOUSE_PREFIXES = ("CAGE",)


def is_house_account(account):
    """Return True for the casino's own ledger and cage accounts."""
    return account == HOUSE_ACCOUNT or str(account).startswith(HOUSE_PREFIXES)
