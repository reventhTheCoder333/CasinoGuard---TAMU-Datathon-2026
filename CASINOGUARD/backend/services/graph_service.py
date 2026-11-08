"""Build the transaction network shown on the dashboard, using NetworkX."""

from collections import defaultdict

import networkx as nx

from backend.services.alert_enrichment import DETECTORS
from detectors.constants import is_house_account


SEVERITY_ORDER = {"medium": 1, "high": 2}

# Enough to inspect an edge without sending huge payloads for busy hub edges.
MAX_EDGE_TRANSACTION_IDS = 25


def build_graph(service):
    with service._lock:
        transactions = list(service.transactions)
        alerts = service.get_alerts()
        alert_transactions = {
            alert["id"]: {
                tx["id"] for tx in service.transactions_for_alert(alert)
            }
            for alert in alerts
        }

    graph = nx.MultiDiGraph()

    for tx in transactions:
        graph.add_edge(
            tx["from"],
            tx["to"],
            transaction_id=tx["id"],
            amount=tx["amount"],
            timestamp=tx["timestamp"],
        )

    # Accounts can be flagged before they transact, as with shared identifiers.
    for alert in alerts:
        graph.add_nodes_from(alert["accounts_involved"])

    transaction_alerts = defaultdict(set)

    for alert_id, tx_ids in alert_transactions.items():
        for tx_id in tx_ids:
            transaction_alerts[tx_id].add(alert_id)

    edges = []

    for (source, target), parallel in _group_edges(graph).items():
        ids = [edge["transaction_id"] for edge in parallel]
        edges.append({
            "id": f"{source}->{target}",
            "source": source,
            "target": target,
            "kind": "flow",
            "transaction_count": len(parallel),
            "total_amount": sum(edge["amount"] for edge in parallel),
            "last_timestamp": max(edge["timestamp"] for edge in parallel),
            "transaction_ids": ids[-MAX_EDGE_TRANSACTION_IDS:],
            "alert_ids": sorted({
                alert_id
                for tx_id in ids
                for alert_id in transaction_alerts[tx_id]
            }),
        })

    edges.extend(_identity_edges(alerts))

    return {
        "nodes": _nodes(graph, alerts),
        "edges": edges,
        "data_classification": "synthetic",
    }


def _group_edges(graph):
    grouped = defaultdict(list)

    for source, target, data in graph.edges(data=True):
        grouped[(source, target)].append(data)

    return grouped


def _identity_edges(alerts):
    """Dashed links between accounts that share an identifier."""
    links = {}

    for alert in alerts:
        if alert["detector"] != "multiple_accounts":
            continue

        for shared in alert.get("shared_identifiers", []):
            members = shared["accounts"]

            for i, source in enumerate(members):
                for target in members[i + 1:]:
                    link = links.setdefault((source, target), {
                        "id": f"{source}<->{target}",
                        "source": source,
                        "target": target,
                        "kind": "identity",
                        "shared_fields": [],
                        "transaction_count": 0,
                        "total_amount": 0,
                        "last_timestamp": None,
                        "transaction_ids": [],
                        "alert_ids": [alert["id"]],
                    })
                    link["shared_fields"].append(shared["field"])

    return list(links.values())


def _nodes(graph, alerts):
    cluster_of = {}

    # Group around peer activity: the casino hub would join almost everything.
    peers = nx.Graph()
    peers.add_nodes_from(n for n in graph if not is_house_account(n))
    peers.add_edges_from(
        (source, target)
        for source, target in graph.edges()
        if not is_house_account(source) and not is_house_account(target)
    )

    for index, component in enumerate(nx.connected_components(peers)):
        for account in component:
            cluster_of[account] = index

    alerts_by_account = defaultdict(list)

    for alert in alerts:
        for account in alert["accounts_involved"]:
            alerts_by_account[account].append(alert)

    nodes = []

    for account in graph.nodes:
        sent = sum(
            data["amount"]
            for _, _, data in graph.out_edges(account, data=True)
        )
        received = sum(
            data["amount"]
            for _, _, data in graph.in_edges(account, data=True)
        )
        flagged = alerts_by_account[account]

        nodes.append({
            "id": account,
            "kind": "house" if is_house_account(account) else "account",
            "total_sent": sent,
            "total_received": received,
            "volume": sent + received,
            "transaction_count": graph.degree(account),
            "cluster": cluster_of.get(account),
            "alert_ids": [alert["id"] for alert in flagged],
            "detectors": sorted(
                {alert["detector"] for alert in flagged},
                key=list(DETECTORS).index,
            ),
            "top_severity": max(
                (alert["severity"] for alert in flagged),
                key=SEVERITY_ORDER.get,
                default=None,
            ),
        })

    return nodes
