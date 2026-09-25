<?php
// Один "юнит" карьерного источника: адрес + правило разбора, и поход за одной
// порцией по нему. Вынесено из career.php, чтобы этим же кодом — не похожим,
// а буквально тем же — проверяла адреса разведка ДО их включения: career_verify.php
// зовёт ровно cf_unit_from_endpoint и cf_fetch_unit, без копии логики.

require_once __DIR__ . '/career_feed.php';
// Правило адреса берём общее с приёмником, а не пишем своё: см. safe_url.php.
require_once __DIR__ . '/safe_url.php';

/**
 * Один юнит из записи connector_config.endpoints. null — запись негодная
 * (нет url или не массив), она отбрасывается вызывающим кодом.
 */
function cf_unit_from_endpoint(array $e): ?array
{
    if (!is_string($e['url'] ?? null)) return null;
    // `mode` различает JSON API и страницу со ссылками на вакансии. Третий вид
    // появился потому, что замер по 111 карьерным сайтам показал: разметку
    // JobPosting держат двое, JSON отдают немногие, а список обычных ссылок
    // лежит у двух десятков.
    $mode = (string)($e['mode'] ?? 'json');
    // Часть карьерных API отвечает только на POST: METRO на GET даёт 405.
    // Тело запроса задаёт администратор вместе с адресом, произвольного тела
    // из запроса сюда не попадает — как и произвольного адреса.
    $post = strtoupper((string)($e['method'] ?? 'GET')) === 'POST';
    $kind = 'json';
    if ($mode === 'html_links') $kind = 'html_links';
    if ($mode === 'embedded')   $kind = 'embedded';
    return [
        'url'    => $e['url'],
        'kind'   => $kind,
        'map'    => is_array($e['map'] ?? null) ? $e['map'] : [],
        'paging' => is_array($e['paging'] ?? null) ? $e['paging'] : [],
        'post'   => $post,
        'body'   => $post ? json_encode(is_array($e['body'] ?? null) ? $e['body'] : [], JSON_UNESCAPED_UNICODE) : null,
    ];
}

/**
 * Один HTTP-запрос, жёстко закреплённый на уже проверенном публичном DNS-IP.
 * Сеть здесь одна на все режимы (HTML/JSON/embedded), чтобы сторожа SSRF,
 * размера ответа, TLS и таймаутов не расходились между адаптерами.
 */
function cf_fetch_pinned(string $pageUrl, array $unit, array $resolveEntries): array
{
    $body = '';
    $tooLarge = false;
    $ch = curl_init($pageUrl);
    $curlOptions = [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HTTPHEADER => array_merge(
            [$unit['kind'] === 'json'
                ? 'Accept: application/json'
                : 'Accept: text/html,application/xhtml+xml'],
            empty($unit['post']) ? [] : ['Content-Type: application/json']
        ),
        // Пустая строка включает все сжатия, которые умеет curl: карьерные страницы
        // бывают по несколько мегабайт.
        CURLOPT_ENCODING => '',
        CURLOPT_USERAGENT => 'JobToo/1.0 (+https://jobtoo.ru; support@jobtoo.ru)',
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 45,
        // Переход по редиректу увёл бы нас на адрес, который проверку не проходил:
        // так обходят запрет на служебные сети.
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_RESOLVE => $resolveEntries,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$tooLarge): int {
            // Карьерная страница — это текст. Четыре мегабайта её с запасом
            // покрывают, а без предела чужой сервер кормил бы нас, пока не кончится
            // память.
            if (strlen($body) + strlen($chunk) > 4 * 1024 * 1024) {
                $tooLarge = true;
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ];
    // CURLOPT_POSTFIELDS сам переключает libcurl на POST даже после
    // CURLOPT_POST=false. Поэтому для GET его нельзя задавать вообще — даже null.
    if (!empty($unit['post'])) {
        $curlOptions[CURLOPT_POST] = true;
        $curlOptions[CURLOPT_POSTFIELDS] = (string)$unit['body'];
    } else {
        $curlOptions[CURLOPT_HTTPGET] = true;
    }
    curl_setopt_array($ch, $curlOptions);
    $ok = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $servedBy = (string)curl_getinfo($ch, CURLINFO_PRIMARY_IP);
    $error = curl_error($ch);
    curl_close($ch);

    return [
        'body' => $body,
        'too_large' => $tooLarge,
        'ok' => $ok,
        'code' => $code,
        'served_by' => $servedBy,
        'error' => $error,
    ];
}

/**
 * Когда имеет смысл попробовать соседний DNS edge.
 *
 * 401/403 — запрет доступа, 429 — rate limit: искать другой IP в этих случаях
 * было бы обходом политики удалённого сайта. Ретраим только сетевой отказ,
 * 404 на CDN edge (наблюдалось у Сбера) и серверные 5xx.
 */
function cf_retryable_edge_fetch(array $fetch): bool
{
    if (!empty($fetch['too_large'])) return false;
    if (($fetch['ok'] ?? false) === false) return true;
    $code = (int)($fetch['code'] ?? 0);
    return $code === 404 || $code >= 500;
}

/**
 * Поход за одной порцией юнита и её разбор. Тот же код, что использует
 * career.php при обычном сборе, — специально, чтобы разведка проверяла
 * endpoint ровно тем, чем потом идёт сбор, а не похожей копией.
 *
 * Возвращает ['items' => array, 'more' => bool, 'error' => ?string]. Непустой
 * error — единственный сигнал "юнит не годен"; причина в нём — ровно то, что
 * career.php раньше отдавал через cf_skipUnit.
 */
function cf_fetch_unit(array $unit, int $sub): array
{
    $fail = fn(string $reason) => ['items' => [], 'more' => false, 'error' => $reason];

    // Адрес порции строим до похода, но проверяем заново: подставляются только
    // числа в параметры, и всё же идти мы должны ровно по проверенному адресу.
    $pageUrl = $unit['kind'] === 'html' ? $unit['url'] : cf_page_url($unit['url'], $unit['paging'], $sub);
    if (!ing_safe_https_url($pageUrl)) return $fail('адрес порции не проходит проверку');
    // Сохраняем общий предварительный guard: он является контрактом с ingest и
    // старым security regression. Ниже для фактического похода адреса разделяются
    // по одному, но исходный URL обязан пройти то же правило целиком.
    $resolveEntries = ing_safe_https_resolve($pageUrl);
    if ($resolveEntries === null) return $fail('адрес страницы больше не разрешается безопасно');
    $resolveCandidates = ing_safe_https_resolve_candidates($pageUrl);
    if ($resolveCandidates === null) return $fail('адрес страницы больше не разрешается безопасно');

    // Один DNS-ответ может содержать несколько CDN edge. curl умеет принять их
    // списком, но HTTP 404/5xx для него считается успешным соединением и на
    // соседний edge он не переключается. Поэтому пробуем проверенные IP по одному.
    // Четырёх достаточно для failover и это не превращает один заход в шторм.
    $fetch = null;
    $unsafeEdge = false;
    foreach (array_slice($resolveCandidates, 0, 4) as $resolveEntries) {
        $fetch = cf_fetch_pinned($pageUrl, $unit, $resolveEntries);
        $servedBy = (string)($fetch['served_by'] ?? '');
        if ($servedBy !== '' && !filter_var($servedBy, FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            $unsafeEdge = true;
            break;
        }
        if (!cf_retryable_edge_fetch($fetch)) break;
    }
    if ($fetch === null) return $fail('у адреса нет проверенного DNS edge');

    $body = (string)$fetch['body'];
    $tooLarge = !empty($fetch['too_large']);
    $ok = $fetch['ok'];
    $code = (int)$fetch['code'];
    $servedBy = (string)$fetch['served_by'];
    $error = (string)$fetch['error'];

    // CURLOPT_RESOLVE выше не даёт повторно разрешить имя, а эта проверка остаётся
    // вторым рубежом: если curl всё же пришёл не к закреплённому публичному адресу,
    // ответ не разбираем.
    if ($unsafeEdge || ($servedBy !== '' && !filter_var($servedBy, FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE))) {
        return $fail('страница увела на непубличный адрес');
    }

    if ($tooLarge) return $fail('страница больше 4 МБ');
    if ($ok === false || $code < 200 || $code >= 300) {
        return $fail("страница недоступна ($code $error)");
    }

    if ($unit['kind'] === 'embedded') {
        // Данные приехали внутри страницы, отдельного запроса за ними нет.
        $data = cf_embedded_state($body);
        if ($data === null) return $fail('в странице нет встроенного состояния');
        $items = cf_json_items($data, $unit['map'], $pageUrl, time());
        $more = false;
    } elseif ($unit['kind'] === 'html_links') {
        $items = cf_html_links($body, $pageUrl, $unit['map'], time());
        $more = cf_has_next_sub(count($items), $unit['paging'], $sub);
    } elseif ($unit['kind'] === 'json') {
        $data = json_decode($body, true);
        if (!is_array($data)) return $fail('источник ответил не JSON');
        $items = cf_json_items($data, $unit['map'], $pageUrl, time());
        // Считаем сырые записи, а не принятые: см. cf_has_next_sub.
        $rawRows = cf_dig($data, (string)($unit['map']['list'] ?? ''));
        $raw = is_array($rawRows) ? count($rawRows) : count($items);
        $more = cf_has_next_sub($raw, $unit['paging'], $sub);
    } else {
        $items = cf_items($body, $pageUrl, time());
        $more = false;
    }

    // Мусор отсеиваем здесь, а не в career.php: этим же кодом разведка
    // проверяет адрес до включения (career_verify.php), и «три настоящих
    // вакансии» у неё должны значить то же, что в бою. $more считан по сырой
    // выдаче выше — страницы листаются по тому, что прислал сайт.
    $q = cf_quality_filter($items);
    return ['items' => $q['kept'], 'more' => $more, 'error' => null,
        'raw' => count($items), 'rejected' => $q['rejected']];
}
