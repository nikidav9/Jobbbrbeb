<?php
// Эскалация заявок Юпитера на браузер (миграция 136, решение владельца
// 29.09.2026). Статическая проверка, как соседние jupiter_*_test.php.
$root = dirname(__DIR__);
$db = file_get_contents("$root/php-proxy/db.php");
$sql = file_get_contents("$root/supabase/migrations/136_jupiter_engine_routing.sql");
$rt = file_get_contents("$root/jupiter/remote_tasks.py");

function check(bool $ok, string $what): void {
    if (!$ok) { fwrite(STDERR, "FAIL: $what\n"); exit(1); }
}

// База: у заявки движок, по умолчанию http; выдача — только своему движку.
check(str_contains($sql, "add column if not exists engine text not null default 'http'"), 'колонка engine по умолчанию http');
check(str_contains($sql, "check (engine in ('http', 'browser'))"), 'check на значения движка');
check(str_contains($sql, 'where engine = p_engine'), 'выдача задачи только своему движку');
check(str_contains($sql, "jupiter_lease_task(p_worker, p_lease_seconds, 'http')"), 'старый вызов — это http');
check(str_contains($sql, 'grant execute on function jupiter_lease_task(text, integer, text) to service_role'), 'grant service_role');
check(str_contains($sql, 'revoke all on function jupiter_lease_task(text, integer, text) from anon'), 'revoke anon');

// Сервер: движок в выдаче, эскалация только при всех условиях.
check(str_contains($db, "'p_engine' => \$engine"), 'jupiterLease передаёт движок');
check(str_contains($db, "if (!in_array(\$engine, ['http', 'browser'], true))"), 'неизвестный движок — 400');
check(str_contains($db, "define('JT_BROWSER_SUBMIT_FROM', '2026-09-29');"), 'редакция соглашения для браузера');
check((bool)preg_match("~jt_secret\('JUPITER_BROWSER_ENABLED'\) === '1'~", $db), 'эскалация только при включённой службе');
check(str_contains($db, "&& !empty(\$task['submission_authorized_at'])"), 'эскалация только с поручением на отправку');
check(str_contains($db, "&& jt_browser_delegated((string)(\$task['user_id'] ?? ''))"), 'эскалация только принявшим 2026-09-29');
check(str_contains($db, "const JT_BROWSER_ESCALATE_REASONS = ['UNSUPPORTED_SCRIPT', 'VACANCY_NOT_FOUND', 'STEP_DID_NOT_ADVANCE', 'CAPTCHA_REQUIRED', 'NAVIGATION_FAILED'];"), 'причины эскалации');
// Капча эскалируется: браузер покажет её человеку (jupiterCaptchaPost), а не решит сам.
check(str_contains($db, "'STEP_DID_NOT_ADVANCE', 'CAPTCHA_REQUIRED'"), 'капча эскалируется на браузер');
// Капча человеку не зависит от движка: Get/Answer смотрят только владельца и заявку.
$ca = strpos($db, "case 'jupiterCaptchaGet': {");
$cb = strpos($db, "case 'jupiterCaptchaPoll': {", (int)$ca);
check($ca !== false && $cb !== false && !str_contains(substr($db, $ca, $cb - $ca), 'engine'), 'капча человеку не смотрит на движок');

// Редакция сравнивается строкой: 2026-09-26-2 — раньше, 2026-09-29 — годится.
check(str_contains($db, "strcmp(\$pair[1], JT_BROWSER_SUBMIT_FROM) >= 0"), 'сравнение редакции terms');
check(strcmp('2026-09-26-2', '2026-09-29') < 0 && strcmp('2026-09-29', '2026-09-29') >= 0, 'порядок редакций');

// Воркер просит свои задачи.
check(str_contains($rt, 'self._call("jupiterLease", [worker, self._lease_seconds, self._engine])'), 'воркер передаёт движок');

echo "jupiter engine routing: OK\n";
