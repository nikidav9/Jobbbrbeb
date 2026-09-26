<?php
// Согласие на рекламную рассылку (38-ФЗ, ст. 18; решение владельца 26.09).
//
// Что здесь сторожится:
//   • согласие отдельное и необязательное: галочки по умолчанию сняты, в
//     набор обязательных документов (LEGAL_KEYS) оно не входит;
//   • каждое решение — новая строка, действует последнее; «да» считается
//     только на текущую редакцию документа;
//   • строка одного лишь согласия на рекламу НЕ выглядит как общее согласие
//     на обработку ПДн (им Юпитер подтверждает анкету, по нему решают,
//     спрашивать ли документы заново);
//   • чужое согласие не прочитать и не поменять ($selfArgFns);
//   • редакция на сервере и в тексте документа одна.

$root = __DIR__ . '/..';
$db = (string)file_get_contents("$root/php-proxy/db.php");
$legal = (string)file_get_contents("$root/constants/legal.ts");
$ctx = (string)file_get_contents("$root/contexts/AppContext.tsx");
$gate = (string)file_get_contents("$root/components/ConsentGate.tsx");
$settings = (string)file_get_contents("$root/app/profile-settings.tsx");

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function fn_src(string $src, string $name): string
{
    $start = strpos($src, "function {$name}(");
    if ($start === false) return '';
    $end = strpos($src, "\n}\n", $start);
    return substr($src, $start, $end - $start + 2);
}

function case_src(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}': {");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return substr($src, $start, ($end === false ? strlen($src) : $end) - $start);
}

// ── Поведение записи и статуса на заглушке базы ─────────────────────────────
$T = ['jm_consents' => []];
$clock = 0;
function now_iso(): string
{
    global $clock;
    $clock++;
    return gmdate('Y-m-d\TH:i:s', 1790000000 + $clock) . '.000Z';
}
function sb_insert(string $t, array $row, bool $ret = false): array
{
    $GLOBALS['T'][$t][] = $row;
    return [];
}
function sb_select(string $t, array $f = [], string $sel = '*', ?string $ord = null): array
{
    $rows = array_values(array_filter($GLOBALS['T'][$t] ?? [], function ($r) use ($f) {
        foreach ($f as $k => $v) {
            if ($k === 'limit') continue;
            if (str_starts_with($v, 'eq.') && (string)($r[$k] ?? '') !== substr($v, 3)) return false;
            if (str_starts_with($v, 'like.')) {
                $prefix = rtrim(substr($v, 5), '*');
                if (!str_starts_with((string)($r[$k] ?? ''), $prefix)) return false;
            }
        }
        return true;
    }));
    if ($ord === 'accepted_at.desc') usort($rows, fn($a, $b) => strcmp($b['accepted_at'], $a['accepted_at']));
    if (isset($f['limit'])) $rows = array_slice($rows, 0, (int)$f['limit']);
    return $rows;
}

preg_match("~define\('JT_MARKETING_CONSENT_VERSION', '([0-9-]+)'\);~", $db, $m);
$serverVersion = $m[1] ?? '';
check('редакция на сервере задана', $serverVersion !== '');
define('JT_MARKETING_CONSENT_VERSION', $serverVersion);
$record = fn_src($db, 'jt_marketing_record');
$status = fn_src($db, 'jt_marketing_status');
check('функции записи и статуса найдены', $record !== '' && $status !== '');
eval($record . $status);

check('без решения — выключено', jt_marketing_status('u1')['on'] === false);

jt_marketing_record('u1', true, 'registration');
$st = jt_marketing_status('u1');
check('дал при регистрации — включено', $st['on'] === true && $st['source'] === 'marketing:registration');

jt_marketing_record('u1', false, 'settings');
check('отозвал — выключено', jt_marketing_status('u1')['on'] === false);
check('отзыв помечен как отзыв', jt_marketing_status('u1')['source'] === 'marketing:revoked');

jt_marketing_record('u1', true, 'settings');
check('дал снова — включено', jt_marketing_status('u1')['on'] === true);
check('история не перезаписывается: три решения — три строки',
    count(array_filter($T['jm_consents'], fn($r) => $r['user_id'] === 'u1')) === 3);
check('у строк разные идентификаторы',
    count(array_unique(array_column($T['jm_consents'], 'id'))) === count($T['jm_consents']));

check('чужое решение не влияет', jt_marketing_status('u2')['on'] === false);

// Согласие на прежнюю редакцию не покрывает рассылку по новой.
$T['jm_consents'][] = [
    'id' => 'mk:u3:old', 'user_id' => 'u3', 'stamp' => 'marketing:2020-01-01',
    'docs' => ['marketing' => '2020-01-01', 'on' => true],
    'source' => 'marketing:settings', 'accepted_at' => now_iso(),
];
check('согласие на старую редакцию не действует', jt_marketing_status('u3')['on'] === false);

// Строки общего согласия и трансграничные статус рекламы не трогают.
$T['jm_consents'][] = [
    'id' => 'u4:x', 'user_id' => 'u4', 'stamp' => 'terms:2026-09-26|privacy:2026-09-26|consent:2026-09-26',
    'docs' => [], 'source' => 'registration', 'accepted_at' => now_iso(),
];
check('общее согласие не равно согласию на рекламу', jt_marketing_status('u4')['on'] === false);

// ── Отделение от общего согласия ────────────────────────────────────────────
check('фильтр общего согласия исключает рекламу и трансграничное',
    str_contains($db, "const JT_CORE_CONSENT_FILTER = '(source.not.like.crossborder:*,source.not.like.marketing:*)';"));
check('dbGetConsent читает только общее согласие',
    str_contains(case_src($db, 'dbGetConsent'), "'and'     => JT_CORE_CONSENT_FILTER"));
check('старый фильтр «только не трансграничное» больше нигде не используется',
    !str_contains($db, "'source'  => 'not.like.crossborder:%'"));
check('Юпитер подтверждает согласие только общим',
    substr_count($db, "'and'     => JT_CORE_CONSENT_FILTER") >= 3);

// ── Права ───────────────────────────────────────────────────────────────────
check('dbSetMarketingConsent — только о себе',
    str_contains($db, "'dbSetMarketingConsent' => 0, 'dbGetMarketingConsent' => 0,"));
$publicStart = strpos($db, '$publicFns = [');
$publicList = substr($db, $publicStart, strpos($db, '];', $publicStart) - $publicStart);
check('функции рекламы не публичные',
    !str_contains($publicList, 'Marketing'));
$adminStart = strpos($db, '$adminFns = [');
$adminList = substr($db, $adminStart, strpos($db, '];', $adminStart) - $adminStart);
check('статистика — только администратору', str_contains($adminList, "'adminMarketingStats'"));
$stats = case_src($db, 'adminMarketingStats');
check('статистика не отдаёт адресов', $stats !== '' && !str_contains($stats, 'email'));

$set = case_src($db, 'dbSetMarketingConsent');
check('включить можно только на текущую редакцию',
    str_contains($set, "if (\$on && !hash_equals(JT_MARKETING_CONSENT_VERSION"));
check('включение — только строгое true', str_contains($set, '$on = ($args[1] ?? false) === true;'));
check('источник из белого списка',
    str_contains($set, "['registration', 'reconsent', 'settings']"));
check('повтор того же решения строк не плодит',
    str_contains($set, "if (jt_marketing_status(\$uid)['on'] !== \$on) jt_marketing_record("));

$attach = fn_src($db, 'jt_consent_attach');
check('регистрация пишет рекламу только при галочке и верной редакции',
    str_contains($attach, "hash_equals(JT_MARKETING_CONSENT_VERSION, \$mkVersion)")
    && str_contains($attach, "jt_marketing_record(\$uid, true, 'registration')"));

// ── Документ и клиент ───────────────────────────────────────────────────────
$mStart = strpos($legal, '  marketing: {');
check('документ marketing есть', $mStart !== false);
$mDoc = substr($legal, (int)$mStart, 400);
check('редакция документа совпадает с сервером', str_contains($mDoc, "version: '{$serverVersion}'"));
$keys = substr($legal, strpos($legal, 'export const LEGAL_KEYS'), 120);
check('реклама не входит в обязательные документы', !str_contains($keys, 'marketing'));
check('документ называет закон о рекламе', str_contains($legal, '№ 38-ФЗ «О рекламе»'));
check('документ: только о самом JobToo',
    str_contains($legal, 'Реклама товаров и услуг третьих лиц в рамках настоящего согласия не направляется'));

foreach (['register-worker', 'register-employer'] as $screen) {
    $src = (string)file_get_contents("$root/app/$screen.tsx");
    check("$screen: галочка по умолчанию снята", str_contains($src, 'const [adsAgreed, setAdsAgreed] = useState(false);'));
    check("$screen: реклама не блокирует «Продолжить»",
        str_contains($src, 'disabled={!agreed || !pdAgreed}') && !str_contains($src, 'disabled={!agreed || !pdAgreed || !adsAgreed}'));
    check("$screen: решение уходит в регистрацию", str_contains($src, '{ marketing: adsAgreed }'));
}
check('регистрация передаёт редакцию только при галочке',
    str_contains($ctx, 'opts?.marketing ? { marketingVersion: LEGAL_DOCS.marketing.version } : {}'));
check('окно документов: галочка рекламы снята по умолчанию',
    str_contains($gate, 'const [adsAccepted, setAdsAccepted] = useState(false);'));
check('окно документов: реклама не держит кнопку «Принять»',
    str_contains($gate, 'disabled={busy || !termsAccepted || !coreAccepted}'));
check('настройки: переключатель пишет решение на сервер',
    str_contains($settings, "dbSetMarketingConsent(currentUser.id, next, LEGAL_DOCS.marketing.version, 'settings')"));

if ($failures) {
    fwrite(STDERR, "marketing consent FAILED:\n  - " . implode("\n  - ", $failures) . "\n");
    exit(1);
}
echo "marketing consent: OK\n";
