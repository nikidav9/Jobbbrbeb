<?php
/**
 * Подсказки YandexGPT телефонному автопилоту (решение владельца 01.10.2026:
 * «если непонятно, что заполнять, передаём сигнал серверу и разбираемся»).
 *
 * Автопилот во встроенном браузере (services/jupiterAutopilot.ts) не узнал
 * обязательное поле анкеты — присылает сюда ПОДПИСИ полей (без значений и без
 * данных человека). Сервер сначала смотрит свою таблицу подсказок по сайту
 * (jm_jupiter_field_hints, миграция 141), незнакомое спрашивает у YandexGPT:
 * какой ключ профиля сюда подходит. Ответ — только ключ из разрешённого
 * списка или null; значения из профиля подставляет телефон у себя.
 *
 * Правила те же, что у серверного Юпитера (jupiter/yandex_gpt.py,
 * jupiter/browser_planner.py): модель не видит данных кандидата — подписи
 * проходят через вычёркивание почты, телефонов, длинных чисел, ссылок с
 * параметрами и ФИО; ответ — строгая схема; ключ — только из списка.
 *
 * Чистые функции — без сети и базы, их проверяет tests/jupiter_field_hints_test.php.
 */

/** Ключи профиля, которые телефон умеет подставить (JupiterFillProfile). */
const JT_FH_KEYS = ['first_name', 'last_name', 'patronymic', 'full_name', 'phone',
    'email', 'city', 'citizenship', 'desired_role'];
const JT_FH_MAX_FIELDS = 12;
const JT_FH_BASE_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

// Слова анкеты — подписи, а не ФИО («Фамилия Имя Отчество», «First Name»).
const JT_FH_FORM_WORDS = ['фамилия', 'имя', 'отчество', 'телефон', 'почта', 'город', 'дата',
    'рождения', 'адрес', 'резюме', 'сопроводительное', 'письмо', 'зарплата', 'должность',
    'компания', 'страна', 'гражданство', 'опыт', 'образование', 'ссылка', 'файл',
    'электронная', 'контактный', 'мобильный', 'ваш', 'ваше', 'ваша', 'полное', 'желаемая',
    'ожидаемая', 'текущая', 'first', 'last', 'middle', 'full', 'name', 'phone', 'mobile',
    'email', 'mail', 'address', 'city', 'country', 'date', 'birth', 'resume', 'cv', 'cover',
    'letter', 'salary', 'position', 'company', 'current', 'expected', 'your', 'citizenship'];

function jt_fh_is_form_word(string $w): bool {
    $w = mb_strtolower($w);
    foreach (JT_FH_FORM_WORDS as $s) {
        if (str_starts_with($w, $s) && mb_strlen($w) - mb_strlen($s) <= 2) return true;
    }
    return false;
}

/** Вычёркивает из подписи всё, что может оказаться данными человека. */
function jt_fh_redact(string $t): string {
    $t = (string)preg_replace('~(?:https?://|www\.)[^\s?#]*[?#]\S*~iu', '[ссылка]', $t);
    $t = (string)preg_replace('~(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+~u', '[email]', $t);
    $t = (string)preg_replace('~(?<![\w])\+?\d[\d\s().-]{8,}\d(?![\w])~u', '[телефон]', $t);
    $t = (string)preg_replace('~\d{6,}~u', '[число]', $t);
    $t = (string)preg_replace('~\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?(?:[А-ЯЁ]\.?)?|\b[А-ЯЁ]\.\s?(?:[А-ЯЁ]\.\s?)?[А-ЯЁ][а-яё]+\b~u', '[ФИО]', $t);
    foreach (['~\b[А-ЯЁ][а-яё]+(?:[ \t]+[А-ЯЁ][а-яё]+){1,2}\b~u', '~\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2}\b~u'] as $re) {
        $t = (string)preg_replace_callback($re, function ($m) {
            foreach (preg_split('~\s+~u', $m[0]) as $w) if (jt_fh_is_form_word($w)) return $m[0];
            return '[ФИО]';
        }, $t);
    }
    return mb_substr(trim($t), 0, 160);
}

/**
 * Поля из запроса телефона → чистый список. Подпись сайта — не более 160
 * знаков, подпись поля (sig) — как её строит автопилот, до 140 знаков из
 * безопасного набора. Варианты выпадающего списка — до 15 штук.
 */
function jt_fh_clean_fields($raw): array {
    $out = [];
    if (!is_array($raw)) return $out;
    foreach (array_slice($raw, 0, JT_FH_MAX_FIELDS) as $f) {
        if (!is_array($f)) continue;
        $sig = (string)($f['sig'] ?? '');
        if ($sig === '' || mb_strlen($sig) > 140 || !preg_match('~^[0-9a-zа-я _|.\-\[\]]+$~u', $sig)) continue;
        $opts = [];
        foreach (array_slice((array)($f['options'] ?? []), 0, 15) as $o) {
            $o = jt_fh_redact((string)$o);
            if ($o !== '') $opts[] = mb_substr($o, 0, 60);
        }
        $out[] = [
            'sig' => $sig,
            'label' => jt_fh_redact((string)($f['label'] ?? '')),
            'name' => mb_substr((string)preg_replace('~[^0-9A-Za-z_\-\[\]]~', '', (string)($f['name'] ?? '')), 0, 40),
            'type' => mb_substr((string)preg_replace('~[^a-z\-]~', '', strtolower((string)($f['type'] ?? 'text'))), 0, 16),
            'options' => $opts,
        ];
    }
    return $out;
}

/** Текст запроса к модели: поля под условными f0…fN. */
function jt_fh_prompt(array $fields, string $host): array {
    $system = 'Ты помогаешь заполнить анкету отклика на вакансию. По подписи поля определи, '
        . 'какой ключ профиля кандидата в него подходит. Допустимые ключи: ' . implode(', ', JT_FH_KEYS)
        . '. Если поле не про эти данные (вопрос о зарплате, опыте, согласие, файл и т. п.) — null. '
        . 'Не придумывай. Отвечай строго одним JSON-объектом без пояснений вида {"f0": "city", "f1": null}.';
    $lines = ['Сайт: ' . preg_replace('~[^0-9a-z.\-]~', '', strtolower($host))];
    foreach ($fields as $i => $f) {
        $line = 'f' . $i . ': подпись «' . $f['label'] . '»';
        if ($f['name'] !== '') $line .= ', имя поля ' . $f['name'];
        if ($f['type'] !== '') $line .= ', тип ' . $f['type'];
        if ($f['options']) $line .= ', варианты: ' . implode(' / ', $f['options']);
        $lines[] = $line;
    }
    return [$system, implode("\n", $lines)];
}

/**
 * Ответ модели → [sig => ключ|null]. Берём только f0…fN из запроса и только
 * ключи из списка: подпись поля пишет чужой сайт, и «ответ» модели может
 * оказаться чем угодно.
 */
function jt_fh_parse(string $text, array $fields): array {
    $t = trim($text);
    if (preg_match('~^```(?:json)?\s*(.*?)\s*```$~s', $t, $m)) $t = $m[1];
    $a = strpos($t, '{'); $b = strrpos($t, '}');
    $d = ($a !== false && $b !== false && $b > $a) ? json_decode(substr($t, $a, $b - $a + 1), true) : null;
    $out = [];
    foreach ($fields as $i => $f) {
        $v = is_array($d) ? ($d['f' . $i] ?? null) : null;
        $out[$f['sig']] = (is_string($v) && in_array($v, JT_FH_KEYS, true)) ? $v : null;
    }
    return $out;
}

/** Ключ и каталог YandexGPT — из yandex_gpt.php (доставляет deploy.php). */
function jt_fh_credentials(): ?array {
    $p = __DIR__ . '/yandex_gpt.php';
    $c = is_readable($p) ? @include $p : null;
    if (!is_array($c) || empty($c['api_key']) || empty($c['folder_id'])) return null;
    return ['api_key' => (string)$c['api_key'], 'folder_id' => (string)$c['folder_id']];
}

/** Один вызов модели. null — модель недоступна (тогда поле остаётся человеку). */
function jt_fh_ask_gpt(array $fields, string $host): ?array {
    $cred = jt_fh_credentials();
    if ($cred === null || !$fields) return null;
    [$system, $user] = jt_fh_prompt($fields, $host);
    $body = json_encode([
        'modelUri' => 'gpt://' . $cred['folder_id'] . '/yandexgpt-lite/latest',
        'completionOptions' => ['stream' => false, 'temperature' => 0, 'maxTokens' => '400'],
        'messages' => [['role' => 'system', 'text' => $system], ['role' => 'user', 'text' => $user]],
    ], JSON_UNESCAPED_UNICODE);
    $ch = curl_init(JT_FH_BASE_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json',
            'Authorization: Api-Key ' . $cred['api_key'], 'x-folder-id: ' . $cred['folder_id'],
            // Не хранить запрос у Яндекса и не учить на нём модели: без этого
            // заголовка YandexGPT сохраняет текст запросов (AI Studio, «Отключить
            // логирование»; решение владельца 02.10.2026).
            'x-data-logging-enabled: false'],
    ]);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code !== 200) {
        error_log('[field_hints] YandexGPT: HTTP ' . $code);
        return null;
    }
    $d = json_decode((string)$resp, true);
    $text = $d['result']['alternatives'][0]['message']['text'] ?? null;
    return is_string($text) ? jt_fh_parse($text, $fields) : null;
}
