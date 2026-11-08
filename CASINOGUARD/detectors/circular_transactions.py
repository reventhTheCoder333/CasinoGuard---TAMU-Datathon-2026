
import networkx as nx

from detectors.constants import is_house_account


def detect_circular_transactions(
    transactions,
    min_accounts=3,
    max_accounts=6
):
    graph = nx.DiGraph()

    # Build the directed transaction graph
    for tx in transactions:
        # Deposits and payouts through the casino are not peer-to-peer loops.
        if is_house_account(tx["from"]) or is_house_account(tx["to"]):
            continue

        graph.add_edge(
            tx["from"],
            tx["to"],
            amount=tx["amount"],
            transaction_id=tx["id"]
        )

    findings = []

    # Find all simple cycles
    cycles = nx.simple_cycles(graph, length_bound=max_accounts)

    for cycle in cycles:

        # Filter cycles by number of accounts
        if not (min_accounts <= len(cycle) <= max_accounts):
            continue

        # Start from the smallest account so the same loop is always reported
        # identically, regardless of graph iteration order.
        start = cycle.index(min(cycle))
        cycle = cycle[start:] + cycle[:start]

        # Retrieve transactions forming the cycle
        edges = []

        for i in range(len(cycle)):
            source = cycle[i]
            destination = cycle[(i + 1) % len(cycle)]

            edges.append(graph[source][destination])

        findings.append({
            "pattern": "circular_transaction",
            "accounts": cycle,
            "transaction_ids": [
                edge["transaction_id"] for edge in edges
            ],
            "total_amount": sum(
                edge["amount"] for edge in edges
            )
        })

    return findings
