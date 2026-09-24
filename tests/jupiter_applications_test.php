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
$live = (string)file_get_contents(
    __DIR__ . '/../supabase/migrations/106_jupiter_live_authorization.sql'
);
$mail = (string)file_get_contents(
    __DIR__ . '/../supabase/migrations/107_jupiter_mail.sql'
);
$thirdPartyConsent = (string)file_get_contents(
    __DIR__ . '/../supabase/migrations/109_jupiter_third_party_consent.sql'
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
check('проверка разрешения перед отправкой доступна только воркеру',
    str_contains($adminBlock, "'jupiterSubmitGuard'")
    && !str_contains($selfBlock, "'jupiterSubmitGuard'"));
foreach (['jupiterLiveStatus', 'jupiterSetLive', 'jupiterRequeueLive',
          'jupiterGrantThirdPartyConsent'] as $fn) {
    check("$fn привязан к владельцу", str_contains($selfBlock, "'$fn' => 0"));
}
foreach (['jupiterMailbox', 'jupiterMailList', 'jupiterMailRead'] as $fn) {
    check("$fn привязан к владельцу", str_contains($selfBlock, "'$fn' => 0"));
}
check('импорт писем доступен только воркеру',
    str_contains($adminBlock, "'jupiterMailIngest'")
    && !str_contains($selfBlock, "'jupiterMailIngest'"));
check('почтовые данные закрыты от клиентских ролей',
    str_contains($mail, 'jm_jupiter_mailboxes enable row level security')
    && str_contains($mail, 'jm_jupiter_emails enable row level security')
    && str_contains($mail, 'on delete cascade'));
check('отклик заблокирован до подключения почты и резюме',
    str_contains($db, "jt_secret('JUPITER_MAIL_VERIFIED') !== '1'")
    && str_contains($db, 'Сначала загрузите и выберите резюме PDF'));
check('согласие работодателю хранится отдельно на конкретной заявке',
    str_contains($thirdPartyConsent, 'third_party_consent_at timestamptz')
    && str_contains($thirdPartyConsent, 'third_party_terms_url text'));
check('согласие Сберу принимает только его точный URL условий',
    str_contains($db, "case 'jupiterGrantThirdPartyConsent':")
    && str_contains($db, "https://rabota.sber.ru/terms")
    && str_contains($db, "\$host !== 'rabota.sber.ru'"));
check('согласие Сберу не подменяет глобальное согласие JobToo',
    str_contains($db, "'third_party_consent_at' => \$now")
    && !str_contains($thirdPartyConsent, 'jm_users'));
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
check('повторный свайп после live-режима разрешает прежнюю dry-run заявку',
    str_contains($db, '$canAuthorizeExisting')
    && str_contains($db, "'submission_authorized_at' => now_iso()")
    && str_contains($db, "'id' => 'eq.' . (string)\$existing['id']"));
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
check('старые заявки остаются без разрешения на отправку',
    str_contains($live, 'add column if not exists submission_authorized_at timestamptz;'));
check('снятие разрешения блокирует будущие отправки',
    str_contains($db, "case 'jupiterSubmitGuard':")
    && str_contains($db, "'jupiter_live_enabled_at,is_blocked'")
    && str_contains($db, "'submission_authorized_at' => null"));
check('серверный submit guard повторно требует согласие Сберу',
    str_contains($db, "\$missingSberConsent")
    && str_contains($db, "'third_party_consent_at'")
    && str_contains($db, "'third_party_terms_url'")
    && str_contains($db, "https://rabota.sber.ru/terms"));
check('срок аренды ограничен сверху и снизу',
    (bool)preg_match('~max\(30, min\(3600~', $db));

// ── Ручной путь через WebView ───────────────────────────────────────────────
// Человек сам открывает сайт работодателя и жмёт «Отправить»: сервер отдаёт
// только его собственные поля и принимает пометку, что отклик отправлен.
foreach (['jupiterFillProfile', 'jupiterMarkManualSubmitted'] as $fn) {
    check("$fn привязан к владельцу", str_contains($selfBlock, "'$fn' => 0"));
}
$fillProfile = substr($db, strpos($db, "case 'jupiterFillProfile':"),
    strpos($db, "case 'jupiterMarkManualSubmitted':") - strpos($db, "case 'jupiterFillProfile':"));
check('jupiterFillProfile не отдаёт резюме, ссылки и согласия',
    $fillProfile !== ''
    && !str_contains($fillProfile, 'resume_url')
    && !str_contains($fillProfile, 'storage_path')
    && !str_contains($fillProfile, 'jt_resume_signed_url')
    && !str_contains($fillProfile, 'consent'));
check('jupiterFillProfile не собирает дату рождения',
    !str_contains($fillProfile, 'birth') && !str_contains($fillProfile, 'birthday'));

$markManual = substr($db, strpos($db, "case 'jupiterMarkManualSubmitted':"), 2200);
check('jupiterMarkManualSubmitted не трогает чужие заявки и чужую аренду',
    str_contains($markManual, "'user_id' => 'eq.' . \$uidArg")
    && str_contains($markManual, "'lease_owner' => 'is.null'"));
check('jupiterMarkManualSubmitted помечает заявку MANUAL_WEBVIEW',
    str_contains($markManual, "'reason_code' => 'MANUAL_WEBVIEW'")
    && str_contains($markManual, "'state' => 'submitted'"));

// ── Защита таблицы ──────────────────────────────────────────────────────────
check('таблица закрыта построчной защитой',
    str_contains($sqlCode, 'enable row level security'));
check('публичные роли к таблице не допущены',
    str_contains($sqlCode, 'revoke all on jm_jupiter_applications from anon')
    && str_contains($sqlCode, 'revoke all on jm_jupiter_applications from authenticated'));
check('функция аренды недоступна публичным ролям',
    str_contains($sqlCode, 'revoke all on function jupiter_lease_task(text, integer) from anon'));
check('воркеру разрешено брать задачи через service_role',
    str_contains(file_get_contents(__DIR__ . '/../supabase/migrations/108_jupiter_lease_service_role.sql'),
        'grant execute on function public.jupiter_lease_task(text, integer) to service_role;'));
check('сторож RLS видит новую таблицу',
    str_contains($guard, "('jm_jupiter_applications')"));

if ($failures) {
    echo "jupiter applications: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "jupiter applications: OK\n";
