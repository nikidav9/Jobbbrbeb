<?php
// Сертификат Минцифры — только для трёх банков и только в сборщике.
// Решение владельца 26.09.2026: расширить доверие молча (на соседний домен,
// на Юпитер) значило бы принять подделку там, где уходят персональные данные.

require_once __DIR__ . '/../php-proxy/safe_url.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

check('Т-Банк', jt_needs_ru_ca('https://www.tbank.ru/career/vacancies/it/'));
check('Альфа-Банк', jt_needs_ru_ca('https://job.alfabank.ru/api/vacancies?city=0100'));
check('Точка', jt_needs_ru_ca('https://hr.tochka.com/api/v2/hr/vacancies/'));
check('сам домен без поддомена', jt_needs_ru_ca('https://tbank.ru/'));
check('похожий домен не проходит', !jt_needs_ru_ca('https://evil-tbank.ru/'));
check('домен-приставка не проходит', !jt_needs_ru_ca('https://tbank.ru.evil.com/'));
check('остальные сайты — системный список', !jt_needs_ru_ca('https://yandex.ru/jobs/api/publications'));
check('пустой адрес', !jt_needs_ru_ca(''));

$pem = require __DIR__ . '/../php-proxy/ru_trusted_ca.php';
check('в файле ровно корневой и промежуточный', substr_count($pem, 'BEGIN CERTIFICATE') === 2);
$certs = [];
preg_match_all('~-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----~s', $pem, $m);
foreach ($m[0] as $c) $certs[] = openssl_x509_parse($c);
$names = array_map(fn($c) => $c['subject']['CN'] ?? '', $certs);
check('это Russian Trusted Root CA и Sub CA', $names === ['Russian Trusted Root CA', 'Russian Trusted Sub CA']);
$fp = array_map(fn($c) => strtoupper(openssl_x509_fingerprint($c, 'sha256')), $m[0]);
check('отпечаток корневого совпадает с записанным', $fp[0] === 'D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31');

// Юпитер и остальной сервер этим сертификатом не пользуются: подключают его
// ровно два места — сборщик (career_unit.php) и дозагрузка описаний (ingest.php).
$uses = [];
foreach (glob(__DIR__ . '/../php-proxy/*.php') as $f) {
    if (str_contains((string)file_get_contents($f), 'jt_apply_ru_ca(')) $uses[] = basename($f);
}
sort($uses);
check('сертификат подключён только в сборщике', $uses === ['career_unit.php', 'ingest.php', 'safe_url.php']);

if ($failures) {
    echo "ru ca scope: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "ru ca scope: OK\n";
