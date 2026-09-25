<?php
// Поручение на автоотклик Юпитера включается принятием документов (редакция
// 2026-09-25, Соглашение раздел 8 и Согласие), без отдельного диалога при
// первом свайпе. Отзыв — переключатель в «Профиль → Настройки», и он должен
// быть настоящим: повторное согласие не должно включать автоотклик обратно
// тому, кто сам его выключил.

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

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$migration = (string)file_get_contents(__DIR__ . '/../supabase/migrations/116_jupiter_live_revoked.sql');

// ── Отпечаток документов проверяется поведением, не текстом ────────────────
// Функция чистая: разбирает строку и сравнивает версии. Достаём тело из
// db.php и исполняем — целиком db.php подключить нельзя, это обработчик
// запроса, а не библиотека (см. tests/consent_test.php).
check('константа редакции с поручением есть',
    str_contains($db, "define('JT_JUPITER_CONSENT_FROM', '2026-09-25');"));

$stampOk = fn_body($db, 'jt_jupiter_stamp_ok');
check('jt_jupiter_stamp_ok найдена', $stampOk !== '');
if ($stampOk !== '') {
    eval("define('JT_JUPITER_CONSENT_FROM', '2026-09-25');\n" . $stampOk . "\n}\n");
    check('старый отпечаток (до поручения) не включает автоотклик',
        jt_jupiter_stamp_ok('terms:2026-09-21|privacy:2026-09-21|consent:2026-09-21') === false);
    check('новый отпечаток включает автоотклик',
        jt_jupiter_stamp_ok('terms:2026-09-25|privacy:2026-09-25|consent:2026-09-25') === true);
    check('суффикс версии не мешает сравнению',
        jt_jupiter_stamp_ok('terms:2026-09-25-2|privacy:2026-09-25|consent:2026-09-25-2') === true);
    check('мусор не включает автоотклик',
        jt_jupiter_stamp_ok('не отпечаток вовсе') === false);
    check('пустая строка не включает автоотклик', jt_jupiter_stamp_ok('') === false);
}

// ── Автовключение зовётся из обоих мест записи согласия ────────────────────
check('jt_consent_attach зовёт автовключение',
    (bool)preg_match(
        '~sb_upsert\(\'jm_consents\', \[.*?\], \'id\'\);\s*jt_jupiter_auto_enable\(\$uid, \$stamp\);~s',
        fn_body($db, 'jt_consent_attach')
    ));
check("case 'dbRecordConsent' зовёт автовключение",
    (bool)preg_match(
        "~case 'dbRecordConsent': \{.*?jt_jupiter_auto_enable\(\\\$uid, \\\$stamp\);~s",
        $db
    ));

// ── Автовключение не включает того, кто уже отозвал поручение сам ──────────
$autoEnable = fn_body($db, 'jt_jupiter_auto_enable');
check('jt_jupiter_auto_enable найдена', $autoEnable !== '');
check('автовключение проверяет отпечаток', str_contains($autoEnable, 'jt_jupiter_stamp_ok($stamp)'));
check('автовключение не трогает уже включённых или отозвавших',
    str_contains($autoEnable, "!empty(\$user['jupiter_live_enabled_at']) || !empty(\$user['jupiter_live_revoked_at'])"));
check('сбой автовключения не роняет вызывающий код',
    str_contains($autoEnable, 'try {') && str_contains($autoEnable, '} catch (Throwable'));

// ── Выключение пишет отметку отзыва, включение её снимает ──────────────────
check('jupiterSetLive пишет обе отметки',
    str_contains($db, "'jupiter_live_enabled_at' => \$enabled ? now_iso() : null,")
    && str_contains($db, "'jupiter_live_revoked_at' => \$enabled ? null : now_iso(),"));

// ── Статус отдаёт revoked, старые сборки клиента при этом не ломаются ──────
check('jupiterLiveStatus отдаёт enabled и revoked',
    str_contains($db, "'enabled' => !empty(\$user['jupiter_live_enabled_at']),")
    && str_contains($db, "'revoked' => !empty(\$user['jupiter_live_revoked_at']),"));

// ── Права остаются привязаны к владельцу ────────────────────────────────────
$selfBlock = substr($db, strpos($db, '$selfArgFns = ['),
    strpos($db, '];', strpos($db, '$selfArgFns = [')) - strpos($db, '$selfArgFns = ['));
foreach (['jupiterLiveStatus', 'jupiterSetLive'] as $fn) {
    check("$fn привязан к владельцу", str_contains($selfBlock, "'$fn' => 0"));
}

// ── Миграция 116 добавляет колонку отзыва ───────────────────────────────────
check('миграция добавляет jupiter_live_revoked_at',
    str_contains($migration, 'add column if not exists jupiter_live_revoked_at timestamptz'));

if ($failures) {
    echo "jupiter_live_consent: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "jupiter_live_consent: OK\n";
