<?php
// Читаемые адреса «Почты JobToo»: как собирается адрес и что при повторе.

require __DIR__ . '/../php-proxy/jupiter_mail_address.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

check('имя.фамилия латиницей', jt_mail_base('Иван', 'Петров') === 'ivan.petrov');
check('Ж, Х, Щ, Ю, Я', jt_mail_base('Юлия', 'Щукина') === 'yuliya.shchukina'
    && jt_mail_base('Жанна', 'Хачатурян') === 'zhanna.khachaturyan');
check('ь и ъ пропадают, ё — e', jt_mail_base('Фёдор', 'Подъячев') === 'fedor.podyachev');
check('латиница как есть, в нижнем регистре', jt_mail_base('John', 'Smith') === 'john.smith');
check('двойное имя через дефис', jt_mail_base('Анна-Мария', 'Иванова') === 'anna-mariya.ivanova'
    && jt_mail_base('Анна Мария', 'Иванова') === 'anna-mariya.ivanova');
check('только имя', jt_mail_base('Иван', '') === 'ivan');
check('мусор отбрасывается', jt_mail_base('  Иван!!  ', '<b>') === 'ivan.b');
check('пусто', jt_mail_base('', '  ') === '');

$seq = 0;
$fixed = function () use (&$seq) { $seq++; return (string)(1000 + $seq); };
$c = jt_mail_candidates('ivan.petrov', $fixed);
check('сначала сама основа', $c[0] === 'ivan.petrov');
check('при повторе цифра', $c[1] === 'ivan.petrov2' && $c[2] === 'ivan.petrov3');
check('дальше — случайные цифры', end($c) === 'ivan.petrov.1005');
check('все кандидаты разные', count(array_unique($c)) === count($c));

$seq = 0;
check('пустая основа — user+цифры', jt_mail_candidates('', $fixed)[0] === 'user1001');
$seq = 0;
check('служебное имя не выдаётся', jt_mail_candidates('support', $fixed)[0] === 'user1001'
    && jt_mail_candidates('admin', $fixed)[0] !== 'admin');
check('старый формат u- не выдаётся', jt_mail_candidates('u-abc', $fixed)[0] !== 'u-abc');

foreach (jt_mail_candidates(jt_mail_base('Константин-Александр', 'Преображенский-Воскресенский')) as $local) {
    if (!preg_match('~\A[a-z0-9][a-z0-9.\-]{0,63}\z~', $local)) { check("годен как адрес: $local", false); break; }
}

// Служебные имена в PHP и в приёмке писем (jupiter/mail_sync.py) — одни и те же.
$py = (string)file_get_contents(__DIR__ . '/../jupiter/mail_sync.py');
foreach (JT_MAIL_RESERVED as $name) {
    check("mail_sync знает служебное имя $name", str_contains($py, '"' . $name . '"'));
}

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo "jupiter mail address: ok\n";
