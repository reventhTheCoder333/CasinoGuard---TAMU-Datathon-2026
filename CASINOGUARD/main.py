
from data.transactions import generate_synthetic_data
from engine.detection_engine import run_all_detectors


transactions, accounts = generate_synthetic_data()

report = run_all_detectors(transactions, accounts)

print("\n========== CASINOGUARD DETECTION REPORT ==========")

print("Total transactions:", len(transactions))
print("Total accounts:", len(accounts))
print("Total alerts:", report["total_alerts"])

print("\n========== DETECTOR SUMMARY ==========")

for detector, count in report["detector_summary"].items():
    print(f"{detector}: {count}")

print("\n========== FINDINGS ==========")

for alert in report["alerts"]:
    print(f"\nPattern: {alert['pattern']}")
    print(f"Detector: {alert['detector']}")
    print(f"Evidence: {alert}")
