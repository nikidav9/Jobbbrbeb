<?php
// Реферальная программа: кому и что записывается.
//
// Денег в ней нет — решение владельца. Вознаграждение — поручительство,
// которое видно работодателю на карточке, и ошибка здесь портит человеку
// репутацию в обе стороны: не записать заслуженный выход или приписать чужой.
// Поэтому проверяем не «функция вернула массив», а каждое правило отдельно.

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

// ── Что записывается в поручительство ─────────────────────────────────────────
check('отработанная смена записывается',
    ref_should_record('worked', 'inviter', 'worker', false)['ok'] === true);
// Невыход записывается ТОЖЕ, и это не строгость, а то, без чего первое число
// ничего не стоит: считай мы одни выходы, карточка набивалась бы рассылкой
// кода сотне незнакомых людей.
check('невыход записывается',
    ref_should_record('no_show', 'inviter', 'worker', false)['ok'] === true);

// ГЛАВНОЕ: считаем итог смены, а не отклик. Прямой урок Jobr — там платили за
// каждый свайп вправо, к партнёрам полетели пустые отклики, партнёры
// отключили фиды. Ни один итог, кроме состоявшейся или несостоявшейся смены,
// в поручительство не идёт. Отмена не идёт особо: кто был прав при отмене, из
// строки не видно, а записать её невыходом значило бы испортить поручителю
// разрыв за то, чего не было.
foreach (['worker_cancelled', 'employer_cancelled', 'other_cancelled',
          'cancelled_legacy', '', 'applied', 'matched'] as $outcome) {
    check("итог «{$outcome}» не записываем",
        ref_should_record($outcome, 'inviter', 'worker', false)['ok'] === false);
}

check('без приглашения не записываем', ref_should_record('worked', null, 'worker', false)['ok'] === false);
check('пустое приглашение — не приглашение', ref_should_record('worked', '', 'worker', false)['ok'] === false);
check('приглашение само на себя не записываем', ref_should_record('worked', 'me', 'me', false)['ok'] === false);
// Записываем ПЕРВУЮ смену приглашённого, а не каждую: иначе поручитель копил
// бы чужой стаж как свой, и число на карточке рассказывало бы о трудолюбии
// приведённого, а не о том, кого он умеет звать.
check('дважды за одного не записываем', ref_should_record('worked', 'inviter', 'worker', true)['ok'] === false);
check('и невыход дважды не записываем', ref_should_record('no_show', 'inviter', 'worker', true)['ok'] === false);

// ── Начисление действительно висит на выходе на смену ─────────────────────────
// Функцию легко написать и забыть подключить. Оба места, где выставляется
// shift_completed, должны её звать.
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
check('правило подключено к db.php', str_contains($db, "require_once __DIR__ . '/referral.php';"));
check('запись считается по итогу смены', substr_count($db, 'ref_should_record(') >= 1);
check('запись зовётся из отметки об итоге', str_contains($db, 'jt_referral_on_outcome('));
check('оба пути отметки покрыты', substr_count($db, 'jt_referral_on_outcome(') >= 3);
// invited_by задаёт сервер по коду, а не клиент полем в профиле: иначе любой
// пропишет себе кого угодно запросом на пять минут.
check('invited_by не в списке правимых клиентом',
    !preg_match("~\\\$editable = \\[[^\\]]*invited_by~s", $db));
check('invited_by не задаётся при создании из профиля',
    !preg_match("~\\\$atCreate = \\[[^\\]]*invited_by~s", $db));

// ── Работодатель не зарабатывает на собственных работниках ────────────────────
// Замкнутый круг: работодатель зовёт работника, нанимает, сам закрывает смену
// как отработанную и сам себе начисляет. Постороннего в цепочке нет — значит
// нет и того, за что мы платим.
check('пригласивший-работодатель этой смены не получает',
    ref_should_record('worked', 'boss', 'worker', false, 'boss')['ok'] === false);
check('посторонний пригласивший получает',
    ref_should_record('worked', 'friend', 'worker', false, 'boss')['ok'] === true);
check('без работодателя правило не срабатывает вхолостую',
    ref_should_record('worked', 'friend', 'worker', false, null)['ok'] === true);
// Пустая строка работодателя не должна «совпасть» с чем-либо и погасить
// запись: проверка была бы бессодержательной, если бы отказ приходил по
// другой причине, поэтому пригласивший тут настоящий.
check('пустой работодатель не гасит запись',
    ref_should_record('worked', 'friend', 'worker', false, '')['ok'] === true);
check('работодатель передаётся из строки смены',
    str_contains($db, 'ref_should_record($outcome, $invitedBy, $workerId, $existing !== null, $employerId)'));

// ── Смену закрывает работодатель, а не кто угодно ─────────────────────────────
// dbSetShiftOutcome требует входа, но НЕ проверяет, чья смена. Без отдельной
// проверки программа печатала бы деньги: две свои учётки, два номера — и
// вознаграждение начислено без единого настоящего выхода на смену.
check('запись сверяет закрывшего с работодателем',
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
check('одна запись на приглашённого',
    str_contains($mig, 'create unique index if not exists jm_referral_rewards_invitee_key'));
check('сам себя привести нельзя и в базе', str_contains($mig, 'invited_by <> id'));
check('запись самому себе запрещена в базе', str_contains($mig, 'inviter_id <> invitee_id'));
check('код приглашения уникален', str_contains($mig, 'jm_users_referral_code_key'));
check('таблица закрыта политиками', str_contains($mig, 'enable row level security'));
// Служебная таблица не должна утечь в публичную выдачу.
$api = (string)file_get_contents(__DIR__ . '/../php-proxy/api.php');
check('журнал не отдаётся наружу', !str_contains($api, 'jm_referral_rewards'));

// Искать по всему db.php нельзя: те же строки встречаются в соседних
// функциях, и проверка прошла бы на сломанном коде. Вырезаем нужное тело.
function fn_body(string $src, string $name): string
{
    $start = strpos($src, "function {$name}(");
    if ($start === false) return '';
    $end = strpos($src, "\n}\n", $start);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}
$onOutcome = fn_body($db, 'jt_referral_on_outcome');
check('обработчик итога найден', $onOutcome !== '');

// ── Денег в программе нет ─────────────────────────────────────────────────────
// Решение владельца: платить пока нечем. Обещание вознаграждения без суммы
// читается как обман, и один раз обманутый второго знакомого не позовёт.
// Поэтому денежных следов не должно остаться ни в схеме, ни в коде, ни на
// экране: пока поле есть, кто-нибудь однажды проставит сумму и решит, что её
// кто-то выплатит.
$mig65 = (string)file_get_contents(__DIR__ . '/../supabase/migrations/065_referral_vouching.sql');
foreach (['amount_rub', 'paid_at', 'status'] as $col) {
    check("колонка {$col} убрана", str_contains($mig65, "drop column if exists {$col}"));
}
check('сумма не читается из настроек', !str_contains($db, 'referral_reward_rub'));
// Статус начисления («ожидает решения», «выплачено») был счётом к оплате.
// Счёта больше нет, и колонки тоже — писать в неё значило бы ронять вставку.
check('статус начисления не пишется', !str_contains($onOutcome, "'status'"));
$invite = (string)file_get_contents(__DIR__ . '/../app/invite.tsx');
check('экран не обещает денег', !str_contains($invite, 'rewardRub'));
check('экран говорит об этом прямо', str_contains($invite, 'Денег за приглашение мы не платим'));

// ── Итог смены записывается, и оба ────────────────────────────────────────────
check('итог попадает в журнал', str_contains($onOutcome, "'outcome' => \$outcome,"));
check('колонка итога ограничена базой',
    str_contains($mig65, "check (outcome in ('worked', 'no_show'))"));

// ── Счётчик на карточке ───────────────────────────────────────────────────────
// Ради этого числа программа и существует: денег мы не платим, платит она —
// тем, что её видно работодателю, когда он выбирает из похожих анкет.
check('счётчик заведён в базе',
    str_contains($mig65, 'add column if not exists referral_worked integer not null default 0'));
check('счётчик растёт только на выходе',
    str_contains($onOutcome, "if (\$outcome === 'worked') jt_referral_bump(\$invitedBy, 1);"));
$bump = fn_body($db, 'jt_referral_bump');
check('сдвиг счётчика найден', $bump !== '');
check('счётчик не уходит в минус', str_contains($bump, 'max(0,'));

// ── Ошибочную отметку можно исправить ────────────────────────────────────────
// dbSetShiftOutcome зовётся повторно и рейтинг пересчитывает: работодатель,
// промахнувшийся мимо кнопки, отметку правит. Поручительство до этой ветки
// не правилось — строка про первую смену уже была, и правка молча
// отбрасывалась. «Не вышел» оставался на карточке поручителя навсегда,
// хотя человек вышел.
check('правка итога доходит до поручительства',
    str_contains($onOutcome, "trim((string)(\$existing['like_id'] ?? '')) === \$likeId"));
check('правка двигает счётчик в обе стороны',
    str_contains($onOutcome, "jt_referral_bump(\$invitedBy, \$outcome === 'worked' ? 1 : -1);"));
// Но только та же смена: итог ДРУГОЙ смены — не исправление, а вторая смена,
// а записываем мы первую. Без этого условия счётчик набирался бы стажем
// приведённого, а не умением звать.
check('чужую смену за исправление не принимаем',
    str_contains($onOutcome, "'id,like_id,outcome'"));

// Журнал остаётся источником правды: инкремент можно потерять на гонке двух
// одновременных отметок, и миграция пересчитывает счётчик из журнала.
//
// Пересчёт подзапросом на каждого, а НЕ соединением с группировкой: при
// соединении человек без единой строки 'worked' в него не попадал бы — то
// есть единственный случай, ради которого пересчёт и нужен (счётчик больше
// нуля при нуле поручительств), он бы и пропустил.
check('счётчик пересчитывается из журнала',
    str_contains($mig65, "set referral_worked = (\n     select count(*) from public.jm_referral_rewards r"));
check('пересчёт доходит до раздутых счётчиков',
    !str_contains($mig65, 'group by inviter_id'));
// Число бесполезно, если работодатель его не видит.
check('счётчик уходит в карточку', str_contains($db, "'referral_worked',"));
// Проверяем именно ВЫВОД числа, а не упоминание поля: условие «показывать,
// если больше нуля» содержит то же имя, и проверка на одно имя осталась бы
// зелёной при пустой карточке. Первая попытка так и прошла мутацию.
$cand = (string)file_get_contents(__DIR__ . '/../app/candidates.tsx');
check('карточка кандидата показывает число',
    str_contains($cand, 'Привёл на смену: {worker.referralWorked}'));
check('карточка не показывает ноль',
    str_contains($cand, '{(worker.referralWorked ?? 0) > 0 ? ('));
$prof = (string)file_get_contents(__DIR__ . '/../app/user-profile.tsx');
check('профиль показывает число',
    str_contains($prof, 'Привёл на смену: {user.referralWorked}'));
check('профиль не показывает ноль',
    str_contains($prof, '{(user.referralWorked ?? 0) > 0 ? ('));

if ($failures) {
    echo "referral: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "referral: OK\n";
