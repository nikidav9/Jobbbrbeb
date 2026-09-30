"""TLS Юпитера: Минцифры для всех хостов и AIA-догрузка промежуточного.

Без внешней сети: корень, промежуточный и лист генерируются openssl, сайт —
локальный https-сервер, отдающий ТОЛЬКО лист (неполная цепочка), промежуточный
раздаёт локальный http-сервер по адресу из расширения AIA.

Проверяет:
- контекст для любого хоста содержит оба сертификата Минцифры и проверяет имя;
- разбор AIA на настоящем DER (Russian Trusted Sub CA и сгенерированный лист);
- без AIA неполная цепочка не открывается, с AIA — открывается;
- поддельный промежуточный (от чужого корня) и самоподписанный «издатель»
  не проходят: скачанное из сети якорем доверия не становится;
- AIA-адрес во внутренней сети отсекается сетевой политикой.
"""
import http.server
import os
import re
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RU_PEM = os.path.join(HERE, "ru_trusted_ca.pem")


def _openssl(*args: str) -> None:
    subprocess.run(["openssl", *args], check=True, capture_output=True)


class _Pki:
    """Набор сертификатов в каталоге: имя → (crt, key)."""

    def __init__(self, directory: str):
        self.dir = directory

    def path(self, name: str, ext: str) -> str:
        return os.path.join(self.dir, f"{name}.{ext}")

    def _ext(self, name: str, text: str) -> str:
        p = self.path(name, "ext")
        with open(p, "w") as fh:
            fh.write(text)
        return p

    def root(self, name: str, cn: str) -> None:
        _openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
                 "-subj", f"/CN={cn}", "-keyout", self.path(name, "key"),
                 "-out", self.path(name, "crt"),
                 "-addext", "basicConstraints=critical,CA:TRUE",
                 "-addext", "keyUsage=critical,keyCertSign,cRLSign",
                 "-addext", "subjectKeyIdentifier=hash")

    def issue(self, name: str, cn: str, issuer: str, ext: str) -> None:
        _openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", f"/CN={cn}",
                 "-keyout", self.path(name, "key"), "-out", self.path(name, "csr"))
        _openssl("x509", "-req", "-in", self.path(name, "csr"), "-days", "30",
                 "-CA", self.path(issuer, "crt"), "-CAkey", self.path(issuer, "key"),
                 "-set_serial", str(abs(hash(name)) % 10**12 + 2),
                 "-extfile", self._ext(name, ext), "-out", self.path(name, "crt"))

    def ca(self, name: str, cn: str, issuer: str) -> None:
        self.issue(name, cn, issuer,
                   "basicConstraints=critical,CA:TRUE,pathlen:0\n"
                   "keyUsage=critical,keyCertSign,cRLSign\n"
                   "subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n")

    def leaf(self, name: str, issuer: str, aia_url: str | None) -> None:
        ext = ("basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n"
               "extendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n"
               "subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n")
        if aia_url:
            ext += f"authorityInfoAccess=caIssuers;URI:{aia_url}\n"
        self.issue(name, "localhost", issuer, ext)

    def der(self, name: str) -> bytes:
        with open(self.path(name, "crt")) as fh:
            return ssl.PEM_cert_to_DER_cert(fh.read())


class _Quiet(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass


def _serve(server) -> None:
    threading.Thread(target=server.serve_forever, daemon=True).start()


class TlsTrust(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        pki = cls.pki = _Pki(cls.tmp.name)
        cls.hits: list[str] = []
        files: dict[str, bytes] = {}

        class Aia(_Quiet):
            def do_GET(self):
                cls.hits.append(self.path)
                body = files.get(self.path)
                if body is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/pkix-cert")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        cls.aia_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Aia)
        _serve(cls.aia_server)
        base = f"http://127.0.0.1:{cls.aia_server.server_address[1]}"

        # Честная цепочка: наш тестовый корень → промежуточный → лист.
        pki.root("root", "Test Trusted Root")
        pki.ca("inter", "Test Inter CA", "root")
        pki.leaf("leaf", "inter", f"{base}/inter.crt")
        pki.leaf("leaf_noaia", "inter", None)
        # PEM-вариант раздачи того же промежуточного.
        pki.leaf("leaf_pem", "inter", f"{base}/inter.pem")
        # Подделка: чужой корень → промежуточный с ТЕМ ЖЕ именем → лист.
        pki.root("evil_root", "Evil Root")
        pki.ca("evil_inter", "Test Inter CA", "evil_root")
        pki.leaf("evil_leaf", "evil_inter", f"{base}/evil_inter.crt")
        # «Издатель» самоподписанный: лист прямо от чужого корня.
        pki.leaf("evil_leaf2", "evil_root", f"{base}/evil_root.crt")

        files["/inter.crt"] = pki.der("inter")
        with open(pki.path("inter", "crt"), "rb") as fh:
            files["/inter.pem"] = fh.read()
        files["/evil_inter.crt"] = pki.der("evil_inter")
        files["/evil_root.crt"] = pki.der("evil_root")

        class Site(_Quiet):
            def do_GET(self):
                body = b"<html><title>ok</title><body>ok</body></html>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        cls.sites: dict[str, int] = {}
        cls.servers = [cls.aia_server]
        for name in ("leaf", "leaf_noaia", "leaf_pem", "evil_leaf", "evil_leaf2"):
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Site)
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            # Только лист, без промежуточного: неполная цепочка.
            ctx.load_cert_chain(pki.path(name, "crt"), pki.path(name, "key"))
            server.socket = ctx.wrap_socket(server.socket, server_side=True)
            _serve(server)
            cls.servers.append(server)
            cls.sites[name] = server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        for server in cls.servers:
            server.shutdown()
            server.server_close()
        cls.tmp.cleanup()

    def setUp(self):
        engine._aia_cache.clear()
        self.hits.clear()

    def make_context(self) -> ssl.SSLContext:
        ctx = engine.new_trust_context()
        ctx.load_verify_locations(cafile=self.pki.path("root", "crt"))
        return ctx

    def open(self, site: str, *, allow_private: bool = True) -> str:
        handler = engine._PinnedHTTPSHandler(
            {}, allow_private=allow_private, make_context=self.make_context
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), handler)
        with opener.open(f"https://127.0.0.1:{self.sites[site]}/", timeout=10) as resp:
            return resp.read().decode()

    def assert_untrusted(self, site: str, **kw) -> None:
        with self.assertRaises(urllib.error.URLError) as cm:
            self.open(site, **kw)
        self.assertIsInstance(cm.exception.reason, ssl.SSLError, cm.exception)

    # --- Минцифры для любого хоста -------------------------------------------

    def test_any_host_context_has_mincifry_and_verifies(self):
        handler = engine._PinnedHTTPSHandler({})
        seen = {}

        def fake_do_open(conn, req, context=None):
            seen[req.host] = context
            raise RuntimeError("stop")

        handler.do_open = fake_do_open
        for url in ("https://www.tbank.ru/career/", "https://rabota.sber.ru/",
                    "https://careers.example.com/"):
            with self.assertRaises(RuntimeError):
                handler.https_open(urllib.request.Request(url))
        for host, ctx in seen.items():
            self.assertIs(ctx, engine.trust_context(), host)
            names = {dict(x["subject"][-1]).get("commonName") for x in ctx.get_ca_certs()}
            self.assertIn("Russian Trusted Root CA", names, host)
            self.assertIn("Russian Trusted Sub CA", names, host)
            self.assertTrue(ctx.check_hostname, host)
            self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED, host)

    def test_engine_wires_trust_context(self):
        eng = engine.JupiterWebEngine({"rabota.sber.ru"})
        handler = next(h for h in eng.opener.handlers
                       if isinstance(h, engine._PinnedHTTPSHandler))
        self.assertIs(handler._context, engine.trust_context())
        self.assertFalse(handler._aia.allow_private)

    # --- разбор AIA -----------------------------------------------------------

    def test_aia_parse_real_mincifry_sub_ca(self):
        pems = re.findall(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
                          open(RU_PEM, encoding="utf-8").read(), re.S)
        root, sub = (ssl.PEM_cert_to_DER_cert(p) for p in pems)
        self.assertEqual(engine.aia_ca_issuer_urls(sub), [
            "http://rostelecom.ru/cdp/rootca_ssl_rsa2022.crt",
            "http://company.rt.ru/cdp/rootca_ssl_rsa2022.crt",
            "http://reestr-pki.ru/cdp/rootca_ssl_rsa2022.crt",
        ])
        self.assertEqual(engine.aia_ca_issuer_urls(root), [])
        issuer, subject = engine.cert_issuer_subject(root)
        self.assertEqual(issuer, subject)
        issuer, subject = engine.cert_issuer_subject(sub)
        self.assertNotEqual(issuer, subject)

    def test_aia_parse_generated_leaf_and_garbage(self):
        port = self.aia_server.server_address[1]
        self.assertEqual(engine.aia_ca_issuer_urls(self.pki.der("leaf")),
                         [f"http://127.0.0.1:{port}/inter.crt"])
        self.assertEqual(engine.aia_ca_issuer_urls(self.pki.der("leaf_noaia")), [])
        der = self.pki.der("leaf")
        for junk in (b"", b"\x30", b"\x30\x84\xff\xff\xff\xff", der[:-7], b"hello" * 50):
            self.assertEqual(engine.aia_ca_issuer_urls(junk), [])

    # --- рукопожатие ----------------------------------------------------------

    def test_incomplete_chain_without_aia_fails(self):
        self.assert_untrusted("leaf_noaia")
        self.assertEqual(self.hits, [])

    def test_incomplete_chain_with_aia_opens(self):
        self.assertIn("ok", self.open("leaf"))
        self.assertEqual(self.hits, ["/inter.crt"])
        # Второй раз — из кэша, без скачивания.
        self.assertIn("ok", self.open("leaf"))
        self.assertEqual(self.hits, ["/inter.crt"])

    def test_aia_pem_is_accepted(self):
        self.assertIn("ok", self.open("leaf_pem"))
        self.assertEqual(self.hits, ["/inter.pem"])

    def test_aia_still_checks_hostname(self):
        handler = engine._PinnedHTTPSHandler({}, allow_private=True,
                                             make_context=self.make_context)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), handler)
        # Лист выписан на localhost/127.0.0.1; соединяемся на тот же адрес,
        # но просим другое имя.
        handler.pins["wrong.example"] = "127.0.0.1"
        with self.assertRaises(urllib.error.URLError):
            opener.open(f"https://wrong.example:{self.sites['leaf']}/", timeout=10)

    def test_fake_intermediate_from_untrusted_root_fails(self):
        self.assert_untrusted("evil_leaf")
        self.assertEqual(self.hits, ["/evil_inter.crt"])

    def test_self_signed_issuer_is_never_loaded(self):
        self.assert_untrusted("evil_leaf2")
        self.assertNotIn("/evil_root.crt", engine._aia_cache)
        with self.assertRaises(engine.EngineSecurityError):
            engine._fetch_ca_issuer(
                f"http://127.0.0.1:{self.aia_server.server_address[1]}/evil_root.crt",
                allow_private=True, base_context=self.make_context())

    def test_anchor_check_alone_stops_self_signed_issuer(self):
        # Второй рубеж отдельно: имя «издателя» не распознано как
        # самоподписанное (например, отличается регистром — OpenSSL сравнивает
        # имена канонически) и сертификат попал в хранилище. Рукопожатие тогда
        # проходит, но вершина цепочки — скачанный сертификат, и соединение
        # закрывается.
        original = engine.cert_issuer_subject
        engine.cert_issuer_subject = lambda der: (b"issuer", b"subject")
        try:
            self.assert_untrusted("evil_leaf2")
        finally:
            engine.cert_issuer_subject = original
        self.assertEqual(self.hits, ["/evil_root.crt"])

    def test_fake_intermediate_not_anchor_even_directly_loaded(self):
        # Самая прямая проверка инварианта: подсовываем в хранилище чужой
        # несамоподписанный промежуточный — без PARTIAL_CHAIN он не якорь.
        aia = engine._AiaTrust(self.make_context, allow_private=True)
        ctx = aia.context_with(self.pki.der("evil_inter"))
        self.assertFalse(ctx.verify_flags & getattr(ssl, "VERIFY_X509_PARTIAL_CHAIN", 0))
        import socket
        raw = socket.create_connection(("127.0.0.1", self.sites["evil_leaf"]), 10)
        with self.assertRaises(ssl.SSLCertVerificationError):
            ctx.wrap_socket(raw, server_hostname="localhost")
        raw.close()

    def test_aia_to_internal_address_blocked_by_policy(self):
        # allow_private=False: боевой режим. AIA указывает на 127.0.0.1 —
        # политика не пускает, остаётся исходная ошибка проверки.
        self.assert_untrusted("leaf", allow_private=False)
        self.assertEqual(self.hits, [])

    def test_oversized_aia_rejected(self):
        big = b"\x30" * (engine._AIA_MAX_BYTES + 10)

        class Big(_Quiet):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(big)

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Big)
        _serve(server)
        try:
            with self.assertRaises(engine.EngineError):
                engine._fetch_ca_issuer(
                    f"http://127.0.0.1:{server.server_address[1]}/x.crt",
                    allow_private=True, base_context=self.make_context())
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=1)
