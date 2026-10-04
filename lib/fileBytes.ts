import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';

/**
 * Содержимое выбранного файла по ссылке.
 *
 * На телефоне uri — путь, и читает его expo-file-system. В браузере тот же
 * модуль — пустая заглушка без единого метода, а ссылка выглядит как blob:,
 * поэтому содержимое берём запросом. Раньше звали expo-file-system всегда, и
 * на вебе падали и смена фото, и отправка фото в чат.
 *
 * `requireOk` — в браузере считать неуспешный ответ ошибкой (на телефоне не влияет).
 */
export async function readFileBytes(
  uri: string,
  options: { requireOk?: boolean } = {},
): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const resp = await fetch(uri);
    if (options.requireOk && !resp.ok) throw new Error('Не удалось прочитать файл');
    return new Uint8Array(await (await resp.blob()).arrayBuffer());
  }
  return base64ToBytes(await readFileBase64(uri));
}

/** То же, но base64-строкой: на телефоне без лишнего декодирования туда-обратно. */
export async function readFileBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') return bytesToBase64(await readFileBytes(uri));
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
