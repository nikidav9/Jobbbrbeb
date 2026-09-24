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
    # Боевая подача разрешена. Ставит владелец, и только после того, как
    # разведка (recon.py) дошла на живом сайте до анкеты кандидата, заполнила
    # её целиком без капчи и остановилась перед отправкой. Без флага воркер
    # боевую задачу не исполняет: отклик сохраняется со SITE_NOT_VERIFIED.
    live_ready: bool = False


AUDITED_SITES: tuple[SiteProfile, ...] = (
    SiteProfile("Пятёрочка", ("rabota5ka.ru",)),
    SiteProfile(
        "Перекрёсток",
        ("rabota.perekrestok.ru",),
        # Быстрый отклик: ФИО, телефон, дата рождения. Разведка 2026-09-24.
        field_overrides={"fullname": "full_name", "birthdate": "birth_date"},
    ),
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
    SiteProfile(
        "Befree",
        ("befree.ru",),
        field_overrides={"title": "desired_role", "name": "full_name"},
    ),
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
    SiteProfile(
        "Северсталь",
        ("career.severstal.com",),
        # name стоит рядом с lastname — это имя, а не ФИО.
        field_overrides={
            "name": "first_name",
            "lastname": "last_name",
            "about": "cover_letter",
            "link": "resume_url",
        },
    ),
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
    # Ниже — каталог cofinder, не исходный список владельца. Карты сняты
    # разведкой (recon.py) по подписям полей на живой странице; поле без
    # подписи не угадываем.
    SiteProfile(
        "Yadro",
        ("careers.yadro.com",),
        field_overrides={"name": "first_name", "last_name": "last_name", "message": "cover_letter"},
    ),
    SiteProfile("Солар", ("team.rt-solar.ru",), field_overrides={"form_text_20": "resume_url"}),
    SiteProfile(
        "Centicore Group",
        ("centicore.ru",),
        field_overrides={
            "name2": "first_name",
            "lastname2": "last_name",
            "message2": "cover_letter",
            "link": "resume_url",
            "position": "desired_role",
        },
    ),
    SiteProfile(
        "Effective Technologies",
        ("career.effective-group.ru",),
        field_overrides={"name": "first_name", "subname": "last_name", "rezum": "resume_url"},
    ),
    SiteProfile(
        "PIX Robotics",
        ("pix.ru",),
        field_overrides={"order_name": "full_name", "order_post": "desired_role"},
    ),
    SiteProfile(
        "Дельта Компьютерс",
        ("deltacomputers.ru",),
        field_overrides={"f_name": "full_name", "f_post": "desired_role"},
    ),
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


def live_ready(url: str) -> bool:
    """Можно ли подавать сюда по-настоящему. Незнакомый сайт — нельзя."""
    profile = profile_for_url(url)
    return bool(profile and profile.live_ready)


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
        raw = (candidate or "").strip().lower()
        if not raw:
            continue
        variants = {
            raw,
            raw.removesuffix("[]"),
            raw.replace("-", "_"),
            raw.removesuffix("[]").replace("-", "_"),
        }
        for key in variants:
            if key in profile.field_overrides:
                return profile.field_overrides[key]
    return None


AUDITED_SOURCE_URLS: dict[str, str] = {
    "Пятёрочка": "https://rabota5ka.ru/vacancies",
    "Перекрёсток": "https://rabota.perekrestok.ru/vacancies",
    "Магнит": "https://rabota.magnit.ru/",
    "Лента": "https://career.lenta.com/",
    "ВкусВилл": "https://vkusvill.ru/job/vacancys/",
    "METRO": "https://rabota.metro-cc.ru/vacancies/store",
    "О'КЕЙ": "https://www.okmarket.ru/career/vacancies/",
    "Глобус": "https://rabota.globus.ru/",
    "Красное&Белое": "https://krasnoeibeloe.ru/job/",
    "Fix Price": "https://fix-price.com/work/store",
    "Чижик": "https://chizhik.club/rabota/",
    "ДИКСИ": "https://dixy.ru/group/career/vacancy/",
    "Монетка": "https://career.monetka.ru/",
    "SPAR": "https://myspar.ru/career/",
    "Слата": "https://www.slata.ru/vacancy/",
    "Мария-Ра": "https://www.maria-ra.ru/karera-v-seti/vakansii/",
    "Ярче!": "https://работаярче.рф/",
    "Wildberries / РВБ": "https://career.rwb.ru/vacancies",
    "Ozon": "https://career.ozon.ru/vacancy/",
    "Lamoda": "https://job.lamoda.ru/vacancies",
    "Самокат": "https://vacancy.samokat.ru/",
    "Спортмастер": "https://job.sportmaster.ru/",
    "М.Видео-Эльдорадо": "https://career.mvideoeldorado.ru/vacancies",
    "DNS": "https://www.dns-shop.ru/jobs/",
    "Hoff": "https://job.hoff.ru/",
    "Лемана ПРО": "https://rabota.lemanapro.ru/vacancies",
    "Петрович": "https://petrovichjob.ru/",
    "Детский мир": "https://jobs.detmir.ru/",
    "Золотое Яблоко": "https://job.goldapple.ru/",
    "РИВ ГОШ": "https://rivegauche.ru/work",
    "Улыбка радуги": "https://rabota.r-ulybka.ru/",
    "Подружка": "https://rabotavpodrygke.ru/",
    "kari": "https://kari.com/job/",
    "Gloria Jeans": "https://lookbook.gloria-jeans.ru/",
    "Befree": "https://befree.ru/job",
    "HENDERSON": "https://henderson.ru/company/vacancies/",
    "CDEK": "https://rabota.cdek.ru/vacancies",
    "Деловые Линии": "https://job.dellin.ru/",
    "ПЭК": "https://hr.pecom.ru",
    "DPD Россия": "https://dpd.ru/vacancy",
    "Почта России": "https://www.pochta.ru/vacancy-list",
    "РЖД": "https://team.rzd.ru/career/vacancies",
    "Аэрофлот": "https://vacancy.aeroflot.ru/",
    "Шереметьево": "https://job.svo.su/",
    "Черкизово": "https://vacancies.cherkizovo.com/vacancies",
    "Северсталь": "https://career.severstal.com/vacancies/",
    "СИБУР": "https://career.sibur.ru/vacancies/",
    "Балтика": "https://career.baltika.ru/",
    "Норникель": "https://career.nornickel.ru/vacancies/",
    "ФосАгро": "https://www.phosagro.ru/career-education/vacancies/",
    "РУСАЛ": "https://www.rusal.ru/career/vacancies/",
    "Додо Пицца": "https://rabotavdodo.ru/",
    "Вкусно — и точка": "https://rabotaitochka.ru/",
    "ROSTIC'S": "https://rostics.ru/ru/career",
    "Burger King Россия": "https://burgerkingrus.ru/rabota",
    "Теремок": "https://rabota.teremok.ru/vacancies/",
    "Кофемания": "https://rabota.coffeemania.ru/",
    "Шоколадница": "https://regions.shoko.ru/career/",
    "AZIMUT Hotels": "https://azimuthotels.com/ru/info/career",
    "Сбер": "https://rabota.sber.ru/",
    "МегаФон": "https://job.megafon.ru/",
    "Яндекс": "https://yandex.ru/jobs",
}
