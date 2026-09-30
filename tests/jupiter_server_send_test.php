<?php
// Пилот «сервер отправляет сам» (решение владельца 01.10.2026). Статическая
// проверка, как соседние jupiter_*_test.php: включается только списком кодов,
// только при автоотправке и поручении на браузер, не трогает взятое воркером.
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

function check(bool $ok, string $what): void {
    if (!$ok) { fwrite(STDERR, "FAIL: $what\n"); exit(1); }
}

$fnAt = strpos($db, 'function jt_jupiter_server_sends(');
$fn = substr($db, (int)$fnAt, 700);
check($fnAt !== false, 'есть jt_jupiter_server_sends');
check(str_contains($fn, '!JT_SERVER_SEND_PILOT) return false'), 'пустой пилот — никому');
check(str_contains($fn, "!empty(\$user['jupiter_live_enabled_at'])"), 'только с автоотправкой');
check(str_contains($fn, "empty(\$user['is_blocked'])"), 'не заблокированным');
check(str_contains($fn, 'jt_browser_delegated($uid)'), 'только с поручением от 29.09');
check(str_contains($fn, 'JT_SERVER_SEND_PILOT, true'), 'строгое сравнение кода');

$move = substr($db, (int)strpos($db, 'function jt_jupiter_phone_fill_to_server('), 1200);
check(str_contains($move, "'reason_code' => 'eq.PHONE_FILL'"), 'переводит только отложенные на телефон');
check(str_contains($move, "'lease_owner' => 'is.null'"), 'взятое воркером не трогает');
check(str_contains($move, "'user_id' => 'eq.' . \$uid"), 'только свои');

$a = strpos($db, "case 'jupiterEnqueue': {");
$enq = substr($db, (int)$a, 5000);
check(str_contains($enq, 'if ($serverSends) $row = jt_jupiter_server_patch('), 'новый свайп пилота — в очередь сервера');
$mine = substr($db, (int)strpos($db, "case 'jupiterMyApplications': {"), 200);
check(str_contains($mine, 'jt_jupiter_phone_fill_to_server('), 'застрявшие переводятся при открытии «Откликов»');

$patch = substr($db, (int)strpos($db, 'function jt_jupiter_server_patch('), 500);
check(str_contains($patch, "'submission_authorized_at' => \$now"), 'разрешение на отправку ставится');
check(str_contains($patch, 'if (jt_employer_delegated($uid))'), 'согласия — только по поручению');

$mts = substr($db, (int)strpos($db, "'vacancy_url' => 'like.https://job.mts.ru/*'") - 200, 900);
check(str_contains($mts, "'state' => 'eq.submission_unknown'"), 'возврат МТС — только «исход неизвестен»');
check(str_contains($mts, "'updated_at' => 'lt.2026-09-30T22:45:00Z'"), 'возврат МТС — только до исправления');
check(str_contains($mts, "'lease_owner' => 'is.null'"), 'возврат МТС — не взятые воркером');

echo "jupiter server send: OK\n";
