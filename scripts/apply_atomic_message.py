from pathlib import Path
import re


def replace_case(path: str, case_name: str, new_case: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    marker = f"        case '{case_name}':"
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f'{case_name}: case not found')
    next_case = text.find("\n        case '", start + len(marker))
    if next_case < 0:
        raise SystemExit(f'{case_name}: next case not found')
    p.write_text(text[:start] + new_case.rstrip() + '\n' + text[next_case:], encoding='utf-8')


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# ── Server: one transaction, stable id across proxy retry ────────────────────
replace_case('php-proxy/db.php', 'dbInsertMessage', r'''        case 'dbInsertMessage': {
            $chatId = (string)($args[0] ?? '');
            $senderId = (string)($args[1] ?? '');
            $text = (string)($args[2] ?? '');
            // Новые клиенты создают id до proxy(): обе сетевые попытки одного
            // логического действия несут один id. Для старых сборок без 4-го
            // аргумента оставляем серверный id — совместимость без падения.
            $messageId = trim((string)($args[3] ?? ''));
            if ($messageId === '') $messageId = uid();

            $rows = sb_rpc('jm_insert_message_atomic', [
                'p_message_id' => $messageId,
                'p_chat_id' => $chatId,
                'p_sender_id' => $senderId,
                'p_text' => $text,
            ]);
            $result = is_array($rows) && isset($rows[0]) && is_array($rows[0]) ? $rows[0] : null;
            if (!$result) throw new Exception('Не удалось записать сообщение');

            $msg = [
                'id' => (string)($result['message_id'] ?? $messageId),
                'chat_id' => (string)($result['chat_id'] ?? $chatId),
                'sender_id' => (string)($result['sender_id'] ?? $senderId),
                'text' => (string)($result['message_text'] ?? $text),
                'created_at' => (string)($result['created_at'] ?? now_iso()),
            ];

            // На retry RPC вернёт inserted=false: строка уже есть, unread уже
            // увеличен. Повторный пуш тогда тоже не нужен.
            if (!empty($result['inserted'])) {
                try {
                    $chatRow = sb_single('jm_chats', ['id' => 'eq.' . $chatId],
                        'id,worker_id,employer_id');
                    if ($chatRow) jt_notify_new_message($chatRow, $senderId, $text);
                } catch (Throwable $e) {
                    // Сообщение и unread уже атомарно записаны — внешнее
                    // уведомление не должно превращать успех в ошибку.
                }
            }
            $data = $msg; break;
        }
''')

replace_case('php-proxy/db.php', 'dbIncrementUnread', r'''        case 'dbIncrementUnread': {
            // Совместимость со старыми установленными клиентами. Начиная с
            // migration 070 unread увеличивается в той же транзакции, что и
            // dbInsertMessage. Старые сборки после успешной отправки всё ещё
            // вызывают этот endpoint; второй increment дал бы двойной badge.
            // Авторизационная проверка операции выше остаётся в силе.
            $data = null; break;
        }
''')

# ── Service: generate id once before proxy retry ─────────────────────────────
service_path = Path('services/db.ts')
service = service_path.read_text(encoding='utf-8')
pattern = re.compile(
    r"export async function dbInsertMessage\(chatId: string, senderId: string, text: string\): Promise<Message> \{[\s\S]*?\n\}\n"
)
m = pattern.search(service)
if not m:
    raise SystemExit('services/db.ts: dbInsertMessage function not found')
new_service = '''export async function dbInsertMessage(chatId: string, senderId: string, text: string): Promise<Message> {
  // ID рождается до proxy(): внутренняя повторная попытка запроса использует
  // те же args, поэтому потерянный HTTP-ответ не создаёт второе сообщение.
  const messageId = uid();
  const d = await proxy<any>('dbInsertMessage', [chatId, senderId, text, messageId]);
  return rowToMessage(d);
}
'''
service_path.write_text(service[:m.start()] + new_service + service[m.end():], encoding='utf-8')

# ── Current clients: unread is already part of dbInsertMessage ────────────────
chat_path = Path('app/chat-room.tsx')
chat = chat_path.read_text(encoding='utf-8')
if chat.count('dbIncrementUnread, ') != 1:
    raise SystemExit(f'chat import: expected one dbIncrementUnread, got {chat.count("dbIncrementUnread, ")}')
chat = chat.replace('dbIncrementUnread, ', '', 1)
unread_snippet = """      const forRole = currentUser.role === 'worker' ? 'employer' : 'worker';
      dbIncrementUnread(chat.id, forRole).catch(() => {});
"""
count = chat.count(unread_snippet)
if count != 3:
    raise SystemExit(f'chat unread calls: expected 3, got {count}')
chat = chat.replace(unread_snippet, '')
chat_path.write_text(chat, encoding='utf-8')

feed_path = Path('app/(tabs)/feed.tsx')
feed = feed_path.read_text(encoding='utf-8')
if feed.count('  dbIncrementUnread,\n') != 1:
    raise SystemExit(f'feed import: expected one, got {feed.count("  dbIncrementUnread,\\n")}')
feed = feed.replace('  dbIncrementUnread,\n', '', 1)
if feed.count("      dbIncrementUnread(chatId, 'worker').catch(() => {});\n") != 1:
    raise SystemExit('feed unread call: expected one')
feed = feed.replace("      dbIncrementUnread(chatId, 'worker').catch(() => {});\n", '', 1)
feed_path.write_text(feed, encoding='utf-8')

# ── Permanent regression guard in existing CI test ───────────────────────────
test_path = Path('tests/message_notify_test.php')
test = test_path.read_text(encoding='utf-8')
old_vars = """$notif = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');
$preview = (string)file_get_contents(__DIR__ . '/../services/messagePreview.ts');
"""
new_vars = """$notif = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');
$preview = (string)file_get_contents(__DIR__ . '/../services/messagePreview.ts');
$service = (string)file_get_contents(__DIR__ . '/../services/db.ts');
$atomic = (string)file_get_contents(__DIR__ . '/../supabase/migrations/070_atomic_message_insert.sql');
"""
if test.count(old_vars) != 1:
    raise SystemExit('message test vars anchor not found exactly once')
test = test.replace(old_vars, new_vars, 1)

anchor = "// ── Клиент это делать перестал ──────────────────────────────────────────────\n"
if test.count(anchor) != 1:
    raise SystemExit('message test client anchor not found exactly once')
insert = r'''// ── Сообщение и unread — одна идемпотентная транзакция ───────────────────────
check('атомарный RPC блокирует строку чата',
    str_contains($atomic, 'from public.jm_chats') && str_contains($atomic, 'for update;'));
check('атомарный RPC пишет сообщение',
    str_contains($atomic, 'insert into public.jm_messages'));
check('атомарный RPC двигает unread противоположной стороны',
    str_contains($atomic, 'set unread_employer = coalesce(unread_employer, 0) + 1')
    && str_contains($atomic, 'set unread_worker = coalesce(unread_worker, 0) + 1'));
check('повтор id не пишет второй раз',
    str_contains($atomic, 'where id = p_message_id;')
    && str_contains($atomic, 'false;')
    && str_contains($atomic, 'message id collision'));
check('RPC закрыт от клиента',
    str_contains($atomic, 'from public, anon, authenticated;')
    && str_contains($atomic, 'to service_role;'));

check('dbInsertMessage использует атомарный RPC',
    str_contains($insert, "sb_rpc('jm_insert_message_atomic'")
    && str_contains($insert, "'p_message_id' => $messageId"));
check('dbInsertMessage не пишет сообщение отдельно', !str_contains($insert, 'msg_insert($msg)'));
check('повтор запроса не дублирует пуш', str_contains($insert, "if (!empty($result['inserted']))"));

$inc = case_body($db, 'dbIncrementUnread');
check('старый increment оставлен безопасным no-op',
    str_contains($inc, 'migration 070')
    && str_contains($inc, '$data = null; break;')
    && !str_contains($inc, 'sb_update('));
check('клиент создаёт id сообщения до proxy',
    str_contains($service, 'const messageId = uid();')
    && str_contains($service, "proxy<any>('dbInsertMessage', [chatId, senderId, text, messageId])"));
check('текущий клиент больше не увеличивает unread вторым запросом',
    !str_contains($chat, 'dbIncrementUnread(') && !str_contains($feed, 'dbIncrementUnread('));

'''
test = test.replace(anchor, insert + anchor, 1)
test_path.write_text(test, encoding='utf-8')

print('atomic message patch applied')
