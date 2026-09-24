// Заполнение анкеты Jupiter вручную, во встроенном браузере.
//
// Сюда попадают заявки, которые сервер не может отправить сам (капча, SPA,
// сайт ещё не в списке проверенных): человек открывает страницу вакансии
// сам, форма заполняется его данными, а отправляет и проходит проверку он.
//
// Чистый модуль без React: логика заполнения — строка JS, а не функция.
// В Hermes (движок React Native) Function.toString() не отдаёт исходный код
// функции, поэтому нельзя собрать injectedJavaScript из обычной TS-функции —
// текст скрипта держим как строку с самого начала.
import type { JupiterFillProfile } from '@/services/db';

/**
 * Правила определения смысла поля формы — зеркало серверного Jupiter
 * (`jupiter/agent.py`): что означает подпись/имя поля и в какой ключ
 * профиля кандидата оно превращается. Текст функции целиком уходит в
 * injectedJavaScript, поэтому это плоский ES5-совместимый код без импортов.
 */
export const FILL_CORE = `
function jtKeyForField(text, type, name) {
  text = (text == null ? '' : String(text)).toLowerCase();
  name = name == null ? '' : String(name);
  var nameLower = name.toLowerCase();

  // Капча — отдельная человеческая проверка, её не заполняем.
  if (/captcha|капч/.test(text) || /captcha|капч/.test(nameLower)) return null;
  // Чужие для кандидата поля: мессенджер (\"tel\" внутри \"telegram\"
  // дал бы телефон), компания и ИНН (форма для клиентов), рекомендатель.
  var all = text + ' ' + nameLower;
  if (/telegram|телеграм|компани|company|организац|(^|[^а-яё])инн([^а-яё]|$)|\\binn\\b|referr|рекомендат/.test(all)) return null;

  function classify(t) {
    var hasSurname = /фамил/.test(t);
    var hasFirst = /им(я|ени)/.test(t);
    var hasPatronymic = /отчеств/.test(t);
    var parts = (hasSurname ? 1 : 0) + (hasFirst ? 1 : 0) + (hasPatronymic ? 1 : 0);
    if (parts >= 2 || /фио|fio|full ?name/.test(t)) return 'full_name';

    if (/mail|почт/.test(t)) return 'email';
    if (/phone|tel|телефон/.test(t)) return 'phone';
    if (/отчеств|middle|patronymic/.test(t)) return 'patronymic';
    if (/фамил|surname|last/.test(t)) return 'last_name';
    if (/им(я|ени)|first|\\bname\\b/.test(t)) return 'first_name';
    if (/город|city|town/.test(t)) return 'city';
    if (/дата рожд|birth|bday/.test(t)) return 'birth_date';
    if (/гражданств|citizenship/.test(t)) return 'citizenship';
    // «роль» — только словом: иначе «контроль» и «пароль» стали бы должностью.
    if (/должност|position|vacancy|(^|[^а-яё])роль/.test(t)) return 'desired_role';
    if (/сопроводит|о себе|комментар|comment|message|cover/.test(t)) return 'cover_letter';
    return null;
  }

  // Явное поле типа email/tel побеждает сразу — надёжнее подписи.
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';

  // Составное имя вида РАЗДЕЛ[ПОЛЕ] (VACANCY[NAME], WORK[POSITION][]…):
  // биографию (опыт, образование) не выдумываем — раздел решает раньше
  // подписи поля.
  var bracket = /^([a-zA-Z_]+)\\[([^\\]]*)\\]/.exec(name);
  if (bracket) {
    var section = bracket[1].toLowerCase();
    // Раздел — всё слово целиком, как в jupiter/agent.py: по началу слова
    // под запрет попадали job_application[…] (Greenhouse) и jobform[…].
    if (/^(work|experience|job|career|employment|education|study|studie|course)s?(_history)?$/.test(section)) return null;
    var inner = (bracket[2] || '').toLowerCase();
    return classify((text + ' ' + inner).trim());
  }

  return classify(text);
}
`;

/**
 * Скрипт для injectedJavaScript: заполняет видимые пустые текстовые поля
 * анкеты данными профиля. Ничего не отправляет и не нажимает — это делает
 * человек. Повторяет заполнение через MutationObserver, потому что анкета
 * часто появляется на странице только после клика «Откликнуться».
 */
/**
 * Хост, на котором разрешено заполнять анкету: хост вакансии без «www.».
 * Скрипт сработает на нём и его поддоменах и больше нигде.
 */
export function fillHostFor(vacancyUrl: string): string | null {
  const match = /^https:\/\/([^/:?#]+)/i.exec(vacancyUrl.trim());
  return match ? match[1].toLowerCase().replace(/^www\./, '') : null;
}

export function buildFillScript(profile: JupiterFillProfile, allowedHost: string): string {
  const profileJson = JSON.stringify(profile ?? {});
  const hostJson = JSON.stringify(allowedHost);
  return `(function() {
  // injectedJavaScript выполняется на КАЖДОЙ странице, куда уйдёт WebView.
  // Данные человека вписываем только на сайте этой вакансии: реклама,
  // счётчик или чужой домен после редиректа их не получат.
  var ALLOWED = ${hostJson};
  var HOST = String(location.hostname || '').toLowerCase();
  if (!ALLOWED || location.protocol !== 'https:'
      || (HOST !== ALLOWED && HOST !== 'www.' + ALLOWED && HOST.slice(-(ALLOWED.length + 1)) !== '.' + ALLOWED)) {
    return true;
  }
${FILL_CORE}
  var PROFILE = ${profileJson};
  var FILLABLE_TYPES = ['text', 'email', 'tel', 'search', 'url', ''];
  var SKIP_TYPES = ['hidden', 'password', 'file', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset'];

  function isVisible(el) {
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Нативный сеттер value — иначе React (и похожие формы) не увидят
  // изменение: они переопределяют value через свой дескриптор, обычное
  // присваивание проходит мимо их внутреннего состояния.
  function nativeSetValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) { desc.set.call(el, value); } else { el.value = value; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fieldText(el) {
    var label = '';
    if (el.labels && el.labels.length) label = el.labels[0].textContent || '';
    if (!label && el.id) {
      var lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) label = lab.textContent || '';
    }
    return [label, el.getAttribute('placeholder') || '', el.getAttribute('aria-label') || '', el.name || '', el.id || '']
      .join(' ').toLowerCase();
  }

  function fillOne(el) {
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    var type = tag === 'SELECT' ? 'select' : tag === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'INPUT') {
      if (SKIP_TYPES.indexOf(type) !== -1) return false;
      if (FILLABLE_TYPES.indexOf(type) === -1) return false;
    }
    if (el.value && String(el.value).trim()) return false;
    if (!isVisible(el)) return false;

    var key = jtKeyForField(fieldText(el), type, el.name || el.id || '');
    if (!key) return false;
    var value = PROFILE[key];
    if (value === undefined || value === null || String(value).trim() === '') return false;

    if (tag === 'SELECT') {
      var opts = el.options;
      for (var i = 0; i < opts.length; i++) {
        if ((opts[i].textContent || '').trim().toLowerCase() === String(value).trim().toLowerCase()) {
          el.value = opts[i].value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    nativeSetValue(el, String(value));
    return true;
  }

  function fillAll() {
    var count = 0;
    var els = document.querySelectorAll('input, textarea, select');
    for (var i = 0; i < els.length; i++) {
      try { if (fillOne(els[i])) count++; } catch (e) {}
    }
    return count;
  }

  function report(count) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'jt-filled', count: count }));
    }
  }

  report(fillAll());

  // Анкета часто дорисовывается после клика «Откликнуться» — донабираем поля,
  // как только они появляются, с дебаунсом от частых мутаций страницы.
  var debounceTimer = null;
  var observer = new MutationObserver(function() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { report(fillAll()); }, 400);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
true;`;
}
