import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


@unittest.skipUnless(sys.platform.startswith("linux"), "Entware/Linux process tests")
class Supervisor(unittest.TestCase):
    def test_recovers_crash_and_hang_and_blocks_duplicate(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            shutil.copyfile(
                Path(__file__).resolve().parents[1] / "supervisor.py",
                base / "supervisor.py",
            )
            (base / "router_worker.py").write_text(
                'import os,time\nfrom pathlib import Path\nPath(os.environ["RETHAVO_HEARTBEAT"]).touch()\ntime.sleep(600)\n'
            )
            env = {
                **os.environ,
                "RETHAVO_STATE_DIR": folder,
                "RETHAVO_STALL_SECONDS": "2",
            }
            process = subprocess.Popen(
                [sys.executable, str(base / "supervisor.py")], env=env
            )
            try:

                def wait_for(predicate, timeout=18):
                    end = time.monotonic() + timeout
                    while time.monotonic() < end:
                        try:
                            value = json.loads(
                                (base / "rethavo-worker-status.json").read_text()
                            )
                            if predicate(value):
                                return value
                        except (FileNotFoundError, json.JSONDecodeError):
                            pass
                        time.sleep(0.2)
                    self.fail("Supervisor did not reach expected state")

                first = wait_for(lambda status: status["restarts"] == 0)
                duplicate = subprocess.run(
                    [sys.executable, str(base / "supervisor.py")], env=env, timeout=3
                )
                self.assertEqual(duplicate.returncode, 0)
                self.assertEqual(
                    json.loads((base / "rethavo-worker-status.json").read_text())[
                        "supervisorPid"
                    ],
                    process.pid,
                )
                os.kill(first["workerPid"], signal.SIGKILL)
                second = wait_for(lambda status: status["restarts"] >= 1)
                self.assertNotEqual(first["workerPid"], second["workerPid"])
                third = wait_for(lambda status: status["restarts"] >= 2)
                self.assertNotEqual(second["workerPid"], third["workerPid"])
                self.assertIn(
                    "Worker stalled", (base / "rethavo-supervisor.log").read_text()
                )
            finally:
                process.terminate()
                process.wait(timeout=8)
            self.assertFalse((base / "rethavo-worker-supervisor.pid").exists())
            self.assertFalse((base / "rethavo-worker-status.json").exists())
