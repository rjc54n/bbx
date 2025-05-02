import subprocess
import sys

def run_script(name, path):
    print(f"\n🚀 Running: {name}")
    try:
        subprocess.run([sys.executable, path], check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ {name} failed with exit code {e.returncode}")
        sys.exit(e.returncode)

if __name__ == "__main__":
    run_script("New Listings Fetch", "new_listings.py")
    run_script("Arbitrage Alert & Slack Notify", "arbitrage_alert.py")
    print("\n✅ All tasks completed.")


