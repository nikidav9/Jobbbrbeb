import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Dimensions, RefreshControl, Modal, FlatList,
  TextInput, ActivityIndicator, Share, Platform, Linking,
} from 'react-native';
import {
  GestureDetector,
  ScrollView as GHScrollView,
  RefreshControl as GHRefreshControl,
} from 'react-native-gesture-handler';
import Reanimated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import { useRouter, useFocusEffect } from 'expo-router';
import { ApplyAnswersPrompt } from '@/components/feature/ApplyAnswersPrompt';
import { applyAnswersFor, applyAnswersFilled } from '@/lib/applyAnswers';
import { patchPersonal } from '@/lib/profileEdit';
import { JTPullRefresh } from '@/components/ui/JTPullRefresh';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useSwipeDeck } from '@/hooks/useSwipeDeck';
import { useEnergy } from '@/hooks/useEnergy';
import { DAILY_ENERGY } from '@/services/energy';
import { User, PermVacancy, ExtVacancy } from '@/constants/types';
import { SECTION_BY_WORK_TYPE } from '@/constants/jobSections';
import { getInitials, nameColorFromString } from '@/services/storage';
import { normalizeCompany } from '@/services/company';
import { agoRu } from '@/services/time';
import { sectionOfPerm, rankOwn, interleaveDeck } from '@/services/feedMix';
import { openExtVacancy, takeDeckAction } from '@/services/extVacancyHandoff';
import { beginDraft, setAppliedFilters, setFeedQuery, useAppliedFilters } from '@/services/feedFilterStore';
import { FORMATS, GRADES } from '@/components/filters/kit';
import { JTBolt } from '@/components/ui/JTBolt';
import { TabLogo, TAB_TOP } from '@/components/ui/TabLogo';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { loadExtSaved, toggleExtSaved, useExtSaved } from '@/services/extSaved';
import { VACANCY_LEVELS, VACANCY_FORMATS, VACANCY_SPECS, vacancyLevel, vacancyFormat } from '@/services/vacancyFacets';
import { JT, JT_FONT } from '@/constants/jt';
import {
  type FeedFilters, EMPTY_FEED_FILTERS, isFilterActive, matchOwnVacancy, toExtFeedFilters, pluralVacancies,
} from '@/services/feedFilters';
import { METRO_LINES } from '@/constants/metro';
import {
  dbUpdateVacancy,
  dbCreateChat,
  dbApplyPermVacancy,
  dbClosePermVacancy,
  dbDeletePermVacancy,
  dbGetUserById,
  dbRecordPermVacancyView,
  dbGetVacancyViewers,
  dbGetPermVacancyViewers,
  dbAddPermSaved,
  dbRemovePermSaved,
  dbRecordGuestEvent,
  dbStartGuestRegistration,
  dbGetExtFeed,
  dbExtSwipe,
  dbExtUnswipe,
  dbPermSwipe,
  dbPermUnswipe,
  dbGetPermSwipes,
  jupiterEnqueue,
} from '@/services/db';
import { ensureResumeForApply } from '@/services/resumeGate';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Chip } from '@/components/ui/Chip';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { TabHeader } from '@/components/ui/TabHeader';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';
import { WORK_TYPE_META } from '@/components/feature/WorkTypeSelector';
import { PermApplicationsSheet } from '@/components/feature/PermApplicationsSheet';
import { OnboardingTarget } from '@/components/OnboardingTarget';
import { registerWebPush, isWebPushRegistered, getWebPushDebug } from '@/lib/webPush';

import { rs, rf } from '@/constants/scale';
import { ApplySheet } from '@/components/feature/ApplySheet';
import { getChatSuggestions } from '@/constants/chatSuggestions';
import { permVacancyInfoLines } from '@/services/vacancyCard';

// Гостю даём несколько бесплатных «отклонить», дальше — стена регистрации.
// Счётчик модульный: общий для колод «Подработка» и «Работа», чтобы гость не
// обходил лимит переключением вкладок. Живёт в памяти сессии; после
// регистрации гость исчезает, и счётчик перестаёт на что-либо влиять.
const GUEST_SKIP_LIMIT = 3;
let guestSkipCount = 0;


// ─── Web push permission banner (iOS PWA requires user gesture) ───────────────
type WPState = 'ask' | 'retry' | 'denied' | 'hidden';

function getWPState(): WPState {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'hidden';
  if (!('Notification' in window)) return 'hidden';
  const perm = (window as any).Notification.permission as NotificationPermission;
  if (perm === 'denied') return 'denied';
  if (perm === 'granted' && isWebPushRegistered()) return 'hidden';
  if (perm === 'granted') return 'retry';
  return 'ask';
}

function WebPushBanner({ userId }: { userId: string }) {
  const [state, setState] = useState<WPState>(() => getWPState());
  const [debugMsg, setDebugMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);

  if (state === 'hidden') return null;

  if (state === 'denied') {
    return (
      <TouchableOpacity style={[wpStyles.banner, wpStyles.bannerDenied]} activeOpacity={1}>
        <Ionicons name="settings-outline" size={rf(18)} color="#92400E" />
        <Text style={[wpStyles.text, wpStyles.textDenied]}>Разрешите уведомления: Настройки → Safari → Уведомления</Text>
      </TouchableOpacity>
    );
  }

  const handlePress = async () => {
    if (loading) return;
    setLoading(true);
    setDebugMsg('...');
    const ok = await registerWebPush(userId);
    setLoading(false);
    if (ok) {
      setState('hidden');
    } else {
      const msg = getWebPushDebug();
      setDebugMsg(msg);
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
      if (perm === 'denied') setState('denied');
    }
  };

  return (
    <TouchableOpacity style={wpStyles.banner} onPress={handlePress} activeOpacity={0.85} disabled={loading}>
      {loading
        ? <ActivityIndicator size="small" color="#4338CA" />
        : <Ionicons name="notifications-outline" size={rf(18)} color="#4338CA" />}
      <View style={{ flex: 1 }}>
        <Text style={wpStyles.text}>
          {state === 'retry' ? 'Завершить настройку уведомлений' : 'Включить push-уведомления'}
        </Text>
        {debugMsg ? <Text style={wpStyles.debugText}>{debugMsg}</Text> : null}
      </View>
      {!loading && <Text style={wpStyles.arrow}>›</Text>}
    </TouchableOpacity>
  );
}

const wpStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    marginHorizontal: rs(16), marginBottom: rs(8),
    backgroundColor: '#EEF2FF', borderRadius: rs(12),
    paddingHorizontal: rs(14), paddingVertical: rs(10),
  },
  bannerDenied: { backgroundColor: '#FEF3C7' },
  text: { fontSize: rf(14), fontWeight: '600', color: '#4338CA' },
  textDenied: { color: '#92400E', fontWeight: '500', fontSize: rf(12) },
  debugText: { fontSize: rf(11), color: '#6B7280', marginTop: rs(2) },
  arrow: { fontSize: rf(18), color: '#4338CA' },
});

const { width: SW } = Dimensions.get('window');

// Часть описаний приходит с продублированным английским переводом после
// разделителя из тире. Показываем только исходный текст: режем хвост, если
// после строки-разделителя идёт преимущественно латиница.
function cleanDescription(text?: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^[\s—–_-]{3,}$/.test(lines[i].trim())) {
      const tail = lines.slice(i + 1).join(' ');
      const latin = (tail.match(/[A-Za-z]/g) || []).length;
      const cyr = (tail.match(/[А-Яа-яЁё]/g) || []).length;
      if (latin > 20 && latin > cyr) return lines.slice(0, i).join('\n').trimEnd();
    }
  }
  return text;
}

// Поиск по своим вакансиям — то же правило, что на сервере для карьерных
// (ext_feed_match): каждое слово запроса есть в тексте, без регистра.
function matchesSearch(text: string, query: string): boolean {
  if (!query) return true;
  const hay = text.toLowerCase();
  return query.toLowerCase().split(/[\s,;]+/).filter(Boolean).slice(0, 6).every(w => hay.includes(w));
}

// Превью описания на карточке — вступление до первого раздела (`## `), как
// «О команде» на макете; нет вступления — первые строки без разметки.
// Дальше текст обрезает сама карточка.
function previewText(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cut = lines.findIndex(l => l.startsWith('## '));
  const intro = cut > 0 ? lines.slice(0, cut) : lines;
  return intro.map(l => l.replace(/^(## |• |- |\* )/, '')).join(' ');
}



type FeedCard =
  | { _ext: false; v: PermVacancy }
  | { _ext: true;  v: ExtVacancy };

// ─────────────────────────────────────────────────
// Полоса чипов над колодой (решение владельца 27.09.2026 вместо шестерёнки
// и общей шторки PermFilterSheet). Чип открывает отдельный экран фильтра
// (app/filters/*, макет «JT-filters»), крестик сбрасывает фильтр сразу.
// ─────────────────────────────────────────────────
type FilterSheetKind = 'salary' | 'spec' | 'level' | 'format' | 'company' | 'posted';



const POSTED_OPTIONS: { id: FeedFilters['posted']; label: string }[] = [
  { id: 'all', label: 'За всё время' },
  { id: 'day', label: 'За сутки' },
  { id: '3days', label: 'За 3 дня' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
];

/** «150 тыс.» — короткая подпись зарплаты для включённого чипа. */
function salaryShort(n: number): string {
  return n > 0 && n % 1000 === 0 ? `${n / 1000} тыс.` : n.toLocaleString('ru-RU');
}

/** Подпись и состояние одного чипа под текущий фильтр — значение или счётчик. */
function filterChipInfo(kind: FilterSheetKind, f: FeedFilters): { label: string; active: boolean } {
  switch (kind) {
    case 'salary':
      return f.salaryFrom > 0
        ? { label: `Зарплата от ${salaryShort(f.salaryFrom)}`, active: true }
        : { label: 'Зарплата', active: false };
    case 'spec': {
      const n = f.specs.length;
      if (!n) return { label: 'Специализация', active: false };
      const sp = VACANCY_SPECS.find(s => s.id === f.specs[0]);
      const one = sp?.short ?? sp?.label ?? '';
      return { label: n === 1 ? one : `Специализация · ${n}`, active: true };
    }
    case 'level': {
      // Грейды макета: Junior = стажёр + junior, поэтому считаем кнопки, а не id.
      const on = GRADES.filter(g => g.ids.every(id => f.levels.includes(id)));
      if (!f.levels.length) return { label: 'Грейд', active: false };
      if (on.length === 1) return { label: on[0].label, active: true };
      return { label: `Грейд · ${on.length || f.levels.length}`, active: true };
    }
    case 'format': {
      const n = f.formats.length;
      if (!n) return { label: 'Формат работы', active: false };
      const one = FORMATS.find(v => v.id === f.formats[0])?.chip ?? '';
      return { label: n === 1 ? one : `Формат работы · ${n}`, active: true };
    }
    case 'company': {
      const n = f.companies.length;
      if (!n) return { label: 'Компания', active: false };
      return { label: n === 1 ? f.companies[0] : `Компания · ${n}`, active: true };
    }
    case 'posted': {
      if (f.posted === 'all') return { label: 'Дата публикации', active: false };
      return { label: POSTED_OPTIONS.find(p => p.id === f.posted)?.label ?? '', active: true };
    }
  }
}

// Компании в фильтрах больше нет (макет «JT-filters», решение владельца).
const FILTER_CHIP_KINDS: FilterSheetKind[] = ['salary', 'spec', 'level', 'format', 'posted'];

/**
 * Прокрутка вбок отдельная от свайпа карточки: полоса стоит НАД карточкой,
 * между шапкой и колодой, а не внутри неё — жесты не делят одну площадь.
 * Нажатие на чип открывает его шторку, «×» на включённом чипе сбрасывает
 * фильтр сразу, не открывая шторку.
 */
function FilterChipsBar({ filters, onOpen, onClear, onOpenAll }: {
  filters: FeedFilters;
  onOpen: (kind: FilterSheetKind) => void;
  onClear: (kind: FilterSheetKind) => void;
  /** Чёрная кнопка слева (макет JT-design) — список всех фильтров. */
  onOpenAll: () => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={fb.row}
      testID="filter-bar"
    >
      <TouchableOpacity
        style={fb.allBtn}
        activeOpacity={0.8}
        onPress={onOpenAll}
        testID="filter-all"
        accessibilityRole="button"
        accessibilityLabel="Все фильтры"
      >
        <Ionicons name="options-outline" size={rs(20)} color={JT.surface} />
      </TouchableOpacity>
      {FILTER_CHIP_KINDS.map(kind => {
        const { label, active } = filterChipInfo(kind, filters);
        return (
          <View key={kind} style={[fb.chip, active && fb.chipActive]}>
            <TouchableOpacity
              style={fb.chipBody}
              activeOpacity={0.8}
              onPress={() => onOpen(kind)}
              testID={`filter-chip-${kind}`}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <Text style={[fb.chipTxt, active && fb.chipTxtActive]} numberOfLines={1}>{label}</Text>
            </TouchableOpacity>
            {active ? (
              <TouchableOpacity
                style={fb.chipClear}
                hitSlop={8}
                onPress={() => onClear(kind)}
                testID={`filter-chip-clear-${kind}`}
                accessibilityRole="button"
                accessibilityLabel={`Сбросить фильтр «${label}»`}
              >
                <Ionicons name="close" size={rs(16)} color={JT.ink} />
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

// Чипы — макет JT-design: высота 36, скругление 18; выбранный — оранжевый с
// чёрным контуром и крестиком, остальные — контур border-soft.
const fb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: rs(8), paddingHorizontal: rs(20), paddingVertical: rs(10) },
  allBtn: {
    width: rs(44), height: rs(36), borderRadius: rs(18),
    backgroundColor: JT.ink, alignItems: 'center', justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', height: rs(36),
    borderRadius: rs(18), borderWidth: 1.5, borderColor: JT.borderSoft,
    backgroundColor: JT.surface,
  },
  // Активный — оранжевый с контуром 2, как на доске «Лента вакансий».
  chipActive: { backgroundColor: JT.accent, borderColor: JT.ink, borderWidth: 2 },
  chipBody: { paddingHorizontal: rs(14), height: '100%', justifyContent: 'center' },
  chipTxt: { fontFamily: JT_FONT.bold, fontSize: rf(14), color: JT.ink },
  chipTxtActive: { color: JT.ink },
  chipClear: { paddingRight: rs(12), paddingLeft: rs(0), height: '100%', justifyContent: 'center' },

});

// ─────────────────────────────────────────────────
// Разовая / Регулярная — панель над лентой смен
// ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────
// Vacancy Viewers Modal
// ─────────────────────────────────────────────────
function VacancyViewersModal({ vacancyId, kind = 'shift', onClose }: { vacancyId: string; kind?: 'shift' | 'perm'; onClose: () => void }) {
  const router = useRouter();
  const { currentUser, vacancies, permVacancies, users, chats, showToast, refreshChats } = useApp();
  const [loading, setLoading] = useState(true);
  const [viewers, setViewers] = useState<User[]>([]);
  const [chatLoading, setChatLoading] = useState<string | null>(null);
  const viewersSwipe = useSwipeToDismiss(onClose);

  const vacancy = kind === 'perm'
    ? permVacancies.find(v => v.id === vacancyId)
    : vacancies.find(v => v.id === vacancyId);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const ids = await (kind === 'perm' ? dbGetPermVacancyViewers(vacancyId) : dbGetVacancyViewers(vacancyId));
        // Список пользователей уже загружен в контекст, поэтому берём оттуда.
        // Раньше на каждого шёл отдельный запрос: на 58 просмотревших это
        // 58 обращений к серверу, и шторка висела с крутилкой полминуты.
        const known = new Map<string, User>(users.map((u: User) => [u.id, u]));
        const missing = ids.filter((id: string) => !known.has(id));
        const fetched = missing.length
          ? (await Promise.all(missing.map(id => dbGetUserById(id)))).filter(Boolean) as User[]
          : [];
        fetched.forEach((u: User) => known.set(u.id, u));
        setViewers(ids.map((id: string) => known.get(id)).filter(Boolean) as User[]);
      } catch {
        showToast('Ошибка загрузки', 'error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [vacancyId]);

  const openChat = async (worker: User) => {
    if (!currentUser) return;
    setChatLoading(worker.id);
    try {
      // Чат теперь один на пару людей — ищем по собеседнику, а не по вакансии
      const existing = chats.find(c => c.employerId === currentUser.id && c.workerId === worker.id);
      if (existing) {
        onClose();
        router.push({ pathname: '/chat-room', params: { chatId: existing.id } });
        return;
      }
      const vacTitle = vacancy?.title ?? (kind === 'perm' ? 'Вакансия' : 'Смена');
      const companyName = vacancy?.company ?? currentUser.company ?? '';
      const greeting = `Здравствуйте, ${worker.firstName}! Вы смотрели вакансию «${vacTitle}». Хотелось бы предложить вам эту работу.`;
      const chatId = await dbCreateChat(worker.id, currentUser.id, vacancyId, vacTitle, companyName, greeting, 1, 0);
      refreshChats().catch(() => {});
      onClose();
      router.push({ pathname: '/chat-room', params: { chatId } });
    } catch {
      showToast('Ошибка при открытии чата', 'error');
    } finally {
      setChatLoading(null);
    }
  };

  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={wS.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[wS.sheet, viewersSwipe.animStyle]}>
          <View {...viewersSwipe.panHandlers}>
            <SheetHandle />
            <View style={wS.sheetHeader}>
              <SheetTitleIcon name="eye-outline" color={Colors.textSecondary} bg={Colors.divider} />
              <Text style={wS.sheetTitle}>Просмотрели вакансию</Text>
            </View>
          </View>
        {loading ? (
          // Чуть выше середины: ровно по центру пустой шторки крутилка
          // выглядит потерянной.
          <View style={wS.loaderWrap}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : viewers.length === 0 ? (
          <View style={wS.empty}>
            <EmptyIcon name="eye-off-outline" />
            <Text style={wS.emptyTxt}>Ещё никто не просмотрел</Text>
          </View>
        ) : (
          <FlatList
            data={viewers}
            keyExtractor={w => w.id}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            renderItem={({ item: w }) => {
              const color = nameColorFromString(w.id);
              const initials = getInitials(`${w.firstName} ${w.lastName}`);
              return (
                <View style={[wS.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                  <View style={[wS.avatar, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={wS.avatarTxt}>{initials}</Text>
                  </View>
                  <View style={wS.cardInfo}>
                    <Text style={wS.cardName}>{w.firstName} {w.lastName}</Text>
                    {w.metroStation ? <MetaBit name="subway-outline" text={w.metroStation} /> : null}
                  </View>
                  <TouchableOpacity
                    style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => openChat(w)}
                    disabled={chatLoading === w.id}
                    activeOpacity={0.8}
                  >
                    {chatLoading === w.id
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
                    }
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}
        </Animated.View>
      </View>
    </Modal>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Шторки откликов раньше подписывались смайликами: 👥 в заголовке, 👀 и 🙅
// в пустом состоянии, 📞 и 🚇 в строке под именем. Смайлик рисует не наш
// шрифт, а система: на каждом телефоне он свой, у половины — жёлтая рожица
// вместо смысла. Одинаковые иконки читаются одинаково везде.
function SheetTitleIcon({ name, color, bg }: { name: IconName; color: string; bg: string }) {
  return (
    <View style={[wS.titleIcon, { backgroundColor: bg }]}>
      <Ionicons name={name} size={rf(16)} color={color} />
    </View>
  );
}

function EmptyIcon({ name }: { name: IconName }) {
  return (
    <View style={wS.emptyIcon}>
      <Ionicons name={name} size={rf(26)} color={Colors.textMuted} />
    </View>
  );
}

// Строка «иконка + текст» для мелких подписей: метро, телефон, рейтинг, дата.
function MetaBit({ name, text, color }: { name: IconName; text: string; color?: string }) {
  return (
    <View style={wS.metaBit}>
      <Ionicons name={name} size={rf(12)} color={color ?? Colors.textMuted} />
      <Text style={[wS.metaTxt, color ? { color } : null]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const gB = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    backgroundColor: Colors.primary,
    paddingHorizontal: rs(14), paddingVertical: rs(9),
  },
  bannerTxt: { flex: 1, color: '#fff', fontSize: rf(12), fontWeight: '600' },
  bannerCta: {
    color: Colors.primary, backgroundColor: '#fff',
    fontSize: rf(12), fontWeight: '800',
    paddingHorizontal: rs(10), paddingVertical: rs(4), borderRadius: rs(8),
    overflow: 'hidden',
  },
});

const wS = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bg, borderTopLeftRadius: rs(24), borderTopRightRadius: rs(24), maxHeight: '85%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: rs(10), paddingHorizontal: rs(20), paddingTop: rs(16), paddingBottom: rs(8) },
  sheetTitle: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary },
  titleIcon: { width: rs(30), height: rs(30), borderRadius: rs(15), alignItems: 'center', justifyContent: 'center' },
  vacSubtitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10), flexWrap: 'wrap',
    paddingHorizontal: rs(20), paddingBottom: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  metaBit: { flexDirection: 'row', alignItems: 'center', gap: rs(4), flexShrink: 1 },
  metaTxt: { fontSize: rf(12), color: Colors.textMuted, flexShrink: 1 },
  empty: { alignItems: 'center', padding: rs(48), gap: rs(10) },
  emptyIcon: {
    width: rs(56), height: rs(56), borderRadius: rs(28),
    backgroundColor: Colors.divider, alignItems: 'center', justifyContent: 'center',
  },
  // Крутилка чуть выше середины: строго по центру пустой шторки она выглядит
  // потерянной, а взгляд при открытии идёт по верхней трети.
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: rs(90) },
  emptyTxt: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center' },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, padding: rs(14), gap: rs(10) },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  avatar: { width: rs(44), height: rs(44), borderRadius: rs(22) },
  avatarTxt: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
  name: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  meta: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2) },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10), marginTop: rs(3) },
  profileLink: { flexDirection: 'row', alignItems: 'center', gap: rs(1) },
  profileArrow: { fontSize: rf(12), color: Colors.primary, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: rs(8) },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: rs(4), marginTop: rs(3) },
  rejectionReason: { fontSize: rf(11), color: Colors.red, fontStyle: 'italic' },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', gap: rs(5), backgroundColor: Colors.primary, borderRadius: rs(100), paddingVertical: rs(9), paddingHorizontal: rs(14), justifyContent: 'center' },
  acceptBtnTxt: { fontSize: rf(13), color: '#fff', fontWeight: '700' },
  chatBtn: { flex: 1, backgroundColor: Colors.primary, borderRadius: rs(10), paddingVertical: rs(9), alignItems: 'center' },
  chatBtnTxt: { fontSize: rf(13), color: '#fff', fontWeight: '600' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
});

// ─────────────────────────────────────────────────
// Worker Permanent mode
// ─────────────────────────────────────────────────

// Засчитывает просмотр верхней карточки колоды «Работа».
//
// Раньше просмотр писался только в списочном режиме (onViewableItemsChanged у
// FlatList), а «Открытые»/«Избранное» давно стали свайп-колодой — и листание
// карточек не засчитывалось вовсе, число «Просмотрели» не росло. Здесь
// повторяем логику колоды смен: гость — событие аналитики, наша вакансия —
// запись в jm_perm_vacancy_views (сервер сам схлопывает дубли по паре
// vacancy_id+worker_id).
//
// Отдельным компонентом, а не useEffect в теле WorkerPermMode: там ниже есть
// ранний return (гость без currentUser), и хук после него нарушил бы порядок
// хуков.
function PermDeckViewRecorder({ vacancy, userId, isGuest }: {
  vacancy: PermVacancy | undefined;
  userId: string;
  isGuest: boolean;
}) {
  const vid = vacancy?.id;
  useEffect(() => {
    if (!vid) return;
    const t = setTimeout(() => {
      if (isGuest) {
        void dbRecordGuestEvent('vacancy_impression', { vacancyId: vid, vacancyKind: 'permanent' });
        return;
      }
      if (userId) dbRecordPermVacancyView(vid, userId).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [vid, userId, isGuest]);
  return null;
}

// Шапка ленты: марка и счётчик открытых вакансий. Поиск убран 27.09.2026
// (решение владельца, вместе с шестерёнкой и общей шторкой) — фильтрация
// теперь идёт через полосу чипов под шапкой, а не по слову. Освободившееся
// место не растягиваем пустотой: марка слева, кнопки справа, между ними
// гибкий пробел.
function FeedSearchHeader({ energy, onEnergyPress, query, onQuery }: {
  /** Сколько откликов осталось на сегодня. */
  energy: number;
  onEnergyPress: () => void;
  /** Поиск «Вакансия или стек» (доска «Лента вакансий», 27.09.2026). */
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <View style={[TAB_TOP.row, fh.row]}>
      <TabLogo />

      <View style={fh.search}>
        <Ionicons name="search" size={rs(18)} color={JT.ink} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Вакансия или стек"
          placeholderTextColor={JT.textTertiary}
          style={fh.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={120}
          accessibilityLabel="Поиск вакансий"
          testID="feed-search"
        />
        {query ? (
          <TouchableOpacity onPress={() => onQuery('')} hitSlop={8} accessibilityLabel="Очистить поиск">
            <Ionicons name="close-circle" size={rs(18)} color={JT.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Сколько откликов осталось на сегодня. Не «сколько вакансий»: число
          вакансий человеку ни о чём не говорит, а вот что запас кончается —
          говорит, и заранее, а не в момент стены. Пропуск молнию не тратит. */}
      <TouchableOpacity
        style={[fh.count, energy <= 0 && fh.countEmpty]}
        onPress={onEnergyPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Откликов осталось на сегодня: ${energy}`}
      >
        <JTBolt size={rs(20)} fill={energy > 0 ? JT.accent : JT.muted} />
        <Text style={[fh.countTxt, energy <= 0 && fh.countTxtEmpty]}>{energy}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Шапка ленты — макет JT-design: логотип JT слева, счётчик ⚡ — белая
// пилюля высотой 44 с чёрным контуром 2.
const fh = StyleSheet.create({
  // Поля и логотип — общие с «Откликами» и «Профилем» (TAB_TOP).
  row: { gap: rs(10), backgroundColor: JT.background },
  search: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: rs(8),
    height: rs(44), paddingHorizontal: rs(12), borderRadius: rs(22),
    backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink,
  },
  searchInput: {
    flex: 1, minWidth: 0, padding: 0, fontFamily: JT_FONT.bold, fontSize: rf(14), color: JT.ink,
  },
  count: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    backgroundColor: JT.surface, borderRadius: rs(22),
    borderWidth: 2, borderColor: JT.ink,
    paddingLeft: rs(10), paddingRight: rs(14), height: rs(44), flexShrink: 0,
  },
  countTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(17), color: JT.ink },
  countEmpty: { backgroundColor: JT.stack1 },
  countTxtEmpty: { color: JT.textTertiary },
});

/**
 * Нижний ряд под карточкой — макет JT-design: ↺ вернуть · ✕ пропустить ·
 * ♥ откликнуться · закладка. Большие кнопки — «наклейки»: чёрный контур и
 * жёсткая тень без размытия (чёрный круг со сдвигом 4 pt под кнопкой — так
 * она одинакова на iOS, Android и в вебе).
 */
function DeckActions({ bottom, onUndo, onSkip, onWant, saved, onSave }: {
  bottom: number;
  onUndo: (() => void) | null;
  onSkip: () => void;
  onWant: () => void;
  saved?: boolean;
  /** Нет — закладки у карточки нет (карьерные сохраняются следующим этапом). */
  onSave?: () => void;
}) {
  return (
    <View style={[da.wrap, { bottom }]} pointerEvents="box-none">
      <TouchableOpacity
        style={[da.small, !onUndo && da.disabled]}
        disabled={!onUndo}
        onPress={onUndo ?? undefined}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ disabled: !onUndo }}
        accessibilityLabel="Вернуть пропущенную вакансию"
      >
        <Ionicons name="arrow-undo" size={rs(22)} color={JT.ink} />
      </TouchableOpacity>

      <OnboardingTarget targetKey="worker.feed.reject">
        <View style={da.bigWrap}>
          <View style={da.bigShadow} />
          <TouchableOpacity
            style={[da.big, da.skip]}
            onPress={onSkip}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Пропустить вакансию"
          >
            <Ionicons name="close" size={rs(36)} color={JT.ink} />
          </TouchableOpacity>
        </View>
      </OnboardingTarget>

      <OnboardingTarget targetKey="worker.feed.apply">
        <View style={da.bigWrap}>
          <View style={da.bigShadow} />
          <TouchableOpacity
            style={[da.big, da.want]}
            onPress={onWant}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Откликнуться на вакансию"
          >
            <Ionicons name="heart" size={rs(32)} color={JT.ink} />
          </TouchableOpacity>
        </View>
      </OnboardingTarget>

      {onSave ? (
        <OnboardingTarget targetKey="worker.feed.save">
          <TouchableOpacity
            style={da.small}
            onPress={onSave}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Удалить из избранного' : 'Сохранить вакансию'}
          >
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={rs(22)} color={saved ? JT.accent : JT.ink} />
          </TouchableOpacity>
        </OnboardingTarget>
      ) : <View style={da.smallSpacer} />}
    </View>
  );
}

const da = StyleSheet.create({
  wrap: {
    position: 'absolute', left: rs(20), right: rs(20), zIndex: 20, elevation: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(18),
  },
  small: {
    width: rs(48), height: rs(48), borderRadius: rs(24),
    backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  smallSpacer: { width: rs(48), height: rs(48) },
  disabled: { opacity: 0.35 },
  bigWrap: { width: rs(72), height: rs(72) },
  bigShadow: {
    position: 'absolute', left: rs(4), top: rs(4),
    width: rs(68), height: rs(68), borderRadius: rs(34), backgroundColor: JT.ink,
  },
  big: {
    width: rs(68), height: rs(68), borderRadius: rs(34),
    borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  skip: { backgroundColor: JT.surface },
  want: { backgroundColor: JT.accent },
});

function WorkerPermMode() {
  const router = useRouter();
  // Шторка «Ответьте один раз» — см. maybeAskAnswers.
  const [askAnswers, setAskAnswers] = useState(false);
  const askedAnswers = useRef(false);
  const {
    currentUser, permVacancies, permApplications, updateUser,
    refreshPermVacancies, refreshPermApplications,
    refreshChats,
    showToast,
    permSavedIds, optimisticAddPermSaved, optimisticRemovePermSaved, exitGuest,
    backendOffline,
  } = useApp();
  const tabBarHeight = useBottomTabBarHeight();

  // Гость смотрит постоянные вакансии, но действовать не может — ведём на
  // регистрацию (см. соискательскую ленту смен).
  const isGuest = !!currentUser?.isGuest;
  const promptRegister = (context: {
    vacancyId?: string | null;
    vacancyKind?: 'shift' | 'permanent' | null;
  } = {}) => {
    void dbStartGuestRegistration(context);
    exitGuest();
    router.replace('/');
  };

  const [refreshing, setRefreshing] = useState(false);
  // Полоса чипов над колодой (решение владельца 27.09) заменяет шестерёнку и
  // общую шторку PermFilterSheet: один объект фильтров, шторка открывается
  // под конкретный чип. Поиск по слову, метро, график, разделы и сортировка
  // убраны совсем — решение владельца.
  // Фильтры — общее хранилище: их правят отдельные экраны app/filters/*
  // (макет «JT-filters»), лента только читает и сбрасывает крестиком.
  const filters = useAppliedFilters();
  const setFilters = setAppliedFilters;
  // Дневной запас свайпов и плашка «на сегодня всё».
  const energy = useEnergy(currentUser && !currentUser.isGuest ? currentUser.id : null);
  const [limitOpen, setLimitOpen] = useState(false);
  // Молнии кончились — лента закрыта до полуночи, как у Sorce (решение
  // владельца 02.10.2026). Листать без откликов значило бы пользоваться
  // лентой как бесплатным каталогом и откликаться по ссылке на сайте
  // работодателя. «Отклики», «Избранное» и чаты остаются открыты. Гостей не
  // закрываем: у них нет откликов, их ведёт стена регистрации.
  const feedLocked = energy.ready && energy.left <= 0 && !!currentUser && !currentUser.isGuest;
  // Есть ли что листать ниже в карточке: по этому рисуется подсказка.
  const [moreBelow, setMoreBelow] = useState(false);
  // Описание на карточке сначала компактное, как в референсе; по нажатию
  // раскрывается прямо внутри карточки, без отдельного экрана.
  const [expandedDescriptionId, setExpandedDescriptionId] = useState<string | null>(null);
  // Отдельно запоминаем, действительно ли текст занимает больше семи строк.
  // Проверять длину строки в символах ненадёжно: одна и та же длина на узком
  // экране может занимать вдвое больше строк.
  const [expandableDescriptionId, setExpandableDescriptionId] = useState<string | null>(null);
  const cardScrollRef = useRef<React.ComponentRef<typeof GHScrollView>>(null);
  const cardViewH = useRef(0);
  const cardContentH = useRef(0);
  const updateMoreBelow = useCallback((offsetY: number) => {
    setMoreBelow(cardContentH.current - cardViewH.current - offsetY > rs(24));
  }, []);
  const [applying, setApplying] = useState<string | null>(null);
  // Вакансия, по которой человек сейчас пишет отклик (null — окно закрыто)
  const [permApplyFor, setPermApplyFor] = useState<PermVacancy | null>(null);
  const [careerVacancies, setCareerVacancies] = useState<ExtVacancy[]>([]);
  // Сервер знает весь пул, а не только пришедшую порцию — «Всего N» и список
  // компаний в шторке считаются от него, не от того, что успело загрузиться.
  const [careerTotal, setCareerTotal] = useState(0);
  const [careerLoading, setCareerLoading] = useState(false);
  // Свои вакансии, смахнутые влево и записанные на сервере, — их колода
  // больше не показывает (та же идея, что у extLeftSwipes ниже).
  const [permSwiped, setPermSwiped] = useState<Set<string>>(new Set());
  const swDecisionPending = useRef(false);
  // Окно отклика открыто свайпом: молния уже списана, карточка ушла из колоды.
  // Закрыли окно без отправки — молнию возвращаем, карточку можно достать
  // «Вернуть». Раньше молния сгорала впустую.
  const permApplyFromSwipe = useRef(false);
  const permSavedMutationIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUser?.id || currentUser.isGuest) return;
    let cancelled = false;
    dbGetPermSwipes(currentUser.id).then(rows => {
      if (cancelled) return;
      setPermSwiped(new Set(rows.filter(r => r.dir === -1).map(r => r.vacancyId)));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.isGuest]);

  // Счёт компаний для шторки: свои (клиент) + карьерные (сервер, весь пул),
  // слитые по имени. Свои считаются при всех фильтрах, КРОМЕ самой компании —
  // иначе выбор одной компании убрал бы остальные из списка, как раньше было
  // с картой станций.

  // Карьерная лента фильтруется на сервере (php-proxy/ext_feed.php) — клиент
  // только передаёт текущий выбор и заменяет колоду целиком под ответ. Ключ —
  // строка, а не объект: объект фильтров новая ссылка на каждый рендер,
  // эффект гонял бы запрос без остановки.
  // Поиск уходит на сервер с паузой 400 мс после последней буквы — не
  // запрос на каждое нажатие. Пустая строка — поиска нет.
  const [searchText, setSearchText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);
  useEffect(() => { setFeedQuery(searchQuery); }, [searchQuery]);
  const extFilters = () => ({ ...toExtFeedFilters(filters), query: searchQuery });
  const filtersKey = JSON.stringify([filters, searchQuery]);
  // Поколение выборки: растёт при каждой смене фильтров. Дозагрузка, начатая
  // при прежних фильтрах, по возвращении видит чужое поколение и не
  // подмешивает карточки старого выбора в новую колоду.
  const careerGen = useRef(0);
  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;
    careerGen.current += 1;
    setCareerLoading(true);
    dbGetExtFeed(60, extFilters()).then(res => {
      if (cancelled) return;
      setCareerVacancies(res.items);
      setCareerTotal(res.total);
    }).catch(() => {
      if (cancelled) return;
      // Сбой под новыми чипами не должен оставлять колоду и «Всего N» от
      // прежнего выбора — иначе счётчик и карточки молча врут о том, что
      // сейчас выбрано. Пустое состояние само предложит обновить.
      setCareerVacancies([]);
      setCareerTotal(0);
      showToast('Не удалось обновить вакансии. Проверьте связь.', 'error');
    }).finally(() => { if (!cancelled) setCareerLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, filtersKey]);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const promises: Promise<void>[] = [
        refreshPermVacancies(), refreshPermApplications(),
        dbGetExtFeed(60, extFilters()).then(res => {
          setCareerVacancies(res.items);
          setCareerTotal(res.total);
          // swSkipped обнуляется, поэтому смахнутые за сессию свои переносим в
          // permSwiped — иначе они вернулись бы в колоду. Не при самом свайпе:
          // тогда своя пропадала бы из чередования и следующая своя вставала
          // сразу за ней, ломая порядок «своя, карьерная, карьерная».
          setPermSwiped(p => new Set([...p, ...permLeftSwipes.current]));
          setSwSkipped(new Set());
        }),
      ];
      await Promise.all(promises);
      await energy.sync();
    } catch {
      showToast('Не удалось обновить вакансии. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // Все hooks свайп-колоды объявлены до раннего возврата: порядок hooks
  // остаётся одинаковым и при выходе пользователя, и при загрузке сессии.
  const [swSkipped, setSwSkipped] = useState<Set<string>>(new Set());
  // Последняя пропущенная карточка — «вернуть» достаёт только её, один шаг
  // (решение владельца 26.09). После отклика возвращать нечего: он ушёл.
  const [swLastSkipped, setSwLastSkipped] = useState<string | null>(null);
  const swWantRef = useRef<(vx?: number) => void>(() => {});
  const swSkipRef = useRef<(vx?: number) => void>(() => {});
  const extSaved = useExtSaved();
  const extSavedIds = useMemo(() => new Set(extSaved.map(i => i.vacancy.id)), [extSaved]);
  const extSaving = useRef(new Set<string>());
  useEffect(() => {
    if (!currentUser?.id || currentUser.isGuest) return;
    // Сбой загрузки закладок не мешает ленте: кнопка просто без отметки.
    loadExtSaved(currentUser.id).catch(() => {});
  }, [currentUser?.id, currentUser?.isGuest]);
  // Возврат с «Вакансии подробно»: ✕ и «Откликнуться» там работают как свайп
  // (README макета). Смахиваем ту же карточку, если она всё ещё сверху;
  // пауза — чтобы анимация шла уже на видимом экране, а не под переходом.
  const topDeckIdRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const act = takeDeckAction();
      if (!act || topDeckIdRef.current !== act.id) return;
      const t = setTimeout(() => {
        if (act.action === 'want') swWantRef.current(0.5); else swSkipRef.current(0.5);
      }, 280);
      return () => clearTimeout(t);
    }, []),
  );
  // Тот же хук, что у колоды смен: свайп должен ощущаться одинаково на обеих
  // вкладках, а не жить двумя похожими копиями, которые разойдутся.
  const swDeck = useSwipeDeck({
    want: vx => swWantRef.current(vx),
    skip: vx => swSkipRef.current(vx),
  });

  // «Назад»: вернуть последнюю ПРОПУЩЕННУЮ карточку наверх колоды — одну, не
  // цепочку (решение владельца 26.09). Отклик не возвращается: он уже либо в
  // очереди Юпитера, либо ушёл работодателю. Молнию возврат не отдаёт — пропуск
  // её и не брал. Свайпы влево сервер запоминает навсегда, поэтому «вернуть»
  // снимает и запись.
  const extLeftSwipes = useRef<Set<string>>(new Set());
  const permLeftSwipes = useRef<Set<string>>(new Set());
  const swUndo = useCallback(() => {
    const last = swLastSkipped;
    if (!last) return;
    if (extLeftSwipes.current.has(last) && currentUser?.id) {
      extLeftSwipes.current.delete(last);
      dbExtUnswipe(currentUser.id, last).catch(() => {});
    } else if (permLeftSwipes.current.has(last) && currentUser?.id) {
      permLeftSwipes.current.delete(last);
      dbPermUnswipe(currentUser.id, last).catch(() => {});
      setPermSwiped(s => { const n = new Set(s); n.delete(last); return n; });
    }
    setSwSkipped(s => { const n = new Set(s); n.delete(last); return n; });
    setSwLastSkipped(null);
  }, [swLastSkipped, currentUser?.id]);

  // Карьерная лента приходит порциями: когда в колоде остаётся пять карт,
  // тихо берём следующую. Сервер уже не отдаёт свайпнутое, а на случай
  // гонки (свайп ещё не записан) повторы отсекаются по id.
  const careerRefilling = useRef(false);
  useEffect(() => {
    if (careerRefilling.current || careerVacancies.length === 0) return;
    const left = careerVacancies.filter(v => !swSkipped.has(v.id)).length;
    if (left > 5) return;
    careerRefilling.current = true;
    const gen = careerGen.current;
    dbGetExtFeed(60, extFilters())
      .then(res => gen === careerGen.current && setCareerVacancies(cur => {
        const seen = new Set(cur.map(v => v.id));
        const add = res.items.filter(v => !seen.has(v.id));
        return add.length ? [...cur, ...add] : cur;
      }))
      .catch(() => {})
      .finally(() => { careerRefilling.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerVacancies, swSkipped, filtersKey]);
  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  const myApps = permApplications.filter(a => a.workerId === currentUser.id);
  const myAppVacIds = new Set(myApps.map(a => a.vacancyId));
  // Поиск считается фильтром: «по вашим фильтрам», «ничего не нашлось», сброс.
  const permFiltersActive = isFilterActive(filters) || searchQuery !== '';

  // Каждый чип открывает свой отдельный экран: зарплата, специализация,
  // формат (макет), грейд и дата публикации (решение владельца 28.09.2026 —
  // как у остальных фильтров). Чёрная кнопка — «Фильтры» со всем сразу.
  const openFilterSheet = (kind: FilterSheetKind) => {
    if (kind === 'company') return;
    router.push({ pathname: `/filters/${kind}`, params: { from: 'feed' } });
  };
  const openAllFilters = () => {
    beginDraft();
    router.push('/filters');
  };
  const applyFilters = (next: FeedFilters) => setFilters(next);
  // «×» на включённом чипе сбрасывает ровно этот фильтр, не открывая шторку.
  const clearFilter = (kind: FilterSheetKind) => setFilters(f => {
    switch (kind) {
      case 'salary': return { ...f, salaryFrom: 0 };
      case 'spec': return { ...f, specs: [] };
      case 'level': return { ...f, levels: [] };
      case 'format': return { ...f, formats: [] };
      case 'company': return { ...f, companies: [] };
      case 'posted': return { ...f, posted: 'all' };
    }
  });

  // Лента показывает только открытые вакансии, на которые человек ещё не
  // откликался и не свайпнул влево. Свои отклики и избранное живут на экране
  // «Отклики»: колода здесь одна, и выбирать между списками больше не из чего.
  // Свои вакансии JobToo — тоже только IT (решение владельца 26.09.2026);
  // фильтры (зарплата, специализация, уровень, формат, компания, дата) —
  // одной чистой функцией из services/feedFilters.ts, той же, что тестируется
  // node:test-ом отдельно от React.
  const now = Date.now();
  const openVacancies = permVacancies.filter(v => v.status === 'open' && !myAppVacIds.has(v.id)
    && (!filters.hideSeen || !permSwiped.has(v.id))
    && sectionOfPerm(v.workType) === 'it' && matchOwnVacancy(v, filters, now)
    && matchesSearch(`${v.title} ${v.company} ${v.description ?? ''}`, searchQuery));

  // Своя лента ранжируется под вкус (виды работ, метро) и чередуется с
  // карьерной — «своя, карьерная, карьерная, своя, …» (services/feedMix.ts).
  // Карьерную сервер уже отфильтровал под тот же выбор (php-proxy/ext_feed.php)
  // — повторная фильтрация на клиенте дублировала бы его правила.
  const ownRanked = rankOwn(openVacancies, {
    sections: (currentUser.workTypes ?? []).map(wt => SECTION_BY_WORK_TYPE[wt]),
    metro: currentUser.metroStation ?? null,
  });
  const feedCards: FeedCard[] = interleaveDeck(ownRanked, careerVacancies).map(x =>
    x.own ? { _ext: false as const, v: x.v } : { _ext: true as const, v: x.v });
  // «Всего N вакансий» под полосой чипов: свои — тот же счёт, что и в колоде,
  // карьерные — честный счёт сервера по всему пулу, а не по пришедшей порции.
  const totalCount = openVacancies.length + careerTotal;

  // Сайт с капчей или анкетой на скрипте сервер откладывает в «Ждут вас».
  // Через ~40 с после свайпа проверяем заявку и, если она ждёт человека,
  // предлагаем открыть анкету: Юпитер заполнит её на глазах, отправит
  // человек сам (app/jupiter-fill.tsx). Не чаще раза в 2 минуты — листать
  // ленту это не должно мешать; остальные ждут в «Откликах».
  // Отклик на карьерную вакансию — через телефон (решение владельца
  // 28.09.2026): свайп только копит заявку в «Нужны вы», анкеты потом
  // заполняются пачкой в app/jupiter-fill.tsx. Перед свайпом — лишь проверка
  // резюме; заявка уходит в фоне, колода уже показывает следующую карточку.
  const prepareExtApply = async (): Promise<boolean> => {
    if (!currentUser || currentUser.isGuest) return false;
    try {
      return await ensureResumeForApply();
    } catch (e: any) {
      const msg = e?.message ?? '';
      console.warn('[prepareExtApply]', msg);
      showToast(msg || 'Не удалось проверить резюме. Проверьте связь.', 'error');
      return false;
    }
  };

  // «Ответьте один раз» (01.10.2026): после свайпа вправо, пока частые
  // вопросы работодателей не заполнены, — шторка, не чаще раза за сессию.
  const maybeAskAnswers = () => {
    if (!currentUser || askedAnswers.current) return;
    if (currentUser.personalDetails?.applyAnswersPromptDismissed) return;
    if (applyAnswersFilled(applyAnswersFor(currentUser)) >= 4) return;
    askedAnswers.current = true;
    setAskAnswers(true);
  };

  const sendExtApply = async (ev: ExtVacancy): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      const application = await jupiterEnqueue(currentUser.id, ev.url, ev.company);
      maybeAskAnswers();
      showToast(application.reasonCode === 'PHONE_FILL'
        ? 'Сохранено в «Нужны вы» — отправите пачкой в «Откликах».'
        : application.state === 'queued'
          ? 'Юпитер отправит отклик сам. Статус — в «Откликах».'
          : 'Заявка уже есть. Статус — в «Откликах».', 'success');
      return true;
    } catch (e: any) {
      const msg = e?.message ?? '';
      console.warn('[sendExtApply]', msg);
      const company = ev.company ? ` в ${ev.company}` : '';
      showToast(`Отклик${company} не отправлен${msg ? `: ${msg}` : ''}. Нажмите «Вернуть», чтобы попробовать ещё раз.`, 'error');
      return false;
    }
  };

  const applyTo = (v: PermVacancy) : void => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      promptRegister({ vacancyId: v.id, vacancyKind: 'permanent' });
      return;
    }
    if (myAppVacIds.has(v.id) || applying === v.id) {
      if (permApplyFromSwipe.current) { permApplyFromSwipe.current = false; energy.refundOne(); }
      showToast('Уже откликнулись', 'success');
      return;
    }
    setPermApplyFor(v);
  };

  const sendPermApply = async (message: string) => {
    const v = permApplyFor;
    if (!v || !currentUser) return;
    setApplying(v.id);
    try {
      await dbApplyPermVacancy(v.id, currentUser.id, v.employerId, message);
      showToast('Отклик отправлен', 'success');
      permApplyFromSwipe.current = false;
      setPermApplyFor(null);
      await Promise.all([
        refreshPermApplications().catch(() => {}),
        refreshChats().catch(() => {}),
      ]);
      // Уведомления отсюда больше нет: работодателя извещает сервер при
      // создании отклика («Новая заявка»). Этот вызов слал ВТОРОЕ уведомление
      // о том же событии — с другим заголовком, поэтому глушитель повторов в
      // notify_user его и не гасил.
    } catch (e: any) {
      console.warn('[applyTo]', e);
      showToast(e?.message || 'Не удалось отправить отклик', 'error');
      void energy.sync();
    } finally {
      setApplying(null);
    }
  };

  // Тот же набор, что видит директор в своей шторке, — и так же иконками,
  // а не смайликами: их рисует система, и на каждом телефоне по-своему.
  // Закладки карьерных вакансий (миграция 129): отметка читается из общего
  // хранилища services/extSaved.ts — оно же у «Вакансии подробно» и избранного.
  const toggleExtSave = async (v: ExtVacancy) => {
    if (!currentUser) return;
    if (currentUser.isGuest) { promptRegister({ vacancyKind: 'permanent' }); return; }
    if (extSaving.current.has(v.id)) return;
    extSaving.current.add(v.id);
    try {
      const now = await toggleExtSaved(currentUser.id, v);
      showToast(now ? 'Сохранено в избранное' : 'Убрано из избранного', 'success');
    } catch {
      showToast('Не удалось сохранить. Проверьте связь.', 'error');
    } finally {
      extSaving.current.delete(v.id);
    }
  };

  const toggleSaved = async (v: PermVacancy) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      promptRegister({ vacancyId: v.id, vacancyKind: 'permanent' });
      return;
    }
    if (permSavedMutationIds.current.has(v.id)) return;

    const wasSaved = permSavedIds.includes(v.id);
    permSavedMutationIds.current.add(v.id);

    try {
      // Избранное считается изменённым только после подтверждения сервера.
      // Иначе при обрыве сети карточка на секунду исчезает/появляется и человек
      // видит локальный успех, которого в базе на самом деле нет.
      if (wasSaved) {
        await dbRemovePermSaved(currentUser.id, v.id);
        optimisticRemovePermSaved(v.id);
        showToast('Удалено из избранного', 'success');
      } else {
        await dbAddPermSaved(currentUser.id, v.id);
        optimisticAddPermSaved(v.id);
        showToast('Сохранено в избранное', 'success');
      }
    } catch {
      showToast(wasSaved ? 'Не удалось удалить из избранного' : 'Не удалось сохранить в избранное', 'error');
    } finally {
      permSavedMutationIds.current.delete(v.id);
    }
  };

  const shareVacancy = async (v: PermVacancy) => {
    const shareCampaignId = Crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    // Адрес сайта, а не ссылка мини-приложения: t.me открывается только в
    // Телеграме, а у многих его нет. Метка c= доезжает до экрана вакансии.
    const url = `https://jobtoo.ru/v/${encodeURIComponent(v.id)}?c=${shareCampaignId}`;
    const message = [
      `${v.title} — ${v.company}`,
      v.metroStation ? `м. ${v.metroStation}` : '',
      `${v.salary.toLocaleString('ru-RU')} ₽/мес`,
      url,
    ].filter(Boolean).join('\n');
    try {
      const result = await Share.share(
        Platform.OS === 'ios' ? { message: message.replace(`\n${url}`, ''), url } : { message },
      );
      if (result.action !== Share.dismissedAction) {
        void dbRecordGuestEvent('campaign_shared', {
          vacancyId: v.id,
          vacancyKind: 'permanent',
          campaignId: shareCampaignId,
          channel: 'user_share',
        });
      }
    } catch {
      // Отмена системного окна «Поделиться» не должна показывать ошибку.
    }
  };

  // ── Свайп-колода ───────────────────────────────────────────────────────────
  // Верхняя открытая вакансия — карточка: вправо откликнуться, влево
  // пропустить. Последняя пропущенная — в swLastSkipped, её и возвращает
  // кнопка в шапке.
  const deckCards = feedCards.filter(c => !swSkipped.has(c.v.id));
  const swTop = deckCards[0] ?? null;

  /** Новая карточка начинается сверху, а не там, где бросили предыдущую. */
  const resetCardScroll = () => {
    cardScrollRef.current?.scrollTo({ y: 0, animated: false });
    setMoreBelow(false);
    setExpandedDescriptionId(null);
    setExpandableDescriptionId(null);
  };
  const swFly = swDeck.flyOut;

  // Вправо — принять: отклик (уходит в «Отклики» → матчи, ждёт ответа). В
  // «Избранном» вдобавок убираем из избранного.
  const swWant = (vx = 0.5) => {
    const c = swTop;
    if (!c || swDecisionPending.current) return;
    if (c._ext && isGuest) {
      promptRegister({ vacancyKind: 'permanent' });
      swDeck.snapBack();
      return;
    }
    if (!energy.spendOne()) { setLimitOpen(true); swDeck.snapBack(); return; }
    swDecisionPending.current = true;
    swFly('right', vx, () => {
      if (c._ext) {
        const ev = c.v;
        void prepareExtApply().then(ready => {
          if (!ready) {
            energy.refundOne();
            swDeck.snapBack();
            return;
          }
          resetCardScroll();
          setSwSkipped(s => new Set(s).add(ev.id));
          setSwLastSkipped(null);
          // Колода уже свободна; заявка догоняет в фоне. Не дошла — молния
          // возвращается, а карточку можно достать кнопкой «Вернуть» (отклика
          // не было, возвращать есть что). Свайп записываем только после
          // успеха: иначе сервер спрятал бы вакансию, на которую никто не
          // откликнулся.
          void sendExtApply(ev).then(sent => {
            if (sent) {
              dbExtSwipe(currentUser.id, ev.id, 1).catch(() => {});
            } else {
              energy.refundOne();
              setSwLastSkipped(ev.id);
              // Отказ мог быть из-за запаса на сервере (отклики с другого
              // устройства) — сверяемся, чтобы шапка не обещала лишнего.
              void energy.sync();
            }
          });
        }).finally(() => { swDecisionPending.current = false; });
      } else if (currentUser.isGuest) {
        // Гостя applyTo сам отправит на регистрацию — резюме у него ещё нет
        // и быть не может, проверять раньше стены регистрации незачем.
        resetCardScroll();
        setSwSkipped(s => new Set(s).add(c.v.id));
        setSwLastSkipped(null);
        applyTo(c.v);
        swDecisionPending.current = false;
      } else {
        void ensureResumeForApply().then(hasResume => {
          if (hasResume) {
            resetCardScroll();
            setSwSkipped(s => new Set(s).add(c.v.id));
            setSwLastSkipped(null);
            permApplyFromSwipe.current = true;
            applyTo(c.v);
          } else {
            energy.refundOne();
            swDeck.snapBack();
          }
        }).catch(e => {
          console.warn('[swWant]', e);
          showToast(e?.message || 'Не удалось проверить резюме. Проверьте связь.', 'error');
          energy.refundOne();
          swDeck.snapBack();
        }).finally(() => { swDecisionPending.current = false; });
      }
    });
  };
  const swSkip = (vx = 0.5) => {
    const c = swTop;
    if (!c || swDecisionPending.current) return;
    if (isGuest) {
      if (guestSkipCount >= GUEST_SKIP_LIMIT) {
        promptRegister({ vacancyKind: 'permanent' });
        swDeck.snapBack();
        return;
      }
      guestSkipCount += 1;
    }
    // Пропуск бесплатный: молния — цена отклика, а не просмотра (решение
    // владельца 26.09). Листать ленту можно и с пустым запасом.
    swDecisionPending.current = true;
    swFly('left', vx, () => {
      resetCardScroll();
      setSwSkipped(s => new Set(s).add(c.v.id));
      setSwLastSkipped(c.v.id);
      // Карьерную вакансию, смахнутую влево, больше не показываем (решение
      // владельца 25.09): сервер запоминает свайп и опускает похожие. Свою —
      // тоже запоминаем, тем же способом, что и карьерные.
      if (c._ext && !isGuest && currentUser) {
        extLeftSwipes.current.add(c.v.id);
        dbExtSwipe(currentUser.id, c.v.id, -1).catch(() => {});
      } else if (!c._ext && !isGuest && currentUser) {
        permLeftSwipes.current.add(c.v.id);
        dbPermSwipe(currentUser.id, c.v.id, -1).catch(() => {});
      }
      swDecisionPending.current = false;
    });
  };
  swWantRef.current = swWant;
  swSkipRef.current = swSkip;

  topDeckIdRef.current = deckCards[0]?.v.id ?? null;

  // Ряд ↺ / ✕ / ♥ / закладка стоит над таббаром с зазором, карточка — над
  // рядом с запасом под края двух «призраков» колоды (до 17pt), как в макете.
  const deckActionGap = rs(12);
  const deckCardGap = rs(26);
  const deckActionSize = rs(68);
  const deckActionBottom = tabBarHeight + deckActionGap;
  const deckBottomReserve = deckActionBottom + deckActionSize + deckCardGap;

  // Карточка колоды «Работа» — тот же макет, что у смены: рамка во весь экран,
  // чипы с иконками, снизу футер undo / ✕ / чат / ♥.
  const renderPermDeckCard = (v: PermVacancy) => {
    const displayCompany = normalizeCompany(v.company);
    const salary = typeof v.salary === 'number' ? v.salary : 0;
    const schedule = v.schedule;
    const workTypeRaw = v.workType;
    // Профессия хранится кодом (stocker/cook/…) — показываем русское название.
    const workType = workTypeRaw ? (WORK_TYPE_META[workTypeRaw]?.label ?? workTypeRaw) : undefined;
    const description = cleanDescription(v.description);
    const posted = agoRu(v.createdAt);
    const metroLine = v.metroStation
      ? METRO_LINES.find(l => l.stations.includes(v.metroStation!)) ?? null
      : null;
    return (
      <View style={[styles.cardArea, { paddingBottom: deckBottomReserve }]}>
        {deckCards[2] ? <View style={[styles.ghost2, { bottom: deckBottomReserve }]} /> : null}
        {deckCards[1] ? <View style={[styles.ghost1, { bottom: deckBottomReserve }]} /> : null}
        {/* Один список на два дела: потягивание вниз обновляет ленту, а длинная
            вакансия листается внутри карточки.

            В правилах фронтенда записано «не вкладывать прокрутку в то, что
            двигается по жесту» — правило верное, но писалось про PanResponder,
            который не умел отдавать уже взятый жест. У gesture-handler для
            этого есть failOffsetY: палец, ушедший на двадцать пикселей вниз,
            не набрав восьми вбок, отменяет свайп и достаётся списку. Список
            здесь стоял и раньше, ради RefreshControl, и со свайпом уживался —
            новым стало только то, что теперь в нём есть что прокручивать.

            «Призраки» колоды остались снаружи: они позиционированы абсолютно
            от области карточек, и внутри списка их отступы сложились бы с её
            внутренними полями. */}
        <OnboardingTarget targetKey="worker.feed.card" style={styles.cardViewportShell}>
          <Reanimated.View style={[styles.deckSwipeLayer, swDeck.cardStyle]}>
          <View style={styles.cardSticker} pointerEvents="none" />
          <GHScrollView
            ref={cardScrollRef}
            style={styles.cardViewportClip}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onLayout={e => { cardViewH.current = e.nativeEvent.layout.height; updateMoreBelow(0); }}
            onContentSizeChange={(_w, h) => { cardContentH.current = h; updateMoreBelow(0); }}
            onScroll={e => updateMoreBelow(e.nativeEvent.contentOffset.y)}
            refreshControl={<GHRefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
          >
          <GestureDetector gesture={swDeck.gesture}>
            <Reanimated.View style={styles.cardAnimated}>
              <View style={styles.card}>
                {/* Тело карточки — не кнопка. Вся вакансия здесь, открывать
                    нечего, а нажатие на всю площадь срабатывало на отпускании
                    после прокрутки и уводило со страницы. */}
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    {/* Верх карточки — как в референсе: отдельный знак компании,
                        справа служебные кнопки, ниже крупная должность и компания. */}
                    <View style={styles.cardLogoRow}>
                      <View style={styles.companyLogoSpacer} />
                      <View style={pS.deckUtilitySpacer} />
                    </View>

                    <Text style={styles.jobTitle} numberOfLines={2}>{v.title}</Text>

                    <View style={styles.companyMetaLine}>
                      <Ionicons name="business-outline" size={15} color={Colors.textMuted} />
                      <Text style={styles.companyName} numberOfLines={1}>{displayCompany}</Text>
                      {posted ? <Text style={styles.postedAgo}>· {posted}</Text> : null}
                    </View>

                    <View style={styles.chipsRow}>
                      {salary > 0 ? <Chip label={`${salary.toLocaleString('ru-RU')} ₽/мес`} variant="salary" icon="wallet-outline" textSize={11} /> : null}
                      <Chip label="На руки" variant="neutral" icon="checkmark-circle-outline" textSize={11} />
                      {schedule ? <Chip label={schedule} variant="neutral" icon="calendar-outline" textSize={11} /> : null}
                      {workType ? <Chip label={workType} variant="neutral" icon="briefcase-outline" textSize={11} /> : null}
                      {v.metroStation ? <Chip label={v.metroStation} variant="neutral" icon="subway-outline" textSize={11} /> : null}
                    </View>
                  </View>

                  <View style={styles.cardDivider} />

                  <View style={styles.cardMiddle}>
                    {description ? (
                      <View style={pS.descriptionPanel}>
                        <Text style={pS.descriptionPanelTitle}>Описание вакансии</Text>

                        {/* Невидимая копия измеряет реальное число строк без
                            numberOfLines. Так кнопка появляется именно тогда,
                            когда текст действительно обрезан на этом экране. */}
                        <Text
                          style={[pS.desc, pS.descriptionMeasure]}
                          accessible={false}
                          pointerEvents="none"
                          onTextLayout={e => {
                            if (e.nativeEvent.lines.length > 7 && expandableDescriptionId !== v.id) {
                              setExpandableDescriptionId(v.id);
                            }
                          }}
                        >
                          {description}
                        </Text>

                        <Text
                          style={pS.desc}
                          numberOfLines={expandedDescriptionId === v.id ? undefined : 7}
                        >
                          {description}
                        </Text>

                        {(description.trim().length > 120 ||
                          expandableDescriptionId === v.id ||
                          expandedDescriptionId === v.id) ? (
                          <TouchableOpacity
                            style={pS.descriptionToggle}
                            activeOpacity={0.78}
                            onPress={() => setExpandedDescriptionId(id => id === v.id ? null : v.id)}
                            accessibilityRole="button"
                            accessibilityLabel={expandedDescriptionId === v.id ? 'Свернуть описание вакансии' : 'Читать описание вакансии полностью'}
                          >
                            <Text style={pS.descriptionToggleText}>
                              {expandedDescriptionId === v.id ? 'Свернуть' : 'Читать далее'}
                            </Text>
                            <Ionicons
                              name={expandedDescriptionId === v.id ? 'chevron-up' : 'chevron-down'}
                              size={16}
                              color={Colors.textSecondary}
                            />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}

                    {(v.metroStation || v.address) ? (
                      <View style={pS.sectionBlock}>
                        <View style={pS.blockHead}>
                          <Ionicons name="location-outline" size={16} color={Colors.textPrimary} />
                          <Text style={pS.descTitle}>Расположение</Text>
                        </View>
                        {v.metroStation ? (
                          <View style={pS.locRow}>
                            {metroLine ? (
                              <View style={[pS.metroDot, { backgroundColor: metroLine.color }]} />
                            ) : (
                              <Ionicons name="subway-outline" size={16} color={Colors.textMuted} />
                            )}
                            <View style={{ flex: 1 }}>
                              {metroLine ? <Text style={pS.metroLineName}>{metroLine.name}</Text> : null}
                              <Text style={pS.locValue}>{v.metroStation}</Text>
                            </View>
                          </View>
                        ) : null}
                        {v.address ? (
                          <View style={pS.locRow}>
                            <Ionicons name="location-outline" size={16} color={Colors.textMuted} />
                            <Text style={[pS.locValue, { flex: 1 }]}>{v.address}</Text>
                          </View>
                        ) : null}
                        {v.lat != null && v.lng != null ? (
                          <TouchableOpacity
                            style={pS.mapBtn}
                            activeOpacity={0.85}
                            onPress={() => {
                              if (swDeck.wasSwipe()) return;
                              Linking.openURL(`https://yandex.ru/maps/?rtext=~${v.lat},${v.lng}&rtt=mt`).catch(() => {});
                            }}
                          >
                            <Ionicons name="navigate-outline" size={16} color={Colors.primary} />
                            <Text style={pS.mapBtnTxt}>Смотреть на карте</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </Reanimated.View>
          </GestureDetector>

          {/* The company logo is deliberately outside the card Pan gesture.
              Its 72×72 hit target covers the whole visible logo plus padding,
              so every part of the mark opens the company reliably. */}
          <TouchableOpacity
            style={pS.deckCompanyLogoOverlay}
            activeOpacity={0.78}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Открыть компанию ${displayCompany}`}
            onPress={() => {
              router.navigate({ pathname: '/(tabs)/company', params: { company: displayCompany } });
            }}
          >
            <CompanyMark company={v.company} size={52} />
          </TouchableOpacity>
          </GHScrollView>

          {/* Закладка переехала в нижний ряд (макет JT-design), здесь —
              только «поделиться». */}
          <View
            style={pS.deckUtilityOverlay}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Поделиться вакансией"
              style={pS.deckUtilityTap}
              onPress={() => { void shareVacancy(v); }}
              activeOpacity={0.7}
            >
              <View style={pS.deckUtilityBtn}>
                <Ionicons name="share-outline" size={21} color={Colors.textSecondary} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Swipe decision labels live above every interactive overlay
              (logo, bookmark, share) so they are always on the visual front. */}
          <Reanimated.View
            pointerEvents="none"
            style={[styles.wantOverlay, swDeck.wantStyle]}
          >
            <Text style={styles.wantText}>ОТКЛИК</Text>
          </Reanimated.View>
          <Reanimated.View
            pointerEvents="none"
            style={[styles.skipOverlay, swDeck.skipStyle]}
          >
            <Text style={styles.skipText}>НЕТ</Text>
          </Reanimated.View>
          </Reanimated.View>
        </OnboardingTarget>

        {moreBelow ? (
          // Подсказка стоит не поверх текста, а на его растворении: у нижнего
          // края карточки строки уходят в её цвет, и по одному этому видно, что
          // текст продолжается. Градиент из expo-linear-gradient — он уже в
          // сборке (app/+not-found.tsx), нового нативного модуля нет.
          <View style={[pS.scrollHintWrap, { bottom: deckBottomReserve }]} pointerEvents="none">
            <LinearGradient
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.92)', Colors.bg]}
              style={StyleSheet.absoluteFill}
            />
            <View style={pS.scrollHint}>
              <Ionicons name="chevron-down" size={14} color={Colors.textSecondary} />
              <Text style={pS.scrollHintTxt}>Листайте вниз</Text>
            </View>
          </View>
        ) : null}

        <DeckActions
          bottom={deckActionBottom}
          onUndo={swLastSkipped ? swUndo : null}
          onSkip={() => swSkip(0.5)}
          onWant={() => swWant(0.5)}
          saved={permSavedIds.includes(v.id)}
          onSave={() => { void toggleSaved(v); }}
        />
      </View>
    );
  };

  // Карьерная карточка — макет JT-design 1:1: «наклейка» (контур и жёсткая
  // тень), знак компании 44, заголовок Unbounded, плашки «место · формат ·
  // уровень · зарплата», описание обрезано с растворением и кнопкой
  // «Подробнее». «Подробнее» раскрывает вакансию целиком — описание по
  // разделам и расположение, — и её листают внутри карточки тем же списком
  // (card_scroll_test). Вся карточка двигается одним слоем, как своя.
  const renderExtDeckCard = (ev: ExtVacancy) => {
    const displayCompany = ev.company || 'Карьерный сайт';
    const salary = typeof ev.salary === 'number' ? ev.salary : 0;
    // Чипа «вид работ» у карьерной вакансии нет: наши четыре вида — про смены
    // линейного персонала, а старые строки базы угадывали его по названию
    // («Старший разработчик» → «Старший смены»).
    const description = cleanDescription(ev.description ?? undefined);
    const posted = agoRu(ev.firstSeenAt);
    const levelId = vacancyLevel(ev.title);
    const level = levelId ? VACANCY_LEVELS.find(x => x.id === levelId)?.label ?? null : null;
    const formatId = vacancyFormat(ev.schedule, ev.description);
    const format = formatId ? VACANCY_FORMATS.find(x => x.id === formatId)?.label ?? null : null;
    // Лента только по Москве (миграция 121): без метро место — «Москва».
    const place = ev.metroStation ? `м. ${ev.metroStation}` : 'Москва';
    // «Подробнее» — на отдельный экран (макет «JT-auth-and-details» 04):
    // карточка сама не прокручивается, как на макете ленты.
    const openDetails = () => {
      if (swDeck.wasSwipe()) return;
      openExtVacancy(ev);
      router.push({ pathname: '/ext-vacancy', params: { id: ev.id } });
    };
    return (
      <View style={[styles.cardArea, { paddingBottom: deckBottomReserve }]}>
        {deckCards[2] ? <View style={[styles.ghost2, { bottom: deckBottomReserve }]} /> : null}
        {deckCards[1] ? <View style={[styles.ghost1, { bottom: deckBottomReserve }]} /> : null}
        <View style={styles.cardViewportShell}>
          <Reanimated.View style={[styles.deckSwipeLayer, swDeck.cardStyle]}>
          <View style={styles.cardSticker} pointerEvents="none" />
          <GestureDetector gesture={swDeck.gesture}>
            <View style={styles.cardViewportClip}>
              <View style={jt.head}>
                <CompanyMark company={displayCompany} size={rs(44)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={jt.company} numberOfLines={1}>{displayCompany}</Text>
                  <Text style={jt.meta} numberOfLines={1}>
                    {posted ? `Карьерный сайт · ${posted}` : 'Карьерный сайт'}
                  </Text>
                </View>
              </View>

              <Text style={jt.title} numberOfLines={3}>{ev.title}</Text>

              <View style={jt.tags}>
                <View style={jt.tag}>
                  <Ionicons name="location-outline" size={rs(16)} color={JT.ink} />
                  <Text style={jt.tagTxt} numberOfLines={1}>{place}</Text>
                </View>
                {format ? <View style={jt.tag}><Text style={jt.tagTxt}>{format}</Text></View> : null}
                {level ? <View style={jt.tag}><Text style={jt.tagTxt}>{level}</Text></View> : null}
                <View style={[jt.tag, jt.tagSalary]}>
                  <Text style={jt.tagTxt} numberOfLines={1}>
                    {salary > 0
                      ? `${salary.toLocaleString('ru-RU')} ₽/${ev.payPeriod === 'hour' ? 'ч' : 'мес'}`
                      : 'з/п не указана'}
                  </Text>
                </View>
              </View>

              {description ? (
                <Text style={jt.preview}>{previewText(description)}</Text>
              ) : null}

              {/* Низ карточки по макету: растворение 84 pt и «Подробнее» поверх —
                  остаток описания обрезается карточкой, а не прокручивается. */}
              <View style={jt.moreDock}>
                <LinearGradient
                  colors={['rgba(255,255,255,0)', JT.surface, JT.surface]}
                  locations={[0, 0.62, 1]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <TouchableOpacity
                  style={jt.moreBtn}
                  activeOpacity={0.8}
                  onPress={openDetails}
                  accessibilityRole="button"
                  accessibilityLabel="Подробнее о вакансии"
                  testID="card-more"
                >
                  <Text style={jt.moreTxt}>Подробнее</Text>
                  <Ionicons name="chevron-down" size={rs(14)} color={JT.ink} />
                </TouchableOpacity>
              </View>
            </View>
          </GestureDetector>

          <Reanimated.View pointerEvents="none" style={[styles.wantOverlay, swDeck.wantStyle]}>
            <Text style={styles.wantText}>ОТКЛИК</Text>
          </Reanimated.View>
          <Reanimated.View pointerEvents="none" style={[styles.skipOverlay, swDeck.skipStyle]}>
            <Text style={styles.skipText}>НЕТ</Text>
          </Reanimated.View>
          </Reanimated.View>
        </View>

        <DeckActions
          bottom={deckActionBottom}
          onUndo={swLastSkipped ? swUndo : null}
          onSkip={() => swSkip(0.5)}
          onWant={() => swWant(0.5)}
          saved={extSavedIds.has(ev.id)}
          onSave={() => { void toggleExtSave(ev); }}
        />
      </View>
    );
  };

  return (
    <JTPullRefresh refreshing={refreshing} onRefresh={onRefresh}>
    <View style={{ flex: 1 }}>
      {isGuest && (
        <TouchableOpacity style={gB.banner} activeOpacity={0.85} onPress={() => promptRegister({ vacancyKind: 'permanent' })}>
          <Ionicons name="lock-closed" size={rs(15)} color="#fff" />
          <Text style={gB.bannerTxt}>Вы смотрите как гость. Зарегистрируйтесь, чтобы откликаться</Text>
          <Text style={gB.bannerCta}>Войти</Text>
        </TouchableOpacity>
      )}

      <FeedSearchHeader
        energy={energy.left}
        onEnergyPress={() => setLimitOpen(true)}
        query={searchText}
        onQuery={setSearchText}
      />

      {/* Полоса чипов вместо шестерёнки и общей шторки (решение владельца
          27.09.2026): всегда на экране, даже когда колода пуста или ещё
          грузится — иначе пустой фильтр был бы тупиком. */}
      <OnboardingTarget targetKey="worker.feed.filter">
        <FilterChipsBar filters={filters} onOpen={openFilterSheet} onClear={clearFilter} onOpenAll={() => openAllFilters()} />
      </OnboardingTarget>
      {/* Пустая колода без загрузки прячет счётчик: он мог остаться от
          прежнего выбора чипов (свежий пул ещё не разложился в карточки),
          и «Всего 120» рядом с «По фильтрам ничего не нашлось» читалось бы
          как противоречие, а не справка. */}
      {(swTop || careerLoading) ? (
        <Text style={pS.totalTxt} testID="feed-total">
          {careerLoading ? 'Считаем вакансии…'
            : permFiltersActive ? `${totalCount.toLocaleString('ru-RU')} ${pluralVacancies(totalCount)} по вашим фильтрам`
            : `Всего ${totalCount.toLocaleString('ru-RU')} ${pluralVacancies(totalCount)}`}
        </Text>
      ) : null}

      {backendOffline ? (
        <View style={pS.offlineBar}>
          <Ionicons name="cloud-offline-outline" size={rs(18)} color={JT.ink} />
          <Text style={pS.offlineTxt}>
            <Text style={pS.offlineStrong}>Нет связи с сервером.</Text> Показаны последние данные — потяните вниз, чтобы обновить.
          </Text>
        </View>
      ) : null}

      {/* Запас откликов кончился. Плашка появляется и по нажатию на счётчик, и
          на каждой новой попытке откликнуться — молча не пускать хуже, чем
          объяснить. Пока монетизации нет, выхода из неё, кроме «завтра», не
          предлагаем: обещать покупку, которой не существует, нельзя. */}
      {limitOpen ? (
        <View style={pS.limitOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setLimitOpen(false)} />
          <HardShadowBox style={pS.limitWrap} offset={6} radius={rs(28)}>
            <View style={pS.limitCard}>
              <View style={pS.limitIcon}>
                <JTBolt size={rs(36)} />
              </View>
              {/* Та же плашка открывается и по нажатию на счётчик, когда молнии
                  ещё есть, — тогда «на сегодня всё» было бы неправдой. */}
              <Text style={pS.limitTitle}>{energy.left > 0 ? 'Молния — это отклик' : 'На сегодня всё'}</Text>
              <Text style={pS.limitBody}>
                {energy.left > 0
                  ? 'Каждый отклик тратит одну молнию, а пропуск вакансии — бесплатный. '
                  : 'Отклики на сегодня закончились, и лента закрыта до полуночи — '
                    + 'откроется вместе с новыми молниями. '}
                Завтра снова будет {DAILY_ENERGY} — запас не копится.
              </Text>
              <View style={pS.limitStats}>
                <View style={pS.limitStat}>
                  <Text style={pS.limitStatNum}>{energy.left}</Text>
                  <Text style={pS.limitStatLbl}>осталось сегодня</Text>
                </View>
                <View style={pS.limitStat}>
                  <Text style={pS.limitStatNum}>00:00</Text>
                  <Text style={pS.limitStatLbl}>снова {DAILY_ENERGY}</Text>
                </View>
              </View>
              <HardShadowBox style={pS.limitBtnWrap} offset={4} radius={rs(29)}>
                <TouchableOpacity
                  style={pS.limitBtn}
                  onPress={() => { setLimitOpen(false); router.push('/(tabs)/matches'); }}
                  activeOpacity={0.85}
                >
                  <Text style={pS.limitBtnTxt}>Посмотреть свои отклики</Text>
                </TouchableOpacity>
              </HardShadowBox>
              <TouchableOpacity style={pS.limitClose} onPress={() => setLimitOpen(false)} activeOpacity={0.7}>
                <Text style={pS.limitCloseTxt}>Закрыть</Text>
              </TouchableOpacity>
            </View>
          </HardShadowBox>
        </View>
      ) : null}

      {/* Лента — всегда колода: вкладок «Отклики»/«Избранное» здесь больше нет,
          они уехали на свой экран, и списочный режим стал недостижим. */}
      {feedLocked ? (
        // Лента закрыта до полуночи. Прокрутка — ради «потяните вниз»: после
        // полуночи обновление пересчитает запас и откроет колоду.
        <ScrollView
          contentContainerStyle={[styles.emptyState, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
          testID="feed-locked"
        >
          <JTBolt size={rs(48)} fill={JT.muted} />
          <Text style={styles.emptyTitle}>На сегодня всё</Text>
          <Text style={styles.emptySubtitle}>
            {`Все ${DAILY_ENERGY} откликов на сегодня отправлены. Лента откроется в полночь — вместе с новыми молниями.`}
          </Text>
          <TouchableOpacity style={pS.retryBtn} activeOpacity={0.85} onPress={() => router.push('/(tabs)/matches')}>
            <Text style={pS.retryTxt}>Посмотреть свои отклики</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : !swTop ? (
        // Пустое состояние делаем прокручиваемым, иначе «потяните вниз»
        // некуда тянуть — жест обновления не срабатывал (особенно офлайн).
        <ScrollView
          contentContainerStyle={[styles.emptyState, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        >
          <Ionicons name={backendOffline ? 'cloud-offline-outline' : careerLoading ? 'hourglass-outline' : 'search-outline'} size={48} color={JT.ink} />
          <Text style={styles.emptyTitle}>
            {backendOffline ? 'Нет связи с сервером'
              : careerLoading ? 'Загружаем вакансии…'
              : permFiltersActive ? 'По фильтрам ничего не нашлось'
              : 'Нет открытых вакансий'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {backendOffline ? 'Показаны последние данные. Потяните вниз, чтобы обновить.'
              : careerLoading ? ''
              : permFiltersActive ? 'Измените или сбросьте фильтры'
              : 'Потяните вниз, чтобы обновить'}
          </Text>
          {backendOffline ? (
            <TouchableOpacity style={pS.retryBtn} activeOpacity={0.85} onPress={onRefresh}>
              <Ionicons name="refresh" size={16} color={JT.ink} />
              <Text style={pS.retryTxt}>Попробовать снова</Text>
            </TouchableOpacity>
          ) : !careerLoading && permFiltersActive ? (
            // Полоса чипов всегда на экране (в отличие от прежней шестерёнки
            // в ряду под карточкой) — пустой колоде здесь нужен только сброс,
            // менять фильтры можно прямо по чипам сверху.
            <TouchableOpacity
              style={pS.retryBtn}
              activeOpacity={0.85}
              onPress={() => { applyFilters(EMPTY_FEED_FILTERS); setSearchText(''); setSearchQuery(''); }}
              accessibilityLabel="Сбросить фильтры"
              testID="empty-reset-filters"
            >
              <Text style={pS.retryTxt}>Сбросить фильтры</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : swTop._ext ? (
        <>{renderExtDeckCard(swTop.v)}</>
      ) : (
        <>
          <PermDeckViewRecorder vacancy={swTop.v} userId={currentUser.id} isGuest={isGuest} />
          {renderPermDeckCard(swTop.v)}
        </>
      )}

      <ApplySheet
        visible={!!permApplyFor}
        onClose={() => {
          if (permApplyFromSwipe.current && permApplyFor) {
            permApplyFromSwipe.current = false;
            energy.refundOne();
            setSwLastSkipped(permApplyFor.id);
          }
          setPermApplyFor(null);
        }}
        onSend={sendPermApply}
        title="Отклик на вакансию"
        info={permApplyFor ? permVacancyInfoLines(permApplyFor) : []}
        chips={getChatSuggestions('worker', null)}
      />

      <ApplyAnswersPrompt
        visible={askAnswers}
        onAnswer={() => { setAskAnswers(false); router.push('/profile-edit/apply-answers' as never); }}
        onLater={() => setAskAnswers(false)}
        onNever={() => {
          setAskAnswers(false);
          if (currentUser) {
            updateUser(patchPersonal(currentUser, { applyAnswersPromptDismissed: true })).catch(() => {});
          }
        }}
      />
    </View>
    </JTPullRefresh>
  );
}

// ─────────────────────────────────────────────────
// Employer home — combined Shift + Perm
// ─────────────────────────────────────────────────
function getTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function EmployerHome() {
  const router = useRouter();
  const { currentUser, vacancies, permVacancies, permApplications, refreshVacancies, refreshPermVacancies, refreshLikes, refreshAll, showToast, permVacancyViewsMap } = useApp();
  const tabBarHeight = useBottomTabBarHeight();
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [viewersModal, setViewersModal] = useState<{ id: string; kind: 'shift' | 'perm' } | null>(null);
  const didAutoClose = useRef(false);
  const [closingPermIds, setClosingPermIds] = useState<Set<string>>(new Set());
  // Отклики на постоянную вакансию — шторкой поверх списка, а не отдельным
  // экраном: директор смотрит их между делом и возвращается к вакансиям.
  const [appsVacancyId, setAppsVacancyId] = useState<string | null>(null);
  const [deletingPermIds, setDeletingPermIds] = useState<Set<string>>(new Set());
  const [deletedPermIds, setDeletedPermIds] = useState<Set<string>>(new Set());
  const [confirmDeletePerm, setConfirmDeletePerm] = useState<string | null>(null);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshAll();
    } catch {
      showToast('Нет связи — показаны последние вакансии', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (currentUser) refreshLikes(currentUser).catch(() => {});
    }, [currentUser?.id]),
  );

  const todayISO = getTodayISO();
  const myVacancies = vacancies.filter(v => v.employerId === currentUser?.id);
  const myPermVacancies = permVacancies.filter(v => v.employerId === currentUser?.id);

  useEffect(() => {
    if (didAutoClose.current) return;
    const pastOpen = myVacancies.filter(v => v.status === 'open' && v.date < todayISO);
    if (pastOpen.length === 0) return;
    didAutoClose.current = true;
    Promise.all(pastOpen.map(v => dbUpdateVacancy(v.id, { status: 'closed' })))
      .then(() => refreshVacancies())
      .catch(e => console.warn('[EmployerHome] auto-close past vacancies error', e));
  }, [vacancies]);

  const shownPerm = myPermVacancies.filter(v => {
    if (deletedPermIds.has(v.id)) return false;
    const isClosing = closingPermIds.has(v.id);
    if (tab === 'active') return !isClosing && v.status === 'open';
    return isClosing || v.status === 'closed';
  });

  const permApplicantCount = (vacId: string) =>
    permApplications.filter(a => a.vacancyId === vacId).length;

  const closePermVacancy = async (id: string) => {
    if (closingPermIds.has(id)) return;
    setClosingPermIds(prev => new Set([...prev, id]));
    try {
      await dbClosePermVacancy(id);
      showToast('Вакансия закрыта', 'success');
      refreshPermVacancies().catch(() => {});
    } catch (e) {
      setClosingPermIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');
      console.warn('[closePermVacancy]', e);
    }
  };

  const deletePermVacancy = async (id: string) => {
    if (deletingPermIds.has(id)) return;
    setConfirmDeletePerm(null);
    setDeletingPermIds(prev => new Set([...prev, id]));
    try {
      await dbDeletePermVacancy(id);
      setDeletedPermIds(prev => new Set([...prev, id]));
      try {
        await refreshPermVacancies();
        showToast('Вакансия удалена', 'success');
      } catch {
        showToast('Вакансия удалена, но список не обновился. Потяните вниз.', 'info');
      }
    } catch (e) {
      showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');
      console.warn('[deletePermVacancy]', e);
    } finally {
      setDeletingPermIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeader />

      <View style={styles.tabs}>
        {(['active', 'closed'] as const).map(t => (
          <TouchableOpacity key={t} style={styles.tabItem2} onPress={() => setTab(t)} activeOpacity={0.8}>
            <Text style={[styles.tabLabel2, tab === t && styles.tabLabelActive]}>{t === 'active' ? 'Активные' : 'Закрытые'}</Text>
            {tab === t ? <View style={styles.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      <OnboardingTarget targetKey="employer.feed.content" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabBarHeight + 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
          }
        >
        {
          shownPerm.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="briefcase-outline" size={52} color={Colors.textMuted} />
              {tab === 'active' ? (
                <>
                  <Text style={styles.emptyTitle}>Нет постоянных вакансий</Text>
                  <Text style={styles.emptySubtitle}>Создайте первую вакансию на постоянную работу</Text>
                  <TouchableOpacity style={[styles.createBtn, { borderColor: Colors.primary }]} onPress={() => router.push('/create-perm-vacancy')}>
                    <Text style={styles.createBtnText}>+ Создать вакансию</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Нет закрытых вакансий</Text>
                  <Text style={styles.emptySubtitle}>Здесь появятся завершённые вакансии</Text>
                </>
              )}
            </View>
          ) : (
            shownPerm.map(v => (
              <View key={v.id} style={[styles.vacCard, pS.permVacCard]}>
                <View style={styles.vacTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vacTitle} numberOfLines={1}>{v.title}</Text>
                    <Text style={pS.permCompany}>{normalizeCompany(v.company)}</Text>
                  </View>
                  <View style={styles.vacTopRight}>
                    <TouchableOpacity
                      style={styles.editBtn}
                      onPress={() => router.push({ pathname: '/create-perm-vacancy', params: { editId: v.id } })}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="create-outline" size={16} color={Colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editBtn, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}
                      onPress={() => tab === 'closed' ? setConfirmDeletePerm(v.id) : closePermVacancy(v.id)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={Colors.red} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={pS.permMetaRow}>
                  {v.metroStation ? <Text style={styles.vacMeta}>м. {v.metroStation}</Text> : null}
                  {v.address ? <Text style={styles.vacAddress} numberOfLines={2}>{v.address}</Text> : null}
                </View>
                <View style={pS.permTagsRow}>
                  <View style={pS.permSalaryTag}>
                    <Text style={pS.permSalaryTxt}>{v.salary.toLocaleString('ru-RU')} ₽/мес</Text>
                  </View>
                  <View style={pS.permScheduleTag}>
                    <Ionicons name="calendar-outline" size={rf(13)} color={Colors.textSecondary} />
                    <Text style={pS.permScheduleTxt}>{v.schedule}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={pS.appStatBtn}
                  onPress={() => setAppsVacancyId(v.id)}
                  activeOpacity={0.8}
                >
                  <Text style={pS.appStatNum}>{permApplicantCount(v.id)}</Text>
                  <Text style={pS.appStatLabel}>откликов</Text>
                  <View style={pS.appStatLink}>
                    <Text style={pS.appStatArrow}>Посмотреть</Text>
                    <Ionicons name="arrow-forward" size={13} color={Colors.primary} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[pS.appStatBtn, { backgroundColor: '#F4F4F5', marginTop: 6 }]}
                  onPress={() => setViewersModal({ id: v.id, kind: 'perm' })}
                  activeOpacity={0.8}
                >
                  <Text style={[pS.appStatNum, { color: Colors.textSecondary }]}>{permVacancyViewsMap[v.id] ?? 0}</Text>
                  <Text style={[pS.appStatLabel, { color: Colors.textSecondary }]}>посмотрели</Text>
                  <View style={pS.appStatLink}>
                    <Text style={[pS.appStatArrow, { color: Colors.textSecondary }]}>Посмотреть</Text>
                    <Ionicons name="arrow-forward" size={13} color={Colors.textSecondary} />
                  </View>
                </TouchableOpacity>
              </View>
            ))
          )
        }
        </ScrollView>
      </OnboardingTarget>

      {viewersModal ? (
        <VacancyViewersModal
          vacancyId={viewersModal.id}
          kind={viewersModal.kind}
          onClose={() => setViewersModal(null)}
        />
      ) : null}

      {confirmDeletePerm ? (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Удалить вакансию?</Text>
            <Text style={styles.confirmBody}>Вакансия будет полностью удалена из истории</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmDeletePerm(null)}><Text style={styles.cancelBtnText}>Отмена</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: '#EF4444' }]} onPress={() => deletePermVacancy(confirmDeletePerm)}><Text style={styles.confirmBtnText}>Удалить</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {appsVacancyId ? (
        <PermApplicationsSheet vacancyId={appsVacancyId} onClose={() => setAppsVacancyId(null)} />
      ) : null}

      {/* Плавающая кнопка создания — видна и когда вакансии уже есть */}
      <OnboardingTarget targetKey="employer.feed.create" style={[styles.fab, { bottom: tabBarHeight + 14 }] }>
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, { backgroundColor: Colors.primary, borderRadius: rs(28), alignItems: 'center', justifyContent: 'center' }]}
          onPress={() => router.push('/create-perm-vacancy')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={30} color="#fff" />
        </TouchableOpacity>
      </OnboardingTarget>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────
// Worker Home — единственная лента вакансий
// ─────────────────────────────────────────────────
// Смен в сервисе больше нет: осталась постоянная работа, и у работника
// ровно одна колода. Прежняя вкладка «Подработка» вместе с WorkerFeed
// удалена целиком, а не спрятана под флагом — выключенный раздел, который
// продолжает жить в коде, рано или поздно включается сам.
function WorkerCareer() {
  const { currentUser } = useApp();

  // Тёплая зона со временем в iOS PWA — общий хук, тот же на других вкладках.
  useWarmSystemBar();

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: JT.background }} />;

  return (
    // Тёплый фон только у ленты работника: экран работодателя — список
    // собственных вакансий, там подложка ничего не даёт.
    <SafeAreaView style={styles.safeWarm} edges={['top', 'left', 'right']}>
      <WorkerPermMode />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────
// Root exports (routes)
// ─────────────────────────────────────────────────
export default function HomeScreen() {
  const app = useApp();
  const currentUser = app?.currentUser ?? null;
  if (!currentUser) {
    return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  }
  return currentUser.role === 'worker' ? <WorkerCareer /> : <EmployerHome />;
}

// ─────────────────────────────────────────────────
// Permanent mode styles
// ─────────────────────────────────────────────────
// Карьерная карточка — макет JT-design.
// Карточка карьерной вакансии — размеры из макета ленты (04-vacancy-feed):
// поля 20, теги 30 pt со скруглением 10, растворение низа 84 pt.
const jt = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    paddingHorizontal: rs(20), paddingTop: rs(20),
  },
  company: { fontFamily: JT_FONT.heavy, fontSize: rf(16), color: JT.ink },
  meta: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary, marginTop: rs(2) },
  title: {
    fontFamily: JT_FONT.head, fontSize: rf(21), lineHeight: rf(25), letterSpacing: -0.2,
    color: JT.ink, paddingHorizontal: rs(20), marginTop: rs(16),
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(6), paddingHorizontal: rs(20), marginTop: rs(14) },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: rs(5), height: rs(30),
    backgroundColor: JT.background, borderRadius: rs(10),
    paddingHorizontal: rs(11), maxWidth: '100%',
  },
  tagSalary: { backgroundColor: JT.accentSoft },
  tagTxt: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.ink, flexShrink: 1 },
  preview: {
    fontFamily: JT_FONT.medium, fontSize: rf(15), lineHeight: rf(22), color: JT.textBody,
    paddingHorizontal: rs(20), marginTop: rs(14),
  },
  moreDock: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: rs(84),
    alignItems: 'center', justifyContent: 'flex-end', paddingBottom: rs(14),
  },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    height: rs(36), paddingHorizontal: rs(16), borderRadius: rs(18),
    borderWidth: 1.5, borderColor: JT.borderSoft, backgroundColor: JT.surface,
  },
  moreTxt: { fontFamily: JT_FONT.bold, fontSize: rf(14), color: JT.ink },
});

const pS = StyleSheet.create({
  // — плашка подтверждения перехода к партнёрской вакансии —
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: rs(24), zIndex: 50,
  },
  confirmCard: {
    width: '100%', maxWidth: rs(360), backgroundColor: Colors.card,
    borderRadius: rs(18), padding: rs(20), gap: rs(8),
  },
  confirmTitle: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
  confirmVacancy: { fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary },
  confirmHint: { fontSize: rf(13), color: Colors.textSecondary, lineHeight: rf(18) },
  confirmBtns: { flexDirection: 'row', gap: rs(10), marginTop: rs(12) },
  confirmCancel: {
    flex: 1, height: rs(48), borderRadius: rs(12), alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.inputBorder,
  },
  confirmCancelTxt: { fontSize: rf(15), fontWeight: '600', color: Colors.textSecondary },
  confirmOpen: {
    flex: 1, height: rs(48), borderRadius: rs(12), flexDirection: 'row', gap: rs(6),
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary,
  },
  confirmOpenTxt: { fontSize: rf(15), fontWeight: '700', color: '#fff' },
  connectIcon: {
    width: rs(48), height: rs(48), borderRadius: rs(24), alignItems: 'center',
    justifyContent: 'center', backgroundColor: Colors.primaryLight, marginBottom: rs(4),
  },
  connectPrivacy: {
    flexDirection: 'row', alignItems: 'center', gap: rs(7), marginTop: rs(5),
    padding: rs(10), borderRadius: rs(10), backgroundColor: '#F0FDF4',
  },
  connectPrivacyTxt: { flex: 1, fontSize: rf(12), lineHeight: rf(16), color: Colors.textSecondary },
  connectError: { fontSize: rf(12), lineHeight: rf(17), color: Colors.red, marginTop: rs(4) },
  connectPrimary: {
    height: rs(50), borderRadius: rs(12), flexDirection: 'row', gap: rs(8),
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, marginTop: rs(10),
  },
  connectPrimaryDisabled: { opacity: 0.7 },
  connectPrimaryTxt: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
  connectLater: { height: rs(40), alignItems: 'center', justifyContent: 'center' },
  connectLaterTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary },
  // — разделы карточки —
  section: {
    marginTop: rs(12), padding: rs(12),
    backgroundColor: Colors.surface, borderRadius: rs(12),
    borderWidth: 1, borderColor: Colors.divider,
  },
  sectionHead: {
    fontSize: rf(13), fontWeight: '700', color: Colors.textPrimary, marginBottom: rs(8),
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8), marginBottom: rs(6) },
  sectionRowTxt: { flex: 1, fontSize: rf(13), color: Colors.textSecondary },
  readMore: { flexDirection: 'row', alignItems: 'center', gap: rs(4), marginTop: rs(6) },
  readMoreTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },

  // — search row —
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    paddingHorizontal: rs(16), paddingTop: rs(8), paddingBottom: rs(6),
  },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: rs(6),
    borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(10),
    paddingHorizontal: rs(10), paddingVertical: rs(7), backgroundColor: Colors.bg,
  },
  searchInput: { flex: 1, fontSize: rf(13), color: Colors.textPrimary },
  searchClear: { fontSize: rf(13), color: Colors.textMuted },
  // «Всего N вакансий» под полосой чипов — мелко и серо, это справка, а не
  // заголовок. Во время загрузки карьерной части — «Считаем вакансии…».
  totalTxt: {
    fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary,
    paddingHorizontal: rs(20), paddingBottom: rs(6),
  },

  // Плашка в стиле JT (29.09.2026): наклейка с контуром, как чипы и карточки.
  offlineBar: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    marginHorizontal: rs(20), marginBottom: rs(8),
    backgroundColor: JT.accentSoft, borderWidth: 2, borderColor: JT.ink, borderRadius: rs(16),
    paddingHorizontal: rs(14), paddingVertical: rs(10),
  },
  offlineTxt: { flex: 1, fontFamily: JT_FONT.medium, fontSize: rf(13), color: JT.ink, lineHeight: rf(18) },
  offlineStrong: { fontFamily: JT_FONT.heavy },
  // Кнопка, а не только «потяните вниз»: на пустом экране жест обновления
  // не виден, а тупик человеку хуже ошибки.
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(7),
    marginTop: rs(16), backgroundColor: JT.accent, borderWidth: 2, borderColor: JT.ink,
    paddingHorizontal: rs(22), paddingVertical: rs(12), borderRadius: rs(24),
  },
  retryTxt: { color: JT.ink, fontFamily: JT_FONT.bold, fontSize: rf(15) },
  // Ширина по карточке, а не по экрану: карточка отступает на rs(13) плюс
  // рамка, и растворение должно кончаться ровно на её краю. bottom задаётся
  // рядом с карточкой через deckBottomReserve, чтобы совпадать на всех safe area.
  scrollHintWrap: {
    position: 'absolute', left: rs(13), right: rs(13), bottom: 0, height: rs(64),
    alignItems: 'center', justifyContent: 'flex-end', paddingBottom: rs(8),
    borderBottomLeftRadius: Radius.card, borderBottomRightRadius: Radius.card, overflow: 'hidden',
  },
  scrollHint: {
    flexDirection: 'row', alignItems: 'center', gap: rs(5),
    backgroundColor: Colors.bg, borderRadius: rs(100),
    paddingHorizontal: rs(13), paddingVertical: rs(8), ...Shadow.card,
  },
  scrollHintTxt: { fontSize: rf(12), fontWeight: '700', color: Colors.textSecondary },
  limitOverlay: {
    ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20,20,20,0.5)',
    justifyContent: 'center', paddingHorizontal: rs(20), zIndex: 50,
  },
  limitWrap: { alignSelf: 'stretch' },
  limitCard: {
    backgroundColor: JT.surface, borderRadius: rs(28), borderWidth: 2, borderColor: JT.ink,
    paddingTop: rs(28), paddingHorizontal: rs(22), paddingBottom: rs(18), alignItems: 'center',
  },
  limitIcon: {
    width: rs(76), height: rs(76), borderRadius: rs(38), borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center', backgroundColor: JT.accentSoft,
  },
  limitTitle: {
    fontFamily: JT_FONT.head, fontSize: rf(22), color: JT.ink, marginTop: rs(18), textAlign: 'center',
  },
  limitBody: {
    fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textSecondary,
    textAlign: 'center', lineHeight: rf(22), marginTop: rs(12),
  },
  limitStats: { flexDirection: 'row', gap: rs(8), alignSelf: 'stretch', marginTop: rs(18) },
  // Обе плитки по центру и по горизонтали, и по вертикали: подпись в две
  // строки («осталось / сегодня») без textAlign прижималась влево, а соседняя
  // плитка с короткой подписью висела выше (снимок владельца 01.10.2026).
  limitStat: {
    flex: 1, paddingVertical: rs(12), paddingHorizontal: rs(12), borderRadius: rs(16),
    backgroundColor: JT.background, alignItems: 'center', justifyContent: 'center', gap: rs(2),
  },
  limitStatNum: { fontFamily: JT_FONT.head, fontSize: rf(24), color: JT.ink, textAlign: 'center' },
  limitStatLbl: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary, textAlign: 'center' },
  limitBtnWrap: { alignSelf: 'stretch', marginTop: rs(20) },
  limitBtn: {
    height: rs(58), borderRadius: rs(29), borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.accent, alignItems: 'center', justifyContent: 'center',
  },
  limitBtnTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(16), color: JT.ink },
  limitClose: { height: rs(48), marginTop: rs(4), alignItems: 'center', justifyContent: 'center' },
  limitCloseTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(15), color: JT.textTertiary },
  deckUtilitySpacer: { width: rs(100), height: rs(52), flexShrink: 0 },
  deckCompanyLogoOverlay: {
    position: 'absolute',
    top: rs(10),
    left: rs(11),
    width: rs(72),
    height: rs(72),
    borderRadius: rs(24),
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 31,
    elevation: 31,
  },
  deckUtilityOverlay: {
    position: 'absolute', top: rs(18), right: rs(13), zIndex: 30, elevation: 30,
    flexDirection: 'row', alignItems: 'center', gap: rs(2),
  },
  deckUtilityTap: {
    width: rs(48), height: rs(48),
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  deckUtilityBtn: {
    width: rs(42), height: rs(42), borderRadius: rs(21),
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F2F3F5',
  },

  // — card —
  card: {
    backgroundColor: Colors.bg, borderRadius: rs(18),
    padding: rs(16), gap: rs(10), ...Shadow.card,
  },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: rs(5), borderRadius: rs(8), paddingHorizontal: rs(10), paddingVertical: rs(6), alignSelf: 'flex-start' },
  statusTxt: { fontSize: rf(12), fontWeight: '700' },

  // company row
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  companyAvatar: {
    width: rs(42), height: rs(42), borderRadius: rs(12),
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  companyAvatarTxt: { fontSize: rf(16), fontWeight: '800', color: '#fff' },
  companyMeta: { flex: 1 },
  companyName: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: rs(4), marginTop: rs(2) },
  verifiedBadge: {
    width: rs(14), height: rs(14), borderRadius: rs(7),
    backgroundColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
  },
  verifiedTxt: { fontSize: rf(11), color: Colors.textMuted },
  saveBtn: { padding: rs(4) },

  // title & salary
  jobTitle: { fontSize: rf(22), fontWeight: '800', color: Colors.textPrimary, lineHeight: rf(28) },
  salaryRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  salaryMain: { fontSize: rf(20), fontWeight: '800', color: Colors.primary },
  naRukiBadge: {
    backgroundColor: '#D1FAE5', borderRadius: rs(100),
    paddingHorizontal: rs(10), paddingVertical: rs(4),
  },
  naRukiTxt: { fontSize: rf(12), fontWeight: '700', color: Colors.green },

  // location row
  locationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(10), maxWidth: '100%' },
  locationItem: { flexDirection: 'row', alignItems: 'center', gap: rs(5), minWidth: 0, maxWidth: '100%' },
  addressLocationItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(5),
    flexBasis: '100%', minWidth: 0, maxWidth: '100%',
  },
  metroCircle: {
    width: rs(18), height: rs(18), borderRadius: rs(9),
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  metroCircleTxt: { fontSize: rf(10), fontWeight: '900', color: '#fff', lineHeight: rf(12) },
  locationTxt: { fontSize: rf(13), color: Colors.textSecondary, fontWeight: '500', flexShrink: 1 },
  locationRowText: {
    flex: 1, minWidth: 0, fontSize: rf(13), color: Colors.textSecondary,
    fontWeight: '500', lineHeight: rf(18),
  },

  // schedule row
  scheduleRow: { flexDirection: 'row', gap: rs(16) },

  // desc / location
  sectionBlock: { gap: rs(8), marginBottom: rs(13) },
  descriptionPanel: {
    borderWidth: 1,
    borderColor: '#E8E9ED',
    borderRadius: rs(19),
    backgroundColor: '#FBFBFC',
    paddingHorizontal: rs(16),
    paddingTop: rs(16),
    paddingBottom: rs(13),
    gap: rs(10),
  },
  descriptionPanelTitle: {
    fontSize: rf(15),
    lineHeight: rf(20),
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  descriptionMeasure: {
    position: 'absolute',
    left: rs(16),
    right: rs(16),
    top: rs(46),
    opacity: 0,
  },
  descriptionToggle: {
    minHeight: rs(42),
    marginTop: rs(3),
    borderRadius: rs(100),
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E6E8EC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: rs(7),
  },
  descriptionToggleText: {
    fontSize: rf(13.5),
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  descTitle: { fontSize: rf(14.5), fontWeight: '700', color: Colors.textPrimary },
  locRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(13),
    backgroundColor: Colors.surface, borderRadius: rs(13), padding: rs(13),
  },
  metroDot: { width: rs(13), height: rs(13), borderRadius: rs(7), marginTop: rs(5) },
  metroLineName: { fontSize: rf(11), color: Colors.textMuted, marginBottom: rs(5) },
  locValue: { fontSize: rf(11), color: Colors.textPrimary, fontWeight: '600' },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8),
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: rs(13), paddingVertical: rs(13),
  },
  mapBtnTxt: { fontSize: rf(14.5), fontWeight: '700', color: Colors.primary },
  desc: { fontSize: rf(13.5), color: Colors.textSecondary, lineHeight: rf(21) },

  // action row
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8), marginTop: rs(2) },
  applyBtn: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: rs(100),
    paddingVertical: rs(13), alignItems: 'center',
  },
  applyBtnDone: { backgroundColor: '#D1FAE5' },
  applyBtnTxt: { color: '#fff', fontSize: rf(14), fontWeight: '700' },
  actionIconBtn: {
    width: rs(44), height: rs(44), borderRadius: rs(100),
    borderWidth: 1.5, borderColor: Colors.inputBorder,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg,
  },
  actionIconBtnSaved: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },

  // views row
  viewsRow: { flexDirection: 'row', alignItems: 'center', gap: rs(4), marginBottom: rs(10) },
  viewsTxt: { fontSize: rf(12), color: Colors.textMuted },


  // Employer-side perm card styles (used in EmployerHome)
  permVacCard: { borderLeftWidth: 3, borderLeftColor: Colors.primary },
  permCompany: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2) },
  permMetaRow: { gap: rs(2), minWidth: 0, maxWidth: '100%' },
  permTagsRow: { flexDirection: 'row', gap: rs(10), flexWrap: 'wrap' },
  permSalaryTag: { backgroundColor: '#D1FAE5', borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(5) },
  permSalaryTxt: { fontSize: rf(13), fontWeight: '800', color: Colors.green },
  permScheduleTag: { flexDirection: 'row', alignItems: 'center', gap: rs(5), backgroundColor: Colors.surface, borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(5) },
  permScheduleTxt: { fontSize: rf(13), color: Colors.textSecondary, fontWeight: '500' },
  appStatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    backgroundColor: '#EDE9FE', borderRadius: rs(10), padding: rs(10),
  },
  appStatNum: { fontSize: rf(20), fontWeight: '800', color: Colors.primary },
  appStatLabel: { fontSize: rf(12), color: Colors.primary, flex: 1 },
  appStatArrow: { fontSize: rf(12), color: Colors.primary, fontWeight: '600' },
  appStatLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },

  // legacy (used by WorkerFeed M-button)
  filterLineDot: { width: rs(8), height: rs(8), borderRadius: rs(4) },
  metroIconWrap: {
    width: rs(30), height: rs(30), borderRadius: rs(15),
    borderWidth: 2.5, borderColor: '#111111',
    alignItems: 'center', justifyContent: 'center',
  },
  metroIconText: { fontSize: rf(14), fontWeight: '900', color: '#111111', lineHeight: rf(17) },
  inlineFilter: {
    width: rs(44), height: rs(44), borderRadius: rs(12), marginRight: rs(8),
    borderWidth: 1.5, borderColor: Colors.inputBorder,
    backgroundColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  inlineFilterActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
});

// ─────────────────────────────────────────────────
// Shared styles (shift mode)
// ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  companyFallback: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  companyFallbackText: { color: '#fff', fontSize: rf(15), fontWeight: '800' },
  safe: { flex: 1, backgroundColor: Colors.bg },
  safeWarm: { flex: 1, backgroundColor: JT.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  logo: { fontSize: rf(20) },
  logoB: { fontWeight: '800', color: Colors.textPrimary },
  logoO: { fontWeight: '800', color: Colors.primary },
  addBtn: { backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(16), paddingVertical: rs(8) },
  addBtnText: { color: '#fff', fontSize: rf(13), fontWeight: '700' },
  dateStrip: { borderBottomWidth: 1, borderBottomColor: Colors.divider, backgroundColor: Colors.bg },
  activeStationChip: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6), alignSelf: 'flex-start',
    marginHorizontal: rs(16), marginTop: rs(10),
    backgroundColor: Colors.primaryLight, borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(6),
  },
  activeStationTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },
  dateStripInner: { flexDirection: 'row', alignItems: 'center' },
  dateRow: { paddingHorizontal: rs(12), paddingVertical: rs(7), gap: rs(6), flexDirection: 'row' },
  modeSwitcherRow: { paddingHorizontal: rs(16), paddingVertical: rs(10), borderBottomWidth: 1, borderBottomColor: Colors.divider },
  dateChip: { width: rs(40), height: rs(50), borderRadius: rs(12), alignItems: 'center', justifyContent: 'center', gap: rs(1) },
  dateChipActive: { backgroundColor: Colors.primary, borderRadius: rs(12) },
  dcDay: { fontSize: rf(9.5), fontWeight: '600', textTransform: 'uppercase', color: Colors.textMuted },
  dcDayActive: { color: '#fff' },
  dcNum: { fontSize: rf(16), fontWeight: '800', color: Colors.textPrimary },
  dcNumActive: { color: '#fff' },
  dcCnt: { fontSize: rf(9.5), fontWeight: '700', color: Colors.primary },
  dcCntActive: { color: 'rgba(255,255,255,0.8)' },
  // Нижний резерв задаётся динамически рядом с карточкой: высота таббара
  // + 68pt кнопки + одинаковые поля по 13pt сверху и снизу.
  // Колода — макет JT-design: карточка-«наклейка», под ней края двух
  // следующих (stack-1 / stack-2 с тем же чёрным контуром).
  cardArea: { flex: 1, flexDirection: 'column', paddingHorizontal: rs(20), paddingTop: rs(8), paddingBottom: 0 },
  // Геометрия макета: следующие карточки уже на 12 и 24 с каждой стороны и
  // ниже на 10 и 20. Ниж. край задаётся резервом (bottom), а карточка стоит
  // на 5 выше резерва (место под тень) — поэтому сдвиг на 5 меньше макетного.
  ghost1: { position: 'absolute', left: rs(20) + 12, right: rs(25) + 12, top: rs(8), bottom: 0, backgroundColor: JT.stack1, borderRadius: rs(26), borderWidth: 2, borderColor: JT.ink, transform: [{ translateY: 5 }], zIndex: 0 },
  ghost2: { position: 'absolute', left: rs(20) + 24, right: rs(25) + 24, top: rs(8), bottom: 0, backgroundColor: JT.stack2, borderRadius: rs(26), borderWidth: 2, borderColor: JT.ink, transform: [{ translateY: 15 }], zIndex: 0 },
  // Скругление принадлежит viewport, а не прокручиваемому содержимому.
  // Поэтому верх и низ карточки остаются закруглёнными на любой позиции скролла.
  cardViewportShell: {
    flex: 1,
    // Место под жёсткую тень «наклейки» справа и снизу.
    marginRight: rs(5),
    marginBottom: rs(5),
  },
  // One transform owner for the whole visual card. Interactive overlays stay
  // outside GestureDetector but inside this layer, so they never look pinned
  // to the screen while the vacancy is being swiped.
  deckSwipeLayer: { flex: 1 },
  // Жёсткая тень без размытия (5, 5) — чёрная копия карточки под ней: так
  // она одинакова на iOS, Android и в вебе, где shadow* её не нарисуют.
  cardSticker: {
    position: 'absolute', left: rs(5), top: rs(5), right: -rs(5), bottom: -rs(5),
    borderRadius: rs(26), backgroundColor: JT.ink,
  },
  cardViewportClip: {
    flex: 1,
    borderRadius: rs(26),
    overflow: 'hidden',
    backgroundColor: JT.surface,
    borderWidth: 2,
    borderColor: JT.ink,
  },
  // flexGrow, а не flex: короткая вакансия всё так же занимает экран целиком,
  // а длинная вырастает выше него и листается внутри списка.
  cardAnimated: { flexGrow: 1, zIndex: 1 },
  // Тело занимает карточку целиком, чтобы фон и разделители шли до краёв.
  // Нажатия оно не ловит: кнопок здесь ровно две — закладка и «поделиться».
  cardBody: { flexGrow: 1 },
  postedAgo: { fontSize: rf(12), fontWeight: '500', color: Colors.textMuted, flexShrink: 0 },
  card: { flexGrow: 1, backgroundColor: JT.surface },
  wantOverlay: { position: 'absolute', top: rs(20), left: rs(20), zIndex: 80, elevation: 80, backgroundColor: Colors.green, borderRadius: rs(10), paddingHorizontal: rs(14), paddingVertical: rs(8), transform: [{ rotate: '-10deg' }] },
  wantText: { color: '#fff', fontSize: rf(20), fontWeight: '800' },
  skipOverlay: { position: 'absolute', top: rs(20), right: rs(20), zIndex: 80, elevation: 80, backgroundColor: Colors.red, borderRadius: rs(10), paddingHorizontal: rs(14), paddingVertical: rs(8), transform: [{ rotate: '10deg' }] },
  skipText: { color: '#fff', fontSize: rf(20), fontWeight: '800' },
  cardTop: { paddingHorizontal: rs(21), paddingTop: rs(20), paddingBottom: rs(14), gap: rs(13) },
  cardLogoRow: { minHeight: rs(52), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  companyLogoSpacer: { width: rs(52), height: rs(52), flexShrink: 0 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  companyMetaLine: { flexDirection: 'row', alignItems: 'center', gap: rs(7), minWidth: 0 },
  cardHeadSpacer: { height: rs(2) },
  avatar: { width: rs(44), height: rs(44), borderRadius: rs(22), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarImg: { width: rs(44), height: rs(44), borderRadius: rs(22), flexShrink: 0 },
  avatarText: { fontSize: rf(17), fontWeight: '700', color: '#fff' },
  companyName: { flexShrink: 1, fontSize: rf(13.5), fontWeight: '600', color: Colors.textSecondary },
  metroHint: { fontSize: rf(12), color: Colors.textMuted },
  urgentTag: { flexDirection: 'row', alignItems: 'center', gap: rs(3), backgroundColor: '#FEF3C7', borderRadius: rs(8), paddingHorizontal: rs(8), paddingVertical: rs(4), flexShrink: 0 },
  urgentTagTxt: { fontSize: rf(11), fontWeight: '700', color: '#92400E' },
  cardBadges: { alignItems: 'flex-end', gap: rs(4), flexShrink: 0 },
  metroHintRow: { flexDirection: 'row', alignItems: 'center', gap: rs(4), marginTop: rs(2) },
  jobTitle: { fontSize: rf(24), fontWeight: '800', color: Colors.textPrimary, lineHeight: rf(30), marginTop: rs(1) },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8) },
  addressChip: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    backgroundColor: '#F3F4F6', borderRadius: rs(13), paddingHorizontal: rs(12), paddingVertical: rs(10),
  },
  addressChipIcon: { fontSize: rf(15), marginTop: rs(1) },
  addressChipText: { flex: 1, fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary, lineHeight: rf(20) },
  cardDivider: { height: 1, backgroundColor: Colors.divider, marginHorizontal: rs(21) },
  cardMiddle: { flexGrow: 1, paddingBottom: rs(18), paddingHorizontal: rs(21), gap: rs(16) },
  slotsRow: { flexDirection: 'row' },
  slotInfo: { flex: 1, alignItems: 'center', paddingVertical: rs(2) },
  slotInfoBordered: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.divider },
  slotLabel: { fontSize: rf(11), color: Colors.textMuted, fontWeight: '500', marginTop: rs(2) },
  slotValue: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary },
  progressTrack: { height: rs(5), backgroundColor: Colors.divider, borderRadius: rs(3), overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: rs(3) },
  detailHintRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: rs(6), paddingVertical: rs(10), paddingHorizontal: rs(14),
    borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  detailHintText: { fontSize: rf(13), fontWeight: '600', color: Colors.primary },
  detailHintArrow: { fontSize: rf(14), color: Colors.primary },
  cardActionsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: rs(10), paddingHorizontal: rs(20),
    borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  deckFloatingActions: {
    position: 'absolute', left: rs(24), right: rs(24), bottom: rs(28), zIndex: 20, elevation: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
  },
  deckFloatingAction: {
    width: rs(68), height: rs(68), borderRadius: rs(34),
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', borderWidth: 0.75, borderColor: '#EEF0F3',
    shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.10, shadowRadius: 12, elevation: 16,
  },
  deckFloatingSkip: { backgroundColor: '#FFFFFF' },
  deckFloatingWant: { width: rs(68), height: rs(68), borderRadius: rs(34), backgroundColor: Colors.primary, borderColor: Colors.primary },
  swipeHintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(9), marginTop: rs(1) },
  swipeHint: { fontSize: rf(12), lineHeight: rf(16), color: '#9AA3B2', fontWeight: '500' },
  cardActionItem: {
    width: rs(46), height: rs(46), borderRadius: rs(14),
    alignItems: 'center', justifyContent: 'center',
  },
  cardActionSkip: { backgroundColor: '#FEF2F2' },
  cardActionWant: { backgroundColor: Colors.primary },
  detailSkipBtn: { flex: 1, borderWidth: 1.5, borderColor: Colors.red, borderRadius: rs(100), paddingVertical: rs(13), alignItems: 'center' },
  detailSkipTxt: { color: Colors.red, fontSize: rf(14), fontWeight: '600' },
  detailWantBtn: { flex: 1, backgroundColor: Colors.primary, borderRadius: rs(100), paddingVertical: rs(13), alignItems: 'center' },
  detailWantTxt: { color: '#fff', fontSize: rf(14), fontWeight: '700' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(24), paddingBottom: rs(180) },
  emptyCharContainer: { width: SW - 40, height: Math.round((SW - 40) * 1.216), marginBottom: rs(8) },
  emptyCharImg: { width: '100%', height: '100%' },
  emptyTitle: { fontFamily: JT_FONT.head, fontSize: rf(18), lineHeight: rf(24), color: JT.ink, textAlign: 'center', marginTop: rs(10) },
  emptySubtitle: { fontFamily: JT_FONT.medium, fontSize: rf(14), color: JT.textTertiary, marginTop: rs(6), textAlign: 'center', lineHeight: rf(20) },
  filterOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, justifyContent: 'flex-end' },
  filterSheet: { backgroundColor: Colors.bg, borderTopLeftRadius: rs(20), borderTopRightRadius: rs(20), paddingBottom: rs(40), maxHeight: '70%' },
  filterSheetHandle: { alignSelf: 'center', width: rs(40), height: rs(5), borderRadius: rs(3), backgroundColor: Colors.divider, marginTop: rs(8) },
  filterSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: rs(16), borderBottomWidth: 1, borderBottomColor: Colors.divider },
  filterSheetTitle: { fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  filterClose: { fontSize: rf(18), color: Colors.textMuted, padding: rs(4) },
  clearFilterRow: { marginHorizontal: rs(16), marginTop: rs(12), borderWidth: 1.5, borderColor: Colors.red, borderRadius: rs(100), paddingVertical: rs(10), alignItems: 'center' },
  clearFilterTxt: { color: Colors.red, fontSize: rf(14), fontWeight: '600' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: rs(12), paddingHorizontal: rs(16), paddingVertical: rs(12), borderBottomWidth: 1, borderBottomColor: Colors.divider },
  lineRowActive: { backgroundColor: Colors.primaryLight },
  lineDot: { width: rs(12), height: rs(12), borderRadius: rs(6) },
  lineName: { flex: 1, fontSize: rf(15), color: Colors.textPrimary },
  createBtn: { marginTop: rs(20), borderWidth: 1.5, borderColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(24), paddingVertical: rs(10) },
  createBtnText: { color: Colors.primary, fontWeight: '600', fontSize: rf(15) },
  fab: {
    position: 'absolute',
    right: rs(16),
    width: rs(56),
    height: rs(56),
    borderRadius: rs(28),
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.divider },
  tabItem2: { flex: 1, alignItems: 'center', paddingVertical: rs(12) },
  tabLabel2: { fontSize: rf(15), fontWeight: '500', color: Colors.textMuted },
  tabLabelActive: { fontWeight: '700', color: Colors.textPrimary },
  tabUnderline: { position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 2, backgroundColor: Colors.primary, borderRadius: rs(1) },
  // gap, а не отступы у каждого блока: внутри карточки строки шли вплотную —
  // метро, адрес и плашки с зарплатой слипались в одну кашу.
  vacCard: { backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(16), gap: rs(8), ...Shadow.card },
  vacTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: rs(4) },
  vacTopRight: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  vacTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary, flex: 1 },
  urgentBadge: { backgroundColor: '#FEF3C7', borderRadius: rs(100), paddingHorizontal: rs(8), paddingVertical: rs(3) },
  urgentText: { fontSize: rf(12) },
  editBtn: { width: rs(32), height: rs(32), borderRadius: rs(8), backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.inputBorder },
  editBtnText: { fontSize: rf(14) },
  vacMeta: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(4) },
  vacAddress: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2) },
  statsRow: { flexDirection: 'row', gap: rs(8), marginTop: rs(4) },
  // Плитка должна читаться как кнопка: рамка и стрелка в углу. Раньше стрелка
  // была девятого размера и пряталась под подписью — нажать догадывался не всякий.
  statBox: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: rs(10),
    paddingVertical: rs(8), paddingHorizontal: rs(8), alignItems: 'center',
    borderWidth: 1, borderColor: Colors.divider,
  },
  statNum: { fontSize: rf(18), fontWeight: '800' },
  statLabel: { fontSize: rf(10), color: Colors.textMuted, textTransform: 'uppercase', marginTop: rs(2) },
  statTap: { position: 'absolute', top: rs(5), right: rs(7), fontSize: rf(12), fontWeight: '700', color: Colors.primary },
  vacProgress: { height: rs(3), backgroundColor: Colors.divider, borderRadius: rs(2), marginTop: rs(10), overflow: 'hidden' },
  vacActions: { flexDirection: 'row', gap: rs(8), marginTop: rs(12) },
  candBtn: { flex: 1, borderWidth: 1.5, borderColor: Colors.blue, borderRadius: rs(100), paddingVertical: rs(8), alignItems: 'center' },
  candBtnText: { color: Colors.blue, fontSize: rf(13), fontWeight: '600' },
  deleteBtn: { width: rs(44), height: rs(36), borderWidth: 1.5, borderColor: Colors.red, borderRadius: rs(10), alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { fontSize: rf(16) },
  confirmOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: rs(24) },
  confirmCard: { backgroundColor: Colors.bg, borderRadius: Radius.xl, padding: rs(28), width: '100%', gap: rs(12) },
  confirmTitle: { fontSize: rf(18), fontWeight: '700', textAlign: 'center', color: Colors.textPrimary },
  confirmBody: { fontSize: rf(14), color: Colors.textSecondary, textAlign: 'center' },
  confirmBtns: { flexDirection: 'row', gap: rs(12), marginTop: rs(8) },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(100), paddingVertical: rs(14), alignItems: 'center' },
  cancelBtnText: { fontSize: rf(15), fontWeight: '600', color: Colors.textSecondary },
  confirmBtn: { flex: 1, backgroundColor: Colors.red, borderRadius: rs(100), paddingVertical: rs(14), alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
});
