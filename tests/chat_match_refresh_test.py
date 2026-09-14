#!/usr/bin/env python3
from pathlib import Path

source = (Path(__file__).parent.parent / "app" / "chat-room.tsx").read_text()

approve = source.index("const handleApprove = async")
reject = source.index("const handleRejectConfirmed = async")
block = source[approve:reject]

result_at = block.index("const result = await dbCheckAndCreateMatch")
match_flow = block[result_at:]

assert "if (result.matched)" in match_flow
assert "pollRef.current?.();" in match_flow
assert match_flow.index("pollRef.current?.();") > match_flow.index("if (result.matched)")
assert "appendMessages" not in source
assert "У вас мэтч! Вы подошли друг другу" not in source
assert "system_safety" not in block

print("chat_match_refresh_test: OK")
