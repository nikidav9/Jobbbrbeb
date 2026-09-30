"""Баннеры cookie, окна подписки и чат-виджеты, перекрывающие кнопки.

Из-за такого баннера клик по «Откликнуться» или «Отправить» не доходит до
кнопки. dismiss_overlays(page) закрывает мешающие окна и возвращает журнал
действий (список словарей), который движок может дописать в свои actions.

Правило выбора для баннера cookie (порядок важен, согласие на рекламу не
даём никогда):

1. есть отказ («Только необходимые», «Отклонить», «Отказаться», Reject,
   Necessary only) — жмём его;
2. иначе есть крестик или «Закрыть»/«Не сейчас» — жмём его;
3. иначе «Понятно»/«OK»/«Got it» — чисто информационная плашка, это не
   согласие на рекламу. «Принять»/«Согласен»/Accept — только если это
   единственная кнопка баннера (нет «Настроить», отказа, переключателей);
4. любая кнопка со словом «все»/«all» («Принять все», Accept all) не
   нажимается никогда, даже если она одна: тогда баннер остаётся как есть.

Окна подписки/рассылки/уведомлений и чат-виджеты закрываются только
крестиком (или «Нет, спасибо», «Свернуть»): ни подписки, ни ответа в чат.
Галочки, переключатели и поля ввода не трогаются. Незнакомые окна (например,
сама анкета в модалке) не трогаются вовсе: закрываем лишь то, что опознано по
тексту как cookie/подписка/чат, и не похоже на анкету отклика.
"""
from __future__ import annotations

from typing import Any

try:  # pragma: no cover - наличие зависит от окружения
    from playwright.sync_api import Error as PlaywrightError
except ImportError:  # pragma: no cover
    PlaywrightError = Exception  # type: ignore[assignment,misc]

MAX_ROUNDS = 4

# Ищет одно окно и одно безопасное действие, помечает кнопку data-jt-overlay.
# Возвращает {kind, rule, label, mark} или null. Сам ничего не нажимает.
FIND_OVERLAY_JS = r"""
() => {
  document.querySelectorAll('[data-jt-overlay]').forEach(e => e.removeAttribute('data-jt-overlay'));
  const visible = el => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
      && r.top < innerHeight && r.left < innerWidth;
  };
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const REJECT = /(только|лишь)\s+(необходим|обязательн|нужн|технич|основн)|принять\s+необходим|отклонить|отказаться|не\s+принимать|не\s+соглас|reject|decline|deny|refuse|(only|strictly)\s+(necessary|essential|required)|(necessary|essential)\s+only|use\s+necessary/i;
  const ALL = /все(?![а-яё])|\ball\b/i;
  const STRONG_ACK = /^(понятно|ясно|хорошо|ок|окей|ok|okay|got it|i understand|understood)$/i;
  const WEAK_ACK = /^(принять|принимаю|согласен|согласна|accept|agree|i agree)$/i;
  const CLOSE_TEXT = /^([×✕✖✗xхXХ]|закрыть|close|dismiss|не сейчас|позже|нет,? спасибо|no,? thanks|not now|later|скрыть|свернуть|minimi[sz]e)$/i;
  const CLOSE_ATTR = /close|закрыть|dismiss|свернуть|minimi[sz]e|скрыть/i;
  const COOKIE = /cookie|куки|consent|gdpr|конфиденциальн/i;
  const SUBSCRIBE = /subscri|newsletter|подпис|рассылк|скидк|промокод|уведомлен|notification|push|не пропуст/i;
  const CHAT = /chat|чат|jivo|intercom|drift|crisp|tawk|livechat|callback|консультант/i;
  const APPLYLIKE = /резюме|отклик|анкет|vacanc|вакан|apply|resume|\bcv\b/i;

  const all = Array.from(document.querySelectorAll('body *'));
  const containers = all.filter(el => {
    if (!visible(el)) return false;
    const st = getComputedStyle(el);
    const z = parseInt(st.zIndex, 10) || 0;
    const modal = el.matches('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]');
    return modal || st.position === 'fixed' || st.position === 'sticky'
      || (st.position === 'absolute' && z >= 100);
  });
  // Внутренние (вложенные в другой кандидат) пропускаем: работаем с внешним.
  const outer = containers.filter(c => !containers.some(o => o !== c && o.contains(c)));

  for (const box of outer) {
    const text = norm(box.innerText).slice(0, 600);
    const meta = ((box.id || '') + ' ' + (typeof box.className === 'string' ? box.className : '')
      + ' ' + (box.getAttribute('aria-label') || '') + ' ' + (box.getAttribute('data-testid') || ''));
    const haystack = text + ' ' + meta;
    let kind = null;
    if (COOKIE.test(haystack)) kind = 'cookie';
    else if (SUBSCRIBE.test(haystack)) kind = 'modal';
    else if (CHAT.test(meta) || (box.querySelector('iframe') && CHAT.test(haystack))) kind = 'chat';
    if (!kind) continue;
    // Анкета отклика в модалке — не трогаем.
    const fields = Array.from(box.querySelectorAll('input,textarea,select')).filter(e =>
      visible(e) && !['checkbox', 'radio', 'hidden', 'submit', 'button'].includes((e.type || '').toLowerCase()));
    if (kind !== 'cookie' && (fields.length >= 3 || APPLYLIKE.test(text))) continue;

    const items = Array.from(box.querySelectorAll(
      'button,a,[role=button],input[type=button],input[type=submit],[aria-label],[title],[class*=close],[id*=close]'))
      .filter(e => visible(e) && !['checkbox', 'radio'].includes((e.type || '').toLowerCase()));
    const info = items.map(e => {
      const label = norm(e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title'));
      const attr = (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' '
        + (typeof e.className === 'string' ? e.className : '') + ' ' + (e.id || '');
      const own = norm(e.innerText || e.value);
      const isClose = CLOSE_TEXT.test(own) || (CLOSE_ATTR.test(attr) && own.length <= 2)
        || (CLOSE_ATTR.test(e.getAttribute('aria-label') || '') && own.length <= 12);
      return { e, label, isClose, isAction: ['BUTTON', 'A'].includes(e.tagName) || e.getAttribute('role') === 'button'
        || ['button', 'submit'].includes((e.type || '').toLowerCase()) };
    }).filter(x => x.label || x.isClose);
    const mark = (x, rule) => {
      x.e.setAttribute('data-jt-overlay', 'o1');
      return { kind, rule, label: x.label.slice(0, 60), mark: 'o1' };
    };
    const closer = () => info.find(x => x.isClose);

    if (kind === 'cookie') {
      const rej = info.find(x => !x.isClose && x.label.length <= 60 && REJECT.test(x.label));
      if (rej) return mark(rej, 'reject');
      const cl = closer();
      if (cl) return mark(cl, 'close');
      const actions = info.filter(x => x.isAction && !x.isClose);
      const strong = actions.find(x => STRONG_ACK.test(x.label.replace(/[.!]+$/, '')));
      if (strong) return mark(strong, 'ack');
      const toggles = box.querySelector('input[type=checkbox],input[type=radio],[role=switch]');
      const weak = actions.find(x => WEAK_ACK.test(x.label.replace(/[.!]+$/, '')));
      if (weak && actions.length === 1 && !toggles && !ALL.test(weak.label)) return mark(weak, 'ack_sole');
      continue;
    }
    const cl = closer();
    if (cl) return mark(cl, 'close');
  }
  return null;
}
"""


def dismiss_overlays(page: Any, *, max_rounds: int = MAX_ROUNDS, timeout_ms: int = 3000) -> list[dict[str, Any]]:
    """Закрывает cookie-баннеры, окна подписки и чат-виджеты. Возвращает журнал.

    page — playwright Page. Запись журнала: {"action": "overlay_dismiss",
    "kind": "cookie|modal|chat", "rule": "reject|close|ack|ack_sole",
    "label": <текст кнопки>}; при неудачном клике — {"action":
    "overlay_click_failed", ...}. Пустой список — перекрытий не найдено.
    """
    log: list[dict[str, Any]] = []
    for _ in range(max_rounds):
        try:
            found = page.evaluate(FIND_OVERLAY_JS)
        except PlaywrightError:
            break
        if not found:
            break
        target = page.locator(f'[data-jt-overlay="{found["mark"]}"]').first
        try:
            target.click(timeout=timeout_ms)
        except PlaywrightError as exc:
            log.append({"action": "overlay_click_failed", "kind": found["kind"],
                        "rule": found["rule"], "label": found["label"], "error": str(exc)[:200]})
            break
        log.append({"action": "overlay_dismiss", "kind": found["kind"],
                    "rule": found["rule"], "label": found["label"]})
        page.wait_for_timeout(300)
    return log
