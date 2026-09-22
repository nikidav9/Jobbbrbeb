#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import urlparse


@dataclass(frozen=True)
class SiteProfile:
    name: str
    hosts: tuple[str, ...]
    trusted_apply_hosts: tuple[str, ...] = ()
    field_overrides: dict[str, str] = field(default_factory=dict)


AUDITED_SITES: tuple[SiteProfile, ...] = (
    SiteProfile("Пятёрочка", ("rabota5ka.ru",)),
    SiteProfile("Перекрёсток", ("rabota.perekrestok.ru",)),
    SiteProfile("Магнит", ("rabota.magnit.ru",)),
    SiteProfile("Лента", ("career.lenta.com",), ("hh.ru", "spb.hh.ru", "superjob.ru", "avito.ru")),
    SiteProfile(
        "ВкусВилл",
        ("vkusvill.ru",),
        field_overrides={
            "job_store_name": "desired_role",
            "name": "full_name",
            "born": "birth_date",
            "phone": "phone",
            "citizenship": "citizenship",
            "metro": "location_detail",
            "has_car": "has_car",
            "job_policy_agree": "consent",
        },
    ),
    SiteProfile("METRO", ("rabota.metro-cc.ru",)),
    SiteProfile("О'КЕЙ", ("okmarket.ru",)),
    SiteProfile("Глобус", ("rabota.globus.ru",)),
    SiteProfile("Красное&Белое", ("krasnoeibeloe.ru",)),
    SiteProfile("Fix Price", ("fix-price.com",)),
    SiteProfile("Чижик", ("chizhik.club",)),
    SiteProfile("ДИКСИ", ("dixy.ru",)),
    SiteProfile("Монетка", ("career.monetka.ru",)),
    SiteProfile("SPAR", ("myspar.ru",)),
    SiteProfile(
        "Слата",
        ("slata.ru",),
        field_overrides={
            "town": "city",
            "vacancy": "desired_role",
            "employment": "employment",
            "last_name": "last_name",
            "first_name": "first_name",
            "patronymic": "patronymic",
            "birthday": "birth_date",
            "phone": "phone",
            "email": "email",
            "citizenship": "citizenship",
            "education": "education",
            "comment": "cover_letter",
            "cv_url": "resume_url",
            "cv_file": "resume",
        },
    ),
    SiteProfile("Мария-Ра", ("maria-ra.ru",)),
    SiteProfile("Ярче!", ("xn--80aacr7bjeo1cwe.xn--p1ai", "работаярче.рф")),
    SiteProfile("Wildberries / РВБ", ("career.rwb.ru",), ("job.wb.ru",)),
    SiteProfile("Ozon", ("career.ozon.ru",)),
    SiteProfile("Lamoda", ("job.lamoda.ru",)),
    SiteProfile("Самокат", ("vacancy.samokat.ru",)),
    SiteProfile("Спортмастер", ("job.sportmaster.ru",)),
    SiteProfile("М.Видео-Эльдорадо", ("career.mvideoeldorado.ru",)),
    SiteProfile("DNS", ("dns-shop.ru",)),
    SiteProfile("Hoff", ("job.hoff.ru",)),
    SiteProfile(
        "Лемана ПРО",
        ("rabota.lemanapro.ru",),
        field_overrides={
            "firstname": "first_name",
            "lastname": "last_name",
            "phone": "phone",
            "email": "email",
            "resumefiles": "resume",
            "resumeurl": "resume_url",
            "comment": "cover_letter",
            "consent": "consent",
        },
    ),
    SiteProfile("Петрович", ("petrovichjob.ru",)),
    SiteProfile("Детский мир", ("jobs.detmir.ru",), ("job.detmir.ru",)),
    SiteProfile("Золотое Яблоко", ("job.goldapple.ru",)),
    SiteProfile("РИВ ГОШ", ("rivegauche.ru",)),
    SiteProfile("Улыбка радуги", ("rabota.r-ulybka.ru",), ("hh.ru", "spb.hh.ru")),
    SiteProfile("Подружка", ("rabotavpodrygke.ru",)),
    SiteProfile("kari", ("kari.com",)),
    SiteProfile("Gloria Jeans", ("lookbook.gloria-jeans.ru",)),
    SiteProfile("Befree", ("befree.ru",)),
    SiteProfile("HENDERSON", ("henderson.ru",)),
    SiteProfile(
        "CDEK",
        ("rabota.cdek.ru",),
        field_overrides={
            "name": "full_name",
            "phone": "phone",
            "email": "email",
            "city": "city",
            "comment": "cover_letter",
            "brief_link": "resume_url",
            "brief": "resume",
        },
    ),
    SiteProfile("Деловые Линии", ("job.dellin.ru",)),
    SiteProfile("ПЭК", ("hr.pecom.ru",)),
    SiteProfile("DPD Россия", ("dpd.ru",)),
    SiteProfile("Почта России", ("pochta.ru",)),
    SiteProfile("РЖД", ("team.rzd.ru",)),
    SiteProfile("Аэрофлот", ("vacancy.aeroflot.ru",)),
    SiteProfile("Шереметьево", ("job.svo.su",)),
    SiteProfile("Черкизово", ("vacancies.cherkizovo.com",)),
    SiteProfile("Северсталь", ("career.severstal.com",)),
    SiteProfile("СИБУР", ("career.sibur.ru",)),
    SiteProfile("Балтика", ("career.baltika.ru",)),
    SiteProfile("Норникель", ("career.nornickel.ru",)),
    SiteProfile("ФосАгро", ("phosagro.ru",)),
    SiteProfile("РУСАЛ", ("rusal.ru",), ("career.enplusrusal.ru",)),
    SiteProfile(
        "Додо Пицца",
        ("rabotavdodo.ru",),
        field_overrides={
            "name": "first_name",
            "lastname": "last_name",
            "date": "birth_date",
        },
    ),
    SiteProfile("Вкусно — и точка", ("rabotaitochka.ru",)),
    SiteProfile("ROSTIC'S", ("rostics.ru",)),
    SiteProfile("Burger King Россия", ("burgerkingrus.ru",)),
    SiteProfile(
        "Теремок",
        ("rabota.teremok.ru",),
        field_overrides={
            "property[name][0]": "full_name",
            "property[101][0]": "phone",
            "property[104][0]": "desired_role",
            "property[105]": "consent",
            "property_file_106_0": "resume",
        },
    ),
    SiteProfile(
        "Кофемания",
        ("rabota.coffeemania.ru",),
        field_overrides={
            "vacancy": "desired_role",
            "lastname": "last_name",
            "firstname": "first_name",
            "phone": "phone",
            "email": "email",
            "citizenship": "citizenship",
            "agree": "consent",
        },
    ),
    SiteProfile("Шоколадница", ("regions.shoko.ru",)),
    SiteProfile("AZIMUT Hotels", ("azimuthotels.com",), ("hh.ru",)),
    SiteProfile("Сбер", ("rabota.sber.ru",)),
    SiteProfile(
        "МегаФон",
        ("job.megafon.ru",),
        field_overrides={
            "lastname": "last_name",
            "firstname": "first_name",
            "email": "email",
            "phone": "phone",
            "comment": "cover_letter",
            "agreedreservation": "talent_pool_consent",
            "agreedpersonaldata": "consent",
        },
    ),
    SiteProfile("Яндекс", ("yandex.ru",), ("forms.yandex.ru",)),
)


def normalize_host(value: str) -> str:
    host = (urlparse(value).hostname if "://" in value else value) or ""
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def profile_for_url(url: str) -> SiteProfile | None:
    host = normalize_host(url)
    for profile in AUDITED_SITES:
        if any(host == normalize_host(item) for item in profile.hosts):
            return profile
    return None


def trusted_hosts_for(url: str) -> set[str]:
    profile = profile_for_url(url)
    if profile is None:
        return set()
    return {normalize_host(item) for item in (*profile.hosts, *profile.trusted_apply_hosts)}


def field_override(url: str, *candidates: str) -> str | None:
    profile = profile_for_url(url)
    if profile is None:
        return None
    for candidate in candidates:
        key = (candidate or "").strip().lower()
        if key and key in profile.field_overrides:
            return profile.field_overrides[key]
    return None
