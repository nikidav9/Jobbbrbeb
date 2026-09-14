<?php
// Одно правило на всех: куда сборщику можно ходить.
//
// Отдельный файл ровно затем же, зачем отдельный vacancy_url.php: правилом
// пользуются два входа — ingest.php и career.php, — и своя копия у каждого
// рано или поздно разойдётся. Расходятся такие копии всегда в одну сторону,
// в сторону «чуть мягче».

/**
 * Разрешаем только публичные HTTPS-адреса. URL источника задаётся из панели,
 * но панель — не повод давать сборщику доступ к localhost, служебным IP и
 * метаданным облака.
 */
function ing_safe_https_resolve(string $url): ?array
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

    // Передаём curl тот же адрес, который проверили. Иначе домен может между
    // двумя DNS-запросами сменить публичный IP на внутренний (DNS rebinding).
    $addresses = array_map(
        fn($ip) => str_contains((string)$ip, ':') ? '[' . $ip . ']' : (string)$ip,
        array_values(array_unique($ips))
    );
    $port = isset($p['port']) ? (int)$p['port'] : 443;
    return [$host . ':' . $port . ':' . implode(',', $addresses)];
}

function ing_safe_https_url(string $url): bool
{
    return ing_safe_https_resolve($url) !== null;
}
