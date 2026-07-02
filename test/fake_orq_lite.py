# Body injected into the fake binary; logs the invocation and simulates a run.
# Uses append mode so multiple invocations in the same workspace (e.g. init then run)
# are recorded in order.
import json
import os
import sys
import time
from pathlib import Path

log_path = Path(os.environ.get("FAKE_LOG", "invocation.json"))
with log_path.open("a") as f:
    f.write(json.dumps({"argv": sys.argv[1:], "cwd": str(Path.cwd())}) + "\n")
time.sleep(float(os.environ.get("FAKE_SLEEP_S", "0")))
print("fake orq-lite done")
sys.exit(int(os.environ.get("FAKE_EXIT_CODE", "0")))
