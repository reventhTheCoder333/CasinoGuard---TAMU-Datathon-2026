import os

# Tests use local detection, whatever a developer's .env selects.
os.environ["CASINOGUARD_DATA_SOURCE"] = "local"
