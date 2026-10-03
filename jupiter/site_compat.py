#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

# Итог ежедневной разведки (infra/recon-run.sh). Сайт, где разведка дошла до
# анкеты, заполнила её целиком без капчи и остановилась перед отправкой
# (dry_run_ok), подключается сам — без ручного флага. Решение владельца
# 26.09.2026. Файл старше RECON_MAX_AGE не в счёт: разведка встала — вход
# закрывается, а не держится открытым по вчерашней картине.
RECON_FILE = os.environ.get("JUPITER_RECON_FILE", "/var/www/html/jupiter-recon.json")
# Итог браузерной разведки (recon_browser.py, infra/recon-browser-run.sh):
# разделы, где HTTP-движок упёрся в spa/captcha/form_unmapped/no_vacancy, а
# браузер прошёл анкету до конца. Тот же формат, тот же срок свежести.
RECON_BROWSER_FILE = os.environ.get(
    "JUPITER_RECON_BROWSER_FILE", "/var/www/html/jupiter-recon-browser.json",
)
RECON_MAX_AGE = float(os.environ.get("JUPITER_RECON_MAX_AGE_DAYS", "3")) * 86400
# Кэш по пути: {path: (mtime, хосты)}.
_recon_cache: dict[str, tuple[float, frozenset[str]]] = {}


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
        live_ready=True,
    ),
    SiteProfile("Магнит", ("rabota.magnit.ru",)),
    SiteProfile(
        "Контур",
        ("kontur.ru",),
        # Сухой прогон 26.09 по kontur.ru/career/vacancies/3728: ФИО без подписи
        # (ResumeForm.Fio), телефон, почта, город, резюме файлом — один раз, хотя
        # полей для файлов шесть; капчи нет. Подписка на рубрики вакансий живёт
        # в той же форме: её галочки Юпитер не ставит, а отмеченную сайтом
        # рубрику снимает (drop_preselected_optional_consent). Ловушку для ботов
        # (ResumeForm.Liame) не трогает.
        live_ready=True,
    ),
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
    SiteProfile("Мария-Ра", ("maria-ra.ru",), live_ready=True),
    SiteProfile("Ярче!", ("xn--80aacr7bjeo1cwe.xn--p1ai", "работаярче.рф")),
    SiteProfile("Wildberries / РВБ", ("career.rwb.ru",), ("job.wb.ru",)),
    SiteProfile("Ozon", ("career.ozon.ru",)),
    SiteProfile("Lamoda", ("job.lamoda.ru",), live_ready=True),
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
        live_ready=True,
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
        live_ready=True,
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
        # 30.09.2026: вакансии переехали на dodoteam.ru, анкета уходит в API
        # job-site-backend.dodo-ai-platform.io; даты рождения в новой форме нет.
        ("rabotavdodo.ru", "dodoteam.ru"),
        ("job-site-backend.dodo-ai-platform.io",),
        field_overrides={
            "name": "first_name",
            "lastname": "last_name",
            "date": "birth_date",
            "about_yourself": "cover_letter",
            "resume_link": "resume_url",
        },
    ),
    SiteProfile("Вкусно — и точка", ("rabotaitochka.ru",)),
    # Анкеты — на своём карьерном домене (разведка 29.09 резала редирект).
    SiteProfile("ROSTIC'S", ("rostics.ru",), ("rabotavrostics.ru", "www.rabotavrostics.ru")),
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
    # Поиск Яндекса 01.10.2026: вакансии — на shoko.ru/career/.
    SiteProfile("Шоколадница", ("shoko.ru", "regions.shoko.ru")),
    SiteProfile("AZIMUT Hotels", ("azimuthotels.com",), ("hh.ru",)),
    SiteProfile("Сбер", ("rabota.sber.ru",), live_ready=True),
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
        live_ready=True,
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
        live_ready=True,
    ),
    SiteProfile(
        "Effective Technologies",
        ("career.effective-group.ru",),
        # PHONE объявлен type="phone", а не tel — без карты не узнаётся.
        # MESS («ник в мессенджере») обязателен, ключа нет — ждёт человека.
        field_overrides={"name": "first_name", "subname": "last_name", "rezum": "resume_url",
                         "phone": "phone", "decs": "cover_letter"},
    ),
    SiteProfile(
        "Surf",
        ("career.surf.ru",),
        # Tilda: Name/Name_2/Input_N. Грейд и «кем работаешь» — ключей нет,
        # не выдумываем; разведка решит, обязательны ли они. 26.09.2026.
        field_overrides={"name": "first_name", "name_2": "last_name", "input_3": "desired_role",
                         "input_4": "resume_url"},
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
    # Разведка 24.09: dry-run пройден без карты полей — агент понял анкету сам.
    SiteProfile("Авиасейлс", ("aviasales.ru",), live_ready=True),
    SiteProfile("2ГИС", ("job.2gis.ru",), live_ready=True),
    SiteProfile("X5 Tech", ("x5.tech",), live_ready=True),
    SiteProfile("Cloud.ru", ("cloud.ru",), live_ready=True),
    SiteProfile("Aston", ("career.astondevs.ru",), live_ready=True),
    SiteProfile("Гараж 8", ("garage-eight.com",), live_ready=True),
    SiteProfile("Selecty", ("selecty.ru",), live_ready=True),
    SiteProfile("iSpring", ("ispring.ru",), live_ready=True),
    SiteProfile("1С", ("1c.ru",), live_ready=True),
    SiteProfile("kokos group", ("career.kokocgroup.ru",), live_ready=True),
    SiteProfile("Agima", ("agima.ru",), live_ready=True),
    SiteProfile("Navio", ("navio.auto",), live_ready=True),
    SiteProfile("ДатаРу", ("dataru.ru",), live_ready=True),
    SiteProfile("BSL", ("bsl.dev",), live_ready=True),
    SiteProfile("Юзтех", ("usetech.ru",), live_ready=True),
    SiteProfile("Траектория технологий", ("trctech.ru",), live_ready=True),
    SiteProfile("РДВ Технолоджи", ("rdwcomp.ru",), live_ready=True),
    SiteProfile("ITG", ("itglobal.com",), live_ready=True),
    SiteProfile("КРОК", ("careers.croc.ru",), live_ready=True),
    SiteProfile("Macroscop", ("pro.macroscop.com",), live_ready=True),
    SiteProfile("RedLab", ("redlab.dev",), live_ready=True),
    # Раздел переехал на другой хост: без него политика верно режет редирект.
    # trusted_apply_hosts сравниваются как есть, поэтому www — отдельной строкой.
    SiteProfile("Reksoft", ("career.reksoft.com",), ("www.career.reksoft.com",)),
    SiteProfile("iFellow", ("ifellow.ru",), ("ifellowgroup.ru", "www.ifellowgroup.ru")),
    SiteProfile("Arenadata", ("career.arenadata.tech",), ("arenadata.tech", "www.arenadata.tech")),
    # Разведка 29.09: раздел вакансий уводит на свой же карьерный домен.
    SiteProfile("SUNLIGHT", ("job.sunlight.net",), ("rabota.sunlight.net",)),
    SiteProfile("Тануки", ("job.tanuki.ru",), ("tanukifamily.ru", "www.tanukifamily.ru")),
    SiteProfile("Спортс", ("sports.ru", "careers.sports.ru"), ("forms.tildaapi.com",)),
    # Разведка 01.10: вакансия на c.tutu.ru, анкета — на своём же hr.tutu.ru.
    SiteProfile("Туту", ("c.tutu.ru",), ("hr.tutu.ru",)),
    # Поле userFull по подписи — «Фамилия», а имя поля обещает ФИО (30.09).
    SiteProfile(
        "Читай-город",
        ("rabota.chitai-gorod.ru",),
        field_overrides={
            "userfull": "last_name",
            "username": "first_name",
            "userjobtitle": "desired_role",
            "userphone": "phone",
            "useremail": "email",
            "userbirthday": "birth_date",
            "usercountry": "citizenship",
            "usercity": "city",
            "userfilelink": "resume_url",
        },
    ),
    # Карты полей по разбору анкет 30.09. Поля, которых нет в профиле
    # (вопросы работодателя, тип вакансии из списка), не отображаются: их
    # заполняет человек. Капча, где она есть, — тоже его.
    SiteProfile(
        "Инвитро",
        ("invitro.ru",),
        field_overrides={
            "form_text_221": "last_name", "form_text_222": "first_name",
            "form_text_223": "patronymic", "form_text_224": "desired_role",
            "form_text_226": "phone", "form_text_227": "email",
            "form_text_228": "birth_date", "form_text_229": "citizenship",
            "form_text_230": "city", "form_text_231": "education",
        },
    ),
    # Tilda: имена полей — русские подписи.
    SiteProfile(
        "Whoosh",
        ("whoosh-bike.ru",),
        ("forms.tildaapi.com",),
        field_overrides={
            "фио": "full_name", "телефон": "phone", "email": "email",
            "город": "city", "вакансия": "desired_role", "о себе": "cover_letter",
        },
    ),
    SiteProfile(
        "Герофарм",
        ("geropharm.ru", "geropharm-career.ru"),
        ("forms.tildaapi.com",),
        field_overrides={"link": "resume_url", "vacancy": "desired_role"},
    ),
    SiteProfile(
        "Наумен",
        ("naumen.ru",),
        field_overrides={
            "form_text_2158": "last_name", "form_text_2159": "first_name",
            "form_text_2160": "patronymic", "form_text_419": "phone",
            "form_email_2115": "email", "form_textarea_903": "desired_role",
            "form_textarea_420": "cover_letter",
        },
    ),
    # Анкета в два шага; на втором — вопросы работодателя, они к человеку.
    SiteProfile(
        "МойСклад",
        ("moysklad.ru",),
        field_overrides={
            "form_text_6319": "full_name", "form_text_6320": "phone",
            "form_email_6321": "email", "form_text_6322": "citizenship",
            "form_text_6323": "city", "form_text_6329": "resume_url",
        },
    ),
    SiteProfile(
        "ТК КИТ",
        ("tk-kit.ru",),
        field_overrides={
            "vacancycallback[name]": "full_name", "vacancycallback[phone]": "phone",
            "vacancycallback[city]": "city", "vacancycallback[email]": "email",
            "vacancycallback[body]": "cover_letter",
        },
    ),
    SiteProfile(
        "Карма Групп",
        ("karma-group.ru",),
        field_overrides={
            "fio": "full_name", "phone": "phone", "email": "email", "text": "cover_letter",
        },
    ),
    SiteProfile(
        "Rendez-Vous",
        ("rendez-vous.ru",),
        field_overrides={
            "jobresponses[name]": "full_name", "jobresponses[phone]": "phone",
            "jobresponses[email]": "email", "jobresponses[resume_link]": "resume_url",
        },
    ),
    # Подписи лежат в скрытых полях с тем же именем; wb_input_4 («Как вы нас
    # нашли?») скрыт и не заполняется.
    SiteProfile(
        "PrideInBrains",
        ("prideinbrains.com",),
        field_overrides={
            "wb_input_0": "full_name", "wb_input_1": "email",
            "wb_input_3": "city", "wb_input_5": "cover_letter",
        },
    ),
    SiteProfile(
        "Братья Караваевы",
        ("karavaevi.ru",),
        field_overrides={
            "property[name][0]": "full_name", "property[29][0]": "phone",
            "property[30][0]": "email", "property[31]": "desired_role",
        },
    ),
    SiteProfile("Crosstech", ("crosstech.ru",), field_overrides={"message_link": "resume_url"}),
    SiteProfile("Globus IT", ("globus-ltd.ru",), field_overrides={"usermessage": "cover_letter"}),
    SiteProfile("ЭФКО", ("efko.ru",), field_overrides={"message": "cover_letter"}),
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


def _recon_ready(item: dict) -> bool:
    """Анкета пройдена до конца (dry_run_ok) или до вопросов работодателя,
    на которые ответит человек (NEEDS_ANSWERS, решение владельца 01.10.2026:
    «сайт ещё подключаем» стоял у Норникеля, Наумена, Skyeng, МойСклад —
    анкета заполнена, не хватало только ответов человека)."""
    captcha = item.get("captcha") if isinstance(item.get("captcha"), dict) else {}
    return item.get("klass") == "dry_run_ok" or (
        item.get("reason_code") in ("NEEDS_ANSWERS", "EMAIL_APPLY")
        and item.get("status") == "action_required") or (
        # Анкета заполнена, осталась капча, которую решает человек в приложении
        # (captcha_loop): картинка с текстом — вводит слово, галочка и сетка
        # картинок известного вендора — нажимает на снимок (03.10.2026).
        # Невидимая капча сюда не относится. Не вышло у человека — заявка
        # уходит в «Нужны вы» / «Ждут вас», как и раньше.
        item.get("klass") == "captcha" and (
            captcha.get("transferable") is True or captcha.get("tappable") is True))


def _file_ok_hosts(path: str, now: float | None = None) -> frozenset[str]:
    """Хосты с dry_run_ok в одном файле разведки. Нет файла или он протух —
    пусто. Кэш по mtime: воркер спрашивает на каждую задачу."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return frozenset()
    if (now if now is not None else time.time()) - mtime > RECON_MAX_AGE:
        return frozenset()
    cached = _recon_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    hosts: set[str] = set()
    try:
        with open(path, encoding="utf-8") as fh:
            items = json.load(fh)
    except (OSError, ValueError):
        items = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and _recon_ready(item):
            for key in ("url", "start_url"):
                host = normalize_host(str(item.get(key) or ""))
                if host:
                    hosts.add(host)
    result = frozenset(hosts)
    _recon_cache[path] = (mtime, result)
    return result


def recon_ok_hosts(path: str | None = None, now: float | None = None) -> frozenset[str]:
    """Хосты, где свежая разведка дала dry_run_ok. С path — только этот
    файл; без него — HTTP- и браузерный итог вместе (так их видит и
    снятие с паузы SITE_NOT_VERIFIED в run_worker)."""
    if path:
        return _file_ok_hosts(path, now)
    return _file_ok_hosts(RECON_FILE, now) | _file_ok_hosts(RECON_BROWSER_FILE, now)


def live_ready_source(url: str) -> str | None:
    """Чем подтверждена боевая подача: "owner" — флаг владельца, "http" —
    свежая HTTP-разведка, "browser" — свежая браузерная; None — ничем.
    Браузерный итог полезен воркеру: такой сайт HTTP-движком не пройти."""
    profile = profile_for_url(url)
    if profile and profile.live_ready:
        return "owner"
    host = normalize_host(url)
    if not host:
        return None
    if host in _file_ok_hosts(RECON_FILE):
        return "http"
    if host in _file_ok_hosts(RECON_BROWSER_FILE):
        return "browser"
    return None


def live_ready(url: str) -> bool:
    """Можно ли подавать сюда по-настоящему. Незнакомый сайт — нельзя.

    Да — если владелец поставил флаг в профиле или свежая разведка (HTTP-
    или браузерная) прошла анкету этого хоста до конца (dry_run_ok)."""
    return live_ready_source(url) is not None


def trusted_hosts_for(url: str) -> set[str]:
    profile = profile_for_url(url)
    if profile is None:
        return set()
    items = (*profile.hosts, *profile.trusted_apply_hosts)
    # Политика сверяет хосты буквально, поэтому нужен и вид «как записан»:
    # без него www.career.reksoft.com из списка тихо превращался в
    # career.reksoft.com, и редирект на www резался как чужой.
    return {normalize_host(item) for item in items} | {item.lower() for item in items}


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
    "Додо Пицца": "https://dodoteam.ru/vacancy/",
    "Вкусно — и точка": "https://rabotaitochka.ru/",
    "ROSTIC'S": "https://rostics.ru/ru/career",
    "Burger King Россия": "https://burgerkingrus.ru/rabota",
    "Теремок": "https://rabota.teremok.ru/vacancies/",
    "Кофемания": "https://rabota.coffeemania.ru/",
    "Шоколадница": "https://shoko.ru/career/",
    "AZIMUT Hotels": "https://azimuthotels.com/ru/info/career",
    "Сбер": "https://rabota.sber.ru/",
    "МегаФон": "https://job.megafon.ru/",
    "Яндекс": "https://yandex.ru/jobs",
}
