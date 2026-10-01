<?php
// Ночная чистка (решение владельца 01.10.2026): уведомления — 90 дней,
// свайпы «влево» — 30, отклики («вправо») — никогда.
$fails = [];
function check(string $name, bool $ok): void { global $fails; if (!$ok) $fails[] = $name; }
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

preg_match("~const JT_KEEP_NOTIFICATIONS_DAYS = \\d+;\\nconst JT_KEEP_LEFT_SWIPES_DAYS = \\d+;~", $db, $c);
preg_match('~function jt_cleanup_old\(\): array \{.*?\n\}\n~s', $db, $f);
check('функция чистки есть', !empty($c) && !empty($f));

$calls = [];
$failTable = null;
function sb(string $m, string $t, array $q = []) {
    global $calls, $failTable;
    if ($t === $failTable) throw new RuntimeException('нет связи');
    $calls[] = [$m, $t, $q];
    return [];
}
eval($c[0] . "\n" . $f[0]);

$res = jt_cleanup_old();
$by = [];
foreach ($calls as [$m, $t, $q]) $by[$t] = [$m, $q];
$age = fn(string $t) => isset($by[$t]) ? (int)round((time() - strtotime(substr($by[$t][1]['created_at'], 3))) / 86400) : -1;

check('уведомления — старше 90 дней', ($by['jm_notifications'][0] ?? '') === 'DELETE' && $age('jm_notifications') === 90);
check('уведомления удаляются все, не по виду', count($by['jm_notifications'][1] ?? []) === 1);
foreach (['jm_ext_swipes', 'jm_perm_swipes'] as $t) {
    check("$t: только «влево»", ($by[$t][1]['dir'] ?? '') === 'eq.-1');
    check("$t: старше 30 дней", $age($t) === 30);
}
check('отклики и лайки не трогаются',
    !isset($by['jm_perm_applications']) && !isset($by['jm_likes']) && !isset($by['jm_jupiter_applications']));
check('ничего, кроме трёх таблиц', count($calls) === 3);

$calls = []; $failTable = 'jm_notifications';
$res = jt_cleanup_old();
check('сбой одной таблицы не мешает остальным',
    $res['notifications'] === 'failed' && $res['ext_left_swipes'] === 'ok' && count($calls) === 2);

preg_match("~case 'cronDailyNudges': \\{.*?\\n        \\}\\n~s", $db, $n);
check('чистка идёт в ежедневной задаче', str_contains($n[0] ?? '', "\$result['cleanup'] = jt_cleanup_old();"));

if ($fails) { echo "cleanup: ПРОВАЛЫ\n"; foreach ($fails as $x) echo "  - $x\n"; exit(1); }
echo "cleanup: OK\n";
