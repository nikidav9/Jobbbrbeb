import { Alert, Platform } from 'react-native';
import { jupiterLiveState, jupiterSetLive, jupiterMailbox } from '@/services/db';

/**
 * Поручение на автоотклик включается принятием документов (решение
 * владельца, см. CLAUDE.md и Соглашение раздел 8) — отдельного диалога при
 * первом свайпе больше нет. Здесь только то, что документами не покрыто:
 * почта должна быть готова, а отозванное поручение переспрашивается явно.
 */
export async function requestJupiterLive(userId: string): Promise<boolean> {
  const mailbox = await jupiterMailbox(userId);
  if (!mailbox.ready || !mailbox.address) {
    throw new Error('Почта JobToo ещё не принимает письма. Отправка внешних откликов будет доступна после подключения.');
  }
  const state = await jupiterLiveState(userId);
  if (state.enabled) return true;

  if (state.revoked) {
    const message = 'Автоотклик Юпитера выключен в настройках. Включить снова?';
    const approved = Platform.OS === 'web'
      ? typeof window !== 'undefined' && window.confirm(message)
      : await new Promise<boolean>(resolve => Alert.alert('Автоотклик Юпитера', message, [
          { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Включить', onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) }));
    if (!approved) return false;
    await jupiterSetLive(userId, true);
    return true;
  }

  await jupiterSetLive(userId, true);
  return true;
}
