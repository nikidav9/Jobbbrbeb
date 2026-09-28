/**
 * Справочник навыков для экрана `resume/04-skills.html` (вкладка «Резюме» →
 * «Навыки»). Плоский список строк, а не enum: пользователь всё равно может
 * вписать свой вариант через поиск, справочник только подсказывает и
 * упорядочивает «Часто ищут в IT».
 *
 * Порядок в макете важен только для `POPULAR_IT_SKILLS` — остальной список
 * используется лишь для поиска, поэтому в `SKILLS` группировка по разделам
 * только для чтения самого файла.
 */

const PROGRAMMING_LANGUAGES = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin', 'Swift', 'Objective-C',
  'C', 'C++', 'C#', 'Go', 'Rust', 'PHP', 'Ruby', 'Scala', 'Dart', 'Elixir',
  'Perl', 'Lua', 'R', 'MATLAB', 'Groovy', 'Haskell', 'Clojure', 'Solidity',
  'Assembler', 'VBA', '1С', '1С: Торговля и склад', '1С: Зарплата и кадры',
  '1С: Бухгалтерия', 'SQL', 'PL/SQL', 'T-SQL', 'Bash', 'PowerShell',
];

const FRONTEND = [
  'HTML', 'CSS', 'Sass', 'Less', 'React', 'React Native', 'Vue.js', 'Angular',
  'Svelte', 'Next.js', 'Nuxt.js', 'Redux', 'MobX', 'Webpack', 'Vite',
  'Tailwind CSS', 'Bootstrap', 'jQuery', 'GraphQL', 'Storybook', 'Figma to code',
  'Адаптивная вёрстка', 'Кроссбраузерность', 'PWA',
];

const BACKEND = [
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring',
  'Spring Boot', 'Laravel', 'Symfony', 'Ruby on Rails', 'ASP.NET', '.NET Core',
  'gRPC', 'REST API', 'SOAP', 'Микросервисы', 'WebSocket', 'RabbitMQ', 'Kafka',
  'Celery', 'Nginx', 'Apache',
];

const MOBILE = [
  'Android SDK', 'iOS SDK', 'Flutter', 'Xamarin', 'Jetpack Compose', 'SwiftUI',
  'Expo', 'App Store публикация', 'Google Play публикация',
];

const DATABASES = [
  'PostgreSQL', 'MySQL', 'SQLite', 'Microsoft SQL Server', 'Oracle Database',
  'MongoDB', 'Redis', 'Elasticsearch', 'ClickHouse', 'Cassandra', 'DynamoDB',
  'Firebase', 'Supabase', 'Neo4j', 'Проектирование баз данных', 'Оптимизация запросов',
];

const DEVOPS = [
  'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'CI/CD', 'GitHub Actions',
  'GitLab CI', 'Jenkins', 'AWS', 'Google Cloud Platform', 'Microsoft Azure',
  'Yandex Cloud', 'Linux администрирование', 'Bash-скрипты', 'Мониторинг',
  'Prometheus', 'Grafana', 'ELK Stack', 'Nginx настройка', 'Сетевое администрирование',
  'Виртуализация', 'Настройка серверов',
];

const DATA_ANALYTICS = [
  'Аналитика данных', 'Data Science', 'Machine Learning', 'Глубокое обучение',
  'Pandas', 'NumPy', 'Scikit-learn', 'TensorFlow', 'PyTorch', 'Power BI',
  'Tableau', 'Google Analytics', 'Яндекс.Метрика', 'A/B тестирование',
  'Big Data', 'Hadoop', 'Spark', 'ETL', 'Визуализация данных', 'Статистика',
  'Продуктовая аналитика', 'Сквозная аналитика',
];

const DESIGN = [
  'Figma', 'Adobe Photoshop', 'Adobe Illustrator', 'Adobe XD', 'Sketch',
  'UX-дизайн', 'UI-дизайн', 'Прототипирование', 'Дизайн-системы', 'Wireframing',
  'Моушн-дизайн', 'Adobe After Effects', 'Adobe Premiere Pro', 'CorelDRAW',
  '3D-моделирование', 'Blender', 'Cinema 4D', 'Веб-дизайн', 'Полиграфический дизайн',
  'Брендинг', 'Типографика',
];

const QA = [
  'Тестирование ПО', 'Ручное тестирование', 'Автоматизация тестирования',
  'Selenium', 'Cypress', 'Playwright', 'Postman', 'JMeter', 'Нагрузочное тестирование',
  'Тест-кейсы', 'Баг-репорты', 'Jira', 'TestRail', 'API-тестирование',
];

const PM_ANALYST = [
  'Управление проектами', 'Agile / Scrum', 'Kanban', 'Waterfall', 'Confluence',
  'Trello', 'Asana', 'Notion', 'Бизнес-анализ', 'Сбор требований', 'BPMN',
  'UML', 'Управление рисками', 'Бюджетирование проекта', 'Product Management',
  'Дорожная карта продукта', 'Приоритизация задач', 'Скрам-мастерство',
];

const OFFICE_GENERAL = [
  'Microsoft Excel', 'Microsoft Word', 'Microsoft PowerPoint', 'Microsoft Outlook',
  'Google Таблицы', 'Google Документы', 'Google Презентации', '1С: Предприятие',
  'Электронный документооборот', 'Делопроизводство', 'Работа с оргтехникой',
  'Слепая печать', 'Кассовая дисциплина', 'Работа с CRM', 'Bitrix24', 'AmoCRM',
  'SAP', 'Работа с базами данных 1С',
];

const SALES_MARKETING = [
  'Продажи', 'Холодные звонки', 'Работа с возражениями', 'Работа с клиентами',
  'Деловая переписка', 'Деловое общение', 'Урегулирование конфликтов',
  'Клиентский сервис', 'B2B-продажи', 'B2C-продажи', 'Ведение переговоров',
  'Маркетинг', 'Интернет-маркетинг', 'SMM', 'SEO', 'Контекстная реклама',
  'Таргетированная реклама', 'Email-маркетинг', 'Копирайтинг', 'Контент-маркетинг',
  'Брендинг продукта', 'Event-маркетинг', 'Мерчандайзинг',
];

const HR_MANAGEMENT = [
  'Подбор персонала', 'Кадровое делопроизводство', 'Адаптация персонала',
  'Обучение персонала', 'Оценка персонала', 'Кадровый резерв', 'Мотивация персонала',
  'Управление командой', 'Наставничество', 'Проведение собеседований',
  'Трудовое законодательство', 'Расчёт заработной платы', 'HR-аналитика',
];

const FINANCE_ACCOUNTING = [
  'Бухгалтерский учёт', 'Налоговый учёт', 'Финансовый анализ', 'Управленческий учёт',
  'Составление отчётности', 'МСФО', 'Кассовые операции', 'Первичная документация',
  'Бюджетирование', 'Аудит', 'Работа с банк-клиентом', 'Инвентаризация',
];

const LOGISTICS_WAREHOUSE = [
  'Складской учёт', 'Логистика', 'Управление запасами', 'Работа с ТСД',
  'Приёмка товара', 'Комплектация заказов', 'Погрузочно-разгрузочные работы',
  'Управление автопарком', 'Маршрутизация', 'ВЭД', 'Таможенное оформление',
];

const HOSPITALITY_SERVICE = [
  'Обслуживание клиентов', 'Работа с кассой', 'Бариста-навыки', 'Кулинария',
  'Санитарные нормы', 'Сервировка стола', 'Работа в команде', 'Стрессоустойчивость',
  'Тайм-менеджмент', 'Многозадачность', 'Организаторские навыки', 'Гостеприимство',
];

const LANGUAGES_SOFT = [
  'Английский язык', 'Немецкий язык', 'Французский язык', 'Испанский язык',
  'Китайский язык', 'Итальянский язык', 'Португальский язык', 'Турецкий язык',
  'Арабский язык', 'Публичные выступления', 'Критическое мышление',
  'Наставничество и менторство', 'Эмоциональный интеллект', 'Ведение презентаций',
  'Фасилитация встреч', 'Быстрая обучаемость', 'Внимательность к деталям',
];

const CONSTRUCTION_TECH = [
  'Чтение чертежей', 'AutoCAD', 'ArchiCAD', 'Revit', 'КОМПАС-3D', 'SolidWorks',
  'Сметное дело', 'Строительный контроль', 'Электромонтажные работы',
  'Сантехнические работы', 'Сварочные работы', 'Отделочные работы',
  'Техника безопасности на производстве', 'Работа с чертежами КИПиА',
  'Наладка оборудования', 'ППР (проект производства работ)',
];

const MEDICAL_BEAUTY = [
  'Оказание первой помощи', 'Медицинский уход', 'Ведение медицинской документации',
  'Фармацевтические знания', 'Массаж', 'Парикмахерское искусство', 'Маникюр',
  'Визаж', 'Косметология', 'Консультирование клиентов по уходу',
];

const EDUCATION_CHILDCARE = [
  'Преподавание', 'Разработка учебных программ', 'Репетиторство',
  'Работа с детьми', 'Организация досуга', 'Педагогика', 'Детская психология',
  'Логопедия', 'Проведение тренингов', 'Методическая работа',
];

const LEGAL = [
  'Договорная работа', 'Судебное представительство', 'Правовая экспертиза',
  'Корпоративное право', 'Трудовые споры', 'Претензионная работа',
  'Юридическое консультирование', 'Составление исковых заявлений',
];

const MORE_TECH = [
  'Git', 'GitHub', 'GitLab', 'Bitbucket', 'Code Review', 'Unit-тестирование',
  'Rest Assured', 'OAuth', 'JWT', 'Криптография', 'Информационная безопасность',
  'Penetration Testing', 'OWASP', 'Firewall настройка', 'VPN настройка',
  'Active Directory', 'Windows Server', 'macOS администрирование',
  'Техническая поддержка', '1С: Управление торговлей', '1С: ERP',
  'Битрикс (сайты)', 'WordPress', 'Tilda', 'No-code разработка', 'Zapier',
  'Make (Integromat)', 'Chatbot разработка', 'Telegram Bot API',
  'Обработка естественного языка', 'Компьютерное зрение', 'LLM промпт-инжиниринг',
];

/** Полный справочник — объединение разделов выше, без дублей. */
export const SKILLS: string[] = Array.from(new Set([
  ...PROGRAMMING_LANGUAGES,
  ...FRONTEND,
  ...BACKEND,
  ...MOBILE,
  ...DATABASES,
  ...DEVOPS,
  ...DATA_ANALYTICS,
  ...DESIGN,
  ...QA,
  ...PM_ANALYST,
  ...OFFICE_GENERAL,
  ...SALES_MARKETING,
  ...HR_MANAGEMENT,
  ...FINANCE_ACCOUNTING,
  ...LOGISTICS_WAREHOUSE,
  ...HOSPITALITY_SERVICE,
  ...LANGUAGES_SOFT,
  ...CONSTRUCTION_TECH,
  ...MEDICAL_BEAUTY,
  ...EDUCATION_CHILDCARE,
  ...LEGAL,
  ...MORE_TECH,
]));

/** «Часто ищут в IT» — подсказки на экране `resume/04-skills.html`, порядок как в макете. */
export const POPULAR_IT_SKILLS: string[] = [
  'Jira', 'Agile / Scrum', 'SQL', 'Microsoft Excel', 'Confluence',
  'Управление проектами', 'Аналитика данных', 'Power BI',
];

/** trim + схлопнуть повторяющиеся пробелы внутри строки. */
export function normalizeSkill(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** ё → е, нижний регистр — чтобы «пелёнка» находило «пеленка» и наоборот. */
function foldForSearch(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

/**
 * Поиск по справочнику навыков без учёта регистра и ё/е.
 *
 * Порядок результатов: сперва совпадения с начала названия, затем — с начала
 * любого слова внутри названия, затем — подстрока где угодно. Внутри каждой
 * группы сохраняется порядок справочника. Уже выбранные навыки (`exclude`,
 * тоже без учёта регистра) исключаются из выдачи.
 */
export function searchSkills(query: string, exclude: string[] = [], limit = 20): string[] {
  const q = foldForSearch(normalizeSkill(query));
  if (!q) return [];
  const excluded = new Set(exclude.map((s) => foldForSearch(normalizeSkill(s))));

  const startsWithName: string[] = [];
  const startsWithWord: string[] = [];
  const contains: string[] = [];

  for (const skill of SKILLS) {
    const folded = foldForSearch(skill);
    if (excluded.has(folded)) continue;
    if (folded.startsWith(q)) {
      startsWithName.push(skill);
    } else if (folded.split(/\s+/).some((word) => word.startsWith(q))) {
      startsWithWord.push(skill);
    } else if (folded.includes(q)) {
      contains.push(skill);
    }
  }

  return [...startsWithName, ...startsWithWord, ...contains].slice(0, limit);
}
