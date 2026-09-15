#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
migration = (root / 'supabase/migrations/068_atomic_perm_approval.sql').read_text(encoding='utf-8')
db = (root / 'php-proxy/db.php').read_text(encoding='utf-8')
service = (root / 'services/db.ts').read_text(encoding='utf-8')
sheet = (root / 'components/feature/PermApplicationsSheet.tsx').read_text(encoding='utf-8')
matches = (root / 'app/(tabs)/matches.tsx').read_text(encoding='utf-8')

checks = {
    'RPC блокирует отклик': 'from public.jm_perm_applications\n  where id = p_application_id\n  for update;' in migration,
    'RPC меняет статус': "set status = 'approved'" in migration,
    'RPC создаёт чат': 'insert into public.jm_chats' in migration,
    'RPC создаёт первое сообщение': 'insert into public.jm_messages' in migration,
    'сообщение идемпотентно': "'perm-approve:' || v_app.id" in migration and 'on conflict (id) do nothing' in migration,
    'повтор approved допустим': "v_app.status not in ('pending', 'approved')" in migration,
    'RPC закрыт от клиента': 'from public, anon, authenticated' in migration and 'to service_role' in migration,
    'proxy проверяет владельца': "case 'dbApprovePermApplication':" in db and "jt_respond(['error' => 'Это не ваш отклик'], 403)" in db,
    'proxy зовёт атомарный RPC': "sb_rpc('jm_approve_perm_application'" in db,
    'уведомление не ломает commit': 'Основное действие уже атомарно завершено' in db,
    'web тоже идёт через proxy': "proxy<{ chat_id?: string }>('dbApprovePermApplication'" in service,
    'шторка использует один вызов': 'const chatId = await dbApprovePermApplication(app.id, message);' in sheet,
    'мэтчи используют один вызов': 'const chatId = await dbApprovePermApplication(app.id, message);' in matches,
    'шторка больше не делает approve потом chat': "dbSetPermApplicationStatus(app.id, 'approved')" not in sheet and 'dbCreateChat(' not in sheet,
    'мэтчи больше не делают approve потом chat': "dbSetPermApplicationStatus(app.id, 'approved')" not in matches and 'dbCreateChat(' not in matches,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('perm approval atomicity: ПРОВАЛЫ')
    for name in failed:
        print('  -', name)
    raise SystemExit(1)
print(f'perm approval atomicity: ok; {len(checks)} guards')
