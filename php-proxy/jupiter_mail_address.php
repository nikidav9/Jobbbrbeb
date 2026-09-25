<?php
// Читаемый адрес «Почты JobToo»: ivan.petrov@jobtoo.ru.
//
// Здесь только чистые функции — без базы, чтобы их можно было проверить
// тестом (tests/jupiter_mail_address_test.php). Выдачу и проверку занятости
// делает jt_jupiter_mailbox() в db.php.

const JT_MAIL_DOMAIN = 'jobtoo.ru';

// Служебные имена домена: их нельзя отдавать человеку, иначе ему пойдут
// письма, адресованные JobToo.
const JT_MAIL_RESERVED = [
    'abuse', 'admin', 'administrator', 'billing', 'contact', 'help',
    'hostmaster', 'hr', 'info', 'jobtoo', 'mail', 'mailer-daemon',
    'no-reply', 'noreply', 'postmaster', 'privacy', 'root', 'security',
    'support', 'team', 'test', 'user', 'webmaster',
];

/** Кириллица → латиница. Ж, Х, Щ — как в загранпаспорте; Ю, Я, Й — привычно (yu, ya, y). */
function jt_mail_translit(string $s): string
{
    static $map = [
        'а' => 'a', 'б' => 'b', 'в' => 'v', 'г' => 'g', 'д' => 'd', 'е' => 'e',
        'ё' => 'e', 'ж' => 'zh', 'з' => 'z', 'и' => 'i', 'й' => 'y', 'к' => 'k',
        'л' => 'l', 'м' => 'm', 'н' => 'n', 'о' => 'o', 'п' => 'p', 'р' => 'r',
        'с' => 's', 'т' => 't', 'у' => 'u', 'ф' => 'f', 'х' => 'kh', 'ц' => 'ts',
        'ч' => 'ch', 'ш' => 'sh', 'щ' => 'shch', 'ъ' => '', 'ы' => 'y', 'ь' => '',
        'э' => 'e', 'ю' => 'yu', 'я' => 'ya',
    ];
    $s = strtr(mb_strtolower(trim($s), 'UTF-8'), $map);
    // Пробел и дефис внутри имени («Анна-Мария», «Анна Мария») — дефис.
    $s = preg_replace('~[\s\-]+~u', '-', $s);
    $s = preg_replace('~[^a-z0-9\-]~', '', $s);
    return trim(preg_replace('~-{2,}~', '-', $s), '-');
}

/** Основа адреса: имя.фамилия; одно из двух — оно само; пусто — ''. */
function jt_mail_base(string $firstName, string $lastName): string
{
    $parts = array_values(array_filter(
        [jt_mail_translit($firstName), jt_mail_translit($lastName)],
        fn($p) => $p !== ''
    ));
    return substr(implode('.', $parts), 0, 40);
}

/**
 * Кандидаты по порядку: основа, основа2 … основа30, дальше — основа с
 * четырьмя случайными цифрами. Пустая или служебная основа — сразу
 * user + цифры. $random подменяется в тесте.
 */
function jt_mail_candidates(string $base, ?callable $random = null): array
{
    $random = $random ?? fn() => (string)random_int(1000, 9999);
    if ($base === '' || in_array($base, JT_MAIL_RESERVED, true) || str_starts_with($base, 'u-')) {
        $out = [];
        for ($i = 0; $i < 8; $i++) $out[] = 'user' . $random();
        return $out;
    }
    $out = [$base];
    for ($i = 2; $i <= 30; $i++) $out[] = $base . $i;
    for ($i = 0; $i < 5; $i++) $out[] = $base . '.' . $random();
    return $out;
}
