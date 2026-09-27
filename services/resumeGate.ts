import { router } from 'expo-router';
import { dbGetResumeFiles } from '@/services/db';
import { confirmAsync } from '@/services/confirm';

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

// Удачная проверка живёт 10 минут: иначе каждый свайп вправо ждал запроса
// к серверу, и колода замирала после каждого отклика. Запоминаем только
// «резюме есть» — отказ переспрашивается, чтобы загрузка сразу засчиталась.
// Профиль сбрасывает память сам, когда резюме удаляют или меняют.
const RESUME_OK_TTL = 10 * 60 * 1000;
let resumeOkUntil = 0;

export function forgetResumeCheck(): void {
  resumeOkUntil = 0;
}

/**
 * Возвращает true, если у человека выбрано резюме с сохранённым PDF и
 * заполнено имя. Иначе открывает окно (или, если хост не смонтирован, —
 * запасной confirm/Alert с переходом в «Профиль → Файлы») и возвращает
 * false, если человек не довёл дело до конца.
 */
export async function ensureResumeForApply(): Promise<boolean> {
  if (Date.now() < resumeOkUntil) return true;
  const hasResume = (await dbGetResumeFiles()).some(file => file.selected && !!file.storagePath);
  if (gateOpener) {
    const ok = await gateOpener(hasResume);
    // Запоминаем только полный успех: резюме было и окно не понадобилось
    // или человек довёл его до конца.
    if (ok && hasResume) resumeOkUntil = Date.now() + RESUME_OK_TTL;
    return ok;
  }
  if (hasResume) {
    resumeOkUntil = Date.now() + RESUME_OK_TTL;
    return true;
  }

  const prompt = 'Откликаться можно только с резюме. Загрузите PDF в профиль — это займёт минуту. Перейти к загрузке?';
  const openFiles = await confirmAsync({
    title: 'Нужно резюме', body: prompt, confirmLabel: 'Загрузить', cancelLabel: 'Позже',
  });
  if (openFiles) router.push({ pathname: '/(tabs)/profile', params: { tab: 'files' } });
  return false;
}
