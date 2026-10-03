#!/usr/bin/env python3
"""Сайт для компьютера не грузит приложение под собой.

Expo при сборке сам вставляет в конец страницы тег приложения
(`<script src="/_expo/static/js/web/entry-<hash>.js" defer>`). На сайте для
компьютера (`window.__JT_LANDING__`, ставит LANDING_DETECT) войти в приложение
нельзя (решение владельца 03.10.2026), и несколько мегабайт скрипта качаются
зря рядом с роликом первого экрана. Скрипт заменяет тег на условный: на
телефоне, в Telegram, в установленном приложении и по ?app=1 приложение
грузится как раньше — тем же элементом в конце страницы, DOM к этому моменту
готов.

Страница меняется только если тег один и выглядит ожидаемо; иначе файл
остаётся как был, код возврата 3 (выкладку это не останавливает).

    python3 scripts/defer-landing-bundle.py dist/index.html
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

TAG = re.compile(r'<script src="(/_expo/static/js/web/entry-[0-9a-f]+\.js)" defer></script>')
LOADER = (
    '<script>if(!window.__JT_LANDING__){{var s=document.createElement("script");'
    's.src="{src}";document.body.appendChild(s);}}</script>'
)


def patch(html: str) -> str | None:
    """Новая страница или None, если тег приложения не один."""
    if len(TAG.findall(html)) != 1:
        return None
    return TAG.sub(lambda m: LOADER.format(src=m.group(1)), html)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    path = Path(argv[1])
    html = path.read_text(encoding="utf-8")
    patched = patch(html)
    if patched is None:
        print(f"defer-landing-bundle: тег приложения не найден или не один в {path}; страница не тронута")
        return 3
    path.write_text(patched, encoding="utf-8")
    print(f"defer-landing-bundle: {path} — приложение не грузится под сайтом для компьютера")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
