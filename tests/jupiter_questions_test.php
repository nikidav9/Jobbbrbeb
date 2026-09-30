<?php
// Вопросы от работодателей (миграция 137): права, хранение, банк ответов,
// возврат отклика в очередь. Проверки статические, как в соседних тестах.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$sql = (string)file_get_contents(__DIR__ . '/../supabase/migrations/137_jupiter_questions.sql');
$guard = (string)file_get_contents(__DIR__ . '/../infra/verify-rls.sh');
$ts = (string)file_get_contents(__DIR__ . '/../services/db.ts');

$block = function (string $name) use ($db): string {
    $a = strpos($db, $name . ' = [');
    return substr($db, $a, strpos($db, '];', $a) - $a);
};
$adminBlock = $block('$adminFns');
$selfBlock = $block('$selfArgFns');
$publicBlock = $block('$publicFns');

// ── Права ───────────────────────────────────────────────────────────────────
$human = ['jupiterQuestions', 'jupiterAnswerQuestion', 'jupiterSkipQuestion', 'jupiterAnswers', 'jupiterAnswerDelete'];
foreach ($human as $fn) {
    check("$fn привязан к владельцу",
        str_contains($selfBlock, "'$fn' => 0")
        && !str_contains($adminBlock, "'$fn'") && !str_contains($publicBlock, "'$fn'"));
    check("$fn есть в services/db.ts", str_contains($ts, "'$fn'"));
}
check('профиль и итог — только воркеру',
    str_contains($adminBlock, "'jupiterGetCandidateProfile'") && str_contains($adminBlock, "'jupiterFinish'"));

// ── Логика ──────────────────────────────────────────────────────────────────
$body = function (string $case, string $next) use ($db): string {
    $a = strpos($db, "case '$case': {");
    $b = strpos($db, "case '$next': {", $a);
    return $a === false ? '' : substr($db, $a, $b - $a);
};
$finish = $body('jupiterFinish', 'jupiterCaptchaPost');
$profile = $body('jupiterGetCandidateProfile', 'jupiterQuestions');
$list = $body('jupiterQuestions', 'jupiterAnswerQuestion');
$answer = $body('jupiterAnswerQuestion', 'jupiterSkipQuestion');
$skip = $body('jupiterSkipQuestion', 'jupiterAnswers');
$del = $body('jupiterAnswerDelete', 'dbApplyPermVacancy');

check('итог воркера кладёт вопросы только при action_required',
    str_contains($finish, "\$state === 'action_required' && is_array(\$extra['questions']")
    && str_contains($finish, 'jt_questions_store('));
check('ключ вопроса проверяется', str_contains($db, "preg_match('/^q:[0-9a-f]{16}\$/', \$key)"));
check('не больше 30 вопросов и 50 вариантов',
    str_contains($db, 'array_slice($questions, 0, 30)') && str_contains($db, ', 0, 50)'));
check('профиль отдаёт ответы объектом', str_contains($profile, "'answers' => (object)\$answers"));
check('ответы отклика берутся только свои',
    str_contains($profile, "'application_id' => 'eq.' . \$appArg, 'user_id' => 'eq.' . \$uid"));
foreach (['list' => $list, 'answer' => $answer, 'skip' => $skip, 'delete' => $del] as $name => $code) {
    check("$name фильтрует по владельцу", str_contains($code, "'user_id' => 'eq.' . "));
}
check('ответ ограничен 2000 символами', str_contains($answer, 'mb_strlen($answer) > 2000'));
check('вариант списка — только из тех, что на сайте', str_contains($answer, 'Выберите один из вариантов'));
check('факт — в банк ответов', str_contains($answer, "sb_upsert('jm_jupiter_answers'"));
check('вопрос под вакансию в банк не идёт', str_contains($answer, "if (\$q['kind'] === 'fact')"));
check('после ответа отклик отпускается', str_contains($answer, 'jt_questions_release('));
check('в очередь — только отклик, ждавший ответов',
    str_contains($db, "'state' => 'eq.action_required', 'reason_code' => 'eq.NEEDS_ANSWERS'")
    && str_contains($db, "'state' => 'queued', 'reason_code' => null"));
check('пропуск отдаёт отклик человеку', str_contains($db, "['reason_code' => 'MISSING_PROFILE_FIELD'"));

// ── База ────────────────────────────────────────────────────────────────────
foreach (['jm_jupiter_questions', 'jm_jupiter_answers'] as $t) {
    check("$t под RLS", str_contains($sql, "alter table public.$t enable row level security")
        && str_contains($sql, "revoke all on public.$t from anon, authenticated"));
    check("$t в стороже RLS", str_contains($guard, "('$t')"));
}
check('вопрос удаляется вместе с откликом',
    str_contains($sql, 'references public.jm_jupiter_applications(id) on delete cascade'));

if ($failures) {
    fwrite(STDERR, "jupiter questions: ПРОВАЛЫ\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}
echo "jupiter questions: ok\n";
