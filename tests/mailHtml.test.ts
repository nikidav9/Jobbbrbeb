import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAIL_CSP, isExternalMailLink, mailDocument } from '../lib/mailHtml.ts';

// Письмо целиком (01.10.2026): чужой HTML показывается закрытым.
test('CSP не пускает скрипты, формы и встраивание', () => {
  assert.match(MAIL_CSP, /default-src 'none'/);
  assert.ok(!/script-src/.test(MAIL_CSP), 'скриптам отдельного разрешения нет');
  assert.match(MAIL_CSP, /form-action 'none'/);
  assert.match(MAIL_CSP, /frame-src 'none'/);
  assert.match(MAIL_CSP, /base-uri 'none'/);
  assert.match(MAIL_CSP, /img-src \* data:/, 'картинки — как в почте');
});

test('политика стоит в head раньше письма', () => {
  const doc = mailDocument('<p>Привет</p><meta http-equiv="Content-Security-Policy" content="script-src *">');
  assert.ok(doc.indexOf(MAIL_CSP) < doc.indexOf('<p>Привет</p>'));
  assert.ok(doc.indexOf('<base target="_blank">') < doc.indexOf('<body>'));
});

test('наружу — только веб, почта и телефон', () => {
  assert.ok(isExternalMailLink('https://hr.example/form'));
  assert.ok(isExternalMailLink('mailto:hr@example.ru'));
  assert.ok(!isExternalMailLink('javascript:alert(1)'));
  assert.ok(!isExternalMailLink('file:///etc/passwd'));
});

test('просмотрщик: на сайте iframe без скриптов, на телефоне без JavaScript', () => {
  const web = readFileSync('components/feature/MailHtmlView.web.tsx', 'utf8');
  assert.match(web, /sandbox: 'allow-popups allow-popups-to-escape-sandbox'/);
  assert.equal((web.match(/sandbox:/g) ?? []).length, 1, 'sandbox задан один раз и ровно так');
  const native = readFileSync('components/feature/MailHtmlView.tsx', 'utf8');
  assert.match(native, /javaScriptEnabled=\{false\}/);
  assert.match(native, /onShouldStartLoadWithRequest/);
});
