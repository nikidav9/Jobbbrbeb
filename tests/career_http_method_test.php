<?php
$career = file_get_contents(__DIR__ . '/../php-proxy/career.php');
$failures = [];
function check_http_method(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

check_http_method('GET явно задаётся через CURLOPT_HTTPGET',
    str_contains($career, '$curlOptions[CURLOPT_HTTPGET] = true;'));
check_http_method('POSTFIELDS задаётся только внутри ветки POST',
    preg_match('~if \(!empty\(\$unit\[\x27post\x27\]\)\) \{.*CURLOPT_POSTFIELDS~s', $career) === 1);
check_http_method('старого POSTFIELDS=null для GET больше нет',
    !str_contains($career, 'CURLOPT_POSTFIELDS => empty($unit[\x27post\x27]) ? null'));
check_http_method('POST по-прежнему поддерживается',
    str_contains($career, '$curlOptions[CURLOPT_POST] = true;'));

if ($failures) {
    fwrite(STDERR, "career HTTP method: ПРОВАЛЫ\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}

echo "career HTTP method: OK\n";
