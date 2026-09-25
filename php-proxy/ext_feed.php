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

    // Вид работ, который выбрал работодатель за себя же в jm_users, — то же
    // правило, что и для своих вакансий (JOB_SECTION_BY_WORK_TYPE).
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
