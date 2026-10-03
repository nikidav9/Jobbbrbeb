<?php
// Лента карьерных вакансий: ранжирование по свайпам и чередование компаний.
//
// Чистые функции без базы — их проверяет tests/ext_feed_test.php. Пул
// кандидатов (не больше N свежих непросмотренных на компанию) собирает
// функция базы jm_ext_feed_pool (миграция 112), историю свайпов — db.php.
//
// Зачем: в каталоге половина вакансий — Сбер и треть — Магнит, и лента,
// отсортированная по времени обновления, шла блоками одной компании. Теперь
// компании чередуются, а то, что человек лайкал, поднимается выше.
//
// С 25.09.2026 вкус учитывает не только свайпы, но и профиль: вид работ и
// должности из резюме поднимают свой раздел (php-proxy/job_sections.php) ещё
// до первого свайпа, а совпадение станции метро — частый повод откликнуться.

require_once __DIR__ . '/job_sections.php';
require_once __DIR__ . '/vacancy_facets.php';

const EXT_FEED_STOPWORDS = [
    'для', 'или', 'при', 'под', 'над', 'без', 'как', 'что', 'это', 'все',
    'the', 'and', 'with', 'for',
];

/** Значимые слова названия вакансии: «Ведущий Java-разработчик» → [ведущий, java, разработчик]. */
function ext_feed_tokens(string $title): array
{
    $words = preg_split('~[^\p{L}\p{N}]+~u', mb_strtolower($title, 'UTF-8'), -1, PREG_SPLIT_NO_EMPTY);
    $out = [];
    foreach ($words as $w) {
        if (mb_strlen($w, 'UTF-8') < 3 || in_array($w, EXT_FEED_STOPWORDS, true)) continue;
        $out[$w] = true;
    }
    return array_keys($out);
}

/** Станция метро к общему виду: нижний регистр, без пробелов по краям, «ё»→«е». */
function ext_feed_metro_norm(string $s): string
{
    return str_replace('ё', 'е', mb_strtolower(trim($s), 'UTF-8'));
}

/**
 * Вкус человека: свайпы плюс профиль. $history —
 * [['dir' => 1|-1, 'company' => ..., 'title' => ..., 'section' => ...], ...].
 * $profile — строка jm_users (work_types, metro_station, resume_data),
 * пустая, если анкеты ещё нет или человек не вошёл.
 */
function ext_feed_taste(array $history, array $profile = []): array
{
    $company = [];
    $tokens = [];
    $section = [];
    foreach ($history as $h) {
        $dir = (int)($h['dir'] ?? 0) > 0 ? 1 : -1;
        $c = mb_strtolower(trim((string)($h['company'] ?? '')), 'UTF-8');
        if ($c !== '') $company[$c] = ($company[$c] ?? 0) + $dir;
        foreach (ext_feed_tokens((string)($h['title'] ?? '')) as $t) {
            $tokens[$t] = ($tokens[$t] ?? 0) + $dir;
        }
        $s = (string)($h['section'] ?? '');
        if ($s !== '') $section[$s] = ($section[$s] ?? 0) + $dir;
    }

    // Виды работ, которые работник отметил в анкете, — через то же правило,
    // что раскладывает свои вакансии по разделам (JOB_SECTION_BY_WORK_TYPE).
    foreach ((array)($profile['work_types'] ?? []) as $wt) {
        if (!is_string($wt)) continue;
        $s = JOB_SECTION_BY_WORK_TYPE[strtolower(trim($wt))] ?? null;
        if ($s !== null) $section[$s] = ($section[$s] ?? 0) + 2;
    }

    // Должности из резюме: раздел названия и его слова, как лайк вакансии.
    // Резюме может прийти строкой JSON (так лежит resume_data в базе).
    $resumeData = $profile['resume_data'] ?? null;
    if (is_string($resumeData)) $resumeData = json_decode($resumeData, true);
    $experience = is_array($resumeData) ? (array)($resumeData['experience'] ?? []) : [];
    foreach (array_slice($experience, 0, 20) as $exp) {
        $position = is_array($exp) && is_string($exp['position'] ?? null) ? trim($exp['position']) : '';
        if ($position === '') continue;
        $s = job_section($position);
        if ($s !== 'other') $section[$s] = ($section[$s] ?? 0) + 1;
        foreach (ext_feed_tokens($position) as $t) {
            $tokens[$t] = ($tokens[$t] ?? 0) + 1;
        }
    }

    // Одна компания не должна перевесить всё: пять лайков Сбера — не повод
    // показывать только Сбер. Тот же довод для раздела: должность в резюме
    // плюс десяток свайпов не должны наглухо перекрыть остальную ленту.
    foreach ($company as $c => $v) $company[$c] = max(-3, min(3, $v));
    foreach ($section as $s => $v) $section[$s] = max(-3, min(3, $v));

    return [
        'company' => $company,
        'tokens' => $tokens,
        'section' => $section,
        'metro' => ext_feed_metro_norm(is_string($profile['metro_station'] ?? null) ? $profile['metro_station'] : ''),
    ];
}

/** Оценка вакансии под человека. $jitter — 0..1, чтобы лента не была одинаковой. */
function ext_feed_score(array $row, array $taste, float $jitter): float
{
    $c = mb_strtolower(trim((string)($row['company'] ?? '')), 'UTF-8');
    $score = 0.6 * ($taste['company'][$c] ?? 0);
    $toks = ext_feed_tokens((string)($row['title'] ?? ''));
    if ($toks) {
        $sum = 0;
        foreach ($toks as $t) $sum += $taste['tokens'][$t] ?? 0;
        $score += 0.8 * max(-3, min(3, $sum / sqrt(count($toks))));
    }
    $section = (string)($row['section'] ?? '');
    if ($section !== '') $score += 0.7 * ($taste['section'][$section] ?? 0);
    // Совпадение станции метро — частый повод откликнуться, даже без свайпов.
    $rowMetro = ext_feed_metro_norm((string)($row['metro_station_norm'] ?? $row['metro_station'] ?? ''));
    if ($rowMetro !== '' && $rowMetro === ($taste['metro'] ?? '')) $score += 0.5;
    return $score + 0.8 * $jitter;
}

/**
 * Колонки jm_ext_vacancies для пула ленты — все, КРОМЕ трёх тяжёлых:
 * description_full (полный текст со страницы, КБ на строку), described_at и
 * detail_spec (служебные для describe.php, клиенту не нужны и подавно). Пул
 * на компанию доходит до 200 строк (dbGetExtFeed в db.php), а до клиента из
 * него доезжает не больше ~60 — тянуть КБ описания для всех 200 на каждый
 * заход в ленту означало бы десятки МБ JSON на гостевой запрос. Полное
 * описание дотягивается отдельно, только для уже отобранных карточек, —
 * db.php делает это одним sb_select после ext_feed_arrange.
 */
const EXT_FEED_POOL_SELECT = 'id,source_id,external_id,title,company,metro_station,'
    . 'metro_station_norm,metro_line_id,work_type,address,lat,lng,kind,date,'
    . 'time_start,time_end,salary,pay_period,schedule,description,url,dedupe_key,'
    . 'active,first_seen_at,last_seen_at,section';

/**
 * Строка вакансии для отдачи клиенту: description_full (миграция 117, полное
 * описание со структурой — заголовки разделов, списки) занимает место
 * description, если он заполнен. Саму колонку description_full и described_at
 * из ответа убираем — это внутренняя кухня дозагрузки (describe.php), а не то,
 * что нужно карточке. Старые сборки приложения так сразу получают полный
 * текст, ничего не зная про новую колонку.
 */
/**
 * Умеет ли Юпитер откликаться у этой компании. Список — итог браузерной
 * разведки (apply_unsupported.php): на каждом адресе компании нет анкеты и
 * кнопки отклика. Карточки таких компаний в приложении открывают сайт
 * работодателя, а не обещают «отклик через приложение».
 */
function ext_feed_auto_apply(string $company): bool
{
    static $unsupported = null;
    if ($unsupported === null) {
        $file = __DIR__ . '/apply_unsupported.php';
        $list = is_file($file) ? require $file : [];
        $unsupported = is_array($list) ? array_flip($list) : [];
    }
    $key = mb_strtolower(trim(preg_replace('/\s+/u', ' ', $company)), 'UTF-8');
    return $key === '' || !isset($unsupported[$key]);
}

function ext_feed_public_row(array $row): array
{
    $full = trim((string)($row['description_full'] ?? ''));
    if ($full !== '') $row['description'] = $full;
    $row['auto_apply'] = ext_feed_auto_apply((string)($row['company'] ?? ''));
    // detail_spec — служебный адрес для describe.php, клиенту он не нужен.
    unset($row['description_full'], $row['described_at'], $row['detail_spec']);
    return $row;
}

// ── Фильтры на сервере ───────────────────────────────────────────────────────
// Раньше фильтры (зарплата, уровень, формат, компания, дата) применялись на
// клиенте только к уже полученной порции ~60 карточек: выбрал компанию, которой
// в порции не было, — пусто, хотя в базе вакансии есть. Теперь дело сервера:
// dbGetExtFeed (db.php) прогоняет фильтр по всему пулу до ext_feed_arrange и
// отдаёт честное «Всего N».

const EXT_FEED_POSTED_DAYS = ['day' => 1, '3days' => 3, 'week' => 7, 'month' => 30];

/**
 * Нормализация недоверенного ввода: любой мусор — часть пустого фильтра
 * (то есть «фильтр не сужает»), а не ошибка. $raw — то, что пришло в JSON
 * третьим аргументом dbGetExtFeed, может быть чем угодно.
 */
function ext_feed_filters($raw): array
{
    $raw = is_array($raw) ? $raw : [];

    $salaryFrom = (int)($raw['salary_from'] ?? 0);
    $salaryFrom = max(0, min(10_000_000, $salaryFrom));

    $onlyKnown = fn(array $ids, $list) => array_values(array_unique(array_filter(
        (array)$list,
        fn($v) => is_string($v) && in_array($v, $ids, true),
    )));

    $companies = [];
    foreach ((array)($raw['companies'] ?? []) as $c) {
        if (count($companies) >= 50) break;
        if (!is_string($c)) continue;
        $c = trim($c);
        if ($c === '' || mb_strlen($c, 'UTF-8') > 200 || in_array($c, $companies, true)) continue;
        $companies[] = $c;
    }

    $posted = (string)($raw['posted'] ?? 'all');
    if (!in_array($posted, ['all', 'day', '3days', 'week', 'month'], true)) $posted = 'all';

    // Поиск «Вакансия или стек» (макет ленты, 27.09.2026): слова запроса,
    // не больше 6, каждое до 40 символов — дальше ввод просто обрезается.
    $words = [];
    if (is_string($raw['query'] ?? null)) {
        $q = mb_strtolower(mb_substr($raw['query'], 0, 120, 'UTF-8'), 'UTF-8');
        foreach (preg_split('/[\s,;]+/u', $q, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $w) {
            $w = mb_substr($w, 0, 40, 'UTF-8');
            if (!in_array($w, $words, true)) $words[] = $w;
            if (count($words) >= 6) break;
        }
    }

    return [
        'salary_from' => $salaryFrom,
        'specs' => $onlyKnown(VF_SPECS, $raw['specs'] ?? []),
        'levels' => $onlyKnown(VF_LEVELS, $raw['levels'] ?? []),
        'formats' => $onlyKnown(VF_FORMATS, $raw['formats'] ?? []),
        'companies' => $companies,
        'posted' => $posted,
        'query' => $words,
        // Переключатели экрана фильтров (макет «JT-filters»): только с
        // указанной зарплатой — по умолчанию выкл; скрыть просмотренные —
        // по умолчанию вкл (решение владельца), то есть как было всегда.
        'salary_known' => ($raw['salary_known'] ?? false) === true,
        'hide_seen' => ($raw['hide_seen'] ?? true) !== false,
    ];
}

/**
 * Матч вакансии под нормализованный фильтр (ext_feed_filters). $ignoreCompany
 * пропускает фильтр по компании — им считаются подписи в шторке («сколько
 * вакансий у каждой компании при остальных фильтрах»).
 */
function ext_feed_match(array $row, array $f, bool $ignoreCompany = false): bool
{
    if (($f['salary_from'] ?? 0) > 0) {
        $salary = (float)($row['salary'] ?? 0);
        if ($salary <= 0 || $salary < $f['salary_from']) return false;
    }
    if (!empty($f['salary_known']) && (float)($row['salary'] ?? 0) <= 0) return false;

    $posted = $f['posted'] ?? 'all';
    if ($posted !== 'all') {
        $days = EXT_FEED_POSTED_DAYS[$posted] ?? null;
        if ($days !== null) {
            $ts = strtotime((string)($row['first_seen_at'] ?? ''));
            if ($ts === false || $ts < time() - $days * 86400) return false;
        }
    }

    if (!empty($f['levels'])) {
        $level = vf_level((string)($row['title'] ?? ''));
        if ($level === null || !in_array($level, $f['levels'], true)) return false;
    }

    if (!empty($f['formats'])) {
        $format = vf_format($row['schedule'] ?? null, $row['description'] ?? null);
        if ($format === null || !in_array($format, $f['formats'], true)) return false;
    }

    if (!empty($f['specs'])) {
        $specs = vf_specs((string)($row['title'] ?? ''));
        if (!array_intersect($specs, $f['specs'])) return false;
    }

    if (!$ignoreCompany && !empty($f['companies'])) {
        $company = trim((string)($row['company'] ?? ''));
        if (!in_array($company, $f['companies'], true)) return false;
    }

    // Поиск: каждое слово должно встретиться в названии, компании или
    // описании — «python senior» не пустит вакансию, где есть только одно.
    if (!empty($f['query'])) {
        $hay = mb_strtolower(
            ($row['title'] ?? '') . ' ' . ($row['company'] ?? '') . ' ' . ($row['description'] ?? ''),
            'UTF-8',
        );
        foreach ($f['query'] as $w) {
            if (!str_contains($hay, $w)) return false;
        }
    }

    return true;
}

/**
 * Порядок ленты: лучшие вперёд, но одна компания не идёт два раза подряд
 * и не чаще раза на три карточки, пока есть из чего выбирать.
 */
function ext_feed_arrange(array $rows, array $taste, int $limit, string $seed): array
{
    foreach ($rows as $i => $row) {
        $jitter = (crc32($seed . '|' . ($row['id'] ?? $i)) % 1000) / 1000;
        $rows[$i]['_score'] = ext_feed_score($row, $taste, $jitter);
    }
    usort($rows, fn($a, $b) => $b['_score'] <=> $a['_score']);

    $out = [];
    $recent = [];
    while ($rows && count($out) < $limit) {
        $pick = null;
        foreach ([2, 1, 0] as $window) {
            $avoid = $window > 0 ? array_slice($recent, -$window) : [];
            foreach ($rows as $i => $row) {
                if (!in_array(mb_strtolower((string)($row['company'] ?? ''), 'UTF-8'), $avoid, true)) {
                    $pick = $i;
                    break 2;
                }
            }
        }
        $row = $rows[$pick];
        array_splice($rows, $pick, 1);
        $recent[] = mb_strtolower((string)($row['company'] ?? ''), 'UTF-8');
        unset($row['_score']);
        $out[] = $row;
    }
    return $out;
}
