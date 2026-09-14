<?php
// Проверка того, что страница вакансии действительно отдаёт содержимое.
//
// Смысл всей затеи в том, чтобы в исходнике страницы был текст вакансии и
// разметка JobPosting. Проверять это глазами один раз бессмысленно: сломается
// молча и обнаружится через месяц по отсутствию трафика.
//
// База не нужна: доступ к ней подменяется заглушкой. sb_lite.php обёрнут в
// if (!function_exists('sb')), поэтому объявленные здесь функции побеждают.

function sb(string $m, string $t, array $q = [], $b = null, array $e = []): array { return []; }
function sb_single(string $t, array $f = [], string $sel = '*'): ?array { return $GLOBALS['ROW'] ?? null; }
function sb_select(string $t, array $f = [], string $sel = '*'): array { return $GLOBALS['ROWS'] ?? []; }
function sb_select_all(string $t, array $f = [], string $sel = '*'): array { return $GLOBALS['ROWS'] ?? []; }
function sb_update(string $t, array $f, array $d): void {}
function sb_upsert_rows(string $t, array $r, string $c): void {}
function sb_insert(string $t, array $r): void {}
function now_iso(): string { return gmdate('c'); }
function sb_lite_url(): string { return 'https://jobtoo.ru'; }
function sb_lite_key(): string { return 'test'; }

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// Берём из страницы только функции: константа гасит её точку входа.
define('VACANCY_PAGE_LIB_ONLY', true);
require __DIR__ . '/../php-proxy/vacancy_page.php';

// ── Правило адреса ────────────────────────────────────────────────────────────
check('обычный идентификатор годится', vacancy_id_is_url_safe('v-123_abc.1'));
check('пустой не годится', !vacancy_id_is_url_safe(''));
check('со слэшем не годится', !vacancy_id_is_url_safe('a/b'));
check('с пробелом не годится', !vacancy_id_is_url_safe('a b'));
check('слишком длинный не годится', !vacancy_id_is_url_safe(str_repeat('a', 129)));

$base = [
    'id' => 'v-123',
    'company' => 'Склад Альфа',
    'title' => 'Комплектовщик на склад',
    'address' => 'Москва, ул. Складская, 4',
    'metro_station' => 'Алтуфьево',
    'created_at' => '2026-09-10T08:00:00+00:00',
    'status' => 'open',
];

/** Отрисовать страницу и вернуть её HTML. */
function render(array $row, string $kind): string
{
    ob_start();
    vp_render(vp_normalize($row, $kind));
    return (string)ob_get_clean();
}

function json_ld(string $html): array
{
    if (!preg_match('~<script type="application/ld\+json">(.*?)</script>~s', $html, $m)) return [];
    return json_decode($m[1], true) ?: [];
}

// ── Постоянная вакансия ───────────────────────────────────────────────────────
$html = render(array_merge($base, [
    'salary' => 90000,
    'schedule' => '5/2',
    'description' => "Постоянная работа на складе.\n\nОформление по ТК.",
]), 'perm');
$ld = json_ld($html);

check('заголовок вакансии есть в исходнике', str_contains($html, 'Комплектовщик на склад'));
check('название компании настоящее', str_contains($html, 'Склад Альфа'));
check('заглушки «Работодатель» нет', !str_contains($html, 'Работодатель'));
check('есть канонический адрес', str_contains($html, 'rel="canonical"'));
check('есть краткое описание для выдачи', str_contains($html, 'name="description"'));
check('тип разметки JobPosting', ($ld['@type'] ?? '') === 'JobPosting');
check('компания попала в разметку', ($ld['hiringOrganization']['name'] ?? '') === 'Склад Альфа');
check('дата публикации есть', ($ld['datePosted'] ?? '') === '2026-09-10');
check('зарплата в рублях', ($ld['baseSalary']['currency'] ?? '') === 'RUB');
check('зарплата помесячная', ($ld['baseSalary']['value']['unitText'] ?? '') === 'MONTH');
check('отклик у нас, а не на стороне', ($ld['directApply'] ?? null) === true);
check('нет отметки о закрытии', !str_contains(mb_strtolower($html), 'вакансия закрыта'));

// Пустые поля не выдумываем: за ложные данные в разметке наказывают.
foreach ($ld as $k => $v) {
    if (is_string($v)) check("поле $k не пустое", trim($v) !== '');
}

// ── Смена ─────────────────────────────────────────────────────────────────────
$html = render(array_merge($base, [
    'salary' => 3500,
    'date' => '2026-09-20',
    'time_start' => '09:00',
    'time_end' => '21:00',
    'work_type_label' => 'Складские работы',
    'norms_and_pay' => 'Норма 120 коробов за смену.',
    'conditions' => 'Спецодежда выдаётся.',
]), 'shift');
$ld = json_ld($html);

check('условия смены попали в текст', str_contains($html, 'Норма 120 коробов'));
check('оплата за смену, а не за месяц', ($ld['baseSalary']['value']['unitText'] ?? '') === 'DAY');
check('занятость временная', ($ld['employmentType'] ?? '') === 'TEMPORARY');
// Смена действительна до своей даты: бессрочное объявление о прошедшей смене —
// ложь и для человека, и для робота.
check('срок действия равен дате смены', ($ld['validThrough'] ?? '') === '2026-09-20');

// ── Закрытая вакансия ─────────────────────────────────────────────────────────
$html = render(array_merge($base, [
    'salary' => 90000,
    'schedule' => '5/2',
    'description' => 'Постоянная работа на складе.',
    'status' => 'closed',
]), 'perm');
$ld = json_ld($html);

// Не удаляем и не прячем под 404: страница накопила вес, ссылки на неё остались
// снаружи. Отметка для человека, срок действия в прошлом — для робота.
check('страница закрытой вакансии осталась', str_contains($html, '<h1>'));
check('видна отметка о закрытии', str_contains(mb_strtolower($html), 'вакансия закрыта'));
check('срок действия проставлен', ($ld['validThrough'] ?? '') === '2026-09-10');
check('кнопка ведёт к открытым вакансиям', str_contains($html, 'Смотреть открытые'));

// ── Экранирование ─────────────────────────────────────────────────────────────
// Текст вводят работодатели, и он попадает и в HTML, и в JSON-LD.
$html = render(array_merge($base, [
    'salary' => 1,
    'schedule' => '',
    'title' => 'Грузчик <script>alert(1)</script>',
    'description' => 'Кавычки "ёлочки" и <b>теги</b>',
]), 'perm');
check('теги из названия экранированы', !str_contains($html, '<script>alert(1)</script>'));
check('экранированный вид присутствует', str_contains($html, '&lt;script&gt;'));

if ($failures) {
    echo "vacancy page: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "vacancy page: OK\n";
