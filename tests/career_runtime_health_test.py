#!/usr/bin/env python3
"""Регрессия production-health для карьерного каталога."""
from pathlib import Path
import json
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
quarantine_path = ROOT / 'scripts/career-runtime-quarantine.json'
quarantine = json.loads(quarantine_path.read_text(encoding='utf-8'))
sync = (ROOT / 'infra/sync-career-catalog.sh').read_text(encoding='utf-8')
smoke = (ROOT / 'scripts/career-runtime-smoke.mjs').read_text(encoding='utf-8')
workflow = (ROOT / '.github/workflows/career-runtime-smoke.yml').read_text(encoding='utf-8')

failures = []

def check(name: str, condition: bool) -> None:
    if not condition:
        failures.append(name)

audited_bad = {
    'https://rabota5ka.ru/api/vacancy/hire-request',
    'https://rabota5ka.ru/gw/api/vacancy/hire-request?portals%5B0%5D=cross',
    'https://rabota.cdek.ru/vacancies',
    'https://www.maria-ra.ru/karera-v-seti/vakansii',
    'https://job.rt.ru/backend/api/vacancies',
    'https://careers.yadro.com/api/v1/vacancies/',
    'https://career.rwb.ru/hr-crm-api/api/v2/pub/vacancies',
    'https://job.mts.ru/api/v2/vacancies',
    'https://job.lamoda.ru/api/hr/vacancies/compact',
    'https://vacancies-app.aviasales.ru/api/vacancies?language=ru',
    'https://job.megafon.ru/api/v1/vacancies',
    'https://bsl.dev/vacancies.html',
    'https://cloud.ru/career/vacancies',
    'https://www.ispring.ru/company/jobs/vacancies',
    'https://1c.ru/rus/firm1c/vacan/search',
    'https://team.vk.company/vacancy',
    'https://career.mvideoeldorado.ru/vacancies',
}

check('quarantine — непустой список', isinstance(quarantine, list) and bool(quarantine))
urls = []
for i, row in enumerate(quarantine):
    check(f'quarantine[{i}] — объект', isinstance(row, dict))
    if not isinstance(row, dict):
        continue
    url = str(row.get('url') or '')
    urls.append(url)
    parsed = urlsplit(url)
    check(f'quarantine[{i}] — HTTPS URL', parsed.scheme == 'https' and bool(parsed.hostname))
    check(f'quarantine[{i}] — есть компания', bool(str(row.get('company') or '').strip()))
    check(f'quarantine[{i}] — есть причина', bool(str(row.get('reason') or '').strip()))
    check(f'quarantine[{i}] — есть дата наблюдения', bool(str(row.get('observed_at') or '').strip()))

check('quarantine URLs уникальны', len(urls) == len(set(urls)))
check('все подтверждённые production-сбои учтены', audited_bad <= set(urls))
check('sync читает quarantine-файл', 'career-runtime-quarantine.json' in sync)
check('sync фильтрует endpoint по точному URL', "q.value->>'url' = expanded.endpoint->>'url'" in sync)
check('quarantine виден в connector_config', "'runtime_quarantine', :'quarantine'::jsonb" in sync)
check('master-list остаётся отдельно', "'catalog_pages', :'catalog_pages'::jsonb" in sync)
check('пустой здоровый runtime запрещён', 'после production-quarantine не осталось карьерных endpoints' in sync)
check('протухшие вакансии карантинной компании выключаются',
      "set active = false" in sync and "v.source_id = 'career_owner'" in sync)

for needle, name in (
    ('has_more === false', 'smoke доходит до terminal page'),
    ('body.next_url', 'smoke следует next_url'),
    ('visited.has(current)', 'smoke ловит цикл'),
    ('failed.length', 'smoke падает на failed'),
    ('skipped.length', 'smoke падает на skipped'),
    ('malformedItems.length', 'smoke проверяет title/HTTPS URL вакансии'),
    ('totalItems < MIN_ITEMS', 'smoke имеет нижний порог вакансий'),
):
    check(name, needle in smoke)

check('workflow запускается ежедневно', 'schedule:' in workflow and 'cron:' in workflow)
check('workflow можно запустить вручную', 'workflow_dispatch:' in workflow)
check('workflow запускает полный smoke', 'node scripts/career-runtime-smoke.mjs' in workflow)

if failures:
    print('career runtime health: ПРОВАЛЫ')
    for item in failures:
        print('  -', item)
    sys.exit(1)
print(f'career runtime health: ok ({len(quarantine)} quarantined endpoints)')
