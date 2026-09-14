<?php
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$failures = [];
function check(string $name, bool $ok): void {
    global $failures;
    if (!$ok) $failures[] = $name;
}
function case_body(string $src, string $fn): string {
    $start = strpos($src, "case '{$fn}': {");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

$create = case_body($db, 'dbCreateChat');
check('dbCreateChat found', $create !== '');
check('first message author comes from authenticated side',
    str_contains($create, "\$author = \$authUid === (string)\$wid ? 'worker' : 'employer';"));
check('worker unread is derived server-side',
    str_contains($create, "\$uw = \$sm && \$author === 'employer' ? 1 : 0;"));
check('employer unread is derived server-side',
    str_contains($create, "\$ue = \$sm && \$author === 'worker' ? 1 : 0;"));
check('client author is not passed to chat_ensure',
    !str_contains($create, 'is_string($author) ? $author : (bool)$author'));

check('read role is bound to authenticated participant',
    str_contains($db, "\$actualChatRole = \$authUid === (string)\$chat['worker_id'] ? 'worker' : 'employer';")
    && str_contains($db, "if (\$fn === 'dbMarkRead' && (string)(\$args[1] ?? '') !== \$actualChatRole)"));
check('unread recipient is forced to the other participant',
    str_contains($db, "\$recipientRole = \$actualChatRole === 'worker' ? 'employer' : 'worker';")
    && str_contains($db, "if ((string)(\$args[1] ?? '') !== \$recipientRole)"));

check('rating loads relation by like id',
    str_contains($db, "sb_single('jm_likes', ['id' => 'eq.' . \$ratingLikeId], 'worker_id,employer_id,vacancy_id')"));
check('rating role is derived from relation',
    str_contains($db, "\$ratingRole = \$authUid === (string)\$ratingLike['worker_id'] ? 'worker'"));
check('rating target and vacancy are bound to relation',
    str_contains($db, "(string)(\$params['toUserId'] ?? '') !== \$ratingTarget")
    && str_contains($db, "(string)(\$params['vacancyId'] ?? '') !== (string)\$ratingLike['vacancy_id']"));
check('rating range is validated',
    str_contains($db, '$ratingValue < 1 || $ratingValue > 5'));

$perm = case_body($db, 'dbApplyPermVacancy');
check('dbApplyPermVacancy found', $perm !== '');
check('permanent vacancy owner is read from vacancy',
    str_contains($perm, "'employer_id,title,company'"));
check('forged permanent vacancy employer is rejected',
    str_contains($perm, '(string)$eid !== $vacEmployer')
    && str_contains($perm, "'Vacancy owner mismatch'"));
$guardAt = strpos($perm, 'Vacancy owner mismatch');
$writeAt = strpos($perm, "sb_upsert('jm_perm_applications'");
check('permanent vacancy owner is checked before write',
    $guardAt !== false && $writeAt !== false && $guardAt < $writeAt);
check('server owner is used after validation', str_contains($perm, '$eid = $vacEmployer;'));

if ($failures) {
    echo "db object authz: FAIL\n";
    foreach ($failures as $failure) echo " - {$failure}\n";
    exit(1);
}
echo "db object authz: OK\n";
