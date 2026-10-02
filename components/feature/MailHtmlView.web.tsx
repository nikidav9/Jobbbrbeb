import React from 'react';
import { mailDocument } from '@/lib/mailHtml';

/**
 * Письмо целиком на сайте: iframe без allow-scripts и без allow-same-origin —
 * чужой документ не исполняет код и не видит наш сайт. Ссылки открываются в
 * новой вкладке (allow-popups + <base target="_blank">). CSP — lib/mailHtml.
 */
export function MailHtmlView({ html }: { html: string }) {
  return React.createElement('iframe', {
    title: 'Письмо',
    srcDoc: mailDocument(html),
    sandbox: 'allow-popups allow-popups-to-escape-sandbox',
    referrerPolicy: 'no-referrer',
    style: { flex: 1, width: '100%', height: '100%', border: 0, backgroundColor: '#FFFFFF' },
  });
}
