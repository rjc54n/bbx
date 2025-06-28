# --- BBX Orchestrator Script ---
# Author: Richard Carvell
# Version: 1.0
#
# Description:
# This script runs the full BBX processing pipeline:
#   1. It fetches the latest new listings from the BBX platform using Algolia + BBX APIs
#   2. Then it filters and enriches listings for arbitrage opportunities and sends Slack alerts
#
# Structure:
# - This script should be placed inside the `/scripts` directory
# - It expects the individual stage scripts (e.g., new_listings.py, arbitrage_alert.py) to live alongside it
#
# Output:
# - Generates cleaned, enriched CSV files in the `/data` directory
# - Sends Slack alerts for strong opportunities
#
# Usage:
# Can be run locally or remotely (e.g., via Heroku scheduler):
#   python scripts/run_all.py

import subprocess
import sys
from pathlib import Path

# Get the path of the current file so we can build correct relative paths
BASE_DIR = Path(__file__).parent

def run_script(name, relative_path):
    """
    Runs a script with the given filename located in the same directory as this runner.
    Logs success/failure and exits early if something breaks.
    """
    print(f"\n🚀 Running: {name}")
    try:
        full_path = BASE_DIR / relative_path
        subprocess.run([sys.executable, str(full_path)], check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ {name} failed with exit code {e.returncode}")
        sys.exit(e.returncode)

# --- Pipeline Entry Point ---
if __name__ == "__main__":
    run_script("New Listings Fetch", "new_listings.py")                     # Step 1
    run_script("Arbitrage Alert & Slack Notify", "arbitrage_alert.py")     # Step 2
    print("\n✅ All tasks completed.")



