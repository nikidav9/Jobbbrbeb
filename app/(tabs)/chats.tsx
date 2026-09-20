import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Animated, PanResponder, Dimensions, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { ReadTicks, isSeenByOther } from '@/components/ReadTicks';
import { useApp } from '@/hooks/useApp';
import { Chat } from '@/constants/types';
import { nameColorFromString, getInitials, formatChatTime } from '@/services/storage';
import { dbDeleteChat } from '@/services/db';
import GuestGate from '@/components/GuestGate';

import { rs, rf } from '@/constants/scale';
import { OnboardingTarget } from '@/components/OnboardingTarget';
import { messagePreview } from '@/services/messagePreview';

const { width: SW } = Dimensions.get('window');
const DELETE_THRESHOLD = -80;

function UserAvatar({ name, avatarUrl, size = 44 }: { name: string; avatarUrl?: string; size?: number }) {
  const color = nameColorFromString(name);
  const initials = getInitials(name);
  const borderRadius = size / 2;
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View style={[{ width: size, height: size, borderRadius, alignItems: 'center', justifyContent: 'center', backgroundColor: color }]}>
      <Text style={{ color: '#fff', fontSize: size * 0.36, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
}

function ChatRow({ item, currentUser, users, onPress, onDelete, first, last: isLast }: {
  item: Chat;
  currentUser: any;
  users: any[];
  onPress: () => void;
  onDelete: () => Promise<void>;
  first: boolean;
  last: boolean;
}) {
  const pan = useRef(new Animated.Value(0)).current;
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: () => {
      pan.setOffset((pan as any)._value);
      pan.setValue(0);
    },
    onPanResponderMove: (_, g) => {
      if (g.dx <= 0) pan.setValue(g.dx);
    },
    onPanResponderRelease: (_, g) => {
      pan.flattenOffset();
      if (g.dx < DELETE_THRESHOLD) {
        Animated.spring(pan, { toValue: -120, useNativeDriver: false }).start();
      } else {
        Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  })).current;

  const otherId = currentUser.role === 'worker' ? item.employerId : item.workerId;
  const other = users.find((u: any) => u.id === otherId);
  const name = other ? `${other.firstName} ${other.lastName}` : item.companyName;
  const avatarUrl = other?.avatarUrl;

  const unread = currentUser.role === 'worker' ? item.unreadWorker : item.unreadEmployer;
  const last = item.messages[item.messages.length - 1];

  const handleDelete = () => {
    Alert.alert(
      'Удалить переписку?',
      'Переписка будет удалена только у вас.',
      [
        { text: 'Отмена', style: 'cancel', onPress: () => Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start() },
        {
          text: 'Удалить', style: 'destructive', onPress: async () => {
            if (deleting) return;
            setDeleting(true);
            try {
              // Строка исчезает только после подтверждённого удаления на сервере.
              // Иначе любой обрыв связи выглядел как успешно удалённый чат.
              await onDelete();
              setDeleted(true);
            } catch {
              setDeleting(false);
              Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();
            }
          },
        },
      ]
    );
  };

  if (deleted) return null;

  return (
    <View style={[styles.swipeRow, first && styles.swipeRowFirst, isLast && styles.swipeRowLast]}>
      {/* Delete button revealed on left swipe */}
      <View style={styles.deleteAction}>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting}>
          <Ionicons name="trash-outline" size={22} color="#fff" />
          <Text style={styles.deleteBtnLabel}>{deleting ? 'Удаляем…' : 'Удалить'}</Text>
        </TouchableOpacity>
      </View>

      <Animated.View style={[styles.chatRowAnimated, { transform: [{ translateX: pan }] }]} {...panResponder.panHandlers}>
        <TouchableOpacity style={[styles.chatRow, isLast && styles.chatRowLast]} onPress={onPress} activeOpacity={0.85}>
          <View>
            <UserAvatar name={name} avatarUrl={avatarUrl} size={44} />
            {/* Конверт в углу аватарки — это и есть отметка непрочитанного.
                Прежний счётчик справа отнимал место у текста, а число
                непрочитанных в переписке с одним работодателем ничего не
                добавляет к «тебе написали». */}
            {unread > 0 ? (
              <View style={styles.unreadDot}>
                <Ionicons name="mail" size={10} color="#FFFFFF" />
              </View>
            ) : null}
          </View>

          <View style={styles.chatInfo}>
            <View style={styles.chatTop}>
              <Text style={styles.chatName} numberOfLines={1}>{name}</Text>
              {unread > 0 ? (
                <View style={styles.newPill}><Text style={styles.newPillTxt}>НОВОЕ</Text></View>
              ) : null}
              {last ? <Text style={styles.chatTime}>{formatChatTime(last.timestamp)}</Text> : null}
            </View>
            <Text style={styles.chatVac} numberOfLines={1}>
              {item.companyName && item.companyName !== name
                ? `${item.companyName} · ${item.vacTitle}`
                : item.vacTitle}
            </Text>
            <View style={styles.lastRow}>
              {/* Галочки только если последнее слово за нами: у чужого
                  сообщения показывать нечего — мы его и так читаем. */}
              {last && last.senderId === currentUser.id ? (
                <ReadTicks seen={isSeenByOther(item, currentUser.role, last.timestamp)} />
              ) : null}
              <Text style={[styles.chatLast, unread > 0 && styles.chatLastUnread]} numberOfLines={2}>
                {messagePreview(last?.text)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function ChatsScreen() {
  const router = useRouter();
  const { currentUser, chats, users, refreshChats, refreshAll, showToast, offline } = useApp();
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tabBarHeight = useBottomTabBarHeight();

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } catch {
      showToast('Не удалось обновить переписки. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  if (currentUser.isGuest) return <GuestGate title="Чаты — после регистрации" subtitle="Зарегистрируйтесь, чтобы написать работодателю и получать ответы." />;

  // Сервер отдаёт чаты в порядке их создания — то есть по тому, когда с
  // человеком связались впервые. Со временем это расходится с тем, кто писал
  // последним, и список выглядит случайным. Сортируем как в мессенджерах: по
  // последнему сообщению. У чата без сообщений берём дату создания, иначе он
  // навсегда провалился бы в конец.
  const chatTime = (c: Chat) => {
    const last = c.messages[c.messages.length - 1];
    return new Date(last?.timestamp ?? c.createdAt).getTime() || 0;
  };

  const myChats = chats
    .filter(c =>
      currentUser.role === 'worker' ? c.workerId === currentUser.id : c.employerId === currentUser.id
    )
    .sort((a: Chat, b: Chat) => chatTime(b) - chatTime(a));

  // Обрыв — это когда не принесли САМ список, а не когда поиск ничего не
  // нашёл. Поэтому смотрим на myChats, до фильтра.
  const offlineHere = offline.chats && myChats.length === 0;

  const unreadOf = (c: Chat) => (currentUser.role === 'worker' ? c.unreadWorker : c.unreadEmployer) ?? 0;
  const unreadCount = myChats.filter(c => unreadOf(c) > 0).length;

  const filtered = myChats.filter(c => {
    if (onlyUnread && unreadOf(c) === 0) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    // Search by vacancy title, company name, and the other person's name
    const otherId = currentUser.role === 'worker' ? c.employerId : c.workerId;
    const other = users.find(u => u.id === otherId);
    const otherName = other ? `${other.firstName} ${other.lastName}`.toLowerCase() : '';
    return (
      c.vacTitle.toLowerCase().includes(q) ||
      c.companyName.toLowerCase().includes(q) ||
      otherName.includes(q)
    );
  });

  const handleDelete = async (chatId: string) => {
    try {
      await dbDeleteChat(chatId);
      // Удаление уже подтверждено. Сбой последующего перечитывания списка не
      // превращаем в «не удалилось» и не просим человека жать кнопку второй раз.
      try {
        await refreshChats();
      } catch {
        showToast('Переписка удалена, но список не обновился. Потяните вниз.', 'info');
      }
      showToast('Переписка удалена', 'success');
    } catch {
      showToast('Не удалось удалить переписку. Проверьте связь.', 'error');
      throw new Error('chat delete failed');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <OnboardingTarget targetKey="chats.back">
          <TouchableOpacity
            style={styles.back}
            onPress={() => router.back()}
            activeOpacity={0.8}
            accessibilityLabel="Назад"
          >
            <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </OnboardingTarget>
        <Text style={styles.topTitle}>Сообщения</Text>
        {/* Пустая колонка той же ширины: иначе заголовок встаёт по центру
            остатка, а не экрана. Не копия кнопки — с её фоном и тенью это
            читалось как вторая, зачем-то пустая кнопка. */}
        <View style={styles.backSpacer} pointerEvents="none" />
      </View>

      <OnboardingTarget targetKey="chats.content" style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <View style={styles.searchInner}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Поиск по компании или вакансии"
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Очистить поиск">
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.chipsRow}>
        {([
          { key: false, label: 'Все', icon: 'file-tray-outline' as const, count: myChats.length },
          { key: true, label: 'Непрочитанные', icon: 'mail-unread-outline' as const, count: unreadCount },
        ]).map(f => {
          const on = onlyUnread === f.key;
          return (
            <TouchableOpacity
              key={String(f.key)}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => setOnlyUnread(f.key)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={f.icon} size={15} color={on ? Colors.textPrimary : Colors.textSecondary} />
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{f.label}</Text>
              {f.count > 0 ? <Text style={styles.chipCount}>{f.count}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          {/* Обрыв связи не выдаём за отсутствие переписок: человек, который
              ждёт ответа работодателя, прочитает «Нет сообщений» как «мне не
              ответили», а на деле список просто не принесли.

              Признак берётся с ТОГО списка, который этот экран показывает:
              чаты могут не прийти, когда вакансии пришли, и наоборот.

              И спрашиваем про chats, а не про filtered: пустой результат
              поиска — не обрыв связи, и «переписки не загрузились» поверх
              набранного запроса было бы прямой неправдой. */}
          {offlineHere ? (
            <>
              <Ionicons name="cloud-offline-outline" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Нет связи с сервером</Text>
              <Text style={styles.emptySubtitle}>
                Переписки не загрузились — дело в связи. Потяните вниз, чтобы обновить.
              </Text>
            </>
          ) : onlyUnread ? (
            <>
              <Ionicons name="checkmark-done-outline" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Всё прочитано</Text>
              <Text style={styles.emptySubtitle}>Непрочитанных переписок нет</Text>
            </>
          ) : search.trim() !== '' ? (
            <>
              <Ionicons name="search-outline" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Ничего не найдено</Text>
              <Text style={styles.emptySubtitle}>Попробуйте другое имя или название компании</Text>
            </>
          ) : (
            <>
              <Ionicons name="chatbubble-ellipses-outline" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Нет сообщений</Text>
              <Text style={styles.emptySubtitle}>Чаты появятся после мэтча</Text>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + rs(16) }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          renderItem={({ item, index }) => (
            <ChatRow
              item={item}
              currentUser={currentUser}
              users={users}
              first={index === 0}
              last={index === filtered.length - 1}
              onPress={() => router.push({ pathname: '/chat-room', params: { chatId: item.id } })}
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}
      </OnboardingTarget>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.outerBg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingTop: rs(6), paddingBottom: rs(12),
  },
  back: {
    width: rs(44), height: rs(44), borderRadius: rs(22),
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', ...Shadow.card,
  },
  backSpacer: { width: rs(44), height: rs(44) },
  topTitle: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary },
  searchWrap: { paddingHorizontal: rs(16), paddingBottom: rs(12) },
  searchInner: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    backgroundColor: '#ECEDEF', borderRadius: rs(100),
    paddingHorizontal: rs(14), height: rs(46),
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: rf(14), color: Colors.textPrimary, padding: 0 },
  chipsRow: { flexDirection: 'row', gap: rs(8), paddingHorizontal: rs(16), paddingBottom: rs(12) },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    height: rs(40), paddingHorizontal: rs(16), borderRadius: rs(20),
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: 'transparent',
  },
  chipOn: { borderColor: Colors.textPrimary },
  chipTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary },
  chipTxtOn: { color: Colors.textPrimary, fontWeight: '700' },
  chipCount: { fontSize: rf(13), fontWeight: '700', color: Colors.textMuted },
  list: { paddingHorizontal: rs(16) },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: rs(80) },
  emptyTitle: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary, marginTop: rs(12) },
  emptySubtitle: { fontSize: rf(14), color: Colors.textMuted, marginTop: rs(6) },

  swipeRow: { position: 'relative', overflow: 'hidden', backgroundColor: Colors.bg },
  swipeRowFirst: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  swipeRowLast: { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
  deleteAction: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    width: rs(120), alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.red,
  },
  deleteBtn: { alignItems: 'center', gap: rs(4) },
  deleteBtnLabel: { fontSize: rf(11), color: '#fff', fontWeight: '600' },

  chatRowAnimated: { backgroundColor: Colors.bg },
  chatRow: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(12), paddingHorizontal: rs(14), paddingVertical: rs(14), borderBottomWidth: 1, borderBottomColor: Colors.divider },
  avatar: { width: rs(44), height: rs(44), borderRadius: rs(22), alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  unreadDot: {
    position: 'absolute', bottom: -rs(2), right: -rs(2),
    width: rs(18), height: rs(18), borderRadius: rs(9),
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: '#FFFFFF',
  },
  chatInfo: { flex: 1 },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  chatName: { fontSize: rf(15), fontWeight: '800', color: Colors.textPrimary, flexShrink: 1 },
  newPill: { backgroundColor: Colors.primaryLight, borderRadius: rs(6), paddingHorizontal: rs(6), paddingVertical: rs(2), flexShrink: 0 },
  newPillTxt: { fontSize: rf(9.5), fontWeight: '800', color: Colors.primary, letterSpacing: 0.3 },
  chatTime: { fontSize: rf(12), color: Colors.textMuted, marginLeft: 'auto', flexShrink: 0 },
  chatVac: { fontSize: rf(13), color: Colors.textMuted, marginTop: rs(2) },
  chatLast: { fontSize: rf(13.5), color: Colors.textSecondary, flexShrink: 1, lineHeight: rf(19) },
  chatLastUnread: { color: Colors.textPrimary, fontWeight: '600' },
  chatRowLast: { borderBottomWidth: 0 },
  // flexShrink на тексте, а не на строке: длинное сообщение должно
  // обрезаться само, не выдавливая галочки за край.
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: rs(3), marginTop: rs(2) },
  badge: { backgroundColor: Colors.primary, borderRadius: rs(100), minWidth: rs(20), height: rs(20), alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(4) },
  badgeText: { color: '#fff', fontSize: rf(10), fontWeight: '700' },
});
