<?php
// Реферальная программа после закрытия смен: приглашённого «наняли» —
// поручительство записывается ровно один раз и только если отклик перевёл
// его работодатель. Проверяем поведение, а не текст: тела функций достаём из
// db.php и исполняем на подменённых sb_* (целиком db.php подключить нельзя —
// это обработчик запроса).

$root = __DIR__ . '/..';
$db = (string)file_get_contents("$root/php-proxy/db.php");
$mig = (string)@file_get_contents("$root/supabase/migrations/131_referral_hired.sql");

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

// ── Подмена слоя данных: таблицы в памяти ─────────────────────────────────────
$GLOBALS['T'] = ['jm_users' => [], 'jm_referral_rewards' => []];
function t_match(array $row, array $f): bool
{
    foreach ($f as $k => $v) {
        if (!str_starts_with((string)$v, 'eq.')) continue;
        if ((string)($row[$k] ?? '') !== substr((string)$v, 3)) return false;
    }
    return true;
}
function sb_single(string $t, array $f = [], string $sel = '*'): ?array
{
    foreach ($GLOBALS['T'][$t] as $row) if (t_match($row, $f)) return $row;
    return null;
}
function sb_insert(string $t, array $data, bool $ret = false): array
{
    $GLOBALS['T'][$t][] = $data;
    return $data;
}
function sb_update(string $t, array $f, array $data): void
{
    foreach ($GLOBALS['T'][$t] as $i => $row) {
        if (t_match($row, $f)) $GLOBALS['T'][$t][$i] = $data + $row;
    }
}
function uid(): string { static $n = 0; return 'r' . (++$n); }
function now_iso(): string { return '2026-09-28T00:00:00Z'; }

$hire = fn_body($db, 'jt_referral_on_hire');
$bump = fn_body($db, 'jt_referral_bump');
check('jt_referral_on_hire найдена', $hire !== '');
check('jt_referral_bump найдена', $bump !== '');
if ($hire === '' || $bump === '') {
    fwrite(STDERR, "FAIL: тела функций не найдены\n");
    exit(1);
}
eval($hire . "\n}\n");
eval($bump . "\n}\n");

function reset_db(): void
{
    $GLOBALS['T'] = [
        'jm_users' => [
            ['id' => 'inviter', 'referral_worked' => 0],
            ['id' => 'worker', 'invited_by' => 'inviter'],
            ['id' => 'loner', 'invited_by' => null],
            ['id' => 'emp', 'referral_worked' => 0],
            ['id' => 'other_emp'],
        ],
        'jm_referral_rewards' => [],
    ];
}
function inviter_count(): int { return (int)sb_single('jm_users', ['id' => 'eq.inviter'])['referral_worked']; }
function rewards(): int { return count($GLOBALS['T']['jm_referral_rewards']); }

// ── Приглашённого наняли: одна запись, счётчик +1 ─────────────────────────────
reset_db();
jt_referral_on_hire('worker', 'emp', 'emp');
check('найм записан', rewards() === 1);
check('исход — hired', ($GLOBALS['T']['jm_referral_rewards'][0]['outcome'] ?? '') === 'hired');
check('награда пригласившему', ($GLOBALS['T']['jm_referral_rewards'][0]['inviter_id'] ?? '') === 'inviter');
check('счётчик вырос на 1', inviter_count() === 1);

// ── Повтор не удваивает ───────────────────────────────────────────────────────
jt_referral_on_hire('worker', 'emp', 'emp');
jt_referral_on_hire('worker', 'other_emp', 'other_emp');
check('повторный найм не добавляет строку', rewards() === 1);
check('повторный найм не растит счётчик', inviter_count() === 1);

// ── Уже есть запись о смене — второй не заводим ───────────────────────────────
reset_db();
$GLOBALS['T']['jm_referral_rewards'][] = ['id' => 'old', 'inviter_id' => 'inviter',
    'invitee_id' => 'worker', 'outcome' => 'worked'];
jt_referral_on_hire('worker', 'emp', 'emp');
check('старая запись о смене блокирует найм', rewards() === 1 && inviter_count() === 0);

// ── Чужой работодатель не может ───────────────────────────────────────────────
reset_db();
jt_referral_on_hire('worker', 'emp', 'other_emp');
check('чужая сессия не записывает', rewards() === 0 && inviter_count() === 0);
jt_referral_on_hire('worker', 'emp', null);
jt_referral_on_hire('worker', 'emp', '');
check('без сессии не записывает', rewards() === 0);

// ── Без invited_by — ничего ───────────────────────────────────────────────────
reset_db();
jt_referral_on_hire('loner', 'emp', 'emp');
check('без приглашения ничего не пишется', rewards() === 0 && inviter_count() === 0);

// ── Пригласивший не нанимает сам ──────────────────────────────────────────────
reset_db();
jt_referral_on_hire('worker', 'inviter', 'inviter');
check('пригласивший не может нанять своего', rewards() === 0);

// ── Проводка ──────────────────────────────────────────────────────────────────
$cs = strpos($db, "case 'dbSetPermApplicationStatus':");
$ce = $cs !== false ? strpos($db, "\n        // ──", $cs) : false;
$caseBody = ($cs !== false && $ce !== false) ? substr($db, $cs, $ce - $cs) : '';
check('обработчик статуса найден', $caseBody !== '');
check('найм зовёт поручительство сессией работодателя',
    str_contains($caseBody, "jt_referral_on_hire(") && str_contains($caseBody, '(string)$authUid'));
check('проверка владения отклика осталась',
    str_contains($caseBody, "(string)(\$app['employer_id'] ?? '') !== (string)\$authUid"));
check('dbGetMyReferral отдаёт hired', str_contains($db, "'eq.hired'"));
check('миграция расширяет ограничение', str_contains($mig, "check (outcome in ('worked', 'no_show', 'hired'))")
    && str_contains($mig, 'drop constraint if exists jm_referral_rewards_outcome_check'));

if ($failures) {
    fwrite(STDERR, "FAIL:\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}
echo "OK\n";
