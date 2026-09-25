<?php
// Разбор карьерной страницы работодателя: разметка JobPosting → общий формат фида.
//
// Зачем это вообще. Разбор конкурентов (раздел «Кто разорился») даёт кейс Jobr:
// приложение висело на API LinkedIn, LinkedIn закрыл доступ — продукта не стало.
// Наша лента висит на чужих API (Arbihunter и прочие партнёры), своих
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

// Описание разделами из полей API (vt_sections_from_fields). Взаимное
// подключение безопасно: require_once не заходит в файл второй раз.
require_once __DIR__ . '/vacancy_text.php';

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
    // `title` в списке не случайно: у МТС город приходит как
    // [{id, slug, title}], и без него адрес вакансии терялся молча — карточка
    // показывала должность без города.
    if (is_array($value)) $value = $value['name'] ?? $value['@value'] ?? $value['title'] ?? '';
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

// ── Второй способ чтения: собственный JSON карьерного сайта ──────────────────
//
// Зачем он понадобился. Разметку schema.org/JobPosting ставят почти одни
// IT-компании, да и то не все: из восемнадцати проверенных карьерных сайтов
// (Сбер, МТС, Яндекс, Ozon, ВТБ, VK, Т-Банк, Самокат, X5, Магнит, ВкусВилл и
// другие) её нет ни у одного. Разбор выше на них не находит ничего — и это не
// поломка, а отсутствие предмета.
//
// Но почти все они SPA: страница приходит пустой, вакансии подгружает скрипт.
// Значит за страницей всегда стоит источник данных, и он отдаёт готовый JSON.
// Проверено дважды: у cofinder это `/api/v1/vacancies/`, у карьерных сайтов на
// Хантфлоу — `/api/vacancy`, одинаково у пяти разных клиентов платформы.
//
// Читать JSON лучше, чем разбирать HTML, по двум причинам. Он не ломается от
// смены вёрстки — а именно на этом у cofinder из 111 российских парсеров
// сломаны 15. И это штатный интерфейс сайта, а не разбор чужой разметки.
//
// Соответствие полей описывает НАСТРОЙКА источника, а не код: у каждого сайта
// свои имена, и заводить под каждый по функции значило бы повторить те самые
// 160 парсеров. Код здесь один на всех, различия живут в connector_config.

/** Значение по пути вида «data.items» или «items»; null, если пути нет. */
function cf_dig($data, string $path)
{
    if ($path === '') return $data;
    foreach (explode('.', $path) as $key) {
        if (!is_array($data) || !array_key_exists($key, $data)) return null;
        $data = $data[$key];
    }
    return $data;
}

/**
 * Вакансии из JSON карьерного сайта.
 *
 * $map описывает, где что лежит:
 *   list  — путь к массиву вакансий («items», «data», «» для голого массива);
 *   title — поле с названием (обязательно);
 *   url   — поле с готовой ссылкой ИЛИ url_template с «{поле}» внутри;
 *   id, company, address, pay, description, schedule, closed — необязательные.
 *
 * Правило про ссылку то же, что и для разметки: без пути к первоисточнику
 * вакансию не берём. Это не формальность — именно этим мы отличаемся от
 * swipejobs, который выдаёт чужие вакансии за свои.
 */
function cf_json_items($data, array $map, string $pageUrl, int $now): array
{
    $rows = cf_dig($data, (string)($map['list'] ?? ''));
    if (!is_array($rows)) return [];

    $items = [];
    foreach ($rows as $row) {
        if (!is_array($row)) continue;

        // cf_name, а не cf_text: поле сплошь и рядом оказывается объектом
        // {id, name} или списком таких объектов. У Yadro, например, город
        // приходит как [{"id":2,"name":"Москва"},{"id":3,"name":"СПб"}] —
        // cf_text вернул бы на этом пустую строку и город потерялся бы молча.
        $title = cf_name(cf_dig($row, (string)($map['title'] ?? 'title')));
        if ($title === '') continue;

        $url = cf_json_url($row, $map, $pageUrl);
        if ($url === '') continue;

        // Закрытую вакансию не берём: человек поедет туда, где его не ждут.
        $closedField = (string)($map['closed'] ?? '');
        if ($closedField !== '') {
            $closed = cf_dig($row, $closedField);
            if ($closed !== null && $closed !== false && $closed !== '' && $closed !== 0) continue;
        }

        $ext = cf_name(cf_dig($row, (string)($map['id'] ?? '')));
        // Своего номера может не быть — тогда имя вакансии это её адрес. Адрес
        // устойчив: при следующем обходе узнаем ту же вакансию, а не заведём
        // дубль. То же правило, что и в cf_normalize.
        if ($ext === '') $ext = substr(hash('sha256', $url), 0, 24);

        $item = ['id' => $ext, 'title' => $title, 'kind' => 'permanent',
                 'url' => $url, 'active' => true];

        foreach (['company' => 'company', 'address' => 'address',
                  'description' => 'description', 'schedule' => 'schedule'] as $to => $_) {
            $field = (string)($map[$to] ?? '');
            if ($field === '') continue;
            $value = cf_name(cf_dig($row, $field));
            if ($value !== '') $item[$to] = $value;
        }

        // Полное описание разделами прямо из списка (Сбер отдаёт обязанности,
        // требования и условия отдельными полями). Коротким анонсом при этом
        // остаётся description: его ingest режет до 2000 знаков.
        $sections = $map['description_sections'] ?? null;
        if (is_array($sections) && $sections) {
            $full = vt_sections_from_fields($row, $sections);
            if (mb_strlen($full) >= 120) {
                $item['description_full'] = $full;
                if (!isset($item['description'])) $item['description'] = $full;
            }
        }

        // Описание в карточке вакансии отдельным JSON-запросом: в списке его
        // нет, а страница — пустая оболочка SPA. Сам запрос делает
        // describe.php, здесь только запоминаем, куда и за какими полями идти.
        $detailTemplate = (string)($map['detail_url_template'] ?? '');
        $detailSections = $map['detail_sections'] ?? null;
        if ($detailTemplate !== '' && is_array($detailSections) && $detailSections) {
            $detailUrl = cf_json_url($row, ['url_template' => $detailTemplate], $pageUrl);
            if ($detailUrl !== '') {
                $item['detail_spec'] = [
                    'url' => $detailUrl,
                    'list' => (string)($map['detail_list'] ?? ''),
                    'sections' => $detailSections,
                ];
            }
        }

        // Постоянное название компании — ПОСЛЕ разбора полей, иначе его
        // перебивает поле из ответа. У Ростелекома так и вышло: в карточке
        // стояло «Технический блок» — это направление, а не работодатель.
        $const = trim((string)($map['company_const'] ?? ''));
        if ($const !== '') $item['company'] = $const;

        $payField = (string)($map['pay'] ?? '');
        if ($payField !== '') {
            $pay = cf_dig($row, $payField);
            // Сумма приходит и числом, и строкой «от 80 000 ₽»: вытаскиваем
            // первое число, а мусор вроде «по договорённости» отбрасываем.
            if (is_string($pay)) {
                $digits = preg_replace('~[^\d]~', '', explode('-', $pay)[0] ?? '');
                $pay = $digits !== '' ? (float)$digits : null;
            }
            if (is_numeric($pay) && (float)$pay > 0) $item['pay'] = (float)$pay;
        }

        $items[$item['id']] = $item;
    }
    return array_values($items);
}

/** Ссылка на вакансию: готовое поле либо шаблон с подстановкой полей строки. */
function cf_json_url(array $row, array $map, string $pageUrl): string
{
    $template = (string)($map['url_template'] ?? '');
    if ($template !== '') {
        $url = preg_replace_callback('~\{([a-zA-Z0-9_.]+)\}~', function ($m) use ($row) {
            // Кодируем каждый кусок пути отдельно, а не целиком. Сплошной
            // rawurlencode превращал «/» в «%2F», и у Lamoda ссылка
            // /vacancy/moskva/frontend-vue-developer--1946 ломалась: её slug
            // состоит из двух сегментов. Защита при этом остаётся — «?», «#»
            // и «:» по-прежнему экранируются, чужой адрес не подставить.
            $value = cf_name(cf_dig($row, $m[1]));
            return implode('/', array_map('rawurlencode', explode('/', $value)));
        }, $template);
        if (preg_match('~^https://~i', $url) && !str_contains($url, '{')) return $url;
    }
    $field = (string)($map['url'] ?? 'url');
    $url = trim((string)cf_dig($row, $field));
    if (preg_match('~^https://~i', $url)) return $url;
    // Ссылка на СВОЙ ЖЕ хост, написанная через http. Встречается у страниц,
    // сделанных на конструкторах: у Детского мира все двенадцать вакансий —
    // «кладовщик», «комплектовщик товара», «упаковщик», ровно наша аудитория —
    // проставлены как http://jobs.detmir.ru/..., при том что по https та же
    // страница открывается. Без этого правила работодатель терялся целиком.
    //
    // Поднимаем схему ТОЛЬКО когда хост совпадает с хостом страницы-источника.
    // Чужой http-адрес так и остаётся отброшенным: подставить в ленту ссылку
    // на постороннюю незащищённую страницу мы не должны.
    if (preg_match('~^http://~i', $url)) {
        $base = parse_url($pageUrl);
        $own = parse_url($url);
        if (($base['scheme'] ?? '') === 'https'
            && ($own['host'] ?? '') !== ''
            && strcasecmp($own['host'], (string)($base['host'] ?? '')) === 0) {
            return 'https://' . substr($url, strlen('http://'));
        }
        return '';
    }
    // Относительный адрес достраиваем от страницы источника: «/vacancy/go-3»
    // сам по себе никуда не ведёт.
    if ($url !== '' && str_starts_with($url, '/')) {
        $base = parse_url($pageUrl);
        if (($base['scheme'] ?? '') === 'https' && ($base['host'] ?? '') !== '') {
            return 'https://' . $base['host'] . $url;
        }
    }
    return '';
}

/**
 * Адрес одной порции JSON-источника.
 *
 * Карьерные API почти все отдают вакансии порциями, и без этого источник
 * приносил бы только первую: у Сбера это 50 вакансий из 1795, у Ростелекома
 * 20 из 382. Раньше листать было нечем — `career.php` умел лишь разметку
 * JobPosting, и разбор JSON, уже написанный рядом, никуда не был подключён.
 *
 * $paging описывает, как источник просит следующую порцию:
 *   type=offset — `?limit=100&offset=200` (Сбер зовёт их take/skip, поэтому
 *                 имена параметров настраиваются);
 *   type=page   — `?page=3`, начиная с `start` (у кого-то 0, у кого-то 1).
 * Пустой $paging — источник отдаёт всё разом, порция ровно одна.
 */
function cf_page_url(string $url, array $paging, int $sub): string
{
    $type = (string)($paging['type'] ?? '');
    if ($type === '' || $sub === 0 && $type === 'none') return $url;

    $limit = max(1, (int)($paging['limit'] ?? 100));
    $parts = parse_url($url);
    if (!is_array($parts) || !isset($parts['host'])) return $url;
    parse_str((string)($parts['query'] ?? ''), $query);

    if ($type === 'offset') {
        $query[(string)($paging['limit_param'] ?? 'limit')] = $limit;
        $query[(string)($paging['param'] ?? 'offset')] = $sub * $limit;
    } elseif ($type === 'page') {
        $query[(string)($paging['param'] ?? 'page')] = (int)($paging['start'] ?? 1) + $sub;
        if (!empty($paging['limit_param'])) $query[(string)$paging['limit_param']] = $limit;
    } elseif ($type === 'cursor_b64') {
        // Курсор — base64 от «o=смещение&p=страница» (Яндекс). Их поле next
        // ведёт на внутренний хост, поэтому курсор собираем сами.
        if (!empty($paging['limit_param'])) $query[(string)$paging['limit_param']] = $limit;
        if ($sub > 0) {
            $cursor = strtr((string)($paging['template'] ?? 'o={offset}&p={page}'),
                ['{offset}' => (string)($sub * $limit), '{page}' => (string)($sub + 1)]);
            $query[(string)($paging['param'] ?? 'cursor')] = base64_encode($cursor);
        }
    } else {
        return $url;
    }

    $rebuilt = $parts['scheme'] . '://' . $parts['host']
        . (isset($parts['port']) ? ':' . $parts['port'] : '')
        . ($parts['path'] ?? '');
    $q = http_build_query($query);
    return $q === '' ? $rebuilt : $rebuilt . '?' . $q;
}

/**
 * Брать ли следующую порцию у того же источника.
 *
 * Признак «порция полная» надёжнее счётчика total: total присылают не все, а
 * врут в нём многие. Предел страниц обязателен — иначе сломанный источник,
 * отдающий одно и то же, крутил бы обход вечно.
 */
function cf_has_next_sub(int $got, array $paging, int $sub): bool
{
    // $got — число СЫРЫХ записей в ответе, а не принятых нами. Разница
    // принципиальная: у Wildberries сервер отдаёт 50 записей, из них после
    // отсева (нет должности, вакансия закрыта, нет ссылки) остаётся 31. По
    // принятым обход решил бы, что порция неполная, и остановился бы на первой
    // полусотне из 97. Замерено, а не предположено.
    if ((string)($paging['type'] ?? '') === '') return false;
    $limit = max(1, (int)($paging['limit'] ?? 100));
    $maxPages = max(1, (int)($paging['max_pages'] ?? 20));
    return $got >= $limit && $sub + 1 < $maxPages;
}

/**
 * Слова-пустышки: ссылка есть, а должности в ней нет.
 *
 * Собраны с живых страниц, а не придуманы: «Подробнее» у Протея и ДатаРу,
 * «Показать все (10)» у Иви, «Санкт-Петербург» у СИБУРа. Без этого списка
 * лента наполнилась бы карточками «Подробнее», и это было бы хуже пустой.
 */
/** Слова, которые сами по себе являются разделом, а не вакансией. */
const CF_SECTION_WORDS = ['vacancy', 'vacancies', 'job', 'jobs', 'vakansii',
    'search', 'all', 'list', 'index'];

const CF_LINK_NOISE = [
    'подробнее', 'показать', 'смотреть', 'все вакансии', 'все города',
    'все направления', 'ещё', 'еще', 'открыть', 'откликнуться', 'узнать',
    'читать', 'подать заявку', 'вакансии', 'вакансия', 'перейти', 'далее',
    'назад', 'поиск', 'найти', 'кандидатам', 'наши вакансии', 'работа в',
    'как мы нанимаем', 'согласие', 'политика', 'linkedin', 'telegram',
    'подписаться', 'карьера', 'все предложения',
    // Найдено сплошной проверкой на проде: «Рекомендовать друга» у Контура,
    // «Разработчикам» у iSpring — ссылки на разделы, а не вакансии.
    'рекомендовать', 'разработчикам', 'студентам', 'выпускникам', 'стажировк',
];

/** Счётчик вместо должности: «2 вакансии», «17 вакансий» — так у IBS. */
const CF_COUNT_LABEL = '~^\d+\s+ваканс~ui';

/**
 * Вакансии, выложенные на странице обычными ссылками.
 *
 * Третий вид источника рядом с разметкой JobPosting и JSON API. Замерено по
 * 111 карьерным сайтам: разметки JobPosting нет почти ни у кого (2 сайта),
 * JSON отдают немногие, а вот список ссылок вида `/vacancy/...` с названием
 * должности внутри лежит в разметке у 24 компаний. Это самый крупный кусок,
 * который берётся без браузера.
 *
 * $map:
 *   link_path  — что должно быть в адресе ссылки («/vacancy/»), обязательно;
 *   min_title  — короче скольких букв текст за должность не считаем (8);
 *   company    — постоянное название компании, если на странице его нет.
 */
/**
 * Разбор чужой разметки. Она почти всегда кривая, поэтому разбираем молча:
 * выводить чужие ошибки в наш ответ незачем.
 */
function cf_dom(string $html): ?DOMDocument
{
    if (trim($html) === '') return null;
    $doc = new DOMDocument();
    $prev = libxml_use_internal_errors(true);
    $ok = $doc->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_use_internal_errors($prev);
    return $ok ? $doc : null;
}

function cf_html_links(string $html, string $pageUrl, array $map, int $now): array
{
    $needle = trim((string)($map['link_path'] ?? ''));
    if ($needle === '') return [];
    $minTitle = max(3, (int)($map['min_title'] ?? 8));
    $linkRegex = trim((string)($map['link_regex'] ?? ''));

    $doc = cf_dom($html);
    if ($doc === null) return [];

    $items = [];
    $seen = [];
    foreach ($doc->getElementsByTagName('a') as $a) {
        if (count($items) >= 500) break;
        $href = trim($a->getAttribute('href'));
        if ($href === '' || !str_contains($href, $needle)) continue;
        // Не каждый хвост после общего префикса является вакансией. Например,
        // у Петровича и категории, и карточки живут под /vakancies/. Для
        // таких сайтов настройка может задать безопасный regex по пути.
        // Ошибочный regex работает fail-closed: лучше ноль вакансий, чем разделы
        // каталога в пользовательской ленте.
        $hrefPath = (string)(parse_url($href, PHP_URL_PATH) ?: '');
        if ($linkRegex !== '' && @preg_match($linkRegex, $hrefPath) !== 1) continue;

        // Ссылка должна вести на КОНКРЕТНУЮ вакансию, а не на сам список.
        // Без этого в ленту лезли «Все вакансии», «Все города», «Кандидатам» —
        // ссылки на разделы, у которых после `/vacancy/` ничего нет. Замерено
        // на живых страницах СИБУРа, МегаФона и Контура.
        $tail = substr($href, strpos($href, $needle) + strlen($needle));
        $tail = trim(explode('?', explode('#', $tail)[0])[0], '/');
        if ($tail === '') continue;
        // Хвост, который сам является названием раздела, — не вакансия.
        // У Яндекса все 68 «вакансий» оказались ссылками вида
        // /jobs/vacancies?profession=backend: это фильтры каталога, а
        // заголовком шло «Разработка», «Аналитика». Проверено на проде.
        if (in_array(mb_strtolower($tail), CF_SECTION_WORDS, true)) continue;

        $title = cf_link_title($a);
        if (mb_strlen($title) < $minTitle) continue;
        if (preg_match(CF_COUNT_LABEL, $title)) continue;
        $lower = mb_strtolower($title);
        foreach (CF_LINK_NOISE as $noise) {
            if (str_starts_with($lower, $noise)) { $title = ''; break; }
        }
        if ($title === '') continue;

        $url = cf_json_url(['href' => $href], ['url' => 'href'], $pageUrl);
        if ($url === '') continue;
        // Одна вакансия часто висит двумя ссылками — с картинки и с заголовка.
        if (isset($seen[$url])) continue;
        $seen[$url] = true;

        $items[] = [
            'id' => substr(hash('sha256', $url), 0, 24),
            'title' => $title,
            'kind' => 'permanent',
            'url' => $url,
            'company' => (string)($map['company_const'] ?? $map['company'] ?? '') ?: null,
            'active' => true,
            'seen_at' => $now,
        ];
    }
    return $items;
}

/**
 * Название должности из ссылки.
 *
 * Голый textContent склеивает вложенные элементы без пробелов: у VK выходило
 * «Бизнес-ассистентДзенМосква», у Иви — «ClickhouseFlinkJavaKafkapython
 * Java-разработчик», где перед должностью слиплись метки технологий. Поэтому
 * сначала ищем внутри ссылки заголовок — h1..h6 или элемент с «title»/«name»
 * в классе, — и только если его нет, берём весь текст, расставляя пробелы на
 * границах элементов.
 */
function cf_link_title(DOMElement $a): string
{
    $clean = fn(string $t): string => trim(preg_replace('/\s+/u', ' ', $t));

    foreach (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as $tag) {
        foreach ($a->getElementsByTagName($tag) as $h) {
            $text = $clean($h->textContent ?? '');
            if ($text !== '') return $text;
        }
    }
    foreach ($a->getElementsByTagName('*') as $el) {
        $class = strtolower($el->getAttribute('class'));
        if ($class !== '' && (str_contains($class, 'title') || str_contains($class, 'name'))) {
            $text = $clean($el->textContent ?? '');
            if ($text !== '') return $text;
        }
    }
    // Запасной ход: весь текст ссылки, но с пробелом на каждой границе узла.
    $parts = [];
    $walk = function (DOMNode $node) use (&$walk, &$parts): void {
        foreach ($node->childNodes ?? [] as $child) {
            if ($child->nodeType === XML_TEXT_NODE) $parts[] = $child->nodeValue;
            else $walk($child);
        }
    };
    $walk($a);
    return $clean(implode(' ', $parts));
}

/**
 * Состояние страницы, встроенное в разметку.
 *
 * Next.js кладёт данные в <script id="__NEXT_DATA__">, Nuxt — в
 * window.__NUXT__. Для нас это тот же JSON, только приехавший внутри HTML:
 * дальше его разбирает cf_json_items, как и обычный ответ API.
 *
 * Так читаются VK (25 вакансий), ВТБ (20), Островок, Кофемания, Хоулмонт,
 * Twinby — у них никакого отдельного запроса за вакансиями нет вовсе, всё
 * приезжает первой же страницей.
 */
function cf_embedded_state(string $html): ?array
{
    if (preg_match('~<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>~s', $html, $m)) {
        $data = json_decode(trim($m[1]), true);
        if (is_array($data)) return $data;
    }
    foreach (['__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__'] as $key) {
        // Значение читаем до конца строки-скрипта: дальше в теле бывает всё
        // что угодно, и жадный разбор утащил бы половину страницы.
        if (preg_match('~window\.' . $key . '\s*=\s*(\{.*?\})\s*;?\s*</script>~s', $html, $m)) {
            $data = json_decode($m[1], true);
            if (is_array($data)) return $data;
        }
    }
    return null;
}

/**
 * Куда идти после текущей порции — и что делать с упавшим адресом.
 *
 * Отдельной функцией, потому что здесь была главная поломка всего раздела
 * «Работа». ingest.php на ошибочный ответ прекращает заход ЦЕЛИКОМ и оставляет
 * в контрольной точке тот самый адрес, на котором споткнулся. Контрольная точка
 * стирается только после полного успешного обхода. Значит одна недоступная
 * страница работодателя вставала намертво: следующий заход упирался в неё же,
 * и так до бесконечности. Тридцать три компании стояли из-за одной — на проде
 * обход умирал на самом первом адресе, а вакансии в ленте были те, что успели
 * записаться до этого.
 *
 * Поэтому упавший адрес — не ошибка обхода, а пропуск: переходим к следующей
 * компании. Порции текущей не дочитываем: раз адрес не отвечает, следующая
 * порция того же адреса не ответит тем более.
 *
 * Возвращает ['page' => …, 'sub' => …] или null, если обход закончен.
 */
function cf_next_step(int $page, int $sub, int $units, bool $more, bool $failed): ?array
{
    if ($failed) $more = false;
    if ($more) return ['page' => $page, 'sub' => $sub + 1];
    if ($page + 1 < $units) return ['page' => $page + 1, 'sub' => 0];
    return null;
}

/**
 * Описание вакансии с её собственной страницы.
 *
 * Зачем. Список вакансий почти нигде не содержит описания: у страниц со
 * ссылками (`html_links`) его нет вовсе, а API отдают короткую карточку — у
 * МТС поле description в списке есть, но пустое у всех двадцати пяти. Поэтому
 * в ленте стояло «Источник не прислал описания», хотя на сайте текст есть.
 * Считано по проду: описания НЕ было у 725 вакансий из 1583.
 *
 * Берём первое, что нашлось, в порядке убывания надёжности:
 *   1. schema.org/JobPosting — размеченное описание, ровно то, что нужно;
 *   2. meta description и og:description — их пишут под выдачу поисковика,
 *      то есть человеку, а не роботу;
 *   3. самый длинный кусок текста страницы — запасной путь для вёрстки без
 *      разметки вовсе.
 *
 * Возвращает пустую строку, если ничего осмысленного не нашлось: короткий
 * обрывок хуже честного «описания нет».
 */
function cf_page_description(string $html): string
{
    $clean = static function (string $s): string {
        $s = preg_replace('/\s+/u', ' ', strip_tags(html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        return trim((string)$s);
    };

    // 1. Размеченное описание вакансии.
    foreach (cf_job_postings($html) as $posting) {
        $text = $clean((string)($posting['description'] ?? ''));
        if (mb_strlen($text) >= 80) return mb_substr($text, 0, 2000);
    }

    // 2. Описание для поисковой выдачи.
    if (preg_match_all('~<meta[^>]+>~i', $html, $tags)) {
        foreach ($tags[0] as $tag) {
            if (!preg_match('~(?:name|property)\s*=\s*["\']?(?:og:)?description["\']?~i', $tag)) continue;
            if (!preg_match('~content\s*=\s*"([^"]*)"~i', $tag, $m)
                && !preg_match("~content\\s*=\\s*'([^']*)'~i", $tag, $m)) continue;
            $text = $clean($m[1]);
            if (mb_strlen($text) >= 80) return mb_substr($text, 0, 2000);
        }
    }

    // 3. Самый длинный кусок текста. Путь запасной и самый опасный: на первом
    // же замере по 23 работодателям он принёс у BSL политику конфиденциальности,
    // а у kokos group — форму отклика («Прикрепить резюме»). Поэтому здесь два
    // ограничения, и оба взяты из этого замера.
    $doc = cf_dom($html);
    if ($doc === null) return '';
    $xp = new DOMXPath($doc);
    // Меню, подвал и формы на карьерной странице длиннее самой вакансии.
    foreach ($xp->query('//script|//style|//nav|//header|//footer|//noscript|//form') as $node) {
        $node->parentNode?->removeChild($node);
    }
    $longest = static function (string $query) use ($xp, $clean): string {
        $best = '';
        foreach ($xp->query($query) as $node) {
            $text = $clean($node->textContent);
            if (mb_strlen($text) > mb_strlen($best)) $best = $text;
        }
        return $best;
    };
    // Сначала смысловые контейнеры: любой div утащил бы обёртку всей страницы
    // вместе с меню. Но у части сайтов их нет вовсе — у Just AI ни одного
    // main/article/section на 71 div. Для таких страниц берём div, иначе
    // описание теряется на ровном месте.
    $best = $longest('//main|//article|//section');
    if (mb_strlen($best) < 200) $best = $longest('//div');
    if (mb_strlen($best) < 200) return '';
    // Текст про обработку данных и про отклик — не описание вакансии. Человеку
    // такое показывать хуже, чем честное «описания нет».
    if (preg_match('~политик\w* (?:конфиденциальн|обработк)|согласи\w* на обработку|'
        . 'прикрепить резюме|файл\w* cookie~ui', $best)) return '';
    return mb_substr($best, 0, 2000);
}
