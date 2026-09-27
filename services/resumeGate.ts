import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { dbGetResumeFiles } from '@/services/db';

/**
 * Решение владельца 25.09.2026: откликаться можно только с загруженным
 * резюме — и на карьерные вакансии, и на свои. Общая проверка для обоих
 * путей отклика (feed.tsx, perm-vacancy-detail.tsx), чтобы текст диалога и
 * переход в профиль не разъехались между ними.
 *
 * Возвращает true, если у человека выбрано резюме с сохранённым PDF.
 * Иначе показывает диалог с переходом в «Профиль → Файлы» и возвращает false.
 */
// Удачная проверка живёт 10 минут: иначе каждый свайп вправо ждал запроса
// к серверу, и колода замирала после каждого отклика. Запоминаем только
// «резюме есть» — отказ переспрашивается, чтобы загрузка сразу засчиталась.
// Профиль сбрасывает память сам, когда резюме удаляют или меняют.
const RESUME_OK_TTL = 10 * 60 * 1000;
let resumeOkUntil = 0;

export function forgetResumeCheck(): void {
  resumeOkUntil = 0;
}

export async function ensureResumeForApply(): Promise<boolean> {
  if (Date.now() < resumeOkUntil) return true;
  const hasResume = (await dbGetResumeFiles()).some(file => file.selected && !!file.storagePath);
  if (hasResume) {
    resumeOkUntil = Date.now() + RESUME_OK_TTL;
    return true;
  }

  const prompt = 'Откликаться можно только с резюме. Загрузите PDF в профиль — это займёт минуту. Перейти к загрузке?';
  const openFiles = Platform.OS === 'web'
    ? typeof window !== 'undefined' && window.confirm(prompt)
    : await new Promise<boolean>(resolve => Alert.alert('Нужно резюме', prompt, [
        { text: 'Позже', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Загрузить', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) }));
  if (openFiles) router.push({ pathname: '/(tabs)/profile', params: { tab: 'files' } });
  return false;
}
