from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
migration = (root / 'supabase/migrations/013_lock_down_rls.sql').read_text()
guard = (root / 'infra/verify-rls.sh').read_text()
migrate = (root / 'infra/migrate.sh').read_text()

protected = sorted(set(re.findall(r"'((?:jm_)[a-z0-9_]+)'", migration)))
assert protected, 'migration 013 protected-table list not found'

missing = [name for name in protected if f"('{name}')" not in guard]
assert not missing, f'RLS guard is missing tables from migration 013: {missing}'

for needle in (
    "013_lock_down_rls.sql",
    "relrowsecurity",
    "has_table_privilege('anon'",
    "has_table_privilege('authenticated'",
):
    assert needle in guard, f'RLS guard lost required check: {needle}'

assert 'verify-rls.sh' in migrate, 'migration runner no longer invokes the live RLS guard'
assert 'RLS GUARD' in migrate, 'migration runner no longer records RLS guard failures'

print(f'RLS deployment guard covers {len(protected)} protected tables')
