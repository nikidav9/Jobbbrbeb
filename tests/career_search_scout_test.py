#!/usr/bin/env python3
"""Разведчик источников вакансий через поиск Яндекса: отбор выдачи, выбор
модели, очередь компаний. Сеть и модель — подставные."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import career_search_scout as s  # noqa: E402

fails = []


def check(name, ok):
    if not ok:
        fails.append(name)


XML = """<?xml version="1.0" encoding="utf-8"?><yandexsearch><response><results><grouping>
<group><doc><url>https://career.lenta.com/vacancies</url><title>Вакансии <hlword>Лента</hlword></title></doc></group>
<group><doc><url>https://hh.ru/employer/1</url><title>Лента — вакансии на hh</title></doc></group>
<group><doc><url>https://lenta.com/about</url><title>О компании</title></doc></group>
<group><doc><url>https://lenta.com/rabota/kassir</url><title>Кассир</title></doc></group>
<group><doc><url>https://other.ru/jobs</url><title>Чужие вакансии</title></doc></group>
</grouping></results></response></yandexsearch>"""

res = s.parse_search_xml(XML)
check("XML: все результаты по порядку", [r["url"] for r in res][:2] == ["https://career.lenta.com/vacancies", "https://hh.ru/employer/1"])
check("XML: заголовок с подсветкой целиком", res[0]["title"] == "Вакансии Лента")
check("битый XML — пусто", s.parse_search_xml("<oops") == [])

own = s.own_jobby(res, "https://career.lenta.com")
check("только свой сайт и похожее на вакансии, без hh и чужих",
      [r["url"] for r in own] == ["https://career.lenta.com/vacancies", "https://lenta.com/rabota/kassir"])


class LLM:
    def __init__(self, answer):
        self.answer, self.seen = answer, []

    def complete_json(self, system, user, schema=""):
        self.seen.append(user)
        return self.answer


check("модель выбирает адрес из списка", s.pick_listing(LLM({"url": own[0]["url"]}), "Лента", own) == own[0]["url"])
check("выдуманный моделью адрес не принимается", s.pick_listing(LLM({"url": "https://evil.ru"}), "Лента", own) is None)
check("без модели — без выбора", s.pick_listing(None, "Лента", own) is None)

disc = [{"name": "A", "url": "https://a.ru", "status": "нет данных"},
        {"name": "B", "url": "https://b.ru", "status": "готов"},
        {"name": "C", "url": "https://c.ru", "status": "нет адреса вакансии"},
        {"name": "D", "url": "ftp://d", "status": "нет данных"}]
check("очередь: только без вакансий, давно не смотренные первыми",
      [d["name"] for d in s.targets(disc, {"A": 100.0, "C": 50.0}, 5)] == ["C", "A"])
check("очередь: предел", len(s.targets(disc, {}, 1)) == 1)

llm = LLM({"url": "https://career.lenta.com/vacancies"})
out = s.scout([{"name": "Лента", "url": "https://career.lenta.com", "status": "нет данных"}], "k", "f", llm,
              pause=0, searcher=lambda q, k, f: s.parse_search_xml(XML))
check("разведка: кандидаты и выбор", out[0]["pick"] == "https://career.lenta.com/vacancies" and len(out[0]["candidates"]) == 2)
check("модели уходит только компания и выдача", "резюме" not in llm.seen[0] and json.loads(llm.seen[0])["company"] == "Лента")

def boom(q, k, f):
    raise OSError("сеть")
out = s.scout([{"name": "X", "url": "https://x.ru", "status": "нет данных"}], "k", "f", None, pause=0, searcher=boom)
check("сбой поиска — запись с ошибкой, разведка идёт дальше", "сеть" in out[0].get("error", ""))

if fails:
    raise SystemExit("career search scout: ПРОВАЛЫ\n  - " + "\n  - ".join(fails))
print("career search scout: OK")
