<?php
// Логотипы компаний в базе (решение владельца 02.10.2026, миграция 144).
//
// Отдаёт приложению карту «компания → ссылка на PNG 256×256» одним
// запросом (dbCompanyLogos, открытая: ленту видят и гости). Пишет только
// сервер по админ-ключу (adminCompanyLogoPut) — его зовёт
// .github/workflows/company-logos.yml из проверенного набора
// data/company-logos. Картинки — в публичном бакете company-logos.

const JT_LOGO_BUCKET = 'company-logos';
const JT_LOGO_SIZE = 256;
const JT_LOGO_MAX_BYTES = 300 * 1024;
const JT_LOGO_SOURCES = ['site', 'wikimedia'];

/** Ключ компании — как сравнивает приложение (constants/companyLogos.ts). */
function jt_company_logo_key(string $company): string
{
    return mb_strtolower(trim(preg_replace('/\s+/u', ' ', $company)));
}

/** null — картинка годится; иначе причина отказа. */
function jt_company_logo_check(string $bytes): ?string
{
    if ($bytes === '' || strlen($bytes) > JT_LOGO_MAX_BYTES) return 'PNG до 300 КБ';
    $info = @getimagesizefromstring($bytes);
    if (!is_array($info) || ($info[2] ?? null) !== IMAGETYPE_PNG) return 'нужен PNG';
    if ($info[0] !== JT_LOGO_SIZE || $info[1] !== JT_LOGO_SIZE) return 'нужен PNG 256×256';
    return null;
}

/** Имя файла в бакете: по ключу и содержимому, без кириллицы в адресе.
 *  Новая картинка — новое имя: кэш телефонов не держит старую, а загрузчик
 *  (scripts/upload-company-logos.py) видит, что заливать. */
function jt_company_logo_path(string $key, string $bytes): string
{
    return substr(sha1($key), 0, 12) . '-' . substr(sha1($bytes), 0, 10) . '.png';
}

/** Публичная ссылка на картинку. */
function jt_company_logo_url(string $base, array $row): string
{
    return rtrim($base, '/') . '/storage/v1/object/public/' . JT_LOGO_BUCKET . '/'
        . rawurlencode((string)$row['storage_path']);
}

/** {ключ компании: ссылка} из строк таблицы. */
function jt_company_logos_map(array $rows, string $base): array
{
    $map = [];
    foreach ($rows as $row) {
        $key = (string)($row['company_key'] ?? '');
        if ($key !== '' && !empty($row['storage_path'])) $map[$key] = jt_company_logo_url($base, $row);
    }
    return $map;
}

/** Проверка данных для adminCompanyLogoPut; null — всё годится. */
function jt_company_logo_validate(string $company, string $source, string $sourceUrl): ?string
{
    if (jt_company_logo_key($company) === '' || mb_strlen($company) > 120) return 'нужно название компании';
    if (!in_array($source, JT_LOGO_SOURCES, true)) return 'источник: site или wikimedia';
    if (!preg_match('#^https://[^\s]+$#', $sourceUrl) || strlen($sourceUrl) > 500) return 'нужна https-ссылка на источник';
    return null;
}
