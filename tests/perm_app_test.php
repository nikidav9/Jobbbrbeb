<?php
// Решение по отклику на постоянную вакансию: чьё оно и доходит ли до человека.
//
// Найдено сплошным разбором породы «выстрелил и забыл»: клиент делает вызов,
// который сервер не может доделать, потому что не знает о событии. Здесь эта
// порода дала сразу две беды, и вторая хуже первой.
//
// Первая: уведомление соискателю слал телефон директора отдельным вызовом с
// пустым .catch(). Обрыв связи — и человек не узнал о решении.
//
// Вторая: системную строку в чат («кандидат одобрен», «вы не подошли») тот же
// телефон писал вызовом dbInsertMessage от имени «system». Писать от имени
// «system» приложению ЗАПРЕЩЕНО — в db.php стоит проверка «Invalid sender», —
// поэтому сервер отвечал 403 ВСЕГДА, а отказ гасился тем же пустым .catch().
// Директор видел строку у себя, её дорисовывали на месте, а соискатель не
// видел ничего и никогда.
//
// Третья, найденная заодно: чей это отклик, не проверялось вовсе.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$chat = (string)file_get_contents(__DIR__ . '/../app/chat-room.tsx');
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

// ── Решение принимает тот, чья вакансия ───────────────────────────────────────
$handler = case_body($db, 'dbSetPermApplicationStatus');
check('обработчик найден', $handler !== '');
check('отклик берётся из базы', str_contains($handler, "sb_single('jm_perm_applications'"));
check('чужой отклик не трогаем',
    str_contains($handler, "(string)(\$app['employer_id'] ?? '') !== (string)\$authUid")
    && str_contains($handler, "jt_respond(['error' => 'Это не ваш отклик'], 403)"));
check('несуществующий отклик — 404',
    str_contains($handler, "jt_respond(['error' => 'Отклик не найден'], 404)"));
// Статус уходит прямо в базу, и колонка проверяется ограничением. Лучше
// отказать здесь понятной ошибкой, чем ловить нарушение ограничения.
check('статус только из известных',
    str_contains($handler, "in_array(\$status, ['approved', 'rejected', 'hired'], true)"));

// Проверка права должна стоять ДО записи статуса, иначе она бессмысленна.
$ownerAt = strpos($handler, "jt_respond(['error' => 'Это не ваш отклик'], 403)");
$writeAt = strpos($handler, "sb_update('jm_perm_applications'");
check('право проверяется раньше записи',
    $ownerAt !== false && $writeAt !== false && $ownerAt < $writeAt);

// Повторное нажатие не должно слать второго уведомления.
check('объявляем только при смене статуса',
    str_contains($handler, 'if ($wasStatus !== $status) jt_perm_app_announce($app, $status);'));

// ── Решение доходит до соискателя ─────────────────────────────────────────────
$ann = fn_body($db, 'jt_perm_app_announce');
check('объявление решения есть', $ann !== '');
check('одобрение уведомляет', str_contains($ann, "'✅ Заявка одобрена!'"));
check('отказ уведомляет', str_contains($ann, "'❌ Заявка отклонена'"));
// Заголовки нарочно те же, что слало приложение: notify_user гасит повтор с
// тем же заголовком в течение минуты, и со старой сборки второго уведомления
// не придёт. Проверяем, что этот глушитель на месте.
check('повтор уведомления гасится по заголовку',
    str_contains(fn_body($db, 'notify_user'), "'title'      => 'eq.' . \$title"));
check('строка пишется от имени системы',
    str_contains($ann, "'sender_id' => 'system'"));
check('соискателю растёт счётчик непрочитанного',
    str_contains($ann, "'unread_worker' => (int)(\$chat['unread_worker'] ?? 0) + 1"));
// При одобрении из «Мэтчей» чат заводится следующим запросом вместе с личным
// сообщением директора — системная строка там была бы лишней.
check('в несуществующий чат не пишем', str_contains($ann, 'if (!$chat) return;'));
check('статус hired ничего не объявляет',
    str_contains($ann, "if (\$status !== 'approved' && \$status !== 'rejected') return;"));

// ── Клиент больше не пытается сделать это сам ─────────────────────────────────
// Запрещённая запись от имени «system» в ветках постоянных вакансий ушла.
check('чат-комната не пишет системную строку сама',
    !str_contains($chat, "dbInsertMessage(chat.id, 'system', okMsg.text)"));
check('чат-комната не шлёт уведомление об отклике сама',
    !str_contains($chat, 'notifyWorkerPermApplicationApproved(')
    && !str_contains($chat, 'notifyWorkerPermApplicationRejected('));
check('«Мэтчи» не шлют уведомление об отклике сами',
    !str_contains($matches, 'notifyWorkerPermApplicationApproved(')
    && !str_contains($matches, 'notifyWorkerPermApplicationRejected('));
// Дорисовка на месте остаётся: директор должен увидеть строку сразу.
check('директор видит строку сразу',
    str_contains($chat, 'appendMessages([okMsg]);'));

if ($failures) {
    echo "perm app: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "perm app: OK\n";
