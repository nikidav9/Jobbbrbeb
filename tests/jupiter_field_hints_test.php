<?php
// Подсказки YandexGPT телефонному автопилоту (01.10.2026). Сторож двух правил:
// модель не видит данных человека (только подписи полей, и те — после
// вычёркивания), и ответ модели — только ключ из разрешённого списка.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

require __DIR__ . '/../php-proxy/jupiter_field_hints.php';

// Вычёркивание: почта, телефон, длинные числа, ФИО, ссылки с параметрами.
$r = jt_fh_redact('Иванов Иван Иванович ivan@mail.ru +7 (999) 123-45-67 1234567890 https://x.ru/a?token=1');
check('почта вычеркнута', !str_contains($r, 'ivan@mail.ru'));
check('телефон вычеркнут', !str_contains($r, '123-45-67'));
check('длинное число вычеркнуто', !str_contains($r, '1234567890'));
check('ФИО вычеркнуто', !str_contains($r, 'Иванов'));
check('ссылка с параметрами вычеркнута', !str_contains($r, 'token='));
check('подпись анкеты остаётся', jt_fh_redact('Фамилия Имя Отчество') === 'Фамилия Имя Отчество');

// Чистка запроса: странная подпись поля отбрасывается, лишнее режется.
$f = jt_fh_clean_fields([
    ['sig' => 'город проживания|city', 'label' => 'Город проживания', 'name' => 'city', 'type' => 'text'],
    ['sig' => "<script>|x", 'label' => 'x'],
    ['sig' => 'ваш ник|nick', 'label' => 'Ваш ник: Петров Пётр', 'options' => ['a', 'b']],
]);
check('чистится список полей', count($f) === 2);
check('ФИО из подписи не уходит в модель', !str_contains($f[1]['label'], 'Петров'));

// Запрос к модели — только подписи и допустимые ключи.
[$sys, $user] = jt_fh_prompt($f, 'Careers.Example.ru/');
check('в запросе есть список ключей', str_contains($sys, 'desired_role'));
check('сайт в запросе нормализован', str_contains($user, 'Сайт: careers.example.ru'));
check('поля под условными f0…', str_contains($user, 'f0:') && str_contains($user, 'f1:'));

// Ответ модели: только ключ из списка, только f0…fN.
$p = jt_fh_parse("```json\n{\"f0\": \"city\", \"f1\": \"password\", \"f9\": \"email\"}\n```", $f);
check('ключ из списка принят', $p['город проживания|city'] === 'city');
check('ключ не из списка отброшен', $p['ваш ник|nick'] === null);
check('лишние f-номера не попадают', count($p) === 2);
check('мусор вместо JSON — все null', jt_fh_parse('не знаю', $f) === ['город проживания|city' => null, 'ваш ник|nick' => null]);

// Сервер: функция требует входа (не в $publicFns), сигнал записывается в
// таблицу, сбой модели не превращается в «ответ».
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$pub = substr($db, (int)strpos($db, '$publicFns = ['), 1200);
check('без входа не доступна', !str_contains($pub, 'jupiterFieldHints'));
$case = substr($db, (int)strpos($db, "case 'jupiterFieldHints':"), 3500);
check('спрашивает модель только о незнакомом', str_contains($case, 'jt_fh_ask_gpt($unknown, $host)'));
check('pending переспрашивается', str_contains($case, "=== 'pending') continue;"));
check('лимит на адрес', str_contains($case, "jt_try_blocked('gpt')"));
check('запрос к YandexGPT не хранится у Яндекса (x-data-logging-enabled: false)',
    str_contains((string)file_get_contents(__DIR__ . '/../php-proxy/jupiter_field_hints.php'), "'x-data-logging-enabled: false'"));
check('незнакомое записывается для разбора', str_contains($case, "sb_upsert('jm_jupiter_field_hints'"));

$mig = (string)@file_get_contents(__DIR__ . '/../supabase/migrations/141_jupiter_field_hints.sql');
check('таблица закрыта RLS', str_contains($mig, 'enable row level security') && str_contains($mig, 'revoke all'));

// Телефон подставляет только ключ, который есть в профиле.
$ap = (string)file_get_contents(__DIR__ . '/../services/jupiterAutopilot.ts');
check('подсказка — только ключ профиля', str_contains($ap, 'Object.prototype.hasOwnProperty.call(CFG.profile, h)'));
check('сигнал без значений полей', str_contains($ap, "post({ type: 'jt-autopilot-hints', fields: unknown })")
    && !preg_match('~out\.push\(\{[^}]*value~', $ap));

if ($failures) {
    echo "jupiter_field_hints: ПРОВАЛЫ\n";
    foreach ($failures as $x) echo "  - $x\n";
    exit(1);
}
echo "jupiter_field_hints: OK\n";
