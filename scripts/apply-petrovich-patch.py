from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:80]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'anchor not unique in {path}: {text.count(old)} matches')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# HTML-каталоги часто имеют общий префикс и для разделов, и для конкретных
# вакансий. link_regex позволяет настройке источника отсеять категории, не
# добавляя очередной парсер под конкретного работодателя.
replace_once(
    'php-proxy/career_feed.php',
    "    $minTitle = max(3, (int)($map['min_title'] ?? 8));\n\n    $doc = cf_dom($html);",
    "    $minTitle = max(3, (int)($map['min_title'] ?? 8));\n"
    "    $linkRegex = trim((string)($map['link_regex'] ?? ''));\n\n"
    "    $doc = cf_dom($html);",
)
replace_once(
    'php-proxy/career_feed.php',
    "        $href = trim($a->getAttribute('href'));\n"
    "        if ($href === '' || !str_contains($href, $needle)) continue;\n\n",
    "        $href = trim($a->getAttribute('href'));\n"
    "        if ($href === '' || !str_contains($href, $needle)) continue;\n"
    "        // Не каждый хвост после общего префикса является вакансией. Например,\n"
    "        // у Петровича и категории, и карточки живут под /vakancies/. Для\n"
    "        // таких сайтов настройка может задать безопасный regex по пути.\n"
    "        // Ошибочный regex работает fail-closed: лучше ноль вакансий, чем разделы\n"
    "        // каталога в пользовательской ленте.\n"
    "        $hrefPath = (string)(parse_url($href, PHP_URL_PATH) ?: '');\n"
    "        if ($linkRegex !== '' && @preg_match($linkRegex, $hrefPath) !== 1) continue;\n\n",
)

# Регрессия на реальную структуру petrovichjob.ru: категории рядом с карточками.
needle = "check('без link_path ничего не разбираем',\n    cf_html_links($linkPage([['/vacancy/1', 'Комплектовщик']]), $base, [], $now) === []);\n"
insert = needle + "\n// У Петровича категории и карточки имеют общий /vakancies/. Один link_path\n// поэтому недостаточен: /vakancies/contact-center/ — раздел, а\n// /vakancies/58249/ — конкретная вакансия. link_regex оставляет только ID.\n$petrovich = cf_html_links($linkPage([\n    ['/vakancies/contact-center/', 'Работа в контакт-центре'],\n    ['/vakancies/58249/', 'Комплектовщик ночь'],\n    ['/vakancies/54328/', 'Комплектовщик товаров'],\n]), 'https://petrovichjob.ru/vakancies/', [\n    'link_path' => '/vakancies/',\n    'link_regex' => '~^/vakancies/[0-9]+/?$~',\n    'company_const' => 'Петрович',\n    'min_title' => 8,\n], $now);\ncheck('regex ссылки отбрасывает раздел Петровича', count($petrovich) === 2);\ncheck('regex ссылки оставляет карточку Петровича',\n    $petrovich[0]['url'] === 'https://petrovichjob.ru/vakancies/58249/'\n    && $petrovich[0]['company'] === 'Петрович');\n"
replace_once('tests/career_feed_test.php', needle, insert)

# Список для браузерной разведки должен начинаться с реального каталога, а не
# главной страницы. owner-list поддерживаем синхронно, чтобы два перечня не
# разъехались при будущих проверках.
for path in ['scripts/career-sites.tsv', 'scripts/owner-career-sites.tsv']:
    replace_once(path, 'Петрович\thttps://petrovichjob.ru\n',
                 'Петрович\thttps://petrovichjob.ru/vakancies/\n')

print('Petrovich patch applied')
