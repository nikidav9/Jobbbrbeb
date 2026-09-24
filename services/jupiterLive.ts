import { Alert, Platform } from 'react-native';
import { jupiterLiveStatus, jupiterSetLive, jupiterMailbox } from '@/services/db';

export async function requestJupiterLive(userId: string): Promise<boolean> {
  const mailbox = await jupiterMailbox(userId);
  if (!mailbox.ready || !mailbox.address) {
    throw new Error('Почта JobToo ещё не принимает письма. Отправка внешних откликов будет доступна после подключения.');
  }
  if (await jupiterLiveStatus(userId)) return true;

  const message = `Юпитер будет отправлять отклики от вашего имени на сайты работодателей, передавая им контакты, данные анкеты и выбранное резюме. Для ответов будет указан адрес ${mailbox.address}; письма появятся в «Почте JobToo». Код, капчу и отдельное согласие нужно пройти самостоятельно. Включить отправку?`;
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
