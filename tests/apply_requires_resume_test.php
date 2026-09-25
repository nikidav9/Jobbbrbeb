<?php
// Отклик на постоянную вакансию без резюме не проходит.
//
// Решение владельца 25.09: откликаться можно только с загруженным резюме —
// и на карьерные вакансии (уже было в jupiterEnqueue), и на свои. Проверка
// клиента old-сборки не знает: серверную проверку обходить нельзя, значит
// она обязана стоять в самом db.php, до записи отклика.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function case_body(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}':");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

// ── Своя вакансия: без резюме — 409, до записи отклика ───────────────────────
$apply = case_body($db, 'dbApplyPermVacancy');
check('dbApplyPermVacancy найдена', $apply !== '');
check('проверяет выбранное резюме по владельцу отклика',
    str_contains($apply, "'user_id' => 'eq.' . \$wid, 'selected' => 'eq.true'"));
check('без сохранённого файла — 409 с понятным текстом',
    str_contains($apply, "jt_respond(['error' => 'Сначала загрузите и выберите резюме PDF'], 409)"));

$resumeAt = strpos($apply, "'jm_resume_files'");
$writeAt = strpos($apply, "sb_upsert('jm_perm_applications'");
check('проверка резюме стоит раньше записи отклика',
    $resumeAt !== false && $writeAt !== false && $resumeAt < $writeAt);

// ── Смена (старая сборка): новый отклик работника — тоже с резюме ────────────
$like = case_body($db, 'dbUpsertLike');
check('dbUpsertLike найдена', $like !== '');
check('dbUpsertLike проверяет резюме только на новом отклике работника',
    str_contains($like, "if (!empty(\$upd['workerLiked']) && empty(\$existingLike['worker_liked']))")
    && str_contains($like, "'user_id' => 'eq.' . \$wid, 'selected' => 'eq.true'")
    && str_contains($like, "jt_respond(['error' => 'Сначала загрузите и выберите резюме PDF'], 409)"));
$likeResumeAt = strpos($like, "'jm_resume_files'");
$likeWriteAt = strpos($like, "sb_upsert('jm_likes'");
check('в dbUpsertLike проверка резюме раньше записи',
    $likeResumeAt !== false && $likeWriteAt !== false && $likeResumeAt < $likeWriteAt);

// ── Карьерная вакансия: та же проверка не пропала ─────────────────────────────
$enqueue = case_body($db, 'jupiterEnqueue');
check('jupiterEnqueue найдена', $enqueue !== '');
check('jupiterEnqueue тоже требует резюме',
    str_contains($enqueue, "'user_id' => 'eq.' . \$uidArg, 'selected' => 'eq.true'")
    && str_contains($enqueue, "jt_respond(['error' => 'Сначала загрузите и выберите резюме PDF'], 409)"));

if ($failures) {
    echo "apply requires resume: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "apply requires resume: OK\n";
