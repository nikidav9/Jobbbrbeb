<?php
// Одно правило на всех: куда сборщику можно ходить.
//
// Отдельный файл ровно затем же, зачем отдельный vacancy_url.php: правилом
// пользуются два входа — ingest.php и career.php, — и своя копия у каждого
// рано или поздно разойдётся. Расходятся такие копии всегда в одну сторону,
// в сторону «чуть мягче».

/**
 * Проверенный HTTPS-хост и все его публичные DNS-адреса.
 *
 * Возвращаем адреса отдельно: CDN может объявить несколько edge-IP, и один из
 * них временно отвечать HTTP 404/5xx, хотя соседний уже обслуживает свежий
 * маршрут. career.php умеет безопасно повторить запрос на другом ИМЕННО ИЗ
 * ЭТОГО проверенного списка. Никаких произвольных адресов сюда не подмешать.
 */
function ing_safe_https_target(string $url): ?array
{
    if (!filter_var($url, FILTER_VALIDATE_URL)) return null;
    $p = parse_url($url);
    if (($p['scheme'] ?? '') !== 'https' || empty($p['host'])) return null;
    $host = strtolower((string)$p['host']);
    if ($host === 'localhost' || str_ends_with($host, '.local')) return null;

    $ips = [];
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips[] = $host;
    } else {
        $records = @dns_get_record($host, DNS_A | DNS_AAAA);
        foreach (is_array($records) ? $records : [] as $record) {
            if (!empty($record['ip'])) $ips[] = $record['ip'];
            if (!empty($record['ipv6'])) $ips[] = $record['ipv6'];
        }
    }
    if (!$ips) return null;
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return null;
        }
    }

    $addresses = array_map(
        fn($ip) => str_contains((string)$ip, ':') ? '[' . $ip . ']' : (string)$ip,
        array_values(array_unique($ips))
    );
    $port = isset($p['port']) ? (int)$p['port'] : 443;
    return ['host' => $host, 'port' => $port, 'addresses' => $addresses];
}

/**
 * Разрешаем только публичные HTTPS-адреса. URL источника задаётся из панели,
 * но панель — не повод давать сборщику доступ к localhost, служебным IP и
 * метаданным облака.
 */
function ing_safe_https_resolve(string $url): ?array
{
    $target = ing_safe_https_target($url);
    if ($target === null) return null;

    // Передаём curl тот же адрес, который проверили. Иначе домен может между
    // двумя DNS-запросами сменить публичный IP на внутренний (DNS rebinding).
    return [$target['host'] . ':' . $target['port'] . ':' . implode(',', $target['addresses'])];
}

/**
 * Те же проверенные адреса, но по одному CURLOPT_RESOLVE на попытку.
 * Нужны career.php для HTTP-failover между CDN edge без нового DNS-запроса.
 */
function ing_safe_https_resolve_candidates(string $url): ?array
{
    $target = ing_safe_https_target($url);
    if ($target === null) return null;

    return array_map(
        fn($address) => [$target['host'] . ':' . $target['port'] . ':' . $address],
        $target['addresses']
    );
}

function ing_safe_https_url(string $url): bool
{
    return ing_safe_https_resolve($url) !== null;
}

/**
 * Сайты, которым сборщик разрешает сертификат Минцифры (решение владельца
 * 26.09.2026). Только чтение открытых страниц вакансий этих трёх банков:
 * ни вход пользователей, ни база, ни Юпитер (он шлёт персональные данные)
 * этому центру не доверяют. Список суффиксов — точное совпадение домена
 * или его поддомен, «evil-tbank.ru» не проходит.
 */
const JT_RU_CA_HOSTS = ['tbank.ru', 'alfabank.ru', 'tochka.com'];

/** Нужен ли для этого адреса сертификат Минцифры. */
function jt_needs_ru_ca(string $url): bool
{
    $host = strtolower((string)(parse_url($url, PHP_URL_HOST) ?: ''));
    if ($host === '') return false;
    foreach (JT_RU_CA_HOSTS as $suffix) {
        if ($host === $suffix || str_ends_with($host, '.' . $suffix)) return true;
    }
    return false;
}

/**
 * Для сайтов из JT_RU_CA_HOSTS доверяем ТОЛЬКО сертификату Минцифры (он
 * заменяет системный список, а не дополняет), для остальных ничего не
 * меняем. Проверка сертификата и имени хоста остаётся включённой.
 */
function jt_apply_ru_ca($ch, string $url): void
{
    if (!jt_needs_ru_ca($url)) return;
    $pem = require __DIR__ . '/ru_trusted_ca.php';
    curl_setopt($ch, CURLOPT_CAINFO_BLOB, $pem);
}
