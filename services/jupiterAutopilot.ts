// Отклик с телефона человека: автопилот анкеты во встроенном браузере.
//
// Решение владельца 27.09.2026. Сайты, где сервер отклик не отправит — капча
// или анкету рисует скрипт, — приложение открывает во встроенном браузере на
// телефоне самого человека. Страница грузится с его устройства и по его сети,
// поэтому «умная» капча видит того же человека, что и при ручном отклике.
// Скрипт находит анкету, заполняет её данными профиля, прикладывает резюме,
// ставит только разрешённые поручением галочки и отправляет.
//
// Чего скрипт не делает никогда (Соглашение, п. 8.3):
//   • не проходит капчу — видимая проверка «я не робот» уходит человеку;
//   • не ставит галочки рекламы, кадрового резерва, третьих лиц,
//     трансграничной передачи, особых категорий и смешанные;
//   • не выдумывает ответы — пустое обязательное поле уходит человеку;
//   • не повторяет отправку при неизвестном исходе.
//
// Текст скрипта — строка с самого начала: в Hermes Function.toString() не
// отдаёт исходник (см. services/jupiterFill.ts). Решения вынесены в
// AUTOPILOT_CORE — чистые функции от строк, их проверяет
// tests/jupiterAutopilot.test.ts, исполняя эту же строку в node:vm.
import { FILL_CORE } from './jupiterFill.ts';
import type { JupiterFillProfile } from '@/services/db';

/**
 * Скрипт для injectJavaScript по кнопке «Отправить отклик» — нажатие делает
 * человек, скрипт лишь передаёт его на кнопку сайта (см. window.__jtSubmit).
 */
export const SUBMIT_BY_USER_SCRIPT = 'window.__jtSubmit && window.__jtSubmit(); true;';

/** Повторный прогон автопилота на той же странице («Заполнить ещё раз»). */
export function rerunAutopilotScript(script: string): string {
  return 'window.__jtAutopilot = false; ' + script;
}

/** Что автопилот сообщает приложению в конце. */
export type AutopilotOutcome =
  | 'submitted'   // сайт подтвердил приём
  | 'ready'       // сухой прогон: всё заполнено, отправка не нажималась
  | 'needs_user'  // нужен человек: капча, согласие, пустое обязательное поле
  | 'no_form'     // анкеты на странице нет
  | 'unknown'     // «Отправить» нажато, но подтверждения не видно — не повторять
  | 'error';

export type AutopilotResult = {
  type: 'jt-autopilot';
  outcome: AutopilotOutcome;
  reason: string;        // captcha | consent | missing | invalid | no_submit | …
  filled: number;
  missing: string[];
  captcha: 'none' | 'invisible' | 'visible';
  resume: boolean;       // резюме приложено
  checked: string[];     // какие виды согласий отмечены
  url: string;
};

export type AutopilotOptions = {
  /** false — сухой прогон: всё, кроме нажатия «Отправить». */
  submit: boolean;
  /** Поручение на согласия работодателю есть (third_party_consent_at). */
  delegated: boolean;
  /** Резюме PDF в base64, без префикса data:. */
  resumeBase64?: string | null;
  resumeName?: string | null;
  /** Предел всего прогона, мс. */
  deadlineMs?: number;
};

/**
 * Чистые решения автопилота. Плоский ES5 без импортов: строка целиком уходит
 * в страницу. Зеркало jupiter/candidate.py (виды согласий) — меняя одно,
 * меняйте и другое.
 */
export const AUTOPILOT_CORE = `
function jtFlat(t) {
  return String(t == null ? '' : t).toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]+/g, ' ').trim();
}

// Виды согласий в порядке проверки. required — без него отклик не примут,
// и поручение (Соглашение п. 8.2) его покрывает; остальные — никогда.
var JT_CONSENT_KINDS = [
  ['marketing', false, ['реклам', 'маркетинг', 'рассылк', 'новост', 'акци', 'marketing', 'newsletter', 'promotion', 'advertis']],
  ['talent_pool', false, ['кадровый резерв', 'базу кандидат', 'базе кандидат', 'базу соискател', 'будущих ваканси', 'другие ваканси', 'talent pool', 'candidate database', 'future vacancies', 'future opportunities']],
  ['third_party', false, ['третьим лицам', 'третьи лица', 'партнерам', 'third part', 'affiliates']],
  ['crossborder', false, ['трансгранич', 'за пределы российской', 'иностранн государств', 'cross border', 'outside russia']],
  ['special_category', false, ['биометрическ', 'состояни здоровья', 'судимост', 'biometric']],
  ['personal_data', true, ['обработк персональн', 'персональных данных', 'персональными данными', 'обработку данных', 'personal data', 'processing of personal']],
  ['privacy', true, ['политик конфиденциальност', 'пользовательск соглашен', 'условия', 'privacy policy', 'terms', 'user agreement', 'оферт']],
  ['data_accuracy', true, ['достоверн', 'подтверждаю правильност', 'information is accurate', 'true and correct', 'true and accurate']]
];

// Галочка согласия: check — ставим, skip — оставляем пустой, ask — к человеку,
// none — это не согласие (обычный вопрос анкеты).
function jtConsentDecision(text, delegated) {
  var flat = jtFlat(text);
  var kinds = [];
  for (var i = 0; i < JT_CONSENT_KINDS.length; i++) {
    var pats = JT_CONSENT_KINDS[i][2];
    for (var j = 0; j < pats.length; j++) {
      if (flat.indexOf(jtFlat(pats[j])) !== -1) { kinds.push(JT_CONSENT_KINDS[i]); break; }
    }
  }
  if (!kinds.length) return { action: 'none', kinds: [] };
  var names = [], optional = 0, lawful = 0;
  for (var k = 0; k < kinds.length; k++) {
    names.push(kinds[k][0]);
    if (kinds[k][1]) lawful++; else optional++;
  }
  // Смешанная галочка (данные + реклама) — всегда выбор человека.
  if (optional && lawful) return { action: 'ask', kinds: names };
  if (optional) return { action: 'skip', kinds: names };
  return { action: delegated ? 'check' : 'ask', kinds: names };
}

// Кнопка, открывающая анкету («Откликнуться»). Не отправка формы.
function jtIsApplyButton(text) {
  var t = jtFlat(text);
  if (!t || t.length > 40) return false;
  return /^(откликнуться|отклик|откликнуться на вакансию|подать заявку|подать отклик|отправить резюме|оставить заявку|заполнить анкету|заполнить форму|хочу у вас работать|хочу в команду|apply|apply now|respond)$/.test(t);
}

// Кнопка отправки анкеты.
function jtIsSubmitButton(text) {
  var t = jtFlat(text);
  if (!t || t.length > 40) return false;
  if (/подписат|subscribe|поиск|найти|search|войти|login|регистрац/.test(t)) return false;
  return /отправ|откликнуться|отклик|подать|submit|apply|send|готово/.test(t);
}

// Сайт подтвердил приём отклика. «Мы рассмотрим / свяжемся» сюда не входит:
// эти слова стоят и на странице вакансии до отправки.
function jtSuccessText(text) {
  var t = jtFlat(text);
  return /спасибо за (отклик|заявк|интерес|резюме)|(отклик|заявка|резюме|анкета)( успешно)? (отправлен|принят|получен)|ваш(е|а)? (отклик|заявка|резюме)( успешно)? (отправлен|принят|получен)|благодарим за (отклик|заявк|интерес)|thank you for (applying|your application|your interest)|application (has been )?(received|submitted|sent)/.test(t);
}

// Видимая проверка «я не робот» — только для человека.
function jtIsCaptchaText(text) {
  return /captcha|капч|я не робот|not a robot|введите (символы|код с картинки)/.test(jtFlat(text));
}
`;

/**
 * Скрипт автопилота для injectedJavaScript. Работает только на хосте вакансии
 * и его поддоменах; результат — одно сообщение `jt-autopilot` через
 * ReactNativeWebView.postMessage (стенд подменяет window.ReactNativeWebView).
 */
export function buildAutopilotScript(
  profile: JupiterFillProfile, allowedHost: string, options: AutopilotOptions,
): string {
  const cfg = JSON.stringify({
    host: allowedHost,
    profile: profile ?? {},
    submit: !!options.submit,
    delegated: !!options.delegated,
    resume: options.resumeBase64 ? { b64: options.resumeBase64, name: options.resumeName || 'resume.pdf' } : null,
    deadline: options.deadlineMs ?? 60000,
  });
  return `(function() {
  if (window.__jtAutopilot) return true;
  var CFG = ${cfg};
  var HOST = String(location.hostname || '').toLowerCase();
  var A = CFG.host;
  if (!A || location.protocol !== 'https:'
      || (HOST !== A && HOST !== 'www.' + A && HOST.slice(-(A.length + 1)) !== '.' + A)) {
    return true;
  }
  window.__jtAutopilot = true;
${FILL_CORE}
${AUTOPILOT_CORE}
  var started = Date.now();
  var done = false;
  var result = { type: 'jt-autopilot', outcome: 'error', reason: '', filled: 0, missing: [],
    captcha: 'none', resume: false, checked: [], url: location.href };

  function post(obj) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    } catch (e) {}
  }
  function finish(outcome, reason) {
    if (done) return;
    done = true;
    result.outcome = outcome;
    result.reason = reason || '';
    result.url = location.href;
    post(result);
  }
  function later(fn, ms) { setTimeout(function() { try { fn(); } catch (e) { finish('error', String(e && e.message || e).slice(0, 120)); } }, ms); }
  // «Отправить» уже нажато — исход неизвестен, повторять нельзя; иначе просто не успели.
  var clicked = false;
  var deadlineTimer = setTimeout(function() { finish(clicked ? 'unknown' : 'error', 'deadline'); }, CFG.deadline);

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function textOf(el) {
    var parts = [];
    if (el.labels && el.labels.length) for (var i = 0; i < el.labels.length; i++) parts.push(el.labels[i].textContent || '');
    if (el.id) {
      var lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) parts.push(lab.textContent || '');
    }
    var wrap = el.closest && el.closest('label');
    if (wrap) parts.push(wrap.textContent || '');
    // Подпись рядом без for/id (Битрикс: ГУМ, СИБУР) — ближайший <label> в
    // обёртке поля, если он не привязан к другому полю.
    if (!parts.join('').trim() || !(el.labels && el.labels.length)) {
      var box = el.parentElement;
      for (var up = 0; box && up < 2; up++, box = box.parentElement) {
        var near = box.querySelector('label');
        if (near && (!near.control || near.control === el)) { parts.push(near.textContent || ''); break; }
      }
    }
    if (el.getAttribute('data-text')) parts.push(el.getAttribute('data-text'));
    parts.push(el.getAttribute('placeholder') || '', el.getAttribute('aria-label') || '', el.name || '', el.id || '');
    // Подпись рядом: у галочек текст часто в соседнем элементе.
    if ((el.type === 'checkbox' || el.type === 'radio') && el.parentElement) parts.push(el.parentElement.textContent || '');
    return parts.join(' ').replace(/\\s+/g, ' ').slice(0, 600);
  }
  function setValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus && el.focus();
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur && el.blur();
  }
  function controls(root) { return root.querySelectorAll('input, textarea, select'); }
  // Пусто ли поле. Маска вида «+7 (___) ___ __ __» — это ещё не номер:
  // в ней нет цифр, кроме кода страны.
  function isEmpty(el) {
    var v = String(el.value == null ? '' : el.value);
    if (!v.trim()) return true;
    return v.indexOf('_') !== -1 && v.replace(/^\s*\+?7/, '').replace(/\D/g, '').length === 0;
  }
  function keyOf(el) {
    var type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
    return jtKeyForField(textOf(el).toLowerCase(), type, el.name || el.id || '');
  }

  // Анкета — форма (или блок), где не меньше двух полей кандидата.
  function findForm() {
    var roots = [].slice.call(document.querySelectorAll('form'));
    roots.push(document.body);
    var best = null, bestScore = 1;
    for (var i = 0; i < roots.length; i++) {
      var score = 0, hasFile = false, els = controls(roots[i]);
      for (var j = 0; j < els.length; j++) {
        if (!visible(els[j])) {
          // Скрытое поле файла — норма (сайты прячут его под своей кнопкой),
          // но только внутри видимой формы: поле нераскрытой анкеты не делает
          // анкетой всю страницу (iFellow: подписка в подвале + скрытый файл).
          if (els[j].type !== 'file' || roots[i] === document.body || !visible(roots[i])) continue;
        }
        // Вся страница считает только поля вне <form>: иначе две разные
        // формы (анкета и её дубль-виджет) сливались бы в одну.
        if (roots[i] === document.body && els[j].closest && els[j].closest('form')) continue;
        var k = keyOf(els[j]);
        if (k === 'email' || k === 'phone' || k === 'first_name' || k === 'last_name' || k === 'full_name') score++;
        if (els[j].type === 'file') { score++; hasFile = true; }
      }
      // <form> с полем файла — анкета, даже если кроме резюме в ней только
      // согласие (Crosstech). Подписка на рассылку файла не просит.
      if (hasFile && roots[i] !== document.body) score++;
      // Настоящая <form> предпочтительнее всей страницы при равном счёте.
      if (score > bestScore || (score === bestScore && best === document.body)) { best = roots[i]; bestScore = score; }
    }
    return best;
  }
  function clickApply() {
    var els = document.querySelectorAll('a, button, [role=button], input[type=button]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!visible(el)) continue;
      if (el.closest && el.closest('form') && (el.getAttribute('type') || '').toLowerCase() === 'submit') continue;
      if (jtIsApplyButton(el.textContent || el.value || '')) {
        var href = el.getAttribute && el.getAttribute('href');
        // Уход на чужой сайт (hh.ru и т.п.) — не наш путь.
        if (href && /^https?:/i.test(href) && href.indexOf(A) === -1) continue;
        el.click();
        return true;
      }
    }
    return false;
  }

  function fill(form) {
    var els = controls(form), n = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i], tag = el.tagName, type = (el.getAttribute('type') || 'text').toLowerCase();
      if (tag === 'INPUT' && ['hidden', 'password', 'file', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset'].indexOf(type) !== -1) continue;
      if (!visible(el) || el.disabled || el.readOnly) continue;
      if (!isEmpty(el)) continue;
      var key = keyOf(el);
      if (!key) continue;
      var v = CFG.profile[key];
      if (v == null || String(v).trim() === '') continue;
      if (tag === 'SELECT') {
        for (var o = 0; o < el.options.length; o++) {
          if ((el.options[o].textContent || '').trim().toLowerCase() === String(v).trim().toLowerCase()) {
            el.value = el.options[o].value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            n++;
            break;
          }
        }
        continue;
      }
      setValue(el, String(v));
      n++;
    }
    return n;
  }

  function attachResume(form) {
    if (!CFG.resume) return false;
    var files = form.querySelectorAll('input[type=file]');
    var target = null;
    for (var i = 0; i < files.length; i++) {
      if (/resume|cv|резюм|файл|file|attach|прикреп/i.test(textOf(files[i]))) { target = files[i]; break; }
    }
    if (!target && files.length === 1) target = files[0];
    if (!target) return false;
    var bin = atob(CFG.resume.b64), bytes = new Uint8Array(bin.length);
    for (var b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b);
    var file = new File([bytes], CFG.resume.name, { type: 'application/pdf' });
    var dt = new DataTransfer();
    dt.items.add(file);
    target.files = dt.files;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Галочки: только разрешённые поручением. Возвращает false, если нужна
  // воля человека (обязательная смешанная или не покрытая поручением).
  function consents(form) {
    var boxes = form.querySelectorAll('input[type=checkbox]');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var d = jtConsentDecision(textOf(box), CFG.delegated);
      if (d.action === 'check') {
        if (!box.checked) box.click();
        if (!box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
        for (var c = 0; c < d.kinds.length; c++) if (result.checked.indexOf(d.kinds[c]) === -1) result.checked.push(d.kinds[c]);
      } else if (d.action === 'ask' && (box.required || box.getAttribute('aria-required') === 'true')) {
        result.missing.push('согласие: ' + d.kinds.join('+'));
        return false;
      }
    }
    return true;
  }

  function captchaState(form) {
    var scope = [document];
    var visibleChallenge = false, any = false;
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      var src = iframes[i].src || '';
      if (/recaptcha|smartcaptcha|captcha-api\\.yandex|hcaptcha|challenges\\.cloudflare|captcha/i.test(src)) {
        any = true;
        var r = iframes[i].getBoundingClientRect();
        // Бейдж невидимой reCAPTCHA и служебные фреймы крошечные или скрыты.
        if (visible(iframes[i]) && r.width >= 150 && r.height >= 50 && !/size=invisible/.test(src)) visibleChallenge = true;
      }
    }
    var els = form.querySelectorAll('input, img');
    for (var j = 0; j < els.length; j++) {
      var t = (els[j].name || '') + ' ' + (els[j].id || '') + ' ' + (els[j].className || '') + ' ' + (els[j].getAttribute('src') || '') + ' ' + (els[j].getAttribute('placeholder') || '');
      // Картинка-капча часто подписана только классом обёртки (captcha-flex).
      var wrapped = els[j].closest && els[j].closest('[class*="captcha"],[id*="captcha"],[class*="капч"]');
      if ((/captcha|капч/i.test(t) || wrapped) && visible(els[j])) { any = true; visibleChallenge = true; }
    }
    if (document.querySelector('.g-recaptcha, .smart-captcha, .h-captcha, .cf-turnstile, [data-sitekey]')) any = true;
    return visibleChallenge ? 'visible' : any ? 'invisible' : 'none';
  }

  function requiredMissing(form) {
    var els = controls(form), out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i], type = (el.getAttribute('type') || '').toLowerCase();
      var req = el.required || el.getAttribute('aria-required') === 'true';
      if (!req || el.disabled || type === 'hidden') continue;
      if (type !== 'file' && !visible(el)) continue;
      if (type === 'checkbox') { if (!el.checked && jtConsentDecision(textOf(el), CFG.delegated).action === 'none') out.push(textOf(el).slice(0, 60)); continue; }
      if (type === 'radio') {
        var group = form.querySelectorAll('input[type=radio][name="' + CSS.escape(el.name) + '"]'), any = false;
        for (var g = 0; g < group.length; g++) if (group[g].checked) any = true;
        if (!any) out.push(textOf(el).slice(0, 60));
        continue;
      }
      if (type === 'file') { if (!el.files || !el.files.length) out.push('файл: ' + textOf(el).slice(0, 50)); continue; }
      if (isEmpty(el)) out.push(textOf(el).slice(0, 60));
    }
    return out;
  }

  function submitButton(form) {
    var els = form.querySelectorAll('button, input[type=submit], [role=button], a');
    var fallback = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!visible(el) || el.disabled) continue;
      var label = el.textContent || el.value || el.getAttribute('aria-label') || '';
      if (jtIsSubmitButton(label)) return el;
      if (!fallback && (el.getAttribute('type') || '').toLowerCase() === 'submit') fallback = el;
    }
    return fallback;
  }

  var bodyBefore = '';
  function watchOutcome(form, tries) {
    if (done) return;
    var text = document.body ? document.body.innerText || '' : '';
    if (jtSuccessText(text) && !jtSuccessText(bodyBefore)) { finish('submitted', 'confirmed'); return; }
    if (captchaState(document.body) === 'visible' && result.captcha !== 'visible') {
      result.captcha = 'visible';
      finish('needs_user', 'captcha');
      return;
    }
    if (tries <= 0) {
      // Форма исчезла без явного «спасибо» — не уверены: не повторяем.
      finish('unknown', document.body.contains(form) ? 'no_confirmation' : 'form_gone');
      return;
    }
    later(function() { watchOutcome(form, tries - 1); }, 1000);
  }

  // Отправка по нажатию человека (submit=false): приложение вызывает
  // window.__jtSubmit, когда человек нажал «Отправить отклик». Сам скрипт её
  // не вызывает никогда. Форму ищем заново: человек мог открыть анкету сам.
  function submitByUser() {
    var form = findForm() || document.body;
    var btn = submitButton(form);
    clearTimeout(deadlineTimer);
    done = false;
    if (!btn) { finish('needs_user', 'no_submit'); return; }
    bodyBefore = document.body ? document.body.innerText || '' : '';
    post({ type: 'jt-autopilot-submitting' });
    clicked = true;
    btn.click();
    later(function() { watchOutcome(form, 14); }, 1000);
  }
  if (!CFG.submit) window.__jtSubmit = function() { try { submitByUser(); } catch (e) { done = false; finish('error', 'submit_failed'); } };

  function run(attempt) {
    if (done) return;
    var form = findForm();
    if (!form) {
      if (attempt < 2 && clickApply()) { later(function() { run(attempt + 1); }, 2500); return; }
      if (attempt < 4) { later(function() { run(attempt + 1); }, 1500); return; }
      // Отклик только после входа в аккаунт сайта — это к человеку, и
      // причина должна быть понятна («Войти и откликнуться» у Яндекса).
      var btns = document.querySelectorAll('a, button, [role=button]');
      for (var b = 0; b < btns.length; b++) {
        if (visible(btns[b]) && /войти и откликнуться|войдите,? чтобы откликнуться|sign in to apply|log ?in to apply/i.test(btns[b].textContent || '')) {
          finish('needs_user', 'login_required');
          return;
        }
      }
      finish('no_form', 'no_candidate_fields');
      return;
    }
    result.filled = fill(form);
    result.resume = attachResume(form);
    if (!consents(form)) { finish('needs_user', 'consent'); return; }
    // Поля могли дорисоваться после ввода — второй проход.
    later(function() {
      result.filled += fill(form);
      var missing = requiredMissing(form);
      if (missing.length) { result.missing = result.missing.concat(missing); finish('needs_user', 'missing'); return; }
      result.captcha = captchaState(form);
      if (result.captcha === 'visible') { finish('needs_user', 'captcha'); return; }
      var btn = submitButton(form);
      if (!btn) { finish('needs_user', 'no_submit'); return; }
      if (!CFG.submit) { finish('ready', 'dry_run'); return; }
      bodyBefore = document.body ? document.body.innerText || '' : '';
      post({ type: 'jt-autopilot-submitting' });
      clicked = true;
      btn.click();
      later(function() { watchOutcome(form, 14); }, 1000);
    }, 800);
  }

  if (document.readyState === 'complete') later(function() { run(0); }, 1500);
  else window.addEventListener('load', function() { later(function() { run(0); }, 1500); });
})();
true;`;
}
