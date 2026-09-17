<?php

function feed_impression_line(int $own): string
{
    return "👀 Лента за сутки: показы <b>{$own}</b>";
}

function guest_funnel_line(int $impressions, int $intents, int $started, int $completed): string
{
    return "🚪 Гости: показы <b>{$impressions}</b>"
        . " → хотят откликнуться <b>{$intents}</b>"
        . " → начали регистрацию <b>{$started}</b> → завершили <b>{$completed}</b>";
}

function zero_application_diagnosis(
    int $applications,
    int $ownImpressions,
    int $guestImpressions,
    int $guestIntents,
    int $guestCompleted
): string {
    if ($applications > 0) return '';

    $allImpressions = $ownImpressions + $guestImpressions;
    if ($allImpressions === 0) {
        return '🔬 Ноль откликов: карточки не показаны либо не записываются показы';
    }
    if ($guestIntents === 0) {
        return '🔬 Ноль откликов: карточки видят, но до намерения откликнуться не доходят';
    }
    if ($guestCompleted === 0) {
        return '🔬 Ноль откликов: намерение есть, но гостевая регистрация не завершается';
    }
    return '🔬 Ноль откликов: регистрация завершается, но отклик не записывается — проверять сохранение';
}
