
import logging

from detectors.transaction_chains import detect_suspicious_chains
from detectors.transaction_structuring import detect_structuring
from detectors.rapid_cashout import detect_rapid_cashouts
from detectors.unusual_volume import detect_unusual_volume
from detectors.circular_transactions import detect_circular_transactions
from detectors.multiple_accounts import detect_multiple_accounts

logger = logging.getLogger("casinoguard.engine")


def run_all_detectors(transactions, accounts):
    """
    Run all six CASINOGUARD detection algorithms.

    Args:
        transactions: List of transaction dictionaries.
        accounts: List of account dictionaries.

    Returns:
        Dictionary containing individual detector results
        and a unified list of alerts.
    """

    detectors = {
        "transaction_chains": (detect_suspicious_chains, transactions),
        "transaction_structuring": (detect_structuring, transactions),
        "rapid_cashouts": (detect_rapid_cashouts, transactions),
        "unusual_volume": (detect_unusual_volume, transactions),
        "circular_transactions": (detect_circular_transactions, transactions),
        "multiple_accounts": (detect_multiple_accounts, accounts)
    }

    # Run each detector. One failing must not blind the other five.
    results = {}
    detector_errors = {}

    for detector_name, (detector, data) in detectors.items():
        try:
            results[detector_name] = detector(data)

        except Exception as error:
            logger.exception("Detector %s failed", detector_name)
            results[detector_name] = []
            detector_errors[detector_name] = str(error)

    # Combine all findings into one alert list
    alerts = []

    for detector_name, findings in results.items():

        for finding in findings:

            alert = {
                "detector": detector_name,
                **finding
            }

            alerts.append(alert)

    return {
        "total_alerts": len(alerts),
        "detector_summary": {
            detector_name: len(findings)
            for detector_name, findings in results.items()
        },
        "alerts": alerts,
        "detector_errors": detector_errors
    }
