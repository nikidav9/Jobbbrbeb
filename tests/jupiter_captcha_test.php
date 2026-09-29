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
foreach (['jupiterCaptchaGet', 'jupiterCaptchaAnswer'] as $fn) {
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
$ans = $body('jupiterCaptchaAnswer', 'jupiterCaptchaPoll');
$poll = $body('jupiterCaptchaPoll', 'jupiterCaptchaResult');

check('картинка ограничена 200 КБ', str_contains($post, '200000'));
check('капча ставит CAPTCHA_HUMAN и action_required',
    str_contains($post, "'state' => 'action_required'") && str_contains($post, "'reason_code' => 'CAPTCHA_HUMAN'"));
check('пуш зовёт notify_user', str_contains($post, 'notify_user('));
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
