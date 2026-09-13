<?php
// Уведомление о сообщении собирает сервер.
//
// Задача 20, первая часть. Право ПИСАТЬ человеку я закрыл раньше
// (jt_may_notify), но содержание оставалось за клиентом: телефон отправителя
// собирал заголовок из своего имени, брал чужой пуш-токен и слал. Отсюда две
// беды. Первая обычная для этой породы: вызов «выстрелил и забыл», обрыв —
// и человек о сообщении не узнал. Вторая хуже: раз текст приходит с клиента,
// через НАШЕГО бота можно послать что угодно тому, с кем есть переписка.
//
// Теперь и имя отправителя, и текст сервер берёт из того, что сам записал.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$chat = (string)file_get_contents(__DIR__ . '/../app/chat-room.tsx');
$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
$notif = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');
$preview = (string)file_get_contents(__DIR__ . '/../services/messagePreview.ts');

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function fn_body(string $src, string $name): string
{
    $start = strpos($src, "function {$name}(");
    if ($start === false) return '';
    $end = strpos($src, "\n}\n", $start);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

function case_body(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}':");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

// ── Сервер собирает уведомление сам ──────────────────────────────────────────
$n = fn_body($db, 'jt_notify_new_message');
check('уведомление о сообщении есть на сервере', $n !== '');
check('получатель — вторая сторона переписки',
    str_contains($n, '$recipientId = $senderId === $workerId ? $employerId : $workerId;'));
check('сам себе не пишем', str_contains($n, "if (\$recipientId === '' || \$recipientId === \$senderId) return;"));
// Имя берём из базы, а не из того, что прислал телефон: иначе подпись под
// сообщением можно подделать.
check('имя отправителя из базы',
    str_contains($n, "sb_single('jm_users', ['id' => 'eq.' . \$senderId], 'first_name,last_name')"));
check('без имени — не пусто', str_contains($n, "if (\$name === '') \$name = 'Собеседник';"));

// ── На экране блокировки ни имени, ни текста ────────────────────────────────
// Так же устроены WhatsApp и Signal. В колокольчике внутри приложения видно
// всё, на заблокированном экране — только что сообщение есть.
check('в пуше скрыт текст', str_contains($n, "'Откройте чат в JobToo'"));
check('в пуше скрыто имя', str_contains($n, "'💬 Новое сообщение'"));
$nu = fn_body($db, 'notify_user');
check('notify_user умеет отдельный заголовок для пуша',
    str_contains($nu, '?string $pushTitle = null')
    && str_contains($nu, "'title' => \$pushTitle ?? \$title"));

// ── Предпросмотр повторяет правила приложения ───────────────────────────────
// Фото и голосовые лежат в той же текстовой колонке, что и обычные сообщения:
// метка плюс ссылка. Показать её человеку нельзя.
$p = fn_body($db, 'jt_message_preview');
check('голосовое подписано', str_contains($p, "'🎤 Голосовое сообщение'"));
check('фото подписано', str_contains($p, "'📷 Фото'"));
check('длинный текст обрезается', str_contains($p, 'mb_substr($text, 0, 100)'));
// Значки должны совпадать с теми, что приложение рисует в списке чатов.
check('значки те же, что в списке чатов',
    str_contains($preview, "'🎤 Голосовое сообщение'") && str_contains($preview, "'📷 Фото'"));
check('метки те же', str_contains($p, "'[voice]'") && str_contains($p, "'[img]'")
    && str_contains($preview, "IMG_PREFIX = '[img]'") && str_contains($preview, "VOICE_PREFIX = '[voice]'"));

// ── Зовётся там, где сообщение записывается ─────────────────────────────────
$insert = case_body($db, 'dbInsertMessage');
check('запись сообщения извещает', str_contains($insert, 'jt_notify_new_message($chatRow,'));
check('сбой уведомления не роняет отправку',
    str_contains($insert, 'try {') && str_contains($insert, '} catch (Throwable'));
$create = case_body($db, 'dbCreateChat');
check('заведение чата извещает о первом сообщении',
    str_contains($create, 'jt_notify_new_message('));
check('от системы не извещаем',
    str_contains($create, "\$senderId !== '' && trim((string)\$sm) !== ''"));

// ── Клиент это делать перестал ──────────────────────────────────────────────
foreach ([['переписка', $chat], ['лента', $feed]] as [$where, $src]) {
    check("{$where}: своих уведомлений о сообщении нет",
        !str_contains($src, 'notifyEmployerNewMessage(') && !str_contains($src, 'notifyWorkerNewMessage('));
}
check('и сами помощники убраны',
    !str_contains($notif, 'export async function notifyEmployerNewMessage')
    && !str_contains($notif, 'export async function notifyWorkerNewMessage'));

if ($failures) {
    echo "message notify: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "message notify: OK\n";
