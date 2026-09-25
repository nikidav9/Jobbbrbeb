#!/usr/bin/env python3
"""Tests for jupiter/js_engine.py — QuickJS-based API endpoint discovery."""
from __future__ import annotations

import json
import unittest

try:
    import quickjs  # noqa: F401
    HAS_QUICKJS = True
except ImportError:
    HAS_QUICKJS = False

from js_engine import (
    InterceptedRequest,
    JsEngine,
    JsEngineResult,
    extract_scripts,
    discover_endpoints,
)


class ExtractScriptsTest(unittest.TestCase):
    def test_inline_executable(self) -> None:
        html = '<script>var x = 1;</script>'
        scripts = extract_scripts(html)
        self.assertEqual(len(scripts), 1)
        self.assertEqual(scripts[0].body, "var x = 1;")
        self.assertFalse(scripts[0].is_module)
        self.assertEqual(scripts[0].src, "")

    def test_module_type(self) -> None:
        html = '<script type="module">import {a} from "./b";</script>'
        scripts = extract_scripts(html)
        self.assertEqual(len(scripts), 1)
        self.assertTrue(scripts[0].is_module)

    def test_external_src(self) -> None:
        html = '<script src="/js/app.js"></script>'
        scripts = extract_scripts(html)
        self.assertEqual(len(scripts), 1)
        self.assertEqual(scripts[0].src, "/js/app.js")
        self.assertEqual(scripts[0].body, "")

    def test_skip_json_ld(self) -> None:
        html = '<script type="application/ld+json">{"@type": "Thing"}</script>'
        scripts = extract_scripts(html)
        self.assertEqual(len(scripts), 0)

    def test_skip_data_script(self) -> None:
        html = '<script type="application/json" id="config">{"key": "val"}</script>'
        scripts = extract_scripts(html)
        self.assertEqual(len(scripts), 0)

    def test_multiple_in_order(self) -> None:
        html = """
        <script>var a = 1;</script>
        <script type="text/javascript">var b = 2;</script>
        <script type="application/ld+json">{}</script>
        <script>var c = 3;</script>
        """
        scripts = extract_scripts(html)
        self.assertEqual(len(scripts), 3)
        self.assertEqual(scripts[0].order, 0)
        self.assertEqual(scripts[1].order, 1)
        self.assertEqual(scripts[2].order, 3)

    def test_skip_oversized_inline(self) -> None:
        html = '<script>' + 'x' * (600 * 1024) + '</script>'
        scripts = extract_scripts(html)
        self.assertEqual(len(scripts), 0)


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class FetchInterceptionTest(unittest.TestCase):
    def test_simple_fetch(self) -> None:
        html = """
        <html><body>
        <script>
        fetch('/api/vacancies', {method: 'POST', headers: {'X-Token': 'abc'}, body: '{"city":1}'});
        </script>
        </body></html>
        """
        result = discover_endpoints(html, "https://career.example.com/vacancy/42")
        self.assertEqual(len(result.intercepted), 1)
        req = result.intercepted[0]
        self.assertEqual(req.url, "https://career.example.com/api/vacancies")
        self.assertEqual(req.method, "POST")
        self.assertEqual(req.headers.get("X-Token"), "abc")
        self.assertEqual(req.body, '{"city":1}')
        self.assertEqual(req.source, "fetch")

    def test_absolute_url(self) -> None:
        html = '<script>fetch("https://api.ext.com/v2/data");</script>'
        result = discover_endpoints(html, "https://other.com/page")
        self.assertEqual(len(result.intercepted), 1)
        self.assertEqual(result.intercepted[0].url, "https://api.ext.com/v2/data")

    def test_get_default_method(self) -> None:
        html = '<script>fetch("/api/list");</script>'
        result = discover_endpoints(html, "https://example.com/")
        self.assertEqual(result.intercepted[0].method, "GET")

    def test_xhr_interception(self) -> None:
        html = """
        <script>
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/apply');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send('{"name":"test"}');
        </script>
        """
        result = discover_endpoints(html, "https://career.example.com/form")
        self.assertEqual(len(result.intercepted), 1)
        req = result.intercepted[0]
        self.assertEqual(req.url, "https://career.example.com/api/apply")
        self.assertEqual(req.method, "POST")
        self.assertEqual(req.body, '{"name":"test"}')
        self.assertEqual(req.source, "xhr")
        self.assertEqual(req.headers.get("Content-Type"), "application/json")


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class DOMContentLoadedTest(unittest.TestCase):
    def test_dcl_fires_deferred_fetch(self) -> None:
        html = """
        <script>
        document.addEventListener('DOMContentLoaded', function() {
            fetch('/api/init');
        });
        </script>
        """
        result = discover_endpoints(html, "https://example.com/")
        self.assertEqual(len(result.intercepted), 1)
        self.assertEqual(result.intercepted[0].url, "https://example.com/api/init")

    def test_window_load_fires(self) -> None:
        html = """
        <script>
        window.addEventListener('load', function() {
            fetch('/api/on-load');
        });
        </script>
        """
        result = discover_endpoints(html, "https://example.com/")
        self.assertEqual(len(result.intercepted), 1)
        self.assertIn("/api/on-load", result.intercepted[0].url)

    def test_settimeout_drains(self) -> None:
        html = """
        <script>
        setTimeout(function() {
            fetch('/api/delayed');
        }, 100);
        </script>
        """
        result = discover_endpoints(html, "https://example.com/")
        self.assertEqual(len(result.intercepted), 1)


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class ExternalScriptsTest(unittest.TestCase):
    def test_external_script_executed(self) -> None:
        html = '<script src="/js/app.js"></script>'
        ext = {"https://example.com/js/app.js": "fetch('/api/from-external');"}
        result = discover_endpoints(
            html, "https://example.com/page",
            external_scripts=ext,
        )
        self.assertEqual(len(result.intercepted), 1)
        self.assertIn("/api/from-external", result.intercepted[0].url)

    def test_missing_external_skipped(self) -> None:
        html = '<script src="/js/missing.js"></script><script>fetch("/api/inline");</script>'
        result = discover_endpoints(html, "https://example.com/page")
        self.assertEqual(len(result.intercepted), 1)
        self.assertIn("/api/inline", result.intercepted[0].url)


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class GlobalVarsTest(unittest.TestCase):
    def test_next_data_extracted(self) -> None:
        html = """
        <script>
        window.__NEXT_DATA__ = {"props": {"pageProps": {"vacancy": {"id": 42}}}};
        </script>
        """
        result = discover_endpoints(html, "https://example.com/vacancy/42")
        self.assertIn("__NEXT_DATA__", result.global_vars)
        self.assertEqual(
            result.global_vars["__NEXT_DATA__"]["props"]["pageProps"]["vacancy"]["id"],
            42,
        )

    def test_nuxt_state_extracted(self) -> None:
        html = """
        <script>
        window.__NUXT__ = {state: {vacancies: [{id: 1}]}};
        </script>
        """
        result = discover_endpoints(html, "https://example.com/")
        self.assertIn("__NUXT__", result.global_vars)

    def test_no_globals_when_absent(self) -> None:
        html = "<script>var x = 1;</script>"
        result = discover_endpoints(html, "https://example.com/")
        self.assertEqual(result.global_vars, {})


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class SafetyTest(unittest.TestCase):
    def test_infinite_loop_terminates(self) -> None:
        html = "<script>while(true){}</script>"
        engine = JsEngine(time_limit=1)
        result = engine.execute_page(html, "https://example.com/")
        self.assertTrue(len(result.errors) > 0)

    def test_memory_bomb_contained(self) -> None:
        html = "<script>var a = []; while(true) a.push(new Array(10000));</script>"
        engine = JsEngine(memory_limit=5 * 1024 * 1024, time_limit=2)
        result = engine.execute_page(html, "https://example.com/")
        self.assertTrue(len(result.errors) > 0)

    def test_script_error_doesnt_kill_engine(self) -> None:
        html = """
        <script>throw new Error('boom');</script>
        <script>fetch('/api/still-works');</script>
        """
        result = discover_endpoints(html, "https://example.com/")
        self.assertEqual(len(result.intercepted), 1)
        self.assertIn("/api/still-works", result.intercepted[0].url)
        self.assertTrue(any("boom" in e for e in result.errors))

    def test_empty_html(self) -> None:
        result = discover_endpoints("", "https://example.com/")
        self.assertEqual(result.intercepted, [])
        self.assertEqual(result.errors, [])


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class LocationTest(unittest.TestCase):
    def test_location_reflects_page_url(self) -> None:
        html = """
        <script>
        fetch('/api/test?from=' + window.location.hostname);
        </script>
        """
        result = discover_endpoints(html, "https://career.sber.ru/vacancy/123?ref=main")
        self.assertEqual(len(result.intercepted), 1)
        self.assertIn("career.sber.ru", result.intercepted[0].url)

    def test_relative_url_resolved(self) -> None:
        html = '<script>fetch("api/v1/data");</script>'
        result = discover_endpoints(html, "https://example.com/app/page")
        self.assertEqual(
            result.intercepted[0].url,
            "https://example.com/app/api/v1/data",
        )


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class RealisticSpaTest(unittest.TestCase):
    """Simulate patterns from real career sites."""

    def test_next_js_pattern(self) -> None:
        html = """
        <html>
        <head>
        <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"vacancy":{"id":999,"title":"Кассир"}}}}
        </script>
        </head>
        <body>
        <div id="__next"></div>
        <script>
        // Typical Next.js hydration — reads __NEXT_DATA__ and fetches API
        var data = JSON.parse(document.getElementById('__NEXT_DATA__') ? '{}' : '{}');
        // App code fetches additional data
        fetch('/api/v1/vacancy/999/similar');
        fetch('/api/v1/geo/cities');
        </script>
        </body>
        </html>
        """
        result = discover_endpoints(html, "https://career.example.com/vacancy/999")
        urls = [r.url for r in result.intercepted]
        self.assertTrue(any("/api/v1/vacancy/999/similar" in u for u in urls))
        self.assertTrue(any("/api/v1/geo/cities" in u for u in urls))

    def test_config_driven_api(self) -> None:
        """Site reads API base from config and constructs fetch URL."""
        html = """
        <script>
        var __CONFIG__ = {apiBase: 'https://api.career.example.com/v2'};
        </script>
        <script>
        document.addEventListener('DOMContentLoaded', function() {
            fetch(__CONFIG__.apiBase + '/vacancies?limit=20');
        });
        </script>
        """
        result = discover_endpoints(html, "https://career.example.com/")
        self.assertEqual(len(result.intercepted), 1)
        self.assertEqual(
            result.intercepted[0].url,
            "https://api.career.example.com/v2/vacancies?limit=20",
        )

    def test_form_submit_via_fetch(self) -> None:
        """Site submits application via fetch POST with JSON body."""
        html = """
        <script>
        function submitApplication(vacancyId, formData) {
            fetch('/api/applications', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-CSRF': 'token123'},
                body: JSON.stringify({vacancyId: vacancyId, ...formData}),
            });
        }
        // Auto-invoked on page load for pre-fill check
        fetch('/api/applications/check?vacancy=42');
        </script>
        """
        result = discover_endpoints(html, "https://career.example.com/apply/42")
        self.assertEqual(len(result.intercepted), 1)
        self.assertIn("/api/applications/check", result.intercepted[0].url)


@unittest.skipUnless(HAS_QUICKJS, "quickjs not installed")
class CookiesTest(unittest.TestCase):
    def test_cookies_exposed(self) -> None:
        html = """
        <script>
        var token = document.cookie.split(';').map(function(c){return c.trim();}).find(function(c){return c.startsWith('auth=');});
        if (token) {
            fetch('/api/profile', {headers: {'Authorization': 'Bearer ' + token.split('=')[1]}});
        }
        </script>
        """
        result = discover_endpoints(
            html, "https://example.com/", cookies="auth=mytoken123; other=val",
        )
        self.assertEqual(len(result.intercepted), 1)
        self.assertEqual(
            result.intercepted[0].headers.get("Authorization"),
            "Bearer mytoken123",
        )


if __name__ == "__main__":
    unittest.main()
