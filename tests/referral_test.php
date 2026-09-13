<?php
// Реферальная программа: кому и когда причитается.
//
// Ошибка здесь стоит денег в обе стороны: не заплатить человеку, который
// привёл работника, или заплатить дважды за одного и того же. Поэтому
// проверяем не «функция вернула массив», а каждое правило по отдельности.

require_once __DIR__ . '/../php-proxy/referral.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// ── Код приглашения ───────────────────────────────────────────────────────────
$codes = [];
for ($i = 0; $i < 200; $i++) $codes[] = ref_code_new();
check('код нужной длины', strlen($codes[0]) === REF_CODE_LEN);
check('код из разрешённых знаков',
    count(array_filter($codes, fn($c) => (bool)preg_match('~^[' . REF_ALPHABET . ']+$~', $c))) === 200);
// Похожие знаки убраны намеренно: код набирают руками и читают вслух.
// Строчная l похожа на 1, но код приводится к верхнему регистру, а
// заглавная L ни с чем не путается. Убраны именно неразличимые пары.
check('нет похожих знаков', !preg_match('~[O0I1]~', REF_ALPHABET));
check('коды не повторяются', count(array_unique($codes)) === 200);

check('регистр приводится', ref_code_normalize('abcdefgh') === 'ABCDEFGH');
check('пробелы обрезаются', ref_code_normalize('  ABCDEFGH  ') === 'ABCDEFGH');
check('короткий код отвергнут', ref_code_normalize('ABC') === null);
check('длинный код отвергнут', ref_code_normalize('ABCDEFGHI') === null);
check('запрещённый знак отвергнут', ref_code_normalize('ABCDEFG0') === null);
check('пустой код отвергнут', ref_code_normalize('') === null);

// ── Кого можно записать как приглашённого ─────────────────────────────────────
check('обычное приглашение', ref_can_attribute('inviter', 'invitee', false, null)['ok'] === true);
// Первое, что сделает всякий, кто увидит вознаграждение.
check('сам себя привести нельзя', ref_can_attribute('me', 'me', false, null)['ok'] === false);
// Иначе человек, работающий у нас год, в любой момент «вспомнил» бы, кто его
// привёл — и привёл бы кто угодно.
check('уже зарегистрированного не приписать', ref_can_attribute('inviter', 'invitee', true, null)['ok'] === false);
check('переписать приглашение нельзя', ref_can_attribute('new', 'invitee', false, 'old')['ok'] === false);
check('без кода приглашения нет', ref_can_attribute(null, 'invitee', false, null)['ok'] === false);
check('пустой код — тоже без кода', ref_can_attribute('', 'invitee', false, null)['ok'] === false);
check('без приглашённого нет приглашения', ref_can_attribute('inviter', '', false, null)['ok'] === false);
// Причина нужна не человеку, а отчёту: это разница между «программа не
// работает» и «программа работает, а код был свой».
check('у отказа есть причина', ref_can_attribute('me', 'me', false, null)['reason'] !== '');
check('у согласия причины нет', ref_can_attribute('a', 'b', false, null)['reason'] === '');

// ── Когда причитается вознаграждение ──────────────────────────────────────────
check('за отработанную смену причитается',
    ref_should_award('worked', 'inviter', 'worker', false)['ok'] === true);

// ГЛАВНОЕ: платим за выход, а не за отклик. Прямой урок Jobr — там платили за
// каждый свайп вправо, к партнёрам полетели пустые отклики, партнёры
// отключили фиды. Ни один итог, кроме отработанной смены, платить не должен.
foreach (['no_show', 'worker_cancelled', 'employer_cancelled', 'other_cancelled',
          'cancelled_legacy', '', 'applied', 'matched'] as $outcome) {
    check("за итог «{$outcome}» не платим",
        ref_should_award($outcome, 'inviter', 'worker', false)['ok'] === false);
}

check('без приглашения не платим', ref_should_award('worked', null, 'worker', false)['ok'] === false);
check('пустое приглашение — не приглашение', ref_should_award('worked', '', 'worker', false)['ok'] === false);
check('приглашение само на себя не платит', ref_should_award('worked', 'me', 'me', false)['ok'] === false);
// Платим за первую смену, а не за каждую: иначе это доля с чужого заработка,
// и стоимость программы перестаёт быть предсказуемой.
check('дважды за одного не платим', ref_should_award('worked', 'inviter', 'worker', true)['ok'] === false);

// ── Начисление действительно висит на выходе на смену ─────────────────────────
// Функцию легко написать и забыть подключить. Оба места, где выставляется
// shift_completed, должны её звать.
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
check('правило подключено к db.php', str_contains($db, "require_once __DIR__ . '/referral.php';"));
check('начисление считается по итогу смены', substr_count($db, 'ref_should_award(') >= 1);
check('начисление зовётся из отметки об итоге', str_contains($db, 'jt_referral_on_outcome('));
check('оба пути отметки покрыты', substr_count($db, 'jt_referral_on_outcome(') >= 3);
// invited_by задаёт сервер по коду, а не клиент полем в профиле: иначе любой
// пропишет себе кого угодно запросом на пять минут.
check('invited_by не в списке правимых клиентом',
    !preg_match("~\\\$editable = \\[[^\\]]*invited_by~s", $db));
check('invited_by не задаётся при создании из профиля',
    !preg_match("~\\\$atCreate = \\[[^\\]]*invited_by~s", $db));

// ── Смену закрывает работодатель, а не кто угодно ─────────────────────────────
// dbSetShiftOutcome требует входа, но НЕ проверяет, чья смена. Без отдельной
// проверки программа печатала бы деньги: две свои учётки, два номера — и
// вознаграждение начислено без единого настоящего выхода на смену.
check('начисление сверяет закрывшего с работодателем',
    str_contains($db, '$byUserId !== $employerId'));
// outcome_by присылает клиент и доказывает ровно ничего — берём подписанную
// сессию.
check('берётся подписанная сессия, а не поле из запроса',
    str_contains($db, 'jt_referral_on_outcome((string)$lid, $out, $authUid)')
    && !str_contains($db, '$opts[\'by\']) ?? null,'));
check('работник сам себе работодателем не бывает',
    str_contains($db, '$employerId === $workerId'));

// ── База стережёт то же, что и код ────────────────────────────────────────────
// Проверка в коде не остановит гонку двух одновременных отметок об окончании
// смены, а запрет в базе остановит.
$mig = (string)file_get_contents(__DIR__ . '/../supabase/migrations/064_referral_programme.sql');
check('одно начисление на приглашённого',
    str_contains($mig, 'create unique index if not exists jm_referral_rewards_invitee_key'));
check('сам себя привести нельзя и в базе', str_contains($mig, 'invited_by <> id'));
check('начисление самому себе запрещено в базе', str_contains($mig, 'inviter_id <> invitee_id'));
check('код приглашения уникален', str_contains($mig, 'jm_users_referral_code_key'));
// Сумма не проставляется кодом: её назначает владелец, и событие заводится
// до того, как цена решена.
check('начисление заводится ожидающим', str_contains($mig, "default 'pending'"));
check('таблица закрыта политиками', str_contains($mig, 'enable row level security'));
// Служебная таблица не должна утечь в публичную выдачу.
$api = (string)file_get_contents(__DIR__ . '/../php-proxy/api.php');
check('начисления не отдаются наружу', !str_contains($api, 'jm_referral_rewards'));

if ($failures) {
    echo "referral: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "referral: OK\n";
