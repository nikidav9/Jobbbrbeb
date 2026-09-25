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

/**
 * Вкус человека из истории свайпов: вес компании и вес слов названия.
 * $history — [['dir' => 1|-1, 'company' => ..., 'title' => ...], ...].
 */
function ext_feed_taste(array $history): array
{
    $company = [];
    $tokens = [];
    foreach ($history as $h) {
        $dir = (int)($h['dir'] ?? 0) > 0 ? 1 : -1;
        $c = mb_strtolower(trim((string)($h['company'] ?? '')), 'UTF-8');
        if ($c !== '') $company[$c] = ($company[$c] ?? 0) + $dir;
        foreach (ext_feed_tokens((string)($h['title'] ?? '')) as $t) {
            $tokens[$t] = ($tokens[$t] ?? 0) + $dir;
        }
    }
    // Одна компания не должна перевесить всё: пять лайков Сбера — не повод
    // показывать только Сбер.
    foreach ($company as $c => $v) $company[$c] = max(-3, min(3, $v));
    return ['company' => $company, 'tokens' => $tokens];
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
