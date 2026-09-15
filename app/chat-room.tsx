
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Application from 'expo-application';
import {
  useAudioRecorder, useAudioRecorderState, useAudioPlayer,
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { ReadTicks, isSeenByOther } from '@/components/ReadTicks';
import { useApp } from '@/hooks/useApp';
import { Message, Chat } from '@/constants/types';
import { nameColorFromString, getInitials, formatDate } from '@/services/storage';
import { dbGetMessages, dbInsertMessage, dbMarkRead, dbGetLikeByVacancyWorker, dbUpsertLike, dbCheckAndCreateMatch, dbGetChatById, dbGetUserById, dbSetPermApplicationStatus, dbUploadChatMedia } from '@/services/db';
import { setActiveChat } from '@/services/notifications';
import { useIsFocused } from '@react-navigation/native';
import { getSupabaseClient } from '@/template';
import { getChatSuggestions } from '@/constants/chatSuggestions';
import { isOnline, lastSeenLabel } from '@/services/presence';
import { IMG_PREFIX, VOICE_PREFIX, isImageMessage, imageUrlOf,
  isVoiceMessage, voiceOf } from '@/services/messagePreview';
import { useSignedMedia } from '@/hooks/useSignedMedia';
import { WebVoiceRecording, webVoiceSupported, type VoiceClip } from '@/services/webVoice';

import { rs, rf } from '@/constants/scale';

const POLL_INTERVAL = 8000;

// Отступ под строкой ввода считаем ОДИН раз при загрузке модуля и больше не
// пересчитываем. useSafeAreaInsets() на Android отдаёт нули на первых кадрах
// и уточняется после первого показа клавиатуры — из-за этого поле сначала
// липло к краю, а потом подскакивало. Здесь значение постоянное, поэтому
// строка всегда стоит на одном месте.
const BAR_PAD_BOTTOM = Math.max(initialWindowMetrics?.insets.bottom ?? 0, 16);

/** Пузырь голосового: кнопка воспроизведения, дорожка и длительность. */
/**
 * Фотография из переписки.
 *
 * Ссылку получаем перед показом: файлы чатов лежат в закрытом бакете, и
 * прямого адреса у них нет. Пока подпись не пришла — пустой прямоугольник
 * того же размера, чтобы список не дёргался, когда картинка появится.
 */
function ChatImage({ path }: { path: string }) {
  const uri = useSignedMedia(path);
  if (!uri) return <View style={[styles.msgImage, { backgroundColor: Colors.divider }]} />;
  return (
    <Image source={{ uri }} style={styles.msgImage} contentFit="cover" transition={150} />
  );
}

function VoiceBubble({ url, sec, isMe }: { url: string; sec: number; isMe: boolean }) {
  const player = useAudioPlayer({ uri: url });
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    // На айфоне с выключенным звонком звук по умолчанию не идёт вообще:
    // плеер честно «играет» в тишину. Разрешение выдаётся на весь сеанс
    // работы со звуком, но ставим его прямо перед пуском — запись его
    // сбрасывает, а порядок «записал, потом слушаю» самый обычный.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    if (player.playing) { player.pause(); setPlaying(false); }
    else { player.play(); setPlaying(true); }
  };

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (st: any) => {
      // Конец записи. Раньше здесь только перематывали в начало, но плеер не
      // останавливали — он оставался в состоянии «играет», и следующий же
      // отчёт возвращал значок на паузу. Со стороны выглядело так, будто
      // голосовое доиграло, а кнопка об этом не знает.
      //
      // На didJustFinish одного не полагаемся: он приходит не на всех
      // прошивках, поэтому конец распознаём ещё и по времени. Дополнительное
      // условие «плеер считает, что играет» нужно, чтобы не перематывать
      // запись, которую человек сам поставил на паузу у самого конца.
      const atEnd = st?.duration > 0 && st.currentTime >= st.duration - 0.05;
      if (st?.didJustFinish || (atEnd && st?.playing)) {
        try { player.pause(); } catch {}
        try { player.seekTo(0); } catch {}
        setPlaying(false);
        return;
      }
      setPlaying(!!st?.playing);
    });
    return () => sub.remove();
  }, [player]);

  const tint = isMe ? '#fff' : Colors.primary;
  return (
    <View style={vb.row}>
      <TouchableOpacity onPress={toggle} activeOpacity={0.7}
        style={[vb.playBtn, { backgroundColor: isMe ? 'rgba(255,255,255,0.22)' : Colors.primaryLight }]}>
        <Ionicons name={playing ? 'pause' : 'play'} size={16} color={tint} />
      </TouchableOpacity>
      <View style={vb.waveWrap}>
        {[10, 16, 8, 20, 13, 18, 9, 15, 11, 19, 7, 14].map((h, i) => (
          <View key={i} style={[vb.bar, { height: h, backgroundColor: isMe ? 'rgba(255,255,255,0.55)' : Colors.inputBorder }]} />
        ))}
      </View>
      <Text style={[vb.dur, { color: isMe ? 'rgba(255,255,255,0.85)' : Colors.textMuted }]}>
        {fmtDuration(sec)}
      </Text>
    </View>
  );
}

const vb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: rs(8), minWidth: rs(168) },
  playBtn: { width: rs(32), height: rs(32), borderRadius: rs(16), alignItems: 'center', justifyContent: 'center' },
  waveWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: rs(3), height: rs(22) },
  bar: { width: rs(2.5), borderRadius: rs(2) },
  dur: { fontSize: rf(11), fontWeight: '600' },
});

// Поле ввода растёт вместе с текстом, но не выше этого — дальше текст
// прокручивается внутри, как в Telegram.
const INPUT_MIN_H = 22;
const INPUT_MAX_H = 108;

// Метки фото и голосовых живут в services/messagePreview.ts: их разбирает
// не только этот экран, но и список чатов, и дашборд.
const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня','июля',
  'августа','сентября','октября','ноября','декабря'];

/** Ключ дня — по нему решаем, нужен ли разделитель между сообщениями */
const dayKey = (ts: string) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** «Сегодня» / «Вчера» / «24 июля» — как в мессенджерах */
const dayLabel = (ts: string) => {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  const base = `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
};

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Системные сообщения раньше начинались с эмодзи прямо в тексте. Текст лежит
// в базе, старые записи не переписать — поэтому эмодзи срезаем при показе,
// а роль сообщения показываем иконкой.
const EMOJI_HEAD = /^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\s]+/u;
export const stripLeadingEmoji = (t: string) => t.replace(EMOJI_HEAD, '').trimStart();

const fmtDuration = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// Запись микрофона требует разрешения, которое нельзя добавить через OTA:
// на Android оно уже есть (его объявляет сам модуль expo-audio), а на iOS
// ключ NSMicrophoneUsageDescription появится только в следующей сборке.
// Поэтому на iOS кнопку показываем начиная с этой сборки.
const VOICE_IOS_MIN_BUILD = 6;
const voiceSupported = (() => {
  if (Platform.OS === 'android') return true;
  if (Platform.OS === 'web') return webVoiceSupported;
  if (Platform.OS !== 'ios') return false;
  const b = Number(Application.nativeBuildVersion ?? 0);
  return b >= VOICE_IOS_MIN_BUILD;
})();

const IS_WEB = Platform.OS === 'web';

// Module-level message cache — survives navigation but cleared on app restart
const msgCache = new Map<string, Message[]>();

export default function ChatRoom() {
  const router = useRouter();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const {
    currentUser, users, chats, vacancies, refreshChats, refreshLikes, likes,
    optimisticUpdateLike, showToast, permVacancies, permApplications, refreshPermApplications,
  } = useApp();

  // Track whether this chat screen is currently visible — used to suppress
  // push notifications when the user is already reading the conversation.
  const isFocused = useIsFocused();

  // Пока эта переписка открыта, уведомления о сообщениях именно в ней не
  // показываем: человек и так видит их в списке. Отметку снимаем при уходе с
  // экрана — иначе чат остался бы «открытым» и заглушил бы себя навсегда.
  useEffect(() => {
    setActiveChat(isFocused && chatId ? chatId : null);
    return () => setActiveChat(null);
  }, [isFocused, chatId]);

  const chatRef = useRef(chats.find(c => c.id === chatId));
  const foundChat = chats.find(c => c.id === chatId);
  if (foundChat) chatRef.current = foundChat;
  const [dbChat, setDbChat] = useState<Chat | null>(null);
  const [loadingDbChat, setLoadingDbChat] = useState(!foundChat && !!chatId);
  const [dbChatLoadFailed, setDbChatLoadFailed] = useState(false);
  const [dbChatRetry, setDbChatRetry] = useState(0);
  const chat = foundChat ?? chatRef.current ?? dbChat;

  // Declare state/refs before effects that reference them
  const hasCachedRef = useRef(chatId ? msgCache.has(chatId) : false);
  const cached = chatId ? (msgCache.get(chatId) ?? chat?.messages ?? []) : (chat?.messages ?? []);
  const [messages, setMessages] = useState<Message[]>(cached);
  const [loadingMessages, setLoadingMessages] = useState(!hasCachedRef.current && !!chatId);
  const [messageLoadFailed, setMessageLoadFailed] = useState(false);
  const [messageRetry, setMessageRetry] = useState(0);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [inputH, setInputH] = useState(INPUT_MIN_H);
  const inputRef = useRef<TextInput>(null);
  // Клавиатура открыта — прижимаем строку к ней; закрыта — держим постоянный
  // отступ от края экрана. Слушатель клавиатуры надёжнее, чем отступы,
  // которые на Android доезжают с задержкой.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvt, () => setKbOpen(true));
    const s2 = Keyboard.addListener(hideEvt, () => setKbOpen(false));
    return () => { s1.remove(); s2.remove(); };
  }, []);
  const barPad = kbOpen ? 8 : BAR_PAD_BOTTOM;

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Обновляем состояние записи раз в 200 мс — этого хватает для счётчика
  const recorderState = useAudioRecorderState(recorder, 200);

  // В браузере пишем своим модулем, а не expo-audio, — почему, написано
  // в services/webVoice.ts. Счётчик тикает здесь, тоже раз в 200 мс.
  const webRec = useRef<WebVoiceRecording | null>(null);
  const [webRecMs, setWebRecMs] = useState<number | null>(null);
  useEffect(() => {
    if (webRecMs === null) return;
    const id = setInterval(() => {
      if (webRec.current) setWebRecMs(webRec.current.elapsed());
    }, 200);
    return () => clearInterval(id);
  }, [webRecMs === null]);

  // Ушли с экрана посреди записи — отпускаем микрофон. Иначе в браузере
  // остаётся гореть значок записи, и человек думает, что его ещё слушают.
  useEffect(() => () => { webRec.current?.cancel(); webRec.current = null; }, []);

  // Дальше по экрану всё равно, кто именно пишет
  const isRecording = IS_WEB ? webRecMs !== null : recorderState.isRecording;
  const recordingMs = IS_WEB ? (webRecMs ?? 0) : recorderState.durationMillis;
  const [decidingLike, setDecidingLike] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [likeStatus, setLikeStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const lastCountRef = useRef(cached.length);
  // Перечитать чат по сигналу от сервера. Хранится ссылкой, чтобы подписка
  // не пересоздавалась на каждый перерисованный кадр.
  const pollRef = useRef<() => void>(() => {});

  // If chat is not in context (freshly created, or navigated from push notification),
  // fetch it directly from DB so the chat room is fully functional immediately.
  useEffect(() => {
    if (!chatId || foundChat) { setLoadingDbChat(false); return; }
    let isMounted = true;
    setLoadingDbChat(true);
    setDbChatLoadFailed(false);
    dbGetChatById(chatId).then(c => {
      if (!isMounted || !c) return;
      if (c.workerId !== currentUser?.id && c.employerId !== currentUser?.id) {
        router.back();
        return;
      }
      setDbChat(c);
      setMessages(c.messages);
      lastCountRef.current = c.messages.length;
    }).catch(() => {
      if (isMounted) setDbChatLoadFailed(true);
    }).finally(() => {
      if (isMounted) setLoadingDbChat(false);
    });
    return () => { isMounted = false; };
  }, [chatId, dbChatRetry]);

  // Clear dbChat once context has the chat (avoid stale fallback)
  useEffect(() => {
    if (foundChat) setDbChat(null);
  }, [foundChat?.id]);

  // Load all messages immediately on first open (context only has the last preview message)
  useEffect(() => {
    if (!chatId || hasCachedRef.current) return;
    let mounted = true;
    setLoadingMessages(true);
    setMessageLoadFailed(false);
    dbGetMessages(chatId).then(msgs => {
      if (!mounted) return;
      setMessages(msgs);
      msgCache.set(chatId, msgs);
      lastCountRef.current = msgs.length;
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }).catch(() => {
      // Keep preview/cache data if we have it. A transport error is not an
      // empty chat and must never replace already visible messages.
      if (mounted) setMessageLoadFailed(true);
    }).finally(() => { if (mounted) setLoadingMessages(false); });
    return () => { mounted = false; };
  }, [chatId, messageRetry]);

  const isEmployer = currentUser?.role === 'employer';
  // Чат без вакансии. Такие остались от удалённого раздела «Биржа» — их два.
  // Решать по кандидату в них нечего, поэтому панель решений не показываем и
  // за статусом отклика не ходим: вакансии, к которой он относится, просто нет.
  const isChatWithoutVacancy = !!chat?.bulletinId || !!chat?.workerSlotId;

  const otherId = chat
    ? (currentUser?.role === 'worker' ? chat.employerId : chat.workerId)
    : '';
  const contextOther = users.find(u => u.id === otherId);
  const [fetchedOther, setFetchedOther] = useState<import('@/constants/types').User | null>(null);
  // Своя загрузка идёт первой: та, что из общего списка, почти всегда устарела.
  const other = fetchedOther ?? contextOther;

  // Собеседника перечитываем сами, раз в минуту.
  //
  // Из общего списка users брать нельзя: он загружается один раз при запуске,
  // а дальше обновляется только подпиской rt_users — а она работает через
  // postgres_changes и молчит с тех пор, как базу закрыли (по той же причине
  // сообщения переводили на broadcast). Из-за этого в шапке висела отметка
  // «был(а)» на момент открытия приложения: человек пишет прямо сейчас, а над
  // перепиской значилось утро.
  //
  // Класть refreshUsers в общий опрос нельзя — он тянет таблицу пользователей
  // целиком. Здесь же нужен ровно один человек, и только пока чат открыт.
  useEffect(() => {
    if (!otherId) return;
    let alive = true;
    const load = () => {
      dbGetUserById(otherId).then(u => { if (alive && u) setFetchedOther(u); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [otherId]);

  const vacancy = vacancies.find(v => v.id === chat?.vacancyId);
  // Пока собеседник не загрузился, здесь подставлялось название компании. Для
  // работника это ещё сходило за правду, а работодателю казалось, что он
  // переписывается с «Лавкой» вместо человека. Лучше пустая строка, чем чужое имя.
  const otherName = other
    ? `${other.firstName} ${other.lastName}`.trim()
    : (isEmployer ? '' : (chat?.companyName ?? ''));
  const otherColor = nameColorFromString(otherId || otherName);
  // Пересчитываем раз в минуту, иначе «5 мин назад» застывает на экране
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPresenceTick(x => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const online = useMemo(() => isOnline(other?.lastSeenAt), [other?.lastSeenAt, presenceTick]);
  const presence = useMemo(() => lastSeenLabel(other?.lastSeenAt), [other?.lastSeenAt, presenceTick]);
  const otherAvatarUrl = other?.avatarUrl;

  // Чат по постоянной вакансии живёт на другой механике: там не лайки,
  // а отклик в jm_perm_applications. Решение «подходит/не подходит» должно
  // менять именно его — через лайки оно молча падало, и кнопка ничего не делала.
  const permVacancy = (permVacancies ?? []).find((v: any) => v.id === chat?.vacancyId) ?? null;
  const permApp = permVacancy
    ? (permApplications ?? []).find((a: any) => a.vacancyId === chat?.vacancyId && a.workerId === chat?.workerId) ?? null
    : null;

  // В общем чате с одним человеком решений может ждать сразу несколько: он мог
  // откликнуться на две смены подряд. Панель умеет только одно — последнее, по
  // нему чат и настроен. Если ждут ещё, кнопки прятать нельзя (иначе решение
  // не принять вовсе), но и молчать об остальных тоже: легко одобрить не ту
  // смену. Поэтому под кнопками появляется строка со счётчиком.
  const otherPending = useMemo(() => {
    if (!isEmployer || !chat) return 0;
    const fromLikes = (likes ?? []).filter((l: any) =>
      l.employerId === chat.employerId && l.workerId === chat.workerId &&
      l.workerLiked && l.employerLiked == null && l.vacancyId !== chat.vacancyId,
    ).length;
    const fromPerm = (permApplications ?? []).filter((a: any) =>
      a.employerId === chat.employerId && a.workerId === chat.workerId &&
      a.status === 'pending' && a.vacancyId !== chat.vacancyId,
    ).length;
    return fromLikes + fromPerm;
  }, [isEmployer, chat?.employerId, chat?.workerId, chat?.vacancyId, likes, permApplications]);

  // Статус отклика для панели решений. У чатов без вакансии его нет.
  useEffect(() => {
    if (!chat || !currentUser) return;
    if (chat.bulletinId || chat.workerSlotId) { setLikeStatus(null); return; }
    // Постоянная вакансия — статус берём из отклика, а не из лайков
    if (permVacancy) {
      // hired — тоже решённый: иначе после «Завершить» чат снова предложил бы
      // выбрать «Подходит / Не подходит» по уже закрытому кандидату.
      setLikeStatus(permApp
        ? (permApp.status === 'approved' || permApp.status === 'hired' ? 'approved'
          : permApp.status === 'rejected' ? 'rejected' : 'pending')
        : null);
      return;
    }
    // Один отклик спрашиваем по одному отклику. Раньше здесь выкачивались ВСЕ
    // отклики сервиса, чтобы найти в них этот: dbGetLikeByVacancyWorker была
    // доступна только самому работнику, и экран обходил отказ мягким путём.
    // Теперь операция отвечает обеим сторонам смены, и обходить нечего.
    dbGetLikeByVacancyWorker(chat.vacancyId, chat.workerId).then(like => {
      if (!like) { setLikeStatus('pending'); return; }
      if (like.isMatch || like.employerLiked === true) setLikeStatus('approved');
      else if (like.employerLiked === false) setLikeStatus('rejected');
      else setLikeStatus('pending');
    }).catch(() => {});
  }, [chat?.id, currentUser?.id, permVacancy?.id, permApp?.status]);

  // Mark as read on mount
  useEffect(() => {
    if (!chat || !currentUser) return;
    dbMarkRead(chat.id, currentUser.role).catch(() => {});
    refreshChats().catch(() => {});
  }, [chat?.id]);

  // Polling for new messages
  useEffect(() => {
    if (!chat?.id || !currentUser) return;
    const localChatId = chat.id;
    const userId = currentUser.id;
    const role = currentUser.role;

    const poll = async () => {
      try {
        const [msgs, like] = await Promise.all([
          dbGetMessages(localChatId),
          (chat.bulletinId || chat.workerSlotId) ? Promise.resolve(null) : dbGetLikeByVacancyWorker(chat.vacancyId, chat.workerId),
        ]);
        if (msgs.length !== lastCountRef.current) {
          msgCache.set(localChatId, msgs);
          setMessages(msgs);
          const newMsgs = msgs.slice(lastCountRef.current);
          const fromOther = newMsgs.filter(m => m.senderId !== userId && m.senderId !== 'system');
          if (fromOther.length > 0) {
            dbMarkRead(localChatId, role).catch(() => {});
            refreshChats().catch(() => {});
          }
          lastCountRef.current = msgs.length;
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        }
        if (like) {
          if (like.isMatch || like.employerLiked === true) setLikeStatus('approved');
          else if (like.employerLiked === false) setLikeStatus('rejected');
          else setLikeStatus('pending');
        }
      } catch (e) {
        console.warn('[ChatRoom] poll error', e);
      }
    };

    // Опрос — подстраховка на случай, если сигнал не дошёл. Обычно новое
    // сообщение приходит раньше, по сигналу от сервера (см. ниже).
    pollRef.current = poll;
    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [chat?.id]);

  // Сигнал о новом сообщении.
  //
  // Раньше здесь было две подписки — на таблицу сообщений и на таблицу
  // откликов. Обе читали базу напрямую и после закрытия доступа замолчали бы.
  // Теперь сервер, записав сообщение, шлёт в канал чата короткое «обнови»
  // без текста, а мы в ответ разом перечитываем и сообщения, и статус
  // отклика — тем же запросом, что и при обычном опросе.
  //
  // Решения «подходит / не подходит» тоже пишут в чат системное сообщение,
  // поэтому статус отклика обновляется сразу же, отдельная подписка не нужна.
  useEffect(() => {
    if (!chatId || !currentUser) return;
    const sb = getSupabaseClient();
    const channel = sb
      .channel(`chat:${chatId}`)
      .on('broadcast', { event: 'refresh' }, () => { pollRef.current(); })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [chatId, currentUser?.id]);

  // Scroll to bottom when messages load
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 150);
    }
  }, [messages.length]);

  // Employer: approve candidate
  const handleApprove = async () => {
    if (!chat || !currentUser || !isEmployer) return;
    setDecidingLike(true);
    try {
      const workerId = chat.workerId;
      const vacId = chat.vacancyId;

      if (permVacancy) {
        if (!permApp) { showToast('Отклик не найден', 'error'); return; }
        await dbSetPermApplicationStatus(permApp.id, 'approved');
        setLikeStatus('approved');
        // Строку и уведомление пишет СЕРВЕР тем же запросом, что меняет
        // статус (jt_perm_app_announce). Отсюда они уходили «выстрелил и
        // забыл», а сообщение от имени «system» приложению вообще запрещено —
        // сервер отвечал 403, и отказ гасился пустым .catch().
        //
        // Свой текст здесь больше не рисуем: он жил бы вторым местом и
        // разъехался бы с серверным. Вместо этого сразу перечитываем
        // переписку — тем же опросом, что и обычно.
        pollRef.current?.();
        refreshPermApplications?.().catch(() => {});
        refreshChats().catch(() => {});
        return;
      }

      await dbUpsertLike(vacId, workerId, currentUser.id, { employerLiked: true });
      const result = await dbCheckAndCreateMatch(vacId, workerId);
      setLikeStatus('approved');
      if (result.matched) {
        // Сервер уже записал обе системные строки. Перечитываем их, чтобы
        // экран не показывал временную клиентскую редакцию того же события.
        pollRef.current?.();
        const existingLike = likes.find(l => l.vacancyId === vacId && l.workerId === workerId);
        if (existingLike) optimisticUpdateLike({ ...existingLike, isMatch: true, employerLiked: true });
      }
      refreshLikes().catch(() => {});
      refreshChats().catch(() => {});
    } catch (e) {
      console.error('[ChatRoom] handleApprove error', e);
      showToast('Не удалось сохранить решение. Попробуйте ещё раз', 'error');
    } finally {
      setDecidingLike(false);
    }
  };

  // Employer: reject candidate (called after confirmation)
  const handleRejectConfirmed = async () => {
    if (!chat || !currentUser || !isEmployer) return;
    setShowRejectConfirm(false);
    setDecidingLike(true);
    try {
      const workerId = chat.workerId;
      const vacId = chat.vacancyId;
      // Текст строки об отказе — на сервере, и только там. Здесь его
      // дорисовывали на месте, и он же уходил записью от имени «system»,
      // которую сервер отвергал: директор видел одно, соискатель — ничего.
      setLikeStatus('rejected');

      if (permVacancy) {
        if (permApp) {
          // Строку в чат, счётчик непрочитанного и уведомление ставит сервер
          // в этом же запросе — см. jt_perm_app_announce в php-proxy/db.php.
          await dbSetPermApplicationStatus(permApp.id, 'rejected');
          refreshPermApplications?.().catch(() => {});
        }
        pollRef.current?.();
        refreshChats().catch(() => {});
        return;
      }

      // Строку в переписку и счётчик непрочитанного ставит СЕРВЕР тем же
      // запросом. Отсюда строка не доходила никогда: писать от имени «system»
      // приложению запрещено, сервер отвечал 403, и отказ гасился пустым
      // .catch(). Счётчик при этом рос — значок был, а за ним пусто.
      await dbUpsertLike(vacId, workerId, currentUser.id, { employerLiked: false });
      pollRef.current?.();
      refreshChats().catch(() => {});
    } catch (e) {
      console.error('[ChatRoom] handleRejectConfirmed error', e);
      showToast('Не удалось сохранить решение. Попробуйте ещё раз', 'error');
      setLikeStatus('pending');
    } finally {
      setDecidingLike(false);
    }
  };

  // Переписка закрыта: отклик отклонён либо чат достался от удалённого раздела
  const isChatBlocked = likeStatus === 'rejected' || (chat?.isLocked ?? false);

  // Готовые фразы показываем, пока человек ещё ничего не написал в этот чат
  // и не начал печатать своё: дальше они только мешают.
  const suggestions = getChatSuggestions(isEmployer ? 'employer' : 'worker', vacancy);
  const iAlreadyWrote = messages.some(m => m.senderId === currentUser?.id);
  const showSuggestions =
    suggestions.length > 0 && !iAlreadyWrote && !input.trim() &&
    !messageLoadFailed && !isChatBlocked && !isRecording;

  // ── Отправка фото ────────────────────────────────────────────────────────
  const base64ToUint8Array = (base64: string): Uint8Array => {
    const bin = globalThis.atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  };

  /**
   * Содержимое файла по ссылке, которую дал выбор фото.
   *
   * На телефоне это путь к файлу, и читает его expo-file-system. В браузере
   * тот же модуль — пустая заглушка без единого метода, а ссылка выглядит как
   * blob:, поэтому содержимое забираем обычным запросом. Раньше здесь звали
   * expo-file-system всегда, и на вебе отправка фото падала.
   */
  const uriToBytes = async (uri: string): Promise<Uint8Array> => {
    if (IS_WEB) {
      const resp = await fetch(uri);
      return new Uint8Array(await (await resp.blob()).arrayBuffer());
    }
    const base64Data = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64ToUint8Array(base64Data);
  };

  const sendImage = async (uri: string) => {
    if (!chat || !currentUser || uploadingImage) return;
    setUploadingImage(true);
    try {
      // Сжимаем перед отправкой — иначе фото с камеры весит несколько мегабайт
      const processed = await ImageManipulator.manipulateAsync(
        uri, [{ resize: { width: 1280 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      const bytes = await uriToBytes(processed.uri);
      // Имя без косых внутри: закрытый бакет принимает только chat/<файл>.
      const fileName = `chat/${chat.id}_${Date.now()}.jpg`;
      // Через прокси, а не ключом из сборки: см. dbUploadChatMedia в services/db.ts.
      // Не залилось — бросает, и сообщение не уходит: иначе собеседник получит
      // ссылку в никуда, и оба будут думать, что фото отправлено.
      // В закрытый бакет, и в сообщение кладём путь, а не ссылку: ссылка
      // теперь временная и выдаётся перед показом. Раньше сюда попадал
      // вечный публичный адрес, открытый кому угодно.
      const path = await dbUploadChatMedia(fileName, bytes, 'image/jpeg');

      const msg = await dbInsertMessage(chat.id, currentUser.id, IMG_PREFIX + path);
      setMessages(prev => {
        const next = [...prev, msg];
        msgCache.set(chat.id, next);
        return next;
      });
      lastCountRef.current += 1;
      // Уведомление второй стороне шлёт СЕРВЕР при записи сообщения
      // (jt_notify_new_message). Отсюда оно уходило «выстрелил и забыл», а
      // заодно текст уведомления приходил с клиента — то есть через нашего
      // бота можно было послать что угодно тому, с кем есть переписка.
      refreshChats().catch(() => {});
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      console.error('[ChatRoom] sendImage error', e);
      showToast('Не удалось отправить фото', 'error');
    } finally {
      setUploadingImage(false);
    }
  };

  // ── Голосовые сообщения ──────────────────────────────────────────────────
  const startRecording = async () => {
    if (isChatBlocked || uploadingVoice) return;
    try {
      if (IS_WEB) {
        // Разрешение здесь спрашивать нечем: браузер показывает свой запрос
        // сам, когда мы просим микрофон, и отказ приходит ошибкой.
        webRec.current = await WebVoiceRecording.start();
        setWebRecMs(0);
        return;
      }
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) { showToast('Нет доступа к микрофону', 'error'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      console.error('[ChatRoom] startRecording error', e);
      showToast(IS_WEB ? 'Нет доступа к микрофону' : 'Не удалось начать запись', 'error');
      webRec.current = null;
      setWebRecMs(null);
    }
  };

  const cancelRecording = async () => {
    if (IS_WEB) {
      webRec.current?.cancel();
      webRec.current = null;
      setWebRecMs(null);
      return;
    }
    try { await recorder.stop(); } catch {}
    // playsInSilentMode оставляем включённым: без него следующее же
    // прослушивание на айфоне с выключенным звонком уйдёт в тишину.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  };

  const stopAndSendVoice = async () => {
    if (!chat || !currentUser) return;

    // Запись останавливаем одинаково по смыслу, но забираем разное: в браузере
    // сразу байты, на телефоне — путь к файлу, который потом читаем.
    let clip: VoiceClip | null = null;
    let seconds = Math.max(1, Math.round(recordingMs / 1000));

    if (IS_WEB) {
      const rec = webRec.current;
      webRec.current = null;
      setWebRecMs(null);
      if (!rec) return;
      try {
        clip = await rec.stop();
        seconds = clip.seconds;
      } catch (e) {
        console.error('[ChatRoom] web stop recording error', e);
        showToast('Не удалось отправить голосовое', 'error');
        return;
      }
    } else {
      try {
        await recorder.stop();
        // playsInSilentMode оставляем включённым: без него следующее же
        // прослушивание на айфоне с выключенным звонком уйдёт в тишину.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      } catch (e) {
        console.error('[ChatRoom] stop recording error', e);
        return;
      }
      const uri = recorder.uri;
      if (!uri) return;
      try {
        const base64Data = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        clip = {
          bytes: base64ToUint8Array(base64Data),
          // audio/mp4, а не audio/m4a: файл — это AAC внутри контейнера mp4,
          // а «audio/m4a» вообще не зарегистрированный тип, и часть плееров
          // на него спотыкается.
          contentType: 'audio/mp4', ext: 'm4a', seconds,
        };
      } catch (e) {
        console.error('[ChatRoom] read recording error', e);
        showToast('Не удалось отправить голосовое', 'error');
        return;
      }
    }

    setUploadingVoice(true);
    try {
      const fileName = `chat/voice_${chat.id}_${Date.now()}.${clip.ext}`;
      // Через прокси, а не ключом из сборки: см. dbUploadChatMedia в services/db.ts.
      //
      // Раньше при неудаче здесь стоял console.warn и отправка шла дальше.
      // Ссылку на несуществующий файл собеседник увидит обычным голосовым —
      // нажмёт, а там тишина, и ни он, ни отправитель не поймут, что запись
      // не дошла. Теперь неудача бросает, и сообщение не уходит.
      const path = await dbUploadChatMedia(fileName, clip.bytes, clip.contentType);

      const msg = await dbInsertMessage(
        chat.id, currentUser.id, `${VOICE_PREFIX}${path}|${seconds}`,
      );
      setMessages(prev => {
        const next = [...prev, msg];
        msgCache.set(chat.id, next);
        return next;
      });
      lastCountRef.current += 1;
      // Уведомление второй стороне шлёт СЕРВЕР при записи сообщения
      // (jt_notify_new_message). Отсюда оно уходило «выстрелил и забыл», а
      // заодно текст уведомления приходил с клиента — то есть через нашего
      // бота можно было послать что угодно тому, с кем есть переписка.
      refreshChats().catch(() => {});
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      console.error('[ChatRoom] sendVoice error', e);
      showToast('Не удалось отправить голосовое', 'error');
    } finally {
      setUploadingVoice(false);
    }
  };

  const pickImage = async () => {
    if (isChatBlocked || uploadingImage) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { showToast('Нет доступа к галерее', 'error'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });
      if (!res.canceled && res.assets?.[0]?.uri) await sendImage(res.assets[0].uri);
    } catch (e) {
      console.error('[ChatRoom] pickImage error', e);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending || !chat || !currentUser || isChatBlocked) return;
    setSending(true);
    setInput('');
    setInputH(INPUT_MIN_H);
    try {
      const msg = await dbInsertMessage(chat.id, currentUser.id, text);
      setMessages(prev => {
        const next = [...prev, msg];
        msgCache.set(chat.id, next);
        return next;
      });
      lastCountRef.current += 1;
      // Уведомление второй стороне шлёт СЕРВЕР при записи сообщения
      // (jt_notify_new_message). Отсюда оно уходило «выстрелил и забыл», а
      // заодно текст уведомления приходил с клиента — то есть через нашего
      // бота можно было послать что угодно тому, с кем есть переписка.
      refreshChats().catch(() => {});
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      console.error('[ChatRoom] sendMessage error', e);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  // All hooks declared above — safe to return early here
  if (!currentUser || !chat) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backIconBtn} activeOpacity={0.7}>
            <Text style={styles.backIconTxt}>‹</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(24), gap: rs(12) }}>
          {!currentUser || loadingDbChat ? (
            <ActivityIndicator size="large" color={Colors.primary} />
          ) : dbChatLoadFailed ? (
            <>
              <Text style={{ color: Colors.textPrimary, fontSize: rf(16), fontWeight: '700', textAlign: 'center' }}>
                Не удалось загрузить чат
              </Text>
              <Text style={{ color: Colors.textMuted, textAlign: 'center' }}>Проверьте связь и попробуйте ещё раз.</Text>
              <TouchableOpacity
                onPress={() => setDbChatRetry(x => x + 1)}
                style={{ backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={{ color: Colors.textMuted }}>Чат не найден</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    // Разделитель дня — перед первым сообщением и на каждой смене даты
    const prev = index > 0 ? messages[index - 1] : null;
    const showDay = item.timestamp
      && (!prev || !prev.timestamp || dayKey(prev.timestamp) !== dayKey(item.timestamp));
    const daySeparator = showDay ? (
      <View style={styles.daySep}>
        <Text style={styles.daySepTxt}>{dayLabel(item.timestamp)}</Text>
      </View>
    ) : null;

    if (item.senderId === 'system') {
      const body = stripLeadingEmoji(item.text);
      const isMatch = body.includes('мэтч') || body.includes('Мэтч');
      const isReject = body.includes('не подошли') || body.includes('закрыт');
      const isOk = body.includes('одобрен');
      const icon: IconName = isMatch ? 'sparkles'
        : isReject ? 'close-circle'
        : isOk ? 'checkmark-circle' : 'information-circle';
      const tint = isMatch ? Colors.green : isReject ? Colors.red : Colors.textSecondary;
      return (
        <>
        {daySeparator}
        <View style={[
          styles.systemMsg,
          isMatch && styles.systemMsgMatch,
          isReject && styles.systemMsgReject,
        ]}>
          <Ionicons name={icon} size={15} color={tint} style={{ marginTop: 1 }} />
          <Text style={[
            styles.systemText,
            isMatch && styles.systemTextMatch,
            isReject && styles.systemTextReject,
          ]}>{body}</Text>
        </View>
        </>
      );
    }
    // Safety advisory message (from system_safety sender)
    if (item.senderId === 'system_safety') {
      return (
        <>
        {daySeparator}
        <View style={styles.safetyMsg}>
          <View style={styles.safetyHeader}>
            <View style={styles.safetyIconWrap}>
              <Ionicons name="shield-checkmark" size={14} color="#92400E" />
            </View>
            <Text style={styles.safetyTitle}>Безопасность</Text>
          </View>
          <Text style={styles.safetyText}>{stripLeadingEmoji(item.text)}</Text>
        </View>
        </>
      );
    }
    const isMe = item.senderId === currentUser.id;
    return (
      <>
      {daySeparator}
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowThem]}>
        {!isMe ? (
          otherAvatarUrl ? (
            <Image
              source={{ uri: otherAvatarUrl }}
              style={styles.msgAvatar}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.msgAvatar, { backgroundColor: otherColor, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={styles.msgAvatarText}>{getInitials(otherName)}</Text>
            </View>
          )
        ) : null}
        <View style={[
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          isImageMessage(item.text) && styles.bubbleImage,
        ]}>
          {isVoiceMessage(item.text) ? (
            <VoiceBubble {...voiceOf(item.text)} isMe={isMe} />
          ) : isImageMessage(item.text) ? (
            <ChatImage path={imageUrlOf(item.text)} />
          ) : (
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.text}</Text>
          )}
          {isMe ? (
            <View style={styles.stampRow}>
              <Text style={[styles.timestamp, styles.timestampMe]}>{formatTime(item.timestamp)}</Text>
              <ReadTicks
                seen={isSeenByOther(chat, currentUser.role, item.timestamp)}
                onDark
              />
            </View>
          ) : (
            <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
          )}
        </View>
      </View>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Rejection confirmation modal */}
      {showRejectConfirm ? (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Отклонить кандидата?</Text>
            <Text style={styles.confirmBody}>
              После этого чат будет полностью заблокирован — вы и кандидат больше не сможете писать. Действие нельзя отменить.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setShowRejectConfirm(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmCancelTxt}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmRejectBtn}
                onPress={handleRejectConfirmed}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmRejectTxt}>Подтвердить отказ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* Employer decision bar — shown at the top */}
      {isEmployer && !isChatWithoutVacancy && likeStatus === 'pending' ? (
        <View style={styles.decisionBar}>
          <Text style={styles.decisionBarLabel} numberOfLines={2}>
            {chat.vacTitle ? `Решение по кандидату — «${chat.vacTitle}»:` : 'Принять решение по кандидату:'}
          </Text>
          <View style={styles.decisionBtnsRow}>
            <TouchableOpacity
              style={[styles.decisionBtn, styles.decisionBtnReject, decidingLike && { opacity: 0.5 }]}
              onPress={() => setShowRejectConfirm(true)}
              disabled={decidingLike}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={17} color={Colors.textSecondary} />
              <Text style={styles.decisionBtnRejectTxt}>Не подходит</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.decisionBtn, styles.decisionBtnAccept, decidingLike && { opacity: 0.5 }]}
              onPress={handleApprove}
              disabled={decidingLike}
              activeOpacity={0.8}
            >
              {decidingLike ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={17} color="#fff" />
                  <Text style={styles.decisionBtnAcceptTxt}>Подходит</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          {otherPending > 0 ? (
            <TouchableOpacity onPress={() => router.push('/(tabs)/matches')} activeOpacity={0.7}>
              <Text style={styles.decisionMoreTxt}>
                Ещё {otherPending} {otherPending === 1 ? 'отклик ждёт' : 'откликов ждут'} решения — во вкладке «Мэтчи» →
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : isEmployer && !isChatWithoutVacancy && likeStatus === 'approved' ? (
        <View style={[styles.decisionBar, { backgroundColor: '#D1FAE5' }]}>
          <View style={styles.decisionStatusRow}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.green} />
            <Text style={[styles.decisionBarLabel, { color: Colors.green }]}>Мэтч создан</Text>
          </View>
        </View>
      ) : isEmployer && !isChatWithoutVacancy && likeStatus === 'rejected' ? (
        <View style={[styles.decisionBar, { backgroundColor: '#FEE2E2' }]}>
          <View style={styles.decisionStatusRow}>
            <Ionicons name="close-circle" size={16} color={Colors.red} />
            <Text style={[styles.decisionBarLabel, { color: Colors.red }]}>Кандидат отклонён</Text>
          </View>
        </View>
      ) : null}

      {/* Blocked notice for both parties */}
      {isChatBlocked ? (
        <View style={styles.blockedBar}>
          <Text style={styles.blockedBarTxt}>
            {chat?.isLocked
              ? 'Объявление закрыто — работника уже нашли'
              : (isEmployer ? 'Чат закрыт — кандидат отклонён' : 'Чат закрыт — работодатель отклонил кандидатуру')}
          </Text>
        </View>
      ) : null}

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backIconBtn} activeOpacity={0.7}>
          <Text style={styles.backIconTxt}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          activeOpacity={0.8}
          onPress={() => otherId ? router.push({ pathname: '/user-profile', params: { userId: otherId } }) : null}
        >
          {otherAvatarUrl ? (
            <Image
              source={{ uri: otherAvatarUrl }}
              style={styles.headerAvatar}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={[styles.headerAvatar, { backgroundColor: otherColor, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={styles.headerAvatarText}>{getInitials(otherName)}</Text>
            </View>
          )}
          <View>
            <Text style={styles.headerName}>{otherName}</Text>
            {/* Под именем — присутствие, как в мессенджерах. Пока человек не
                в сети, на этом месте стоит компания. */}
            {presence ? (
              <View style={styles.presenceRow}>
                {online ? <View style={styles.onlineDot} /> : null}
                <Text style={[styles.headerSub, online && styles.headerSubOnline]} numberOfLines={1}>
                  {presence}
                </Text>
              </View>
            ) : (
              // Компания, а не должность: в общем чате смен может быть
              // несколько, и должность у человека меняется от смены к смене,
              // а компания — нет.
              <Text style={styles.headerSub} numberOfLines={1}>{chat.companyName}</Text>
            )}
          </View>
          <Text style={{ fontSize: rf(16), color: Colors.textMuted, marginLeft: 4 }}>›</Text>
        </TouchableOpacity>
        <View style={{ width: 70 }} />
      </View>

      {/* Полосы с вакансией здесь больше нет. Чат теперь один на пару людей, и
          смен в нём может быть несколько — одна строка в шапке говорила бы
          только про последнюю. Вместо неё каждый отклик открывается карточкой
          прямо в переписке, на своём месте по времени. */}

      {/* Messages + Input */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loadingMessages ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {messageLoadFailed ? (
              <View style={{ paddingHorizontal: rs(16), paddingVertical: rs(10), backgroundColor: Colors.surface, gap: rs(6) }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700', textAlign: 'center' }}>
                  {messages.length > 0 ? 'Не удалось обновить сообщения' : 'Не удалось загрузить сообщения'}
                </Text>
                <Text style={{ color: Colors.textMuted, textAlign: 'center', fontSize: rf(12) }}>
                  Уже показанные сообщения сохранены. Проверьте связь и повторите.
                </Text>
                <TouchableOpacity onPress={() => setMessageRetry(x => x + 1)} activeOpacity={0.8}>
                  <Text style={{ color: Colors.primary, fontWeight: '700', textAlign: 'center' }}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={m => m.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.msgList}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            />
          </View>
        )}

        {/* Подсказки: сразу после мэтча поле пустое и обе стороны молчат.
            Нажатие подставляет текст в поле, не отправляя его. Лента уходит,
            как только человек начал печатать или уже что-то написал в чат. */}
        {showSuggestions ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.suggestScroll}
            contentContainerStyle={styles.suggestRow}
          >
            {suggestions.map(sg => (
              <TouchableOpacity
                key={sg.id}
                style={styles.suggestChip}
                activeOpacity={0.8}
                onPress={() => { setInput(sg.text); inputRef.current?.focus(); }}
              >
                <Text style={styles.suggestChipTxt}>{sg.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {/* Идёт запись — строка ввода заменяется счётчиком */}
        {isRecording ? (
          <View style={[styles.inputBar, { paddingBottom: barPad }]}>
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={cancelRecording}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={21} color={Colors.red} />
            </TouchableOpacity>

            <View style={[styles.inputWrap, styles.recordWrap]}>
              <View style={styles.recDot} />
              <Text style={styles.recTime}>
                {fmtDuration(recordingMs / 1000)}
              </Text>
              <Text style={styles.recHint}>Идёт запись…</Text>
            </View>

            <TouchableOpacity style={styles.sendBtn} onPress={stopAndSendVoice} activeOpacity={0.8}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
        /* Input bar */
        <View style={[styles.inputBar, { paddingBottom: barPad }]}>
          {/* Вложение — слева, как в мессенджерах */}
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={pickImage}
            disabled={isChatBlocked || uploadingImage}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {uploadingImage
              ? <ActivityIndicator size="small" color={Colors.textMuted} />
              : <Ionicons name="add" size={24} color={isChatBlocked ? Colors.textMuted : Colors.textSecondary} />}
          </TouchableOpacity>

          {/* Поле растёт до INPUT_MAX_H, дальше текст прокручивается внутри */}
          <View style={[styles.inputWrap, isChatBlocked && { opacity: 0.5 }]}>
            <TextInput
              ref={inputRef}
              style={[styles.textInput, { height: inputH }]}
              value={input}
              onChangeText={isChatBlocked ? undefined : setInput}
              onContentSizeChange={e => {
                const h = e.nativeEvent.contentSize.height;
                setInputH(Math.max(INPUT_MIN_H, Math.min(INPUT_MAX_H, h)));
              }}
              placeholder={isChatBlocked ? 'Чат закрыт' : 'Сообщение'}
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={1000}
              blurOnSubmit={false}
              editable={!isChatBlocked}
              scrollEnabled={inputH >= INPUT_MAX_H}
            />
          </View>

          {/* Пустое поле — предлагаем записать голосовое, как в мессенджерах */}
          {!input.trim() && voiceSupported && !isChatBlocked ? (
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={startRecording}
              disabled={uploadingVoice}
              activeOpacity={0.8}
            >
              {uploadingVoice
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="mic" size={20} color="#fff" />}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || sending || isChatBlocked) && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!input.trim() || sending || isChatBlocked}
              activeOpacity={0.8}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="arrow-up" size={20} color="#fff" />}
            </TouchableOpacity>
          )}
        </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  // Decision bar (employer top bar)
  decisionBar: {
    paddingHorizontal: rs(16), paddingVertical: rs(12),
    backgroundColor: Colors.bg,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
    gap: rs(10),
  },
  decisionBarLabel: { fontSize: rf(12.5), fontWeight: '600', color: Colors.textSecondary },
  decisionMoreTxt: { fontSize: rf(12), fontWeight: '600', color: Colors.primary, marginTop: rs(8) },
  decisionStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(6) },
  decisionBtnsRow: { flexDirection: 'row', gap: rs(10) },
  decisionBtn: {
    flex: 1, flexDirection: 'row', gap: rs(6),
    borderRadius: rs(12), paddingVertical: rs(12),
    alignItems: 'center', justifyContent: 'center',
  },
  // «Не подходит» — второстепенное действие: контур, без заливки и без красного
  decisionBtnReject: {
    backgroundColor: Colors.bg,
    borderWidth: 1.5, borderColor: Colors.inputBorder,
  },
  decisionBtnRejectTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary },
  // «Подходит» — главное действие
  decisionBtnAccept: { backgroundColor: Colors.primary },
  decisionBtnAcceptTxt: { fontSize: rf(14), fontWeight: '700', color: '#fff' },
  // Compact back icon button
  backIconBtn: {
    width: rs(34), height: rs(34), borderRadius: rs(17),
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.divider,
  },
  backIconTxt: { fontSize: rf(22), color: Colors.textPrimary, lineHeight: rf(26), fontWeight: '400', marginTop: rs(-1) },
  // Blocked bar (worker)
  blockedBar: {
    backgroundColor: '#FEE2E2', paddingHorizontal: rs(16), paddingVertical: rs(10),
    borderBottomWidth: 1, borderBottomColor: '#FECACA',
  },
  blockedBarTxt: { fontSize: rf(13), fontWeight: '600', color: Colors.red, textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  backBtn: {},
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: rs(10), justifyContent: 'center' },
  headerAvatar: { width: rs(34), height: rs(34), borderRadius: rs(17) },
  headerAvatarText: { color: '#fff', fontSize: rf(13), fontWeight: '700' },
  headerName: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: rf(11), color: Colors.textMuted, maxWidth: rs(160) },
  headerSubOnline: { color: Colors.green, fontWeight: '600' },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: rs(4) },
  onlineDot: { width: rs(6), height: rs(6), borderRadius: rs(3), backgroundColor: Colors.green },
  msgList: { padding: rs(16), gap: rs(8), paddingBottom: rs(8) },
  systemMsg: {
    alignSelf: 'center', backgroundColor: Colors.primaryLight,
    borderRadius: rs(100), paddingHorizontal: rs(14), paddingVertical: rs(7), marginVertical: rs(8),
    // Иконка и текст в строку — эмодзи из текста убраны
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(7), maxWidth: '88%',
  },
  systemMsgMatch: { backgroundColor: '#D1FAE5', borderRadius: rs(12) },
  systemMsgReject: { backgroundColor: '#FEE2E2', borderRadius: rs(12) },
  systemText: { flexShrink: 1, fontSize: rf(13), color: Colors.primary, fontWeight: '600' },
  systemTextMatch: { color: Colors.green },
  systemTextReject: { color: Colors.red },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: rs(8), marginVertical: rs(2) },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowThem: { justifyContent: 'flex-start' },
  msgAvatar: { width: rs(28), height: rs(28), borderRadius: rs(14), flexShrink: 0 },
  msgAvatarText: { color: '#fff', fontSize: rf(10), fontWeight: '700' },
  bubble: { maxWidth: '72%', paddingHorizontal: rs(14), paddingVertical: rs(10), borderRadius: rs(18) },
  bubbleMe: { backgroundColor: Colors.primary, borderBottomRightRadius: rs(4) },
  bubbleThem: { backgroundColor: Colors.surface, borderBottomLeftRadius: rs(4) },
  bubbleText: { fontSize: rf(14), color: Colors.textPrimary, lineHeight: rf(20) },
  bubbleImage: { padding: rs(3), overflow: 'hidden' },
  msgImage: { width: rs(208), height: rs(208), borderRadius: rs(15), backgroundColor: Colors.divider },
  bubbleTextMe: { color: '#fff' },
  daySep: { alignSelf: 'center', marginVertical: rs(10) },
  daySepTxt: {
    fontSize: rf(11.5), fontWeight: '600', color: Colors.textSecondary,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.divider,
    borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(4),
    overflow: 'hidden',
  },
  timestamp: { fontSize: rf(10), color: Colors.textMuted, marginTop: rs(4) },
  timestampMe: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  // Время и галочки в одну строку, прижатые вправо: так они читаются как
  // одна подпись под сообщением, а не как два отдельных значка.
  stampRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: rs(3) },
  // Раньше подсказки лежали в ленте, прокручиваемой вбок: видно было две-три,
  // остальные приходилось искать пальцем. Теперь переносятся на строки и видны
  // сразу. Высоту ограничиваем, иначе восемь фраз съедят пол-экрана над
  // клавиатурой — дальше обычная прокрутка вниз.
  suggestScroll: {
    flexGrow: 0, maxHeight: rs(168),
    borderTopWidth: 1, borderTopColor: Colors.divider,
    backgroundColor: Colors.bg,
  },
  suggestRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: rs(8),
    paddingHorizontal: rs(10), paddingVertical: rs(8),
  },
  suggestChip: {
    borderWidth: 1, borderColor: Colors.primaryBorder,
    backgroundColor: Colors.primaryLight,
    borderRadius: rs(100), paddingHorizontal: rs(14), paddingVertical: rs(8),
  },
  suggestChipTxt: { fontSize: rf(13.5), fontWeight: '600', color: Colors.primary },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: rs(8),
    paddingHorizontal: rs(10), paddingVertical: rs(8),
    borderTopWidth: 1, borderTopColor: Colors.divider, backgroundColor: Colors.bg,
  },
  // Кнопки одного размера и по нижнему краю — поле растёт вверх, они стоят ровно
  attachBtn: {
    width: rs(38), height: rs(38), borderRadius: rs(19),
    alignItems: 'center', justifyContent: 'center',
  },
  inputWrap: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: rs(20),
    borderWidth: 1, borderColor: Colors.inputBorder,
    paddingHorizontal: rs(14),
    paddingVertical: rs(8),
    justifyContent: 'center',
    minHeight: rs(38),
  },
  safetyMsg: {
    marginHorizontal: rs(12), marginVertical: rs(10),
    backgroundColor: '#FFFBEB',
    borderRadius: rs(14), padding: rs(14),
    borderWidth: 1, borderColor: '#FDE68A',
    gap: rs(6),
  },
  safetyHeader: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  safetyIconWrap: {
    width: rs(22), height: rs(22), borderRadius: rs(11),
    backgroundColor: '#FDE9C8', alignItems: 'center', justifyContent: 'center',
  },
  safetyTitle: { fontSize: rf(13), fontWeight: '700', color: '#92400E' },
  safetyText: { fontSize: rf(12), color: '#78350F', lineHeight: rf(17) },
  // Rejection confirmation modal
  confirmOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 999,
    alignItems: 'center', justifyContent: 'center', padding: rs(24),
  },
  confirmCard: {
    backgroundColor: Colors.bg, borderRadius: rs(20), padding: rs(24), width: '100%', gap: rs(14),
  },
  confirmTitle: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  confirmBody: { fontSize: rf(14), color: Colors.textSecondary, textAlign: 'center', lineHeight: rf(20) },
  confirmBtns: { flexDirection: 'row', gap: rs(10), marginTop: rs(4) },
  confirmCancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.inputBorder,
    borderRadius: rs(100), paddingVertical: rs(13), alignItems: 'center',
  },
  confirmCancelTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary },
  confirmRejectBtn: { flex: 1, backgroundColor: Colors.red, borderRadius: rs(100), paddingVertical: rs(13), alignItems: 'center' },
  confirmRejectTxt: { fontSize: rf(14), fontWeight: '700', color: '#fff' },
  // Фон и скругление — у обёртки; само поле прозрачное, чтобы высота
  // считалась только по тексту и рост был плавным
  textInput: {
    fontSize: rf(15), color: Colors.textPrimary,
    padding: 0, margin: 0,
    textAlignVertical: 'top',
  },
  sendBtn: {
    width: rs(38), height: rs(38), borderRadius: rs(19),
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.35 },
  recordWrap: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  recDot: { width: rs(9), height: rs(9), borderRadius: rs(5), backgroundColor: Colors.red },
  recTime: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  recHint: { fontSize: rf(13), color: Colors.textMuted },
});
