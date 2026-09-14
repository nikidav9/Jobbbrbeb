<?php

const SHIFT_OUTCOMES = [
    'worked', 'no_show', 'worker_cancelled',
    'employer_cancelled', 'cancelled_legacy',
];

function shift_application_window(int $now): array
{
    return [
        'from' => gmdate('Y-m-d\TH:i:s\Z', $now - 37 * 86400),
        'to' => gmdate('Y-m-d\TH:i:s\Z', $now - 7 * 86400),
    ];
}

function shift_ratio(int $part, int $total): ?float
{
    if ($total <= 0) return null;
    return max(0, min($part, $total)) / $total;
}

function shift_outcome_line(array $counts): string
{
    $worked = (int)($counts['worked'] ?? 0);
    $noShow = (int)($counts['no_show'] ?? 0);
    $workerCancelled = (int)($counts['worker_cancelled'] ?? 0);
    $employerCancelled = (int)($counts['employer_cancelled'] ?? 0);
    $legacyCancelled = (int)($counts['cancelled_legacy'] ?? 0);
    $cancelled = $workerCancelled + $employerCancelled + $legacyCancelled;

    return "✅ Исходы смен за сутки: вышли <b>{$worked}</b>, не вышли <b>{$noShow}</b>, отменены <b>{$cancelled}</b>"
        . " (работник {$workerCancelled}, работодатель {$employerCancelled}, без причины {$legacyCancelled})";
}

function shift_conversion_line(int $applications, int $worked): string
{
    $rate = shift_ratio($worked, $applications);
    if ($rate === null) return '🎯 Отклик → выход за 30 дней: откликов не было';
    $pct = (int)round($rate * 100);
    return "🎯 Отклик → выход за 30 дней: <b>{$worked}</b> из <b>{$applications}</b> ({$pct}%)";
}

function second_shift_line(int $workedOnce, int $workedTwice): string
{
    $rate = shift_ratio($workedTwice, $workedOnce);
    if ($rate === null) return '🔁 Повторный выход: подтверждённых выходов ещё не было';
    $pct = (int)round($rate * 100);
    return "🔁 Повторный выход: <b>{$workedTwice}</b> из <b>{$workedOnce}</b> работников ({$pct}%)";
}
