<?php
// Переключатели «Показывать возраст» / «Показывать номер» (решение владельца
// 28.09.2026) и файлы сертификатов — серверная часть контракта.
//
// По умолчанию оба флага включены: их отсутствие в personal_data значит
// «показывать», иначе 500 существующих людей потеряли бы данные из карточки
// в тот же день, что и не просили.

$root = __DIR__ . '/..';
$db = (string)file_get_contents("$root/php-proxy/db.php");

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

check('db.php прочитан', $db !== '');

// ── Новые функции сертификатов не публичные и не отданы дашборду ──────────────
$selfStart = strpos($db, '$selfArgFns = [');
$selfEnd = $selfStart !== false ? strpos($db, '];', $selfStart) : false;
$selfBlock = ($selfStart !== false && $selfEnd !== false) ? substr($db, $selfStart, $selfEnd - $selfStart) : '';

$publicStart = strpos($db, '$publicFns = [');
$publicEnd = $publicStart !== false ? strpos($db, '];', $publicStart) : false;
$publicBlock = ($publicStart !== false && $publicEnd !== false) ? substr($db, $publicStart, $publicEnd - $publicStart) : '';

$adminStart = strpos($db, '$adminFns = [');
$adminEnd = $adminStart !== false ? strpos($db, '];', $adminStart) : false;
$adminBlock = ($adminStart !== false && $adminEnd !== false) ? substr($db, $adminStart, $adminEnd - $adminStart) : '';

check('список публичных функций найден', $publicBlock !== '');
check('список admin-функций найден', $adminBlock !== '');

foreach (['dbSaveCertificateFile', 'dbSignCertificateFile', 'dbDeleteCertificateFile'] as $fn) {
    check("$fn — не публичная", !str_contains($publicBlock, "'$fn'"));
    check("$fn — не admin-функция", !str_contains($adminBlock, "'$fn'"));
    // Uid берётся из сессии ($authUid), а не из аргумента — этим функциям
    // не нужна запись в $selfArgFns (тот механизм сверяет АРГУМЕНТ с
    // сессией, а тут аргумента-владельца просто нет).
    check("$fn — не в \$selfArgFns (uid не аргумент)", !str_contains($selfBlock, "'$fn' =>"));
    check("$fn — обработчик существует", case_body($db, $fn) !== '');
}

// ── Путь сертификата проверяется строго ────────────────────────────────────────
$pathCheck = fn_body($db, 'jt_certificate_path_owned');
check('проверка пути сертификата есть', $pathCheck !== '');
check('регэксп требует папку certificate/<uid>/ и разрешённое расширение',
    str_contains($pathCheck, "^certificate/'") && str_contains($pathCheck, '(pdf|jpg|png)$#'));
check('пустой uid отвергается сразу', str_contains($pathCheck, "if (\$uid === '') return false;"));
// preg_quote экранирует спецсимволы regex в uid — без него чужой uid с
// точками/слэшами мог бы расширить совпадение за пределы своей папки.
check('uid экранируется перед подстановкой в regex', str_contains($pathCheck, 'preg_quote($uid'));

// Путь строит сервер из $authUid, а не берётся из аргумента клиента.
$saveBody = case_body($db, 'dbSaveCertificateFile');
check('dbSaveCertificateFile строит путь из $authUid, не из аргумента',
    str_contains($saveBody, "'certificate/' . (string)\$authUid . '/'"));
check('dbSaveCertificateFile проверяет тип по сигнатуре байтов, не по имени',
    str_contains($saveBody, "substr(\$bytes, 0, 4) === '%PDF'")
    && str_contains($saveBody, '\xFF\xD8\xFF')
    && str_contains($saveBody, '\x89PNG'));
check('dbSaveCertificateFile ограничивает размер 10 МБ',
    str_contains($saveBody, '10 * 1024 * 1024'));

$signBody = case_body($db, 'dbSignCertificateFile');
check('dbSignCertificateFile проверяет владение путём',
    str_contains($signBody, 'jt_certificate_path_owned($path, (string)$authUid)'));

$deleteBody = case_body($db, 'dbDeleteCertificateFile');
check('dbDeleteCertificateFile проверяет владение путём',
    str_contains($deleteBody, 'jt_certificate_path_owned($path, (string)$authUid)'));

// Хранилище переиспользуется, а не дублируется своим curl-запросом.
check('загрузка идёт через общую функцию хранилища резюме',
    str_contains($saveBody, 'jt_resume_storage_upload($path, $bytes'));
check('upload резюме по умолчанию всё ещё шлёт application/pdf (совместимость)',
    str_contains($db, "function jt_resume_storage_upload(string \$path, string \$bytes, string \$contentType = 'application/pdf')"));

// ── Возраст: помощник и его применение ──────────────────────────────────────
$ageHelper = fn_body($db, 'jt_mask_hidden_age');
check('помощник маскировки возраста есть', $ageHelper !== '');
check('помощник спрашивает только флаг, не весь personal_data',
    str_contains($ageHelper, "'personal_data->>showAge' => 'eq.false'") && str_contains($ageHelper, "], 'id');"));
check('помощник не трогает свой собственный возраст',
    str_contains($ageHelper, '$id === $viewerUid'));
check('при ошибке запроса флагов возраст прячется у всех чужих, а не раскрывается',
    str_contains($ageHelper, 'catch (Throwable') && str_contains($ageHelper, '$hideAll = true'));

$byId = case_body($db, 'dbGetUserById');
check('dbGetUserById маскирует возраст', str_contains($byId, 'jt_mask_hidden_age('));

$getUsers = case_body($db, 'dbGetUsers');
check('dbGetUsers маскирует возраст', str_contains($getUsers, 'jt_mask_hidden_age('));

// ── Telegram-уведомление о новой заявке учитывает showAge/showPhone ───────────
$card = fn_body($db, 'tg_new_application_card');
check('карточка кандидата найдена', $card !== '');
check('карточка читает personal_data для флагов',
    str_contains($card, "'first_name,last_name,age,metro_station,phone,avg_rating,rating_count,personal_data'"));
check('отсутствие флага значит "показывать" (showAge)',
    str_contains($card, "(\$personal['showAge'] ?? true) !== false"));
check('отсутствие флага значит "показывать" (showPhone)',
    str_contains($card, "(\$personal['showPhone'] ?? true) !== false"));
check('возраст в карточке зависит от showAge',
    str_contains($card, '$showAge && !empty($w[\'age\'])'));
check('телефон в карточке зависит от showPhone',
    str_contains($card, "if (\$showPhone && !empty(\$w['phone']))"));

if ($failures) {
    echo "profile privacy: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "profile privacy: OK\n";
