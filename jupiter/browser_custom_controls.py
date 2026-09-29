"""Нестандартные поля SPA для браузерного движка Юпитера.

Три вещи, которых нет у HTTP-движка и которых не хватает голому снимку DOM:

1. Выпадающие списки на div (react-select, MUI Select, ant-design и любой
   role=combobox / listbox с role=option). Разборщик страницы знает только
   <select>, поэтому `discover_custom_selects` раскрывает каждый такой список
   кликом, собирает варианты и закрывает; `CLONE_HOOK_JS` в клоне страницы
   подменяет виджет синтетическим <select data-jt-custom="…">. Агент выбирает
   в нём вариант как в обычном select, а `apply_custom_select` повторяет выбор
   кликами в живом виджете.
2. `fill_masked` — ввод в маску телефона/даты по символу с проверкой.

Живой DOM меняется только служебными атрибутами data-jt-cs / data-jt-opt;
рабочие данные пользователя не трогаются. Отправку формы модуль не делает.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

try:
    from playwright.sync_api import Error as PlaywrightError
except ImportError:  # pragma: no cover - без браузера модуль только импортируется
    PlaywrightError = Exception  # type: ignore[assignment,misc]

CUSTOM_SELECTOR = "[data-jt-cs]"
MAX_OPTIONS = 200

# Находит виджеты и помечает их data-jt-cs="N". Возвращает описания.
_FIND_WIDGETS_JS = r"""
() => {
  const visible = el => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  };
  const popups = new Set();
  document.querySelectorAll('[aria-controls],[aria-owns]').forEach(el => {
    for (const id of ((el.getAttribute('aria-controls') || '') + ' ' + (el.getAttribute('aria-owns') || '')).split(/\s+/)) {
      if (id) popups.add(id);
    }
  });
  const all = Array.from(document.querySelectorAll('[role=combobox],[role=listbox],[aria-haspopup=listbox]'))
    .filter(el => el.tagName !== 'SELECT' && visible(el) && !el.hasAttribute('disabled')
      && el.getAttribute('aria-disabled') !== 'true' && !(el.id && popups.has(el.id)));
  // Вложенные виджеты (input внутри контейнера-combobox) считаем одним.
  const widgets = all.filter(el => !all.some(o => o !== el && o.contains(el)));
  const out = [];
  widgets.forEach((el, i) => {
    const old = el.getAttribute('data-jt-cs');
    const key = old !== null ? old : 'cs' + i;
    el.setAttribute('data-jt-cs', key);
    let label = el.getAttribute('aria-label') || '';
    if (!label && el.getAttribute('aria-labelledby')) {
      label = el.getAttribute('aria-labelledby').split(/\s+/)
        .map(id => (document.getElementById(id) || {}).textContent || '').join(' ');
    }
    if (!label && el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) label = l.textContent;
    }
    if (!label) { const l = el.closest('label'); if (l) label = l.textContent.replace(el.textContent || '', ''); }
    out.push({
      key,
      kind: el.getAttribute('role') || 'listbox',
      label: (label || '').replace(/\s+/g, ' ').trim(),
      name: el.getAttribute('name') || el.id || key,
      isListbox: el.getAttribute('role') === 'listbox',
      required: el.getAttribute('aria-required') === 'true',
    });
  });
  return out;
}
"""

# mode='pre' — запомнить уже видимые варианты; mode='list' — вернуть новые
# (или лежащие в списке виджета) и пометить их data-jt-opt="i".
_OPTIONS_JS = r"""
([sel, mode]) => {
  const w = document.querySelector(sel);
  if (!w) return null;
  const visible = el => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  };
  const opts = root => Array.from(root.querySelectorAll('[role=option]')).filter(visible);
  if (mode === 'pre') {
    document.querySelectorAll('[data-jt-seen]').forEach(o => o.removeAttribute('data-jt-seen'));
    opts(document).forEach(o => o.setAttribute('data-jt-seen', '1'));
    return [];
  }
  let found = [];
  const ids = ((w.getAttribute('aria-controls') || '') + ' ' + (w.getAttribute('aria-owns') || '')).split(/\s+/).filter(Boolean);
  for (const id of ids) { const t = document.getElementById(id); if (t) found = found.concat(opts(t)); }
  if (!found.length) found = opts(w);
  if (!found.length) found = opts(document).filter(o => !o.hasAttribute('data-jt-seen'));
  document.querySelectorAll('[data-jt-opt]').forEach(o => o.removeAttribute('data-jt-opt'));
  const res = [];
  found.forEach(o => {
    const text = (o.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    o.setAttribute('data-jt-opt', String(res.length));
    res.push({
      text,
      selected: o.getAttribute('aria-selected') === 'true' || o.getAttribute('aria-checked') === 'true',
      disabled: o.getAttribute('aria-disabled') === 'true',
    });
  });
  const cur = (w.value !== undefined && w.tagName === 'INPUT') ? w.value : (w.textContent || '');
  return { options: res.slice(0, %d), current: cur.replace(/\s+/g, ' ').trim() };
}
""" % MAX_OPTIONS

# Подмена в КЛОНЕ. Вызов из SNAPSHOT_JS после цикла по live:
#   (CLONE_HOOK_JS)(clone, customSpecs)
# customSpecs — список CustomSelect.as_dict(). Элемент клона находится по
# data-jt-cs; data-jt-ref у него уже проставлен снимком, его сохраняем.
CLONE_HOOK_JS = r"""
(clone, specs) => {
  const doc = clone.ownerDocument;
  for (const s of specs || []) {
    const c = clone.querySelector('[data-jt-cs="' + s.key + '"]');
    if (!c) continue;
    const sel = doc.createElement('select');
    const ref = c.getAttribute('data-jt-ref');
    if (ref !== null) sel.setAttribute('data-jt-ref', ref);
    sel.setAttribute('data-jt-custom', s.kind);
    sel.setAttribute('name', s.name);
    if (s.label) sel.setAttribute('aria-label', s.label);
    if (s.required) sel.setAttribute('required', '');
    const add = (value, text, selected) => {
      const o = doc.createElement('option');
      o.setAttribute('value', value);
      o.textContent = text;
      if (selected) o.setAttribute('selected', '');
      sel.appendChild(o);
    };
    if (!s.options.some(o => o.selected)) add('', 'Выберите', true);
    for (const o of s.options) if (!o.disabled) add(o.text, o.text, o.selected);
    c.parentNode.replaceChild(sel, c);
  }
}
"""


@dataclass
class CustomOption:
    text: str
    selected: bool = False
    disabled: bool = False


@dataclass
class CustomSelect:
    key: str
    kind: str
    label: str
    name: str
    options: list[CustomOption] = field(default_factory=list)
    current: str = ""
    required: bool = False

    def as_dict(self) -> dict:
        return {
            "key": self.key, "kind": self.kind, "label": self.label,
            "name": self.name, "required": self.required,
            "options": [
                {"text": o.text, "selected": o.selected, "disabled": o.disabled}
                for o in self.options
            ],
        }


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("ё", "е").replace("Ё", "Е")).strip().lower()


def _open(page, sel: str) -> None:
    page.evaluate(_OPTIONS_JS, [sel, "pre"])
    page.locator(sel).first.click(timeout=3000)
    page.wait_for_timeout(150)


def _still_open(page) -> bool:
    return bool(page.evaluate(
        "() => Array.from(document.querySelectorAll('[data-jt-opt]')).some(o => o.getClientRects().length > 0)"
    ))


def _close(page, sel: str) -> None:
    """Закрыть список: Escape, клик мимо, повторный клик по виджету."""
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(80)
        if _still_open(page):
            page.mouse.click(1, 1)
            page.wait_for_timeout(80)
        if _still_open(page):
            page.locator(sel).first.click(timeout=2000)
            page.wait_for_timeout(80)
    except PlaywrightError:
        pass


def discover_custom_selects(page) -> list[CustomSelect]:
    """Найти кастомные списки, раскрыть каждый, собрать варианты, закрыть.

    Вызывать ПЕРЕД SNAPSHOT_JS. Виджеты, которые не раскрылись или не дали ни
    одного варианта, пропускаются: подменять их нечем.
    """
    result: list[CustomSelect] = []
    for spec in page.evaluate(_FIND_WIDGETS_JS):
        sel = f'[data-jt-cs="{spec["key"]}"]'
        item = CustomSelect(spec["key"], spec["kind"], spec["label"], spec["name"],
                            required=spec["required"])
        try:
            if spec["isListbox"]:
                # Список уже развёрнут на странице — кликать нечего.
                data = page.evaluate(_OPTIONS_JS, [sel, "list"])
            else:
                _open(page, sel)
                data = page.evaluate(_OPTIONS_JS, [sel, "list"])
                _close(page, sel)
        except PlaywrightError:
            continue
        if not data or not data["options"]:
            continue
        item.options = [CustomOption(**o) for o in data["options"]]
        item.current = data["current"]
        result.append(item)
    return result


def apply_custom_select(page, ref: str, wanted_label: str) -> bool:
    """Выбрать вариант в живом виджете (ref — его data-jt-ref) кликами.

    Сравнение: точное по нормализованному тексту, затем «вариант содержит
    запрошенное». True — только если после клика виджет показывает выбор.
    """
    sel = f'[data-jt-ref="{ref}"]'
    wanted = _norm(wanted_label)
    if not wanted or page.locator(sel).count() == 0:
        return False
    is_listbox = page.evaluate(
        "s => (document.querySelector(s).getAttribute('role') === 'listbox')", sel
    )
    try:
        if not is_listbox:
            _open(page, sel)
        data = page.evaluate(_OPTIONS_JS, [sel, "list"])
        options = (data or {}).get("options") or []
        idx = _pick(options, wanted)
        if idx is None and not is_listbox:
            # react-select и ant умеют фильтр вводом: напечатать и посмотреть снова.
            try:
                page.keyboard.type(wanted_label, delay=20)
                page.wait_for_timeout(200)
                data = page.evaluate(_OPTIONS_JS, [sel, "list"])
                options = (data or {}).get("options") or []
                idx = _pick(options, wanted)
            except PlaywrightError:
                idx = None
        if idx is None:
            if not is_listbox:
                _close(page, sel)
            return False
        page.locator(f'[data-jt-opt="{idx}"]').first.click(timeout=3000)
        page.wait_for_timeout(150)
        return _shows_choice(page, sel, options[idx]["text"])
    except PlaywrightError:
        return False


def _pick(options: list[dict], wanted: str) -> int | None:
    live = [(i, _norm(o["text"])) for i, o in enumerate(options) if not o.get("disabled")]
    for i, text in live:
        if text == wanted:
            return i
    for i, text in live:
        if wanted in text or (text and text in wanted):
            return i
    return None


def _shows_choice(page, sel: str, text: str) -> bool:
    shown = page.evaluate(
        """s => { const w = document.querySelector(s); if (!w) return null;
          return (w.tagName === 'INPUT' ? w.value : w.textContent) || ''; }""",
        sel,
    )
    if shown is None:
        return False
    if _norm(text) in _norm(shown):
        return True
    # У multi-виджетов выбор может оказаться отдельным «тегом» рядом.
    return bool(page.evaluate(
        "t => Array.from(document.querySelectorAll('[aria-selected=true]')).some("
        "o => (o.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase() === t)",
        _norm(text),
    ))


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text or "")


def _canon(digits: str) -> str:
    # +7 / 8 в начале российского номера — код страны, а не часть маски.
    return digits[1:] if len(digits) == 11 and digits[0] in "78" else digits


def _mask_ok(actual: str, wanted: str) -> bool:
    return bool(_digits(wanted)) and _canon(_digits(actual)) == _canon(_digits(wanted))


def _clear(locator) -> None:
    locator.click()
    before = locator.input_value()
    for _ in range(25):
        if not before:
            break
        locator.press("Control+A")
        locator.press("Backspace")
        after = locator.input_value()
        # Маска с префиксом «+7 (» оставляет его — там дальше стирать нечего.
        if after == before:
            break
        before = after


def fill_masked(page, locator, value: str, delay_ms: int = 40) -> bool:
    """Ввести значение в поле с маской (телефон, дата) по символу.

    Пробует по очереди: цифры как есть; без кода страны (маска сама ставит +7);
    строку целиком. После каждой попытки сверяет цифры поля с ожидаемыми и
    возвращает True при совпадении. При неудаче поле остаётся в последнем
    состоянии, вызывающий решает, ошибка это или нет.
    """
    digits = _digits(value)
    attempts = [digits]
    if _canon(digits) != digits:
        attempts.append(_canon(digits))
    attempts.append(value)
    seen: set[str] = set()
    for text in attempts:
        if not text or text in seen:
            continue
        seen.add(text)
        _clear(locator)
        for ch in text:
            locator.press_sequentially(ch, delay=delay_ms)
        if _mask_ok(locator.input_value(), value):
            return True
    return False
