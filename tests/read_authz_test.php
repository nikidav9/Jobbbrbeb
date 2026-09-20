<?php
// Чужие данные на чтение. Вторая половина сплошной ревизии прав.
//
// Первая половина закрыла запись и отправку сообщений. Здесь — то, что
// операции ОТДАВАЛИ: любому вошедшему, по чужому идентификатору.
//
// Отдельно стоит отметить то, чего эти проверки не стерегут и что тут не
// считается дырой: имя, рейтинг и метро человека (USER_PUBLIC_COLS) видны
// собеседнику по делу, а отзывы на то и отзывы, чтобы их читали.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$chat = (string)file_get_contents(__DIR__ . '/../app/chat-room.tsx');
$ctx = (string)file_get_contents(__DIR__ . '/../contexts/AppContext.tsx');

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

function case_body(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}':");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

// ── Приватная анкета профиля не утекает в чужой профиль ──────────────────────
$publicCols = '';
if (preg_match("~define\('USER_PUBLIC_COLS',(.*?)\]\)\);~s", $db, $m)) $publicCols = $m[1];
check('личная анкета не входит в публичную проекцию',
    $publicCols !== '' && !str_contains($publicCols, 'personal_data'));
check('личная анкета возвращается только владельцу',
    str_contains($db, "USER_PUBLIC_COLS . ',phone,resume_email,resume_file_name,resume_imported_at,personal_data'"));

// ── PDF-резюме: только владелец и только закрытый бакет ─────────────────────
$resumeList = case_body($db, 'dbGetResumeFiles');
$resumeOpen = case_body($db, 'dbSignResumeFile');
$resumeSave = case_body($db, 'dbSaveResumeFile');
$resumeSelect = case_body($db, 'dbSelectResumeFile');
$resumeDelete = case_body($db, 'dbDeleteResumeFile');
check('список резюме ограничен владельцем',
    str_contains($resumeList, "'user_id' => 'eq.' . (string)\$authUid"));
check('просмотр PDF проверяет владельца строки',
    str_contains($resumeOpen, "'user_id' => 'eq.' . (string)\$authUid"));
check('выбор резюме проверяет владельца строки',
    str_contains($resumeSelect, "'user_id' => 'eq.' . (string)\$authUid"));
check('удаление резюме проверяет владельца строки',
    str_contains($resumeDelete, "'user_id' => 'eq.' . (string)\$authUid"));
check('новое резюме записывается владельцу из сессии',
    str_contains($resumeSave, "'user_id' => (string)\$authUid"));
check('исходный PDF кладётся в закрытый resume-files',
    str_contains($db, "/storage/v1/object/resume-files/"));
check('PDF открывается только короткой подписанной ссылкой',
    str_contains($db, "/storage/v1/object/sign/resume-files/"));

$vaultMigration = (string)file_get_contents(__DIR__ . '/../supabase/migrations/100_resume_vault.sql');
check('бакет резюме приватный',
    str_contains($vaultMigration, "values ('resume-files', 'resume-files', false)"));
check('таблица сейфа закрыта RLS',
    str_contains($vaultMigration, 'alter table public.jm_resume_files enable row level security'));
check('у пользователя только одно активное резюме',
    str_contains($vaultMigration, 'jm_resume_files_one_selected_per_user'));

// ── Таблица откликов больше не отдаётся целиком ──────────────────────────────
// Прежде: sb_select('jm_likes') без фильтра — кто куда откликался, кому
// отказали и чем кончилась смена, по всему сервису, любому вошедшему.
$likes = case_body($db, 'dbGetLikes');
check('свои отклики выбираются по себе',
    str_contains($likes, '"(worker_id.eq.{$me},employer_id.eq.{$me})"'));
check('без сессии откликов нет', str_contains($likes, "\$data = \$me === '' ? []"));
check('таблица целиком больше не выбирается',
    !preg_match("~sb_select\('jm_likes'\)~", $likes));

// ── Один отклик виден обеим сторонам смены ───────────────────────────────────
// Операция была в $selfArgFns, то есть работодателю отвечала отказом, и экран
// переписки обходил это, выкачивая все отклики сервиса. Проверка, которую
// обходят мягким путём, хуже отсутствующей: она создаёт видимость.
$one = case_body($db, 'dbGetLikeByVacancyWorker');
check('работник видит свой отклик', str_contains($one, "if (\$me !== (string)(\$args[1] ?? '')) {"));
check('владелец смены тоже видит',
    str_contains($one, "sb_single('jm_vacancies', ['id' => 'eq.' . (string)(\$args[0] ?? '')], 'employer_id')"));
check('посторонний — отказ', str_contains($one, "jt_respond(['error' => 'Это не ваш отклик'], 403)"));
$selfBlock = '';
if (preg_match('~\$selfArgFns = \[(.*?)\n\];~s', $db, $m)) $selfBlock = $m[1];
check('из списка «только сам» операция убрана',
    $selfBlock !== '' && !str_contains($selfBlock, "'dbGetLikeByVacancyWorker'"));
check('экран переписки спрашивает один отклик',
    str_contains($chat, 'dbGetLikeByVacancyWorker(chat.vacancyId, chat.workerId)'));
check('экран переписки больше не тянет все', !str_contains($chat, 'dbGetLikes()'));
check('и приложение тоже', !str_contains($ctx, 'await dbGetLikes()'));

// ── Файлы переписки ──────────────────────────────────────────────────────────
// Бакет закрытый, но подписать ссылку на ЛЮБОЙ файл мог любой вошедший — то
// есть прочитать чужую переписку в фотографиях и голосовых. Залить с чужим
// именем (и подменить, стоит x-upsert) — тоже.
$path = fn_body($db, 'jt_chat_id_from_media_path');
check('id чата достаётся из имени файла', $path !== '');
check('голосовые тоже разбираются', str_contains($path, "str_starts_with(\$name, 'voice_')"));
foreach (['dbSignMedia', 'dbUploadChatMedia'] as $op) {
    $body = case_body($db, $op);
    check("{$op}: только сторона переписки",
        str_contains($body, 'jt_require_chat_party($authUid, jt_chat_id_from_media_path('));
}
// Проверка должна стоять ДО обращения к хранилищу.
$up = case_body($db, 'dbUploadChatMedia');
$guardAt = strpos($up, 'jt_require_chat_party');
$storeAt = strpos($up, "curl_init(SB_URL . '/storage/v1/object/chat-media/'");
check('проверка раньше заливки',
    $guardAt !== false && $storeAt !== false && $guardAt < $storeAt);

// ── Жалоба подаётся от себя ──────────────────────────────────────────────────
$complaint = case_body($db, 'dbFileComplaint');
check('заявитель из сессии, а не из тела запроса',
    str_contains($complaint, "'reporter_id' => (string)(\$authUid ?? '')")
    && !str_contains($complaint, "\$p['reporterId']"));

// ── Кто смотрел постоянную вакансию — только её владельцу ───────────────────
// У сменной вакансии близнец этой операции проверку имел, у постоянной — нет.
$ownedBlock = '';
if (preg_match('~\$ownedVacancyFns = \[(.*?)\n\];~s', $db, $m)) $ownedBlock = $m[1];
check('список «своя вакансия» найден', $ownedBlock !== '');
check('смотревших постоянную вакансию видит владелец',
    str_contains($ownedBlock, "'dbGetPermVacancyViewers' => ['jm_perm_vacancies', 0]"));
check('и у сменной по-прежнему так же',
    str_contains($ownedBlock, "'dbGetVacancyViewers' => ['jm_vacancies', 0]"));

if ($failures) {
    echo "read authz: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "read authz: OK\n";
