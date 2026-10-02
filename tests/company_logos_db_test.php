<?php
ini_set('error_log', '/dev/null');
// Логотипы компаний в базе (миграция 144, решение владельца 02.10.2026):
// только PNG 256×256, источник — сайт или Викисклад, имя файла зависит от
// содержимого, запись — только по админ-ключу, чтение — открытое.
require __DIR__ . '/../php-proxy/company_logos.php';

$fails = 0;
function check(string $name, bool $ok): void
{
    global $fails;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
    if (!$ok) $fails++;
}

// Заголовок PNG с IHDR — без расширения GD (в CI его может не быть).
function png(int $w, int $h): string
{
    $ihdr = 'IHDR' . pack('NNCCCCC', $w, $h, 8, 6, 0, 0, 0);
    return "\x89PNG\r\n\x1a\n" . pack('N', 13) . $ihdr . pack('N', crc32($ihdr));
}

check('ключ — нижний регистр и один пробел', jt_company_logo_key("  Альфа-Банк \t ") === 'альфа-банк');
check('PNG 256×256 годится', jt_company_logo_check(png(256, 256)) === null);
check('не 256×256 — отказ', jt_company_logo_check(png(128, 128)) !== null);
check('не PNG — отказ (никакой разметки в бакете на нашем домене)',
    jt_company_logo_check('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') !== null);
check('слишком большой — отказ', jt_company_logo_check(str_repeat('x', JT_LOGO_MAX_BYTES + 1)) !== null);
$a = jt_company_logo_path('сбер', 'a'); $b = jt_company_logo_path('сбер', 'b');
check('новое содержимое — новое имя файла', $a !== $b && preg_match('/^[0-9a-f]{12}-[0-9a-f]{10}\.png$/', $a) === 1);
check('источник только site или wikimedia', jt_company_logo_validate('Сбер', 'google', 'https://x.ru') !== null
    && jt_company_logo_validate('Сбер', 'site', 'https://sber.ru/favicon.svg') === null);
check('ссылка на источник — только https', jt_company_logo_validate('Сбер', 'site', 'javascript:alert(1)') !== null);
$map = jt_company_logos_map([['company_key' => 'сбер', 'storage_path' => $a], ['company_key' => '', 'storage_path' => 'x.png']],
    'https://jobtoo.ru');
check('карта: ссылка в публичный бакет, пустые ключи отброшены',
    $map === ['сбер' => 'https://jobtoo.ru/storage/v1/object/public/company-logos/' . $a]);

// Права в db.php: читать — всем, писать — только админу.
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$block = fn(string $name) => preg_match('/\$' . $name . '\s*=\s*\[(.*?)\];/s', $db, $m) ? $m[1] : '';
check('dbCompanyLogos — в открытых', str_contains($block('publicFns'), "'dbCompanyLogos'"));
check('adminCompanyLogoPut — в админских', str_contains($block('adminFns'), "'adminCompanyLogoPut'"));
check('adminCompanyLogoPut проверяет картинку до записи',
    (bool)preg_match("/case 'adminCompanyLogoPut'.*?jt_company_logo_check.*?storage\\/v1\\/object/s", $db));
$mig = (string)file_get_contents(__DIR__ . '/../supabase/migrations/144_company_logos.sql');
check('таблица под RLS, бакет публичный', str_contains($mig, 'alter table public.jm_company_logos enable row level security')
    && str_contains($mig, "('company-logos', 'company-logos', true)"));
check('сторож RLS знает таблицу', str_contains((string)file_get_contents(__DIR__ . '/../infra/verify-rls.sh'), "'jm_company_logos'"));

// Загрузчик считает имя файла так же, как сервер.
$py = trim((string)shell_exec('cd ' . escapeshellarg(__DIR__ . '/../scripts') . ' && python3 -c ' . escapeshellarg(
    'import importlib.util as u;s=u.spec_from_file_location("m","upload-company-logos.py");m=u.module_from_spec(s);s.loader.exec_module(m);print(m.path_of(m.key_of(" Сбер "), b"a"))')));
check('scripts/upload-company-logos.py: то же имя файла, что у сервера', $py === $a);

echo $fails ? "\n$fails FAILED\n" : "\nall ok\n";
exit($fails ? 1 : 0);
