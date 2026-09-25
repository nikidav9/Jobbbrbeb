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
export async function ensureResumeForApply(): Promise<boolean> {
  const hasResume = (await dbGetResumeFiles()).some(file => file.selected && !!file.storagePath);
  if (hasResume) return true;

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
