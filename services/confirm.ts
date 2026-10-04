import { Alert, Platform } from 'react-native';

/**
 * Вопрос «да/нет», который работает на всех трёх поверхностях.
 *
 * В веб-сборке (сайт и мини-приложение в Телеграме) `Alert.alert` из
 * react-native-web — пустышка: окно не появляется, и кнопки вроде «Удалить
 * резюме» молча не работали. `window.confirm` показывал серое окно браузера с
 * адресом сайта в заголовке, а в части клиентов Телеграма — ничего. Поэтому
 * вопрос задаёт своё окно (`ConfirmHost` в корневом `_layout`) — с 01.10.2026
 * и на телефоне, в фирменном стиле. Системный Alert и `window.confirm` —
 * только пока окно не смонтировано.
 */
interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let host: ((req: ConfirmRequest) => void) | null = null;

export function registerConfirmHost(show: (req: ConfirmRequest) => void): () => void {
  host = show;
  return () => { if (host === show) host = null; };
}

export function confirmAsync(options: ConfirmOptions): Promise<boolean> {
  const { title, body, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', danger } = options;
  if (!host && Platform.OS !== 'web') {
    return new Promise(resolve => Alert.alert(title, body, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: danger ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }));
  }
  // Окно ещё не смонтировано (самый ранний кадр) — лучше браузерное, чем никакого.
  if (!host) return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`));
  const show = host;
  return new Promise(resolve => show({ ...options, resolve }));
}
