<?php
// Разбор карьерной страницы работодателя: разметка JobPosting → общий формат фида.
//
// Зачем это вообще. Разбор конкурентов (раздел «Кто разорился») даёт кейс Jobr:
// приложение висело на API LinkedIn, LinkedIn закрыл доступ — продукта не стало.
// Наша лента висит на api.hh.ru, api.superjob.ru и opendata.trudvsem.ru, своих
// вакансий пара в сутки. План развития называет выход буквально: «Начинать с
// карьерных страниц и систем найма».
//
// Карьерная страница — это источник, который никто не может у нас отключить,
// потому что мы берём его у самого работодателя, а не у посредника. Разметка
// schema.org JobPosting там уже есть: работодатели ставят её, чтобы попадать в
// поиск по вакансиям. Ровно ту же разметку мы сами отдаём в vacancy_page.php,
// так что формат нам знаком с обеих сторон.
//
// Здесь только чистые функции — ни сети, ни базы. Сеть в career.php.

/** Сырые тела всех блоков <script type="application/ld+json">. */
function cf_ld_blocks(string $html): array
{
    $out = [];
    // Тип может идти до или после других атрибутов, регистр произвольный.
    $re = '~<script\b[^>]*\btype\s*=\s*["\']?application/ld\+json["\']?[^>]*>(.*?)</script\s*>~is';
    if (preg_match_all($re, $html, $m)) {
        foreach ($m[1] as $body) $out[] = trim($body);
    }
    return $out;
}

/**
 * Все объекты JobPosting из разметки страницы.
 *
 * Обходим дерево, а не берём корень: разметку кладут и списком, и внутри
 * @graph, и вложенной в ItemList. Глубину ограничиваем — страницу присылает
 * чужой сервер, и уходить в рекурсию по его данным нельзя.
 */
function cf_job_postings(string $html): array
{
    $found = [];
    foreach (cf_ld_blocks($html) as $raw) {
        $data = json_decode($raw, true);
        if (!is_array($data)) continue;
        cf_walk($data, $found, 0);
    }
    return $found;
}

function cf_walk(array $node, array &$found, int $depth): void
{
    if ($depth > 8 || count($found) >= 500) return;
    $type = $node['@type'] ?? null;
    $types = is_array($type) ? $type : [$type];
    foreach ($types as $t) {
        if (is_string($t) && strcasecmp($t, 'JobPosting') === 0) {
            $found[] = $node;
            return; // вложенные в вакансию объекты — её части, не вакансии
        }
    }
    foreach ($node as $child) {
        if (is_array($child)) cf_walk($child, $found, $depth + 1);
    }
}

/** Человеческий текст из значения разметки: без тегов, сущностей и лишних пробелов. */
function cf_text($value): string
{
    if (is_array($value)) $value = $value['name'] ?? $value['@value'] ?? '';
    $text = html_entity_decode(strip_tags((string)$value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim(preg_replace('~\s+~u', ' ', $text));
}

/** Первое непустое имя: значение бывает строкой, объектом и списком объектов. */
function cf_name($value): string
{
    if (is_array($value) && array_is_list($value)) {
        foreach ($value as $one) {
            $name = cf_text($one);
            if ($name !== '') return $name;
        }
        return '';
    }
    return cf_text($value);
}

/** Адрес из jobLocation: улица, иначе город. */
function cf_address($location): string
{
    if (is_array($location) && array_is_list($location)) {
        foreach ($location as $one) {
            $a = cf_address($one);
            if ($a !== '') return $a;
        }
        return '';
    }
    if (!is_array($location)) return '';
    $addr = $location['address'] ?? null;
    if (is_string($addr)) return cf_text($addr);
    if (!is_array($addr)) return '';
    $parts = array_filter([
        cf_text($addr['streetAddress'] ?? ''),
        cf_text($addr['addressLocality'] ?? ''),
    ]);
    return implode(', ', array_unique($parts));
}

/**
 * Оплата и её период.
 *
 * Чужую валюту пропускаем молча: вакансия в долларах на складе в Москве —
 * почти наверняка ошибка разметки, а показать её как рубли значит соврать
 * работнику о деньгах. Лучше без суммы, чем с неверной.
 */
function cf_salary($baseSalary): array
{
    if (!is_array($baseSalary)) return ['pay' => null, 'period' => ''];
    $currency = strtoupper(cf_text($baseSalary['currency'] ?? ''));
    if ($currency !== '' && $currency !== 'RUB' && $currency !== 'RUR') {
        return ['pay' => null, 'period' => ''];
    }
    $value = $baseSalary['value'] ?? null;
    if (is_numeric($value)) return ['pay' => (float)$value, 'period' => ''];
    if (!is_array($value)) return ['pay' => null, 'period' => ''];

    // Вилку сводим к нижней границе: это то, на что человек может рассчитывать.
    foreach (['value', 'minValue', 'maxValue'] as $key) {
        if (is_numeric($value[$key] ?? null) && (float)$value[$key] > 0) {
            return ['pay' => (float)$value[$key], 'period' => cf_text($value['unitText'] ?? '')];
        }
    }
    return ['pay' => null, 'period' => ''];
}

/**
 * Вакансия из разметки в элемент фида. null — брать нечего.
 *
 * Обязательны название и ссылка. Без ссылки чужую вакансию показывать нельзя:
 * это была бы перепечатка чужого текста без пути к первоисточнику. Ровно то же
 * правило стоит в ing_normalize, и оно не должно разъехаться.
 */
function cf_normalize(array $p, string $pageUrl, int $now): ?array
{
    $title = cf_text($p['title'] ?? $p['name'] ?? '');
    if ($title === '') return null;

    $url = trim((string)($p['url'] ?? $p['@id'] ?? ''));
    if (!preg_match('~^https://~i', $url)) $url = $pageUrl;
    if (!preg_match('~^https://~i', $url)) return null;

    // Закрытую вакансию не берём: работник поедет на смену, которой нет.
    $validThrough = trim((string)($p['validThrough'] ?? ''));
    if ($validThrough !== '') {
        $ts = strtotime($validThrough);
        if ($ts !== false && $ts < $now) return null;
    }

    $identifier = $p['identifier'] ?? null;
    if (is_array($identifier)) $identifier = $identifier['value'] ?? '';
    $ext = trim((string)$identifier);
    // Своего номера у вакансии может не быть — тогда её имя это её адрес.
    // Адрес устойчив: пока ссылка та же, при следующем обходе узнаем ту же
    // вакансию, а не заведём дубль.
    if ($ext === '') $ext = substr(hash('sha256', $url), 0, 24);

    $salary = cf_salary($p['baseSalary'] ?? null);
    $item = [
        'id' => $ext,
        'title' => $title,
        'kind' => 'permanent',
        'url' => $url,
        'active' => true,
    ];

    $company = cf_name($p['hiringOrganization'] ?? null);
    if ($company !== '') $item['company'] = $company;

    $address = cf_address($p['jobLocation'] ?? null);
    if ($address !== '') $item['address'] = $address;

    if ($salary['pay'] !== null && $salary['pay'] > 0) {
        $item['pay'] = $salary['pay'];
        // Пустой период ingest разложит сам по kind — навязывать 'month' здесь
        // значило бы выдумать за работодателя.
        if ($salary['period'] !== '') $item['pay_period'] = $salary['period'];
    }

    $employment = cf_name($p['employmentType'] ?? null);
    if ($employment !== '') $item['schedule'] = $employment;

    $description = cf_text($p['description'] ?? '');
    if ($description !== '') $item['description'] = $description;

    return $item;
}

/** Все вакансии со страницы, без повторов по внешнему номеру. */
function cf_items(string $html, string $pageUrl, int $now): array
{
    $items = [];
    foreach (cf_job_postings($html) as $posting) {
        $item = cf_normalize($posting, $pageUrl, $now);
        if ($item === null) continue;
        // Одна вакансия нередко размечена дважды: в списке и в карточке.
        $items[$item['id']] = $item;
    }
    return array_values($items);
}
