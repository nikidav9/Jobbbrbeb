#!/usr/bin/env python3
"""Политика Chromium: доверять УЦ Минцифры для браузерного воркера Jupiter.

Читает PEM (jupiter/ru_trusted_ca.pem) и печатает JSON для
/etc/chromium/policies/managed/jobtoo-ru-ca.json. Кладёт его infra/bootstrap.sh,
когда браузерный воркер включён, и удаляет, когда выключен.

Доверие добавляется как к обычному корню: подпись, имя хоста и срок Chromium
проверяет штатно. Флаг --ignore-certificate-errors-spki-list здесь не годится
и запрещён: при совпадении ключа он отключает проверку цепочки целиком
(см. jupiter/browser_guard.py).

Ограничений по доменам нет — решение владельца. Два ключа, а не один:
CACertificatesWithConstraints (так решено) и CACertificates — вариант той же
политики без ограничений; если Chromium отвергнет запись без ограничений,
сертификат всё равно придёт вторым ключом. Один и тот же корень дважды —
одно и то же доверие, не шире.
"""
import base64
import json
import re
import ssl
import sys

PEM_RE = re.compile(r"-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----", re.S)


def policy(pem_text: str) -> dict:
    certs = [base64.b64encode(ssl.PEM_cert_to_DER_cert(m)).decode("ascii")
             for m in PEM_RE.findall(pem_text)]
    if not certs:
        raise ValueError("в PEM нет сертификатов")
    return {
        "CACertificates": certs,
        "CACertificatesWithConstraints": [{"certificate": c} for c in certs],
    }


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        print(json.dumps(policy(f.read()), indent=2))
