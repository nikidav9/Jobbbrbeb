import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  Animated, Dimensions, RefreshControl, Modal, FlatList,
  TextInput, ActivityIndicator, Share, Platform, Linking, Pressable,
} from 'react-native';
import {
  GestureDetector,
  ScrollView as GHScrollView,
  RefreshControl as GHRefreshControl,
} from 'react-native-gesture-handler';
import Reanimated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useSwipeDeck } from '@/hooks/useSwipeDeck';
import { useEnergy } from '@/hooks/useEnergy';
import { requestJupiterLive } from '@/services/jupiterLive';
import { DAILY_ENERGY } from '@/services/energy';
import { User, PermVacancy, ExtVacancy } from '@/constants/types';
import { JobSection, SECTION_BY_WORK_TYPE } from '@/constants/jobSections';
import { getInitials, nameColorFromString, saveFeedSections } from '@/services/storage';
import { normalizeCompany } from '@/services/company';
import { agoRu } from '@/services/time';
import { sectionOfPerm, rankOwn, interleaveDeck } from '@/services/feedMix';
import { vacancyLevel, vacancyFormat, VACANCY_LEVELS, VACANCY_FORMATS, type VacancyLevel, type VacancyFormat } from '@/services/vacancyFacets';
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
import { DescriptionBlocks } from '@/components/ui/DescriptionBlocks';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { TabHeader } from '@/components/ui/TabHeader';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';
import { MetroMap, MapListItem } from '@/components/feature/MetroMap';
import { WORK_TYPE_META } from '@/components/feature/WorkTypeSelector';
import { PermApplicationsSheet } from '@/components/feature/PermApplicationsSheet';
import { OnboardingTarget } from '@/components/OnboardingTarget';
import { registerWebPush, isWebPushRegistered, getWebPushDebug } from '@/lib/webPush';

import { rs, rf } from '@/constants/scale';
import { ApplySheet } from '@/components/feature/ApplySheet';
import { getChatSuggestions } from '@/constants/chatSuggestions';
import { payShort } from '@/services/pay';
import { permVacancyInfoLines } from '@/services/vacancyCard';
import { BackButton, BACK_BUTTON_SIZE } from '@/components/ui/BackButton';

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

// Flat list of all metro stations with their line metadata
const ALL_STATIONS = METRO_LINES.flatMap(l =>
  l.stations.map(s => ({ station: s, lineId: l.id, lineColor: l.color, lineName: l.name }))
).sort((a, b) => a.station.localeCompare(b.station, 'ru'));

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

function MetroStationPicker({
  visible,
  selectedStation,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedStation: string | null;
  onSelect: (station: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_STATIONS;
    return ALL_STATIONS.filter(s => s.station.toLowerCase().includes(q));
  }, [query]);

  if (!visible) return null;

  return (
    <View style={styles.filterOverlay}>
      <View style={[styles.filterSheet, { maxHeight: '85%' }]}>
        <View style={styles.filterSheetHeader}>
          <Text style={styles.filterSheetTitle}>Станция метро</Text>
          <TouchableOpacity onPress={() => { setQuery(''); onClose(); }}>
            <Text style={styles.filterClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={metroPickerSt.searchRow}>
          <Ionicons name="search" size={rf(16)} color={Colors.textMuted} />
          <TextInput
            style={metroPickerSt.searchInput}
            placeholder="Введите название станции..."
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoFocus
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={metroPickerSt.searchClear}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {selectedStation ? (
          <TouchableOpacity
            style={styles.clearFilterRow}
            onPress={() => { setQuery(''); onSelect(null); onClose(); }}
          >
            <Text style={styles.clearFilterTxt}>✕ Сбросить фильтр</Text>
          </TouchableOpacity>
        ) : null}

        <FlatList
          data={results}
          keyExtractor={(item, i) => `${item.lineId}-${i}`}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.lineRow, selectedStation === item.station ? styles.lineRowActive : null]}
              onPress={() => { setQuery(''); onSelect(item.station); onClose(); }}
              activeOpacity={0.8}
            >
              <View style={[styles.lineDot, { backgroundColor: item.lineColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.lineName, selectedStation === item.station ? { color: Colors.primary, fontWeight: '700' } : null]}>
                  {item.station}
                </Text>
                <Text style={metroPickerSt.lineSubtitle}>{item.lineName}</Text>
              </View>
              {selectedStation === item.station ? <Text style={{ color: Colors.primary }}>✓</Text> : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={metroPickerSt.empty}>
              <Text style={metroPickerSt.emptyTxt}>Станция не найдена</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const metroPickerSt = StyleSheet.create({
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    marginHorizontal: rs(16), marginVertical: rs(10),
    backgroundColor: Colors.surface, borderRadius: rs(12),
    paddingHorizontal: rs(12), paddingVertical: rs(10),
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  searchInput: { flex: 1, fontSize: rf(15), color: Colors.textPrimary },
  searchClear: { fontSize: rf(14), color: Colors.textMuted, paddingLeft: rs(4) },
  lineSubtitle: { fontSize: rf(11), color: Colors.textMuted, marginTop: rs(1) },
  empty: { padding: rs(24), alignItems: 'center' },
  emptyTxt: { fontSize: rf(14), color: Colors.textMuted },
});

// Мультивыбор метро в два уровня: линии → станции (с «Выбрать все»),
// поиск по всем станциям, выбранное отмечается галочкой. Формат как на
// референсе, но в наших цветах. Возвращает массив станций.
function MetroPicker({ visible, selected, onChange, onClose }: {
  visible: boolean;
  selected: string[];
  onChange: (stations: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState<(typeof METRO_LINES)[number] | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) { setDraft(selected); setQuery(''); setLine(null); }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const draftSet = new Set(draft);
  const toggle = (s: string) => setDraft(d => d.includes(s) ? d.filter(x => x !== s) : [...d, s]);
  const q = query.trim().toLowerCase();
  const searchResults = q ? ALL_STATIONS.filter(s => s.station.toLowerCase().includes(q)) : [];

  const Check = ({ on }: { on: boolean }) => (
    <View style={[mp.check, on && mp.checkOn]}>
      {on ? <Ionicons name="checkmark" size={rf(14)} color="#fff" /> : null}
    </View>
  );

  return (
    <View style={styles.filterOverlay}>
      <View style={[styles.filterSheet, { maxHeight: '90%' }]}>
        <View style={styles.filterSheetHeader}>
          {line ? (
            <BackButton onPress={() => setLine(null)} />
          ) : <View style={{ width: BACK_BUTTON_SIZE }} />}
          <Text style={styles.filterSheetTitle} numberOfLines={1}>{line ? line.name : 'Метро'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.filterClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={metroPickerSt.searchRow}>
          <Ionicons name="search" size={rf(16)} color={Colors.textMuted} />
          <TextInput
            style={metroPickerSt.searchInput}
            placeholder="Поиск"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            clearButtonMode="while-editing"
          />
        </View>

        {q ? (
          <FlatList
            data={searchResults}
            keyExtractor={(it, i) => `${it.lineId}-${it.station}-${i}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={[mp.card, draftSet.has(item.station) && mp.cardOn]} onPress={() => toggle(item.station)} activeOpacity={0.8}>
                <View style={[mp.dot, { backgroundColor: item.lineColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={mp.name}>{item.station}</Text>
                  <Text style={mp.sub}>{item.lineName}</Text>
                </View>
                <Check on={draftSet.has(item.station)} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={<View style={metroPickerSt.empty}><Text style={metroPickerSt.emptyTxt}>Станция не найдена</Text></View>}
          />
        ) : line ? (
          <FlatList
            data={line.stations}
            keyExtractor={(s, i) => `${s}-${i}`}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={(() => {
              const allOn = line.stations.every(s => draftSet.has(s));
              return (
                <TouchableOpacity
                  style={mp.card}
                  activeOpacity={0.8}
                  onPress={() => setDraft(d => {
                    const set = new Set(d);
                    if (allOn) line.stations.forEach(s => set.delete(s));
                    else line.stations.forEach(s => set.add(s));
                    return [...set];
                  })}
                >
                  <Text style={[mp.name, { flex: 1, fontWeight: '700' }]}>Выбрать все</Text>
                  <Check on={allOn} />
                </TouchableOpacity>
              );
            })()}
            renderItem={({ item }) => (
              <TouchableOpacity style={[mp.card, draftSet.has(item) && mp.cardOn]} onPress={() => toggle(item)} activeOpacity={0.8}>
                <View style={[mp.dot, { backgroundColor: line.color }]} />
                <Text style={[mp.name, { flex: 1 }]}>{item}</Text>
                <Check on={draftSet.has(item)} />
              </TouchableOpacity>
            )}
          />
        ) : (
          <FlatList
            data={METRO_LINES}
            keyExtractor={l => l.id}
            renderItem={({ item }) => {
              const cnt = item.stations.filter(s => draftSet.has(s)).length;
              return (
                <TouchableOpacity style={mp.card} onPress={() => setLine(item)} activeOpacity={0.8}>
                  <View style={[mp.bar, { backgroundColor: item.color }]} />
                  <Text style={[mp.name, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
                  {cnt > 0 ? <Text style={mp.badge}>{cnt}</Text> : null}
                  <Ionicons name="chevron-forward" size={rf(18)} color={Colors.textMuted} />
                </TouchableOpacity>
              );
            }}
          />
        )}

        <View style={[mp.footer, { paddingBottom: insets.bottom + rs(84) }]}>
          <TouchableOpacity style={mp.save} onPress={() => { onChange(draft); onClose(); }} activeOpacity={0.85}>
            <Text style={mp.saveTxt}>Сохранить{draft.length ? ` · ${draft.length}` : ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={mp.reset} onPress={() => setDraft([])} activeOpacity={0.85}>
            <Text style={mp.resetTxt}>Сбросить</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const mp = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    marginHorizontal: rs(16), marginTop: rs(8),
    paddingHorizontal: rs(14), paddingVertical: rs(14),
    borderWidth: 1, borderColor: Colors.inputBorder, borderRadius: rs(14), backgroundColor: Colors.bg,
  },
  cardOn: { borderColor: Colors.primary },
  bar: { width: rs(5), height: rs(20), borderRadius: rs(3) },
  dot: { width: rs(11), height: rs(11), borderRadius: rs(6) },
  name: { fontSize: rf(15), color: Colors.textPrimary, fontWeight: '500' },
  sub: { fontSize: rf(11), color: Colors.textMuted, marginTop: rs(1) },
  badge: { fontSize: rf(12), fontWeight: '800', color: Colors.primary, marginRight: rs(6) },
  check: {
    width: rs(22), height: rs(22), borderRadius: rs(6),
    borderWidth: 1.5, borderColor: Colors.inputBorder, alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  footer: { padding: rs(16), gap: rs(8), borderTopWidth: 1, borderTopColor: Colors.divider },
  save: { backgroundColor: Colors.primary, borderRadius: rs(14), alignItems: 'center', paddingVertical: rs(14) },
  saveTxt: { color: '#fff', fontSize: rf(15), fontWeight: '800' },
  reset: { backgroundColor: Colors.primaryLight, borderRadius: rs(14), alignItems: 'center', paddingVertical: rs(13) },
  resetTxt: { color: Colors.primary, fontSize: rf(14), fontWeight: '700' },
});


type VacancyCompanyOption = { name: string; count: number };


// Смена проходит фильтр по времени, если её начало попадает в один из
// выбранных «начать»-диапазонов, а конец — в один из «закончить». Пустой
// набор диапазонов ничего не ограничивает.


const fst = StyleSheet.create({
  reset: { fontSize: rf(14), fontWeight: '600', color: Colors.textMuted, marginLeft: 'auto', marginRight: rs(14) },
  label: { fontSize: rf(13.5), fontWeight: '800', color: Colors.textMuted, paddingHorizontal: rs(16), paddingTop: rs(14), paddingBottom: rs(8) },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8), paddingHorizontal: rs(16) },
  chip: { paddingHorizontal: rs(13), paddingVertical: rs(9), borderRadius: rs(100), backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.divider },
  chipOn: { backgroundColor: Colors.primaryLight, borderColor: Colors.primaryBorder },
  chipTxt: { fontSize: rf(13), fontWeight: '600', color: Colors.textPrimary },
  chipTxtOn: { color: Colors.primary },
  rowSel: { marginHorizontal: rs(16), borderWidth: 1, borderColor: Colors.inputBorder, borderRadius: rs(14), paddingHorizontal: rs(14), paddingVertical: rs(13), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowSelName: { fontSize: rf(14.5), fontWeight: '600', color: Colors.textPrimary },
  rowSelHint: { fontSize: rf(13), color: Colors.textMuted, fontWeight: '600' },
  lineDot: { width: rs(10), height: rs(10), borderRadius: rs(5) },
  cta: { margin: rs(16), backgroundColor: Colors.primary, borderRadius: rs(16), alignItems: 'center', paddingVertical: rs(15) },
  ctaTxt: { color: '#fff', fontSize: rf(15), fontWeight: '800' },
});

// ─────────────────────────────────────────────────
// Фильтр постоянной работы: поиск / где искать / время публикации /
// регион+метро / доход / график. Только поля, что реально есть у вакансий.
// ─────────────────────────────────────────────────
export type PermFilters = {
  query: string;
  searchIn: ('title' | 'desc')[]; // пусто = и там, и там
  posted: 'all' | 'week' | '3days';
  stations: string[];
  salaryFrom: string; // сырой ввод из поля «От»
  schedules: string[];
  companies: string[];
  sections: JobSection[];
  // Как у Cofinder: уровень и формат вычисляются из текста вакансии
  // (services/vacancyFacets.ts), сортировка — «как подобрали» или по свежести.
  levels: VacancyLevel[];
  formats: VacancyFormat[];
  sort: 'default' | 'new';
};
export const EMPTY_PERM_FILTERS: PermFilters = { query: '', searchIn: [], posted: 'all', stations: [], salaryFrom: '', schedules: [], companies: [], sections: [], levels: [], formats: [], sort: 'default' };

type FeedCard =
  | { _ext: false; v: PermVacancy }
  | { _ext: true;  v: ExtVacancy };

const postedWithin = (iso: string | undefined, p: PermFilters['posted']) => {
  if (p === 'all' || !iso) return true;
  const days = p === 'week' ? 7 : 3;
  return Date.now() - new Date(iso).getTime() <= days * 86400000;
};


function CompanyPicker({ visible, options, selected, onChange, onClose }: {
  visible: boolean;
  options: VacancyCompanyOption[];
  selected: string[];
  onChange: (companies: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(selected[0] ?? '');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setQuery('');
      setDraft(selected[0] ?? '');
    }
  }, [visible, selected]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ru-RU');
    return q ? options.filter(x => x.name.toLocaleLowerCase('ru-RU').includes(q)) : options;
  }, [options, query]);

  if (!visible) return null;

  const Check = ({ on }: { on: boolean }) => (
    <View style={[mp.check, on && mp.checkOn]}>
      {on ? <Ionicons name="checkmark" size={rf(14)} color="#fff" /> : null}
    </View>
  );

  return (
    <View style={styles.filterOverlay}>
      <View style={[styles.filterSheet, { maxHeight: '90%' }]}>
        <View style={styles.filterSheetHeader}>
          <View style={{ width: rs(22) }} />
          <Text style={styles.filterSheetTitle}>Компания</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.filterClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={metroPickerSt.searchRow}>
          <Ionicons name="search" size={rf(16)} color={Colors.textMuted} />
          <TextInput
            style={metroPickerSt.searchInput}
            placeholder="Название компании"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            clearButtonMode="while-editing"
          />
        </View>

        <FlatList
          data={rows}
          keyExtractor={item => item.name}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={(
            <TouchableOpacity
              style={[mp.card, draft === '' && mp.cardOn]}
              onPress={() => setDraft('')}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[mp.name, { fontWeight: '700' }]}>Все компании</Text>
                <Text style={mp.sub}>{options.reduce((sum, item) => sum + item.count, 0)} вакансий</Text>
              </View>
              <Check on={draft === ''} />
            </TouchableOpacity>
          )}
          renderItem={({ item }) => {
            const on = draft === item.name;
            return (
              <TouchableOpacity
                style={[mp.card, on && mp.cardOn]}
                onPress={() => setDraft(item.name)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={mp.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={mp.sub}>{item.count} вакансий</Text>
                </View>
                <Check on={on} />
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<View style={metroPickerSt.empty}><Text style={metroPickerSt.emptyTxt}>Компания не найдена</Text></View>}
        />

        <View style={[mp.footer, { paddingBottom: insets.bottom + rs(84) }]}>
          <TouchableOpacity style={mp.save} onPress={() => { onChange(draft ? [draft] : []); onClose(); }} activeOpacity={0.85}>
            <Text style={mp.saveTxt}>Сохранить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={mp.reset} onPress={() => setDraft('')} activeOpacity={0.85}>
            <Text style={mp.resetTxt}>Сбросить</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function PermFilterSheet({
  initial, companyOptions, count, onApply, onClose, onOpenMap, bottomInset,
}: {
  initial: PermFilters;
  companyOptions: VacancyCompanyOption[];
  count: (f: PermFilters) => number;
  onApply: (f: PermFilters) => void;
  onClose: () => void;
  onOpenMap: () => void;
  bottomInset: number;
}) {
  const [draft, setDraft] = useState<PermFilters>(initial);
  const [metroOpen, setMetroOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);

  const toggleSearchIn = (id: 'title' | 'desc') => setDraft(d => ({
    ...d, searchIn: d.searchIn.includes(id) ? d.searchIn.filter(x => x !== id) : [...d.searchIn, id],
  }));

  const n = count(draft);

  return (
    // Как у Sorce: фон затемняется, шторка выезжает снизу и уезжает обратно
    // при закрытии (exiting срабатывает, потому что шторку снимают с экрана
    // условием в разметке). Тап по затемнению закрывает без применения.
    <Reanimated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(160)}
      style={[styles.filterOverlay, { bottom: bottomInset }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть фильтры" />
      <Reanimated.View
        entering={SlideInDown.springify().damping(20).stiffness(180)}
        exiting={SlideOutDown.duration(200)}
        style={[styles.filterSheet, { maxHeight: '92%' }]}
      >
        <View style={styles.filterSheetHandle} />
        <View style={styles.filterSheetHeader}>
          <Text style={styles.filterSheetTitle}>Фильтры</Text>
          <TouchableOpacity onPress={() => setDraft(EMPTY_PERM_FILTERS)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={fst.reset}>Сбросить</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.filterClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: rs(12) }}>
          {/* «Разделы» убраны 26.09.2026: лента только IT, и выбор «Склад» или
              «Продажи» давал бы пустую колоду. */}
          <Text style={fst.label}>Компания</Text>
          <TouchableOpacity style={fst.rowSel} onPress={() => setCompanyOpen(true)} activeOpacity={0.8}>
            <Text style={fst.rowSelName} numberOfLines={1}>{draft.companies[0] ?? 'Все компании'}</Text>
            <Text style={fst.rowSelHint}>{draft.companies.length ? 'изменить ›' : 'выбрать ›'}</Text>
          </TouchableOpacity>

          <View style={pfl.searchWrap}>
            <Ionicons name="search" size={rf(16)} color={Colors.textMuted} />
            <TextInput
              style={pfl.searchInput}
              placeholder="Должность, ключевые слова"
              placeholderTextColor={Colors.textMuted}
              value={draft.query}
              onChangeText={t => setDraft(d => ({ ...d, query: t }))}
              returnKeyType="search"
            />
          </View>

          <Text style={fst.label}>Искать только</Text>
          <View style={fst.chipsWrap}>
            {([['title', 'В названии вакансии'], ['desc', 'В описании вакансии']] as const).map(([id, lbl]) => {
              const on = draft.searchIn.includes(id);
              return (
                <TouchableOpacity key={id} style={[fst.chip, on && fst.chipOn]} onPress={() => toggleSearchIn(id)} activeOpacity={0.8}>
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Уровень</Text>
          <View style={fst.chipsWrap}>
            {VACANCY_LEVELS.map(({ id, label }) => {
              const on = draft.levels.includes(id);
              return (
                <TouchableOpacity
                  key={id}
                  style={[fst.chip, on && fst.chipOn]}
                  onPress={() => setDraft(d => ({ ...d, levels: on ? d.levels.filter(x => x !== id) : [...d.levels, id] }))}
                  activeOpacity={0.8}
                >
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Формат</Text>
          <View style={fst.chipsWrap}>
            {VACANCY_FORMATS.map(({ id, label }) => {
              const on = draft.formats.includes(id);
              return (
                <TouchableOpacity
                  key={id}
                  style={[fst.chip, on && fst.chipOn]}
                  onPress={() => setDraft(d => ({ ...d, formats: on ? d.formats.filter(x => x !== id) : [...d.formats, id] }))}
                  activeOpacity={0.8}
                >
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Сортировка</Text>
          <View style={fst.chipsWrap}>
            {([['default', 'По умолчанию'], ['new', 'Сначала новые']] as const).map(([id, lbl]) => {
              const on = draft.sort === id;
              return (
                <TouchableOpacity key={id} style={[fst.chip, on && fst.chipOn]} onPress={() => setDraft(d => ({ ...d, sort: id }))} activeOpacity={0.8}>
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Время публикации</Text>
          <View style={fst.chipsWrap}>
            {([['all', 'За всё время'], ['week', 'За неделю'], ['3days', 'За три дня']] as const).map(([id, lbl]) => {
              const on = draft.posted === id;
              return (
                <TouchableOpacity key={id} style={[fst.chip, on && fst.chipOn]} onPress={() => setDraft(d => ({ ...d, posted: id }))} activeOpacity={0.8}>
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Регион</Text>
          <View style={[fst.rowSel, { opacity: 0.6 }]}>
            <Text style={fst.rowSelName}>Москва</Text>
            <Text style={fst.rowSelHint}>единственный регион</Text>
          </View>
          <TouchableOpacity style={[fst.rowSel, { marginTop: rs(8) }]} onPress={() => setMetroOpen(true)} activeOpacity={0.8}>
            <Text style={fst.rowSelName} numberOfLines={1}>
              {draft.stations.length === 0 ? 'Добавить метро'
                : draft.stations.length <= 2 ? draft.stations.map(s => `м. ${s}`).join(', ')
                : `Выбрано станций: ${draft.stations.length}`}
            </Text>
            <Text style={fst.rowSelHint}>{draft.stations.length ? 'изменить ›' : '+'}</Text>
          </TouchableOpacity>
          {/* Карта жила отдельной кнопкой в полосе над колодой; полосу убрали
              ради высоты карточки, а карта — тот же выбор станции, только
              глазами. Место ей рядом со списком станций, а не над лентой. */}
          <TouchableOpacity style={[fst.rowSel, { marginTop: rs(8) }]} onPress={onOpenMap} activeOpacity={0.8}>
            <Text style={fst.rowSelName}>Выбрать на карте</Text>
            <Ionicons name="map-outline" size={16} color={Colors.textMuted} />
          </TouchableOpacity>

          <Text style={fst.label}>Уровень дохода</Text>
          <View style={pfl.salaryRow}>
            <TextInput
              style={pfl.salaryInput}
              placeholder="От"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              value={draft.salaryFrom}
              onChangeText={t => setDraft(d => ({ ...d, salaryFrom: t.replace(/[^0-9]/g, '') }))}
            />
            <View style={pfl.rub}><Text style={pfl.rubTxt}>₽</Text></View>
          </View>
        </ScrollView>

        <TouchableOpacity style={[fst.cta, { marginBottom: rs(16) }]} activeOpacity={0.85} onPress={() => { onApply(draft); onClose(); }}>
          <Text style={fst.ctaTxt}>{n > 0 ? `Показать ${n}` : 'Показать вакансии'}</Text>
        </TouchableOpacity>
      </Reanimated.View>

      <MetroPicker
        visible={metroOpen}
        selected={draft.stations}
        onChange={stations => setDraft(d => ({ ...d, stations }))}
        onClose={() => setMetroOpen(false)}
      />
      <CompanyPicker
        visible={companyOpen}
        options={companyOptions}
        selected={draft.companies}
        onChange={companies => setDraft(d => ({ ...d, companies }))}
        onClose={() => setCompanyOpen(false)}
      />
    </Reanimated.View>
  );
}

/**
 * Круглая кнопка нижнего ряда с откликом на нажатие, как у Sorce: под пальцем
 * кнопка чуть сжимается и светлеет, после отпускания пружинит обратно, и
 * только потом открывается шторка — иначе вспышку никто не успевает увидеть.
 * Всё на Reanimated, на потоке интерфейса.
 */
function FlashButton({ onPress, style, accessibilityLabel, children }: {
  onPress: () => void;
  style: any;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const pressed = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.1 }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: pressed.value * 0.35 }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 90 }); }}
      onPressOut={() => { pressed.value = withSpring(0, { damping: 12, stiffness: 260 }); }}
      onPress={() => setTimeout(onPress, 110)}
    >
      <Reanimated.View style={[style, animStyle]}>
        {children}
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, flashBtn.flash, flashStyle]} />
      </Reanimated.View>
    </Pressable>
  );
}

const flashBtn = StyleSheet.create({
  flash: { backgroundColor: '#FFFFFF', borderRadius: 999 },
});

const pfl = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    marginHorizontal: rs(16), marginTop: rs(12),
    backgroundColor: Colors.surface, borderRadius: rs(12),
    paddingHorizontal: rs(12), paddingVertical: rs(11),
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  searchInput: { flex: 1, fontSize: rf(15), color: Colors.textPrimary, padding: 0 },
  salaryRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8), paddingHorizontal: rs(16) },
  salaryInput: {
    flex: 1, fontSize: rf(15), color: Colors.textPrimary,
    backgroundColor: Colors.surface, borderRadius: rs(12), borderWidth: 1, borderColor: Colors.inputBorder,
    paddingHorizontal: rs(14), paddingVertical: rs(12),
  },
  rub: {
    width: rs(48), alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderRadius: rs(12), borderWidth: 1, borderColor: Colors.inputBorder,
    paddingVertical: rs(12),
  },
  rubTxt: { fontSize: rf(16), fontWeight: '700', color: Colors.textSecondary },
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

// Шапка ленты: марка, поиск и счётчик открытых вакансий.
//
// Поиск здесь, а не в шторке фильтров, потому что это самое частое действие:
// человек приходит с названием должности в голове. Шторка осталась для
// всего остального — станции, зарплаты, графика.
function FeedSearchHeader({ value, onChange, energy, onUndo, onEnergyPress }: {
  value: string;
  onChange: (t: string) => void;
  /** Сколько свайпов осталось на сегодня. */
  energy: number;
  /** Вернуть последнюю пролистанную вакансию. null — возвращать нечего. */
  onUndo: (() => void) | null;
  onEnergyPress: () => void;
}) {
  return (
    <View style={fh.row}>
      <View style={fh.logoWrap} accessibilityLabel="JobToo">
        <Image
          source={require('@/assets/images/header-jt-logo.png')}
          style={fh.logoImage}
          resizeMode="contain"
        />
      </View>

      <View style={fh.search}>
        <Ionicons name="search" size={20} color={Colors.textMuted} />
        <TextInput
          style={fh.input}
          value={value}
          onChangeText={onChange}
          placeholder="Должность, компания или ключевое слово"
          placeholderTextColor={Colors.textMuted}
          returnKeyType="search"
          accessibilityLabel="Поиск вакансий"
        />
        {value ? (
          <TouchableOpacity onPress={() => onChange('')} accessibilityLabel="Очистить поиск" hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Возврат появляется, только когда есть что вернуть, и тогда поиск
          сужается сам: у него flex, а кнопка своей ширины. Держать её всегда
          и гасить серым — значит всё время отнимать место у поиска ради
          действия, которого в первую минуту работы ленты ещё не существует. */}
      {onUndo ? (
        <TouchableOpacity
          style={fh.undo}
          onPress={onUndo}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Вернуть последнюю вакансию"
        >
          <Ionicons name="arrow-undo" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      ) : null}

      {/* Сколько свайпов осталось на сегодня. Не «сколько вакансий»: число
          вакансий человеку ни о чём не говорит, а вот что запас кончается —
          говорит, и заранее, а не в момент стены. */}
      <TouchableOpacity
        style={[fh.count, energy <= 0 && fh.countEmpty]}
        onPress={onEnergyPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Свайпов осталось на сегодня: ${energy}`}
      >
        <Ionicons name="flash" size={16} color={energy > 0 ? Colors.primary : Colors.textMuted} />
        <Text style={[fh.countTxt, energy <= 0 && fh.countTxtEmpty]}>{energy}</Text>
      </TouchableOpacity>
    </View>
  );
}

const fh = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    paddingHorizontal: rs(13), paddingTop: rs(13), paddingBottom: 0,
    backgroundColor: Colors.bgWarm,
  },
  logoWrap: {
    width: rs(40), height: rs(46), flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  // Точный логотип, присланный владельцем. Уменьшен вдвое,
  // при этом остаётся выровнен по центру относительно поисковой строки.
  logoImage: {
    width: rs(40), height: rs(26),
  },
  search: {
    flex: 1, minWidth: 0, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    backgroundColor: '#FFFFFF', borderRadius: rs(24),
    paddingHorizontal: rs(14), height: rs(46),
  },
  // Высота задана контейнеру: на Android TextInput со своим padding
  // раздувает строку и шапка перестаёт совпадать с макетом.
  input: { flex: 1, minWidth: 0, fontSize: rf(14), color: Colors.textPrimary, padding: 0 },
  undo: {
    width: rs(46), height: rs(46), borderRadius: rs(23), flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E9EAEC',
  },
  count: {
    flexDirection: 'row', alignItems: 'center', gap: rs(5),
    backgroundColor: '#FFFFFF', borderRadius: rs(24),
    paddingHorizontal: rs(13), height: rs(46), flexShrink: 0,
  },
  countTxt: { fontSize: rf(16), fontWeight: '800', color: Colors.textPrimary },
  countEmpty: { backgroundColor: '#ECEDEF' },
  countTxtEmpty: { color: Colors.textMuted },
});

function WorkerPermMode() {
  const router = useRouter();
  const {
    currentUser, permVacancies, permApplications,
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
  const [searchText, setSearchText] = useState('');
  const [filterStations, setFilterStations] = useState<string[]>([]);
  // Доп. фильтры постоянной работы (см. PermFilterSheet).
  const [searchIn, setSearchIn] = useState<('title' | 'desc')[]>([]);
  const [posted, setPosted] = useState<'all' | 'week' | '3days'>('all');
  const [schedules, setSchedules] = useState<string[]>([]);
  const [filterCompanies, setFilterCompanies] = useState<string[]>([]);
  const [levels, setLevels] = useState<VacancyLevel[]>([]);
  const [formats, setFormats] = useState<VacancyFormat[]>([]);
  const [sortMode, setSortMode] = useState<PermFilters['sort']>('default');
  const [permFilterOpen, setPermFilterOpen] = useState(false);
  // Дневной запас свайпов и плашка «на сегодня всё».
  const energy = useEnergy();
  const [limitOpen, setLimitOpen] = useState(false);
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
  const [filterPicker, setFilterPicker] = useState(false);
  const [minSalary, setMinSalary] = useState(0);
  const [applying, setApplying] = useState<string | null>(null);
  // Вакансия, по которой человек сейчас пишет отклик (null — окно закрыто)
  const [permApplyFor, setPermApplyFor] = useState<PermVacancy | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  // Разделы ленты: пусто — подбираем сами. Сохраняются на телефоне и
  // переживают перезапуск (services/storage.ts).
  const [sections, setSections] = useState<JobSection[]>([]);
  const [careerVacancies, setCareerVacancies] = useState<ExtVacancy[]>([]);
  const [careerLoading, setCareerLoading] = useState(false);
  // Свои вакансии, смахнутые влево и записанные на сервере, — их колода
  // больше не показывает (та же идея, что у extLeftSwipes ниже).
  const [permSwiped, setPermSwiped] = useState<Set<string>>(new Set());
  const swDecisionPending = useRef(false);
  const permSavedMutationIds = useRef<Set<string>>(new Set());

  // Для кого разделы уже прочитаны с телефона. Пока не прочитаны, карьерную
  // ленту не грузим: иначе человек с выбранными разделами сперва получал бы
  // колоду без них, а через мгновение — другую, и верхняя карта мигала бы.
  const [sectionsLoadedFor, setSectionsLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!currentUser?.id) return;
    const id = currentUser.id;
    // Лента только IT: сохранённые раньше разделы («Склад», «Продажи»)
    // больше не применяем — с ними колода была бы пустой.
    setSections([]);
    setSectionsLoadedFor(id);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || currentUser.isGuest) return;
    let cancelled = false;
    dbGetPermSwipes(currentUser.id).then(rows => {
      if (cancelled) return;
      setPermSwiped(new Set(rows.filter(r => r.dir === -1).map(r => r.vacancyId)));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.isGuest]);

  const permCompanyOptions = useMemo(() => {
    const counts = new Map<string, number>();
    permVacancies.forEach(v => {
      const name = v.status === 'open' ? v.company.trim() : '';
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    // Карьерные компании — в тех же счётчиках: выбор в фильтре один список.
    careerVacancies.forEach(v => {
      const name = v.company.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return Array.from(counts, ([name, count]) => ({ name, count }))
      .filter(item => item.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [permVacancies, careerVacancies]);

  // Вакансии для карты: метка — это адрес, станция остаётся для фильтра
  const permMapItems: MapListItem[] = useMemo(
    () => (permVacancies as PermVacancy[])
      .filter((v: PermVacancy) => v.status === 'open' && (filterCompanies.length === 0 || filterCompanies.includes(v.company)) && (!!v.metroStation || !!v.address))
      .map((v: PermVacancy) => ({
        id: v.id,
        station: (v.metroStation ?? '') as string,
        title: v.title,
        company: v.company,
        pay: payShort(v.salary, v.workType),
        meta: v.schedule,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
      })),
    [permVacancies, filterCompanies],
  );

  // Карьерная лента грузится всегда, не только по флагу «показать источник»:
  // разделов теперь по умолчанию нет, и обе колоды всегда идут вместе.
  // Ключ по строке, а не по массиву: массив — новая ссылка на каждый рендер,
  // эффект гонял бы запрос без остановки.
  const sectionsKey = sections.join(',');
  useEffect(() => {
    if (!currentUser?.id || sectionsLoadedFor !== currentUser.id) return;
    let cancelled = false;
    setCareerLoading(true);
    dbGetExtFeed(60, sections).then(data => {
      if (!cancelled) setCareerVacancies(data);
    }).catch(() => {}).finally(() => { if (!cancelled) setCareerLoading(false); });
    return () => { cancelled = true; };
  }, [sectionsKey, currentUser?.id, sectionsLoadedFor]);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const promises: Promise<void>[] = [
        refreshPermVacancies(), refreshPermApplications(),
        dbGetExtFeed(60, sections).then(data => {
          setCareerVacancies(data);
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
  const [swHistory, setSwHistory] = useState<string[]>([]);
  const swWantRef = useRef<(vx?: number) => void>(() => {});
  const swSkipRef = useRef<(vx?: number) => void>(() => {});
  // Тот же хук, что у колоды смен: свайп должен ощущаться одинаково на обеих
  // вкладках, а не жить двумя похожими копиями, которые разойдутся.
  const swDeck = useSwipeDeck({
    want: vx => swWantRef.current(vx),
    skip: vx => swSkipRef.current(vx),
  });

  // «Назад»: вернуть последнюю пролистанную карточку наверх колоды. Отклик,
  // если он уже ушёл, не отзываем — как в сменах кнопка просто возвращает вид.
  // Свайпы влево — и по карьерным, и по своим вакансиям — сервер запоминает
  // навсегда, поэтому «вернуть» снимает и запись. Вправо — это отклик: он уже
  // либо в очереди Юпитера, либо ушёл работодателю, и не отзывается.
  const extLeftSwipes = useRef<Set<string>>(new Set());
  const permLeftSwipes = useRef<Set<string>>(new Set());
  const swUndo = useCallback(() => {
    setSwHistory(h => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      if (extLeftSwipes.current.has(last) && currentUser?.id) {
        extLeftSwipes.current.delete(last);
        dbExtUnswipe(currentUser.id, last).catch(() => {});
      } else if (permLeftSwipes.current.has(last) && currentUser?.id) {
        permLeftSwipes.current.delete(last);
        dbPermUnswipe(currentUser.id, last).catch(() => {});
        setPermSwiped(s => { const n = new Set(s); n.delete(last); return n; });
      }
      setSwSkipped(s => { const n = new Set(s); n.delete(last); return n; });
      // Свайп вернули — возвращаем и его стоимость. Иначе промах наказан
      // дважды: и карточку верни, и энергию потерял.
      energy.refundOne();
      return h.slice(0, -1);
    });
  }, [energy, currentUser?.id]);

  // Карьерная лента приходит порциями: когда в колоде остаётся пять карт,
  // тихо берём следующую. Сервер уже не отдаёт свайпнутое, а на случай
  // гонки (свайп ещё не записан) повторы отсекаются по id.
  const careerRefilling = useRef(false);
  useEffect(() => {
    if (careerRefilling.current || careerVacancies.length === 0) return;
    const left = careerVacancies.filter(v => !swSkipped.has(v.id)).length;
    if (left > 5) return;
    careerRefilling.current = true;
    dbGetExtFeed(60, sections)
      .then(more => setCareerVacancies(cur => {
        const seen = new Set(cur.map(v => v.id));
        const add = more.filter(v => !seen.has(v.id));
        return add.length ? [...cur, ...add] : cur;
      }))
      .catch(() => {})
      .finally(() => { careerRefilling.current = false; });
  }, [careerVacancies, swSkipped, sections]);
  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  const myApps = permApplications.filter(a => a.workerId === currentUser.id);
  const myAppVacIds = new Set(myApps.map(a => a.vacancyId));

  // Текущие применённые фильтры одним объектом — так их удобно и применять,
  // и считать «Показать N» для черновика в шторке.
  const permF: PermFilters = { query: searchText, searchIn, posted, stations: filterStations, salaryFrom: minSalary > 0 ? String(minSalary) : '', schedules, companies: filterCompanies, sections, levels, formats, sort: sortMode };
  const permFiltersActive = filterStations.length > 0 || !!searchText || minSalary > 0 || searchIn.length > 0 || posted !== 'all' || schedules.length > 0 || filterCompanies.length > 0 || sections.length > 0
    || levels.length > 0 || formats.length > 0 || sortMode !== 'default';

  const permMatchesQuery = (title: string, company: string, desc: string, f: PermFilters) => {
    if (!f.query) return true;
    const q = f.query.toLowerCase();
    const inTitle = title.toLowerCase().includes(q) || company.toLowerCase().includes(q);
    const inDesc = desc.toLowerCase().includes(q);
    if (f.searchIn.length === 0) return inTitle || inDesc;
    return (f.searchIn.includes('title') && inTitle) || (f.searchIn.includes('desc') && inDesc);
  };
  const permMatchesMeta = (station: string | undefined, salary: number, created: string | undefined, schedule: string | undefined, f: PermFilters) => {
    if (f.stations.length && !f.stations.includes(station ?? '')) return false;
    const from = parseInt(f.salaryFrom || '0', 10);
    if (from > 0 && salary < from) return false;
    if (!postedWithin(created, f.posted)) return false;
    if (f.schedules.length && !f.schedules.some(s => (schedule ?? '').toLowerCase().includes(s.toLowerCase()))) return false;
    return true;
  };

  const permMatchesCompany = (company: string | undefined, f: PermFilters) =>
    f.companies.length === 0 || (!!company && f.companies.includes(company));
  // Уровень и формат: без признака в тексте вакансия выбранный фильтр не
  // проходит — выдавать её за «Senior» или «удалёнку» было бы враньём.
  const permMatchesFacets = (title: string, schedule: string | undefined, desc: string, f: PermFilters) => {
    if (f.levels.length) {
      const lv = vacancyLevel(title);
      if (!lv || !f.levels.includes(lv)) return false;
    }
    if (f.formats.length) {
      const fm = vacancyFormat(schedule, desc);
      if (!fm || !f.formats.includes(fm)) return false;
    }
    return true;
  };
  const matchesSearch = (v: PermVacancy) => permMatchesQuery(v.title, v.company, v.description ?? '', permF);
  // Свои вакансии JobToo — тоже только IT (решение владельца 26.09.2026).
  const matchesFilters = (v: PermVacancy) => sectionOfPerm(v.workType) === 'it'
    && permMatchesCompany(v.company, permF)
    && permMatchesMeta(v.metroStation, v.salary, v.createdAt, v.schedule, permF)
    && permMatchesFacets(v.title, v.schedule, v.description ?? '', permF)
    && (permF.sections.length === 0 || permF.sections.includes(sectionOfPerm(v.workType)));
  // Карьерная вакансия проходит те же фильтры: раздел у неё уже размечен
  // сервером при приёме (php-proxy/job_sections.php), а не выводится из вида работ.
  const matchesExtFilters = (v: ExtVacancy, f: PermFilters) =>
    permMatchesQuery(v.title, v.company, v.description ?? '', f)
    && permMatchesCompany(v.company, f)
    && permMatchesMeta(v.metroStation ?? undefined, v.salary ?? 0, v.firstSeenAt, v.schedule ?? undefined, f)
    && permMatchesFacets(v.title, v.schedule ?? undefined, v.description ?? '', f)
    && (f.sections.length === 0 || (!!v.section && f.sections.includes(v.section)));

  // Лента показывает только открытые вакансии, на которые человек ещё не
  // откликался и не свайпнул влево. Свои отклики и избранное живут на экране
  // «Отклики»: колода здесь одна, и выбирать между списками больше не из чего.
  const openVacancies = permVacancies.filter(v => v.status === 'open' && !myAppVacIds.has(v.id) && !permSwiped.has(v.id) && matchesSearch(v) && matchesFilters(v));

  // «Показать N» в шторке фильтров под выбранный черновик: свои + уже
  // загруженные карьерные (карьерные не перезапрашиваются под черновик —
  // только под применённый выбор разделов).
  const countPermLocal = (f: PermFilters) => {
    const ownCount = permVacancies.filter(v => v.status === 'open' && !myAppVacIds.has(v.id) && !permSwiped.has(v.id)
      && sectionOfPerm(v.workType) === 'it'
      && permMatchesCompany(v.company, f)
      && permMatchesQuery(v.title, v.company, v.description ?? '', f)
      && permMatchesMeta(v.metroStation, v.salary, v.createdAt, v.schedule, f)
      && permMatchesFacets(v.title, v.schedule, v.description ?? '', f)
      && (f.sections.length === 0 || f.sections.includes(sectionOfPerm(v.workType)))).length;
    const extCount = careerVacancies.filter(v => matchesExtFilters(v, f)).length;
    return ownCount + extCount;
  };

  // Своя лента ранжируется под вкус (виды работ, метро) и чередуется с
  // карьерной — «своя, карьерная, карьерная, своя, …» (services/feedMix.ts).
  const ownRanked = rankOwn(openVacancies, {
    sections: (currentUser.workTypes ?? []).map(wt => SECTION_BY_WORK_TYPE[wt]),
    metro: currentUser.metroStation ?? null,
  });
  const openCareerVacancies = careerVacancies.filter(v => matchesExtFilters(v, permF));
  const mixedCards: FeedCard[] = interleaveDeck(ownRanked, openCareerVacancies).map(x =>
    x.own ? { _ext: false as const, v: x.v } : { _ext: true as const, v: x.v });
  // «Сначала новые» — по дате появления, без подбора под вкус: так человек
  // видит свежее первым, как у Cofinder. Сортировка устойчивая, равные даты
  // сохраняют порядок подбора.
  const cardTime = (c: FeedCard) => Date.parse((c._ext ? c.v.firstSeenAt : c.v.createdAt) || '') || 0;
  const feedCards: FeedCard[] = sortMode === 'new'
    ? [...mixedCards].sort((a, b) => cardTime(b) - cardTime(a))
    : mixedCards;

  const applyToExt = async (ev: ExtVacancy): Promise<boolean> => {
    if (!currentUser || currentUser.isGuest) return false;
    setApplying(ev.id);
    try {
      if (!await ensureResumeForApply()) return false;
      if (!await requestJupiterLive(currentUser.id)) return false;
      const application = await jupiterEnqueue(currentUser.id, ev.url, ev.company);
      showToast(application.state === 'queued'
        ? 'Юпитер готовит и отправляет отклик. Статус — в «Откликах».'
        : 'Заявка уже есть. Статус — в «Откликах».', 'success');
      return true;
    } catch (e: any) {
      const msg = e?.message ?? '';
      console.warn('[applyToExt]', msg);
      showToast(msg || 'Не удалось создать заявку', 'error');
      return false;
    } finally {
      setApplying(null);
    }
  };

  const applyTo = (v: PermVacancy) : void => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      promptRegister({ vacancyId: v.id, vacancyKind: 'permanent' });
      return;
    }
    if (myAppVacIds.has(v.id) || applying === v.id) { showToast('Уже откликнулись', 'success'); return; }
    setPermApplyFor(v);
  };

  const sendPermApply = async (message: string) => {
    const v = permApplyFor;
    if (!v || !currentUser) return;
    setApplying(v.id);
    try {
      await dbApplyPermVacancy(v.id, currentUser.id, v.employerId, message);
      showToast('Отклик отправлен', 'success');
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
    } finally {
      setApplying(null);
    }
  };

  // Тот же набор, что видит директор в своей шторке, — и так же иконками,
  // а не смайликами: их рисует система, и на каждом телефоне по-своему.
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
    const url = `https://t.me/JobToo_bot/app?startapp=share_perm_${v.id}_${shareCampaignId}`;
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
  // пропустить. Порядок пролистанных хранится в swHistory, чтобы кнопка
  // возврата в шапке вернула последнюю.
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
        void applyToExt(c.v).then(accepted => {
          if (accepted) {
            resetCardScroll();
            setSwSkipped(s => new Set(s).add(c.v.id));
            setSwHistory(h => [...h, c.v.id]);
            dbExtSwipe(currentUser.id, c.v.id, 1).catch(() => {});
          } else {
            energy.refundOne();
            swDeck.snapBack();
          }
        }).finally(() => { swDecisionPending.current = false; });
      } else if (currentUser.isGuest) {
        // Гостя applyTo сам отправит на регистрацию — резюме у него ещё нет
        // и быть не может, проверять раньше стены регистрации незачем.
        resetCardScroll();
        setSwSkipped(s => new Set(s).add(c.v.id));
        setSwHistory(h => [...h, c.v.id]);
        applyTo(c.v);
        swDecisionPending.current = false;
      } else {
        void ensureResumeForApply().then(hasResume => {
          if (hasResume) {
            resetCardScroll();
            setSwSkipped(s => new Set(s).add(c.v.id));
            setSwHistory(h => [...h, c.v.id]);
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
    if (!energy.spendOne()) { setLimitOpen(true); swDeck.snapBack(); return; }
    swDecisionPending.current = true;
    swFly('left', vx, () => {
      resetCardScroll();
      setSwSkipped(s => new Set(s).add(c.v.id));
      setSwHistory(h => [...h, c.v.id]);
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

  // Опускаем ряд ✕ / фильтр / ♥ ещё ниже, ближе к плавающему таббару.
  // Резерв карточки считается от той же координаты, поэтому её видимая высота
  // увеличивается ровно на столько же и снизу не появляется новая пустота.
  const deckActionGap = rs(-6);
  const deckCardGap = rs(8);
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

          <View
            style={pS.deckUtilityOverlay}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={permSavedIds.includes(v.id) ? 'Удалить из избранного' : 'Сохранить вакансию'}
              style={pS.deckUtilityTap}
              onPress={() => { void toggleSaved(v); }}
              activeOpacity={0.7}
            >
              <OnboardingTarget targetKey="worker.feed.save">
                <View style={[pS.deckUtilityBtn, permSavedIds.includes(v.id) && pS.deckUtilityBtnSaved]}>
                  <Ionicons
                    name={permSavedIds.includes(v.id) ? 'bookmark' : 'bookmark-outline'}
                    size={21}
                    color={permSavedIds.includes(v.id) ? Colors.primary : Colors.textSecondary}
                  />
                </View>
              </OnboardingTarget>
            </TouchableOpacity>
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
            <Text style={styles.wantText}>ОТКЛИК ♥</Text>
          </Reanimated.View>
          <Reanimated.View
            pointerEvents="none"
            style={[styles.skipOverlay, swDeck.skipStyle]}
          >
            <Text style={styles.skipText}>НЕТ ✕</Text>
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

        <View style={[styles.shiftDeckActions, { bottom: deckActionBottom }]} pointerEvents="box-none">
          <View style={styles.shiftDeckRow}>
          <OnboardingTarget targetKey="worker.feed.reject">
            <TouchableOpacity
              accessibilityLabel="Отклонить вакансию"
              style={[styles.deckFloatingAction, styles.deckFloatingSkip]}
              onPress={() => swSkip(0.5)}
              activeOpacity={0.75}
            >
              <Ionicons name="close" size={34} color={Colors.red} />
            </TouchableOpacity>
          </OnboardingTarget>

          <OnboardingTarget targetKey="worker.feed.filter">
            <FlashButton
              accessibilityLabel={permFiltersActive ? 'Фильтры включены, настроить' : 'Настроить фильтры'}
              style={[styles.deckFloatingAction, styles.deckFloatingChat, permFiltersActive && styles.deckFloatingChatActive]}
              onPress={() => setPermFilterOpen(true)}
            >
              <Ionicons name="settings-sharp" size={24} color={permFiltersActive ? '#FFFFFF' : Colors.textSecondary} />
            </FlashButton>
          </OnboardingTarget>

          <OnboardingTarget targetKey="worker.feed.apply">
            <TouchableOpacity
              accessibilityLabel="Откликнуться на вакансию"
              style={[styles.deckFloatingAction, styles.deckFloatingWant]}
              onPress={() => swWant(0.5)}
              activeOpacity={0.75}
            >
              <Ionicons name="heart" size={31} color="#fff" />
            </TouchableOpacity>
          </OnboardingTarget>
          </View>
        </View>
      </View>
    );
  };

  const renderExtDeckCard = (ev: ExtVacancy) => {
    const displayCompany = ev.company || 'Карьерный сайт';
    const salary = typeof ev.salary === 'number' ? ev.salary : 0;
    const schedule = ev.schedule;
    // Чипа «вид работ» у карьерной вакансии нет: наши четыре вида — про смены
    // линейного персонала, а старые строки базы угадывали его по названию
    // («Старший разработчик» → «Старший смены»).
    const description = cleanDescription(ev.description ?? undefined);
    const metroLine = ev.metroStation
      ? METRO_LINES.find(l => l.stations.includes(ev.metroStation!)) ?? null
      : null;
    return (
      <View style={[styles.cardArea, { paddingBottom: deckBottomReserve }]}>
        {deckCards[2] ? <View style={[styles.ghost2, { bottom: deckBottomReserve }]} /> : null}
        {deckCards[1] ? <View style={[styles.ghost1, { bottom: deckBottomReserve }]} /> : null}
        <View style={styles.cardViewportShell}>
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
            <Reanimated.View style={[styles.cardAnimated, swDeck.cardStyle]}>
              <View style={styles.card}>
                <Reanimated.View style={[styles.wantOverlay, swDeck.wantStyle]}>
                  <Text style={styles.wantText}>JUPITER ♥</Text>
                </Reanimated.View>
                <Reanimated.View style={[styles.skipOverlay, swDeck.skipStyle]}>
                  <Text style={styles.skipText}>НЕТ ✕</Text>
                </Reanimated.View>

                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <View style={styles.companyRow}>
                      <CompanyMark company={displayCompany} size={34} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.companyName} numberOfLines={1} adjustsFontSizeToFit>
                          {displayCompany}
                        </Text>
                        <Text style={[styles.postedAgo, { color: Colors.primary }]}>Карьерный сайт</Text>
                      </View>
                    </View>

                    <Text style={styles.jobTitle} numberOfLines={3}>{ev.title}</Text>

                    <View style={styles.chipsRow}>
                      {salary > 0 ? <Chip label={`${salary.toLocaleString('ru-RU')} ₽/${ev.payPeriod === 'hour' ? 'ч' : 'мес'}`} variant="salary" icon="wallet-outline" textSize={11} /> : null}
                      {schedule ? <Chip label={schedule} variant="neutral" icon="calendar-outline" textSize={11} /> : null}
                      {ev.metroStation ? <Chip label={ev.metroStation} variant="neutral" icon="subway-outline" textSize={11} /> : null}
                    </View>
                  </View>

                  <View style={styles.cardMiddle}>
                    {(ev.metroStation || ev.address) ? (
                      <View style={pS.sectionBlock}>
                        <View style={pS.blockHead}>
                          <Ionicons name="location-outline" size={16} color={Colors.textPrimary} />
                          <Text style={pS.descTitle}>Расположение</Text>
                        </View>
                        {ev.metroStation ? (
                          <View style={pS.locRow}>
                            {metroLine ? (
                              <View style={[pS.metroDot, { backgroundColor: metroLine.color }]} />
                            ) : (
                              <Ionicons name="subway-outline" size={16} color={Colors.textMuted} />
                            )}
                            <View style={{ flex: 1 }}>
                              {metroLine ? <Text style={pS.metroLineName}>{metroLine.name}</Text> : null}
                              <Text style={pS.locValue}>{ev.metroStation}</Text>
                            </View>
                          </View>
                        ) : null}
                        {ev.address ? (
                          <View style={pS.locRow}>
                            <Ionicons name="location-outline" size={16} color={Colors.textMuted} />
                            <Text style={[pS.locValue, { flex: 1 }]}>{ev.address}</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    <View style={pS.sectionBlock}>
                      {description ? (
                        <View style={pS.blockHead}>
                          <Ionicons name="document-text-outline" size={16} color={Colors.textPrimary} />
                          <Text style={pS.descTitle}>Описание вакансии</Text>
                        </View>
                      ) : null}
                      {description ? <DescriptionBlocks text={description} /> : null}
                    </View>
                  </View>
                </View>
              </View>
            </Reanimated.View>
          </GestureDetector>
          </GHScrollView>
        </View>

        {moreBelow ? (
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

        <View style={[styles.shiftDeckActions, { bottom: deckActionBottom }]} pointerEvents="box-none">
          <View style={styles.shiftDeckRow}>
            <TouchableOpacity
              accessibilityLabel="Пропустить"
              style={[styles.deckFloatingAction, styles.deckFloatingSkip]}
              onPress={() => swSkip(0.5)}
              activeOpacity={0.75}
            >
              <Ionicons name="close" size={34} color={Colors.red} />
            </TouchableOpacity>
            <FlashButton
              accessibilityLabel={permFiltersActive ? 'Фильтры включены, настроить' : 'Настроить фильтры'}
              style={[styles.deckFloatingAction, styles.deckFloatingChat, permFiltersActive && styles.deckFloatingChatActive]}
              onPress={() => setPermFilterOpen(true)}
            >
              <Ionicons name="settings-sharp" size={24} color={permFiltersActive ? '#FFFFFF' : Colors.textSecondary} />
            </FlashButton>
            <TouchableOpacity
              accessibilityLabel="Подать заявку через Jupiter"
              style={[styles.deckFloatingAction, styles.deckFloatingWant]}
              onPress={() => swWant(0.5)}
              activeOpacity={0.75}
            >
              <Ionicons name="heart" size={31} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {isGuest && (
        <TouchableOpacity style={gB.banner} activeOpacity={0.85} onPress={() => promptRegister({ vacancyKind: 'permanent' })}>
          <Ionicons name="lock-closed" size={rs(15)} color="#fff" />
          <Text style={gB.bannerTxt}>Вы смотрите как гость. Зарегистрируйтесь, чтобы откликаться</Text>
          <Text style={gB.bannerCta}>Войти</Text>
        </TouchableOpacity>
      )}

      <FeedSearchHeader
        value={searchText}
        onChange={setSearchText}
        onUndo={swHistory.length ? swUndo : null}
        energy={energy.left}
        onEnergyPress={() => setLimitOpen(true)}
      />

      <View style={pS.chipRow}>
        {filterStations.length > 0 ? (
          <TouchableOpacity style={pS.activeStationChip} onPress={() => setFilterStations([])} activeOpacity={0.8}>
            <Ionicons name="location" size={13} color={Colors.primary} />
            <Text style={pS.activeStationTxt}>
              {filterStations.length === 1 ? `м. ${filterStations[0]}` : `Станций: ${filterStations.length}`}
            </Text>
            <Ionicons name="close" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <MetroMap
        visible={mapOpen}
        title="Вакансии на карте"
        items={permMapItems}
        onSelect={(st) => { setFilterStations(st ? [st] : []); setMapOpen(false); }}
        onClose={() => setMapOpen(false)}
      />

      {backendOffline ? (
        <View style={pS.offlineBar}>
          <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
          <Text style={pS.offlineTxt}>Нет связи с сервером — показаны последние данные. Потяните вниз, чтобы обновить.</Text>
        </View>
      ) : null}

      {/* Запас свайпов кончился. Плашка появляется и по нажатию на счётчик, и
          на каждой новой попытке свайпнуть — молча не пускать хуже, чем
          объяснить. Пока монетизации нет, выхода из неё, кроме «завтра», не
          предлагаем: обещать покупку, которой не существует, нельзя. */}
      {limitOpen ? (
        <View style={pS.limitOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setLimitOpen(false)} />
          <View style={[pS.limitCard, { marginBottom: tabBarHeight + rs(16) }]}>
            <View style={pS.limitIcon}>
              <Ionicons name="flash" size={26} color={Colors.primary} />
            </View>
            <Text style={pS.limitTitle}>На сегодня всё</Text>
            <Text style={pS.limitBody}>
              Свайпы закончились. Завтра снова будет {DAILY_ENERGY} — запас не копится,
              так что откладывать их на потом смысла нет.
            </Text>
            <TouchableOpacity
              style={pS.limitBtn}
              onPress={() => { setLimitOpen(false); router.push('/(tabs)/matches'); }}
              activeOpacity={0.85}
            >
              <Text style={pS.limitBtnTxt}>Посмотреть свои отклики</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pS.limitClose} onPress={() => setLimitOpen(false)} activeOpacity={0.7}>
              <Text style={pS.limitCloseTxt}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {permFilterOpen && (
        <PermFilterSheet
          initial={permF}
          bottomInset={tabBarHeight}
          companyOptions={permCompanyOptions}
          count={countPermLocal}
          onApply={(f) => {
            setSearchText(f.query);
            setSearchIn(f.searchIn);
            setPosted(f.posted);
            setFilterStations(f.stations);
            setMinSalary(parseInt(f.salaryFrom || '0', 10) || 0);
            setSchedules(f.schedules);
            setFilterCompanies(f.companies);
            setLevels(f.levels);
            setFormats(f.formats);
            setSortMode(f.sort);
            setSections(f.sections);
            if (currentUser?.id) saveFeedSections(currentUser.id, f.sections);
          }}
          onClose={() => setPermFilterOpen(false)}
          onOpenMap={() => { setPermFilterOpen(false); setMapOpen(true); }}
        />
      )}

      {/* Лента — всегда колода: вкладок «Отклики»/«Избранное» здесь больше нет,
          они уехали на свой экран, и списочный режим стал недостижим. */}
      {!swTop ? (
        // Пустое состояние делаем прокручиваемым, иначе «потяните вниз»
        // некуда тянуть — жест обновления не срабатывал (особенно офлайн).
        <ScrollView
          contentContainerStyle={[styles.emptyState, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        >
          <Ionicons name={backendOffline ? 'cloud-offline-outline' : careerLoading ? 'hourglass-outline' : 'search-outline'} size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {backendOffline ? 'Нет связи с сервером'
              : careerLoading ? 'Загружаем вакансии…'
              : sections.length > 0 ? 'Подходящие вакансии закончились'
              : 'Нет открытых вакансий'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {backendOffline ? 'Показаны последние данные. Потяните вниз, чтобы обновить.'
              : careerLoading ? ''
              : sections.length > 0 ? 'В выбранных разделах вы всё посмотрели'
              : 'Попробуйте изменить фильтры'}
          </Text>
          {backendOffline ? (
            <TouchableOpacity style={pS.retryBtn} activeOpacity={0.85} onPress={onRefresh}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={pS.retryTxt}>Попробовать снова</Text>
            </TouchableOpacity>
          ) : !careerLoading && sections.length > 0 ? (
            <TouchableOpacity
              style={pS.retryBtn}
              activeOpacity={0.85}
              onPress={() => { setSections([]); if (currentUser?.id) saveFeedSections(currentUser.id, []); }}
            >
              <Text style={pS.retryTxt}>Показать другие разделы</Text>
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

      <MetroPicker
        visible={filterPicker}
        selected={filterStations}
        onChange={setFilterStations}
        onClose={() => setFilterPicker(false)}
      />

      <ApplySheet
        visible={!!permApplyFor}
        onClose={() => setPermApplyFor(null)}
        onSend={sendPermApply}
        title="Отклик на вакансию"
        info={permApplyFor ? permVacancyInfoLines(permApplyFor) : []}
        chips={getChatSuggestions('worker', null)}
      />

    </View>
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
    await refreshAll();
    setRefreshing(false);
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
                  <Text style={pS.appStatArrow}>Посмотреть ↗</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[pS.appStatBtn, { backgroundColor: '#F4F4F5', marginTop: 6 }]}
                  onPress={() => setViewersModal({ id: v.id, kind: 'perm' })}
                  activeOpacity={0.8}
                >
                  <Text style={[pS.appStatNum, { color: Colors.textSecondary }]}>{permVacancyViewsMap[v.id] ?? 0}</Text>
                  <Text style={[pS.appStatLabel, { color: Colors.textSecondary }]}>посмотрели</Text>
                  <Text style={[pS.appStatArrow, { color: Colors.textSecondary }]}>Посмотреть ↗</Text>
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

  // В установленной iOS PWA цвет системной зоны (время / сеть / батарея)
  // берётся из theme-color. На экране вакансий он должен продолжать тёплую
  // подложку, а при уходе на другие вкладки — возвращаться к светлому фону.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || typeof document === 'undefined') return;
      const meta = document.querySelector('meta[name="theme-color"]');
      const previousTheme = meta?.getAttribute('content') ?? null;
      const previousHtmlBg = document.documentElement.style.backgroundColor;
      const previousBodyBg = document.body.style.backgroundColor;

      // iOS standalone PWA берёт фон зоны со временем из подложки документа,
      // а не только из theme-color. Поэтому красим и HTML/BODY, пока активна
      // вкладка вакансий. Родительский Stack для tabs прозрачный (см. _layout).
      if (meta) meta.setAttribute('content', Colors.bgWarm);
      document.documentElement.style.backgroundColor = Colors.bgWarm;
      document.body.style.backgroundColor = Colors.bgWarm;

      return () => {
        if (meta) meta.setAttribute('content', previousTheme || '#F5F7FA');
        document.documentElement.style.backgroundColor = previousHtmlBg;
        document.body.style.backgroundColor = previousBodyBg;
      };
    }, [])
  );

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: Colors.bgWarm }} />;

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
const pS = StyleSheet.create({
  // — плашка подтверждения перехода к партнёрской вакансии —
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
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
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: rs(6),
    marginHorizontal: rs(16), marginBottom: rs(4),
  },
  activeStationChip: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    backgroundColor: Colors.primaryLight, borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(6),
    borderWidth: 1, borderColor: 'transparent',
  },
  activeStationTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },

  offlineBar: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    backgroundColor: '#FEF3C7', paddingHorizontal: rs(14), paddingVertical: rs(8),
  },
  offlineTxt: { flex: 1, fontSize: rf(12), color: '#92400E', lineHeight: rf(16) },
  // Кнопка, а не только «потяните вниз»: на пустом экране жест обновления
  // не виден, а тупик человеку хуже ошибки.
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(7),
    marginTop: rs(16), backgroundColor: Colors.primary,
    paddingHorizontal: rs(20), paddingVertical: rs(11), borderRadius: rs(14),
  },
  retryTxt: { color: '#fff', fontSize: rf(14), fontWeight: '800' },
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
  limitOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,17,17,0.35)', justifyContent: 'flex-end', zIndex: 50 },
  limitCard: {
    backgroundColor: Colors.bg, borderRadius: rs(24), marginHorizontal: rs(16),
    padding: rs(22), alignItems: 'center', gap: rs(8), ...Shadow.strong,
  },
  limitIcon: {
    width: rs(56), height: rs(56), borderRadius: rs(28),
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight,
  },
  limitTitle: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary, marginTop: rs(4) },
  limitBody: { fontSize: rf(14), color: Colors.textSecondary, textAlign: 'center', lineHeight: rf(20) },
  limitBtn: {
    alignSelf: 'stretch', marginTop: rs(8), backgroundColor: Colors.primary,
    borderRadius: rs(14), paddingVertical: rs(13), alignItems: 'center',
  },
  limitBtnTxt: { color: '#fff', fontSize: rf(15), fontWeight: '800' },
  limitClose: { paddingVertical: rs(8) },
  limitCloseTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textMuted },
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
  deckUtilityBtnSaved: { backgroundColor: Colors.primaryLight },

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
  safeWarm: { flex: 1, backgroundColor: Colors.bgWarm },
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
  cardArea: { flex: 1, flexDirection: 'column', paddingHorizontal: rs(13), paddingTop: rs(13), paddingBottom: 0 },
  ghost1: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: 0, backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.97 }, { translateY: 6 }], opacity: 0.5, zIndex: 0 },
  ghost2: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: 0, backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.94 }, { translateY: 12 }], opacity: 0.3, zIndex: 0 },
  // Скругление принадлежит viewport, а не прокручиваемому содержимому.
  // Поэтому верх и низ карточки остаются закруглёнными на любой позиции скролла.
  cardViewportShell: {
    flex: 1,
    borderRadius: rs(24),
    backgroundColor: Colors.bg,
    ...Shadow.card,
  },
  // One transform owner for the whole visual card. Interactive overlays stay
  // outside GestureDetector but inside this layer, so they never look pinned
  // to the screen while the vacancy is being swiped.
  deckSwipeLayer: { flex: 1 },
  cardViewportClip: {
    flex: 1,
    borderRadius: rs(24),
    overflow: 'hidden',
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: '#E3E5E9',
  },
  // flexGrow, а не flex: короткая вакансия всё так же занимает экран целиком,
  // а длинная вырастает выше него и листается внутри списка.
  cardAnimated: { flexGrow: 1, zIndex: 1 },
  // Тело занимает карточку целиком, чтобы фон и разделители шли до краёв.
  // Нажатия оно не ловит: кнопок здесь ровно две — закладка и «поделиться».
  cardBody: { flexGrow: 1 },
  postedAgo: { fontSize: rf(12), fontWeight: '500', color: Colors.textMuted, flexShrink: 0 },
  card: { flexGrow: 1, backgroundColor: Colors.bg },
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
  deckFloatingChat: { width: rs(54), height: rs(54), borderRadius: rs(27), backgroundColor: '#FFFFFF' },
  deckFloatingChatActive: { backgroundColor: Colors.primary },
  deckFloatingWant: { width: rs(68), height: rs(68), borderRadius: rs(34), backgroundColor: Colors.primary, borderColor: Colors.primary },
  // Плавающие кнопки сменной колоды + подсказка «Свайпай» — как в «Работе» и на
  // образце. Колонка: ряд кнопок сверху, подсказка снизу, прижата к низу карточки.
  shiftDeckActions: {
    position: 'absolute', left: rs(21), right: rs(21), bottom: 0, zIndex: 20, elevation: 20,
    alignItems: 'center', gap: rs(13),
  },
  shiftDeckRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(34),
  },
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
  emptyTitle: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { fontSize: rf(14), color: Colors.textMuted, marginTop: rs(4), textAlign: 'center', lineHeight: rf(20) },
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
