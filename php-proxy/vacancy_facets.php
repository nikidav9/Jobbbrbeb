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
//
// Модификатор (*UTF) вместо флага u — сознательно. Флаг /u включает в PCRE ещё
// и UCP (Unicode-свойства для \b/\w), и тогда кириллица считается «буквой
// слова»: склеенные без пробела «Pythonразработчик», «MLинженер»,
// «DevOpsинженер», «iOSразработчик», «LeadРазработчик» не давали границы между
// латиницей и кириллицей, и \bpython\b не срабатывал. В JS \b кириллицу
// словом не считает никогда — паритета с ним нет. (*UTF) включает только
// разбор UTF-8 и регистронезависимое сравнение кириллицы (см. i), но не UCP:
// \b ведёт себя как в JS, склеенные слова находятся.

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
    ['head', '~(*UTF)\bhead\b|\bcto\b|\bcpo\b|\bvp\b|директор|(^|[^а-яё])(руководитель|начальник)([^а-яё]|$)~i'],
    ['lead', '~(*UTF)\b(team\s*|tech\s*)?lead\b|\blead\b|тимлид|техлид|(^|[^а-яё])ведущ(ий|ая|его)([^а-яё]|$)~i'],
    ['intern', '~(*UTF)\bintern(ship)?\b|\btrainee\b|стаж[её]р|стажировк|практикант~i'],
    ['junior', '~(*UTF)\bjunior\b|\bjun\b|(^|[^а-яё])младш(ий|ая|его)([^а-яё]|$)|без опыта~i'],
    ['senior', '~(*UTF)\bsenior\b|\bsr\.?\b|(^|[^а-яё])старш(ий|ая|его)([^а-яё]|$)~i'],
    ['middle', '~(*UTF)\bmiddle\b|\bmid\b~i'],
];

/** Уровень по названию вакансии; null — в названии уровня нет. */
function vf_level(string $title): ?string
{
    $t = trim($title);
    if ($t === '') return null;
    foreach (VF_LEVEL_RULES as [$level, $re]) if (preg_match($re, $t)) return $level;
    return null;
}

const VF_REMOTE_RE = '~(*UTF)удал[её]нн|удал[её]нк|\bremote\b|из дома|home office~i';
const VF_HYBRID_RE = '~(*UTF)гибрид|\bhybrid\b|\bmixed\b~i';
const VF_OFFICE_RE = '~(*UTF)(^|[^а-яё])(офис|в офисе|офисн)|\boffice\b~i';

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
    [['onec'], '~(*UTF)(^|[^a-zа-яё0-9])1[сc]([^a-zа-яё0-9]|$)~i'],
    [['security'], '~(*UTF)\bsecurity\b|безопасност|\bpentest\b|\bappsec\b|\bdevsecops\b|soc[\s-]*аналитик~i'],
    [['frontend', 'backend'], '~(*UTF)\bfull[\s-]?stack\b|фулстек|фулстак~i'],
    [['devops'], '~(*UTF)\bdevops\b|\bsre\b|site\s+reliability|platform\s+engineer|инфраструктур|системн\S* администратор|\bsysadmin\b|kubernetes~i'],
    [['qa'], '~(*UTF)\bqa\b|\baqa\b|\bsdet\b|тестировщик|тестирован|test\s+engineer~i'],
    [['mobile'], '~(*UTF)\bios\b|\bandroid\b|\bmobile\b|мобильн|\bflutter\b|react[\s-]?native~i'],
    [['data'], '~(*UTF)data\s*scien|machine\s+learning|\bml\b|машинн|data\s+engineer|инженер данных|\bdwh\b|big\s+data|\bnlp\b|computer\s+vision|\bllm\b~i'],
    [['analytics'], '~(*UTF)аналитик|analyst|\bbi\b~i'],
    [['design'], '~(*UTF)дизайн|designer|\bux\b|ui/ux~i'],
    [['frontend'], '~(*UTF)frontend|front-end|фронтенд|\breact\b|\bvue\b|\bangular\b|верстальщик~i'],
    [['management'], '~(*UTF)product\s+manager|продакт|project\s+manager|проджект|руководител\S* проект|delivery\s+manager|\bscrum\b|\bcto\b|head\s+of~i'],
    [['support'], '~(*UTF)поддержк|\bsupport\b|helpdesk|service\s+desk~i'],
    [['backend'], '~(*UTF)backend|back-end|бэкенд|бекенд|\bjava\b|golang|\bgo\b|\bpython\b|\bphp\b|c#|\.net|c\+\+|\bnode\b|\bruby\b|\bscala\b|\brust\b|\bkotlin\b~i'],
];

/** Специализации по названию вакансии; неизвестное название — пустой список. */
function vf_specs(string $title): array
{
    $t = trim($title);
    if ($t === '') return [];
    foreach (VF_SPEC_RULES as [$specs, $re]) if (preg_match($re, $t)) return $specs;
    return [];
}
