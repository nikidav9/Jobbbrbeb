import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { dbGetResumeFiles } from '@/services/db';

/**
 * Решение владельца 25.09.2026: откликаться можно только с загруженным
 * резюме — и на карьерные вакансии, и на свои. Общая проверка для обоих
 * путей отклика (feed.tsx, perm-vacancy-detail.tsx), чтобы текст диалога и
 * переход в профиль не разъехались между ними.
 *
 * С 27.09.2026 (решение владельца, как у getmatch) у нового соискателя после
 * «почта → код → лента» нет ещё и имени — резюме не единственное условие.
 * Открытие окна «Чтобы откликнуться, создайте профиль за минуту» регистрирует
 * `ProfileGateHost` (`app/_layout.tsx`, внутри AppProvider): только там
 * известен текущий пользователь. Сигнатура `ensureResumeForApply` не
 * меняется — вызывающие места (feed.tsx, perm-vacancy-detail.tsx) её не
 * трогают.
 */
type GateOpener = (hasResume: boolean) => Promise<boolean>;
let gateOpener: GateOpener | null = null;

/** Регистрирует/снимает открыватель окна. Вызывает только ProfileGateHost. */
export function registerProfileGateOpener(opener: GateOpener | null) {
  gateOpener = opener;
}

/**
 * Возвращает true, если у человека выбрано резюме с сохранённым PDF и
 * заполнено имя. Иначе открывает окно (или, если хост не смонтирован, —
 * запасной confirm/Alert с переходом в «Профиль → Файлы») и возвращает
 * false, если человек не довёл дело до конца.
 */
export async function ensureResumeForApply(): Promise<boolean> {
  const hasResume = (await dbGetResumeFiles()).some(file => file.selected && !!file.storagePath);
  if (gateOpener) return gateOpener(hasResume);
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
