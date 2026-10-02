<?php
ini_set('error_log', '/dev/null');
// Молнии на сервере (решение владельца 02.10.2026): отклик сверх 20 за
// московские сутки сервер не принимает — ни с другого устройства, ни с сайта,
// ни со страницы своей вакансии. Повтор существующего отклика бесплатен.
require __DIR__ . '/../php-proxy/energy.php';

$fails = 0;
function check(string $name, bool $ok): void
{
    global $fails;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
    if (!$ok) $fails++;
}

$utc = new DateTimeZone('UTC');
check('сутки — по Москве: 22:30 UTC уже следующий день',
    jt_energy_since(new DateTimeImmutable('2026-10-02 22:30', $utc)) === '2026-10-02T21:00:00Z');
check('сутки — по Москве: 20:30 UTC ещё сегодня',
    jt_energy_since(new DateTimeImmutable('2026-10-02 20:30', $utc)) === '2026-10-01T21:00:00Z');
check('запас 15 в сутки, как в приложении', JT_DAILY_APPLIES === 15
    && str_contains((string)file_get_contents(__DIR__ . '/../services/energy.ts'), 'DAILY_ENERGY = 15'));
check('остаток не уходит ниже нуля', jt_energy_left(0) === 15 && jt_energy_left(14) === 1 && jt_energy_left(25) === 0);

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$case = function (string $fn) use ($db): string {
    $i = strpos($db, "case '$fn': {");
    if ($i === false) return '';
    $j = strpos($db, "\n        case '", $i + 10);
    return substr($db, $i, ($j === false ? strlen($db) : $j) - $i);
};
check('модуль подключён', str_contains($db, "require_once __DIR__ . '/energy.php';"));
check('остаток видит только владелец', (bool)preg_match("/'dbEnergyLeft' => 0/", $db));

$enq = $case('jupiterEnqueue');
$req = strpos($enq, 'jt_energy_require($uidArg)');
check('заявка Юпитеру проверяет запас', $req !== false);
check('проверка — после повтора (он бесплатный) и до записи',
    $req !== false && strpos($enq, 'if ($existing)') < $req && $req < strpos($enq, "'POST', 'jm_jupiter_applications'"));

$perm = $case('dbApplyPermVacancy');
$req = strpos($perm, 'jt_energy_require(');
check('отклик на свою вакансию проверяет запас', $req !== false);
check('проверка до записи отклика', $req !== false && $req < strpos($perm, "sb_upsert('jm_perm_applications'"));

exit($fails ? 1 : 0);
