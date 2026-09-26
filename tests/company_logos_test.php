<?php
// Логотипы компаний (constants/companyLogos.ts): каждый файл на месте и
// 128×128 PNG, а у каждой компании ленты, чей сайт отдал годную иконку, знак
// есть — без него карточка рисует букву, как VK на скриншоте 26.09.2026.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$root = __DIR__ . '/..';
$src = (string)file_get_contents("$root/constants/companyLogos.ts");
preg_match_all('~^  "([^"]+)": require\(\'@/assets/logos/([a-z0-9-]+)\.png\'\),$~mu', $src, $m, PREG_SET_ORDER);
check('логотипов не меньше 90', count($m) >= 90);
$keys = [];
foreach ($m as [, $key, $file]) {
    $keys[$key] = true;
    check("ключ в нижнем регистре: $key", $key === mb_strtolower(trim($key)));
    $info = @getimagesize("$root/assets/logos/$file.png");
    check("файл $file.png — PNG 128×128", $info !== false && $info[0] === 128 && $info[1] === 128 && $info[2] === IMAGETYPE_PNG);
}
foreach (glob("$root/assets/logos/*.png") as $f) {
    check('файл без записи: ' . basename($f), str_contains($src, "@/assets/logos/" . basename($f) . "'"));
}

// Компании, которые сейчас в ленте IT (feed_stats.php, 26.09.2026).
foreach (['Яндекс', 'Сбер', 'МТС', 'Альфа-Банк', 'Т-Банк', '2ГИС', 'UserGate', 'IBS', 'Yadro', 'Navio',
          'Контур', 'Авито', 'Bell Integrator', 'Селектел', 'Авиасейлс', 'Lesta Games', 'Wildberries / РВБ',
          'Точка Банк', 'X5 Tech', 'Kaspersky', 'Globus IT', 'VK', 'Performance Lab', 'Lamoda', 'Магнит'] as $c) {
    check("логотип у «{$c}»", isset($keys[mb_strtolower($c)]));
}

if ($failures) {
    echo "company logos: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "company logos: OK (" . count($m) . ")\n";
