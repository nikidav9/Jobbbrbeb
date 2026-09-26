<?php
// «Старший смены» на карточках VK и Lesta (26.09.2026): приёмник угадывал вид
// работ по «старш» в названии, и «Старший разработчик» становился старшим
// смены. У постоянных вакансий вид работ по названию больше не угадывается,
// а карточка карьерной вакансии чип вида работ не показывает вовсе.

define('INGEST_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/ingest.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$base = ['id' => '1', 'url' => 'https://team.vk.company/vacancy/1/', 'company' => 'VK'];
$perm = ing_normalize($base + ['title' => 'Старший разработчик C++', 'kind' => 'permanent'], 'vk');
check('постоянная «Старший разработчик» — без вида работ', $perm !== null && $perm['work_type'] === null);
check('и остаётся в разделе it', $perm !== null && $perm['section'] === 'it');
$perm2 = ing_normalize($base + ['title' => 'Повар-разработчик меню', 'kind' => 'permanent'], 'vk');
check('постоянная «Повар…» — тоже без угадывания', $perm2 !== null && $perm2['work_type'] === null);
$explicit = ing_normalize($base + ['title' => 'Старший смены', 'kind' => 'permanent', 'work_type' => 'shift_supervisor'], 'x');
check('явный код из источника принимается', $explicit !== null && $explicit['work_type'] === 'shift_supervisor');
$shift = ing_normalize($base + ['title' => 'Старший смены склада'], 'x');
check('у смен угадывание по названию прежнее', $shift !== null && $shift['work_type'] === 'shift_supervisor');

$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
$start = strpos($feed, 'const renderExtDeckCard');
$ext = $start === false ? '' : substr($feed, $start, 6000);
check('карточка карьерной вакансии найдена', $ext !== '');
check('без чипа вида работ', !str_contains($ext, 'WORK_TYPE_META') && !str_contains($ext, 'ev.workType'));

if ($failures) {
    echo "career work type: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "career work type: OK\n";
