#!/usr/bin/env python3
from pathlib import Path

source = (Path(__file__).parent.parent / "app" / "chat-room.tsx").read_text()

approve = source.index("const handleApprove = async")
reject = source.index("const handleRejectConfirmed = async")
block = source[approve:reject]

assert "const result = await dbCheckAndCreateMatch" in block
assert "if (result.matched)" in block
assert "pollRef.current?.();" in block
assert block.index("pollRef.current?.();") > block.index("if (result.matched)")
assert "appendMessages" not in source
assert "У вас мэтч! Вы подошли друг другу" not in source
assert "system_safety" not in block

print("chat_match_refresh_test: OK")
