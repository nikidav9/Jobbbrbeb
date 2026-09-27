<?php
// Уровень, формат и специализация вакансии — зеркало services/vacancyFacets.ts.
//
// Фильтры ленты переехали на сервер (php-proxy/ext_feed.php), и им нужны те же
// признаки, что и клиенту. Правила намеренно продублированы, а не вызваны из
// JS: PHP и JS — разные рантаймы. Паритет держит общий файл случаев
// tests/fixtures/vacancy_facets_cases.json — его читают и
// tests/vacancy-facets.test.ts, и tests/vacancy_facets_test.php.
//
// Кириллические границы — теми же явными классами, что в vacancyFacets.ts, а
// не lookbehind: PCRE его умеет, но так проще сверять регулярки глазами
// построчно с оригиналом.

// Известные id — для нормализации фильтров недоверенного ввода
// (php-proxy/ext_feed.php: ext_feed_filters). Подписи — в services/vacancyFacets.ts,
// сюда голые id, сверка идёт через общий файл случаев и глазами при правке.
const VF_LEVELS = ['intern', 'junior', 'middle', 'senior', 'lead', 'head'];
const VF_FORMATS = ['remote', 'hybrid', 'office'];
const VF_SPECS = [
    'backend', 'frontend', 'mobile', 'qa', 'devops', 'data',
    'analytics', 'design', 'management', 'security', 'support', 'onec',
];

const VF_LEVEL_RULES = [
    ['head', '~\bhead\b|\bcto\b|\bcpo\b|\bvp\b|директор|(^|[^а-яё])(руководитель|начальник)([^а-яё]|$)~iu'],
    ['lead', '~\b(team\s*|tech\s*)?lead\b|\blead\b|тимлид|техлид|(^|[^а-яё])ведущ(ий|ая|его)([^а-яё]|$)~iu'],
    ['intern', '~\bintern(ship)?\b|\btrainee\b|стаж[её]р|стажировк|практикант~iu'],
    ['junior', '~\bjunior\b|\bjun\b|(^|[^а-яё])младш(ий|ая|его)([^а-яё]|$)|без опыта~iu'],
    ['senior', '~\bsenior\b|\bsr\.?\b|(^|[^а-яё])старш(ий|ая|его)([^а-яё]|$)~iu'],
    ['middle', '~\bmiddle\b|\bmid\b~iu'],
];

/** Уровень по названию вакансии; null — в названии уровня нет. */
function vf_level(string $title): ?string
{
    $t = trim($title);
    if ($t === '') return null;
    foreach (VF_LEVEL_RULES as [$level, $re]) if (preg_match($re, $t)) return $level;
    return null;
}

const VF_REMOTE_RE = '~удал[её]нн|удал[её]нк|\bremote\b|из дома|home office~iu';
const VF_HYBRID_RE = '~гибрид|\bhybrid\b|\bmixed\b~iu';
const VF_OFFICE_RE = '~(^|[^а-яё])(офис|в офисе|офисн)|\boffice\b~iu';

/**
 * Формат по графику, а если там пусто — по тексту вакансии. Гибрид раньше
 * «удалёнки» и «офиса»: «гибрид: 3 дня в офисе» — это гибрид, а не офис.
 */
function vf_format(?string $schedule, ?string $text = null): ?string
{
    foreach ([$schedule ?? '', $text ?? ''] as $s) {
        if (trim($s) === '') continue;
        if (preg_match(VF_HYBRID_RE, $s)) return 'hybrid';
        if (preg_match(VF_REMOTE_RE, $s)) return 'remote';
        if (preg_match(VF_OFFICE_RE, $s)) return 'office';
    }
    return null;
}

// Порядок важен: первое совпавшее правило побеждает — см. комментарий в
// vacancyFacets.ts к SPEC_RULES, здесь то же самое дословно.
const VF_SPEC_RULES = [
    [['onec'], '~(^|[^a-zа-яё0-9])1[сc]([^a-zа-яё0-9]|$)~iu'],
    [['security'], '~\bsecurity\b|безопасност|\bpentest\b|\bappsec\b|\bdevsecops\b|soc[\s-]*аналитик~iu'],
    [['frontend', 'backend'], '~\bfull[\s-]?stack\b|фулстек|фулстак~iu'],
    [['devops'], '~\bdevops\b|\bsre\b|site\s+reliability|platform\s+engineer|инфраструктур|системн\S* администратор|\bsysadmin\b|kubernetes~iu'],
    [['qa'], '~\bqa\b|\baqa\b|\bsdet\b|тестировщик|тестирован|test\s+engineer~iu'],
    [['mobile'], '~\bios\b|\bandroid\b|\bmobile\b|мобильн|\bflutter\b|react[\s-]?native~iu'],
    [['data'], '~data\s*scien|machine\s+learning|\bml\b|машинн|data\s+engineer|инженер данных|\bdwh\b|big\s+data|\bnlp\b|computer\s+vision|\bllm\b~iu'],
    [['analytics'], '~аналитик|analyst|\bbi\b~iu'],
    [['design'], '~дизайн|designer|\bux\b|ui/ux~iu'],
    [['frontend'], '~frontend|front-end|фронтенд|\breact\b|\bvue\b|\bangular\b|верстальщик~iu'],
    [['management'], '~product\s+manager|продакт|project\s+manager|проджект|руководител\S* проект|delivery\s+manager|\bscrum\b|\bcto\b|head\s+of~iu'],
    [['support'], '~поддержк|\bsupport\b|helpdesk|service\s+desk~iu'],
    [['backend'], '~backend|back-end|бэкенд|бекенд|\bjava\b|golang|\bgo\b|\bpython\b|\bphp\b|c#|\.net|c\+\+|\bnode\b|\bruby\b|\bscala\b|\brust\b|\bkotlin\b~iu'],
];

/** Специализации по названию вакансии; неизвестное название — пустой список. */
function vf_specs(string $title): array
{
    $t = trim($title);
    if ($t === '') return [];
    foreach (VF_SPEC_RULES as [$specs, $re]) if (preg_match($re, $t)) return $specs;
    return [];
}
