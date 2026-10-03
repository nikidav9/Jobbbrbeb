<?php
// Капча человеку (миграция 135): права, срок, длина ответа, чужая заявка.
// Проверки статические, как в соседних jupiter_*_test.php.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$sql = (string)file_get_contents(__DIR__ . '/../supabase/migrations/135_jupiter_captcha.sql');
$guard = (string)file_get_contents(__DIR__ . '/../infra/verify-rls.sh');
$ts = (string)file_get_contents(__DIR__ . '/../services/db.ts');

$adminBlock = substr($db, strpos($db, '$adminFns = ['),
    strpos($db, '];', strpos($db, '$adminFns = [')) - strpos($db, '$adminFns = ['));
$selfBlock = substr($db, strpos($db, '$selfArgFns = ['),
    strpos($db, '];', strpos($db, '$selfArgFns = [')) - strpos($db, '$selfArgFns = ['));

// ── Права ───────────────────────────────────────────────────────────────────
foreach (['jupiterCaptchaPost', 'jupiterCaptchaPoll', 'jupiterCaptchaResult'] as $fn) {
    check("$fn только для воркера",
        str_contains($adminBlock, "'$fn'") && !str_contains($selfBlock, "'$fn'"));
}
foreach (['jupiterCaptchaGet', 'jupiterCaptchaAnswer', 'jupiterCaptchaRefresh'] as $fn) {
    check("$fn привязан к владельцу",
        str_contains($selfBlock, "'$fn' => 0") && !str_contains($adminBlock, "'$fn'"));
}

// ── Логика ──────────────────────────────────────────────────────────────────
$body = function (string $case, string $next) use ($db): string {
    $a = strpos($db, "case '$case': {");
    $b = strpos($db, "case '$next': {", $a);
    return $a === false ? '' : substr($db, $a, $b - $a);
};
$post = $body('jupiterCaptchaPost', 'jupiterCaptchaGet');
$get = $body('jupiterCaptchaGet', 'jupiterCaptchaAnswer');
$ans = $body('jupiterCaptchaAnswer', 'jupiterCaptchaRefresh');
$poll = $body('jupiterCaptchaPoll', 'jupiterCaptchaResult');
$refresh = $body('jupiterCaptchaRefresh', 'jupiterCaptchaPoll');

check('картинка ограничена 200 КБ', str_contains($post, '200000'));
check('капча ставит CAPTCHA_HUMAN и action_required',
    str_contains($post, "'state' => 'action_required'") && str_contains($post, "'reason_code' => 'CAPTCHA_HUMAN'"));
check('пуш зовёт notify_user', str_contains($post, 'notify_user('));
// Id заявки доходит до приложения: в data уведомления и в payload строки
// колокольчика (внешний пуш push_privacy.php сводит к {type:'refresh'}).
check('id заявки в данных уведомления',
    str_contains($post, "'jupiter_captcha', ['applicationId' => \$appId]"));
check('id заявки в payload колокольчика',
    str_contains($post, "['payload' => ['applicationId' => \$appId]]")
    && str_contains($post, "'type' => 'eq.jupiter_captcha'")
    && str_contains($post, "'payload' => 'is.null'"));
// Внешний пуш (с 03.10.2026 — текст по виду события): id заявки наружу не уходит,
// остаётся только вид события.
require_once __DIR__ . '/../php-proxy/push_privacy.php';
$pushed = jt_push_prepare_expo_message([
    'to' => 'ExponentPushToken[captcha-test]', 'title' => 'Секрет', 'body' => 'Секрет',
    'data' => ['type' => 'jupiter_captcha', 'applicationId' => 'app-secret-1'],
]);
check('внешний пуш капчи: только вид события, без id заявки',
    is_array($pushed) && ($pushed['data'] ?? null) === ['type' => 'jupiter_captcha']
    && !str_contains(json_encode($pushed, JSON_UNESCAPED_UNICODE), 'app-secret-1')
    && !str_contains(json_encode($pushed, JSON_UNESCAPED_UNICODE), 'Секрет'));
check('срок жизни 10 минут', str_contains($post, 'time() + 600'));
check('get отбирает по владельцу и pending',
    str_contains($get, "'user_id' => 'eq.'") && str_contains($get, "'status' => 'eq.pending'"));
check('get не отдаёт просроченную', str_contains($get, 'strtotime') && str_contains($get, '<= time()'));
check('ответ ограничен 64 символами', str_contains($ans, 'mb_strlen($answer) > 64'));
check('ответ принимает только свою pending',
    str_contains($ans, "'user_id' => 'eq.' . \$uidArg") && str_contains($ans, "'status' => 'eq.pending'"));
check('ответ не принимает просроченную', str_contains($ans, '<= time()') && str_contains($ans, '409'));
check('poll закрывает просроченную', str_contains($poll, "'expired'"));
check('poll отдаёт ответ только в answered', str_contains($poll, "=== 'answered'"));

// ── Нажатия (миграция 146) ──────────────────────────────────────────────────
$sqlTap = (string)file_get_contents(__DIR__ . '/../supabase/migrations/146_jupiter_captcha_tap.sql');
check('post принимает только text или tap',
    str_contains($post, "in_array(\$kind, ['text', 'tap'], true)") && str_contains($post, "'kind' => \$kind"));
check('get отдаёт вид капчи', str_contains($get, "'kind' => \$row['kind']"));
check('ответ-нажатия проверяется по виду строки, а не по клиенту',
    str_contains($ans, "'id,expires_at,kind'") && str_contains($ans, "=== 'tap'"));
check('миграция 146 добавляет kind с ограничением',
    str_contains($sqlTap, 'add column if not exists kind text not null default \'text\'')
    && str_contains($sqlTap, "check (kind in ('text', 'tap'))")
    && str_contains($sqlTap, 'begin;') && str_contains($sqlTap, 'commit;'));
// Тот же шаблон, что в db.php: до 12 точек «x,y;x,y» в долях 0..1.
$pt = '(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)';
$re = '/^' . $pt . ',' . $pt . '(?:;' . $pt . ',' . $pt . '){0,11}$/';
check('шаблон нажатий совпадает с db.php', str_contains($ans, "\$pt = '(?:0(?:\\.\\d{1,4})?|1(?:\\.0{1,4})?)';"));
foreach (['0.5,0.5', '0,1', '0.1234,0.9;1,0', '1.0000,0.0000;0.5000,1.0000', implode(';', array_fill(0, 12, '0.5,0.5'))] as $ok) {
    check("нажатия принимаются: $ok", preg_match($re, $ok) === 1);
}
foreach (['', 'слово', '0.5', '1.2,0.1', '-0.1,0.1', '1.5,0.1', '1.0001,0.1', '0.5,0.5;', '0.12345,0.1', '0.5,0.5;0.5',
          implode(';', array_fill(0, 13, '0.5,0.5'))] as $bad) {
    check("нажатия отклоняются: $bad", preg_match($re, $bad) === 0);
}

// ── «Повторить капчу» ───────────────────────────────────────────────────────
check('refresh: только своя ждущая не просроченная',
    str_contains($refresh, "'user_id' => 'eq.' . \$uidArg") && str_contains($refresh, "'status' => 'eq.pending'")
    && str_contains($refresh, '<= time()') && str_contains($refresh, '409'));
check('refresh ставит статус refresh', str_contains($refresh, "['status' => 'refresh']"));
check('новая капча закрывает и refresh-строки', str_contains($post, "'in.(pending,answered,refresh)'"));
check('миграция 146 разрешает статус refresh',
    str_contains($sqlTap, "'pending', 'answered', 'expired', 'solved', 'failed', 'refresh'")
    && str_contains($sqlTap, 'drop constraint if exists jm_jupiter_captcha_status_check'));
check('клиент: jupiterCaptchaRefresh', str_contains($ts, 'export async function jupiterCaptchaRefresh'));

// ── База ────────────────────────────────────────────────────────────────────
check('RLS включён', str_contains($sql, 'enable row level security'));
check('anon/authenticated отозваны',
    (bool)preg_match('~revoke all on public\.jm_jupiter_captcha from anon, authenticated~', $sql));
check('service_role получил доступ',
    str_contains($sql, 'grant all on public.jm_jupiter_captcha to service_role'));
check('статусы закреплены',
    str_contains($sql, "'pending', 'answered', 'expired', 'solved', 'failed'"));
check('таблица в verify-rls', str_contains($guard, "'jm_jupiter_captcha'"));

// ── Клиент ──────────────────────────────────────────────────────────────────
check('клиент: jupiterCaptchaGet/Answer',
    str_contains($ts, 'export async function jupiterCaptchaGet')
    && str_contains($ts, 'export async function jupiterCaptchaAnswer'));

if ($failures) {
    echo "jupiter captcha: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "jupiter captcha: OK\n";
