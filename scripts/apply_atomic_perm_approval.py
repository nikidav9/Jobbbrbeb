from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# ── Database transaction: status + chat + first employer message. ─────────────
migration = Path('supabase/migrations/068_atomic_perm_approval.sql')
if migration.exists():
    raise SystemExit('migration 068 already exists')
migration.write_text(r'''-- Одобрение отклика на постоянную вакансию — одна транзакция.
--
-- Раньше клиент сначала ставил status=approved, а вторым HTTP-запросом создавал
-- чат и первое сообщение директора. Обрыв между запросами оставлял человека
-- «одобренным», но без разговора. Повторное нажатие уже не всегда было доступно.
--
-- Блокируем сам отклик: повторные одобрения одной заявки сериализованы. Чаты
-- намеренно не получают новый UNIQUE — в живой истории могли остаться старые
-- дубли, и миграция не должна ради нового действия ломать весь deploy.

create or replace function public.jm_approve_perm_application(
  p_application_id text,
  p_employer_id text,
  p_chat_id text,
  p_message text
)
returns table(
  chat_id text,
  status_changed boolean,
  chat_created boolean,
  message_created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.jm_perm_applications%rowtype;
  v_chat_id text;
  v_title text := '';
  v_company text := '';
  v_status_changed boolean := false;
  v_chat_created boolean := false;
  v_message_created boolean := false;
  v_rows integer := 0;
begin
  if nullif(btrim(coalesce(p_application_id, '')), '') is null then
    raise exception 'application id is required';
  end if;
  if nullif(btrim(coalesce(p_employer_id, '')), '') is null then
    raise exception 'employer id is required';
  end if;
  if nullif(btrim(coalesce(p_chat_id, '')), '') is null then
    raise exception 'chat id is required';
  end if;
  if nullif(btrim(coalesce(p_message, '')), '') is null then
    raise exception 'approval message is required';
  end if;
  if char_length(p_message) > 4000 then
    raise exception 'approval message is too long';
  end if;

  select * into v_app
  from public.jm_perm_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'application not found';
  end if;
  if v_app.employer_id is distinct from p_employer_id then
    raise exception 'application owner mismatch';
  end if;
  if v_app.status not in ('pending', 'approved') then
    raise exception 'application cannot be approved from status %', v_app.status;
  end if;

  if v_app.status = 'pending' then
    update public.jm_perm_applications
       set status = 'approved'
     where id = v_app.id;
    v_status_changed := true;
  end if;

  -- JobToo исторически держит один разговор на пару людей. Берём уже
  -- существующий разговор независимо от того, по какой их вакансии он возник.
  select c.id into v_chat_id
  from public.jm_chats c
  where c.worker_id = v_app.worker_id
    and c.employer_id = v_app.employer_id
  order by c.created_at asc, c.id asc
  limit 1
  for update;

  if v_chat_id is null then
    select coalesce(v.title, ''), coalesce(v.company, '')
      into v_title, v_company
    from public.jm_perm_vacancies v
    where v.id = v_app.vacancy_id;

    insert into public.jm_chats (
      id, vacancy_id, worker_id, employer_id,
      vac_title, company_name, unread_worker, unread_employer,
      created_at, is_locked
    ) values (
      p_chat_id, v_app.vacancy_id, v_app.worker_id, v_app.employer_id,
      coalesce(v_title, ''), coalesce(v_company, ''), 0, 0,
      now(), false
    );
    v_chat_id := p_chat_id;
    v_chat_created := true;
  end if;

  -- При обычном переходе pending→approved сообщение обязательно. Если это
  -- повтор после потерянного HTTP-ответа, status уже approved и сообщение
  -- лежит в той же транзакции — второй раз его не пишем. Отдельно чиним
  -- старое частичное состояние «approved, но чата нет»: новый чат получает
  -- сообщение, иначе ремонт был бы снова наполовину.
  if v_status_changed or v_chat_created then
    insert into public.jm_messages (id, chat_id, sender_id, text, created_at)
    values ('perm-approve:' || v_app.id, v_chat_id, v_app.employer_id, p_message, now())
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;
    v_message_created := v_rows > 0;

    if v_message_created then
      update public.jm_chats
         set unread_worker = coalesce(unread_worker, 0) + 1
       where id = v_chat_id;
    end if;
  end if;

  return query select v_chat_id, v_status_changed, v_chat_created, v_message_created;
end;
$$;

revoke all on function public.jm_approve_perm_application(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.jm_approve_perm_application(text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
''', encoding='utf-8')


# ── Server endpoint. Core DB work is atomic; notifications are post-commit. ───
replace_once(
    'php-proxy/db.php',
    'function jt_perm_app_announce(array $app, string $status): void\n{',
    'function jt_perm_app_announce(array $app, string $status, bool $writeChat = true): void\n{',
    'perm announcement optional chat write',
)
replace_once(
    'php-proxy/db.php',
    """    if ($employerId === '') return;
    $chat = sb_single('jm_chats',
""",
    """    if (!$writeChat || $employerId === '') return;
    $chat = sb_single('jm_chats',
""",
    'perm announcement chat guard',
)

new_case = r'''        // Одобрение постоянного отклика: статус, чат и первое сообщение —
        // одна транзакция в БД. Два последовательных HTTP-запроса оставляли
        // status=approved без чата при обрыве между ними.
        // args: [applicationId, firstEmployerMessage]
        case 'dbApprovePermApplication': {
            $appId = trim((string)($args[0] ?? ''));
            $message = trim((string)($args[1] ?? ''));
            if ($appId === '' || $message === '') {
                jt_respond(['error' => 'Нужны отклик и сообщение'], 400); exit;
            }
            if (mb_strlen($message) > 4000) {
                jt_respond(['error' => 'Сообщение слишком длинное'], 400); exit;
            }

            $app = sb_single('jm_perm_applications', ['id' => 'eq.' . $appId]);
            if (!$app) { jt_respond(['error' => 'Отклик не найден'], 404); exit; }
            if ((string)($app['employer_id'] ?? '') !== (string)$authUid) {
                jt_respond(['error' => 'Это не ваш отклик'], 403); exit;
            }

            $rows = sb_rpc('jm_approve_perm_application', [
                'p_application_id' => $appId,
                'p_employer_id' => (string)$authUid,
                'p_chat_id' => uid(),
                'p_message' => $message,
            ]);
            $result = $rows[0] ?? null;
            if (!is_array($result) || empty($result['chat_id'])) {
                throw new RuntimeException('Не удалось создать чат одобрения');
            }

            // Уведомления не являются частью транзакции: внешний push/Telegram
            // не должен откатывать уже подтверждённое решение. При новом
            // одобрении сообщаем о решении, но системную строку в чат не пишем:
            // личное сообщение директора уже создано той же транзакцией.
            try {
                if (!empty($result['status_changed'])) {
                    jt_perm_app_announce($app, 'approved', false);
                }
                if (!empty($result['message_created'])) {
                    $chatRow = sb_single('jm_chats', ['id' => 'eq.' . (string)$result['chat_id']],
                        'id,worker_id,employer_id');
                    if ($chatRow) jt_notify_new_message($chatRow, (string)$authUid, $message);
                }
            } catch (Throwable $e) {
                // Основное действие уже атомарно завершено; сбой внешней
                // доставки не превращаем в ложное «одобрение не удалось».
            }

            $data = ['chat_id' => (string)$result['chat_id']];
            break;
        }

'''
replace_once(
    'php-proxy/db.php',
    "        case 'dbSetPermApplicationStatus': {",
    new_case + "        case 'dbSetPermApplicationStatus': {",
    'atomic approval handler insertion',
)


# ── Client wrapper always uses the authenticated proxy, including web. ─────────
service_anchor = """export async function dbSetPermApplicationStatus(appId: string, status: PermApplicationStatus): Promise<void> {
"""
service_func = """/**
 * Одобрить кандидата и открыть разговор одним серверным действием.
 *
 * Всегда через proxy, даже в web: status + chat + первое сообщение должны
 * коммититься одной транзакцией, чего два прямых Supabase-запроса не дают.
 */
export async function dbApprovePermApplication(appId: string, message: string): Promise<string> {
  const d = await proxy<{ chat_id?: string }>('dbApprovePermApplication', [appId, message]);
  if (!d?.chat_id) throw new Error('Не удалось открыть чат после одобрения');
  return d.chat_id;
}

"""
replace_once('services/db.ts', service_anchor, service_func + service_anchor, 'service approval wrapper')


# ── Both employer surfaces call the one atomic operation. ─────────────────────
replace_once(
    'components/feature/PermApplicationsSheet.tsx',
    """import {
  dbSetPermApplicationStatus,
  dbCreateChat,
} from '@/services/db';
""",
    """import {
  dbApprovePermApplication,
  dbSetPermApplicationStatus,
} from '@/services/db';
""",
    'sheet imports atomic approval',
)
replace_once(
    'components/feature/PermApplicationsSheet.tsx',
    """      // Уведомление соискателю шлёт сервер тем же запросом, что меняет статус
      // (jt_perm_app_announce). Отсюда оно уходило «выстрелил и забыл».
      await dbSetPermApplicationStatus(app.id, 'approved');
      const chatId = await dbCreateChat(
        app.workerId,
        currentUser.id,
        app.vacancyId,
        vacancy.title,
        vacancy.company,
        message,
        1,
        0,
        'employer',
      );
""",
    """      // Статус, чат и первое сообщение теперь коммитятся одной транзакцией.
      // Обрыв связи больше не оставляет «Одобрено» без разговора.
      const chatId = await dbApprovePermApplication(app.id, message);
""",
    'sheet atomic approval call',
)

replace_once(
    'app/(tabs)/matches.tsx',
    """  dbUpsertLike, dbCheckAndCreateMatch, dbSetShiftOutcome,
  dbSetPermApplicationStatus, dbCreateChat, dbGetPartnerApplications,
""",
    """  dbUpsertLike, dbCheckAndCreateMatch, dbSetShiftOutcome,
  dbApprovePermApplication, dbSetPermApplicationStatus, dbGetPartnerApplications,
""",
    'matches imports atomic approval',
)
replace_once(
    'app/(tabs)/matches.tsx',
    """      // Уведомление соискателю шлёт сервер тем же запросом: отсюда оно
      // уходило «выстрелил и забыл» и терялось при любом обрыве связи.
      await dbSetPermApplicationStatus(app.id, 'approved');
      const chatId = await dbCreateChat(
        app.workerId,
        currentUser.id,
        app.vacancyId,
        vacancy.title,
        vacancy.company,
        message,
        1,
        0,
        'employer',
      );
""",
    """      // Статус, чат и первое сообщение — одна серверная транзакция.
      // Повтор после потерянного ответа идемпотентен и не плодит сообщения.
      const chatId = await dbApprovePermApplication(app.id, message);
""",
    'matches atomic approval call',
)


# ── Existing notification test acknowledges the new no-system-line mode. ──────
perm_test = Path('tests/perm_app_test.php')
t = perm_test.read_text(encoding='utf-8')
anchor = "check('статус hired ничего не объявляет',\n    str_contains($ann, \"if (\\$status !== 'approved' && \\$status !== 'rejected') return;\"));\n"
addition = anchor + "check('атомарное одобрение может отключить системную строку',\n    str_contains($ann, \"if (!\\$writeChat || \\$employerId === '') return;\"));\n"
if t.count(anchor) != 1:
    raise SystemExit(f'perm test anchor: expected 1, got {t.count(anchor)}')
perm_test.write_text(t.replace(anchor, addition, 1), encoding='utf-8')


# ── Permanent regression guard for the cross-request atomicity bug. ────────────
Path('tests/perm_app_atomicity_test.py').write_text(r'''#!/usr/bin/env python3
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
''', encoding='utf-8')
