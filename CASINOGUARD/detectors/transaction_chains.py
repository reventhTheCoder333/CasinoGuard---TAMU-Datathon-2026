
import networkx as nx
from datetime import datetime

from detectors.constants import is_house_account


def detect_suspicious_chains(
    transactions,
    min_hops=3,
    max_hops=5,
    max_time_minutes=15,
    amount_similarity=0.80
):
    # A multigraph keeps repeat transfers between the same two accounts, so a
    # later transfer cannot overwrite the evidence for an earlier chain.
    graph = nx.MultiDiGraph()

    # Add transactions as directed edges
    for tx in transactions:
        if is_house_account(tx["from"]) or is_house_account(tx["to"]):
            continue

        graph.add_edge(
            tx["from"],
            tx["to"],
            amount=tx["amount"],
            time=datetime.fromisoformat(tx["timestamp"]),
            transaction_id=tx["id"]
        )

    findings = []

    def amounts_are_similar(amounts):
        return min(amounts) / max(amounts) >= amount_similarity

    def next_hop(current, neighbor, edges):
        """Earliest transfer that plausibly continues the chain."""
        start_time = edges[0]["time"]
        last_time = edges[-1]["time"]
        amounts = [edge["amount"] for edge in edges]

        candidates = sorted(
            graph[current][neighbor].values(),
            key=lambda edge: edge["time"]
        )

        for edge in candidates:
            elapsed = (edge["time"] - start_time).total_seconds() / 60

            # Funds can only move forward in time.
            if (
                edge["time"] >= last_time
                and elapsed <= max_time_minutes
                and amounts_are_similar(amounts + [edge["amount"]])
            ):
                return edge

        return None

    # Depth First Search
    def dfs(path, edges):
        hops = len(edges)

        # Check whether the path has enough hops. Time and amount conditions
        # are enforced while extending the path, in next_hop().
        if hops >= min_hops:
            times = [edge["time"] for edge in edges]
            amounts = [edge["amount"] for edge in edges]

            findings.append({
                "pattern": "suspicious_transaction_chain",
                "accounts": path.copy(),
                "transaction_ids": [
                    edge["transaction_id"] for edge in edges
                ],
                "total_amount": sum(amounts),
                "elapsed_minutes": (
                    max(times) - min(times)
                ).total_seconds() / 60,
                "amount_similarity": round(min(amounts) / max(amounts), 2)
            })

        # Stop searching when maximum hops are reached
        if hops >= max_hops:
            return

        # Explore neighboring accounts
        current = path[-1]

        for neighbor in graph.successors(current):
            if neighbor in path:
                continue

            edge = next_hop(current, neighbor, edges)

            if edge is not None:
                dfs(path + [neighbor], edges + [edge])

    # Start DFS from every transfer
    for source, destination, edge in list(graph.edges(data=True)):
        dfs([source, destination], [edge])

    return findings
