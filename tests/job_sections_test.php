<?php
// Разделы ленты: название вакансии → раздел (php-proxy/job_sections.php).
//
// Названия — в том виде, в каком их отдают карьерные сайты каталога: с
// компанией в скобках, через дефис, с латиницей. Каждая строка здесь —
// либо обычный случай, либо ловушка, на которой порядок правил уже ошибался.

require __DIR__ . '/../php-proxy/job_sections.php';

$failures = [];
function expect_section(string $title, string $want, ?string $workType = null): void
{
    global $failures;
    $got = job_section($title, $workType);
    if ($got !== $want) $failures[] = "«{$title}»: ждали {$want}, получили {$got}";
}

$cases = [
    // IT — в том числе «инженеры», которые на деле разработчики.
    ['Java-разработчик', 'it'],
    ['Ведущий Python-разработчик (B2B)', 'it'],
    ['Senior Frontend Developer', 'it'],
    ['Go-разработчик', 'it'],
    ['QA-инженер', 'it'],
    ['Инженер по тестированию', 'it'],
    ['DevOps-инженер', 'it'],
    ['Инженер данных', 'it'],
    ['Data Scientist', 'it'],
    ['Системный администратор', 'it'],
    ['Системный аналитик', 'it'],
    ['Аналитик', 'it'],
    ['Программист 1С', 'it'],
    ['Консультант 1С', 'it'],
    ['iOS-разработчик', 'it'],
    ['Специалист технической поддержки', 'it'],
    ['Руководитель проектов', 'it'],
    ['Product Manager', 'it'],

    // Склад, доставка, транспорт — где порядок правил решает всё.
    ['Кладовщик', 'warehouse'],
    ['Комплектовщик на склад', 'warehouse'],
    ['Сборщик заказов (Самокат)', 'warehouse'],
    ['Грузчик', 'warehouse'],
    ['Водитель погрузчика', 'warehouse'],
    ['Сотрудник пункта выдачи заказов', 'warehouse'],
    ['Оператор ПВЗ', 'warehouse'],
    ['Логист', 'warehouse'],
    ['Курьер', 'delivery'],
    ['Пеший курьер', 'delivery'],
    ['Водитель-курьер', 'delivery'],
    ['Почтальон', 'delivery'],
    ['Водитель-экспедитор', 'transport'],
    ['Водитель категории C', 'transport'],
    ['Машинист электропоезда', 'transport'],
    ['Бортпроводник', 'transport'],
    ['Автослесарь', 'transport'],
    ['Руководитель группы', 'other'],
    ['Руководитель пилотного проекта', 'it'],
    ['Второй пилот', 'transport'],

    // Общепит и магазины.
    ['Повар', 'food'],
    ['Шеф-повар', 'food'],
    ['Бариста', 'food'],
    ['Кассир в ресторан', 'food'],
    ['Директор ресторана', 'food'],
    ['Технолог общественного питания', 'food'],
    ['Продавец-кассир', 'retail'],
    ['Продавец-консультант', 'retail'],
    ['Кассир', 'retail'],
    ['Директор магазина', 'retail'],
    ['Администратор магазина', 'retail'],
    ['Мерчендайзер', 'retail'],
    ['Товаровед', 'retail'],

    // Финансы — выше «1С», «аналитика» и «консультанта».
    ['Бухгалтер', 'finance'],
    ['Бухгалтер (1С)', 'finance'],
    ['Финансовый аналитик', 'finance'],
    ['Финансовый консультант', 'finance'],
    ['Кредитный эксперт', 'finance'],
    ['Кассир-операционист', 'finance'],
    ['Экономист', 'finance'],
    ['Риск-менеджер', 'finance'],

    // Продажи и клиенты.
    ['Менеджер по продажам', 'sales'],
    ['Руководитель отдела продаж', 'sales'],
    ['Специалист контакт-центра', 'sales'],
    ['Оператор колл-центра', 'sales'],
    ['Клиентский менеджер', 'sales'],
    ['Консультант', 'sales'],
    ['Страховой агент', 'sales'],
    ['Медицинский представитель', 'medical'],

    // Офис, маркетинг, медицина.
    ['Офис-менеджер', 'office'],
    ['HR-менеджер', 'office'],
    ['Рекрутер', 'office'],
    ['Юрист', 'office'],
    ['Специалист по закупкам', 'office'],
    ['Администратор', 'office'],
    ['Маркетолог', 'marketing'],
    ['Графический дизайнер', 'marketing'],
    ['SMM-менеджер', 'marketing'],
    ['PR-менеджер', 'marketing'],
    ['Фармацевт', 'medical'],
    ['Провизор', 'medical'],
    ['Врач-терапевт', 'medical'],

    // Сервис: ловушки «котельная» ⊃ «отель», «охрана труда» ⊃ «охран».
    ['Уборщица', 'service'],
    ['Охранник', 'service'],
    ['Горничная', 'service'],
    ['Администратор гостиницы', 'service'],
    ['Администратор отеля', 'service'],
    ['Специалист по охране труда', 'engineering'],
    ['Оператор котельной', 'production'],

    // Производство и инженеры.
    ['Слесарь-ремонтник', 'production'],
    ['Сварщик', 'production'],
    ['Оператор линии', 'production'],
    ['Машинист крана', 'production'],
    ['Электромонтёр', 'production'],
    ['Сборщик мебели', 'production'],
    ['Контролёр ОТК', 'production'],
    ['Инженер-конструктор', 'engineering'],
    ['Инженер ПТО', 'engineering'],
    ['Прораб', 'engineering'],
    ['Архитектор', 'engineering'],
    ['Преподаватель кафедры', 'other'],

    // Не узнали — «другое», а не догадка.
    ['Стажёр', 'other'],
    ['', 'other'],
];
foreach ($cases as [$title, $want]) expect_section($title, $want);

// Свои вакансии JobToo: название — подпись вида работ, вид работ — запасной путь.
expect_section('Кладовщик', 'warehouse', 'stocker');
expect_section('Бригадир смены', 'warehouse', 'shift_supervisor');
expect_section('', 'food', 'cook');
expect_section('', 'warehouse', 'picker');
expect_section('Что-то непонятное', 'other', 'неизвестный');

// Каждое правило ссылается на существующий раздел.
foreach (JOB_SECTION_RULES as [$section]) {
    if (!isset(JOB_SECTIONS[$section])) $failures[] = "правило на несуществующий раздел {$section}";
}
foreach (JOB_SECTION_BY_WORK_TYPE as $section) {
    if (!isset(JOB_SECTIONS[$section])) $failures[] = "вид работ ведёт в несуществующий раздел {$section}";
}

// Приложение показывает тот же список. Разойдутся — шестерёнка предложит
// раздел, которого сервер не знает, и колода по нему будет пустой.
$ts = file_get_contents(__DIR__ . '/../constants/jobSections.ts');
preg_match_all("~\\{\\s*id:\\s*'([a-z]+)'~", (string)$ts, $m);
$tsIds = $m[1] ?? [];
$phpIds = array_keys(JOB_SECTIONS);
if ($tsIds !== $phpIds) {
    $failures[] = 'разделы в constants/jobSections.ts не совпадают с php-proxy/job_sections.php: '
        . implode(',', $tsIds) . ' ≠ ' . implode(',', $phpIds);
}

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo 'job sections: ok (' . count($cases) . " названий)\n";
