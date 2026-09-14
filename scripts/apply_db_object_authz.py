from pathlib import Path

DB = Path('php-proxy/db.php')
CI = Path('.github/workflows/ci.yml')
TEST = Path('tests/db_object_authz_test.php')

s = DB.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    s = s.replace(old, new, 1)


# A chat participant may only mark their own side as read. IncrementUnread has
# inverse semantics: the sender increments the recipient side.
old = """    if ($fn === 'dbInsertMessage' && (string)($args[1] ?? '') !== $authUid) {
        jt_respond(['error' => 'Invalid sender'], 403); exit;
    }
}
if ($fn === 'dbCreateChat') {
"""
new = """    if ($fn === 'dbInsertMessage' && (string)($args[1] ?? '') !== $authUid) {
        jt_respond(['error' => 'Invalid sender'], 403); exit;
    }
    $actualChatRole = $authUid === (string)$chat['worker_id'] ? 'worker' : 'employer';
    if ($fn === 'dbMarkRead' && (string)($args[1] ?? '') !== $actualChatRole) {
        jt_respond(['error' => 'Read state role mismatch'], 403); exit;
    }
    if ($fn === 'dbIncrementUnread') {
        $recipientRole = $actualChatRole === 'worker' ? 'employer' : 'worker';
        if ((string)($args[1] ?? '') !== $recipientRole) {
            jt_respond(['error' => 'Unread recipient mismatch'], 403); exit;
        }
    }
}
if ($fn === 'dbCreateChat') {
"""
replace_once(old, new, 'chat role authorization')

# Rating identity is a relation, not just fromUserId. Bind all client-supplied
# object IDs and role to the actual jm_likes row before any write.
old = """if ($fn === 'dbSubmitRatingAndMaybeDelete') {
    $params = is_array($args[0] ?? null) ? $args[0] : [];
    if ((string)($params['fromUserId'] ?? '') !== $authUid) {
        jt_respond(['error' => 'Rating author mismatch'], 403); exit;
    }
}
"""
new = """if ($fn === 'dbSubmitRatingAndMaybeDelete') {
    $params = is_array($args[0] ?? null) ? $args[0] : [];
    if ((string)($params['fromUserId'] ?? '') !== $authUid) {
        jt_respond(['error' => 'Rating author mismatch'], 403); exit;
    }
    $ratingLikeId = (string)($params['likeId'] ?? '');
    $ratingLike = $ratingLikeId !== ''
        ? sb_single('jm_likes', ['id' => 'eq.' . $ratingLikeId], 'worker_id,employer_id,vacancy_id')
        : null;
    if (!$ratingLike) {
        jt_respond(['error' => 'Rating relation not found'], 404); exit;
    }
    $ratingRole = $authUid === (string)$ratingLike['worker_id'] ? 'worker'
        : ($authUid === (string)$ratingLike['employer_id'] ? 'employer' : '');
    $ratingTarget = $ratingRole === 'worker'
        ? (string)$ratingLike['employer_id']
        : ($ratingRole === 'employer' ? (string)$ratingLike['worker_id'] : '');
    if ($ratingRole === ''
        || (string)($params['role'] ?? '') !== $ratingRole
        || (string)($params['toUserId'] ?? '') !== $ratingTarget
        || (string)($params['vacancyId'] ?? '') !== (string)$ratingLike['vacancy_id']) {
        jt_respond(['error' => 'Rating relation mismatch'], 403); exit;
    }
    $ratingValue = (int)($params['rating'] ?? 0);
    if ($ratingValue < 1 || $ratingValue > 5) {
        jt_respond(['error' => 'Rating must be between 1 and 5'], 400); exit;
    }
    foreach (['quality', 'speed', 'matchedDesc', 'attitude', 'paidOnTime'] as $metric) {
        if (!array_key_exists($metric, $params) || $params[$metric] === null) continue;
        $metricValue = (int)$params[$metric];
        if ($metricValue < 1 || $metricValue > 5) {
            jt_respond(['error' => 'Rating metric must be between 1 and 5'], 400); exit;
        }
    }
}
"""
replace_once(old, new, 'rating relation authorization')

# The caller, not a client author flag, owns the first chat message. Derive
# unread counters from the same authenticated side.
old = """            $author = $args[8] ?? false;
            $data = chat_ensure($wid, $eid, (string)$vid, (string)$vt, (string)$cn,
                                $sm, (int)$uw, (int)$ue,
                                is_string($author) ? $author : (bool)$author);
"""
new = """            $author = $authUid === (string)$wid ? 'worker' : 'employer';
            $uw = $sm && $author === 'employer' ? 1 : 0;
            $ue = $sm && $author === 'worker' ? 1 : 0;
            $data = chat_ensure($wid, $eid, (string)$vid, (string)$vt, (string)$cn,
                                $sm, (int)$uw, (int)$ue, $author);
"""
replace_once(old, new, 'chat first-message author')

# Permanent-vacancy applications are bound to the vacancy owner. A forged
# employerId must fail before the application/chat/notification is created.
marker = "        case 'dbApplyPermVacancy': {"
start = s.find(marker)
if start < 0:
    raise SystemExit('dbApplyPermVacancy case not found')
end = s.find("\n        case '", start + len(marker))
if end < 0:
    raise SystemExit('dbApplyPermVacancy case end not found')
body = s[start:end]
head_old = "            [$vid, $wid, $eid, $sm] = [$args[0], $args[1], $args[2], $args[3] ?? null];\n"
head_new = """            [$vid, $wid, $eid, $sm] = [$args[0], $args[1], $args[2], $args[3] ?? null];
            $pv = sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vid], 'employer_id,title,company');
            if (!$pv) { jt_respond(['error' => 'Вакансия не найдена'], 404); exit; }
            $vacEmployer = (string)($pv['employer_id'] ?? '');
            if ($vacEmployer === '' || (string)$eid !== $vacEmployer) {
                jt_respond(['error' => 'Vacancy owner mismatch'], 403); exit;
            }
            // Ни запись, ни чат, ни уведомление ниже больше не используют
            // клиентский employerId как источник истины.
            $eid = $vacEmployer;
"""
if body.count(head_old) != 1:
    raise SystemExit('dbApplyPermVacancy head changed')
body = body.replace(head_old, head_new, 1)
duplicate = "            $pv = sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vid], 'title,company');\n"
if body.count(duplicate) != 1:
    raise SystemExit('dbApplyPermVacancy vacancy lookup changed')
body = body.replace(duplicate, '', 1)
s = s[:start] + body + s[end:]

DB.write_text(s)

# Source-level regression guard, following the convention of the existing PHP
# authz tests in this repository.
TEST.write_text(r'''<?php
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
''')

# Make the regression test part of the normal PR gate.
y = CI.read_text()
needle = """      - name: Отклик на смену меняет его сторона, а отказ доходит до человека
        run: php tests/like_authz_test.php
"""
insert = needle + """
      - name: Объектные права чата, рейтинга и постоянного отклика
        run: php tests/db_object_authz_test.php
"""
if y.count(needle) != 1:
    raise SystemExit(f'CI insertion point: expected 1 match, got {y.count(needle)}')
CI.write_text(y.replace(needle, insert, 1))
