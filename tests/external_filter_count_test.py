from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
db = (ROOT / 'php-proxy/db.php').read_text()
service = (ROOT / 'services/db.ts').read_text()
feed = (ROOT / 'app/(tabs)/feed.tsx').read_text()
migration = (ROOT / 'supabase/migrations/061_external_vacancy_filter_count.sql').read_text()

assert "case 'extVacancyCount'" in db
assert "case 'extSourceOptions'" in db
assert "source_id'] = 'in.(" in db
assert "jm_ext_vacancy_filter_count" in migration
assert "returns table(total bigint)" in migration
assert "v.kind = 'permanent'" in migration
assert "s.enabled = true" in migration
assert "count(distinct" in migration
assert "dbCountExternalVacancies" in service
assert "dbGetExternalSourceOptions" in service
assert "createdAt: r.first_seen_at" in service
assert "counting ? 'Считаем вакансии…'" in feed
assert "dbGetExternalVacancyPage(offset, pageSize, sourceIds, companies)" in feed
assert "selectedPartnerSourceIds(filterSources)" in feed

print('external vacancy server filters: ok')
