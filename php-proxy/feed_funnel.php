<?php

function feed_share(int $part, int $total): ?int
{
    if ($total <= 0) return null;
    return (int)round(max(0, min($part, $total)) * 100 / $total);
}

function feed_impression_line(int $own, int $partner, int $partnerClicks): string
{
    $total = $own + $partner;
    $share = feed_share($partner, $total);
    $shareText = $share === null ? 'доли пока нет' : "партнёрские {$share}%";
    return "👀 Лента за сутки: свои показы <b>{$own}</b>, партнёрские <b>{$partner}</b>"
        . " ({$shareText}), переходы к партнёрам <b>{$partnerClicks}</b>";
}

function guest_funnel_line(int $impressions, int $externalClicks, int $intents, int $started, int $completed): string
{
    return "🚪 Гости: показы <b>{$impressions}</b> → к партнёрам <b>{$externalClicks}</b>"
        . " / хотят откликнуться <b>{$intents}</b>"
        . " → начали регистрацию <b>{$started}</b> → завершили <b>{$completed}</b>";
}

function zero_application_diagnosis(
    int $applications,
    int $ownImpressions,
    int $partnerImpressions,
    int $partnerClicks,
    int $guestImpressions,
    int $guestIntents,
    int $guestCompleted
): string {
    if ($applications > 0) return '';

    $allImpressions = $ownImpressions + $partnerImpressions + $guestImpressions;
    if ($allImpressions === 0) {
        return '🔬 Ноль откликов: карточки не показаны либо не записываются показы';
    }

    $partnerShare = feed_share($partnerImpressions, $ownImpressions + $partnerImpressions);
    if ($partnerShare !== null && $partnerShare >= 80) {
        return "🔬 Ноль откликов: {$partnerShare}% показов — партнёрские вакансии;"
            . " у них результатом считается переход ({$partnerClicks}), а не отклик в JobToo";
    }
    if ($guestIntents === 0) {
        return '🔬 Ноль откликов: карточки видят, но до намерения откликнуться не доходят';
    }
    if ($guestCompleted === 0) {
        return '🔬 Ноль откликов: намерение есть, но гостевая регистрация не завершается';
    }
    return '🔬 Ноль откликов: регистрация завершается, но отклик не записывается — проверять сохранение';
}
