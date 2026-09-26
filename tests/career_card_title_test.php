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

if ($failures) {
    echo "career card title: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "career card title: OK\n";
