/**
 * Как показать сообщение одной строкой — в списке чатов и в дашборде.
 *
 * Фото и голосовые лежат в той же текстовой колонке, что и обычные сообщения:
 * служебная метка плюс ссылка. Так сделано, чтобы не заводить под них
 * отдельные поля в таблице. Внутри переписки метка разбирается и рисуется
 * пузырём, а вот в списке чатов текст показывали как есть — и вместо
 * «Голосовое сообщение» человек видел «[voice]https://bbiqmkeysalwd…».
 */

export const IMG_PREFIX = '[img]';
export const VOICE_PREFIX = '[voice]';

export const isImageMessage = (t: string) => t.startsWith(IMG_PREFIX);
export const isVoiceMessage = (t: string) => t.startsWith(VOICE_PREFIX);

export const imageUrlOf = (t: string) => t.slice(IMG_PREFIX.length);

/** Голосовое: [voice]<ссылка>|<секунды> */
export const voiceOf = (t: string) => {
  const [url, sec] = t.slice(VOICE_PREFIX.length).split('|');
  return { url, sec: Number(sec) || 0 };
};

/**
 * Строка для списка. Значки те же, что в уведомлениях об этих сообщениях, —
 * чтобы список и шторка уведомлений говорили одно и то же.
 */
export function messagePreview(text: string | null | undefined): string {
  if (!text) return '';
  if (isVoiceMessage(text)) return 'Голосовое сообщение';
  if (isImageMessage(text)) return 'Фото';
  return text;
}
