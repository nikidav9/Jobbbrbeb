#!/usr/bin/env python3
"""Сетевая политика: куда Jupiter имеет право пойти.

Список разрешённых хостов сам по себе не защищает. Имя разрешено — а куда оно
указывает, решает DNS, то есть чужая сторона. Домен работодателя, указывающий
на 169.254.169.254, превращает агента в инструмент чтения метаданных облака; на
10.0.0.5 — в сканер внутренней сети.

Поэтому проверяется не имя, а адрес, и соединение идёт именно на тот адрес,
который проверили. Иначе между проверкой и подключением остаётся окно, в
которое и бьёт DNS rebinding: первый ответ DNS безобидный, второй — нет.

Исключение ровно одно: петлевой адрес разрешён, если его явно вписали в список
хостов. Так живут лаборатория и тесты, и так это не может включиться само —
боевой прогон вписывает домены работодателей, а не 127.0.0.1.
"""
from __future__ import annotations

import ipaddress
import socket
import urllib.parse


class PolicyError(RuntimeError):
    pass


ALLOWED_SCHEMES = {"http", "https"}

# Имена, которыми петлевой адрес записывают в список хостов.
_LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1", "[::1]"}


def is_blocked_address(raw: str) -> bool:
    """Адрес, на который агент не должен ходить никогда."""
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        # Не адрес — решать не здесь.
        return False
    return (
        address.is_private          # 10/8, 172.16/12, 192.168/16, fc00::/7
        or address.is_loopback      # 127/8, ::1
        or address.is_link_local    # 169.254/16 — сюда же метаданные облаков
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def literal_loopback(host: str) -> bool:
    return host.strip().lower() in _LOOPBACK_NAMES


class NetworkPolicy:
    """Одно место, где решается «можно ли туда идти»."""

    def __init__(self, allowed_hosts: set[str], *, allow_private: bool = False):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        # Разрешение на внутренние адреса даётся при создании движка и НЕ
        # выводится из списка хостов. Список пополняется адресом запуска, и
        # выводить разрешение из него значило бы позволить стартовому адресу
        # разрешить себя самому.
        self.allow_private = allow_private

    def check_url(self, url: str, *, resolve: bool = True) -> list[str]:
        """Проверить адрес и вернуть IP, на которые можно подключаться.

        resolve=False — только имя: схема, отсутствие логина в адресе и
        список хостов. Это для логических адресов, по которым ничего не
        скачивается (разбор готового HTML). Резолвить их бессмысленно, а
        падать из-за несуществующего домена — вредно.
        """
        parsed = urllib.parse.urlparse(url)
        scheme = (parsed.scheme or "").lower()
        if scheme not in ALLOWED_SCHEMES:
            raise PolicyError(f"Scheme '{parsed.scheme}' is not allowed")
        if parsed.username or parsed.password:
            raise PolicyError("Credentials in URL are not allowed")

        host = (parsed.hostname or "").lower()
        if not host:
            raise PolicyError("URL has no host")
        if host not in self.allowed_hosts:
            raise PolicyError(f"Host '{host}' is not allowed for this Jupiter run")

        literal = host.strip("[]")
        if is_blocked_address(literal) or literal_loopback(host):
            # Адрес записан прямо в ссылке. Разрешаем только если движку это
            # разрешили явно — так живут лаборатория и тесты.
            if not self.allow_private:
                raise PolicyError(
                    f"Host '{host}' is an internal address and is not allowed"
                )
            return [literal]

        if not resolve:
            return []

        addresses = self.resolve(host)
        if not addresses:
            raise PolicyError(f"Host '{host}' does not resolve")

        blocked = [
            item for item in addresses
            if is_blocked_address(item) and not self.allow_private
        ]
        if blocked:
            # Именно так выглядит SSRF через разрешённый домен: имя из списка,
            # а за ним внутренний адрес.
            raise PolicyError(
                f"Host '{host}' resolves to a blocked address: {blocked[0]}"
            )
        return addresses

    @staticmethod
    def resolve(host: str) -> list[str]:
        try:
            info = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise PolicyError(f"Host '{host}' does not resolve: {exc}") from exc
        seen: list[str] = []
        for item in info:
            address = item[4][0]
            if address not in seen:
                seen.append(address)
        return seen
