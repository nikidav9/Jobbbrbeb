<?php
// Плашка «как отвечает работодатель» доходит до места, где принимают решение.
//
// Решение в этом продукте принимается СВАЙПОМ: одно движение, ноль раздумий.
// Плашка при этом показывалась только в подробностях смены и на странице
// постоянной вакансии — то есть тем единицам, кто дотапал. Предупреждать о
// молчуне после того, как отклик ушёл, поздно: отклик без ответа человек
// читает как «сервис не работает» и уходит.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');

// ── Плашка на карточке свайпа ────────────────────────────────────────────────
check('плашка подключена', str_contains($feed, "import { ReplyBadge } from '@/components/feature/ReplyBadge';"));
check('плашка на карточке', str_contains($feed, '<ReplyBadge stats={responsivenessMap[currentCard.employerId]} />'));
// Смотрим ВСЕ деструктуризации useApp, а не одну строку целиком: в ленте
// useApp зовут несколько раз, и любая новая строка рядом ломала бы проверку
// на ровном месте. Так и вышло, когда рядом добавился backendOffline.
preg_match_all('~const \{([^}]*)\}\s*=\s*useApp\(\);~', $feed, $uses);
$mapFromContext = false;
foreach ($uses[1] ?? [] as $block) {
    if (str_contains($block, 'responsivenessMap')) { $mapFromContext = true; break; }
}
check('карта берётся из контекста, а не запросом на карточку',
    $mapFromContext && !preg_match('~dbResponsivenessMap\(~', $feed));

// ── Место: до разделителя ────────────────────────────────────────────────────
// cardSummary стоит flexShrink, поэтому лишняя высота съедает описание, а не
// выталкивает ссылку «Читать полностью» за край. Уехавшую ссылку без прокрутки
// внутри карточки уже ничем не достать — прокрутки там нет намеренно.
//
// Порядок ищем ВНУТРИ тела карточки, а не по всему файлу. Первая версия этой
// проверки искала разделитель начиная от плашки — и находила следующий
// разделитель где-то дальше в файле. Плашку можно было переставить за
// разделитель, и проверка оставалась зелёной: ровно та видимость, которая
// хуже отсутствия проверки. Поймано мутацией.
$bodyStart = strpos($feed, 'style={styles.cardBody}');
$bodyEnd = $bodyStart !== false ? strpos($feed, '</Pressable>', $bodyStart) : false;
$body = ($bodyStart !== false && $bodyEnd !== false)
    ? substr($feed, $bodyStart, $bodyEnd - $bodyStart) : '';
check('тело карточки свайпа найдено', $body !== '');

$badgeAt = strpos($body, '<ReplyBadge stats={responsivenessMap');
$dividerAt = strpos($body, '<View style={styles.cardDivider} />');
$readFullAt = strpos($body, 'styles.readFullRow');
$chipsAt = strpos($body, '<View style={styles.chipsRow}>');
check('плашка внутри тела карточки', $badgeAt !== false);
check('плашка стоит после чипов',
    $badgeAt !== false && $chipsAt !== false && $chipsAt < $badgeAt);
check('плашка стоит до разделителя',
    $badgeAt !== false && $dividerAt !== false && $badgeAt < $dividerAt);
check('плашка стоит до ссылки «Читать полностью»',
    $badgeAt !== false && $readFullAt !== false && $badgeAt < $readFullAt);
check('описание умеет ужиматься', str_contains($feed, 'cardSummary: { flexShrink: 1, overflow: \'hidden\' }'));
// Прокрутки внутри карточки быть не должно: два жеста на одной площади всегда
// дерутся, из-за этого карточка когда-то уезжала от попытки полистать.
check('прокрутки внутри карточки по-прежнему нет',
    !preg_match('~<ScrollView[^>]*>\s*<View style=\{styles\.cardBody~', $feed));

// ── Плашка молчит, когда сказать нечего ──────────────────────────────────────
$badge = (string)file_get_contents(__DIR__ . '/../components/feature/ReplyBadge.tsx');
check('по одной переписке вывода не делаем',
    str_contains($badge, 'if (!stats || stats.chats < 2) return null;'));
// У партнёрских карточек employerId вида `external:<источник>`: в карте
// отзывчивости такого ключа нет, stats придёт undefined — и плашка промолчит
// сама, без отдельной проверки на карточке.
check('партнёрские карточки отличимы по employerId',
    str_contains($feed, 'employerId: `external:${v.sourceId}`,'));

// ── Старые места не потеряны ─────────────────────────────────────────────────
// Плашка добавлена к свайпу, а не переехала: в подробностях она тоже нужна.
$detail = (string)file_get_contents(__DIR__ . '/../components/feature/VacancyDetailModal.tsx');
check('в подробностях смены плашка осталась', str_contains($detail, '<ReplyBadge'));
$perm = (string)file_get_contents(__DIR__ . '/../app/perm-vacancy-detail.tsx');
check('на постоянной вакансии плашка осталась', str_contains($perm, '<ReplyBadge'));

if ($failures) {
    echo "reply badge: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "reply badge: OK\n";
