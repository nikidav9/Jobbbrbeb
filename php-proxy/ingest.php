<?php
// Забор вакансий из чужих источников.
//
// Вторая половина агрегатора. Первая — /api/v1, которым нашу выдачу читают
// снаружи; эта — про то, как чужие предложения попадают к нам.
//
// Ходим сами, а не ждём, когда пришлют. Иначе партнёру пришлось бы завести у
// себя очередь, повторы при сбоях и наблюдение за доставкой — и первая
// интеграция растянулась бы на месяц вместо дня. Забирать самим дешевле для
// обеих сторон, а частоту мы подстраиваем: смены на сегодня протухают за
// часы, постоянные вакансии живут неделями.
//
// Формат фида — docs/feed-format.md. Обязательных полей три: id, title, url.
// Остальное необязательно ровно затем, чтобы партнёр отдал первую версию
// сегодня, а не после согласования всех полей.

@ini_set('display_errors', '0');
@set_time_limit(300);
header('Content-Type: application/json; charset=utf-8');

define('SB_STRICT', true);
require_once __DIR__ . '/sb_lite.php';
require_once __DIR__ . '/safe_url.php';
require_once __DIR__ . '/sitemap_cache.php';

function ing_secret(string $name): string
{
    static $file = null;
    $env = getenv($name);
    if (is_string($env) && trim($env) !== '') return trim($env);
    if ($file === null) {
        $p = __DIR__ . '/app_secrets.php';
        $v = is_readable($p) ? @include $p : null;
        $file = is_array($v) ? $v : [];
    }
    return (string)($file[$name] ?? '');
}

// Сборщик меняет партнёрские данные, поэтому публичный APP_SECRET здесь
// недопустим. Приоритет — отдельный ADMIN_API_TOKEN; на переходном этапе
// подходит пароль закрытого дашборда, который уже хранится только на сервере.
if (!defined('INGEST_LIBRARY_ONLY')) {
    $expectedAdmin = ing_secret('ADMIN_API_TOKEN');
    if ($expectedAdmin === '') {
        $credFile = __DIR__ . '/admin_credentials.php';
        $creds = is_readable($credFile) ? @include $credFile : null;
        $expectedAdmin = is_array($creds) ? (string)($creds['password'] ?? '') : '';
    }
    $givenAdmin = (string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($expectedAdmin === '' || !hash_equals($expectedAdmin, $givenAdmin)) {
        http_response_code(403); echo json_encode(['error' => 'Forbidden']); exit;
    }
}

/** Отпечаток «та же самая работа». */
function ing_dedupe_key(array $v): string
{
    // Нарочно грубо: компания, должность, метро, дата, начало. Точнее — значит
    // считать разными вакансии, отличающиеся лишним пробелом в адресе, и
    // показывать человеку одно и то же дважды.
    $norm = fn($s) => preg_replace('/\s+/u', ' ', mb_strtolower(trim((string)$s)));
    // Станцию берём приведённую: у двух источников одна и та же смена
    // приходит как «м. Тёплый Стан» и «Теплый стан», и по исходным строкам
    // отпечатки не совпали бы — то есть дедуп не сработал бы именно там,
    // ради чего он и заведён.
    return substr(hash('sha256', implode('|', [
        $norm($v['company'] ?? ''), $norm($v['title'] ?? ''),
        $norm($v['metro_station_norm'] ?? $v['metro_station'] ?? ''),
        // У постоянных вакансий дата и время обычно пустые. Без адреса все
        // одинаковые должности сети магазинов/ресторанов схлопывались в одну.
        $norm(($v['kind'] ?? '') === 'permanent' ? ($v['address'] ?? '') : ''),
        (string)($v['date'] ?? ''),
        (string)($v['time_start'] ?? ''),
    ])), 0, 32);
}

/**
 * Станция метро из нашего справочника — по тому, что прислал источник.
 *
 * В фидах она бывает какой угодно: «м. Тёплый Стан», «Теплый стан»,
 * «Тёплый Стан (Калужско-Рижская)», «Тёплый Стан, 7 минут пешком». А фильтр
 * в приложении сравнивает станцию точным равенством с нашим написанием, и
 * любое из этих написаний не совпадает ни с чем. Причём молча: человек
 * выбирает станцию и видит пустой список.
 *
 * Возвращает [станция, ветка] или [null, null], если не узнали. Не узнали —
 * значит не узнали: подставить похожую станцию хуже, чем оставить пусто,
 * потому что человек поедет не туда.
 */
function ing_metro(?string $raw): array
{
    static $карта = null;
    static $ключи = null;
    if ($карта === null) {
        $v = @include __DIR__ . '/metro.php';
        $карта = is_array($v) ? $v : [];
        // Длинные названия проверяем первыми: иначе «Площадь Ильича» нашлась
        // бы как «Площадь…» чего-нибудь другого, а «Парк Победы» — внутри
        // «Парк Победы (южный вход)» после более короткого «Парк».
        $ключи = array_keys($карта);
        usort($ключи, fn($a, $b) => mb_strlen($b) - mb_strlen($a));
    }
    if ($raw === null) return [null, null];

    $норм = function (string $s): string {
        $s = mb_strtolower(trim($s));
        $s = str_replace(['ё', '–', '—', '−'], ['е', '-', '-', '-'], $s);
        // Скобки с названием ветки, приставки «м.», «метро», «ст.».
        $s = preg_replace('~\(.*?\)~u', ' ', $s);
        $s = preg_replace('~^\s*(ст\.?\s*)?(м\.|метро|станция)\s*~u', '', $s);
        $s = preg_replace('~[^\p{L}\p{N}\- ]+~u', ' ', $s);
        return trim(preg_replace('~\s+~u', ' ', $s));
    };

    $s = $норм($raw);
    if ($s === '') return [null, null];

    foreach ($ключи as $ст) {
        $n = $норм($ст);
        // Точное совпадение либо станция целым словом внутри строки:
        // «тёплый стан, 7 минут пешком» — это «Тёплый Стан».
        if ($s === $n || preg_match('~(^|\s)' . preg_quote($n, '~') . '($|\s|,)~u', $s)) {
            return [$ст, $карта[$ст]];
        }
    }
    return [null, null];
}

/** За что платят: shift | hour | month. Всё непонятное — по виду вакансии. */
function ing_pay_period(?string $raw, string $kind): string
{
    $s = mb_strtolower(trim((string)$raw));
    if ($s === '') return $kind === 'permanent' ? 'month' : 'shift';
    if (preg_match('~час|hour~u', $s)) return 'hour';
    if (preg_match('~мес|month~u', $s)) return 'month';
    if (preg_match('~смен|shift|день|day~u', $s)) return 'shift';
    return $kind === 'permanent' ? 'month' : 'shift';
}

/**
 * Профессия по заголовку. Наш справочник из четырёх, всё прочее — null.
 *
 * Именно null, а не «кладовщик по умолчанию»: чужая вакансия курьера,
 * записанная кладовщиком, всплывёт у человека, который ищет склад, и это
 * хуже, чем не всплыть нигде.
 */
function ing_work_type(?string $raw, string $title): ?string
{
    $известные = ['stocker', 'cook', 'shift_supervisor', 'picker'];
    $wt = mb_strtolower(trim((string)$raw));
    if (in_array($wt, $известные, true)) return $wt;
    $t = mb_strtolower($title);
    if (mb_strpos($t, 'повар') !== false) return 'cook';
    if (mb_strpos($t, 'сборщик') !== false || mb_strpos($t, 'комплектов') !== false) return 'picker';
    if (mb_strpos($t, 'старш') !== false || mb_strpos($t, 'бригадир') !== false) return 'shift_supervisor';
    if (mb_strpos($t, 'кладовщик') !== false || mb_strpos($t, 'склад') !== false
        || mb_strpos($t, 'грузчик') !== false) return 'stocker';
    // Ниже — названия из тех же ролей hh, которые запрашивает headhunter.php
    // (HH_ROLES). Без них вакансия, пришедшая по нашему же фильтру, не
    // раскладывалась бы ни в один вид работ и её выбрасывал бы отсев в
    // ing_normalize: роль «Повар, пекарь, кондитер» мы попросили сами, а
    // «Пекаря» потом не узнали бы.
    if (mb_strpos($t, 'пекар') !== false || mb_strpos($t, 'кондитер') !== false
        || mb_strpos($t, 'мойщик посуды') !== false) return 'cook';
    if (mb_strpos($t, 'упаковщик') !== false || mb_strpos($t, 'маркировщик') !== false) return 'picker';
    if (mb_strpos($t, 'приемщик') !== false || mb_strpos($t, 'приёмщик') !== false
        || mb_strpos($t, 'разнорабоч') !== false) return 'stocker';
    return null;
}

/** Дата в виде YYYY-MM-DD, иначе null. */
function ing_date(?string $raw): ?string
{
    $s = trim((string)$raw);
    if ($s === '') return null;
    if (preg_match('~^(\d{4})-(\d{2})-(\d{2})~', $s, $m)) {
        return checkdate((int)$m[2], (int)$m[3], (int)$m[1]) ? "$m[1]-$m[2]-$m[3]" : null;
    }
    // 31.12.2026 и 31/12/2026 — оба встречаются в выгрузках.
    if (preg_match('~^(\d{2})[./](\d{2})[./](\d{4})$~', $s, $m)) {
        return checkdate((int)$m[2], (int)$m[1], (int)$m[3]) ? "$m[3]-$m[2]-$m[1]" : null;
    }
    return null;
}

/** Время в виде HH:MM, иначе null. «9:00», «09.00» и «0900» тоже понимаем. */
function ing_time(?string $raw): ?string
{
    $s = trim((string)$raw);
    if ($s === '') return null;
    if (preg_match('~^(\d{1,2})[:.](\d{2})~', $s, $m)) {
        $h = (int)$m[1]; $i = (int)$m[2];
    } elseif (preg_match('~^(\d{2})(\d{2})$~', $s, $m)) {
        $h = (int)$m[1]; $i = (int)$m[2];
    } else {
        return null;
    }
    if ($h > 23 || $i > 59) return null;
    return sprintf('%02d:%02d', $h, $i);
}

function ing_discriminatory(array $it): bool
{
    $text = mb_strtolower(implode(' ', [
        (string)($it['title'] ?? ''),
        (string)($it['description'] ?? ''),
        (string)($it['requirements'] ?? ''),
    ]));
    return (bool)preg_match(
        '~\\bмужчин[аы]?\\b|мужского\\s+пола|\\bженщин[аы]?\\b|женского\\s+пола'
        . '|русскоязычн|славянск(?:ая|ой)\\s+внешност'
        . '|\\b(?:до|от)\\s*\\d{2}\\s*(?:лет|года)|\\b\\d{2}\\s*[–—-]\\s*\\d{2}\\s*(?:лет|года)~u',
        $text
    );
}

/** Привести запись фида к нашему виду. Возвращает null, если она бесполезна. */
function ing_normalize(array $it, string $sourceId): ?array
{
    $ext = trim((string)($it['id'] ?? ''));
    $title = trim((string)($it['title'] ?? ''));
    $url = trim((string)($it['url'] ?? ''));
    // Три обязательных поля. Без ссылки показывать чужую вакансию нельзя —
    // это была бы перепечатка чужого содержимого без пути к источнику.
    if ($ext === '' || $title === '' || !preg_match('~^https://~i', $url)) return null;
    if (ing_discriminatory($it)) return null;

    $kind = ($it['kind'] ?? 'shift') === 'permanent' ? 'permanent' : 'shift';

    // Профессия обязательна ТОЛЬКО для подработки, и в этом вся суть правила.
    //
    // У сервиса два раздела, и они живут по разным законам. «Подработка» —
    // смены линейного персонала, там наши четыре вида работ и есть весь
    // ассортимент: вакансия, которую не отнести ни к одному из них, человеку,
    // ищущему смену, просто мусор. Так в ленту и попадали бухгалтеры с
    // Java-разработчиками, пока hh-адаптер тянул всю Москву без фильтра.
    //
    // «Работа» — постоянные вакансии компаний, и там Java-разработчик не мусор,
    // а товар. Требовать от него work_type из складского списка значит
    // выбросить весь раздел: ни Arbihunter, ни карьерные страницы в эти четыре
    // вида не укладываются и не должны.
    //
    // Отсев именно на приёме, а не на выдаче: хранить чужую смену, которую мы
    // не смогли отнести ни к одному своему виду работ, незачем. Счётчик уже
    // есть — вызывающий считает каждый null как skipped, и тот виден в статусе
    // источника и в last_skipped, который читает дашборд.
    $workType = ing_work_type($it['work_type'] ?? null, $title);
    if ($workType === null && $kind !== 'permanent') return null;
    $loc = is_array($it['location'] ?? null) ? $it['location'] : [];

    // Исходное написание оставляем в metro_station, приведённое кладём
    // рядом. Разбор ошибётся — по исходному видно, что именно прислали, а не
    // только то, во что мы это превратили.
    [$станция, $ветка] = ing_metro(isset($it['metro']) ? (string)$it['metro'] : null);

    $row = [
        'id'            => substr(hash('sha256', $sourceId . '|' . $ext), 0, 24),
        'source_id'     => $sourceId,
        'external_id'   => $ext,
        'title'         => mb_substr($title, 0, 200),
        'company'       => isset($it['company']) ? mb_substr((string)$it['company'], 0, 200) : null,
        'metro_station' => isset($it['metro']) ? mb_substr((string)$it['metro'], 0, 100) : null,
        'address'       => isset($it['address']) ? mb_substr((string)$it['address'], 0, 300) : null,
        'lat'           => isset($loc['lat']) ? (float)$loc['lat'] : null,
        'lng'           => isset($loc['lon']) ? (float)$loc['lon'] : null,
        'metro_station_norm' => $станция,
        'metro_line_id'      => $ветка,
        'work_type'     => $workType,
        'kind'          => $kind,
        'date'          => ing_date($it['date'] ?? null),
        'time_start'    => ing_time($it['time_start'] ?? null),
        'time_end'      => ing_time($it['time_end'] ?? null),
        'salary'        => isset($it['pay']) && $it['pay'] !== null ? (float)$it['pay'] : null,
        'pay_period'    => ing_pay_period($it['pay_period'] ?? null, $kind),
        'schedule'      => isset($it['schedule']) ? mb_substr((string)$it['schedule'], 0, 100) : null,
        'description'   => isset($it['description']) ? mb_substr((string)$it['description'], 0, 2000) : null,
        'url'           => $url,
        'active'        => ($it['active'] ?? true) ? true : false,
        'last_seen_at'  => now_iso(),
    ];
    $row['dedupe_key'] = ing_dedupe_key($row);
    return $row;
}

/** Скачать одну страницу фида с жёстким ограничением размера. */
function ing_fetch_page(string $url, array $hdrs, string $originHost): array
{
    $resolveEntries = ing_safe_https_resolve($url);
    if ($resolveEntries === null) {
        return ['ok' => false, 'error' => 'запрещённый или непубличный HTTPS-адрес'];
    }
    $pageHost = strtolower((string)(parse_url($url, PHP_URL_HOST) ?? ''));
    if ($pageHost === '' || $pageHost !== $originHost) {
        // Authorization нельзя унести по next_url на чужой домен.
        return ['ok' => false, 'error' => 'следующая страница ведёт на другой домен'];
    }

    $body = '';
    $tooLarge = false;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HTTPHEADER => $hdrs,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_RESOLVE => $resolveEntries,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$tooLarge): int {
            if (strlen($body) + strlen($chunk) > 5 * 1024 * 1024) {
                $tooLarge = true;
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    $curlOk = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($tooLarge) return ['ok' => false, 'error' => 'страница ответа больше 5 МБ'];
    if ($curlOk === false || $code < 200 || $code >= 300) {
        return ['ok' => false, 'error' => "не ответил ($code $err)"];
    }
    $dec = json_decode($body, true);
    if (!is_array($dec)) return ['ok' => false, 'error' => 'JSON не разобрать'];
    return ['ok' => true, 'data' => $dec];
}

/** URL следующей страницы. Поддерживаем next_url, next и next_cursor. */
function ing_next_page(array $dec, string $baseUrl): ?string
{
    foreach (['next_url', 'next'] as $key) {
        $v = trim((string)($dec[$key] ?? ''));
        if ($v !== '') return $v;
    }
    $cursor = trim((string)($dec['next_cursor'] ?? ''));
    if ($cursor === '') return null;
    $sep = str_contains($baseUrl, '?') ? '&' : '?';
    return $baseUrl . $sep . 'cursor=' . rawurlencode($cursor);
}

/** Сходить в один источник, включая все страницы полного фида. */
function ing_run_source(array $src): array
{
    $hdrs = ['Accept: application/json'];
    if (!empty($src['auth_header']) && !empty($src['auth_value'])) {
        $hdrs[] = $src['auth_header'] . ': ' . $src['auth_value'];
    }

    $baseUrl = trim((string)($src['url'] ?? ''));
    if (!ing_safe_https_url($baseUrl)) {
        return ['status' => 'запрещённый или непубличный HTTPS-адрес', 'count' => 0];
    }
    $originHost = strtolower((string)(parse_url($baseUrl, PHP_URL_HOST) ?? ''));
    // One worker per source; persist only after successful page writes.
    $stateFile = sys_get_temp_dir() . '/jt-ingest-' . hash('sha256', (string)$src['id']) . '.json';
    $lock = fopen($stateFile . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        return ['status' => 'продолжение: источник уже обрабатывается', 'count' => 0, 'pending' => true];
    }
    $saved = is_file($stateFile) ? json_decode((string)file_get_contents($stateFile), true) : null;
    if (!is_array($saved) || ($saved['base'] ?? '') !== $baseUrl) $saved = [];
    $startedAt = $saved['started'] ?? now_iso();
    $nextUrl = $saved['next'] ?? $baseUrl;
    $deadline = microtime(true) + 75;
    $visited = [];
    $received = (int)($saved['received'] ?? 0);
    $skipped = (int)($saved['skipped'] ?? 0);
    $pages = (int)($saved['pages'] ?? 0);
    $complete = false;
    // Обход дошёл до конца, но не весь: часть адресов не ответила. Такой круг
    // не даёт права гасить вакансии — иначе один 403 у работодателя стирал бы
    // его вакансии из ленты до следующего круга. Источник сообщает это полем
    // partial; кто его не шлёт, ничего не теряет.
    $partial = !empty($saved['partial']);

    while ($nextUrl !== null) {
        if (++$pages > 1000) {
            return ['status' => "ошибка: больше 1000 страниц; загружено $received", 'count' => $received];
        }
        if (isset($visited[$nextUrl])) {
            return ['status' => "ошибка: цикл пагинации на странице $pages", 'count' => $received];
        }
        $visited[$nextUrl] = true;

        $page = ing_fetch_page($nextUrl, $hdrs, $originHost);
        if (empty($page['ok'])) {
            return [
                'status' => "ошибка страницы $pages: " . (string)($page['error'] ?? 'неизвестно')
                    . "; уже загружено $received, прежние вакансии сохранены",
                'count' => $received,
            ];
        }

        $dec = $page['data'];
        if (!empty($dec['partial'])) $partial = true;
        $items = is_array($dec['items'] ?? null) ? $dec['items']
            : (array_is_list($dec) ? $dec : null);
        if (!is_array($items)) {
            return ['status' => "ошибка страницы $pages: нет массива items", 'count' => $received];
        }

        $rows = [];
        foreach ($items as $it) {
            if (!is_array($it)) { $skipped++; continue; }
            $r = ing_normalize($it, (string)$src['id']);
            if ($r === null) { $skipped++; continue; }
            $rows[] = $r;
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            sb_upsert_rows('jm_ext_vacancies', $chunk, 'source_id,external_id');
            sm_cache_invalidate();
        }
        $received += count($rows);
        // SuperJob обходится по рубрикам из-за лимита API в 500 результатов
        // на запрос. Одна вакансия может входить в несколько рубрик, поэтому
        // входных строк больше, чем уникальных вакансий в таблице.
        $recordLimit = (string)$src['id'] === 'superjob' ? 250000 : 50000;
        if ($received + $skipped > $recordLimit) {
            return [
                'status' => "ошибка: больше $recordLimit записей; загружено $received, прежние вакансии сохранены",
                'count' => $received,
            ];
        }

        $candidate = ing_next_page($dec, $baseUrl);
        $hasMore = !empty($dec['has_more']);
        if ($candidate === null) {
            if ($hasMore) {
                return [
                    'status' => "ошибка страницы $pages: has_more=true без next_url/next_cursor; "
                        . "загружено $received, прежние вакансии сохранены",
                    'count' => $received,
                ];
            }
            $complete = true;
            $nextUrl = null;
        } else {
            $nextUrl = $candidate;
        }
        if ($nextUrl !== null) {
            $checkpoint = json_encode([
                'base' => $baseUrl, 'started' => $startedAt, 'next' => $nextUrl,
                'received' => $received, 'skipped' => $skipped, 'pages' => $pages,
                'partial' => $partial,
            ]);
            if (file_put_contents($stateFile . '.tmp', $checkpoint) === false
                || !rename($stateFile . '.tmp', $stateFile)) {
                throw new RuntimeException('Cannot save ingest checkpoint');
            }
            if (microtime(true) >= $deadline) {
                return ['status' => "продолжение: страниц $pages, получено $received",
                    'count' => $received, 'pages' => $pages, 'pending' => true];
            }
        }
    }

    // Гасим пропавшие вакансии только после полного и ПОЛНОЦЕННОГО обхода.
    // Если партнёрская API упала на середине, старые карточки остаются
    // доступными; то же и когда обход дошёл до конца, но часть адресов не
    // ответила (partial).
    $gone = 0;
    if ($complete && !$partial) {
        $stale = sb_select_all('jm_ext_vacancies', [
            'source_id' => 'eq.' . $src['id'],
            'active' => 'is.true',
            'last_seen_at' => 'lt.' . $startedAt,
        ], 'id');
        foreach (array_chunk(array_column($stale, 'id'), 100) as $chunk) {
            sb_update('jm_ext_vacancies', ['id' => 'in.(' . implode(',', $chunk) . ')'], ['active' => false]);
        }
        $gone = count($stale);
        if ($gone > 0) sm_cache_invalidate();
    }

    if (is_file($stateFile)) unlink($stateFile);
    // «не весь» в статусе видно в панели: источник работает, но часть
    // работодателей не отвечает, и гашение на этом круге не делалось.
    $whole = $partial ? 'ок, не весь' : 'ок';
    return [
        'status' => "$whole: страниц $pages, получено $received, пропущено $skipped, погашено $gone",
        'count' => $received,
        'pages' => $pages,
        'skipped' => $skipped,
        'deactivated' => $gone,
    ];
}

// ── Сам заход ─────────────────────────────────────────────────────────────

if (!defined('INGEST_LIBRARY_ONLY')) {
$only = trim((string)($_GET['source'] ?? ''));   // для кнопки «проверить сейчас»
$force = ($_GET['force'] ?? '') !== '';

$f = ['enabled' => 'is.true'];
if ($only !== '') $f['id'] = 'eq.' . $only;
$sources = sb_select('jm_ext_sources', $f);

$done = [];
foreach ($sources as $src) {
    // Расписание проверяем здесь, а не таймером: у каждого источника оно своё,
    // а таймер один.
    if (!$force && !empty($src['last_run_at'])) {
        $age = time() - strtotime((string)$src['last_run_at']);
        if ($age < (int)$src['period_min'] * 60) continue;
    }
    $started = microtime(true);
    $res = ing_run_source($src);
    $durationMs = (int)round((microtime(true) - $started) * 1000);
    $ranAt = now_iso();
    $success = str_starts_with((string)$res['status'], 'ок');
    $pages = isset($res['pages']) ? (int)$res['pages'] : null;
    $skipped = isset($res['skipped']) ? (int)$res['skipped'] : null;
    $deactivated = isset($res['deactivated']) ? (int)$res['deactivated'] : null;

    $sourceUpdate = [
        'last_run_at' => !empty($res['pending']) ? null : $ranAt,
        'last_status' => $res['status'],
        'last_count' => $res['count'],
        'last_duration_ms' => $durationMs,
        'last_pages' => $pages,
        'last_skipped' => $skipped,
        'last_deactivated' => $deactivated,
        'consecutive_failures' => $success
            ? 0 : ((int)($src['consecutive_failures'] ?? 0) + 1),
    ];
    if ($success) $sourceUpdate['last_success_at'] = $ranAt;
    sb_update('jm_ext_sources', ['id' => 'eq.' . $src['id']], $sourceUpdate);

    if (empty($res['pending'])) sb_insert('jm_ext_ingest_runs', [
        'id' => bin2hex(random_bytes(12)),
        'source_id' => (string)$src['id'],
        'success' => $success,
        'received' => (int)$res['count'],
        'status' => (string)$res['status'],
        'ran_at' => $ranAt,
        'duration_ms' => $durationMs,
        'pages' => $pages,
        'skipped' => $skipped,
        'deactivated' => $deactivated,
    ]);
    $done[] = ['name' => $src['name'], 'status' => $res['status']];
}

echo json_encode(['ok' => true, 'sources' => count($sources), 'run' => $done], JSON_UNESCAPED_UNICODE);
}
