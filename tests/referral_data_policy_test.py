#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).parent.parent
legal = (root / "constants" / "legal.ts").read_text()
migration = (root / "supabase" / "migrations" / "064_referral_programme.sql").read_text()

start = legal.index("  dataPolicy: {")
policy = legal[start:]

assert "version: '2026-09-21-3'" in policy
assert "consentVersion: '2026-09-21'" in policy
assert "данные реферальной программы: код приглашения" in policy
assert "связь между пригласившим и приглашённым" in policy
assert "результат первой смены приглашённого" in policy
assert "предоставление поручительства пригласившему" in policy
assert "не требует платёжных, налоговых данных или ИНН" in policy
assert "При удалении любого из связанных аккаунтов" in policy

keys = legal[legal.index("export const LEGAL_KEYS"):legal.index("export function legalVersions")]
assert "dataPolicy" not in keys

assert "invited_by text references public.jm_users(id) on delete set null" in migration
assert "invitee_id" in migration and "on delete cascade" in migration

print("referral_data_policy_test: OK")
