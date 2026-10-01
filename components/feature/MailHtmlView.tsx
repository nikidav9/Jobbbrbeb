import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { isExternalMailLink, mailDocument } from '@/lib/mailHtml';

/**
 * Письмо целиком на телефоне. JavaScript выключен, переходы не открываются
 * внутри — ссылка уходит во внешний браузер. Документ закрыт CSP (lib/mailHtml).
 */
export function MailHtmlView({ html }: { html: string }) {
  return (
    <WebView
      style={s.view}
      originWhitelist={['*']}
      source={{ html: mailDocument(html) }}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      allowFileAccess={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={req => {
        if (req.url === 'about:blank' || req.url.startsWith('data:')) return true;
        if (isExternalMailLink(req.url)) Linking.openURL(req.url).catch(() => {});
        return false;
      }}
    />
  );
}

const s = StyleSheet.create({ view: { flex: 1, backgroundColor: '#FFFFFF' } });
