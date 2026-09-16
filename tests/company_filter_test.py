# Regression guard: company facet must only expose employers with active vacancies.
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
feed = (ROOT / 'app/(tabs)/feed.tsx').read_text(encoding='utf-8')
service = (ROOT / 'services/db.ts').read_text(encoding='utf-8')
db = (ROOT / 'php-proxy/db.php').read_text(encoding='utf-8')
migration = (ROOT / 'supabase/migrations/085_active_company_filter.sql').read_text(encoding='utf-8')

assert "case 'extCompanyOptions'" in db
assert "'extCompanyOptions'" in db.split('$publicFns = [', 1)[1].split('];', 1)[0]
assert "($source['connector_kind'] ?? '') === 'career'" in db
assert "dbGetExternalCompanyOptions" in service
assert "dbGetExternalVacancyPage(offset = 0, limit = 1000, sourceIds?: string[], companies?: string[])" in service
assert "{ companies: filters.companies }" in service
assert "<Text style={fst.label}>Компания</Text>" in feed
assert "options={companyOptions}" in feed
assert "setFilterCompanies(f.companies)" in feed
assert "loadExternalVacancies(externalSelection, companySelection)" in feed
assert "s.connector_kind = 'career'" in migration
assert "v.active = true" in migration
assert "v.kind = 'permanent'" in migration
assert "jsonb_array_elements_text(coalesce(p_filters->'companies'" in migration
print('active company filter: ok')
