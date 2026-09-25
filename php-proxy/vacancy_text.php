<?php
// Полное описание вакансии со страницы, со структурой — не анонс под поисковик.
//
// cf_page_description (career_feed.php) отдаёт короткий текст: он склеивает всё
// в одну строку и в третью очередь берёт meta description. Работодателю это
// стоило дорого — у Сбера и Магнита в ленте оставался обрубок вместо описания,
// у METRO в карточке шла реклама сайта («Все вакансии сети магазинов METRO»),
// у Performance Lab текст обрывался на середине. Здесь — отдельный разбор,
// который берёт описание целиком и сохраняет его деление на разделы.
//
// Только чистые функции — ни сети, ни базы, ни вывода. Сеть в career.php.

require_once __DIR__ . '/career_feed.php';

/** Поля вакансии, которые встречаются в __NEXT_DATA__/__NUXT__, по разделам. */
const VT_FIELDS_INTRO = ['introduction', 'description', 'about'];
const VT_FIELDS_DUTIES = ['duties', 'responsibilities', 'responsibility', 'tasks', 'obligations'];
const VT_FIELDS_REQUIREMENTS = ['requirements', 'experience', 'qualifications', 'skills'];
const VT_FIELDS_CONDITIONS = ['conditions', 'offer', 'benefits', 'weOffer', 'incentiveCompensation'];

/** Заголовки разделов JobPosting, для полей вне description. */
const VT_JOBPOSTING_SECTIONS = [
    'responsibilities' => 'Обязанности',
    'qualifications' => 'Требования',
    'experienceRequirements' => 'Требования',
    'jobBenefits' => 'Условия',
    'incentiveCompensation' => 'Условия',
];

/** Заголовки для раздела __NEXT_DATA__/__NUXT__, разделы без записи — без заголовка. */
const VT_STATE_SECTIONS = [
    'duties' => 'Обязанности',
    'requirements' => 'Требования',
    'conditions' => 'Условия',
];

/** Заголовки страницы, которые ищем в вёрстке без структурированных данных. */
const VT_HEADING_WORDS = '~обязанност|задачи|что (нужно|предстоит|будете) делать|чем (вы )?будете заниматься|требовани|ожидаем|мы ждём|мы ждем|условия|мы предлагаем|что мы предлагаем|предлагаем~iu';

/**
 * HTML → «лёгкий markdown»: заголовки, списки, абзацы, без остальной разметки.
 *
 * Строчный/блочный мусор вокруг структуры не несёт смысла — только вёрстку
 * source-файла (отступы, переносы). Настоящие переносы (заголовки, списки,
 * абзацы, <br>) метим служебными байтами \x01, которых в человеческом тексте
 * не бывает, — так собственные метки не путаются со «случайными» пробелами
 * исходника, и их можно схлопнуть одним общим правилом.
 */
function vt_html_to_text(string $html): string
{
    // Скрипты и стили — не для человека, убираем целиком.
    $html = preg_replace('~<(script|style)\b[^>]*>.*?</\1>~is', '', $html) ?? $html;

    $decodeInline = static function (string $s): string {
        $s = strip_tags($s);
        $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $s = str_replace("\xC2\xA0", ' ', $s); // &nbsp; после decode — неразрывный пробел
        return trim(preg_replace('/\s+/u', ' ', $s) ?? $s);
    };

    // 1. Голый <b>/<strong>, за которым сразу идёт <br> или список, — это
    // заголовок раздела без обёртки в <p>/<div>: так Магнит размечает «Чем вы
    // будете заниматься» перед <ul>. Признак заголовка тут не текст, а место —
    // перед списком, — поэтому условие на длину и двоеточие не нужно.
    // `\b` после имени тега обязателен: без него «<b>» ловит и «<br>» —
    // «b» совпадает, а «[^>]*» съедает «r» как будто это атрибуты.
    $html = preg_replace_callback(
        '~<(?:strong|b)\b[^>]*>(.*?)</(?:strong|b)>\s*(?=<br\b|<u[lo]\b)~is',
        static function (array $m) use ($decodeInline): string {
            $text = rtrim($decodeInline($m[1]), ": \t");
            return $text === '' ? '' : "\x01H\x01{$text}\x01/H\x01";
        },
        $html
    ) ?? $html;

    // 2. Короткий абзац из одного лишь <b>/<strong> — тоже подзаголовок
    // раздела, но не любой: «Такси … за счёт компании;» из списка условий
    // METRO жирный, однако это пункт, а не заголовок. Заголовком считаем
    // только то, что явно им выглядит: кончается двоеточием (любой длины) —
    // или короткое (≤40 символов) и не обрывается на «;», «,», «.», как
    // обычная фраза, а не рубленый подзаголовок.
    $html = preg_replace_callback(
        '~<(p|div)\b[^>]*>\s*<(?:strong|b)\b[^>]*>(.*?)</(?:strong|b)>\s*</\1>~is',
        static function (array $m) use ($decodeInline): string {
            $raw = $decodeInline($m[2]);
            $isHeading = $raw !== '' && (
                str_ends_with($raw, ':')
                || (mb_strlen($raw) <= 40 && !preg_match('/[;,.]$/u', $raw))
            );
            if (!$isHeading) return $m[0];
            $text = rtrim($raw, ": \t");
            return "\x01H\x01{$text}\x01/H\x01";
        },
        $html
    ) ?? $html;

    // 3. Настоящие заголовки.
    $html = preg_replace_callback(
        '~<h[1-6]\b[^>]*>(.*?)</h[1-6]>~is',
        static function (array $m) use ($decodeInline): string {
            $text = rtrim($decodeInline($m[1]), ": \t");
            return $text === '' ? '' : "\x01H\x01{$text}\x01/H\x01";
        },
        $html
    ) ?? $html;

    // 4. Пункты списка. Без закрывающей метки — следующий </li> или заголовок
    // сам поставит перенос, лишняя пустая строка между пунктами не нужна.
    $html = preg_replace_callback(
        '~<li\b[^>]*>(.*?)</li>~is',
        static function (array $m) use ($decodeInline): string {
            $text = $decodeInline($m[1]);
            return $text === '' ? '' : "\x01B\x01{$text}";
        },
        $html
    ) ?? $html;

    // 5. Остальные переносы: <br> — одиночный, <p>/<div> — граница абзаца.
    // Ровно эта метка на месте каждого /p и /div гарантирует перенос строки
    // между соседними блоками — даже там, где после </li> сразу идёт голый
    // текст без какого-либо тега.
    $html = preg_replace('~<br\b\s*/?>~i', "\x01L\x01", $html) ?? $html;
    $html = preg_replace('~</?(?:p|div)\b[^>]*>~i', "\x01P\x01", $html) ?? $html;

    // 6. Остальные теги и сущности структуры не несут — долой.
    $text = strip_tags($html);
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = str_replace("\xC2\xA0", ' ', $text);

    // 7. Любой «сырой» пробел (включая переносы вёрстки исходника) — один
    // пробел: переносы, которые нужны нам, защищены метками выше.
    $text = preg_replace('/[ \t\r\n]+/', ' ', $text) ?? $text;

    $text = str_replace(
        ["\x01H\x01", "\x01/H\x01", "\x01B\x01", "\x01L\x01", "\x01P\x01"],
        ["\n\n## ", "\n\n", "\n• ", "\n", "\n\n"],
        $text
    );

    $text = preg_replace('/[ \t]+\n/', "\n", $text) ?? $text;
    $text = preg_replace('/\n[ \t]+/', "\n", $text) ?? $text;
    $text = preg_replace('/\n{3,}/', "\n\n", $text) ?? $text;
    $text = trim($text);

    // 8. Подряд идущие абзацы-пункты «…;» — это список без <ul>, как у METRO
    // («Работа на кассе и прикассовой зоне;» и т.п.). Последний пункт может
    // не иметь «;» вовсе.
    return vt_group_semicolon_paragraphs($text);
}

/**
 * Абзацы вида «…;» подряд — на деле список, просто без <ul>/<li>: некоторые
 * карьерные сайты (METRO) кладут каждый пункт своим <p>. Берём блоки, в
 * которых каждый, кроме последнего, кончается «;», последний может кончаться
 * чем угодно коротким, — и сшиваем их в один список без пустых строк.
 */
function vt_group_semicolon_paragraphs(string $text): string
{
    $blocks = $text === '' ? [] : explode("\n\n", $text);
    $isPlainShort = static function (string $b): bool {
        return !str_contains($b, "\n") && mb_strlen($b) <= 200
            && !str_starts_with($b, '## ') && !str_starts_with($b, '• ');
    };

    $out = [];
    $n = count($blocks);
    $i = 0;
    while ($i < $n) {
        $j = $i;
        while ($j < $n && $isPlainShort($blocks[$j]) && str_ends_with(rtrim($blocks[$j]), ';')) {
            $j++;
        }
        $chainLen = $j - $i;
        $hasCloser = $j < $n && $isPlainShort($blocks[$j]);
        $total = $chainLen + ($hasCloser ? 1 : 0);

        if ($total >= 2) {
            $end = $hasCloser ? $j : $j - 1;
            $items = [];
            for ($k = $i; $k <= $end; $k++) {
                $items[] = '• ' . trim(rtrim(rtrim($blocks[$k]), ';'));
            }
            $out[] = implode("\n", $items);
            $i = $end + 1;
            continue;
        }

        $out[] = $blocks[$i];
        $i++;
    }
    return implode("\n\n", $out);
}

/**
 * Markdown, который источник уже отдаёт как markdown (Сбер), — к тому же виду,
 * что и vt_html_to_text: `## Заголовок`, `• пункт`, без `**`/`__`.
 */
function vt_markdown_normalize(string $md): string
{
    $md = str_replace("\r\n", "\n", $md);
    $md = str_replace("\xC2\xA0", ' ', $md); // неразрывный пробел — источники кладут его и в markdown

    // «### **Текст:**» → «## Текст» — уровень решётки и жирность не важны,
    // важно, что строка подана как заголовок раздела.
    $md = preg_replace_callback(
        '/^#{1,6}[ \t]*\*{0,2}[ \t]*(.+?)[ \t]*\*{0,2}[ \t]*$/mu',
        static function (array $m): string {
            $text = rtrim(trim($m[1]), ": ");
            return $text === '' ? '' : "## {$text}";
        },
        $md
    ) ?? $md;

    // Пункты списка: маркер `*` или `-`, с любым числом пробелов после.
    $md = preg_replace('/^[ \t]*[*\-][ \t]+/mu', '• ', $md) ?? $md;

    // Жирность/курсив, которые остались вне заголовков и списков.
    $md = preg_replace('/\*\*(.+?)\*\*/su', '$1', $md) ?? $md;
    $md = preg_replace('/__(.+?)__/su', '$1', $md) ?? $md;

    $md = preg_replace('/[ \t]+\n/', "\n", $md) ?? $md;
    $md = preg_replace('/\n{3,}/', "\n\n", $md) ?? $md;

    return trim($md);
}

/** Похоже на HTML: строку с тегами разбираем как HTML, остальное — как markdown. */
function vt_to_text(string $value): string
{
    return preg_match('~<[a-z][\s\S]*>~i', $value) ? vt_html_to_text($value) : vt_markdown_normalize($value);
}

/** Раздел с заголовком, если текст сам ещё не начинается со своего заголовка. */
function vt_section(string $heading, string $text): string
{
    if ($text === '') return '';
    return str_starts_with(ltrim($text), '## ') ? $text : "## {$heading}\n\n{$text}";
}

/** Тело раздела без собственной строки-заголовка — для сравнения на повтор. */
function vt_section_body(string $text): string
{
    return preg_replace('/^## [^\n]*\n\n?/u', '', $text) ?? $text;
}

/**
 * Раздел, если он не повторяет то, что уже собрано. Источники размечают одно
 * и то же описание в нескольких полях сразу (description и responsibilities
 * дословно совпадают) — добавлять такой раздел значит показывать один и тот
 * же текст дважды.
 */
function vt_add_section(array &$parts, string $heading, string $text): void
{
    $section = vt_section($heading, $text);
    if ($section === '') return;
    $body = trim(vt_section_body($section));
    if ($body !== '' && str_contains(implode("\n\n", $parts), $body)) return;
    $parts[] = $section;
}

/** a. Описание из JSON-LD JobPosting: основной текст плюс отдельные разделы. */
function vt_extract_job_posting(string $html): string
{
    foreach (cf_job_postings($html) as $posting) {
        $main = vt_to_text((string)($posting['description'] ?? ''));
        if (mb_strlen($main) < 120) continue;

        $parts = [$main];
        foreach (VT_JOBPOSTING_SECTIONS as $field => $heading) {
            $value = (string)($posting[$field] ?? '');
            if (trim($value) === '') continue;
            vt_add_section($parts, $heading, vt_to_text($value));
        }
        return implode("\n\n", $parts);
    }
    return '';
}

/**
 * Объект вакансии внутри __NEXT_DATA__/__NUXT__: узел, у которого есть хотя бы
 * два поля из описательного набора. Обходим в глубину — обёртки вида props →
 * pageProps сами по себе такими полями не обладают, а вложенный объект
 * вакансии обладает.
 */
function vt_find_state_vacancy($node, int $depth = 0)
{
    if ($depth > 12 || !is_array($node)) return null;
    if (!array_is_list($node)) {
        $fields = array_merge(VT_FIELDS_INTRO, VT_FIELDS_DUTIES, VT_FIELDS_REQUIREMENTS, VT_FIELDS_CONDITIONS);
        $hit = 0;
        foreach ($fields as $f) {
            if (is_string($node[$f] ?? null) && trim($node[$f]) !== '') $hit++;
        }
        if ($hit >= 2) return $node;
    }
    foreach ($node as $child) {
        if (is_array($child)) {
            $found = vt_find_state_vacancy($child, $depth + 1);
            if ($found !== null) return $found;
        }
    }
    return null;
}

/** Первое непустое строковое поле из списка альтернативных имён. */
function vt_first_field(array $node, array $names): string
{
    foreach ($names as $name) {
        $value = $node[$name] ?? null;
        if (is_string($value) && trim($value) !== '') return $value;
    }
    return '';
}

/** b. Описание из __NEXT_DATA__/__NUXT__: вступление + разделы по полям. */
function vt_extract_embedded_state(string $html): string
{
    $state = cf_embedded_state($html);
    if ($state === null) return '';
    $vacancy = vt_find_state_vacancy($state);
    if ($vacancy === null) return '';

    $intro = vt_first_field($vacancy, VT_FIELDS_INTRO);
    $parts = [];
    if ($intro !== '') $parts[] = vt_to_text($intro);

    foreach ([
        [VT_FIELDS_DUTIES, VT_STATE_SECTIONS['duties']],
        [VT_FIELDS_REQUIREMENTS, VT_STATE_SECTIONS['requirements']],
        [VT_FIELDS_CONDITIONS, VT_STATE_SECTIONS['conditions']],
    ] as [$names, $heading]) {
        $value = vt_first_field($vacancy, $names);
        if ($value === '') continue;
        vt_add_section($parts, $heading, vt_to_text($value));
    }

    $text = trim(implode("\n\n", array_filter($parts, static fn($p) => $p !== '')));
    return mb_strlen($text) >= 120 ? $text : '';
}

/** Узел содержит другой узел (проверка по цепочке родителей). */
function vt_contains(DOMNode $ancestor, DOMNode $node): bool
{
    while ($node !== null) {
        if ($node === $ancestor) return true;
        $node = $node->parentNode;
    }
    return false;
}

/** Наименьший общий предок как минимум двух узлов из списка. */
function vt_common_container(array $nodes): ?DOMElement
{
    if (count($nodes) < 2) return null;
    $ancestor = $nodes[0]->parentNode;
    while ($ancestor instanceof DOMElement) {
        $hits = 0;
        foreach ($nodes as $n) {
            if (vt_contains($ancestor, $n)) $hits++;
        }
        if ($hits >= 2) return $ancestor;
        $ancestor = $ancestor->parentNode;
    }
    return null;
}

/**
 * c. HTML-страница без структурированных данных: находим заголовки разделов
 * («Обязанности», «Требования» и т.п.), берём наименьший общий контейнер и
 * выкидываем из него вёрстку, которая не про вакансию (меню, форму отклика).
 */
function vt_extract_plain_html(string $html): string
{
    $doc = cf_dom($html);
    if ($doc === null) return '';
    $xp = new DOMXPath($doc);

    $headings = [];
    foreach ($xp->query('//h1|//h2|//h3|//h4|//strong|//b') as $node) {
        $text = trim(preg_replace('/\s+/u', ' ', $node->textContent ?? '') ?? '');
        if ($text !== '' && mb_strlen($text) <= 80 && preg_match(VT_HEADING_WORDS, $text)) {
            $headings[] = $node;
        }
    }

    $container = vt_common_container($headings);
    if ($container === null) return '';

    foreach ($xp->query('.//script|.//style|.//nav|.//header|.//footer|.//form|.//button', $container) as $node) {
        $node->parentNode?->removeChild($node);
    }

    $text = vt_html_to_text($container->ownerDocument->saveHTML($container) ?: '');
    return mb_strlen($text) >= 120 ? $text : '';
}

/**
 * Убирает подряд идущие повторы одного и того же блока. Блок — заголовок и
 * всё, что идёт до следующего заголовка (для текста до первого заголовка или
 * вовсе без заголовков — до ближайшей пустой строки). Источники размечают
 * вакансию криво и склеивают её описание с самим собой (Магнит — четыре раза
 * подряд один и тот же блок «Чем вы будете заниматься» со списком).
 */
function vt_dedupe_blocks(string $text): string
{
    if ($text === '') return '';
    $chunks = preg_split('/(?=^## )/mu', $text) ?: [$text];

    $out = [];
    $prev = null;
    foreach ($chunks as $chunk) {
        // Заголовочные блоки сравниваем целиком; то, что идёт до первого
        // заголовка, дробим по пустым строкам — иначе одна общая «шапка»
        // склеит с собой все повторы разом и ничего не уберёт.
        $pieces = str_starts_with($chunk, '## ') ? [$chunk] : explode("\n\n", $chunk);
        foreach ($pieces as $piece) {
            $norm = trim($piece);
            if ($norm === '') continue;
            if ($norm === $prev) continue;
            $out[] = $norm;
            $prev = $norm;
        }
    }
    $result = preg_replace('/\n{3,}/', "\n\n", implode("\n\n", $out)) ?? implode("\n\n", $out);
    return trim($result);
}

/** Ограничить текст 12000 символами по границе строки, без обрыва слова. */
function vt_cap(string $text, int $limit = 12000): string
{
    if (mb_strlen($text) <= $limit) return $text;
    $cut = mb_substr($text, 0, $limit);
    $lastBreak = mb_strrpos($cut, "\n");
    if ($lastBreak !== false) $cut = mb_substr($cut, 0, $lastBreak);
    return rtrim($cut);
}

/**
 * Полное описание вакансии со страницы, со структурой (заголовки разделов,
 * списки). В отличие от cf_page_description не берёт meta description: это
 * анонс под поисковик, а у METRO там прямо реклама карьерного сайта.
 */
function vt_extract(string $html): string
{
    foreach ([
        fn() => vt_extract_job_posting($html),
        fn() => vt_extract_embedded_state($html),
        fn() => vt_extract_plain_html($html),
    ] as $attempt) {
        $text = vt_dedupe_blocks($attempt());
        if (mb_strlen($text) >= 120) return vt_cap($text);
    }
    return '';
}
