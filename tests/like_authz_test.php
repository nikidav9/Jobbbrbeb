<?php
// Отклик на смену: кто вправе его менять и доходит ли отказ до человека.
//
// Продолжение сплошного разбора той же породы, что дала молчащие объявления и
// потерянное согласие. В dbUpsertLike она дала три беды разом.
//
// Первая. Проверок не было ни одной, а владельца смены брали с клиента
// доводом: любой вошедший мог одобрить или отклонить чужого кандидата на чужую
// смену и отозвать чужой отклик.
//
// Вторая. С клиента принимались ВСЕ поля отклика, включая мэтч, отметки о
// выходе на смену и об оценках, — то есть их можно было себе подписать.
//
// Третья. Строку об отказе приложение писало от имени «system», что запрещено
// проверкой «Invalid sender»: сервер отвечал 403 всегда, отказ гасился пустым
// .catch(). Счётчик непрочитанного при этом рос — значок был, а за ним пусто.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$chat = (string)file_get_contents(__DIR__ . '/../app/chat-room.tsx');
$dbts = (string)file_get_contents(__DIR__ . '/../services/db.ts');
$candidates = (string)file_get_contents(__DIR__ . '/../app/candidates.tsx');
$matches = (string)file_get_contents(__DIR__ . '/../app/(tabs)/matches.tsx');

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
    $start = strpos($src, "case '{$fn}': {");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

$h = case_body($db, 'dbUpsertLike');
check('обработчик найден', $h !== '');

// ── Владелец смены — из самой вакансии, а не из довода ────────────────────────
check('владелец берётся из вакансии',
    str_contains($h, "\$vac = sb_single('jm_vacancies', ['id' => 'eq.' . \$vid], 'employer_id,title');"));
// Смену можно удалить, а отклик по ней остаётся — связи в базе нет. Без запасного
// хода работодатель не смог бы закрыть собственный старый отклик.
check('у осиротевшего отклика владелец берётся из него самого',
    str_contains($h, "(string)(\$vac['employer_id'] ?? (\$existingLike['employer_id'] ?? ''))"));
check('когда владельца взять неоткуда — 404',
    str_contains($h, "if (\$vacEmployer === '') { jt_respond(['error' => 'Вакансия не найдена'], 404); exit; }"));
check('решение работодателя — только от владельца смены',
    str_contains($h, "array_key_exists('employerLiked', \$upd) && (string)\$authUid !== \$vacEmployer"));
check('отклик работника — только от него самого',
    str_contains($h, "array_key_exists('workerLiked', \$upd) || array_key_exists('workerSkipped', \$upd)")
    && str_contains($h, "(string)\$authUid !== (string)\$wid"));
// Новая строка отклика тоже не должна брать владельца с клиента: иначе отклик
// уедет к постороннему, и дальше проверки будут сверяться с подделкой.
check('в новой строке владелец настоящий',
    str_contains($h, "'employer_id' => \$vacEmployer,"));
check('уведомление об отклике уходит настоящему владельцу',
    str_contains($h, 'notify_user($vacEmployer,'));

// Проверки должны стоять ДО записи, иначе они ничего не стоят.
$authAt = strpos($h, "jt_respond(['error' => 'Это не ваша вакансия'], 403)");
$writeAt = strpos($h, "sb_upsert('jm_likes'");
check('право проверяется раньше записи',
    $authAt !== false && $writeAt !== false && $authAt < $writeAt);

// ── С клиента принимаем только три поля ───────────────────────────────────────
// Мэтч, выход на смену и оценки ставит сервер в своих обработчиках.
foreach (['isMatch', 'matchedAt', 'workerConfirmed', 'employerConfirmed',
          'workerRated', 'employerRated', 'shiftCompleted'] as $forged) {
    check("поле {$forged} с клиента не принимается", !str_contains($h, "\$upd['{$forged}']"));
}
foreach (['workerLiked', 'employerLiked', 'workerSkipped'] as $allowed) {
    check("поле {$allowed} принимается", str_contains($h, "\$upd['{$allowed}']"));
}
// Довод может прийти и не массивом — тогда array_key_exists уронил бы запрос.
check('нечитаемый довод не роняет запрос',
    str_contains($h, '$upd = is_array($args[3] ?? null) ? $args[3] : [];'));

// ── Отказ доходит до соискателя ───────────────────────────────────────────────
$ann = fn_body($db, 'jt_shift_reject_announce');
check('объявление отказа есть', $ann !== '');
check('строка пишется от имени системы', str_contains($ann, "'sender_id' => 'system'"));
// Прежний текст не говорил, ПО КАКОЙ вакансии отказ, — а чат один на пару
// людей, и речь в нём идёт о нескольких сменах подряд.
check('смена названа',
    str_contains($ann, "\$named = \$title !== '' ? ' «' . \$title . '»' : '';")
    && str_contains($ann, "'Отклик на смену' . \$named . ' отклонён."));

// Уведомление — и оно важнее строки. Чат заводится только на мэтче: у того,
// кому отказали с экрана «Кандидаты», переписки обычно нет вовсе, и без
// уведомления отказ до него не дойдёт никак. Это и было самым частым
// молчанием, ради него правку и делали.
check('уведомление уходит', str_contains($ann, "notify_user(\$workerId, '❌ Отклик отклонён'"));
$notifyAt = strpos($ann, 'notify_user($workerId');
$chatAt = strpos($ann, "sb_single('jm_chats'");
check('уведомление уходит ДО поиска переписки, а не вместо',
    $notifyAt !== false && $chatAt !== false && $notifyAt < $chatAt);
check('уведомление не зависит от наличия переписки',
    $notifyAt !== false && $notifyAt < strpos($ann, "if (!\$chat) return '';"));
// Название компании бывает любого рода — безличное «работодатель» согласуется
// с глаголом всегда.
check('в уведомлении нет угадывания рода',
    str_contains($ann, "'Работодатель отклонил ваш отклик на смену'"));
// А вот про закрытую переписку оставляем: экран действительно блокирует ввод
// по отклонённому отклику, и без этой фразы человек упрётся в серый ввод и не
// поймёт, почему.
check('про закрытую переписку сказано', str_contains($ann, 'Переписка по ней закрыта.'));
check('ввод и правда блокируется',
    str_contains($chat, "const isChatBlocked = likeStatus === 'rejected'"));
// Текст живёт в ОДНОМ месте. На клиенте его быть не должно: там он и
// разъехался бы, и уходил записью, которую сервер отвергает.
check('приложение своего текста об отказе не держит',
    !str_contains($chat, 'Отклик на смену'));
check('счётчик непрочитанного растёт',
    str_contains($ann, "'unread_worker' => (int)(\$chat['unread_worker'] ?? 0) + 1"));
check('без переписки не пишем', str_contains($ann, "if (!\$chat) return '';"));

// Объявляем только на переходе в отказ: повторное нажатие не должно писать
// вторую строку, а одобрение — вообще никакой.
check('объявляем только на переходе в отказ',
    str_contains($h, "\$justRejected = \$row['employer_liked'] === false && \$base['employer_liked'] !== false;"));
// Объявляем со ВСЕХ экранов, где отказывают. Признака-выключателя больше нет:
// пока он был, «Кандидаты» и «Мэтчи» молчали — человек не узнавал об отказе
// никак. Включено по решению владельца проекта.
check('выключателя не осталось',
    !str_contains($db, 'announceInChat') && !str_contains($dbts, 'announceInChat')
    && !str_contains($chat, 'announceInChat')
    && !str_contains($candidates, 'announceInChat') && !str_contains($matches, 'announceInChat'));
check('название смены доходит до строки',
    str_contains($h, "jt_shift_reject_announce((string)\$wid, \$vacEmployer, (string)(\$vac['title'] ?? ''))"));
// Все три экрана отказывают одним и тем же вызовом — значит и строка будет
// одна и та же, откуда бы ни нажали.
check('переписка отказывает через общий вызов',
    str_contains($chat, 'employerLiked: false'));
check('«Кандидаты» отказывают через общий вызов',
    str_contains($candidates, 'employerLiked: false'));
check('«Мэтчи» отказывают через общий вызов',
    str_contains($matches, 'employerLiked: false'));

// ── Приложение больше не пытается писать от имени «system» ────────────────────
check('переписка не пишет отказ сама',
    !str_contains($chat, "dbInsertMessage(chat.id, 'system', rejectMsg)"));
// Значок без сообщения был хуже, чем ничего: человек открывал пустоту.
check('счётчик отсюда больше не трогаем',
    !str_contains($chat, "dbIncrementUnread(chat.id, 'worker')"));

if ($failures) {
    echo "like authz: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "like authz: OK\n";
