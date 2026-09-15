#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]


def latest_definition(func: str) -> str:
    """Последняя по номеру миграция, которая определяет функцию.

    Раньше здесь стоял жёсткий путь к 069. Это делало проверку слепой ровно
    тогда, когда она нужнее всего: функцию переопределили миграцией 071, на
    проде работает она, а тест продолжал читать 069 и зеленеть, глядя на файл,
    который больше ничего не решает. Берём последнюю — как их применяет
    migrate.sh, строго по порядку имён.
    """
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    found = [f for f in files if f'function public.{func}(' in f.read_text(encoding='utf-8')]
    if not found:
        raise SystemExit(f'ни одна миграция не определяет {func}')
    return found[-1].read_text(encoding='utf-8')


migration = latest_definition('jm_match_shift_atomic')
db = (root / 'php-proxy/db.php').read_text(encoding='utf-8')
service = (root / 'services/db.ts').read_text(encoding='utf-8')

case_start = db.find("        case 'dbCheckAndCreateMatch': {")
case_end = db.find('        // ── Permanent vacancies', case_start)
case = db[case_start:case_end] if case_start >= 0 and case_end > case_start else ''

service_start = service.find('export async function dbCheckAndCreateMatch(')
service_end = service.find('// ─── Permanent vacancies', service_start)
service_case = service[service_start:service_end] if service_start >= 0 and service_end > service_start else ''

checks = {
    'есть атомарная функция': 'function public.jm_match_shift_atomic(' in migration,
    # Ниже — то, что 069 потеряла вместе с прежним кодом dbCheckAndCreateMatch.
    # Пока этого не было, мэтч состоялся, а смена не набиралась и не
    # закрывалась: она висела в ленте, spots_left всегда обещал полный набор,
    # доля закрытия в дашборде читала нули.
    'мэтч набирает смену': 'update public.jm_vacancies' in migration and 'workers_found = v_found' in migration,
    'набор считается только на новом мэтче': 'if v_match_created then' in migration,
    'смена закрывается при наборе': "status = case when v_found >= v_needed then 'closed' else status end" in migration,
    'строка вакансии блокируется от гонки': 'from public.jm_vacancies' in migration and migration.count('for update;') >= 2,
    'proxy сбрасывает карту сайта при закрытии': "$result['vacancy_closed']" in case and 'sm_cache_invalidate()' in case,
    'строка отклика блокируется': 'from public.jm_likes' in migration and 'for update;' in migration,
    'пара людей сериализуется': 'pg_advisory_xact_lock' in migration,
    'мэтч ставится внутри транзакции': 'set is_match = true' in migration and 'matched_at = now()' in migration,
    'чат создаётся в той же транзакции': 'insert into public.jm_chats' in migration,
    'старый матч без чата ремонтируется': 'v_repaired := not v_match_created;' in migration,
    'системные сообщения идемпотентны': "'shift-match:' || p_vacancy_id" in migration and 'on conflict (id) do nothing;' in migration,
    'RPC закрыт от клиента': 'from public, anon, authenticated;' in migration and 'to service_role;' in migration,
    'proxy проверяет обе реальные стороны': '$callerIsWorker' in case and '$callerIsEmployer' in case,
    'proxy сверяет владельца вакансии': "sb_single('jm_vacancies'" in case and 'Match vacancy mismatch' in case,
    'proxy зовёт атомарный RPC': "sb_rpc('jm_match_shift_atomic'" in case,
    'старые раздельные записи удалены': "sb_update('jm_likes'" not in case and "sb_insert('jm_chats'" not in case,
    'уведомление остаётся после commit': "jt_notify_match((string)$vid" in case and "sb_rpc('jm_match_shift_atomic'" in case and case.find("sb_rpc('jm_match_shift_atomic'") < case.find("jt_notify_match((string)$vid"),
    'selfArg больше не запрещает работодателя': "'dbCheckAndCreateMatch' => 1" not in db,
    'web и native идут через proxy': "proxy<{ matched?: boolean; chatId?: string | null }>(" in service_case and "'dbCheckAndCreateMatch'" in service_case,
    'web не пишет мэтч напрямую': ".from('jm_likes')" not in service_case and ".from('jm_chats')" not in service_case,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('shift match atomicity: ПРОВАЛЫ')
    for name in failed:
        print('  -', name)
    raise SystemExit(1)
print(f'shift match atomicity: ok; {len(checks)} guards')
