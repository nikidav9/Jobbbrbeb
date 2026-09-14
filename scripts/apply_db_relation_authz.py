from pathlib import Path

DB = Path('php-proxy/db.php')
TEST = Path('tests/db_object_authz_test.php')
s = DB.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    s = s.replace(old, new, 1)


# Keep the account role next to the already validated session. Object-level
# authorization must not trust the role supplied by the client.
replace_once(
    "sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked,sessions_valid_from')",
    "sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked,sessions_valid_from,role')",
    'session account columns',
)
replace_once(
    "sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked')",
    "sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked,role')",
    'session fallback columns',
)

# Creating a chat requires more than being one of two IDs supplied by the
# caller. The employer must own the vacancy. Workers may contact that real
# vacancy owner directly; employers may contact only a worker who has an
# application/like for that vacancy.
old = """if ($fn === 'dbCreateChat') {
    $workerId = (string)($args[0] ?? '');
    $employerId = (string)($args[1] ?? '');
    if ($authUid !== $workerId && $authUid !== $employerId) {
        jt_respond(['error' => 'Chat access denied'], 403); exit;
    }
}
"""
new = """if ($fn === 'dbCreateChat') {
    $workerId = (string)($args[0] ?? '');
    $employerId = (string)($args[1] ?? '');
    $vacancyId = (string)($args[2] ?? '');
    if ($authUid !== $workerId && $authUid !== $employerId) {
        jt_respond(['error' => 'Chat access denied'], 403); exit;
    }

    $chatVacancyKind = 'shift';
    $chatVacancy = $vacancyId !== ''
        ? sb_single('jm_vacancies', ['id' => 'eq.' . $vacancyId], 'employer_id')
        : null;
    if (!$chatVacancy) {
        $chatVacancyKind = 'permanent';
        $chatVacancy = $vacancyId !== ''
            ? sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vacancyId], 'employer_id')
            : null;
    }
    if (!$chatVacancy || (string)($chatVacancy['employer_id'] ?? '') !== $employerId) {
        jt_respond(['error' => 'Chat vacancy mismatch'], 403); exit;
    }

    $chatCallerRole = (string)($acct['role'] ?? '');
    if ($authUid === $workerId) {
        // На постоянной вакансии кнопка «Написать работодателю» доступна до
        // отклика, поэтому работнику достаточно реальной вакансии и её владельца.
        if ($chatCallerRole !== 'worker') {
            jt_respond(['error' => 'Chat role mismatch'], 403); exit;
        }
    } else {
        if ($chatCallerRole !== 'employer') {
            jt_respond(['error' => 'Chat role mismatch'], 403); exit;
        }
        $chatRelation = $chatVacancyKind === 'shift'
            ? sb_single('jm_likes', [
                'vacancy_id' => 'eq.' . $vacancyId,
                'worker_id' => 'eq.' . $workerId,
                'employer_id' => 'eq.' . $employerId,
            ], 'id')
            : sb_single('jm_perm_applications', [
                'vacancy_id' => 'eq.' . $vacancyId,
                'worker_id' => 'eq.' . $workerId,
                'employer_id' => 'eq.' . $employerId,
            ], 'id');
        if (!$chatRelation) {
            jt_respond(['error' => 'Chat relation mismatch'], 403); exit;
        }
    }
}
"""
replace_once(old, new, 'dbCreateChat relation authorization')

# App-open analytics is public for guest measurement, but identified events
# must use identity and role from the validated session, never from public args.
old = """        case 'dbLogOpen': {
            // Событие «открыл приложение». args: [anon_id, user_id|null, role|null, platform|null]
            $anon = isset($args[0]) ? (string)$args[0] : '';
            if ($anon === '') { $data = false; break; }
            sb('POST', 'jm_app_opens', [], [
                'anon_id'   => $anon,
                'user_id'   => $args[1] ?? null,
                'role'      => $args[2] ?? null,
                'platform'  => $args[3] ?? null,
                'opened_at' => now_iso(),
            ], ['Prefer: return=minimal']);
            $data = true;
            break;
        }
"""
new = """        case 'dbLogOpen': {
            // Событие «открыл приложение». anon_id и platform — технические
            // поля клиента. Личность и роль берём только из подписанной сессии:
            // публичный вызов без неё остаётся честно анонимным.
            $anon = isset($args[0]) ? (string)$args[0] : '';
            if ($anon === '') { $data = false; break; }
            $eventUserId = $authUid !== null ? (string)$authUid : null;
            $eventRole = $authUid !== null ? (string)($acct['role'] ?? '') : null;
            sb('POST', 'jm_app_opens', [], [
                'anon_id'   => $anon,
                'user_id'   => $eventUserId,
                'role'      => $eventRole !== '' ? $eventRole : null,
                'platform'  => $args[3] ?? null,
                'opened_at' => now_iso(),
            ], ['Prefer: return=minimal']);
            $data = true;
            break;
        }
"""
replace_once(old, new, 'dbLogOpen identity')

DB.write_text(s)

# Extend the existing source-level regression guard. Keep checks specific to
# the server-side binding, not UI behavior.
t = TEST.read_text()
marker = """if ($failures) {
    echo \"db object authz: FAIL\\n\";
"""
addition = r'''// A caller cannot invent the other chat party. The vacancy owner comes from
// the database; an employer additionally needs a real application/like.
check('chat vacancy owner is loaded server-side',
    str_contains($db, "$chatVacancy = $vacancyId !== ''")
    && str_contains($db, "sb_single('jm_vacancies', ['id' => 'eq.' . $vacancyId], 'employer_id')")
    && str_contains($db, "sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vacancyId], 'employer_id')"));
check('forged chat employer is rejected',
    str_contains($db, "(string)($chatVacancy['employer_id'] ?? '') !== $employerId")
    && str_contains($db, "'Chat vacancy mismatch'"));
check('chat caller role comes from validated account',
    str_contains($db, "$chatCallerRole = (string)($acct['role'] ?? '');")
    && str_contains($db, "'Chat role mismatch'"));
check('employer needs a real chat relation',
    str_contains($db, "sb_single('jm_likes', [")
    && str_contains($db, "sb_single('jm_perm_applications', [")
    && str_contains($db, "'Chat relation mismatch'"));
$chatGuardAt = strpos($db, "'Chat vacancy mismatch'");
$chatCreateAt = strpos($db, "case 'dbCreateChat': {");
check('chat relation is checked before creation',
    $chatGuardAt !== false && $chatCreateAt !== false && $chatGuardAt < $chatCreateAt);

$logOpen = case_body($db, 'dbLogOpen');
check('dbLogOpen found', $logOpen !== '');
check('identified app open uses session identity',
    str_contains($logOpen, '$eventUserId = $authUid !== null ? (string)$authUid : null;')
    && str_contains($logOpen, "'user_id'   => $eventUserId"));
check('app open role uses validated account',
    str_contains($logOpen, '$eventRole = $authUid !== null ? (string)($acct[\'role\'] ?? \'\') : null;')
    && str_contains($logOpen, "'role'      => $eventRole !== '' ? $eventRole : null"));
check('public app open cannot claim another identity',
    !str_contains($logOpen, "'user_id'   => $args[1] ?? null")
    && !str_contains($logOpen, "'role'      => $args[2] ?? null"));

'''
if t.count(marker) != 1:
    raise SystemExit(f'test insertion marker: expected 1 match, got {t.count(marker)}')
TEST.write_text(t.replace(marker, addition + marker, 1))
