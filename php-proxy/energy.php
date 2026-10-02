<?php
// Дневной запас откликов («молнии») на сервере (решение владельца 02.10.2026).
//
// Раньше счётчик жил только в телефоне (hooks/useEnergy.ts): переустановка,
// второе устройство, сайт и мини-приложение давали каждый свои 20, а сервер
// принимал отклик без счёта. Теперь сервер сам считает отклики человека за
// московские сутки — по датам создания заявок Юпитера и откликов на свои
// вакансии, отдельной таблицы не нужно. Повтор уже существующего отклика
// бесплатен: он ничего нового работодателю не отправляет.

/** Сколько откликов в сутки. Совпадает с DAILY_ENERGY в services/energy.ts. */
const JT_DAILY_APPLIES = 10;
const JT_ENERGY_EMPTY = 'На сегодня отклики закончились: их 10 в сутки. Новые появятся в полночь по Москве.';

/** Начало текущих московских суток — в UTC, как хранит база. */
function jt_energy_since(?DateTimeImmutable $now = null): string
{
    $tz = new DateTimeZone('Europe/Moscow');
    $now = ($now ?? new DateTimeImmutable('now'))->setTimezone($tz);
    return $now->setTime(0, 0)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

/** Остаток по числу уже сделанных откликов. */
function jt_energy_left(int $used): int
{
    return max(0, JT_DAILY_APPLIES - $used);
}

/** Сколько откликов человек сделал за сегодня — на всех устройствах. */
function jt_energy_used(string $uid): int
{
    $since = 'gte.' . jt_energy_since();
    return sb_count('jm_jupiter_applications', ['user_id' => 'eq.' . $uid, 'created_at' => $since])
        + sb_count('jm_perm_applications', ['worker_id' => 'eq.' . $uid, 'created_at' => $since]);
}

/** Отказать новому отклику, если запас кончился. */
function jt_energy_require(string $uid): void
{
    if (jt_energy_left(jt_energy_used($uid)) > 0) return;
    jt_respond(['error' => JT_ENERGY_EMPTY, 'code' => 'ENERGY_EMPTY'], 429);
    exit;
}
