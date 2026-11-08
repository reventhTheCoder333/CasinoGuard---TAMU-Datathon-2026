
import networkx as nx
from collections import defaultdict


def detect_multiple_accounts(accounts):
    graph = nx.Graph()

    # Map each identifier to the accounts using it
    identifier_map = defaultdict(list)

    for account in accounts:
        account_id = account["account"]

        graph.add_node(account_id)

        for field in ["phone", "email", "payment_card"]:
            identifier = account.get(field)

            if identifier:
                identifier_map[(field, identifier)].append(account_id)

    # Connect accounts that share identifiers
    for (field, identifier), linked_accounts in identifier_map.items():

        if len(linked_accounts) < 2:
            continue

        for i in range(len(linked_accounts)):
            for j in range(i + 1, len(linked_accounts)):

                account_a = linked_accounts[i]
                account_b = linked_accounts[j]

                graph.add_edge(
                    account_a,
                    account_b,
                    shared_identifier=field
                )

    findings = []

    # Find groups of connected accounts
    components = nx.connected_components(graph)

    for component in components:

        if len(component) < 2:
            continue

        component_accounts = sorted(component)

        findings.append({
            "pattern": "multiple_account_activity",
            "accounts": component_accounts,
            "linked_account_count": len(component_accounts),
            "shared_identifiers": [
                {
                    "field": field,
                    "value": identifier,
                    "accounts": sorted(linked_accounts)
                }
                for (field, identifier), linked_accounts
                in identifier_map.items()
                if len(linked_accounts) >= 2
                and linked_accounts[0] in component
            ]
        })

    return findings
