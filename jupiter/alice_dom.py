"""Как Алиса видит страницу: интерактивные элементы, стабильные номера, короткий текст.

Приёмы переняты у browser-use (MIT): единая проверка «интерактивен ли», видимость и
перекрытие, модалка сужает область поиска, shadow DOM, схлопывание вложенных,
приоритет по экрану, имя элемента, «новое после прошлого шага». Код свой, без
чужих агентных фреймворков; весь сбор — один JS в page.evaluate / frame.evaluate.

Что делает модуль:
  collect(page_or_frame)  -> dict   снимок одного документа (JSON из COLLECT_JS);
  collect_all(page)       -> dict   то же, но с iframe: содержимое вложено в строку фрейма;
  render_outline(data)    -> str    текст для YandexGPT, обрезка по строкам, до budget;
  locator_for(page, idx)  -> locator  элемент по номеру из outline (с учётом фрейма).

Номер элемента — атрибут data-jt-idx: пока узел жив, номер не меняется между вызовами.
Элемент во фрейме получает префикс «f<номер iframe>-»: `f3-7`. Радио-группа — один
пункт `[16]`, а её варианты — `[16.1]`, `[16.2]`.

Инварианты Юпитера:
  * значения полей не читаются совсем — только признак «заполнено/пусто/отмечено»
    (у кнопок `value` — это подпись кнопки, не данные кандидата);
  * капча не трогается: iframe капчи помечается и не раскрывается;
  * модуль ничего не отправляет и не кликает — только читает DOM и ставит свои метки
    data-jt-idx / data-jt-group / data-jt-seen.

Playwright тут не импортируется: функции принимают готовые Page/Frame.
"""
from __future__ import annotations

import re
import urllib.parse
from typing import Any, Iterator

BUDGET_CHARS = 9000        # страница в сообщении шага (см. бюджет user-сообщения YandexGPT)
LABEL_CHARS = 60           # подпись элемента в строке
CONTEXT_CHARS = 60         # заголовки и разделы
ERROR_CHARS = 80           # сообщения сайта об ошибках
MAX_FRAMES = 8             # iframe на страницу
MAX_FRAME_DEPTH = 3
_TAIL = "… ещё {n} элементов не показано"

# Адреса iframe с капчей: показываем строкой, внутрь не заходим (решает кандидат).
_CAPTCHA_FRAME_RE = re.compile(r"captcha|turnstile|challenge|geetest|funcaptcha|arkoselabs", re.IGNORECASE)

# Один JS на документ. Аргумент: {prefix, limit, near, markSeen}.
# Возвращает JSON-структуру (см. collect). DOM не меняем, кроме меток:
#   data-jt-idx   — стабильный номер (если уже есть, сохраняется);
#   data-jt-group — номер радио-группы;
#   data-jt-seen  — «этот элемент уже попадал в снимок» (отсюда пометка «новое»).
COLLECT_JS = r"""
(opts) => {
  opts = opts || {};
  const prefix = opts.prefix || '';
  const LIMIT = opts.limit || 300;
  const NEAR = opts.near == null ? 1000 : opts.near;     // запас по экрану, px (П7)
  const MARK = opts.markSeen !== false;
  const MAX_NODES = 30000;
  const OPT_MAX = 8, OPT_LEN = 40;
  const cut = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

  // ---- Общие помощники: родитель сквозь shadow DOM, текст без полей ввода ----
  const up = el => el.parentElement || (el.parentNode && el.parentNode.host) || null;
  const anc = (el, f) => { for (let e = el; e; e = up(e)) if (f(e)) return e; return null; };
  const ancMatch = (el, sel) => anc(el, e => e.matches && e.matches(sel));
  const textOf = n => {
    let s = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1) {
        if (/^(SELECT|TEXTAREA|INPUT|OPTION|SCRIPT|STYLE|NOSCRIPT)$/.test(c.tagName)) continue;
        s += ' ' + textOf(c) + ' ';
        if (c.shadowRoot) s += ' ' + textOf(c.shadowRoot) + ' ';
      }
    }
    return s;
  };
  const hasControls = el => /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) || !!el.querySelector('input,select,textarea,button');
  const safeMatch = (el, sel) => { try { return el.matches(sel); } catch (e) { return false; } };

  // ---- Стабильные номера ----
  if (window.__jtIdxNext == null) {
    let max = 0;
    const scan = root => {
      root.querySelectorAll('[data-jt-idx],[data-jt-group]').forEach(e => {
        for (const a of ['data-jt-idx', 'data-jt-group']) {
          const m = /^(\d+)/.exec(e.getAttribute(a) || ''); if (m) max = Math.max(max, +m[1]);
        }
      });
      root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) scan(e.shadowRoot); });
    };
    scan(document);
    window.__jtIdxNext = max + 1;
  }
  const firstCall = !window.__jtCollected;
  const nextNum = () => window.__jtIdxNext++;
  const idxOf = el => {
    let v = el.getAttribute('data-jt-idx');
    if (!v) { v = String(nextNum()); el.setAttribute('data-jt-idx', v); }
    return v;
  };
  const isNew = el => !firstCall && !el.hasAttribute('data-jt-seen');
  const markSeen = el => { if (MARK) el.setAttribute('data-jt-seen', '1'); };

  // ---- П1. Видимость и доступность ----
  const hiddenTree = el => !!anc(el, e => {
    if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('inert')) return true;
    if (e.tagName === 'DETAILS' && !e.open) {
      const sm = e.querySelector(':scope > summary');
      return !(sm && sm.contains(el));
    }
    return false;
  });
  const visible = (el, soft) => {
    if (el.checkVisibility) {
      const o = soft ? { checkVisibilityCSS: true, visibilityProperty: true, contentVisibilityAuto: true }
                     : { checkOpacity: true, opacityProperty: true, checkVisibilityCSS: true, visibilityProperty: true, contentVisibilityAuto: true };
      if (!el.checkVisibility(o)) return false;
    } else {
      const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return !hiddenTree(el);
  };
  const enabled = el => !safeMatch(el, ':disabled') && el.getAttribute('aria-disabled') !== 'true';
  // Невидимые file/checkbox/radio оставляем (кастомные галочки прячут сам input):
  // тогда геометрию берём у подписи или обёртки.
  const SPECIAL = el => el.tagName === 'INPUT' && ['file', 'checkbox', 'radio'].includes(el.type);
  const geo = el => {
    if (!SPECIAL(el)) return visible(el) ? el : null;
    if (visible(el, true)) return el;
    const lab = (el.labels && el.labels[0]) || up(el);
    return lab && visible(lab) ? lab : null;
  };

  // ---- П5. Обход документа в порядке чтения: открытый shadow DOM — внутрь, iframe — нет ----
  let nodes = 0;
  function* walk(root) {
    const st = [root];
    while (st.length) {
      const el = st.pop();
      if (++nodes > MAX_NODES) return;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK)$/.test(el.tagName)) continue;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.tagName.toLowerCase() !== 'svg') continue;
      if (el.getAttribute('aria-hidden') === 'true' && !SPECIAL(el)) continue;
      if (getComputedStyle(el).display === 'none') { if (SPECIAL(el)) yield el; continue; }
      yield el;
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME' || el.tagName.toLowerCase() === 'svg') continue;
      const kids = [...(el.shadowRoot ? el.shadowRoot.children : []), ...el.children];
      for (let i = kids.length - 1; i >= 0; i--) st.push(kids[i]);
    }
  }

  // ---- П2. Модалка ограничивает область поиска ----
  const modalSel = 'dialog[open],[role=dialog][aria-modal=true],[role=alertdialog]';
  const allModals = [];
  (function find(root) {
    root.querySelectorAll(modalSel).forEach(e => allModals.push(e));
    root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) find(e.shadowRoot); });
  })(document);
  const modal = allModals.filter(m => visible(m)).pop() || null;

  // ---- П4. Единое «интерактивен ли» ----
  const ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio',
    'checkbox', 'switch', 'tab', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'listbox', 'treeitem']);
  const TAGS = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/;
  const interactiveStatic = el => {
    const tag = el.tagName;
    if (el === document.body || el === document.documentElement) return false;
    if (tag === 'INPUT' && el.type === 'hidden') return false;
    if (!enabled(el)) return false;
    if (TAGS.test(tag) && !(tag === 'A' && !el.hasAttribute('href') && !el.onclick && !el.hasAttribute('onclick'))) return true;
    if (el.isContentEditable && !(up(el) && up(el).isContentEditable)) return true;
    if (ROLES.has((el.getAttribute('role') || '').toLowerCase())) return true;
    if (['aria-checked', 'aria-pressed', 'aria-expanded', 'aria-selected'].some(a => el.hasAttribute(a))) return true;
    if (el.hasAttribute('data-jt-click') || el.hasAttribute('onclick') || el.onclick) return true;
    return el.hasAttribute('tabindex') && el.tabIndex >= 0;
  };
  // Курсор-рука — только у «верхушки» области, иначе каждый span в кнопке был бы пунктом.
  // React 17+ вешает обработчики на корень, поэтому onclick у его кнопок не виден.
  const cursorTop = el => {
    if (getComputedStyle(el).cursor !== 'pointer') return false;
    const p = up(el);
    if (p && getComputedStyle(p).cursor === 'pointer') return false;
    return !!(textOf(el).trim() || el.querySelector('img,svg'));
  };
  // Поиск по сайту — не анкета (как type=search).
  const SEARCH_RE = /(^|[^a-z0-9])(search|query|q)([^a-z0-9]|$)/i;
  const isSearchField = el => {
    if (!/^(INPUT|TEXTAREA)$/.test(el.tagName) && !['searchbox', 'combobox', 'textbox'].includes(el.getAttribute('role'))) return false;
    if ((el.type || '') === 'search' || el.getAttribute('role') === 'searchbox') return true;
    if (SEARCH_RE.test([el.getAttribute('name'), el.id, el.getAttribute('class')].join(' '))) return true;
    return !!ancMatch(el, '[role=search]');
  };

  // ---- П3. Перекрытие точкой ----
  const covered = el => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
    const pts = [[.5, .5], [.2, .2], [.8, .8]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]);
    return pts.every(([x, y]) => {
      let h = document.elementFromPoint(x, y);
      while (h && h.shadowRoot && h.shadowRoot.elementFromPoint) {
        const d = h.shadowRoot.elementFromPoint(x, y); if (!d || d === h) break; h = d;
      }
      return h && h !== el && !el.contains(h) && !(el.labels && [...el.labels].some(l => l.contains(h)));
    });
  };

  // ---- П6. Схлопывание вложенных по рамке ----
  const PROP = el => /^(A|BUTTON)$/.test(el.tagName) || ['button', 'combobox'].includes(el.getAttribute('role'));
  const inside = (c, p) => {
    const a = c.getBoundingClientRect(), b = p.getBoundingClientRect();
    const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return a.width * a.height > 0 && w * h / (a.width * a.height) >= 0.99;
  };

  // ---- П8. Имя элемента (value поля НИКОГДА не берём) ----
  const idsText = (el, attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map(id => {
    const r = el.getRootNode();
    const t = (r.getElementById && r.getElementById(id)) || document.getElementById(id);
    return t ? textOf(t) : '';
  }).join(' ');
  const neighborText = el => {
    const tryEl = p => {
      if (!p || hasControls(p)) return '';
      const t = cut(textOf(p), 80); return t.length && t.length <= 60 ? t : '';
    };
    const t1 = tryEl(el.previousElementSibling);
    if (t1) return t1;
    const w = up(el);
    return w && w !== document.body ? tryEl(w.previousElementSibling) : '';
  };
  const afterText = el => {
    const n = el.nextSibling;
    if (n && n.nodeType === 3 && n.nodeValue.trim()) return n.nodeValue;
    const e = el.nextElementSibling;
    return e && !hasControls(e) ? textOf(e) : '';
  };
  const isBtnInput = el => el.tagName === 'INPUT' && ['submit', 'button', 'reset', 'image'].includes(el.type);
  const isFieldTag = el => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !isBtnInput(el);
  let starSeen = false;
  const nameOf = el => {
    starSeen = false;
    let s = idsText(el, 'aria-labelledby') || el.getAttribute('aria-label') || '';
    if (!s && el.labels && el.labels.length) s = textOf(el.labels[0]);
    if (!s && isBtnInput(el)) s = el.value || el.getAttribute('alt') || '';   // подпись кнопки, не данные
    if (!s && !isFieldTag(el)) s = el.innerText || textOf(el);
    if (!s && isFieldTag(el)) s = /^(checkbox|radio)$/.test(el.type) ? afterText(el) : '';
    if (!s && isFieldTag(el)) s = neighborText(el);
    if (!s) s = el.getAttribute('title') || '';
    if (!s) { const im = el.querySelector && el.querySelector('img[alt],svg[aria-label],[title]'); if (im) s = im.getAttribute('alt') || im.getAttribute('aria-label') || im.getAttribute('title') || ''; }
    if (!s) s = el.getAttribute('placeholder') || '';
    if (!s) s = el.getAttribute('name') || '';
    if (/\*/.test(s)) starSeen = true;
    return cut(s.replace(/\s*\*+\s*/g, ' '), 80);
  };

  // ---- Вид, формат, варианты, ошибки ----
  const TYPE_KIND = { email: 'поле-почта', tel: 'поле-телефон', date: 'поле-дата', 'datetime-local': 'поле-дата',
    month: 'поле-дата', week: 'поле-дата', time: 'поле-время', number: 'поле-число', url: 'поле-ссылка', password: 'поле-пароль' };
  const FORMAT = { date: 'ГГГГ-ММ-ДД', time: 'ЧЧ:ММ', 'datetime-local': 'ГГГГ-ММ-ДДTЧЧ:ММ', month: 'ГГГГ-ММ', week: 'ГГГГ-Wнн' };
  const FIELD_KINDS = new Set(['поле', 'поле-почта', 'поле-телефон', 'поле-дата', 'поле-время', 'поле-число',
    'поле-ссылка', 'поле-пароль', 'поле-список', 'текст', 'список', 'радио', 'флажок', 'файл']);
  const kindOf = el => {
    const tag = el.tagName, role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'INPUT') {
      const t = el.type;
      if (t === 'checkbox') return 'флажок';
      if (t === 'radio') return 'радио';
      if (t === 'file') return 'файл';
      if (isBtnInput(el)) return 'кнопка';
      if (role === 'combobox') return 'поле-список';
      return TYPE_KIND[t] || 'поле';
    }
    if (tag === 'TEXTAREA') return 'текст';
    if (tag === 'SELECT') return 'список';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'кнопка';
    if (role === 'checkbox' || role === 'switch' || role === 'menuitemcheckbox') return 'флажок';
    if (role === 'radio' || role === 'menuitemradio') return 'радио';
    if (role === 'combobox' || role === 'listbox') return 'список';
    if (role === 'textbox' || role === 'searchbox' || el.isContentEditable) return 'текст';
    if (role === 'slider' || role === 'spinbutton') return 'поле-число';
    if (role === 'tab') return 'вкладка';
    if (role === 'menuitem') return 'пункт меню';
    if (role === 'option' || role === 'treeitem') return 'вариант';
    if (tag === 'A' || role === 'link') return 'ссылка';
    return 'кнопка';
  };
  const ATTRS = ['pattern', 'maxlength', 'minlength', 'min', 'max', 'step', 'inputmode', 'autocomplete', 'accept'];
  const attrsOf = el => {
    const out = {};
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || isBtnInput(el)) return out;
    for (const a of ATTRS) {
      const v = el.getAttribute(a); if (v == null || v === '') continue;
      if (a === 'autocomplete' && /^(off|on|nope|new-password|one-time-code|cc-.*)$/i.test(v.trim())) continue;
      out[a] = cut(v, 60);
    }
    if (el.multiple) out.multiple = true;
    return out;
  };
  const formatOf = (el, label) => {
    if (el.tagName !== 'INPUT') return '';
    if (FORMAT[el.type]) return FORMAT[el.type];
    const df = el.getAttribute('data-date-format') || el.getAttribute('data-format') || el.getAttribute('data-mask') || el.getAttribute('data-inputmask');
    if (df) return cut(df, 40);
    const ph = cut(el.getAttribute('placeholder'), 40);
    // Подсказка в поле вроде «+7 (___) ___-__-__» или «ДД.ММ.ГГГГ» — это формат, а не подпись.
    if (ph && ph !== label && (/[_#]|дд|мм|гг|dd|mm|yy|\d/i.test(ph))) return ph;
    return '';
  };
  const optionsOf = el => {
    const all = [...el.options].filter(o => !o.disabled && o.value !== '');
    return { options: all.slice(0, OPT_MAX).map(o => cut(o.textContent, OPT_LEN)), more: Math.max(0, all.length - OPT_MAX) };
  };
  const stateOf = el => {
    const tag = el.tagName, role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'INPUT') {
      const t = el.type;
      if (isBtnInput(el) || t === 'password') return '';
      if (t === 'checkbox') return el.checked ? 'отмечено' : 'пусто';
      if (t === 'radio') return el.checked ? 'заполнено' : 'пусто';
      if (t === 'file') return el.files && el.files.length ? 'заполнено' : 'пусто';
      const v = (el.value || '').trim();
      const digits = v.replace(/\D/g, '');
      if (v && (t === 'tel' || /[_#]/.test(v)) && digits.length <= 1) return 'пусто';   // маска без цифр
      return v ? 'заполнено' : 'пусто';
    }
    if (tag === 'TEXTAREA') return (el.value || '').trim() ? 'заполнено' : 'пусто';
    if (tag === 'SELECT') {
      const o = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      return o && o.value !== '' && !o.disabled ? 'заполнено' : 'пусто';
    }
    if (role === 'checkbox' || role === 'switch') return el.getAttribute('aria-checked') === 'true' ? 'отмечено' : 'пусто';
    if (el.isContentEditable) return (el.textContent || '').trim() ? 'заполнено' : 'пусто';
    return '';
  };
  const usedErr = new Set();
  const ERR_CLS = /error|invalid|danger|err-|-err\b/i;
  const errBoxOk = e => e && !hasControls(e) && visible(e) && cut(textOf(e), 200).length > 0 && cut(textOf(e), 200).length <= 160;
  const errorOf = el => {
    const cls = (el.getAttribute('class') || '') + ' ' + ((up(el) && up(el).getAttribute && up(el).getAttribute('class')) || '');
    const userInvalid = safeMatch(el, ':user-invalid');
    let invalid = el.getAttribute('aria-invalid') === 'true' || userInvalid || /(^|[\s_-])(is-invalid|has-error|has-danger|invalid|error)([\s_-]|$)/i.test(cls);
    let text = '';
    const em = el.getAttribute('aria-errormessage');
    if (em) for (const id of em.split(/\s+/)) { const t = document.getElementById(id); if (errBoxOk(t)) { text = cut(textOf(t), 160); usedErr.add(t); break; } }
    if (!text) {
      let w = el;
      for (let d = 0; d < 2 && w && !text; d++, w = up(w)) {
        for (let s = w.nextElementSibling, k = 0; s && k < 2; s = s.nextElementSibling, k++) {
          if ((ERR_CLS.test(s.getAttribute('class') || '') || s.getAttribute('role') === 'alert') && errBoxOk(s)) {
            text = cut(textOf(s), 160); usedErr.add(s); invalid = true; break;
          }
        }
        if (w.matches && w.matches('form,fieldset')) break;
      }
    }
    if (!text && invalid && userInvalid) text = cut(el.validationMessage, 160);
    return { invalid, error: text };
  };
  const groupLabel = r => {
    const fs = ancMatch(r, 'fieldset');
    const lg = fs && fs.querySelector(':scope > legend');
    if (lg && cut(textOf(lg), 80)) return cut(textOf(lg), 80);
    const rg = ancMatch(r, '[role=radiogroup],[role=group]');
    if (rg) { const t = idsText(rg, 'aria-labelledby') || rg.getAttribute('aria-label') || ''; if (cut(t, 80)) return cut(t, 80); }
    let w = r.closest('label') || r;
    for (let d = 0; d < 4 && w; d++, w = up(w)) {
      const p = w.previousElementSibling;
      if (p && !hasControls(p)) { const t = cut(textOf(p), 80); if (t) return t; }
    }
    return cut(r.getAttribute('name'), 60);
  };
  const SUBMIT_RE = /отправ|отклик|подать|заявк|submit|send|apply|продолж|далее|next|сохран/i;
  const SUBMIT_STRICT = /отправить|submit|send application/i;

  // ---- Сбор кандидатов по документу ----
  const vh = innerHeight || 800;
  const heads = [], alerts = [], cands = [];
  let ord = 0;
  const scanRoot = root => {
    heads.length = 0; alerts.length = 0; cands.length = 0; ord = 0;
    for (const el of walk(root)) {
      ord++;
      if (/^H[1-3]$/.test(el.tagName)) {
        const t = cut(textOf(el), 80);
        if (t && visible(el)) heads.push({ ord, el, text: t });
        continue;
      }
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 10 && visible(el)) cands.push({ ord, el, g: el, frame: true });
        continue;
      }
      const alertish = el.getAttribute('role') === 'alert' || el.getAttribute('aria-live') === 'assertive' || ERR_CLS.test(el.getAttribute('class') || '');
      if (alertish && !interactiveStatic(el) && el.children.length <= 3 && errBoxOk(el)) alerts.push({ ord, el, text: cut(textOf(el), 160) });
      if (!interactiveStatic(el)) {
        if (!visible(el) || !cursorTop(el)) continue;
      }
      if (isSearchField(el)) continue;
      const g = geo(el);
      if (!g) continue;
      if (!modal && !SPECIAL(el) && covered(el) === true) continue;   // П3
      cands.push({ ord, el, g });
    }
  };
  scanRoot(modal || document.documentElement);
  if (modal && !cands.length) scanRoot(document.documentElement);
  const scoped = !!modal && cands.length > 0 && !!cands[0] && !!anc(cands[0].el, e => e === modal);

  // П6. Схлопывание вложенных
  const candSet = new Set(cands.map(c => c.el));
  const kept = cands.filter(c => {
    const el = c.el;
    if (c.frame || SPECIAL(el)) return true;
    let p = up(el), nested = false;
    while (p) { if (candSet.has(p) && PROP(p) && inside(el, p)) { nested = true; break; } p = up(p); }
    return !nested || /^(INPUT|SELECT|TEXTAREA|LABEL)$/.test(el.tagName) || PROP(el) || el.hasAttribute('onclick')
      || (el.getAttribute('aria-label') || '').trim() || ROLES.has(el.getAttribute('role'));
  });

  // Радио-группы: один пункт на группу, на месте первого варианта.
  const groups = new Map();
  const groupOfRadio = r => {
    const root = r.form || r.getRootNode();
    const name = r.getAttribute('name');
    if (!name) return null;
    if (!groups.has(root)) groups.set(root, new Map());
    const m = groups.get(root);
    if (!m.has(name)) m.set(name, []);
    return m.get(name);
  };
  const radioDone = new Set();

  // ---- Сборка элементов ----
  const forms = new Set();
  const out = [];
  const nearOk = r => r.bottom > -NEAR && r.top < vh + NEAR;
  const hidden = { above: 0, below: 0, limit: 0 };
  const chrome = el => !!ancMatch(el, 'nav,header,footer,[role=navigation],[role=banner],[role=contentinfo]');
  const rankOf = (g, el) => {
    const r = g.getBoundingClientRect();
    const inView = r.bottom > 0 && r.top < vh;
    const dist = r.bottom < 0 ? -r.bottom : (r.top > vh ? r.top - vh : 0);
    return { rank: (inView ? 0 : 1) + (chrome(el) ? 2 : 0), dist: Math.round(dist), r };
  };
  const formOf = el => el.form || ancMatch(el, 'form,[role=form]');

  for (const c of kept) {
    const el = c.el, g = c.g;
    const { rank, dist, r } = rankOf(g, el);
    const far = !nearOk(r);
    const form = formOf(el);
    if (form) forms.add(form);
    if (c.frame) {
      if (far) { r.bottom < 0 ? hidden.above++ : hidden.below++; continue; }
      const key = idxOf(el);
      out.push({ t: 'frame', ord: c.ord, key, idx: prefix + key, src: cut(el.getAttribute('src') || '', 200), rank, dist, core: false, formEl: form });
      markSeen(el);
      continue;
    }
    const kind = kindOf(el);
    const isField = FIELD_KINDS.has(kind);
    let item;
    if (kind === 'радио' && el.tagName === 'INPUT' && el.getAttribute('name')) {
      if (radioDone.has(el)) continue;
      const root = el.form || el.getRootNode();
      const members = kept.map(k => k.el).filter(m => m.tagName === 'INPUT' && m.type === 'radio'
        && (m.form || m.getRootNode()) === root && m.getAttribute('name') === el.getAttribute('name'));
      members.forEach(m => radioDone.add(m));
      let gid = null;
      for (const m of members) { const v = m.getAttribute('data-jt-group'); if (v) { gid = v; break; } }
      if (!gid) gid = String(nextNum());
      let k = 0;
      members.forEach(m => { const v = m.getAttribute('data-jt-idx'); const mm = v && /\.(\d+)$/.exec(v); if (mm) k = Math.max(k, +mm[1]); });
      const opts2 = [];
      let anyNew = false, anyReq = false, anyChecked = false, invalid = false, errText = '';
      for (const m of members) {
        m.setAttribute('data-jt-group', gid);
        if (!m.getAttribute('data-jt-idx')) m.setAttribute('data-jt-idx', gid + '.' + (++k));
        const lbl = nameOf(m);
        opts2.push({ idx: prefix + m.getAttribute('data-jt-idx'), text: cut(lbl, OPT_LEN) });
        if (isNew(m)) anyNew = true;
        if (m.required || m.getAttribute('aria-required') === 'true') anyReq = true;
        if (m.checked) anyChecked = true;
        markSeen(m);
      }
      const er = errorOf(members[0]);
      invalid = er.invalid; errText = er.error;
      item = { t: 'el', ord: c.ord, idx: prefix + gid, new: anyNew, kind: 'радио', label: groupLabel(el),
        required: anyReq, state: anyChecked ? 'заполнено' : 'пусто', format: '', attrs: {},
        options: opts2.slice(0, OPT_MAX), more: Math.max(0, opts2.length - OPT_MAX),
        invalid, error: errText, submit: false, core: true, inForm: !!form, rank, dist, formEl: form };
      out.push(item);
      continue;
    }
    const label = nameOf(el);
    if (!label && !isField && kind !== 'ссылка' && !c.frame) continue;     // безымянные «кнопки» — шум
    const er = isField ? errorOf(el) : { invalid: false, error: '' };
    const type = (el.getAttribute('type') || '').toLowerCase();
    const inForm = !!form;
    const submit = kind === 'кнопка' && (type === 'submit' || (inForm ? SUBMIT_RE.test(label) : SUBMIT_STRICT.test(label)));
    const core = isField || submit;
    if (far && !core) { r.bottom < 0 ? hidden.above++ : hidden.below++; continue; }
    item = { t: 'el', ord: c.ord, idx: prefix + idxOf(el), new: isNew(el), kind, label,
      required: isField && (!!el.required || el.getAttribute('aria-required') === 'true' || starSeen),
      state: isField ? stateOf(el) : '', format: isField ? formatOf(el, label) : '',
      attrs: isField ? attrsOf(el) : {}, options: [], more: 0,
      invalid: er.invalid, error: er.error, submit, core, inForm, rank, dist, formEl: form };
    if (el.tagName === 'SELECT') Object.assign(item, optionsOf(el));
    out.push(item);
    markSeen(el);
  }

  // Заголовки и сообщения сайта (текст, не относящийся к конкретному полю)
  const seenText = new Set();
  for (const h of heads) {
    const r = h.el.getBoundingClientRect();
    if (!nearOk(r) || seenText.has('h' + h.text)) continue;
    seenText.add('h' + h.text);
    out.push({ t: 'h', ord: h.ord, text: h.text, level: +h.el.tagName[1], rank: r.bottom > 0 && r.top < vh ? 0 : 1, dist: 0, core: false });
  }
  for (const a of alerts) {
    if (usedErr.has(a.el) || anc(a.el, e => usedErr.has(e)) || seenText.has('e' + a.text)) continue;
    if (!nearOk(a.el.getBoundingClientRect())) continue;
    seenText.add('e' + a.text);
    out.push({ t: 'err', ord: a.ord, text: a.text, rank: 0, dist: 0, core: false });
  }

  // П7. Лимит: поля и кнопка отправки остаются всегда, остальное — по близости к экрану.
  const must = out.filter(i => i.core), rest = out.filter(i => !i.core);
  const room = Math.max(0, LIMIT - must.length);
  rest.sort((a, b) => a.rank - b.rank || a.dist - b.dist || a.ord - b.ord);
  hidden.limit = Math.max(0, rest.length - room);
  const finalItems = must.concat(rest.slice(0, room)).sort((a, b) => a.ord - b.ord);

  // Строки «форма» между пунктами разных форм
  const formLabel = f => {
    const t = idsText(f, 'aria-labelledby') || f.getAttribute('aria-label') || f.getAttribute('title') || '';
    if (t) return cut(t, 60);
    const lg = f.querySelector && f.querySelector(':scope > legend, :scope > fieldset > legend');
    return lg ? cut(textOf(lg), 60) : '';
  };
  const result = [];
  let lastForm = null;
  for (const it of finalItems) {
    if (it.t === 'el' || it.t === 'frame') {
      const f = it.formEl || null;
      if (f && f !== lastForm && it.t === 'el') {
        const lbl = formLabel(f);
        if (lbl || forms.size >= 2) result.push({ t: 'form', text: lbl, rank: 0, dist: 0, core: false });
      }
      lastForm = f;
    }
    delete it.formEl;
    result.push(it);
  }

  // П10. Прокрутка: у модалки — её собственная
  let scroll;
  const scrollable = e => e.scrollHeight > e.clientHeight + 1 && /auto|scroll|overlay/.test(getComputedStyle(e).overflowY);
  const sc = modal ? [modal, ...modal.querySelectorAll('*')].find(scrollable) : null;
  const rd = n => Math.round(n * 10) / 10;
  if (sc) {
    scroll = { where: 'modal', above: rd(sc.scrollTop / sc.clientHeight),
      below: rd(Math.max(0, (sc.scrollHeight - sc.scrollTop - sc.clientHeight) / sc.clientHeight)) };
  } else {
    const de = document.scrollingElement || document.documentElement;
    scroll = { where: 'page', above: rd((de.scrollTop || 0) / vh),
      below: rd(Math.max(0, (de.scrollHeight - (de.scrollTop || 0) - vh) / vh)) };
  }

  window.__jtCollected = true;
  return { url: location.href, title: cut(document.title, 120), modal: !!modal && scoped, scroll, hidden, items: result };
}
"""


class AliceDomError(ValueError):
    """Номер элемента не в формате outline (например, «f3-7» или «16.2»)."""


def _empty() -> dict:
    return {"url": "", "title": "", "modal": False,
            "scroll": {"where": "page", "above": 0, "below": 0},
            "hidden": {"above": 0, "below": 0, "limit": 0}, "items": []}


def collect(target: Any, *, prefix: str = "", limit: int = 300, near: int = 1000,
            mark_seen: bool = True) -> dict:
    """Снимок одного документа: Page или Frame.

    Возвращает {url, title, modal, scroll, hidden, items}. items идут в порядке страницы;
    у каждого t = el | frame | h | err | form. Значения полей в снимок не попадают.
    mark_seen=False — посмотреть, не сбрасывая пометки «новое» (для повторной проверки)."""
    data = target.evaluate(COLLECT_JS, {"prefix": prefix, "limit": limit, "near": near, "markSeen": mark_seen})
    return data if isinstance(data, dict) else _empty()


def _frame_key(frame: Any) -> str | None:
    """Номер iframe-элемента в родительском документе (data-jt-idx) или None."""
    try:
        if frame.is_detached():
            return None
        return frame.frame_element().get_attribute("data-jt-idx")
    except Exception:
        return None


def _collect_tree(frame: Any, prefix: str, depth: int, left: list, limit: int, mark_seen: bool) -> dict:
    data = collect(frame, prefix=prefix, limit=limit, mark_seen=mark_seen)
    by_key: dict[str, Any] = {}
    try:
        children = list(frame.child_frames)
    except Exception:
        children = []
    for child in children:
        key = _frame_key(child)
        if key:
            by_key[key] = child
    for it in data.get("items", []):
        if it.get("t") != "frame":
            continue
        child = by_key.get(it.get("key"))
        url = ""
        try:
            url = child.url if child is not None else ""
        except Exception:
            pass
        it["host"] = urllib.parse.urlparse(url).hostname or ""
        it["frame"] = None
        if child is None or depth >= MAX_FRAME_DEPTH or left[0] <= 0:
            continue
        if _CAPTCHA_FRAME_RE.search(url) or _CAPTCHA_FRAME_RE.search(it.get("src", "")):
            it["captcha"] = True          # капчу решает кандидат, внутрь не смотрим
            continue
        left[0] -= 1
        try:
            it["frame"] = _collect_tree(child, f"{prefix}f{it['key']}-", depth + 1, left, limit, mark_seen)
        except Exception:
            it["frame"] = None            # фрейм ушёл на навигацию — не страшно
    return data


def collect_all(page: Any, *, limit: int = 300, mark_seen: bool = True) -> dict:
    """Снимок страницы вместе с iframe (П12). Содержимое фрейма лежит в item["frame"]
    строки-фрейма, номера внутри — с префиксом `f<номер iframe>-`."""
    return _collect_tree(page.main_frame if hasattr(page, "main_frame") else page, "", 0,
                         [MAX_FRAMES], limit, mark_seen)


def iter_items(data: dict) -> Iterator[dict]:
    """Все элементы (t == "el") снимка, включая вложенные фреймы, в порядке страницы."""
    for it in data.get("items", []):
        if it.get("t") == "el":
            yield it
        elif it.get("t") == "frame" and it.get("frame"):
            yield from iter_items(it["frame"])


def known_indexes(data: dict) -> set[str]:
    """Допустимые номера для проверки ответа модели: пункты, группы и варианты радио."""
    out: set[str] = set()
    for it in iter_items(data):
        out.add(it["idx"])
        for o in it.get("options") or []:
            if isinstance(o, dict) and o.get("idx"):
                out.add(o["idx"])
    return out


_IDX_RE = re.compile(r"^((?:f\d+-)*)(\d+)(?:\.(\d+))?$")


def locator_for(page: Any, idx: Any):
    """Playwright-локатор элемента по номеру из outline: `7`, `16.2`, `f3-7`, `f3-f1-5`.

    Фреймы проходим через frame_locator по data-jt-idx iframe-элемента. Номер радио-группы
    без «.k» указывает на её первый вариант. Бросает AliceDomError на чужом формате."""
    m = _IDX_RE.match(str(idx).strip())
    if not m:
        raise AliceDomError(f"неверный номер элемента: {idx!r}")
    frames, num, sub = m.group(1), m.group(2), m.group(3)
    root = page
    for f in re.findall(r"f(\d+)-", frames):
        root = root.frame_locator(f'[data-jt-idx="{f}"]')
    if sub is not None:
        sel = f'[data-jt-idx="{num}.{sub}"]'
    else:
        sel = f'[data-jt-idx="{num}"], [data-jt-group="{num}"]'
    return root.locator(sel).first


# ---------------------------------------------------------------------------
# Текст для модели
# ---------------------------------------------------------------------------

def _fmt_float(x: Any) -> str:
    try:
        return f"{float(x):.1f}".replace(".", ",")
    except (TypeError, ValueError):
        return "0,0"


def _accept_kinds(accept: str) -> str:
    out: list[str] = []
    for tok in accept.split(","):
        tok = tok.strip().lstrip(".")
        if "/" in tok:
            tok = tok.split("/", 1)[1]
        tok = tok.replace("*", "").strip()
        if tok and tok not in out:
            out.append(tok)
    return ",".join(out[:5])


def _format_parts(it: dict, compact: bool) -> list[str]:
    parts: list[str] = []
    if it.get("format"):
        parts.append(f"формат {it['format']}")
    if compact:
        return parts
    a = it.get("attrs") or {}
    if a.get("pattern") and not it.get("format"):
        parts.append(f"шаблон {a['pattern'][:40]}")
    if a.get("minlength"):
        parts.append(f"от {a['minlength']} зн.")
    if a.get("maxlength"):
        parts.append(f"до {a['maxlength']} зн.")
    if a.get("min") and it.get("kind") != "поле-дата":
        parts.append(f"мин {a['min']}")
    if a.get("max") and it.get("kind") != "поле-дата":
        parts.append(f"макс {a['max']}")
    if a.get("inputmode") in ("numeric", "decimal"):
        parts.append("цифры")
    if a.get("multiple"):
        parts.append("несколько")
    if a.get("autocomplete"):
        parts.append(f"ac={a['autocomplete'].split()[-1][:20]}")
    return parts


def _el_line(it: dict, compact: bool = False) -> str:
    kind = it.get("kind", "кнопка")
    if kind == "файл":
        acc = _accept_kinds((it.get("attrs") or {}).get("accept", ""))
        if acc:
            kind = f"файл ({acc})"
    out = [("*" if it.get("new") else "") + f"[{it['idx']}]", kind]
    if it.get("label"):
        out.append(f"«{it['label'][:LABEL_CHARS]}»")
    if it.get("required"):
        out.append("обяз")
    if it.get("state"):
        out.append(it["state"])
    out.extend(_format_parts(it, compact))
    opts = it.get("options") or []
    if opts:
        shown = opts[:3] if compact else opts
        texts = [f"[{o['idx']}] {o['text']}" if isinstance(o, dict) else str(o) for o in shown]
        more = int(it.get("more") or 0) + (len(opts) - len(shown))
        out.append("варианты: " + " | ".join(texts) + (f" (+{more})" if more else ""))
    if it.get("invalid") or it.get("error"):
        out.append(f"ошибка «{it['error'][:ERROR_CHARS]}»" if it.get("error") else "ошибка")
    return " ".join(out)


def _flatten(data: dict, out: list[dict], is_root: bool) -> None:
    """Строки в порядке страницы. tier: None — не выкидывать никогда; чем больше, тем позже режем."""
    for it in data.get("items", []):
        t = it.get("t")
        base = {"rank": it.get("rank", 0), "dist": it.get("dist", 0), "ord": len(out), "item": it}
        if t == "el":
            kind = it.get("kind")
            in_form = bool(it.get("inForm"))
            if it.get("core"):
                tier = None
            elif kind == "ссылка":
                tier = 2 if in_form else 0
            else:
                tier = 3 if in_form else 1
            out.append({**base, "text": _el_line(it), "tier": tier})
        elif t == "h":
            out.append({**base, "text": "# " + it["text"][:CONTEXT_CHARS], "tier": 4})
        elif t == "err":
            out.append({**base, "text": "! " + it["text"][:ERROR_CHARS], "tier": 5})
        elif t == "form":
            out.append({**base, "text": f"— форма «{it['text'][:CONTEXT_CHARS]}»" if it.get("text") else "— форма", "tier": None})
        elif t == "frame":
            host = it.get("host") or "встроенный"
            if it.get("captcha"):
                out.append({**base, "text": f"— iframe {host}: капча, решает кандидат", "tier": None})
                continue
            out.append({**base, "text": f"— iframe {host}", "tier": None})
            if it.get("frame"):
                _flatten(it["frame"], out, False)


def render_outline(data: dict, budget: int = BUDGET_CHARS) -> str:
    """Страница одной строкой на элемент, для YandexGPT.

    `[N] вид «подпись» обяз заполнено формат … варианты: A | B (+K) ошибка «…»`, `*` перед
    номером — появилось после прошлого снимка. Строки контекста: `# заголовок`,
    `! сообщение сайта`, `— форма / iframe / прокрутка`. Не влезло в budget — режем по
    строкам (сначала ссылки вне формы, потом кнопки вне формы, ссылки и кнопки в форме,
    заголовки, сообщения; внутри уровня — дальние от экрана) и пишем «… ещё N элементов
    не показано». Поля формы и кнопка отправки не выкидываются никогда."""
    lines: list[dict] = []
    _flatten(data, lines, True)
    scroll = data.get("scroll") or {}
    above, below = float(scroll.get("above") or 0), float(scroll.get("below") or 0)
    head: list[str] = []
    if data.get("modal"):
        head.append("— открыто диалоговое окно, остальная страница закрыта")
    if above < 0.05:
        head.insert(0, "[начало страницы]")
    tail: list[str] = []
    if above >= 0.05 or below >= 0.05:
        where = " окна" if scroll.get("where") == "modal" else ""
        tail.append(f"— прокрутка{where}: выше {_fmt_float(above)} экрана, ниже {_fmt_float(below)}")
    if below < 0.05:
        tail.append("[конец страницы]")

    hid = data.get("hidden") or {}
    outside = int(hid.get("above") or 0) + int(hid.get("below") or 0) + int(hid.get("limit") or 0)

    def size(ls: list[dict]) -> int:
        return sum(len(x["text"]) + 1 for x in ls) + sum(len(x) + 1 for x in head + tail)

    def tail_len(n: int) -> int:
        return len(_TAIL.format(n=n)) + 1 if n else 0

    dropped = 0
    keep = list(lines)
    if size(keep) + tail_len(outside) > budget:
        # режем с самого ненужного: нижний уровень первым, внутри — дальше от экрана
        # и позже на странице
        victims = sorted((x for x in keep if x["tier"] is not None),
                         key=lambda x: (x["tier"], -x["rank"], -x["dist"], -x["ord"]))
        gone: set[int] = set()
        total = size(keep)
        for v in victims:
            if total + tail_len(outside + dropped) <= budget:
                break
            gone.add(id(v))
            total -= len(v["text"]) + 1
            dropped += 1
        keep = [x for x in keep if id(x) not in gone]
        if size(keep) + tail_len(outside + dropped) > budget:
            # остались только поля и кнопка отправки: сжимаем строки (меньше вариантов, без подсказок)
            for x in keep:
                if x["tier"] is None and x["item"].get("t") == "el":
                    x["text"] = _el_line(x["item"], compact=True)
    n_hidden = outside + dropped
    out = head + [x["text"] for x in keep]
    if n_hidden:
        out.append(_TAIL.format(n=n_hidden))
    out.extend(tail)
    return "\n".join(out)
