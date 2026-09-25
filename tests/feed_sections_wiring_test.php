<?php
// Проводка ленты по разделам и свайпов постоянных вакансий до db.php.
//
// Чистые правила проверены отдельно (tests/ext_feed_test.php,
// tests/job_sections_test.php). Здесь другое — что db.php их действительно
// зовёт с нужными доводами и никому не отдаёт чужие свайпы или чужой профиль.

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

// ── Свайпы своих вакансий JobToo — только свои ───────────────────────────────
$selfBlock = '';
if (preg_match('~\$selfArgFns = \[(.*?)\n\];~s', $db, $m)) $selfBlock = $m[1];
check('список «только свои» найден', $selfBlock !== '');
foreach (['dbPermSwipe', 'dbPermUnswipe', 'dbGetPermSwipes'] as $fn) {
    check("{$fn} стоит в selfArgFns с позицией 0",
        $selfBlock !== '' && str_contains($selfBlock, "'{$fn}' => 0"));
}

// ── Раздел ленты: белый список, а не сырые доводы клиента ───────────────────
$feed = case_body($db, 'dbGetExtFeed');
check('dbGetExtFeed найдена', $feed !== '');
check('разделы фильтруются белым списком JOB_SECTIONS',
    str_contains($feed, 'JOB_SECTIONS['));
check('разделы уходят в jm_ext_feed_pool доводом p_sections',
    str_contains($feed, "'p_sections' => \$sections"));

// ── Профиль для подбора — только из сессии ───────────────────────────────────
check('профиль читается по $authUid, а не по доводу запроса',
    str_contains($feed, "sb_single('jm_users', ['id' => 'eq.' . \$authUid], 'work_types,metro_station,resume_data')"));
check('вкус учитывает профиль', str_contains($feed, 'ext_feed_taste($history, $profile ?: [])'));

// ── job_sections.php подключён рядом с ext_feed.php ──────────────────────────
check('job_sections.php подключён', str_contains($db, "require_once __DIR__ . '/job_sections.php';"));

// ── Свайпы постоянных вакансий: те же правила, что у карьерных ──────────────
$permSwipe = case_body($db, 'dbPermSwipe');
$permUnswipe = case_body($db, 'dbPermUnswipe');
$permList = case_body($db, 'dbGetPermSwipes');
check('dbPermSwipe пишет в jm_perm_swipes', str_contains($permSwipe, "'jm_perm_swipes'"));
check('dbPermSwipe проверяет направление', str_contains($permSwipe, "in_array(\$dir, [-1, 1], true)"));
check('dbPermUnswipe чистит jm_perm_swipes', str_contains($permUnswipe, "'jm_perm_swipes'"));
check('dbGetPermSwipes читает по своему user_id',
    str_contains($permList, "'user_id' => 'eq.' . (string)\$args[0]"));

// ── Экран: смахнутая своя вакансия не возвращается после обновления ─────────
// onRefresh обнуляет swSkipped. Если при этом не перенести свайпы сессии в
// permSwiped, своя вакансия, смахнутая влево, вернётся в колоду — ровно то,
// ради чего заведена jm_perm_swipes. Переносить именно здесь, а не при свайпе:
// иначе чередование «своя, карьерная, карьерная» съезжает.
$screen = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
$refreshAt = strpos($screen, 'const onRefresh = async');
$refresh = $refreshAt === false ? '' : substr($screen, $refreshAt, 1500);
check('onRefresh переносит свайпы сессии в permSwiped',
    str_contains($refresh, 'permLeftSwipes.current') && str_contains($refresh, 'setPermSwiped('));
check('разделы не грузятся до чтения с телефона',
    str_contains($screen, 'sectionsLoadedFor !== currentUser.id'));

if ($failures) {
    echo "feed sections wiring: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "feed sections wiring: OK\n";
