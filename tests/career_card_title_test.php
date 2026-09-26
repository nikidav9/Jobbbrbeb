<?php
// Название вакансии из карточки рядом со ссылкой (map.title_from_card).
//
// Вёрстка «карточка-обёртка»: заголовок в <h3> рядом, а в самой ссылке —
// «Подробнее» или пустой оверлей. Так у IT_One, ДатаРу, Протея, iFellow, РДВ.
// Главный риск — взять заголовок СОСЕДНЕЙ карточки: проверяем и его.

require_once __DIR__ . '/../php-proxy/career_feed.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$html = <<<'HTML'
<html><body><div class="list">
  <div class="card"><h3 class="card__title">Java-разработчик</h3><p>Москва</p>
    <a href="/vacancies/java-dev/">Подробнее</a></div>
  <div class="card"><div class="head"><div class="vacancy-name">Системный аналитик</div></div>
    <div class="foot"><a href="/vacancies/analyst/"><span>Узнать подробнее</span></a></div></div>
  <div class="card"><h3>QA-инженер</h3><a href="/vacancies/qa/"></a></div>
  <a href="/vacancies/">Все вакансии</a>
</div></body></html>
HTML;

$map = ['link_path' => '/vacancies/', 'min_title' => 4, 'title_from_card' => true, 'company_const' => 'Тест'];
$items = cf_html_links($html, 'https://example.ru/vacancies/', $map, time());
$byUrl = [];
foreach ($items as $it) $byUrl[$it['url']] = $it['title'];

check('три вакансии, ссылка на весь список не вакансия', count($items) === 3);
check('заголовок h3 рядом со «Подробнее»', ($byUrl['https://example.ru/vacancies/java-dev/'] ?? '') === 'Java-разработчик');
check('заголовок по классу name в соседнем блоке', ($byUrl['https://example.ru/vacancies/analyst/'] ?? '') === 'Системный аналитик');
check('пустой оверлей — берём заголовок карточки', ($byUrl['https://example.ru/vacancies/qa/'] ?? '') === 'QA-инженер');

// Без настройки поведение прежнее: «Подробнее» — не должность, вакансий нет.
$plain = cf_html_links($html, 'https://example.ru/vacancies/', ['link_path' => '/vacancies/', 'min_title' => 4], time());
check('без title_from_card ничего не меняется', count($plain) === 0);

// Две ссылки на одну вакансию в карточке (картинка + кнопка) — это всё ещё
// одна карточка; а ссылка, у которой общий предок с ДРУГОЙ вакансией, не
// получает чужой заголовок.
$shared = <<<'HTML'
<div class="list"><h2>Горячие вакансии</h2>
  <a href="/vacancies/one/">Подробнее</a>
  <a href="/vacancies/two/">Подробнее</a>
</div>
HTML;
$x = cf_html_links($shared, 'https://example.ru/', $map, time());
check('общий заголовок списка не выдаётся за должность', count($x) === 0);

// Теги-фильтры внутри карточки (/job/vacancy/?tag=…) — ссылки на тот же
// список, а не на другую вакансию: карточка остаётся карточкой (Информзащита).
$tagged = <<<'HTML'
<div class="list">
  <div class="vacancy"><a class="vacancy__link" href="/job/vacancy/ib/engineer/"></a>
    <div class="vacancy__top"><h3>Системный инженер</h3></div>
    <div class="tags"><a href="/job/vacancy/?tag%5B0%5D=Dev">Департамент разработки</a></div></div>
  <div class="vacancy"><a class="vacancy__link" href="/job/vacancy/ib/architect/"></a>
    <div class="vacancy__top"><h3>Архитектор прикладных систем</h3></div>
    <div class="tags"><a href="/job/vacancy/?tag%5B0%5D=Dev">Департамент разработки</a></div></div>
</div>
HTML;
$t = cf_html_links($tagged, 'https://example.ru/job/vacancy/', ['link_path' => '/job/vacancy/', 'min_title' => 8, 'title_from_card' => true], time());
$tt = array_column($t, 'title');
check('карточка с тегами-фильтрами: обе вакансии со своими заголовками',
    $tt === ['Системный инженер', 'Архитектор прикладных систем']);

// Название в блоке, который запись источника называет сама (map.title_class):
// ссылка — пустой оверлей, заголовка h* и класса title/name нет (CINIMEX).
$named = <<<'HTML'
<div class="list">
  <div class="vacancy"><div class="vacancy__text">Инженер данных</div><div class="vacancy__city">Москва</div>
    <a class="stretched-link" href="/vacancies/moscow/data-engineer/"></a></div>
  <div class="vacancy"><div class="vacancy__text">Младший системный аналитик</div>
    <a class="stretched-link" href="/vacancies/moscow/analyst/"></a></div>
</div>
HTML;
$nm = ['link_path' => '/vacancies/moscow/', 'min_title' => 3, 'title_from_card' => true];
check('без title_class пустой оверлей без заголовка не даёт вакансий',
    count(cf_html_links($named, 'https://example.ru/', $nm, time())) === 0);
$n = cf_html_links($named, 'https://example.ru/', $nm + ['title_class' => 'vacancy__text'], time());
check('title_class: название из названного блока, а не город',
    array_column($n, 'title') === ['Инженер данных', 'Младший системный аналитик']);

if ($failures) {
    echo "career card title: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "career card title: OK\n";
