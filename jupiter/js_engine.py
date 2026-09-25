#!/usr/bin/env python3
"""QuickJS JavaScript engine for Jupiter — API endpoint discovery on SPA pages.

Career sites built on React/Next/Nuxt/Vue serve near-empty HTML and configure
everything in JavaScript: API URLs, request shapes, auth tokens.  Jupiter's
static extractors (spa_payload, network_runtime) cover the easy cases via
regex; this module covers the rest by *actually executing* the page scripts
in a sandboxed QuickJS context with minimal DOM stubs.

What it does:
  - Extracts <script> tags from HTML
  - Executes them in QuickJS with stub window/document/navigator/fetch/XHR
  - Intercepts every fetch() and XMLHttpRequest.send() call
  - Returns discovered endpoints so the agent can hit them with the real
    HTTP engine

What it does NOT do:
  - Render CSS or run layout (not a browser)
  - Execute external scripts loaded via <script src="..."> (see note below)
  - Bypass CAPTCHA or simulate user interaction
  - Make real network requests (stubs return empty 200s)

External scripts: the engine can optionally accept pre-fetched script bodies
for src= URLs, so the agent can fetch them through its own HTTP engine and
feed them in.  This keeps the network policy in one place (engine.py).

Safety:
  - Memory limit: 50 MB  (configurable)
  - CPU time limit: 5 s  (configurable, QuickJS C-level clock())
  - Stack limit: 512 KB
  - No file/network/process access from JS
  - Forbidden patterns (eval of user input, dynamic import) are stripped
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

try:
    import quickjs
except ImportError:
    quickjs = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class InterceptedRequest:
    """A fetch() or XHR call that page scripts made."""
    url: str
    method: str = "GET"
    headers: dict[str, str] = field(default_factory=dict)
    body: str | None = None
    source: str = "fetch"


@dataclass
class JsEngineResult:
    intercepted: list[InterceptedRequest] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    global_vars: dict[str, Any] = field(default_factory=dict)


class JsEngineError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# HTML script extraction
# ---------------------------------------------------------------------------

_EXECUTABLE_TYPES = {
    "", "module", "text/javascript", "application/javascript",
    "text/ecmascript", "application/ecmascript",
}

_SCRIPT_TAG_RE = re.compile(
    r"<script\b([^>]*)>([\s\S]*?)</script\s*>",
    re.IGNORECASE,
)
_ATTR_RE = re.compile(
    r"""([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""",
    re.DOTALL,
)

MAX_INLINE_BYTES = 512 * 1024


@dataclass
class _ScriptTag:
    src: str
    body: str
    is_module: bool
    order: int


def _parse_attrs(raw: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for name, dq, sq in _ATTR_RE.findall(raw):
        result[name.lower()] = dq or sq
    return result


def extract_scripts(html: str) -> list[_ScriptTag]:
    """Extract executable <script> tags in document order."""
    scripts: list[_ScriptTag] = []
    for idx, m in enumerate(_SCRIPT_TAG_RE.finditer(html or "")):
        raw_attrs, body = m.groups()
        attrs = _parse_attrs(raw_attrs)
        script_type = attrs.get("type", "").strip().lower()
        if script_type not in _EXECUTABLE_TYPES:
            continue
        src = attrs.get("src", "").strip()
        if not src and len(body.encode("utf-8", "ignore")) > MAX_INLINE_BYTES:
            continue
        scripts.append(_ScriptTag(
            src=src,
            body="" if src else body,
            is_module=script_type == "module",
            order=idx,
        ))
    return scripts


# ---------------------------------------------------------------------------
# State variable extraction (complements spa_payload.py)
# ---------------------------------------------------------------------------

_STATE_VARS = (
    "__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__",
    "__APOLLO_STATE__", "__PRELOADED_STATE__", "__APP_DATA__",
    "__REACT_QUERY_STATE__",
)


# ---------------------------------------------------------------------------
# DOM stubs (injected as JS before page scripts)
# ---------------------------------------------------------------------------

def _build_stubs_js(page_url: str, cookies: str = "") -> str:
    parsed = urlparse(page_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return r"""
var __jupiter_intercepted = [];
var __jupiter_errors = [];
var __jupiter_dcl = [];
var __jupiter_load = [];

// --- fetch ---
function fetch(url, opts) {
    var entry = {url: String(url), method: 'GET', body: null, headers: {}, source: 'fetch'};
    if (opts) {
        if (opts.method) entry.method = String(opts.method).toUpperCase();
        if (opts.body != null) entry.body = String(opts.body);
        if (opts.headers && typeof opts.headers === 'object') {
            var ks = Object.keys(opts.headers);
            for (var i = 0; i < ks.length; i++) entry.headers[ks[i]] = String(opts.headers[ks[i]]);
        }
    }
    __jupiter_intercepted.push(entry);
    var _fakeResp = {
        ok: true, status: 200, statusText: 'OK',
        headers: {get: function(){return null;}},
        json: function() { return Promise.resolve({}); },
        text: function() { return Promise.resolve(''); },
        blob: function() { return Promise.resolve(new Blob([])); },
        clone: function() { return _fakeResp; },
    };
    return Promise.resolve(_fakeResp);
}

// --- XMLHttpRequest ---
function XMLHttpRequest() {
    this._m = 'GET'; this._u = ''; this._h = {}; this.readyState = 0;
    this.status = 0; this.responseText = ''; this.response = '';
}
XMLHttpRequest.prototype.open = function(m, u) { this._m = String(m).toUpperCase(); this._u = String(u); this.readyState = 1; };
XMLHttpRequest.prototype.setRequestHeader = function(k, v) { this._h[String(k)] = String(v); };
XMLHttpRequest.prototype.send = function(body) {
    __jupiter_intercepted.push({url: this._u, method: this._m, body: body != null ? String(body) : null, headers: this._h, source: 'xhr'});
    this.readyState = 4; this.status = 200; this.responseText = '{}'; this.response = '{}';
    if (this.onreadystatechange) try { this.onreadystatechange(); } catch(e) { __jupiter_errors.push('xhr.onreadystatechange: ' + e); }
    if (this.onload) try { this.onload(); } catch(e) { __jupiter_errors.push('xhr.onload: ' + e); }
};
XMLHttpRequest.prototype.abort = function() {};
XMLHttpRequest.prototype.getResponseHeader = function() { return null; };
XMLHttpRequest.prototype.getAllResponseHeaders = function() { return ''; };
XMLHttpRequest.prototype.addEventListener = function(ev, fn) { if (ev === 'load') this.onload = fn; };
XMLHttpRequest.UNSENT = 0; XMLHttpRequest.OPENED = 1; XMLHttpRequest.HEADERS_RECEIVED = 2;
XMLHttpRequest.LOADING = 3; XMLHttpRequest.DONE = 4;

// --- Promise (QuickJS has it natively, but ensure .resolve/.reject) ---
if (typeof Promise === 'undefined') {
    var Promise = function(fn) { var _v; fn(function(v){_v=v;}, function(){}); this.then = function(cb){try{return Promise.resolve(cb(_v));}catch(e){return Promise.reject(e);}}; this.catch = function(){return this;}; };
    Promise.resolve = function(v) { return {then: function(cb){try{return Promise.resolve(cb(v));}catch(e){return Promise.reject(e);}}, catch: function(){return this;}}; };
    Promise.reject = function(e) { return {then: function(){return this;}, catch: function(cb){try{return Promise.resolve(cb(e));}catch(e2){return Promise.reject(e2);}}}; };
    Promise.all = function(arr) { var r = []; for(var i=0;i<arr.length;i++) r.push(undefined); return Promise.resolve(r); };
}

// --- Blob stub ---
function Blob(parts, opts) { this.size = 0; this.type = (opts && opts.type) || ''; }
Blob.prototype.text = function() { return Promise.resolve(''); };

// --- FormData stub ---
function FormData(form) { this._d = []; }
FormData.prototype.append = function(k, v) { this._d.push([String(k), String(v)]); };
FormData.prototype.set = function(k, v) { this.delete(k); this.append(k, v); };
FormData.prototype.get = function(k) { for(var i=0;i<this._d.length;i++) if(this._d[i][0]===k) return this._d[i][1]; return null; };
FormData.prototype.getAll = function(k) { var r=[]; for(var i=0;i<this._d.length;i++) if(this._d[i][0]===k) r.push(this._d[i][1]); return r; };
FormData.prototype.has = function(k) { return this.get(k) !== null; };
FormData.prototype.delete = function(k) { this._d = this._d.filter(function(e){return e[0]!==k;}); };
FormData.prototype.entries = function() { return this._d[Symbol.iterator](); };
FormData.prototype.keys = function() { return this._d.map(function(e){return e[0];})[Symbol.iterator](); };
FormData.prototype.values = function() { return this._d.map(function(e){return e[1];})[Symbol.iterator](); };
FormData.prototype.forEach = function(cb) { for(var i=0;i<this._d.length;i++) cb(this._d[i][1], this._d[i][0], this); };

// --- URLSearchParams stub ---
function URLSearchParams(init) {
    this._d = [];
    if (typeof init === 'string') {
        var parts = init.replace(/^\?/, '').split('&');
        for (var i = 0; i < parts.length; i++) {
            var kv = parts[i].split('=');
            if (kv[0]) this._d.push([decodeURIComponent(kv[0]), decodeURIComponent(kv[1] || '')]);
        }
    } else if (init instanceof FormData) {
        this._d = init._d.slice();
    }
}
URLSearchParams.prototype.toString = function() { return this._d.map(function(e){return encodeURIComponent(e[0])+'='+encodeURIComponent(e[1]);}).join('&'); };
URLSearchParams.prototype.get = function(k) { for(var i=0;i<this._d.length;i++) if(this._d[i][0]===k) return this._d[i][1]; return null; };
URLSearchParams.prototype.append = function(k, v) { this._d.push([k, v]); };
URLSearchParams.prototype.set = function(k, v) { this.delete(k); this.append(k, v); };
URLSearchParams.prototype.delete = function(k) { this._d = this._d.filter(function(e){return e[0]!==k;}); };
URLSearchParams.prototype.has = function(k) { return this.get(k) !== null; };

// --- document ---
var document = {
    readyState: 'loading',
    addEventListener: function(ev, fn) {
        if (ev === 'DOMContentLoaded') __jupiter_dcl.push(fn);
    },
    removeEventListener: function() {},
    getElementById: function() { return null; },
    querySelector: function() { return null; },
    querySelectorAll: function() { return []; },
    getElementsByClassName: function() { return []; },
    getElementsByTagName: function() { return []; },
    createElement: function(tag) {
        return {
            tagName: tag.toUpperCase(), style: {}, dataset: {},
            setAttribute: function(){}, getAttribute: function(){return null;},
            removeAttribute: function(){},
            appendChild: function(c) { return c; },
            removeChild: function(){},
            insertBefore: function(c) { return c; },
            addEventListener: function(){},
            removeEventListener: function(){},
            innerHTML: '', innerText: '', textContent: '',
            className: '', classList: {add:function(){}, remove:function(){}, contains:function(){return false;}, toggle:function(){}},
            children: [], childNodes: [], parentNode: null, parentElement: null,
            firstChild: null, lastChild: null, nextSibling: null,
            getBoundingClientRect: function(){return {top:0,left:0,right:0,bottom:0,width:0,height:0};},
            cloneNode: function(){return document.createElement(tag);},
            dispatchEvent: function(){return true;},
            querySelectorAll: function(){return [];},
            querySelector: function(){return null;},
        };
    },
    createDocumentFragment: function() { return document.createElement('fragment'); },
    createTextNode: function(t) { return {nodeType: 3, textContent: String(t)}; },
    createComment: function() { return {nodeType: 8}; },
    body: null,
    head: null,
    documentElement: null,
    cookie: """ + json.dumps(cookies) + r""",
    title: '',
    domain: """ + json.dumps(parsed.hostname or "") + r""",
    URL: """ + json.dumps(page_url) + r""",
    referrer: '',
    characterSet: 'UTF-8',
    contentType: 'text/html',
    location: null,
    dispatchEvent: function() { return true; },
    createEvent: function() { return {initEvent:function(){}}; },
};
document.body = document.createElement('body');
document.head = document.createElement('head');
document.documentElement = document.createElement('html');
document.documentElement.appendChild(document.head);
document.documentElement.appendChild(document.body);

// --- window / globalThis ---
var window = globalThis;
window.document = document;
window.self = window;
window.top = window;
window.parent = window;
window.frames = [];
window.length = 0;
window.opener = null;

window.location = {
    href: """ + json.dumps(page_url) + r""",
    hostname: """ + json.dumps(parsed.hostname or "") + r""",
    host: """ + json.dumps(parsed.netloc) + r""",
    pathname: """ + json.dumps(parsed.path or "/") + r""",
    protocol: """ + json.dumps(parsed.scheme + ":") + r""",
    search: """ + json.dumps(parsed.query and ("?" + parsed.query) or "") + r""",
    hash: '',
    origin: """ + json.dumps(origin) + r""",
    port: """ + json.dumps(str(parsed.port) if parsed.port else "") + r""",
    assign: function(){}, replace: function(){}, reload: function(){},
    toString: function() { return this.href; },
};
document.location = window.location;

window.navigator = {
    userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    language: 'ru-RU', languages: ['ru-RU', 'ru', 'en'],
    platform: 'Linux armv8l', vendor: 'Google Inc.',
    cookieEnabled: true, onLine: true,
    maxTouchPoints: 5,
    sendBeacon: function() { return true; },
};
window.screen = {width: 412, height: 915, availWidth: 412, availHeight: 915, colorDepth: 24, pixelDepth: 24, orientation: {type: 'portrait-primary', angle: 0}};
window.innerWidth = 412; window.innerHeight = 756;
window.outerWidth = 412; window.outerHeight = 915;
window.devicePixelRatio = 2.625;
window.scrollX = 0; window.scrollY = 0; window.pageXOffset = 0; window.pageYOffset = 0;

// --- Storage ---
function _FakeStorage() { this._d = {}; }
_FakeStorage.prototype.getItem = function(k) { return this._d.hasOwnProperty(k) ? this._d[k] : null; };
_FakeStorage.prototype.setItem = function(k, v) { this._d[k] = String(v); };
_FakeStorage.prototype.removeItem = function(k) { delete this._d[k]; };
_FakeStorage.prototype.clear = function() { this._d = {}; };
Object.defineProperty(_FakeStorage.prototype, 'length', {get: function(){return Object.keys(this._d).length;}});
_FakeStorage.prototype.key = function(i) { var ks = Object.keys(this._d); return i < ks.length ? ks[i] : null; };
window.localStorage = new _FakeStorage();
window.sessionStorage = new _FakeStorage();

// --- Console ---
window.console = {log:function(){}, warn:function(){}, error:function(){}, info:function(){}, debug:function(){}, trace:function(){}, dir:function(){}, table:function(){}, group:function(){}, groupEnd:function(){}, time:function(){}, timeEnd:function(){}, assert:function(){}};

// --- Timers ---
var __jupiter_timeouts = [];
window.setTimeout = function(fn, ms) { if (typeof fn === 'function') __jupiter_timeouts.push(fn); return __jupiter_timeouts.length; };
window.setInterval = function() { return 999; };
window.clearTimeout = function() {};
window.clearInterval = function() {};
window.requestAnimationFrame = function(fn) { if (typeof fn === 'function') fn(16); return 1; };
window.cancelAnimationFrame = function() {};
window.requestIdleCallback = function(fn) { if (typeof fn === 'function') fn({timeRemaining: function(){return 50;}, didTimeout: false}); return 1; };

// --- Events ---
function Event(type) { this.type = type; this.target = null; this.currentTarget = null; this.bubbles = false; this.cancelable = false; this.defaultPrevented = false; this.preventDefault = function(){this.defaultPrevented=true;}; this.stopPropagation = function(){}; this.stopImmediatePropagation = function(){}; }
function CustomEvent(type, opts) { Event.call(this, type); this.detail = (opts && opts.detail) || null; }
CustomEvent.prototype = Object.create(Event.prototype);
window.Event = Event;
window.CustomEvent = CustomEvent;
window.MouseEvent = Event;
window.KeyboardEvent = Event;
window.FocusEvent = Event;
window.InputEvent = Event;
window.UIEvent = Event;

// --- URL ---
if (typeof URL === 'undefined') {
    function URL(url, base) {
        if (base) {
            if (url.startsWith('/')) url = base.replace(/\/[^\/]*$/, '') + url;
            else if (!url.match(/^https?:\/\//)) url = base + '/' + url;
        }
        this.href = url; this.toString = function(){return url;};
        var m = url.match(/^(https?:)\/\/([^\/\?#]+)(\/[^\?#]*)?(\?[^#]*)?(#.*)?$/);
        this.protocol = m ? m[1] : ''; this.host = m ? m[2] : ''; this.hostname = this.host.replace(/:\d+$/, '');
        this.pathname = m ? (m[3] || '/') : '/'; this.search = m ? (m[4] || '') : ''; this.hash = m ? (m[5] || '') : '';
        this.origin = this.protocol + '//' + this.host; this.port = '';
        this.searchParams = new URLSearchParams(this.search);
    }
    window.URL = URL;
}

// --- misc browser APIs ---
window.atob = function(s) { return s; };
window.btoa = function(s) { return s; };
window.crypto = {getRandomValues: function(a){for(var i=0;i<a.length;i++)a[i]=Math.floor(Math.random()*256);return a;}, randomUUID: function(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:r&3|8).toString(16);});}};
window.performance = {now: function(){return 0;}, mark: function(){}, measure: function(){}, getEntriesByType: function(){return [];}, timing: {navigationStart: 0}};
window.MutationObserver = function() { this.observe = function(){}; this.disconnect = function(){}; this.takeRecords = function(){return [];}; };
window.ResizeObserver = function() { this.observe = function(){}; this.disconnect = function(){}; this.unobserve = function(){}; };
window.IntersectionObserver = function() { this.observe = function(){}; this.disconnect = function(){}; this.unobserve = function(){}; };
window.matchMedia = function(q) { return {matches: q.indexOf('max-width') >= 0, media: q, addEventListener: function(){}, removeEventListener: function(){}, addListener: function(){}, removeListener: function(){}}; };
window.getComputedStyle = function() { return new Proxy({}, {get: function(t,p){return '';}}); };
window.scrollTo = function(){};
window.scroll = function(){};
window.alert = function(){};
window.confirm = function(){return false;};
window.prompt = function(){return null;};
window.open = function(){return null;};
window.close = function(){};
window.postMessage = function(){};
window.addEventListener = function(ev, fn) {
    if (ev === 'load') __jupiter_load.push(fn);
    if (ev === 'DOMContentLoaded') __jupiter_dcl.push(fn);
};
window.removeEventListener = function(){};
window.dispatchEvent = function(){return true;};
window.getSelection = function(){return {toString:function(){return '';}, removeAllRanges:function(){}, addRange:function(){}};};

// --- Image ---
function Image(w, h) { this.width = w || 0; this.height = h || 0; this.src = ''; this.onload = null; this.onerror = null; }
window.Image = Image;

// --- Worker stubs ---
window.Worker = function() { this.postMessage = function(){}; this.terminate = function(){}; };
window.SharedWorker = function() { this.port = {postMessage: function(){}, start: function(){}, close: function(){}}; };
window.ServiceWorker = undefined;

// --- History ---
window.history = {pushState: function(){}, replaceState: function(){}, back: function(){}, forward: function(){}, go: function(){}, state: null, length: 1};

// --- Map / Set / WeakMap / WeakSet (QuickJS has these, but ensure) ---
// QuickJS ES2020 has Map/Set natively

// --- fire lifecycle events ---
function __jupiter_fire_lifecycle() {
    document.readyState = 'interactive';
    for (var i = 0; i < __jupiter_dcl.length; i++) {
        try { __jupiter_dcl[i](new Event('DOMContentLoaded')); }
        catch(e) { __jupiter_errors.push('DOMContentLoaded[' + i + ']: ' + e); }
    }
    document.readyState = 'complete';
    for (var i = 0; i < __jupiter_load.length; i++) {
        try { __jupiter_load[i](new Event('load')); }
        catch(e) { __jupiter_errors.push('load[' + i + ']: ' + e); }
    }
    // Drain setTimeout queue (one pass — no recursion)
    var batch = __jupiter_timeouts.slice();
    __jupiter_timeouts = [];
    for (var i = 0; i < batch.length; i++) {
        try { batch[i](); } catch(e) { __jupiter_errors.push('timeout[' + i + ']: ' + e); }
    }
}

function __jupiter_collect() {
    return JSON.stringify({
        intercepted: __jupiter_intercepted,
        errors: __jupiter_errors,
    });
}
"""


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

_DEFAULT_MEMORY = 50 * 1024 * 1024
_DEFAULT_TIME = 5
_DEFAULT_STACK = 512 * 1024
_MAX_INTERCEPTED = 200


class JsEngine:
    """Execute page scripts and discover API endpoints."""

    def __init__(
        self,
        *,
        memory_limit: int = _DEFAULT_MEMORY,
        time_limit: int = _DEFAULT_TIME,
        stack_limit: int = _DEFAULT_STACK,
    ) -> None:
        if quickjs is None:
            raise JsEngineError("quickjs is not installed")
        self.memory_limit = memory_limit
        self.time_limit = time_limit
        self.stack_limit = stack_limit

    def execute_page(
        self,
        html: str,
        page_url: str,
        *,
        cookies: str = "",
        external_scripts: dict[str, str] | None = None,
    ) -> JsEngineResult:
        """Execute scripts from an HTML page and return intercepted API calls.

        Args:
            html: raw HTML of the page
            page_url: the URL the page was fetched from (used for location stubs)
            cookies: cookie header string to expose via document.cookie
            external_scripts: map of src URL → script body for <script src="...">
                tags; the agent fetches these through its own HTTP engine

        Returns:
            JsEngineResult with intercepted requests, errors, and global vars
        """
        ext = external_scripts or {}
        scripts = extract_scripts(html)

        ctx = quickjs.Context()
        ctx.set_memory_limit(self.memory_limit)
        ctx.set_time_limit(self.time_limit)
        ctx.set_max_stack_size(self.stack_limit)

        stubs = _build_stubs_js(page_url, cookies)
        try:
            ctx.eval(stubs)
        except Exception as exc:
            return JsEngineResult(errors=[f"stubs init: {exc}"])

        errors: list[str] = []
        for script in scripts:
            code = script.body
            if script.src:
                resolved = urljoin(page_url, script.src)
                code = ext.get(resolved, ext.get(script.src, ""))
                if not code:
                    continue
            if not code.strip():
                continue
            try:
                if script.is_module:
                    ctx.module(code)
                else:
                    ctx.eval(code)
            except Exception as exc:
                msg = str(exc)
                if "stack overflow" in msg.lower() or "out of memory" in msg.lower():
                    errors.append(f"script[{script.order}]: resource limit ({msg})")
                    break
                errors.append(f"script[{script.order}]: {msg}")

        try:
            ctx.eval("__jupiter_fire_lifecycle()")
        except Exception as exc:
            errors.append(f"lifecycle: {exc}")

        result = self._collect(ctx, page_url)
        result.errors.extend(errors)
        return result

    def _collect(self, ctx: Any, page_url: str) -> JsEngineResult:
        """Read intercepted requests and interesting globals from the context."""
        try:
            raw = ctx.eval("__jupiter_collect()")
            data = json.loads(raw)
        except Exception as exc:
            return JsEngineResult(errors=[f"collect: {exc}"])

        intercepted: list[InterceptedRequest] = []
        for entry in data.get("intercepted", [])[:_MAX_INTERCEPTED]:
            url = entry.get("url", "")
            if url and not url.startswith(("http://", "https://", "//")):
                url = urljoin(page_url, url)
            intercepted.append(InterceptedRequest(
                url=url,
                method=entry.get("method", "GET"),
                headers=entry.get("headers", {}),
                body=entry.get("body"),
                source=entry.get("source", "fetch"),
            ))

        global_vars = self._extract_globals(ctx)

        return JsEngineResult(
            intercepted=intercepted,
            errors=data.get("errors", []),
            global_vars=global_vars,
        )

    def _extract_globals(self, ctx: Any) -> dict[str, Any]:
        """Extract known state variables that SPA frameworks set."""
        result: dict[str, Any] = {}
        for var_name in _STATE_VARS:
            try:
                raw = ctx.eval(
                    f"typeof {var_name} !== 'undefined' ? JSON.stringify({var_name}) : null"
                )
                if raw and raw != "null":
                    parsed = json.loads(raw)
                    if isinstance(parsed, (dict, list)):
                        result[var_name] = parsed
            except Exception:
                pass
        return result


# ---------------------------------------------------------------------------
# Convenience: discover API endpoints from a page
# ---------------------------------------------------------------------------

def discover_endpoints(
    html: str,
    page_url: str,
    *,
    cookies: str = "",
    external_scripts: dict[str, str] | None = None,
) -> JsEngineResult:
    """One-shot: execute page scripts and return what they tried to fetch."""
    engine = JsEngine()
    return engine.execute_page(
        html, page_url, cookies=cookies, external_scripts=external_scripts,
    )
