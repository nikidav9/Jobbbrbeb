<?php
// Заявки Jupiter: права, повторы и целостность.
//
// Всё, что проверяется здесь, ломается тихо. Забытый selfArgFns отдаёт чужие
// заявки любому вошедшему, а пропавший уникальный индекс превращает двойное
// нажатие во второй отклик работодателю.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$sql = (string)file_get_contents(
    __DIR__ . '/../supabase/migrations/104_jupiter_applications.sql'
);
$recovery = (string)file_get_contents(
    __DIR__ . '/../supabase/migrations/105_jupiter_lease_recovery.sql'
);
$guard = (string)file_get_contents(__DIR__ . '/../infra/verify-rls.sh');

// Комментарии выброшены намеренно. Первая версия теста ловила «for update skip
// locked» в пояснении рядом и оставалась зелёной, когда саму строку удалили.
$sqlCode = preg_replace('~^\s*--.*$~m', '', $sql);

// ── Права ───────────────────────────────────────────────────────────────────
// Свои заявки — только свои. Позиция 0 это user_id в аргументах.
check('jupiterEnqueue проверяет владельца',
    (bool)preg_match("~'jupiterEnqueue' => 0~", $db));
check('jupiterMyApplications проверяет владельца',
    (bool)preg_match("~'jupiterMyApplications' => 0~", $db));

// Воркер берёт ЧУЖИЕ задачи по очереди. Пускать его с пользовательской
// сессией значило бы дать одному человеку доступ к заявкам другого.
$adminBlock = substr($db, strpos($db, '$adminFns = ['),
    strpos($db, '];', strpos($db, '$adminFns = [')) - strpos($db, '$adminFns = ['));
foreach (['jupiterLease', 'jupiterHeartbeat', 'jupiterCheckpoint', 'jupiterFinish'] as $fn) {
    check("$fn в списке админских", str_contains($adminBlock, "'$fn'"));
}
$selfBlock = substr($db, strpos($db, '$selfArgFns = ['),
    strpos($db, '];', strpos($db, '$selfArgFns = [')) - strpos($db, '$selfArgFns = ['));
foreach (['jupiterLease', 'jupiterHeartbeat', 'jupiterCheckpoint', 'jupiterFinish'] as $fn) {
    check("$fn НЕ выдаётся по пользовательской сессии",
        !str_contains($selfBlock, "'$fn'"));
}

// Аренду продлевает и закрывает только тот воркер, который её держит.
foreach (['jupiterHeartbeat', 'jupiterCheckpoint', 'jupiterFinish'] as $fn) {
    $start = strpos($db, "case '$fn':");
    $body = $start !== false ? substr($db, $start, 1800) : '';
    check("$fn сверяет владельца аренды",
        str_contains($body, "lease_owner") && str_contains($body, '409'));
}

// Воркер не должен переписывать поля, которые ему не принадлежат.
$finish = substr($db, strpos($db, "case 'jupiterFinish':"), 2200);
check('jupiterFinish пишет по белому списку полей',
    str_contains($finish, "'external_application_id', 'last_error'"));
check('jupiterFinish не даёт подменить владельца заявки',
    !preg_match("~\\\$patch\\['user_id'\\]~", $finish));
check('jupiterFinish не даёт подменить адрес вакансии',
    !preg_match("~\\\$patch\\['(vacancy_url|canonical_url)'\\]~", $finish));
check('jupiterFinish принимает только известные состояния',
    str_contains($finish, "'Unknown state'"));

// ── Один отклик — один раз ──────────────────────────────────────────────────
// Главная защита в базе, а не в коде: проверка в PHP проигрывает гонке двух
// запросов, уникальный индекс — нет.
check('уникальность заявки закреплена индексом',
    (bool)preg_match('~create unique index[^;]*jm_jupiter_applications\s*\(user_id, canonical_url\)~s', $sqlCode));
check('повторная постановка возвращает прежнюю заявку',
    str_contains($db, "if (\$existing) { \$data = \$existing; break; }"));
check('публичные методы Jupiter возвращают data как другие методы db.php',
    str_contains($db, "\$data = \$inserted[0] ?? sb_single('jm_jupiter_applications'")
    && str_contains($db, "case 'jupiterMyApplications': {\n            \$data = sb_select(")
    && str_contains($db, "jt_respond(['data' => \$data]);"));
check('гонка двух свайпов не возвращает отправленную заявку в очередь',
    str_contains($db, 'resolution=ignore-duplicates,return=representation')
    && !str_contains(substr($db, strpos($db, "case 'jupiterEnqueue':"), 2000),
        "sb_upsert('jm_jupiter_applications'"));
check('пустая очередь отвечает JSON null, не ошибкой типа',
    str_contains($db, 'function jt_respond(mixed $payload')
    && str_contains($db, 'jt_respond($task ?: null)'));
check('адрес канонизируется перед сравнением',
    str_contains($db, 'jupiter_canonical_url($url)'));
check('канонизация выбрасывает рекламные метки',
    str_contains($db, "'utm_source'") && str_contains($db, "'gclid'"));
check('канонизация пускает только http и https',
    (bool)preg_match("~in_array\(\\\$scheme, \['http', 'https'\], true\)~", $db));

// ── Аренда ──────────────────────────────────────────────────────────────────
// Выбор и пометка одним запросом. Иначе два воркера успевают взять одну
// задачу, и работодатель получает два отклика.
check('задача берётся атомарно', str_contains($sqlCode, 'for update skip locked'));
check('аренда имеет срок', str_contains($sqlCode, 'lease_until'));
check('прерванное заполнение возвращается в очередь после аренды',
    str_contains($recovery, "'opening_application'")
    && str_contains($recovery, 'lease_until <= now()'));
check('неизвестную отправку не повторяем автоматически',
    str_contains($recovery, "state = 'submission_unknown'")
    && str_contains($recovery, "state in ('submitting', 'verifying')"));
check('срок аренды ограничен сверху и снизу',
    (bool)preg_match('~max\(30, min\(3600~', $db));

// ── Защита таблицы ──────────────────────────────────────────────────────────
check('таблица закрыта построчной защитой',
    str_contains($sqlCode, 'enable row level security'));
check('публичные роли к таблице не допущены',
    str_contains($sqlCode, 'revoke all on jm_jupiter_applications from anon')
    && str_contains($sqlCode, 'revoke all on jm_jupiter_applications from authenticated'));
check('функция аренды недоступна публичным ролям',
    str_contains($sqlCode, 'revoke all on function jupiter_lease_task(text, integer) from anon'));
check('сторож RLS видит новую таблицу',
    str_contains($guard, "('jm_jupiter_applications')"));

if ($failures) {
    echo "jupiter applications: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "jupiter applications: OK\n";
