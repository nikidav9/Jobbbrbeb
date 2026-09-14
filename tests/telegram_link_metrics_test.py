#!/usr/bin/env python3
import importlib.util
import json
import tempfile
from pathlib import Path

root = Path(__file__).parent.parent
path = root / "infra" / "tg-poll.py"
spec = importlib.util.spec_from_file_location("tg_poll", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    module.STATS_FILE = str(Path(tmp) / "stats.json")
    module.record_api_result([("ipv6", False), ("fallback", True)], True, "fallback", "")
    module.record_api_result([("ipv6", False), ("fallback", False)], False, "none", "timeout")
    module.record_api_result([("ipv6", True)], True, "ipv6", "")

    stats = json.loads(Path(module.STATS_FILE).read_text())
    assert stats["requests"] == 3
    assert stats["ok"] == 2
    assert stats["failed"] == 1
    assert stats["ipv6_attempts"] == 3
    assert stats["ipv6_reached"] == 1
    assert stats["fallback_attempts"] == 2
    assert stats["fallback_reached"] == 1
    assert stats["consecutive_failures"] == 0
    assert stats["last_mode"] == "ipv6"

source = path.read_text()
failure = source.index('if not r.get("ok")')
beat = source.index('with open(BEAT_FILE', failure)
loop = source.index('for upd in r.get("result"', failure)
assert failure < beat < loop
assert 'error.replace(token, "[token]")' in source

report = (root / "infra" / "report.sh").read_text()
assert "телеграм_связь" in report
assert "ipv6_reached" in report
assert "fallback_reached" in report

print("telegram link metrics: OK")
