<?php
// Письмо компании подтверждает отклик «Скорее всего, ушёл» (план Юпитера,
// часть 2, шаг 4). Поведение jt_mail_confirm_applications на подставной базе:
// функции берутся из db.php как есть, sb_* заменены записью в память.
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

function check(bool $ok, string $what): void {
    if (!$ok) { fwrite(STDERR, "FAIL: $what\n"); exit(1); }
}
function cut(string $src, string $name): string {
    $at = strpos($src, "function $name(");
    if ($at === false) { fwrite(STDERR, "FAIL: нет $name\n"); exit(1); }
    $open = strpos($src, '{', $at);
    $depth = 0;
    for ($i = $open; $i < strlen($src); $i++) {
        if ($src[$i] === '{') $depth++;
        if ($src[$i] === '}' && --$depth === 0) return substr($src, $at, $i - $at + 1);
    }
    return '';
}

$APPS = [];
$UPDATES = [];
$RECENT = [];
$PUSHES = [];
function sb_select(string $t, array $f, string $cols) {
    global $APPS, $RECENT;
    if ($t === 'jm_notifications') {
        check($f['type'] === 'eq.jupiter_failed' && $f['user_id'] === 'eq.u1', 'пуш считается по своему типу и человеку');
        return $RECENT;
    }
    check($f['user_id'] === 'eq.u1' && $f['state'] === 'eq.submission_unknown', 'выбираются только свои «скорее всего, ушёл»');
    return $APPS;
}
function notify_user(string $uid, string $title, string $body, string $type) { global $PUSHES; $PUSHES[] = [$uid, $title, $type]; }
function sb_update(string $t, array $f, array $patch) { global $UPDATES; $UPDATES[] = [$f, $patch]; return true; }
function now_iso(): string { return '2026-10-01T12:00:00Z'; }
function rt_touch(string $t): void {}
eval(cut($db, 'jt_mail_base_domain'));
eval(cut($db, 'jt_mail_confirm_applications'));
eval(cut($db, 'jt_failed_notify'));

$APPS = [
    ['id' => 'a-mts', 'company' => 'МТС', 'vacancy_url' => 'https://job.mts.ru/vacancies/1'],
    ['id' => 'a-mobile', 'company' => 'MobileUp', 'vacancy_url' => 'https://mobileup.ru/career'],
];

// Домен отправителя совпал с сайтом вакансии (поддомены не важны).
$UPDATES = [];
$ids = jt_mail_confirm_applications('u1', ['sender' => 'МТС Карьера <noreply@hr.mts.ru>',
    'subject' => 'Мы получили ваш отклик', 'body' => '']);
check($ids === ['a-mts'], 'письмо с hr.mts.ru подтверждает отклик в МТС');
check($UPDATES[0][1]['state'] === 'submitted' && $UPDATES[0][1]['reason_code'] === 'MAIL_CONFIRMED', 'статус — отправлено, причина MAIL_CONFIRMED');
check($UPDATES[0][0]['state'] === 'eq.submission_unknown' && $UPDATES[0][0]['user_id'] === 'eq.u1', 'обновление условное и только своё');

// ATS с чужого домена — по названию компании в теме.
$UPDATES = [];
$ids = jt_mail_confirm_applications('u1', ['sender' => 'Huntflow <no-reply@huntflow.ru>',
    'subject' => 'MobileUp: спасибо за резюме', 'body' => '']);
check($ids === ['a-mobile'], 'письмо из Huntflow с названием компании в теме');

// Отказ — тоже доказательство, что анкета дошла.
$ids = jt_mail_confirm_applications('u1', ['sender' => 'hr@mts.ru', 'subject' => 'Ответ по вакансии',
    'body' => 'К сожалению, по вашему отклику мы приняли другое решение']);
check($ids === ['a-mts'], 'отказ подтверждает доставку');

// Рассылка без слов об отклике и письмо чужой компании — не подтверждают.
$UPDATES = [];
check(jt_mail_confirm_applications('u1', ['sender' => 'news@mts.ru', 'subject' => 'Скидки недели', 'body' => 'Тарифы']) === [],
    'рассылка без слов об отклике не подтверждает');
check(jt_mail_confirm_applications('u1', ['sender' => 'hr@ozon.ru', 'subject' => 'Ваш отклик получен', 'body' => '']) === [],
    'письмо другой компании не подтверждает');
check($UPDATES === [], 'в базе ничего не меняется');

// Ingest зовёт подтверждение и не теряет письмо при сбое.
$ingest = substr($db, (int)strpos($db, "case 'jupiterMailIngest': {"), 3000);
check(str_contains($ingest, 'jt_mail_confirm_applications((string)$box[\'user_id\'], $content)'), 'ingest подтверждает отклики');
check(str_contains($ingest, 'catch (Throwable $e)'), 'сбой подтверждения не теряет письмо');

// Отклик не ушёл — пуш сразу, но не чаще раза в сутки (часть 2, шаг 3).
jt_failed_notify('u1', 'МТС');
check($PUSHES === [['u1', 'Отклик в МТС не ушёл', 'jupiter_failed']], 'пуш о неудаче с названием компании');
$RECENT = [['id' => 'n1']];
jt_failed_notify('u1', 'Ozon');
check(count($PUSHES) === 1, 'второй пуш за сутки не уходит');
$finish = substr($db, (int)strpos($db, "if (\$state === 'submitted') jt_questions_sent_notify("), 300);
check(str_contains($finish, "if (\$state === 'failed') jt_failed_notify(\$owner,"), 'итог воркера failed зовёт пуш');

echo "jupiter mail confirm: OK\n";
