<?php
// Версия приложения в запросе (X-App-Version, с 1.0.0, 03.10.2026): клиент её
// шлёт, сервер отказывает только явно устаревшей сборке. Нет заголовка или в
// нём мусор — не трогаем (бот, дашборд, сборка 1.4.0).

require __DIR__ . '/../php-proxy/app_version.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

check('мин. версия — 1.0.0', JT_MIN_APP_VERSION === '1.0.0');
check('1.0.0 принимается', !jt_app_version_too_old('1.0.0'));
check('1.2.3 принимается', !jt_app_version_too_old('1.2.3'));
check('0.9.9 — слишком старая', jt_app_version_too_old('0.9.9'));
check('1.0.0 при минимуме 1.1.0 — слишком старая', jt_app_version_too_old('1.0.0', '1.1.0'));
check('10.0.0 новее 9.0.0 (не строкой)', !jt_app_version_too_old('10.0.0', '9.0.0'));
check('нет заголовка — не трогаем', !jt_app_version_too_old(null) && !jt_app_version_too_old(''));
check('мусор — не трогаем', !jt_app_version_too_old('abc') && !jt_app_version_too_old('1.0') && !jt_app_version_too_old("1.0.0'; drop"));

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
check('db.php: проверка стоит после проверки секрета',
    strpos($db, "'Forbidden'], 403") < strpos($db, 'jt_app_version_too_old($_SERVER[\'HTTP_X_APP_VERSION\']'));
check('db.php: ответ 426 и текст по-русски', str_contains($db, "'Эта версия приложения устарела — установите свежую версию JobToo'], 426"));
check('db.php: заголовок разрешён для CORS', str_contains($db, 'X-App-Version'));

$client = (string)file_get_contents(__DIR__ . '/../services/db.ts');
check('клиент шлёт версию в каждом запросе и в прогреве',
    substr_count($client, "'X-App-Version': APP_VERSION") === 2 && str_contains($client, 'Constants.expoConfig?.version'));

if ($failures) {
    echo "app version: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "app version: OK\n";
