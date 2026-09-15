<?php
// Короткий доступ к базе для тех файлов, которым не нужен весь db.php.
//
// db.php подключать нельзя: он не библиотека, а обработчик запроса — включив
// его, вы запускаете разбор входящего JSON и всё остальное заодно. А нужно
// здесь ровно четыре действия: выбрать, выбрать одну, вставить-или-обновить,
// обновить.
//
// Один файл на всех, кому это нужно, а не копия в каждом: три копии одних и
// тех же двадцати строк расходятся через месяц, и потом одна из них ходит в
// базу не с теми заголовками.

if (!function_exists('sb')) {

    // Адрес тот же и с той же оговоркой, что в db.php: только свой сервер в
    // Москве, без переключателя в окружении. Настройка, которой первичная
    // запись ПДн граждан РФ уводится за границу, не должна существовать —
    // ч. 5 ст. 18 152-ФЗ. Сменить адрес можно правкой кода.
    function sb_lite_url(): string
    {
        return 'https://jobtoo.ru';
    }

    function sb_lite_key(): string
    {
        $env = getenv('SB_SERVICE_KEY');
        if (is_string($env) && trim($env) !== '') return trim($env);
        $f = __DIR__ . '/sb_service_key.php';
        if (is_readable($f)) {
            $v = @include $f;
            if (is_string($v) && trim($v) !== '') return trim($v);
        }
        return '';
    }

    function sb(string $method, string $table, array $query = [], $body = null, array $extra = []): array
    {
        $url = sb_lite_url() . '/rest/v1/' . $table;
        if (!empty($query)) $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => array_merge([
                'apikey: ' . sb_lite_key(),
                'Authorization: Bearer ' . sb_lite_key(),
                'Content-Type: application/json',
            ], $extra),
            CURLOPT_TIMEOUT => 20,
        ]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if (defined('SB_STRICT') && SB_STRICT && ($resp === false || $status < 200 || $status >= 300)) {
            throw new RuntimeException("Database request failed: $method $table HTTP $status");
        }
        $dec = json_decode($resp ?: '[]', true);
        return is_array($dec) ? $dec : [];
    }

    function sb_select(string $t, array $f = [], string $sel = '*'): array
    {
        return sb('GET', $t, array_merge(['select' => $sel], $f));
    }

    function sb_single(string $t, array $f = [], string $sel = '*'): ?array
    {
        $rows = sb_select($t, array_merge($f, ['limit' => '1']), $sel);
        return $rows[0] ?? null;
    }

    function sb_update(string $t, array $f, array $data): void
    {
        sb('PATCH', $t, $f, $data, ['Prefer: return=minimal']);
    }

    /** Вставить или обновить по ключу конфликта — одним запросом на пачку. */
    function sb_upsert_rows(string $t, array $rows, string $on_conflict): void
    {
        if (!$rows) return;
        sb('POST', $t, ['on_conflict' => $on_conflict], $rows,
           ['Prefer: return=minimal,resolution=merge-duplicates']);
    }

    /** Вызов PostgREST RPC. Возвращаем строки результата как обычный массив. */
    function sb_rpc(string $name, array $args = []): array
    {
        return sb('POST', 'rpc/' . $name, [], $args, ['Prefer: return=representation']);
    }

    function now_iso(): string
    {
        return gmdate('Y-m-d\TH:i:s') . '.000Z';
    }
}

if (!function_exists('sb_insert')) {
    function sb_insert(string $t, array $row): void {
        sb('POST', $t, [], $row, ['Prefer: return=minimal']);
    }
}
if (!function_exists('sb_select_all')) {
    function sb_select_all(string $t, array $f = [], string $sel = '*'): array {
        $all = [];
        for ($offset = 0; ; $offset += 500) {
            $page = sb_select($t, array_merge($f, [
                'limit' => '500', 'offset' => (string)$offset, 'order' => 'id.asc',
            ]), $sel);
            $all = array_merge($all, $page);
            if (count($page) < 500) return $all;
        }
    }
}
