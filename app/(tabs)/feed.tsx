import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Dimensions, RefreshControl, Modal, FlatList,
  TextInput, ActivityIndicator, Share, Platform, Linking, Pressable,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { ReplyBadge } from '@/components/feature/ReplyBadge';
import Reanimated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { useSwipeDeck } from '@/hooks/useSwipeDeck';
import { ExternalVacancy, Like, User, Vacancy, PermVacancy } from '@/constants/types';
import {
  formatDate,
  getInitials,
  getTodayDates,
  nameColorFromString,
} from '@/services/storage';
import { normalizeCompany } from '@/services/company';
import { agoRu } from '@/services/time';
import { scoreVacancyForWorker } from '@/services/matching';
import { METRO_LINES } from '@/constants/metro';
import {
  dbUpsertLike,
  dbCheckAndCreateMatch,
  dbUpdateVacancy,
  dbCreateChat,
  dbInsertMessage,
  dbApplyPermVacancy,
  dbClosePermVacancy,
  dbDeleteVacancy,
  dbDeletePermVacancy,
  dbGetUserById,
  dbGetLikesByVacancy,
  dbRecordVacancyView,
  dbRecordPermVacancyView,
  dbGetVacancyViewers,
  dbGetPermVacancyViewers,
  dbAddPermSaved,
  dbRemovePermSaved,
  dbAddSaved,
  dbRemoveSaved,
  dbGetExternalVacancies,
  dbGetExternalVacancyPage,
  dbGetExternalSourceOptions,
  dbCountExternalVacancies,
  dbRecordExternalImpression,
  dbRecordExternalClick,
  dbRecordPartnerDataConsent,
  dbCreatePartnerApplication,
  dbStartSuperJobOAuth,
  dbGetSuperJobOAuthStatus,
  dbApplyViaSuperJob,
  dbRecordGuestEvent,
  dbStartGuestRegistration,
} from '@/services/db';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from '@/components/ui/Chip';
import { VacancyDetailModal } from '@/components/feature/VacancyDetailModal';
import { ExternalVacancyDetail } from '@/components/feature/ExternalVacancyDetail';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { TabHeader } from '@/components/ui/TabHeader';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';
import { MetroMap, MapListItem } from '@/components/feature/MetroMap';
import { WORK_TYPE_META } from '@/components/feature/WorkTypeSelector';
import { PermApplicationsSheet } from '@/components/feature/PermApplicationsSheet';
import { setOnboardingTarget, setOnboardingFlag, registerOnboardingMeasurer } from '@/lib/onboardingTargets';
import { registerWebPush, isWebPushRegistered, getWebPushDebug } from '@/lib/webPush';

import { rs, rf } from '@/constants/scale';
import { ApplySheet } from '@/components/feature/ApplySheet';
import { getChatSuggestions } from '@/constants/chatSuggestions';
import { payShort } from '@/services/pay';
import { vacancyInfoLines, permVacancyInfoLines } from '@/services/vacancyCard';
import { PartnerConsentSheet, PARTNER_CONSENT_VERSION } from '@/components/feature/PartnerConsentSheet';

// Закрывает OAuth popup на web после возврата с SuperJob. На native вызов
// безопасен и ничего не делает.
WebBrowser.maybeCompleteAuthSession();

function partnerAttributionUrl(raw: string, clickId: string, sourceId: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.set('jt_click_id', clickId);
    url.searchParams.set('utm_source', 'jobtoo');
    url.searchParams.set('utm_medium', 'aggregator');
    url.searchParams.set('utm_campaign', sourceId);
    return url.toString();
  } catch {
    // Сам импорт принимает только корректный HTTPS URL; fallback нужен для
    // старой карточки, которая могла сохраниться до появления этой проверки.
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}jt_click_id=${encodeURIComponent(clickId)}&utm_source=jobtoo&utm_medium=aggregator&utm_campaign=${encodeURIComponent(sourceId)}`;
  }
}

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
            <TouchableOpacity onPress={() => setLine(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={rf(20)} color={Colors.textPrimary} />
            </TouchableOpacity>
          ) : <View style={{ width: rs(22) }} />}
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

// ─────────────────────────────────────────────────
// Фильтр смен: город / удобно начать / закончить / метро
// ─────────────────────────────────────────────────
type TimeRange = { id: string; label: string; from: string; to: string };

const START_RANGES: TimeRange[] = [
  { id: 's1', label: '07:00–09:00', from: '07:00', to: '09:00' },
  { id: 's2', label: '09:00–12:00', from: '09:00', to: '12:00' },
  { id: 's3', label: '12:00–16:00', from: '12:00', to: '16:00' },
  { id: 's4', label: '16:00–21:00', from: '16:00', to: '21:00' },
  { id: 's5', label: '21:00–23:00', from: '21:00', to: '23:00' },
  { id: 's6', label: '23:00–07:00', from: '23:00', to: '07:00' },
];
const END_RANGES: TimeRange[] = [
  { id: 'e1', label: '09:00–14:00', from: '09:00', to: '14:00' },
  { id: 'e2', label: '14:00–17:00', from: '14:00', to: '17:00' },
  { id: 'e3', label: '17:00–20:00', from: '17:00', to: '20:00' },
  { id: 'e4', label: '20:00–22:00', from: '20:00', to: '22:00' },
  { id: 'e5', label: '22:00–00:00', from: '22:00', to: '24:00' },
  { id: 'e6', label: '00:00–05:00', from: '00:00', to: '05:00' },
  { id: 'e7', label: '05:00–09:00', from: '05:00', to: '09:00' },
];

type VacancySourceOption = { id: string; label: string };

const JOBTOO_SOURCE_FILTER_ID = 'jobtoo';
const partnerSourceFilterId = (sourceId: string) => `partner:${sourceId}`;
const sourceFilterMatches = (selected: string[], sourceId?: string) =>
  selected.length === 0 || selected.includes(sourceId ? partnerSourceFilterId(sourceId) : JOBTOO_SOURCE_FILTER_ID);

const selectedPartnerSourceIds = (selected: string[]): string[] | undefined =>
  selected.length === 0
    ? undefined
    : selected.filter(id => id.startsWith('partner:')).map(id => id.slice('partner:'.length));

const buildSourceOptions = (externalVacancies: ExternalVacancy[]): VacancySourceOption[] => {
  const partners = new Map<string, string>();
  externalVacancies.forEach(v => {
    partners.set(partnerSourceFilterId(v.sourceId), v.sourceName?.trim() || v.sourceId);
  });
  return [
    { id: JOBTOO_SOURCE_FILTER_ID, label: 'JobToo' },
    ...Array.from(partners, ([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
  ];
};

export type ShiftFilters = { stations: string[]; start: string[]; end: string[]; sources: string[] };
export const EMPTY_SHIFT_FILTERS: ShiftFilters = { stations: [], start: [], end: [], sources: [] };

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
// Время в диапазоне; если диапазон переходит через полночь (from > to) —
// подходит и «поздний вечер», и «раннее утро».
const inRange = (time: string, r: TimeRange) => {
  const t = toMin(time), f = toMin(r.from), to = toMin(r.to);
  return f <= to ? t >= f && t <= to : t >= f || t <= to;
};
// Смена проходит фильтр по времени, если её начало попадает в один из
// выбранных «начать»-диапазонов, а конец — в один из «закончить». Пустой
// набор диапазонов ничего не ограничивает.
function shiftMatchesTime(timeStart: string | undefined, timeEnd: string | undefined, f: ShiftFilters): boolean {
  const startRanges = START_RANGES.filter(r => f.start.includes(r.id));
  const endRanges = END_RANGES.filter(r => f.end.includes(r.id));
  if (startRanges.length) {
    if (!timeStart || !startRanges.some(r => inRange(timeStart, r))) return false;
  }
  if (endRanges.length) {
    if (!timeEnd || !endRanges.some(r => inRange(timeEnd, r))) return false;
  }
  return true;
}

function ShiftFilterSheet({
  initial, sourceOptions, count, onApply, onClose,
}: {
  initial: ShiftFilters;
  sourceOptions: VacancySourceOption[];
  count: (f: ShiftFilters) => number;
  onApply: (f: ShiftFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ShiftFilters>(initial);
  const [metroOpen, setMetroOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const toggle = (key: 'start' | 'end' | 'sources', id: string) => setDraft(d => ({
    ...d,
    [key]: d[key].includes(id) ? d[key].filter(x => x !== id) : [...d[key], id],
  }));

  const n = count(draft);

  return (
    <View style={styles.filterOverlay}>
      <View style={[styles.filterSheet, { maxHeight: '90%' }]}>
        <View style={styles.filterSheetHeader}>
          <Text style={styles.filterSheetTitle}>Фильтры</Text>
          <TouchableOpacity onPress={() => setDraft(EMPTY_SHIFT_FILTERS)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={fst.reset}>Сбросить</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.filterClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: rs(12) }}>
          <Text style={fst.label}>Источник вакансии</Text>
          <View style={fst.chipsWrap}>
            <TouchableOpacity
              style={[fst.chip, draft.sources.length === 0 && fst.chipOn]}
              onPress={() => setDraft(d => ({ ...d, sources: [] }))}
              activeOpacity={0.8}
            >
              <Text style={[fst.chipTxt, draft.sources.length === 0 && fst.chipTxtOn]}>Все источники</Text>
            </TouchableOpacity>
            {sourceOptions.map(source => {
              const on = draft.sources.includes(source.id);
              return (
                <TouchableOpacity key={source.id} style={[fst.chip, on && fst.chipOn]} onPress={() => toggle('sources', source.id)} activeOpacity={0.8}>
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{source.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Город</Text>
          <View style={[fst.rowSel, { opacity: 0.6 }]}>
            <Text style={fst.rowSelName}>Москва</Text>
            <Text style={fst.rowSelHint}>единственный город</Text>
          </View>

          <Text style={fst.label}>Удобно начать</Text>
          <View style={fst.chipsWrap}>
            {START_RANGES.map(r => {
              const on = draft.start.includes(r.id);
              return (
                <TouchableOpacity key={r.id} style={[fst.chip, on && fst.chipOn]} onPress={() => toggle('start', r.id)} activeOpacity={0.8}>
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Удобно закончить</Text>
          <View style={fst.chipsWrap}>
            {END_RANGES.map(r => {
              const on = draft.end.includes(r.id);
              return (
                <TouchableOpacity key={r.id} style={[fst.chip, on && fst.chipOn]} onPress={() => toggle('end', r.id)} activeOpacity={0.8}>
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={fst.label}>Метро</Text>
          <TouchableOpacity style={fst.rowSel} onPress={() => setMetroOpen(true)} activeOpacity={0.8}>
            <Text style={fst.rowSelName} numberOfLines={1}>
              {draft.stations.length === 0 ? 'Все станции'
                : draft.stations.length <= 2 ? draft.stations.map(s => `м. ${s}`).join(', ')
                : `Выбрано станций: ${draft.stations.length}`}
            </Text>
            <Text style={fst.rowSelHint}>{draft.stations.length ? 'изменить ›' : 'выбрать ›'}</Text>
          </TouchableOpacity>
        </ScrollView>

        <TouchableOpacity style={[fst.cta, { marginBottom: insets.bottom + rs(80) }]} activeOpacity={0.85} onPress={() => { onApply(draft); onClose(); }}>
          <Text style={fst.ctaTxt}>{n > 0 ? `Показать ${n}` : 'Показать смены'}</Text>
        </TouchableOpacity>
      </View>

      <MetroPicker
        visible={metroOpen}
        selected={draft.stations}
        onChange={stations => setDraft(d => ({ ...d, stations }))}
        onClose={() => setMetroOpen(false)}
      />
    </View>
  );
}

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
  sources: string[];
};
export const EMPTY_PERM_FILTERS: PermFilters = { query: '', searchIn: [], posted: 'all', stations: [], salaryFrom: '', schedules: [], sources: [] };

const countExternalPerm = (f: PermFilters) => dbCountExternalVacancies({
  query: f.query,
  searchIn: f.searchIn,
  posted: f.posted,
  stations: f.stations,
  salaryFrom: f.salaryFrom,
  schedules: f.schedules,
  sourceIds: selectedPartnerSourceIds(f.sources),
});

const postedWithin = (iso: string | undefined, p: PermFilters['posted']) => {
  if (p === 'all' || !iso) return true;
  const days = p === 'week' ? 7 : 3;
  return Date.now() - new Date(iso).getTime() <= days * 86400000;
};

function PermFilterSheet({
  initial, sourceOptions, countLocal, countExternal, onApply, onClose,
}: {
  initial: PermFilters;
  sourceOptions: VacancySourceOption[];
  countLocal: (f: PermFilters) => number;
  countExternal: (f: PermFilters) => Promise<number>;
  onApply: (f: PermFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PermFilters>(initial);
  const [metroOpen, setMetroOpen] = useState(false);
  const [remoteCount, setRemoteCount] = useState<{ key: string; total: number | null } | null>(null);
  const insets = useSafeAreaInsets();

  const toggleSearchIn = (id: 'title' | 'desc') => setDraft(d => ({
    ...d, searchIn: d.searchIn.includes(id) ? d.searchIn.filter(x => x !== id) : [...d.searchIn, id],
  }));

  const countKey = JSON.stringify(draft);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      countExternal(draft)
        .then(total => { if (alive) setRemoteCount({ key: countKey, total }); })
        .catch(() => { if (alive) setRemoteCount({ key: countKey, total: null }); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [countKey, countExternal, draft]);

  const counting = remoteCount?.key !== countKey;
  const externalCount = remoteCount?.key === countKey ? remoteCount.total : null;
  const countAvailable = externalCount !== null;
  const n = countLocal(draft) + (externalCount ?? 0);

  return (
    <View style={styles.filterOverlay}>
      <View style={[styles.filterSheet, { maxHeight: '92%' }]}>
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
          <Text style={fst.label}>Источник вакансии</Text>
          <View style={fst.chipsWrap}>
            <TouchableOpacity
              style={[fst.chip, draft.sources.length === 0 && fst.chipOn]}
              onPress={() => setDraft(d => ({ ...d, sources: [] }))}
              activeOpacity={0.8}
            >
              <Text style={[fst.chipTxt, draft.sources.length === 0 && fst.chipTxtOn]}>Все источники</Text>
            </TouchableOpacity>
            {sourceOptions.map(source => {
              const on = draft.sources.includes(source.id);
              return (
                <TouchableOpacity
                  key={source.id}
                  style={[fst.chip, on && fst.chipOn]}
                  onPress={() => setDraft(d => ({
                    ...d,
                    sources: on ? d.sources.filter(id => id !== source.id) : [...d.sources, source.id],
                  }))}
                  activeOpacity={0.8}
                >
                  <Text style={[fst.chipTxt, on && fst.chipTxtOn]}>{source.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

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

        <TouchableOpacity style={[fst.cta, { marginBottom: insets.bottom + rs(80) }]} activeOpacity={0.85} onPress={() => { onApply(draft); onClose(); }}>
          <Text style={fst.ctaTxt}>
            {counting ? 'Считаем вакансии…' : (countAvailable && n > 0 ? `Показать ${n}` : 'Показать вакансии')}
          </Text>
        </TouchableOpacity>
      </View>

      <MetroPicker
        visible={metroOpen}
        selected={draft.stations}
        onChange={stations => setDraft(d => ({ ...d, stations }))}
        onClose={() => setMetroOpen(false)}
      />
    </View>
  );
}

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
// Mode switcher
// ─────────────────────────────────────────────────
type AppMode = 'shift' | 'perm';

// Отдельного «Поиска» больше нет: внешняя постоянная работа показывается
// вместе со своей во вкладке «Работа», а смены остаются в свайп-ленте.
const MODE_LABELS: Record<AppMode, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  shift:  { label: 'Смены',  icon: 'flash' },
  perm:   { label: 'Работа', icon: 'briefcase' },
};

function ModeSwitcher({ mode, onChange, modes = ['shift', 'perm'] }: {
  mode: AppMode;
  onChange: (m: AppMode) => void;
  modes?: AppMode[];
}) {
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setOnboardingTarget('switcher', { x, y, w, h });
    });
  }, []);
  useEffect(() => registerOnboardingMeasurer('switcher', measure), [measure]);
  return (
    <View ref={ref} onLayout={measure} style={ms.container}>
      {modes.map(m => {
        const { label, icon } = MODE_LABELS[m];
        const active = mode === m;
        return (
          <TouchableOpacity
            key={m}
            style={[ms.btn, active && ms.btnActive]}
            onPress={() => onChange(m)}
            activeOpacity={0.8}
          >
            <Ionicons name={icon} size={14} color={active ? '#fff' : Colors.textMuted} style={ms.btnIcon} />
            <Text style={[ms.btnTxt, active && ms.btnTxtActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const ms = StyleSheet.create({
  container: {
    flexDirection: 'row', gap: rs(3),
    backgroundColor: Colors.surface,
    borderRadius: rs(100), padding: rs(3),
    borderWidth: 1, borderColor: Colors.divider,
  },
  // Значок вынесен из потока: пока он стоял слева от текста, центрировалась
  // вся пара целиком, и надпись уезжала вправо на половину его ширины с
  // отступом — на 9 пикселей. Теперь по центру стоит именно текст.
  btn: { flex: 1, borderRadius: rs(100), paddingVertical: rs(8), alignItems: 'center', justifyContent: 'center' },
  btnIcon: { position: 'absolute', left: rs(12) },
  btnActive: { backgroundColor: Colors.primary },
  btnTxt: { fontSize: rf(12), fontWeight: '600', color: Colors.textMuted },
  btnTxtActive: { color: '#FFFFFF', fontWeight: '700' },
});

// ─────────────────────────────────────────────────
// Разовая / Регулярная — панель над лентой смен
// ─────────────────────────────────────────────────
function ShiftSubTabs({ value, onChange }: {
  value: 'once' | 'regular';
  onChange: (v: 'once' | 'regular') => void;
}) {
  return (
    <View style={sst.container}>
      <TouchableOpacity
        style={[sst.btn, value === 'once' && sst.btnActive]}
        onPress={() => onChange('once')}
        activeOpacity={0.85}
      >
        <Ionicons name="flash" size={14} color={value === 'once' ? Colors.textPrimary : Colors.textMuted} />
        <Text style={[sst.txt, value === 'once' && sst.txtActive]}>Разовая</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[sst.btn, value === 'regular' && sst.btnActive]}
        onPress={() => onChange('regular')}
        activeOpacity={0.85}
      >
        <Ionicons name="repeat-outline" size={13} color={value === 'regular' ? Colors.textPrimary : Colors.textMuted} />
        <Text style={[sst.txt, value === 'regular' && sst.txtActive]}>Регулярная</Text>
      </TouchableOpacity>
    </View>
  );
}

// «Регулярная» — не разовая смена на конкретную дату, а повторяющаяся
// сменная/гибкая подработка из внешнего источника: такие предложения приходят
// как обычные вакансии с графиком «Сменная работа», поэтому не превращаем их в
// фиктивные смены JobToo и не придумываем дату/время.
function isRegularExternalVacancy(v: ExternalVacancy): boolean {
  if (v.kind !== 'permanent') return false;
  const source = `${v.sourceName ?? ''} ${v.sourceId}`.toLowerCase();
  // Arbihunter остаётся только в разделе «Работа»: его постоянные вакансии
  // не дублируем в регулярной подработке даже при гибком/сменном графике.
  if (/arbihunter|арби.?хантер/.test(source)) return false;
  const text = `${v.title} ${v.schedule ?? ''} ${v.description ?? ''}`.toLowerCase();
  const looksRegular = /сменн|подработ|частичн|неполн|гибк|вахт|совместитель/.test(text);
  return looksRegular && source.length > 0;
}

function RegularLocked() {
  const { currentUser, showToast } = useApp();
  const [items, setItems] = useState<ExternalVacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setLoadFailed(false);
    try {
      const rows = await dbGetExternalVacancies();
      setItems(rows.filter(isRegularExternalVacancy));
    } catch {
      setLoadFailed(true);
      showToast('Не удалось обновить регулярные подработки', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const openSource = useCallback((v: ExternalVacancy) => {
    if (currentUser && !currentUser.isGuest) {
      dbRecordExternalClick(v.id, v.sourceId, currentUser.id).catch(() => {});
    }
    Linking.openURL(v.url).catch(() => showToast('Не удалось открыть источник', 'error'));
  }, [currentUser, showToast]);

  if (loading) {
    return <View style={rl.wrap}><ActivityIndicator color={Colors.primary} /></View>;
  }

  if (items.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[rl.wrap, { flexGrow: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.primary} colors={[Colors.primary]} />}
      >
        <View style={rl.ring}>
          <Ionicons name={loadFailed ? 'cloud-offline-outline' : 'repeat-outline'} size={30} color={Colors.primary} />
        </View>
        {loadFailed ? (
          <>
            <Text style={rl.title}>Не удалось загрузить регулярные подработки</Text>
            <Text style={rl.desc}>Проверьте связь и попробуйте ещё раз.</Text>
            <TouchableOpacity onPress={() => void load()} activeOpacity={0.8} style={{ marginTop: rs(12) }}>
              <Text style={{ color: Colors.primary, fontWeight: '700' }}>Повторить</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={rl.title}>Регулярных подработок пока нет</Text>
            <Text style={rl.desc}>Потяните вниз, чтобы обновить предложения партнёров.</Text>
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={v => v.id}
      contentContainerStyle={rl.list}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.primary} colors={[Colors.primary]} />}
      renderItem={({ item: v }) => {
        const salary = typeof v.salary === 'number' && v.salary > 0
          ? `${v.salary.toLocaleString('ru-RU')} ₽${v.payPeriod === 'hour' ? '/ч' : v.payPeriod === 'shift' ? '/смена' : '/мес'}`
          : null;
        const sourceName = v.sourceName ?? 'Партнёр';
        return (
          <TouchableOpacity style={rl.card} onPress={() => openSource(v)} activeOpacity={0.9}>
            <View style={styles.cardTop}>
              <View style={styles.companyRow}>
                <CompanyMark company={v.company ?? sourceName} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.companyName} numberOfLines={1}>{v.company ?? sourceName}</Text>
                  <View style={styles.metroHintRow}>
                    <Ionicons name="open-outline" size={12} color={Colors.textMuted} />
                    <Text style={styles.metroHint} numberOfLines={1}>{v.metroStation ?? sourceName}</Text>
                  </View>
                </View>
                <SourceBadge partnerName={sourceName} />
              </View>

              <Text style={styles.jobTitle} numberOfLines={2}>{v.title}</Text>

              <View style={styles.chipsRow}>
                {salary ? <Chip label={salary} variant="salary" icon="wallet-outline" /> : null}
                <Chip label="Регулярная" variant="exp" icon="repeat-outline" />
                {v.schedule ? <Chip label={v.schedule} variant="time" icon="calendar-outline" /> : null}
              </View>

              {(v.metroStation || v.address) ? (
                <View style={styles.addressChip}>
                  <Ionicons name="location-outline" size={17} color={Colors.textMuted} />
                  <Text style={styles.addressChipText} numberOfLines={2}>
                    {[v.metroStation, v.address].filter(Boolean).join(' · ')}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </View>
              ) : null}
            </View>

            {v.description ? (
              <>
                <View style={styles.cardDivider} />
                <View style={styles.cardMiddle}>
                  <Text style={pS.sectionHead}>Описание</Text>
                  <Text style={pS.desc} numberOfLines={5}>{v.description}</Text>
                </View>
              </>
            ) : null}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const sst = StyleSheet.create({
  container: {
    flexDirection: 'row', gap: rs(4),
    backgroundColor: Colors.surface,
    borderRadius: rs(100), padding: rs(4),
    borderWidth: 1, borderColor: Colors.divider,
    marginHorizontal: rs(16), marginTop: rs(8), marginBottom: rs(2),
  },
  btn: {
    flex: 1, borderRadius: rs(100), paddingVertical: rs(9),
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(6),
  },
  btnActive: {
    backgroundColor: Colors.card,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
  },
  txt: { fontSize: rf(13), fontWeight: '700', color: Colors.textMuted },
  txtActive: { color: Colors.textPrimary },
  txtLocked: { color: Colors.textMuted },
});

const rl = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(40), gap: rs(12) },
  list: { padding: rs(16), paddingBottom: rs(120), gap: rs(12) },
  ring: {
    width: rs(74), height: rs(74), borderRadius: rs(37),
    backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.primaryBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  desc: { fontSize: rf(13.5), color: Colors.textSecondary, textAlign: 'center', lineHeight: rf(20) },
  card: { backgroundColor: Colors.bg, borderRadius: rs(24), borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden', ...Shadow.card },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: rs(11) },
  company: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  source: { fontSize: rf(11.5), color: Colors.textMuted, marginTop: rs(2) },
  jobTitle: { fontSize: rf(18), lineHeight: rf(23), fontWeight: '800', color: Colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(7) },
  address: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(6), backgroundColor: Colors.surface, borderRadius: rs(12), padding: rs(10) },
  addressTxt: { flex: 1, fontSize: rf(12.5), color: Colors.textSecondary, lineHeight: rf(17) },
  description: { fontSize: rf(13), color: Colors.textSecondary, lineHeight: rf(19) },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: rs(11) },
  footerTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },
});

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

// ─────────────────────────────────────────────────
// Worker List Modal (for employer vacancy stats)
// ─────────────────────────────────────────────────
function WorkerListModal({
  vacancyId,
  type,
  onClose,
}: {
  vacancyId: string;
  type: 'applicants' | 'hired' | 'rejected';
  onClose: () => void;
}) {
  const router = useRouter();
  const { currentUser, users, vacancies, chats, showToast, refreshLikes, refreshChats, optimisticUpdateLike } = useApp();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataLoadFailed, setDataLoadFailed] = useState(false);
  const [dataRetry, setDataRetry] = useState(0);
  const listSwipe = useSwipeToDismiss(onClose);
  const [localLikes, setLocalLikes] = useState<Like[]>([]);
  const [localWorkers, setLocalWorkers] = useState<User[]>([]);

  const vacancy = vacancies.find(v => v.id === vacancyId);

  // Fetch likes for this vacancy + all referenced workers in parallel
  useEffect(() => {
    const init = async () => {
      setDataLoading(true);
      setDataLoadFailed(false);
      try {
        const vacLikes = await dbGetLikesByVacancy(vacancyId);
        setLocalLikes(vacLikes);

        const workerIds = [...new Set(vacLikes.map(l => l.workerId))];
        if (workerIds.length > 0) {
          // Как и у просмотревших: сначала из памяти, запросы только за теми,
          // кого там нет.
          const known = new Map<string, User>(users.map((u: User) => [u.id, u]));
          const missing = workerIds.filter((id: string) => !known.has(id));
          const fetched = missing.length
            ? (await Promise.all(missing.map(id => dbGetUserById(id)))).filter(Boolean) as User[]
            : [];
          fetched.forEach((u: User) => known.set(u.id, u));
          setLocalWorkers(workerIds.map((id: string) => known.get(id)).filter(Boolean) as User[]);
        }
      } catch (e) {
        console.warn('[WorkerListModal] init error', e);
        setDataLoadFailed(true);
      } finally {
        setDataLoading(false);
      }
    };
    init();
  }, [vacancyId, dataRetry]);

  const titleMap: Record<typeof type, { title: string; icon: IconName; color: string; bg: string; empty: IconName; emptyTxt: string }> = {
    applicants: { title: 'Отклики',     icon: 'people-outline',           color: Colors.primary, bg: Colors.primaryLight, empty: 'people-outline',      emptyTxt: 'Нет новых откликов' },
    hired:      { title: 'Набрано',     icon: 'checkmark-circle-outline', color: Colors.green,   bg: Colors.greenLight,   empty: 'person-add-outline',  emptyTxt: 'Никого не набрано' },
    rejected:   { title: 'Отклонённые', icon: 'close-circle-outline',     color: Colors.red,     bg: Colors.redLight,     empty: 'close-circle-outline', emptyTxt: 'Нет отклонённых' },
  };
  const head = titleMap[type];

  // Use fresh localLikes (from DB) for display — not stale context likes
  let filteredLikes: Like[] = [];
  if (type === 'applicants') {
    filteredLikes = localLikes.filter(l => l.workerLiked && !l.isMatch && l.employerLiked !== false);
  } else if (type === 'hired') {
    filteredLikes = localLikes.filter(l => l.isMatch);
  } else {
    filteredLikes = localLikes.filter(
      l => l.employerLiked === false || (l.workerLiked === false && l.workerSkipped === true)
    );
  }

  // Look up from locally fetched workers first, then context users as fallback
  const getWorker = (id: string) =>
    localWorkers.find(u => u.id === id) ?? users.find(u => u.id === id);

  // Чат один на пару людей, поэтому ищем по собеседнику, а не по вакансии
  const getChatId = (workerId: string) =>
    chats.find(c => c.employerId === currentUser?.id && c.workerId === workerId)?.id ?? null;

  // Open or create a chat with a worker (no match decision required)
  const openOrCreateChat = async (like: Like) => {
    if (!currentUser) return;
    const vacTitle = vacancy?.title ?? 'Смена';
    const companyName = vacancy?.company ?? currentUser.company ?? '';
    setActionLoading(like.workerId);
    try {
      const existingChatId = getChatId(like.workerId);
      if (existingChatId) {
        onClose();
        router.push({ pathname: '/chat-room', params: { chatId: existingChatId } });
        return;
      }
      const worker = getWorker(like.workerId);
      const greeting = worker
        ? `Здравствуйте, ${worker.firstName}! Я рассматриваю вашу кандидатуру на «${vacTitle}».`
        : `Здравствуйте! Я рассматриваю вашу кандидатуру на вакансию.`;
      const chatId = await dbCreateChat(
        like.workerId,
        currentUser.id,
        vacancyId,
        vacTitle,
        companyName,
        greeting,
        1,
        0,
      );
      refreshChats().catch(() => {});
      onClose();
      router.push({ pathname: '/chat-room', params: { chatId } });
    } catch {
      showToast('Ошибка при открытии чата', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const onAccept = async (like: Like) => {
    if (!currentUser) return;
    setActionLoading(like.workerId);
    try {
      await dbUpsertLike(vacancyId, like.workerId, currentUser.id, { employerLiked: true });
      const result = await dbCheckAndCreateMatch(vacancyId, like.workerId);
      if (result.matched) {
        optimisticUpdateLike({ ...like, isMatch: true, employerLiked: true });
      }
      refreshLikes().catch(() => {});
      // О мэтче извещает СЕРВЕР при его создании (jt_notify_match): текст
      // собирает тот, кто записал событие, и только другой стороне.
      // Заодно ушла неправда: здесь уведомление слалось ВСЕГДА, даже когда
      // мэтча не случилось, — работнику сообщали о мэтче, которого нет.
      showToast('Мэтч! Чат открыт', 'success');
      onClose();
      if (result.chatId) {
        router.push({ pathname: '/chat-room', params: { chatId: result.chatId } });
      } else {
        router.push({ pathname: '/(tabs)/chats' });
      }
    } catch {
      showToast('Ошибка', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const openChat = async (like: Like) => {
    if (!currentUser) return;
    const chatId = getChatId(like.workerId);
    if (chatId) {
      onClose();
      router.push({ pathname: '/chat-room', params: { chatId } });
      return;
    }
    setActionLoading(like.workerId);
    try {
      const vacTitle = vacancy?.title ?? 'Смена';
      const companyName = vacancy?.company ?? currentUser.company ?? '';
      const newChatId = await dbCreateChat(
        like.workerId,
        currentUser.id,
        vacancyId,
        vacTitle,
        companyName,
        undefined,
        0,
        0,
      );
      refreshChats().catch(() => {});
      onClose();
      router.push({ pathname: '/chat-room', params: { chatId: newChatId } });
    } catch {
      showToast('Ошибка при открытии чата', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const onDiscussRejected = async (like: Like) => {
    if (!currentUser) return;
    setActionLoading(like.workerId);
    try {
      const worker = getWorker(like.workerId);
      const vacTitle = vacancy?.title ?? 'Смена';
      const companyName = vacancy?.company ?? currentUser.company ?? '';

      const existingChatId = getChatId(like.workerId);
      if (existingChatId) {
        onClose();
        router.push({ pathname: '/chat-room', params: { chatId: existingChatId } });
        return;
      }

      const chatId = await dbCreateChat(
        like.workerId,
        currentUser.id,
        vacancyId,
        vacTitle,
        companyName,
        '',
        0,
        0,
      );

      const rejectedByWorker = like.workerLiked === false && like.workerSkipped === true;
      const text = rejectedByWorker
        ? (worker
          ? `Здравствуйте, ${worker.firstName}! Вы отказались от вакансии «${vacTitle}». Хотелось бы узнать причину — может, сможем найти решение?`
          : `Здравствуйте! Вы отказались от вакансии «${vacTitle}». Хотелось бы узнать причину — может, сможем найти решение?`)
        : (worker
          ? `Здравствуйте, ${worker.firstName}! Хотелось бы обсудить вашу заявку на вакансию «${vacTitle}».`
          : `Здравствуйте! Хотелось бы обсудить вашу заявку на вакансию «${vacTitle}».`);
      await dbInsertMessage(chatId, currentUser.id, text);
      refreshChats().catch(() => {});

      showToast('Сообщение отправлено. Открываем чат...', 'success');
      onClose();
      router.push({ pathname: '/chat-room', params: { chatId } });
    } catch (error) {
      console.error('[WorkerListModal] onDiscussRejected', error);
      showToast('Ошибка при отправке сообщения', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={wS.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[wS.sheet, listSwipe.animStyle]}>
          <View {...listSwipe.panHandlers}>
            <SheetHandle />
            <View style={wS.sheetHeader}>
              <SheetTitleIcon name={head.icon} color={head.color} bg={head.bg} />
              <Text style={wS.sheetTitle}>{head.title}</Text>
            </View>
          </View>
          {vacancy ? (
            <View style={wS.vacSubtitleRow}>
              <MetaBit name="briefcase-outline" text={vacancy.title} />
              <MetaBit name="calendar-outline" text={formatDate(vacancy.date)} />
            </View>
          ) : null}

          {dataLoading ? (
            <View style={wS.empty}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={[wS.emptyTxt, { marginTop: 12 }]}>Загрузка данных...</Text>
            </View>
          ) : dataLoadFailed ? (
            <View style={wS.empty}>
              <EmptyIcon name="cloud-offline-outline" />
              <Text style={wS.emptyTxt}>Не удалось загрузить список</Text>
              <TouchableOpacity onPress={() => setDataRetry(x => x + 1)} activeOpacity={0.8} style={{ marginTop: rs(12) }}>
                <Text style={{ color: Colors.primary, fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : filteredLikes.length === 0 ? (
            <View style={wS.empty}>
              <EmptyIcon name={head.empty} />
              <Text style={wS.emptyTxt}>{head.emptyTxt}</Text>
            </View>
          ) : (
            <FlatList
              data={filteredLikes}
              keyExtractor={l => l.id}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
              renderItem={({ item: like }) => {
                const worker = getWorker(like.workerId);
                const workerColor = nameColorFromString(like.workerId);
                const workerDisplayName = worker
                  ? `${worker.firstName} ${worker.lastName}`.trim() || 'Работник'
                  : 'Работник';
                const initials = worker ? getInitials(workerDisplayName) : '?';
                const isLoading = actionLoading === like.workerId;
                const rejectedByWorker = like.workerLiked === false && like.workerSkipped === true;
                return (
                  <View style={wS.card}>
                    <TouchableOpacity
                      style={wS.cardTop}
                      onPress={() => {
                        if (!worker) return;
                        router.push({ pathname: '/user-profile', params: { userId: worker.id } });
                      }}
                      activeOpacity={0.8}
                    >
                      {worker?.avatarUrl ? (
                        <Image source={{ uri: worker.avatarUrl }} style={wS.avatar} contentFit="cover" transition={150} />
                      ) : (
                        <View style={[wS.avatar, { backgroundColor: workerColor, alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={wS.avatarTxt}>{initials}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={wS.name}>{workerDisplayName}</Text>
                        {worker ? (
                          <View style={wS.metaRow}>
                            {like.isMatch
                              ? <MetaBit name="call-outline" text={worker.phone} />
                              : <MetaBit name="subway-outline" text={worker.metroStation ?? '—'} />}
                            {(worker.avgRating ?? 0) > 0
                              ? <MetaBit name="star" text={(worker.avgRating ?? 0).toFixed(1)} color={Colors.amber} />
                              : null}
                          </View>
                        ) : (
                          <Text style={wS.meta}>Загрузка...</Text>
                        )}
                        {type === 'rejected' ? (
                          <View style={wS.reasonRow}>
                            <Ionicons name="arrow-undo-outline" size={rf(11)} color={Colors.red} />
                            <Text style={wS.rejectionReason}>
                              {rejectedByWorker ? 'Сам отказался' : 'Вы отклонили'}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {worker ? (
                        <View style={wS.profileLink}>
                          <Text style={wS.profileArrow}>Профиль</Text>
                          <Ionicons name="chevron-forward" size={rf(13)} color={Colors.primary} />
                        </View>
                      ) : null}
                    </TouchableOpacity>

                    <View style={wS.btnRow}>
                      {type === 'hired' ? (
                        <TouchableOpacity
                          style={[wS.chatBtn, isLoading && { opacity: 0.5 }]}
                          disabled={isLoading}
                          onPress={() => openChat(like)}
                        >
                          <Text style={wS.chatBtnTxt}>Написать</Text>
                        </TouchableOpacity>
                      ) : type === 'rejected' ? (
                        <TouchableOpacity
                          style={[wS.chatBtn, { flex: 1 }, isLoading && { opacity: 0.5 }]}
                          disabled={isLoading}
                          onPress={() => onDiscussRejected(like)}
                        >
                          <Text style={wS.chatBtnTxt}>Написать</Text>
                        </TouchableOpacity>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={[wS.chatBtn, isLoading && { opacity: 0.5 }]}
                            disabled={isLoading}
                            onPress={() => openOrCreateChat(like)}
                          >
                            <Text style={wS.chatBtnTxt}>Написать</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[wS.acceptBtn, isLoading && { opacity: 0.5 }]}
                            disabled={isLoading}
                            onPress={() => onAccept(like)}
                          >
                            <Ionicons name="checkmark" size={rf(14)} color="#fff" />
                            <Text style={wS.acceptBtnTxt}>Подходит</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
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

const eS = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(7),
    marginTop: rs(16), backgroundColor: Colors.primary,
    paddingHorizontal: rs(20), paddingVertical: rs(11), borderRadius: rs(14),
  },
  btnTxt: { color: '#fff', fontSize: rf(14), fontWeight: '800' },
});

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
// Worker swipe feed (Подработка)
// ─────────────────────────────────────────────────
type PartnerShiftCard = Vacancy & { external: ExternalVacancy };

function partnerShiftToCard(v: ExternalVacancy): PartnerShiftCard | null {
  if (v.kind !== 'shift' || !v.date || !v.url) return null;
  return {
    id: `external:${v.id}`,
    employerId: `external:${v.sourceId}`,
    company: v.company ?? v.sourceName ?? 'Компания',
    title: v.title,
    workType: v.workType ?? 'stocker',
    workTypeLabel: v.workType ?? 'Смена',
    metroLineId: v.metroLineId ?? '',
    metroStation: v.metroStation ?? v.metroStationRaw ?? '',
    date: v.date,
    timeStart: v.timeStart ?? '—',
    timeEnd: v.timeEnd ?? '—',
    salary: v.salary ?? 0,
    normsAndPay: v.description ?? 'Условия и отклик — на сайте источника',
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    workersNeeded: 0,
    workersFound: 0,
    isUrgent: false,
    noExperienceNeeded: false,
    conditions: v.description ?? '',
    status: 'open',
    createdAt: v.lastSeenAt ?? new Date().toISOString(),
    external: v,
  };
}

function WorkerFeed() {
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();
  const deepLinkParams = useLocalSearchParams<{ vacancyId?: string; campaignId?: string }>();
  const deepLinkVacancyId = typeof deepLinkParams.vacancyId === 'string' ? deepLinkParams.vacancyId : '';
  const campaignId = typeof deepLinkParams.campaignId === 'string' ? deepLinkParams.campaignId : '';
  const deepLinkOpened = useRef(false);
  const {
    currentUser, users, vacancies, likes, chats,
    refreshAll, refreshLikes, refreshChats,
    showToast, vacanciesLoading, exitGuest,
    savedIds, optimisticAddSaved, optimisticRemoveSaved,
    responsivenessMap, backendOffline,
  } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [partnerShifts, setPartnerShifts] = useState<PartnerShiftCard[]>([]);
  const [partnerShiftsLoadFailed, setPartnerShiftsLoadFailed] = useState(false);

  const loadPartnerShifts = useCallback(async (): Promise<boolean> => {
    try {
      const rows = await dbGetExternalVacancies();
      setPartnerShifts(rows.map(partnerShiftToCard).filter((v): v is PartnerShiftCard => !!v));
      setPartnerShiftsLoadFailed(false);
      return true;
    } catch {
      // Не очищаем уже загруженные партнёрские смены: временный сбой фида не
      // должен выглядеть как будто у партнёров внезапно закончились вакансии.
      setPartnerShiftsLoadFailed(true);
      return false;
    }
  }, []);

  useEffect(() => { void loadPartnerShifts(); }, [loadPartnerShifts]);

  // Гость смотрит ленту, но откликнуться/написать не может — любое такое
  // действие ведёт на выбор роли и регистрацию.
  const isGuest = !!currentUser?.isGuest;
  // Разовая / Регулярная. Разовая — обычные смены директоров и партнёров
  // (как сейчас). Регулярная — постоянные смены у одного работодателя,
  // раздел ещё готовится: показываем замок вместо ленты.
  const [subMode, setSubMode] = useState<'once' | 'regular'>('once');
  const promptRegister = useCallback((context: {
    vacancyId?: string | null;
    vacancyKind?: 'shift' | 'permanent' | 'external' | null;
    sourceId?: string | null;
    campaignId?: string | null;
  } = {}) => {
    void dbStartGuestRegistration(context);
    exitGuest();
    router.replace('/');
  }, [exitGuest, router]);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [, partnerOk] = await Promise.all([refreshAll(), loadPartnerShifts()]);
      if (!partnerOk) {
        showToast('Свои смены обновлены, но партнёрские не удалось обновить.', 'error');
      }
    } catch {
      showToast('Не удалось обновить ленту. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const [dates, setDates] = useState(() => getTodayDates());
  const [selectedDate, setSelectedDate] = useState(() => getTodayDates()[0]);
  const [cards, setCards] = useState<Vacancy[]>([]);
  const [history, setHistory] = useState<Record<string, Vacancy[]>>({});
  const [swiping, setSwiping] = useState(false);
  const [detailVacancy, setDetailVacancy] = useState<Vacancy | null>(null);
  const [detailEmployer, setDetailEmployer] = useState<User | null>(null);
  const [filterStations, setFilterStations] = useState<string[]>([]);
  const [filterPicker, setFilterPicker] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // Фильтр по времени смены (начать/закончить). Метро (мультивыбор) храним
  // отдельно в filterStations.
  const [timeFilters, setTimeFilters] = useState<{ start: string[]; end: string[] }>({ start: [], end: [] });
  const [filterSources, setFilterSources] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const shiftSourceOptions = buildSourceOptions(partnerShifts.map(v => v.external));
  const filtersActive = filterStations.length > 0 || timeFilters.start.length > 0 || timeFilters.end.length > 0 || filterSources.length > 0;

  // Смены для карты: метки ставятся по адресу, поэтому кроме станции
  // передаём адрес и координаты — по ним карта и группирует точки.
  const mapItems: MapListItem[] = useMemo(() => {
    if (!currentUser) return [];
    return ([...vacancies, ...partnerShifts] as Vacancy[])
      .filter((v: Vacancy) =>
        v.status === 'open' &&
        v.date === selectedDate &&
        sourceFilterMatches(filterSources, 'external' in v ? (v as PartnerShiftCard).external.sourceId : undefined) &&
        (!!v.metroStation || !!v.address) &&
        (('external' in v && !(v as PartnerShiftCard).external.workType)
          || currentUser.workTypes?.includes(v.workType)))
      .map((v: Vacancy) => ({
        id: v.id,
        station: v.metroStation,
        title: v.title,
        company: v.company,
        pay: payShort(v.salary, v.workType),
        meta: `${v.timeStart}–${v.timeEnd}`,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
      }));
  }, [vacancies, partnerShifts, selectedDate, currentUser, filterSources]);

  // Решения по карточке объявлены ниже (им нужны данные и роутер), а жест
  // собирается один раз и должен звать свежие. Поэтому через ссылку.
  const swipeCbRef = useRef<((dir: 'want' | 'skip', vx: number) => void) | null>(null);
  const deck = useSwipeDeck({
    want: vx => swipeCbRef.current?.('want', vx),
    skip: vx => swipeCbRef.current?.('skip', vx),
  });

  const cardAreaRef = useRef<View>(null);
  const pendingLikeIds = useRef<Set<string>>(new Set());
  const savedMutationIds = useRef<Set<string>>(new Set());
  const swipingRef = useRef(false);
  const messagingRef = useRef(false);
  // Карточка, по которой человек сейчас пишет отклик (null — окно закрыто)
  const [applyFor, setApplyFor] = useState<Vacancy | null>(null);

  useEffect(() => {
    const sync = () => {
      const fresh = getTodayDates();
      setDates(fresh);
      setSelectedDate(prev => {
        if (!fresh.includes(prev)) {
          return fresh[0];
        }
        return prev;
      });
    };
    sync();
    const interval = setInterval(sync, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Свои отклики — по ним видно, у кого человек уже работал.
  const myLikes = useMemo(
    () => (likes as Like[]).filter((l: Like) => l.workerId === currentUser?.id),
    [likes, currentUser?.id],
  );

  useEffect(() => {
    if (!currentUser) return;
    const filtered = [...vacancies, ...partnerShifts]
      .filter(v => {
        if (v.status !== 'open') return false;
        if (v.date !== selectedDate) return false;
        if (!sourceFilterMatches(filterSources, 'external' in v ? (v as PartnerShiftCard).external.sourceId : undefined)) return false;
        if (!('external' in v && !(v as PartnerShiftCard).external.workType)
          && !currentUser.workTypes?.includes(v.workType)) return false;
        if (pendingLikeIds.current.has(v.id)) return false;
        const liked = likes.find(l => l.vacancyId === v.id && l.workerId === currentUser.id);
        if (liked) return false;
        if (filterStations.length && !filterStations.includes(v.metroStation ?? '')) return false;
        if (!shiftMatchesTime((v as { timeStart?: string }).timeStart, (v as { timeEnd?: string }).timeEnd,
          { stations: filterStations, start: timeFilters.start, end: timeFilters.end, sources: filterSources })) return false;
        return true;
      })
      .sort((a, b) => {
        // Диплинк из Telegram всегда поднимает нужную смену первой.
        if (deepLinkVacancyId) {
          if (a.id === deepLinkVacancyId) return -1;
          if (b.id === deepLinkVacancyId) return 1;
        }
        // Подбор, а не только метро: подтверждённый навык, срочность,
        // знакомый работодатель и его рейтинг тоже двигают карточку вверх.
        // Работодателя ищем среди уже загруженных — недостающий просто не
        // добавит слагаемого, лишний запрос ради сортировки не нужен.
        const ctx = (v: Vacancy) => ({
          employer: users.find((u: User) => u.id === v.employerId) ?? null,
          myLikes: myLikes,
        });
        return scoreVacancyForWorker(b, currentUser, ctx(b))
             - scoreVacancyForWorker(a, currentUser, ctx(a));
      });
    setCards(filtered);
    if (!swipingRef.current) deck.reset();
  }, [selectedDate, vacancies, partnerShifts, likes, myLikes, users, currentUser, filterStations, timeFilters, filterSources, deepLinkVacancyId, deck]);

  const currentCard = cards[0];
  const currentEmployer = currentCard ? users.find(u => u.id === currentCard.employerId) : null;

  // Когда выложили. У партнёрской карточки поле createdAt подменено на
  // lastSeenAt — «когда источник в последний раз показывал её живой», а это
  // обновляется постоянно и означало бы «минуту назад» у любой вакансии.
  // Настоящую дату публикации знает только исходная запись источника.
  const postedAgo = currentCard
    ? agoRu('external' in currentCard
        ? (currentCard as PartnerShiftCard).external.createdAt
        : currentCard.createdAt)
    : '';
  const payLabel = currentCard ? payShort(currentCard.salary, currentCard.workType) : '';
  // Что показываем на карточке до «Читать полностью»: у своих смен условия,
  // у партнёрских — описание от источника.
  const shiftSummary = currentCard
    ? ('external' in currentCard
        ? ((currentCard as PartnerShiftCard).external.description ?? '')
        : currentCard.conditions)
    : '';

  // Подробности партнёрской вакансии показываем у себя, а не уводим сразу на
  // чужой сайт: описание у нас уже есть, а переход — отдельный шаг.
  const [externalDetail, setExternalDetail] = useState<ExternalVacancy | null>(null);

  // Уход к партнёру со смены: клик учитывается так же, как из кнопки чата,
  // иначе часть переходов просто не попала бы в статистику источника.
  const openShiftSource = useCallback((ext: ExternalVacancy) => {
    if (!currentUser) return;
    dbRecordExternalClick(ext.id, ext.sourceId, currentUser.id).catch(() => {});
    Linking.openURL(ext.url).catch(() => showToast('Не удалось открыть источник', 'error'));
  }, [currentUser, showToast]);

  const openShiftDetail = useCallback((card: Vacancy) => {
    // Нажатие сразу после свайпа игнорируем: иначе на вебе улетевшая карточка
    // заодно открывала бы подробности — см. wasSwipe в хуке.
    if (deck.wasSwipe()) return;
    if ('external' in card) {
      setExternalDetail((card as PartnerShiftCard).external);
      return;
    }
    setDetailVacancy(card);
    setDetailEmployer(users.find(u => u.id === card.employerId) ?? null);
  }, [users, deck]);

  const shareShiftVacancy = useCallback(async (v: Vacancy) => {
    // В идентификаторе нет user_id: ссылка измеряет эффективность самой
    // рекомендации, но не раскрывает, кто и кому её переслал.
    const shareCampaignId = Crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const url = `https://t.me/JobToo_bot/app?startapp=share_shift_${v.id}_${shareCampaignId}`;
    const message = [
      `${v.title} — ${v.company}`,
      v.metroStation ? `м. ${v.metroStation}` : '',
      v.salary ? `${v.salary.toLocaleString('ru-RU')} ₽ за смену` : '',
      url,
    ].filter(Boolean).join('\n');
    try {
      const result = await Share.share(
        Platform.OS === 'ios' ? { message: message.replace(`\n${url}`, ''), url } : { message },
      );
      if (result.action !== Share.dismissedAction) {
        void dbRecordGuestEvent('campaign_shared', {
          vacancyId: v.id,
          vacancyKind: 'shift',
          campaignId: shareCampaignId,
          channel: 'user_share',
        });
      }
    } catch {
      // Отмена системного окна «Поделиться» не должна показывать ошибку.
    }
  }, []);

  // После загрузки ленты сразу показываем карточку из Telegram-публикации.
  // Флаг защищает от повторного открытия при каждом realtime-обновлении.
  useEffect(() => {
    if (deepLinkOpened.current || !deepLinkVacancyId || currentCard?.id !== deepLinkVacancyId) return;
    deepLinkOpened.current = true;
    setDetailVacancy(currentCard);
    setDetailEmployer(currentEmployer ?? null);
  }, [deepLinkVacancyId, currentCard, currentEmployer]);
  // Онбордингу: есть ли реальная карточка (иначе он покажет демо-карточку)
  useEffect(() => { setOnboardingFlag('hasShiftCard', !!currentCard); }, [currentCard]);
  useEffect(() => {
    if (!currentCard?.id || !currentUser?.id) return;
    const t = setTimeout(() => {
      if (currentUser.isGuest) {
        if ('external' in currentCard) {
          const ext = (currentCard as PartnerShiftCard).external;
          void dbRecordGuestEvent('vacancy_impression', {
            vacancyId: ext.id, vacancyKind: 'external', sourceId: ext.sourceId,
          });
        } else {
          void dbRecordGuestEvent('vacancy_impression', {
            vacancyId: currentCard.id, vacancyKind: 'shift',
          });
        }
        return;
      }
      if ('external' in currentCard) {
        const ext = (currentCard as PartnerShiftCard).external;
        dbRecordExternalImpression(ext.id, ext.sourceId).catch(() => {});
      } else {
        dbRecordVacancyView(currentCard.id, currentUser.id).catch(() => {});
      }
    }, 300);
    return () => clearTimeout(t);
  }, [currentCard, currentUser?.id, currentUser?.isGuest]);

  const animateCard = useCallback((dir: 'left' | 'right', velocity: number, cb: () => void) => {
    swipingRef.current = true;
    setSwiping(true);
    deck.flyOut(dir, velocity, () => {
      swipingRef.current = false;
      setSwiping(false);
      cb();
    });
  }, [deck]);

  const doSkip = useCallback((vx = 0.5) => {
    if (!currentCard || !currentUser || swiping) return;
    const card = currentCard;
    const date = selectedDate;
    const user = currentUser;
    // Гость: три «отклонить» бесплатно, дальше — регистрация. Свайп «хочу» у
    // гостя и так ведёт на регистрацию, так что после лимита оба направления
    // конвертируют в регистрацию — максимум конверсии из гостевого режима.
    if (user.isGuest) {
      if (guestSkipCount >= GUEST_SKIP_LIMIT) { promptRegister({ vacancyKind: 'shift' }); return; }
      guestSkipCount += 1;
    }
    pendingLikeIds.current.add(card.id);
    animateCard('left', vx, () => {
      setHistory(h => ({ ...h, [date]: [card, ...(h[date] ?? []).slice(0, 9)] }));
      setCards(prev => prev.slice(1));
      // Партнёрскую карточку и гость листают локально: своей записи в базе нет.
      if (user.isGuest || 'external' in card) return;
      dbUpsertLike(card.id, user.id, card.employerId, { workerLiked: false, workerSkipped: true })
        .then(() => refreshLikes(user))
        .catch(() => {
          // Свайп уже анимирован, но сервер не принял решение. Возвращаем
          // карточку на вершину и убираем её из локальной истории: иначе UI
          // утверждал бы, что вакансия пропущена, а после обновления она
          // появилась бы снова без объяснения.
          pendingLikeIds.current.delete(card.id);
          setHistory(h => ({
            ...h,
            [date]: (h[date] ?? []).filter(v => v.id !== card.id),
          }));
          setCards(prev => [card, ...prev.filter(v => v.id !== card.id)]);
          showToast('Не удалось пропустить вакансию. Проверьте связь и попробуйте ещё раз.', 'error');
        });
    });
  }, [currentCard, currentUser, swiping, selectedDate, animateCard, refreshLikes, promptRegister, showToast]);

  const doWant = useCallback((vx = 0.5) => {
    if (!currentCard || !currentUser || swiping) return;
    if (campaignId && currentCard.id === deepLinkVacancyId) {
      void dbRecordGuestEvent('campaign_apply', {
        vacancyId: currentCard.id,
        vacancyKind: 'shift',
        campaignId,
      });
    }
    if (currentUser.isGuest) {
      const isExternal = 'external' in currentCard;
      const ext = isExternal ? (currentCard as PartnerShiftCard).external : null;
      promptRegister({
        vacancyId: ext?.id ?? currentCard.id,
        vacancyKind: isExternal ? 'external' : 'shift',
        sourceId: ext?.sourceId ?? null,
        campaignId: currentCard.id === deepLinkVacancyId ? campaignId || null : null,
      });
      return;
    }
    const card = currentCard;
    const date = selectedDate;
    const user = currentUser;
    pendingLikeIds.current.add(card.id);

    if ('external' in card) {
      const ext = (card as PartnerShiftCard).external;
      animateCard('right', vx, () => {
        setHistory(h => ({ ...h, [date]: [card, ...(h[date] ?? []).slice(0, 9)] }));
        setCards(prev => prev.slice(1));
        dbRecordExternalClick(ext.id, ext.sourceId, user.id).catch(() => {});
        Linking.openURL(ext.url).catch(() => showToast('Не удалось открыть источник', 'error'));
      });
      return;
    }

    animateCard('right', vx, () => {
      setHistory(h => ({ ...h, [date]: [card, ...(h[date] ?? []).slice(0, 9)] }));
      setCards(prev => prev.slice(1));
      (async () => {
        try {
          await dbUpsertLike(card.id, user.id, card.employerId, { workerLiked: true, workerSkipped: false });
          const result = await dbCheckAndCreateMatch(card.id, user.id);
          refreshLikes(user).catch(() => {});
          if (result.matched) {
            router.push({ pathname: '/match', params: { vacancyId: card.id, chatId: result.chatId } });
          } else {
            // Уведомление директору шлёт сервер при записи отклика — см. dbUpsertLike.
            showToast('Отклик отправлен. Ждём решения работодателя', 'success');
          }
        } catch {
          // Restore card to front of deck on failure
          pendingLikeIds.current.delete(card.id);
          setCards(prev => [card, ...prev.filter(v => v.id !== card.id)]);
          showToast('Ошибка при отправке отклика — попробуй ещё раз', 'error');
        }
      })();
    });
  }, [currentCard, currentUser, swiping, selectedDate, animateCard, refreshLikes, router, showToast, promptRegister, campaignId, deepLinkVacancyId]);

  // Сохранить смену в «Избранное» (кнопка ★). Партнёрские (внешние) карточки в
  // наше избранное не кладём — у них нет стабильного id в нашей базе; для них
  // ★ работает как переход к источнику (см. кнопку). Гостю — предложение
  // зарегистрироваться, как и на остальных действиях.
  const isCurrentSaved = !!currentCard && !('external' in currentCard) && savedIds.includes(currentCard.id);
  const toggleSavedShift = useCallback(async () => {
    if (!currentCard || 'external' in currentCard) return;
    const user = currentUser;
    if (!user) return;
    if (user.isGuest) { promptRegister({ vacancyKind: 'shift' }); return; }
    const id = currentCard.id;
    if (savedMutationIds.current.has(id)) return;
    savedMutationIds.current.add(id);
    try {
      if (savedIds.includes(id)) {
        await dbRemoveSaved(user.id, id);
        optimisticRemoveSaved(id);
        showToast('Удалено из избранного', 'success');
      } else {
        await dbAddSaved(user.id, id);
        optimisticAddSaved(id);
        showToast('Добавлено в избранное', 'success');
      }
    } catch {
      showToast(savedIds.includes(id) ? 'Не удалось удалить из избранного' : 'Не удалось добавить в избранное', 'error');
    } finally {
      savedMutationIds.current.delete(id);
    }
  }, [currentCard, currentUser, savedIds, optimisticAddSaved, optimisticRemoveSaved, promptRegister, showToast]);

  // Отклик на смену. Если переписка с этим работодателем уже есть — просто
  // открываем её. Если нет, сначала спрашиваем у человека пару слов о себе:
  // раньше вместо них уходил шаблон от имени системы, и отвечать было нечему.
  const doMessage = useCallback(() => {
    if (!currentCard || !currentUser || messagingRef.current) return;
    if (currentUser.isGuest) {
      const isExternal = 'external' in currentCard;
      const ext = isExternal ? (currentCard as PartnerShiftCard).external : null;
      promptRegister({
        vacancyId: ext?.id ?? currentCard.id,
        vacancyKind: isExternal ? 'external' : 'shift',
        sourceId: ext?.sourceId ?? null,
        campaignId: currentCard.id === deepLinkVacancyId ? campaignId || null : null,
      });
      return;
    }
    if ('external' in currentCard) {
      const ext = (currentCard as PartnerShiftCard).external;
      dbRecordExternalClick(ext.id, ext.sourceId, currentUser.id).catch(() => {});
      Linking.openURL(ext.url).catch(() => showToast('Не удалось открыть источник', 'error'));
      return;
    }
    const existingChat = chats.find(
      c => c.employerId === currentCard.employerId && c.workerId === currentUser.id
    );
    if (existingChat) {
      router.push({ pathname: '/chat-room', params: { chatId: existingChat.id } });
      return;
    }
    setApplyFor(currentCard);
  }, [currentCard, currentUser, chats, router, promptRegister]);

  const sendApply = useCallback(async (message: string) => {
    const card = applyFor;
    if (!card || !currentUser || messagingRef.current) return;
    if (campaignId && card.id === deepLinkVacancyId) {
      void dbRecordGuestEvent('campaign_apply', {
        vacancyId: card.id,
        vacancyKind: 'shift',
        campaignId,
      });
    }
    if (currentUser.isGuest) {
      promptRegister({
        vacancyId: card.id,
        vacancyKind: 'shift',
        campaignId: card.id === deepLinkVacancyId ? campaignId || null : null,
      });
      return;
    }
    messagingRef.current = true;
    try {
      await dbUpsertLike(card.id, currentUser.id, card.employerId, {
        workerLiked: true,
        workerSkipped: false,
      });
      const chatId = await dbCreateChat(
        currentUser.id,
        card.employerId,
        card.id,
        card.title,
        card.company,
        message,
        0,
        1,
        true,   // сообщение от работника, а не от системы
      );
      refreshChats().catch(() => {});
      // О первом сообщении извещает СЕРВЕР при заведении чата: в уведомлении
      // по-прежнему сами слова человека, но собирает их тот, кто их записал.
      setApplyFor(null);
      router.push({ pathname: '/chat-room', params: { chatId } });
    } catch (e) {
      showToast('Не удалось отправить отклик', 'error');
    } finally {
      messagingRef.current = false;
    }
  }, [applyFor, currentUser, refreshChats, router, showToast, promptRegister]);

  const doMessageRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    swipeCbRef.current = (dir, vx) => { if (dir === 'want') doWant(vx); else doSkip(vx); };
    doMessageRef.current = doMessage;
  });

  const countShifts = (d: string, f: ShiftFilters) => {
    if (!currentUser) return 0;
    return [...vacancies, ...partnerShifts].filter(v => {
      if (v.status !== 'open') return false;
      if (v.date !== d) return false;
      if (!sourceFilterMatches(f.sources, 'external' in v ? (v as PartnerShiftCard).external.sourceId : undefined)) return false;
      if (!('external' in v && !(v as PartnerShiftCard).external.workType)
        && !currentUser.workTypes?.includes(v.workType)) return false;
      const alreadySwiped = likes.find(l => l.vacancyId === v.id && l.workerId === currentUser.id);
      if (alreadySwiped) return false;
      if (f.stations.length && !f.stations.includes(v.metroStation ?? '')) return false;
      if (!shiftMatchesTime((v as { timeStart?: string }).timeStart, (v as { timeEnd?: string }).timeEnd, f)) return false;
      return true;
    }).length;
  };
  const getDateCount = (d: string) => countShifts(d, { stations: filterStations, start: timeFilters.start, end: timeFilters.end, sources: filterSources });

  const visibleDates = dates;

  const getRuDay = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()];
  };

  return (
    <View style={{ flex: 1 }}>
      {isGuest && (
        <TouchableOpacity style={gB.banner} activeOpacity={0.85} onPress={() => promptRegister()}>
          <Ionicons name="lock-closed" size={rs(15)} color="#fff" />
          <Text style={gB.bannerTxt}>Вы смотрите как гость. Зарегистрируйтесь, чтобы откликаться</Text>
          <Text style={gB.bannerCta}>Войти</Text>
        </TouchableOpacity>
      )}
      {partnerShiftsLoadFailed ? (
        <TouchableOpacity
          style={pS.offlineBar}
          onPress={() => void loadPartnerShifts()}
          activeOpacity={0.8}
        >
          <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
          <Text style={pS.offlineTxt}>
            Партнёрские смены не обновились — свои и ранее загруженные остаются доступны. Нажмите, чтобы повторить.
          </Text>
        </TouchableOpacity>
      ) : null}
      {/* Разовая / Регулярная */}
      <ShiftSubTabs value={subMode} onChange={setSubMode} />
      {subMode === 'regular' ? (
        <RegularLocked />
      ) : (
      <>
      {/* Date strip + inline filter button */}
      <View style={styles.dateStrip}>
        <View style={styles.dateStripInner}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateRow}
            style={{ flex: 1 }}
          >
            {visibleDates.map(d => {
              const active = d === selectedDate;
              const cnt = getDateCount(d);
              return (
                <TouchableOpacity key={d} style={[styles.dateChip, active && styles.dateChipActive]} onPress={() => setSelectedDate(d)} activeOpacity={0.8}>
                  <Text style={[styles.dcDay, active && styles.dcDayActive]}>{getRuDay(d)}</Text>
                  <Text style={[styles.dcNum, active && styles.dcNumActive]}>{new Date(d + 'T00:00:00').getDate()}</Text>
                  <Text style={[styles.dcCnt, active && styles.dcCntActive]}>{cnt}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[pS.inlineFilter, filtersActive ? pS.inlineFilterActive : null]}
            onPress={() => setFilterOpen(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="options-outline" size={20} color={filtersActive ? Colors.primary : Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {filterStations.length > 0 ? (
        <TouchableOpacity style={styles.activeStationChip} onPress={() => setFilterStations([])} activeOpacity={0.8}>
          <Ionicons name="location" size={13} color={Colors.primary} />
          <Text style={styles.activeStationTxt}>
            {filterStations.length === 1 ? `м. ${filterStations[0]}` : `Станций: ${filterStations.length}`}
          </Text>
          <Ionicons name="close" size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      ) : null}

      {filterOpen && (
        <ShiftFilterSheet
          initial={{ stations: filterStations, start: timeFilters.start, end: timeFilters.end, sources: filterSources }}
          sourceOptions={shiftSourceOptions}
          count={(f) => countShifts(selectedDate, f)}
          onApply={(f) => { setFilterStations(f.stations); setTimeFilters({ start: f.start, end: f.end }); setFilterSources(f.sources); }}
          onClose={() => setFilterOpen(false)}
        />
      )}

      <MetroMap
        visible={mapOpen}
        title="Смены на карте"
        items={mapItems}
        onSelect={(st) => { setFilterStations(st ? [st] : []); setMapOpen(false); }}
        onClose={() => setMapOpen(false)}
      />

      {/* Card area */}
      <View
        ref={cardAreaRef}
        style={styles.cardArea}
        onLayout={() => {
          cardAreaRef.current?.measureInWindow((x, y, w, h) => {
            if (w > 0) setOnboardingTarget('card', { x, y, w, h: Math.min(h, 360) });
          });
        }}
      >
        {!currentCard ? (
          <ScrollView
            contentContainerStyle={[styles.emptyState, { flexGrow: 1 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
          >
            <View style={styles.emptyCharContainer} pointerEvents="none">
              <Image
                source={require('../../assets/images/char-seeker-empty.png')}
                style={styles.emptyCharImg}
                contentFit="cover"
                contentPosition={{ top: '22%' }}
              />
            </View>
            {(() => {
              // Пустой экран не должен быть тупиком: если стоит фильтр — даём его
              // снять; иначе подсказываем ближайший день, где смены реально есть.
              const nextDay = visibleDates.find(d => d !== selectedDate && getDateCount(d) > 0);
              // Первым делом — не соврать. Если до сервера не достучались,
              // лента пуста не потому, что работы нет, а потому что её не
              // принесли. Разница для человека решающая: «смен нет» он читает
              // как «здесь искать нечего» и уходит, причём молча — в отчёте
              // это выглядит как обычный отток.
              //
              // Отличить одно от другого умеет refreshVacancies: он не трогает
              // список при обрыве (остаются данные из кэша) и поднимает
              // backendOffline. Экраны работодателя этим уже пользуются, а
              // главная лента работника — нет.
              if (backendOffline) {
                return (
                  <>
                    <Text style={styles.emptyTitle}>Нет связи с сервером</Text>
                    <Text style={styles.emptySubtitle}>
                      Смены не загрузились — дело в связи, а не в пустой ленте.
                      Проверьте интернет и попробуйте ещё раз.
                    </Text>
                    <TouchableOpacity style={eS.btn} activeOpacity={0.85} onPress={onRefresh}>
                      <Ionicons name="refresh-outline" size={rf(17)} color="#fff" />
                      <Text style={eS.btnTxt}>Попробовать снова</Text>
                    </TouchableOpacity>
                  </>
                );
              }
              if (filterStations.length) {
                return (
                  <>
                    <Text style={styles.emptyTitle}>На выбранных станциях смен нет</Text>
                    <Text style={styles.emptySubtitle}>Уберите фильтр по метро — покажем все смены поблизости</Text>
                    <TouchableOpacity style={eS.btn} activeOpacity={0.85} onPress={() => setFilterStations([])}>
                      <Ionicons name="close-circle-outline" size={rf(17)} color="#fff" />
                      <Text style={eS.btnTxt}>Показать все смены</Text>
                    </TouchableOpacity>
                  </>
                );
              }
              if (nextDay) {
                const cnt = getDateCount(nextDay);
                const mod10 = cnt % 10, mod100 = cnt % 100;
                const word = mod10 === 1 && mod100 !== 11 ? 'смена'
                  : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? 'смены'
                  : 'смен';
                return (
                  <>
                    <Text style={styles.emptyTitle}>На этот день смен нет</Text>
                    <Text style={styles.emptySubtitle}>Зато есть на другой день — посмотрите их</Text>
                    <TouchableOpacity style={eS.btn} activeOpacity={0.85} onPress={() => setSelectedDate(nextDay)}>
                      <Ionicons name="calendar-outline" size={rf(16)} color="#fff" />
                      <Text style={eS.btnTxt}>{getRuDay(nextDay)}, {new Date(nextDay + 'T00:00:00').getDate()} — {cnt} {word}</Text>
                    </TouchableOpacity>
                  </>
                );
              }
              return (
                <>
                  <Text style={styles.emptyTitle}>Новых вакансий пока нет</Text>
                  <Text style={styles.emptySubtitle}>Потяните вниз, чтобы обновить, или дождитесь новых объявлений</Text>
                </>
              );
            })()}
          </ScrollView>
        ) : (
          <>
            {cards[2] ? <View style={styles.ghost2} /> : null}
            {cards[1] ? <View style={styles.ghost1} /> : null}

            {/* Потягивание вниз обновляет ленту. Список ровно по высоте карточки,
                прокручивать в нём нечего — он здесь только ради RefreshControl:
                внутри самой карточки прокрутки нет, и потянуть её нельзя.

                Со свайпом это не спорит: жест карточки срабатывает на восьми
                пикселях вбок, а на двадцати вниз проигрывает и отдаёт касание
                списку (см. failOffsetY в useSwipeDeck).

                «Призраки» колоды остались снаружи: они позиционированы абсолютно
                от области карточек, и внутри списка их отступы сложились бы с её
                внутренними полями. */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1 }}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
            >
              <GestureDetector gesture={deck.gesture}>
                <Reanimated.View style={[styles.cardAnimated, deck.cardStyle]}>
                  <View style={styles.card}>
                    <Reanimated.View style={[styles.wantOverlay, deck.wantStyle]}>
                      <Text style={styles.wantText}>ХОЧУ ♥</Text>
                    </Reanimated.View>
                    <Reanimated.View style={[styles.skipOverlay, deck.skipStyle]}>
                      <Text style={styles.skipText}>НЕТ ✕</Text>
                    </Reanimated.View>

                    {/* Прокрутки внутри карточки нет. Карточка показывает то, по
                        чему принимают решение, а весь текст открывается по
                        «Читать полностью». Пока здесь жил ScrollView, два жеста
                        делили одну площадь и карточка уезжала от попытки
                        полистать; теперь спорить не с чем. */}
                    <Pressable
                      style={styles.cardBody}
                      accessibilityRole="button"
                      accessibilityLabel="Открыть вакансию полностью"
                      onPress={() => openShiftDetail(currentCard)}
                    >
                      <View style={styles.cardTop}>
                        <View style={styles.companyRow}>
                          <CompanyMark company={currentCard.company} size={34} />
                          <View style={{ flex: 1 }}>
                            {/* Компания и когда выложили — одной строкой, как на
                                образце: это подпись к карточке, а не заголовок. */}
                            <Text style={styles.companyName} numberOfLines={1}>
                              {normalizeCompany(currentCard.company)}
                              {postedAgo ? <Text style={styles.postedAgo}>{` · ${postedAgo}`}</Text> : null}
                            </Text>
                          </View>
                          <View style={styles.cardBadges}>
                            {currentCard.isUrgent ? (
                              <View style={styles.urgentTag}>
                                <Ionicons name="flash" size={11} color="#92400E" />
                                <Text style={styles.urgentTagTxt}>Срочно</Text>
                              </View>
                            ) : null}
                            <SourceBadge partnerName={'external' in currentCard ? ((currentCard as PartnerShiftCard).external.sourceName ?? 'Партнёр') : undefined} />
                          </View>
                        </View>

                        <Text style={styles.jobTitle} numberOfLines={2}>{currentCard.title}</Text>

                        {/* Чипы одного спокойного цвета и одного размера, кроме
                            денег: цветом выделяется только то, ради чего карточку
                            и открывают. Адрес — такой же чип, а не толстая
                            плашка, которой он был раньше. */}
                        <View style={styles.chipsRow}>
                          {payLabel ? <Chip label={payLabel} variant="salary" icon="wallet-outline" /> : null}
                          <Chip label={`${currentCard.timeStart}–${currentCard.timeEnd}`} variant="neutral" icon="time-outline" />
                          <Chip label={formatDate(currentCard.date)} variant="neutral" icon="calendar-outline" />
                          {currentCard.metroStation ? <Chip label={currentCard.metroStation} variant="neutral" icon="subway-outline" /> : null}
                          {currentCard.noExperienceNeeded ? <Chip label="Без опыта" variant="neutral" icon="school-outline" /> : null}
                          {currentCard.address ? <Chip label={currentCard.address} variant="neutral" icon="location-outline" /> : null}
                        </View>

                        {/* Как этот работодатель отвечает — здесь, а не только в
                            подробностях. Решение принимается свайпом: это одно
                            движение и ноль раздумий, и до «Читать полностью»
                            доходят единицы. Предупреждать о молчуне после того,
                            как отклик ушёл, поздно — отклик без ответа человек
                            читает как «сервис не работает».

                            Карта отзывчивости грузится одним запросом на всех
                            ровно ради этого места (contexts/AppContext.tsx):
                            ходить за ней на каждую карточку нельзя, лента
                            превратится в слайд-шоу.

                            Плашка сама молчит, когда переписок меньше двух: по
                            одной вывод делать нельзя, а выглядел бы он как
                            приговор. У партнёрских карточек employerId вида
                            `external:...`, в карте его нет — там тоже пусто.

                            Место выбрано до разделителя: cardSummary стоит
                            flexShrink, поэтому ужмётся описание, а не уедет за
                            край ссылка «Читать полностью». */}
                        <ReplyBadge stats={responsivenessMap[currentCard.employerId]} />
                      </View>

                      <View style={styles.cardDivider} />

                      <View style={styles.cardMiddle}>
                        {/* Ссылка идёт сразу за текстом, как на образце. Если
                            места мало, ужимается текст, а не ссылка: без
                            прокрутки уехавшую за край ссылку уже ничем не
                            достать. */}
                        <View style={styles.cardSummary}>
                          {shiftSummary ? (
                            <Text style={pS.desc} numberOfLines={4}>{shiftSummary}</Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={styles.readFullRow}
                          onPress={() => openShiftDetail(currentCard)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.readFullTxt}>Читать полностью</Text>
                        </TouchableOpacity>
                      </View>
                    </Pressable>
                  </View>
                </Reanimated.View>
              </GestureDetector>
            </ScrollView>

            {/* Плавающие кнопки как в «Работе» и на образце: ✕ / ★ / ♥ и
                подсказка «Свайпай». Раньше это была плоская панель внутри
                карточки (отмена/✕/чат/♥) — теперь одинаково с постоянной работой.
                У партнёрских карточек средняя кнопка ведёт к источнику (в наше
                избранное их не кладём — нет стабильного id). */}
            <View style={[styles.shiftDeckActions, { bottom: tabBarHeight + rs(18) }]} pointerEvents="box-none">
              <View style={styles.shiftDeckRow}>
                <TouchableOpacity
                  accessibilityLabel="Отклонить смену"
                  style={[styles.deckFloatingAction, styles.deckFloatingSkip]}
                  onPress={() => doSkip(0.5)}
                  disabled={swiping}
                  activeOpacity={0.75}
                >
                  <Ionicons name="close" size={34} color={Colors.red} />
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityLabel={'external' in currentCard ? 'Открыть у источника' : 'Написать работодателю'}
                  style={[styles.deckFloatingAction, styles.deckFloatingChat]}
                  onPress={() => doMessageRef.current?.()}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="chatbubble-outline"
                    size={23}
                    color={Colors.blue}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityLabel="Откликнуться на смену"
                  style={[styles.deckFloatingAction, styles.deckFloatingWant]}
                  onPress={() => doWant(0.5)}
                  disabled={swiping}
                  activeOpacity={0.75}
                >
                  <Ionicons name="heart" size={31} color="#fff" />
                </TouchableOpacity>
              </View>
              <View style={styles.swipeHintRow}>
                <Ionicons name="arrow-undo-outline" size={20} color="#9AA3B2" />
                <Text style={styles.swipeHint}>Свайпай</Text>
                <Ionicons name="arrow-redo-outline" size={20} color="#9AA3B2" />
              </View>
            </View>
          </>
        )}
      </View>


      <MetroPicker
        visible={filterPicker}
        selected={filterStations}
        onChange={setFilterStations}
        onClose={() => setFilterPicker(false)}
      />

      <ExternalVacancyDetail
        vacancy={externalDetail}
        onClose={() => setExternalDetail(null)}
        onOpenSource={(v: ExternalVacancy) => { setExternalDetail(null); openShiftSource(v); }}
        locked={!!currentUser?.isGuest}
        onLogin={() => { setExternalDetail(null); promptRegister({ vacancyKind: 'external' }); }}
      />

      {/* Подробности смены */}
      <VacancyDetailModal
        vacancy={detailVacancy}
        visible={!!detailVacancy}
        employer={detailEmployer}
        onClose={() => { setDetailVacancy(null); setDetailEmployer(null); }}
        onShare={detailVacancy ? () => { void shareShiftVacancy(detailVacancy); } : undefined}
        locked={!!currentUser?.isGuest}
        onLogin={() => { setDetailVacancy(null); promptRegister({ vacancyKind: 'shift' }); }}
        onChat={() => { setDetailVacancy(null); doMessageRef.current?.(); }}
        actions={
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={styles.detailSkipBtn}
              onPress={() => { setDetailVacancy(null); doSkip(0.5); }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="close" size={16} color={Colors.red} />
                <Text style={styles.detailSkipTxt}>Не подходит</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.detailWantBtn}
              onPress={() => { setDetailVacancy(null); doWant(0.5); }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="heart" size={16} color="#fff" />
                <Text style={styles.detailWantTxt}>Хочу!</Text>
              </View>
            </TouchableOpacity>
          </View>
        }
      />

      <ApplySheet
        visible={!!applyFor}
        onClose={() => setApplyFor(null)}
        onSend={sendApply}
        title="Отклик на смену"
        info={applyFor ? vacancyInfoLines(applyFor) : []}
        chips={getChatSuggestions('worker', applyFor)}
      />
      </>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────
// Worker Permanent mode
// ─────────────────────────────────────────────────
type PermTab = 'open' | 'applied' | 'saved';

const SALARY_CHIPS = [
  { label: 'Любая', value: 0 },
  { label: '30 000+', value: 30000 },
  { label: '50 000+', value: 50000 },
  { label: '80 000+', value: 80000 },
  { label: '100 000+', value: 100000 },
];

// Значок в углу карточки. У наших вакансий — фирменный вордмарк JobToo (как в
// шапке, components/ui/TabHeader.tsx), у партнёрских (залитых по API) — название
// источника. Логотип-картинку партнёра добавим позже отдельным полем.
function SourceBadge({ partnerName }: { partnerName?: string }) {
  if (partnerName) {
    return (
      <View style={styles.sourceBadge}>
        <Text style={styles.sourceBadgeTxt} numberOfLines={1}>{partnerName}</Text>
      </View>
    );
  }
  return (
    <View style={styles.jtBadge}>
      <Text style={styles.jtBadgeTxt}>
        <Text style={styles.jtBadgeB}>Job</Text>
        <Text style={styles.jtBadgeO}>Too</Text>
      </Text>
    </View>
  );
}

// Засчитывает просмотр верхней карточки колоды «Работа».
//
// Раньше просмотр писался только в списочном режиме (onViewableItemsChanged у
// FlatList), а «Открытые»/«Избранное» давно стали свайп-колодой — и листание
// карточек не засчитывалось вовсе, число «Просмотрели» не росло. Здесь
// повторяем логику колоды смен: гость — событие аналитики, партнёр — внешний
// импрешн, наша вакансия — запись в jm_perm_vacancy_views (сервер сам
// схлопывает дубли по паре vacancy_id+worker_id).
//
// Отдельным компонентом, а не useEffect в теле WorkerPermMode: там ниже есть
// ранний return (гость без currentUser), и хук после него нарушил бы порядок
// хуков.
function PermDeckViewRecorder({ vacancy, userId, isGuest }: {
  vacancy: PermVacancy | ExternalVacancy | undefined;
  userId: string;
  isGuest: boolean;
}) {
  const vid = vacancy?.id;
  const isExternal = !!vacancy && 'sourceId' in vacancy;
  const sourceId = isExternal ? (vacancy as ExternalVacancy).sourceId : null;
  useEffect(() => {
    if (!vid) return;
    const t = setTimeout(() => {
      if (isGuest) {
        void dbRecordGuestEvent('vacancy_impression', {
          vacancyId: vid,
          vacancyKind: isExternal ? 'external' : 'permanent',
          sourceId,
        });
        return;
      }
      if (isExternal && sourceId) dbRecordExternalImpression(vid, sourceId).catch(() => {});
      else if (!isExternal && userId) dbRecordPermVacancyView(vid, userId).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [vid, userId, isGuest, isExternal, sourceId]);
  return null;
}

function WorkerPermMode({ onUndoChange }: { onUndoChange?: (action: (() => void) | null) => void } = {}) {
  const router = useRouter();
  const {
    currentUser, users, permVacancies, permApplications,
    refreshPermVacancies, refreshPermApplications,
    chats, refreshChats,
    showToast, permVacancyViewsMap, refreshPermVacancyViews,
    permSavedIds, optimisticAddPermSaved, optimisticRemovePermSaved, exitGuest,
    backendOffline,
  } = useApp();
  const tabBarHeight = useBottomTabBarHeight();

  // Гость смотрит постоянные вакансии, но действовать не может — ведём на
  // регистрацию (см. соискательскую ленту смен).
  const isGuest = !!currentUser?.isGuest;
  const promptRegister = (context: {
    vacancyId?: string | null;
    vacancyKind?: 'shift' | 'permanent' | 'external' | null;
    sourceId?: string | null;
  } = {}) => {
    void dbStartGuestRegistration(context);
    exitGuest();
    router.replace('/');
  };

  const [tab, setTab] = useState<PermTab>('open');
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterStations, setFilterStations] = useState<string[]>([]);
  // Доп. фильтры постоянной работы (см. PermFilterSheet).
  const [searchIn, setSearchIn] = useState<('title' | 'desc')[]>([]);
  const [posted, setPosted] = useState<'all' | 'week' | '3days'>('all');
  const [schedules, setSchedules] = useState<string[]>([]);
  const [filterSources, setFilterSources] = useState<string[]>([]);
  const [permFilterOpen, setPermFilterOpen] = useState(false);
  // Какие карточки развёрнуты (описание «Читать ещё»). По id вакансии.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [filterPicker, setFilterPicker] = useState(false);
  const [minSalary, setMinSalary] = useState(0);
  const [applying, setApplying] = useState<string | null>(null);
  // Вакансия, по которой человек сейчас пишет отклик (null — окно закрыто)
  const [permApplyFor, setPermApplyFor] = useState<PermVacancy | null>(null);
  const [chatLoading, setChatLoading] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [externalVacancies, setExternalVacancies] = useState<ExternalVacancy[]>([]);
  const [externalVacanciesLoadFailed, setExternalVacanciesLoadFailed] = useState(false);
  const [externalSourceOptions, setExternalSourceOptions] = useState<VacancySourceOption[]>([]);
  // Redirect-источник открываем с подтверждением. Для embedded-источника
  // отдельно получаем согласие на передачу данных и создаём отклик у нас.
  const [externalConfirm, setExternalConfirm] = useState<ExternalVacancy | null>(null);
  // «Читать полностью» у партнёрской вакансии: описание показываем у себя, а
  // уход на чужой сайт остаётся отдельным шагом внутри этого окна.
  const [permExternalDetail, setPermExternalDetail] = useState<ExternalVacancy | null>(null);
  const [partnerConsentFor, setPartnerConsentFor] = useState<ExternalVacancy | null>(null);
  const [superJobConnectFor, setSuperJobConnectFor] = useState<ExternalVacancy | null>(null);
  const [superJobConnecting, setSuperJobConnecting] = useState(false);
  const [superJobConnectError, setSuperJobConnectError] = useState<string | null>(null);
  const permSavedMutationIds = useRef<Set<string>>(new Set());

  const externalLoadId = useRef(0);
  const loadExternalVacancies = useCallback(async (sourceIds?: string[]) => {
    const loadId = ++externalLoadId.current;
    if (sourceIds && sourceIds.length === 0) {
      setExternalVacancies([]);
      setExternalVacanciesLoadFailed(false);
      return;
    }
    setExternalVacanciesLoadFailed(false);
    const pageSize = 1000;
    const loaded: ExternalVacancy[] = [];
    const seen = new Set<string>();
    try {
      for (let offset = 0; offset < 50000; offset += pageSize) {
        const page = await dbGetExternalVacancyPage(offset, pageSize, sourceIds);
        const rows = page.vacancies;
        if (externalLoadId.current !== loadId) return;
        for (const vacancy of rows) {
          if (vacancy.kind !== 'permanent') continue;
          const key = vacancy.dedupeKey || `${vacancy.sourceId}:${vacancy.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          loaded.push(vacancy);
        }
        // Показываем первую страницу сразу и дополняем список после каждой
        // следующей, не заставляя экран ждать весь большой каталог.
        setExternalVacancies([...loaded]);
        // rows уже очищены от дублей и почти всегда короче сырой страницы.
        // Конец выдачи можно определять только по числу строк от сервера.
        if (page.rawCount < pageSize) break;
      }
    } catch {
      // Уже загруженные страницы остаются видимыми. Свои вакансии продолжают
      // работать, даже если очередная страница партнёрского фида недоступна.
      setExternalVacanciesLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    dbGetExternalSourceOptions()
      .then(rows => setExternalSourceOptions(rows.map(row => ({
        id: partnerSourceFilterId(row.id), label: row.name,
      }))))
      .catch(() => {});
  }, []);

  const externalSelection = useMemo(() => selectedPartnerSourceIds(filterSources), [filterSources]);
  useEffect(() => { loadExternalVacancies(externalSelection); }, [loadExternalVacancies, externalSelection]);

  const permSourceOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of [...externalSourceOptions, ...buildSourceOptions(externalVacancies)]) {
      options.set(item.id, item.label);
    }
    options.set(JOBTOO_SOURCE_FILTER_ID, 'JobToo');
    return Array.from(options, ([id, label]) => ({ id, label }))
      .sort((a, b) => a.id === JOBTOO_SOURCE_FILTER_ID ? -1
        : b.id === JOBTOO_SOURCE_FILTER_ID ? 1 : a.label.localeCompare(b.label, 'ru'));
  }, [externalSourceOptions, externalVacancies]);

  // Вакансии для карты: метка — это адрес, станция остаётся для фильтра
  const permMapItems: MapListItem[] = useMemo(
    () => [
      ...(permVacancies as PermVacancy[])
      .filter((v: PermVacancy) => v.status === 'open' && sourceFilterMatches(filterSources) && (!!v.metroStation || !!v.address))
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
      ...externalVacancies
        .filter(v => sourceFilterMatches(filterSources, v.sourceId) && (!!v.metroStation || !!v.address))
        .map(v => ({
          id: `external:${v.id}`,
          station: v.metroStation ?? '',
          title: v.title,
          company: v.company ?? v.sourceName ?? 'Компания',
          pay: v.salary ? `${v.salary.toLocaleString('ru-RU')} ₽/мес` : undefined,
          meta: v.schedule,
          address: v.address,
          lat: v.lat,
          lng: v.lng,
        })),
    ],
    [permVacancies, externalVacancies, filterSources],
  );

  const viewedPermIds = useRef(new Set<string>());
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });
  const currentUserRef = useRef(currentUser);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const user = currentUserRef.current;
    if (!user?.id) return;
    viewableItems.forEach(({ item }: any) => {
      if (!item?.id || viewedPermIds.current.has(item.id)) return;
      viewedPermIds.current.add(item.id);
      if (user.isGuest) {
        void dbRecordGuestEvent('vacancy_impression', {
          vacancyId: item.id,
          vacancyKind: 'sourceId' in item ? 'external' : 'permanent',
          sourceId: 'sourceId' in item ? item.sourceId : null,
        });
      } else if ('sourceId' in item) {
        dbRecordExternalImpression(item.id, item.sourceId).catch(() => {});
      } else {
        dbRecordPermVacancyView(item.id, user.id).catch(() => {});
      }
    });
  });

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshPermVacancies(), refreshPermApplications(), refreshPermVacancyViews(),
        loadExternalVacancies(externalSelection),
      ]);
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
  const swUndo = useCallback(() => {
    setSwHistory(h => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setSwSkipped(s => { const n = new Set(s); n.delete(last); return n; });
      return h.slice(0, -1);
    });
  }, []);
  useEffect(() => {
    onUndoChange?.(swHistory.length ? swUndo : null);
    return () => onUndoChange?.(null);
  }, [swHistory.length, swUndo, onUndoChange]);

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  const myApps = permApplications.filter(a => a.workerId === currentUser.id);
  const myAppVacIds = new Set(myApps.map(a => a.vacancyId));
  const getAppStatus = (vacId: string) => myApps.find(a => a.vacancyId === vacId)?.status ?? null;

  // Текущие применённые фильтры одним объектом — так их удобно и применять,
  // и считать «Показать N» для черновика в шторке.
  const permF: PermFilters = { query: searchText, searchIn, posted, stations: filterStations, salaryFrom: minSalary > 0 ? String(minSalary) : '', schedules, sources: filterSources };
  const permFiltersActive = filterStations.length > 0 || !!searchText || minSalary > 0 || searchIn.length > 0 || posted !== 'all' || schedules.length > 0 || filterSources.length > 0;

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

  const matchesSearch = (v: PermVacancy) => permMatchesQuery(v.title, v.company, v.description ?? '', permF);
  const matchesFilters = (v: PermVacancy) => permMatchesMeta(v.metroStation, v.salary, v.createdAt, v.schedule, permF);

  const openVacancies    = permVacancies.filter(v => v.status === 'open' && !myAppVacIds.has(v.id) && sourceFilterMatches(permF.sources) && matchesSearch(v) && matchesFilters(v));
  const externalOpenVacancies = externalVacancies.filter(v =>
    sourceFilterMatches(permF.sources, v.sourceId)
    && permMatchesQuery(v.title, v.company ?? v.sourceName ?? '', (v as { description?: string }).description ?? '', permF)
    && permMatchesMeta(v.metroStation, v.salary ?? 0, (v as { createdAt?: string }).createdAt, (v as { schedule?: string }).schedule, permF));
  // Отказ больше не прячется в отдельную вкладку: отклик остаётся здесь,
  // просто с красной плашкой «✕ Отказ» — иначе вакансия исчезала без объяснений
  const appliedVacancies = permVacancies.filter(v => myAppVacIds.has(v.id) && sourceFilterMatches(permF.sources) && matchesSearch(v) && matchesFilters(v));
  const savedVacancies   = permVacancies.filter(v => permSavedIds.includes(v.id) && sourceFilterMatches(permF.sources) && matchesSearch(v) && matchesFilters(v));

  // «Показать N» в шторке фильтров: открытые (не откликнутые) + внешние
  // под выбранный черновик фильтров.
  const countPermLocal = (f: PermFilters) =>
    permVacancies.filter(v => v.status === 'open' && !myAppVacIds.has(v.id)
      && sourceFilterMatches(f.sources)
      && permMatchesQuery(v.title, v.company, v.description ?? '', f)
      && permMatchesMeta(v.metroStation, v.salary, v.createdAt, v.schedule, f)).length;

  const shownVacancies: (PermVacancy | ExternalVacancy)[] =
    tab === 'open'     ? [...openVacancies, ...externalOpenVacancies] :
    tab === 'applied'  ? appliedVacancies :
    savedVacancies;

  // Отклик на постоянную вакансию раньше уходил молча — строка в таблице со
  // статусом «ожидает», и всё. Теперь сначала спрашиваем пару слов о себе, и
  // отклик открывает переписку: сказать о себе было негде, а именно сюда
  // приходит большая часть откликов.
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
    } catch (e) {
      console.warn('[applyTo]', e);
      showToast('Не удалось отправить отклик', 'error');
    } finally {
      setApplying(null);
    }
  };

  const openPermChat = async (v: PermVacancy, displayCompany: string) => {
    if (!currentUser || chatLoading) return;
    if (currentUser.isGuest) {
      promptRegister({ vacancyId: v.id, vacancyKind: 'permanent' });
      return;
    }
    // Check if chat already exists
    const existing = chats.find(c => c.employerId === v.employerId && c.workerId === currentUser.id);
    if (existing) {
      router.push({ pathname: '/chat-room', params: { chatId: existing.id } });
      return;
    }
    setChatLoading(v.id);
    try {
      const chatId = await dbCreateChat(
        currentUser.id,
        v.employerId,
        v.id,
        v.title,
        displayCompany,
      );
      refreshChats().catch(() => {});
      router.push({ pathname: '/chat-room', params: { chatId } });
    } catch {
      showToast('Ошибка при открытии чата', 'error');
    } finally {
      setChatLoading(null);
    }
  };

  // Тот же набор, что видит директор в своей шторке, — и так же иконками,
  // а не смайликами: их рисует система, и на каждом телефоне по-своему.
  const STATUS_MAP: Record<string, { label: string; icon: IconName; color: string; bg: string }> = {
    pending:  { label: 'На рассмотрении', icon: 'hourglass-outline', color: '#92400E',    bg: '#FFF7ED' },
    approved: { label: 'Приглашён',       icon: 'checkmark-circle',  color: Colors.green, bg: '#D1FAE5' },
    rejected: { label: 'Отказ',           icon: 'close-circle',      color: Colors.red,   bg: '#FEE2E2' },
  };

  const toggleSaved = async (v: PermVacancy) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      promptRegister({ vacancyId: v.id, vacancyKind: 'permanent' });
      return;
    }
    if (permSavedMutationIds.current.has(v.id)) return;
    permSavedMutationIds.current.add(v.id);
    try {
      if (permSavedIds.includes(v.id)) {
        await dbRemovePermSaved(currentUser.id, v.id);
        optimisticRemovePermSaved(v.id);
        showToast('Удалено из избранного', 'success');
      } else {
        await dbAddPermSaved(currentUser.id, v.id);
        optimisticAddPermSaved(v.id);
        showToast('Сохранено в избранное', 'success');
      }
    } catch {
      showToast(permSavedIds.includes(v.id) ? 'Не удалось удалить из избранного' : 'Не удалось сохранить в избранное', 'error');
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

  // Переход к партнёрской вакансии на сайте источника. Один обработчик на все
  // места: список, карточка колоды, плашка подтверждения свайпа.
  const openExternalVacancy = async (v: ExternalVacancy) => {
    // ID создаётся до сетевого запроса и сразу попадает в URL: переход остаётся
    // прямым пользовательским жестом, а партнёр может вернуть этот непрозрачный
    // ID в callback без каких-либо данных человека.
    const clickId = Crypto.randomUUID().replace(/-/g, '');
    const targetUrl = partnerAttributionUrl(v.url, clickId, v.sourceId);
    dbRecordExternalClick(v.id, v.sourceId, currentUser.id, clickId).catch(() => {});
    if (currentUser.isGuest) {
      void dbRecordGuestEvent('external_click', {
        vacancyId: v.id, vacancyKind: 'external', sourceId: v.sourceId,
      });
    }
    try {
      await Linking.openURL(targetUrl);
    } catch {
      showToast('Не удалось открыть вакансию', 'error');
    }
  };

  const submitPartnerApplication = async (v: ExternalVacancy) => {
    if (currentUser.isGuest) {
      setPartnerConsentFor(null);
      promptRegister({ vacancyKind: 'permanent' });
      return;
    }
    await dbRecordPartnerDataConsent({
      sourceId: v.sourceId,
      workerId: currentUser.id,
      externalVacancyId: v.id,
      recipientName: v.sourceName ?? v.company ?? 'Партнёр',
      dataCategories: ['profile', 'application', 'messages', 'statuses'],
      purpose: 'Рассмотрение отклика и обмен статусами по выбранной вакансии',
      consentVersion: PARTNER_CONSENT_VERSION,
    });
    const result = v.connectorKind === 'superjob'
      ? await dbApplyViaSuperJob({
          externalVacancyId: v.id,
          consentVersion: PARTNER_CONSENT_VERSION,
        })
      : await dbCreatePartnerApplication({
          sourceId: v.sourceId,
          workerId: currentUser.id,
          externalVacancyId: v.id,
          consentVersion: PARTNER_CONSENT_VERSION,
        });
    setPartnerConsentFor(null);
    setSwSkipped(s => new Set(s).add(v.id));
    setSwHistory(h => h.includes(v.id) ? h : [...h, v.id]);
    showToast(
      result.created
        ? (v.connectorKind === 'superjob' ? 'Отклик отправлен в SuperJob' : 'Отклик отправляется работодателю')
        : 'Вы уже откликнулись',
      'success',
    );
  };

  const prepareSuperJobApplication = async (v: ExternalVacancy) => {
    if (currentUser.isGuest) {
      promptRegister({ vacancyKind: 'permanent' });
      return;
    }
    try {
      const status = await dbGetSuperJobOAuthStatus();
      if (status.connected && status.has_resume) {
        setPartnerConsentFor(v);
        return;
      }
      if (status.connected && !status.has_resume) {
        showToast('Сначала создайте или выберите основное резюме в SuperJob', 'error');
        return;
      }
      setSuperJobConnectError(null);
      setSuperJobConnectFor(v);
    } catch (e: any) {
      showToast(e?.message ?? 'Не удалось подключить SuperJob', 'error');
    }
  };

  const connectSuperJobAndContinue = async () => {
    const vacancy = superJobConnectFor;
    if (!vacancy || superJobConnecting) return;
    setSuperJobConnecting(true);
    setSuperJobConnectError(null);
    try {
      const returnUrl = Platform.OS === 'web' ? 'https://jobtoo.ru/' : 'onspaceapp:///';
      const { url } = await dbStartSuperJobOAuth(returnUrl);
      const auth = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (auth.type !== 'success') {
        setSuperJobConnectError('Подключение отменено. Можно попробовать ещё раз.');
        return;
      }

      // Callback сначала сохраняет токены на сервере и только потом возвращает
      // человека в приложение. Даём реплике БД несколько секунд догнать запись,
      // вместо прежней одиночной проверки и требования повторить свайп.
      let status = await dbGetSuperJobOAuthStatus();
      for (let attempt = 0; !status.connected && attempt < 11; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
        status = await dbGetSuperJobOAuthStatus();
      }
      if (!status.connected) {
        setSuperJobConnectError('Не удалось подтвердить подключение. Нажмите «Попробовать снова».');
        return;
      }
      if (!status.has_resume) {
        setSuperJobConnectError('В SuperJob нужно создать или выбрать основное резюме. После этого попробуйте снова.');
        return;
      }

      setSuperJobConnectFor(null);
      setPartnerConsentFor(vacancy);
    } catch (e: any) {
      setSuperJobConnectError(e?.message ?? 'Не удалось подключить SuperJob. Попробуйте снова.');
    } finally {
      setSuperJobConnecting(false);
    }
  };

  const renderPerm = ({ item: v }: { item: PermVacancy | ExternalVacancy }) => {
    const isExternal = 'sourceId' in v;
    if (isExternal) {
      const company = v.company ?? v.sourceName ?? 'Компания';
      return (
        <TouchableOpacity style={pS.card} onPress={() => openExternalVacancy(v)} activeOpacity={0.9}>
          <View style={pS.externalHead}>
            <View style={{ flex: 1 }}>
              <Text style={pS.jobTitle} numberOfLines={2}>{v.title}</Text>
              <Text style={pS.companyName} numberOfLines={1}>{company}</Text>
            </View>
            <View style={pS.externalBadge}>
              <Text style={pS.externalBadgeTxt}>{v.sourceName ?? 'Партнёр'}</Text>
            </View>
          </View>
          {v.salary ? <Text style={pS.salaryMain}>{v.salary.toLocaleString('ru-RU')} ₽/мес</Text> : null}
          {(v.metroStation || v.metroStationRaw || v.address) ? (
            <View style={pS.locationRow}>
              <Ionicons name="location-outline" size={14} color={Colors.textMuted} />
              <Text style={pS.locationRowText} numberOfLines={2}>
                {[v.metroStation ?? v.metroStationRaw, v.address].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}
          {v.schedule ? <Text style={pS.desc} numberOfLines={2}>{v.schedule}</Text> : null}
          <View style={pS.externalAction}>
            <Text style={pS.externalActionTxt}>Открыть у источника</Text>
            <Ionicons name="open-outline" size={15} color={Colors.primary} />
          </View>
        </TouchableOpacity>
      );
    }

    const isApplied = myAppVacIds.has(v.id);
    const isApplying = applying === v.id;
    const isSaved = permSavedIds.includes(v.id);
    const appStatus = getAppStatus(v.id);
    const statusInfo = appStatus ? STATUS_MAP[appStatus] : null;
    const metroLine = v.metroStation
      ? METRO_LINES.find(l => l.stations.includes(v.metroStation!)) ?? null
      : null;

    const displayCompany = normalizeCompany(v.company);

    // Содержимое карточки. В режиме колоды (deck) оно прокручивается внутри
    // самой карточки — если вакансия большая (длинное описание и т.д.), её
    // листаешь по разделам, а рамка карточки остаётся на месте и её можно
    // свайпать вправо/влево.
    const cardBody = (
      <>
        {statusInfo ? (
          <View style={[pS.statusBadge, { backgroundColor: statusInfo.bg }]}>
            <Ionicons name={statusInfo.icon} size={rf(12)} color={statusInfo.color} />
            <Text style={[pS.statusTxt, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        ) : null}

        {/* Company row */}
        <View style={pS.companyRow}>
          <CompanyMark company={v.company} size={42} />
          <View style={pS.companyMeta}>
            <Text style={pS.companyName} numberOfLines={1}>{displayCompany}</Text>
            {'verified' in v && (v as any).verified === true ? (
              <View style={pS.verifiedRow}>
                <View style={pS.verifiedBadge}>
                  <Ionicons name="checkmark" size={9} color="#fff" />
                </View>
                <Text style={pS.verifiedTxt}>Проверено JobToo</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Title */}
        <Text style={pS.jobTitle} numberOfLines={2}>{v.title}</Text>

        {/* Salary */}
        <View style={pS.salaryRow}>
          <Text style={pS.salaryMain}>{v.salary.toLocaleString('ru-RU')} ₽/мес</Text>
          <View style={pS.naRukiBadge}>
            <Text style={pS.naRukiTxt}>На руки</Text>
          </View>
        </View>

        {/* Metro + address */}
        {(v.metroStation || v.address) ? (
          <View style={pS.locationRow}>
            {v.metroStation ? (
              <View style={pS.locationItem}>
                <View style={[pS.metroCircle, { backgroundColor: metroLine?.color ?? Colors.primary }]}>
                  <Text style={pS.metroCircleTxt}>М</Text>
                </View>
                <Text style={pS.locationTxt} numberOfLines={1}>{v.metroStation}</Text>
              </View>
            ) : null}
            {v.address ? (
              <View style={pS.addressLocationItem}>
                <Ionicons name="location-outline" size={14} color={Colors.textMuted} />
                <Text style={pS.locationRowText} numberOfLines={2}>{v.address}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Раздел «Условия» */}
        {v.schedule ? (
          <View style={pS.section}>
            <Text style={pS.sectionHead}>Условия</Text>
            <View style={pS.sectionRow}>
              <Ionicons name="calendar-outline" size={14} color={Colors.textMuted} />
              <Text style={pS.sectionRowTxt}>{v.schedule}</Text>
            </View>
          </View>
        ) : null}

        {/* Раздел «Описание» с «Читать ещё» */}
        {v.description ? (
          <View style={pS.section}>
            <Text style={pS.sectionHead}>Описание</Text>
            <Text style={pS.desc} numberOfLines={expanded.has(v.id) ? undefined : 3}>{v.description}</Text>
            {v.description.length > 120 ? (
              <TouchableOpacity
                style={pS.readMore}
                onPress={(e) => { e.stopPropagation?.(); toggleExpanded(v.id); }}
                activeOpacity={0.7}
              >
                <Text style={pS.readMoreTxt}>{expanded.has(v.id) ? 'Свернуть' : 'Читать ещё'}</Text>
                <Ionicons name={expanded.has(v.id) ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.primary} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Views */}
        <View style={pS.viewsRow}>
          <Ionicons name="eye-outline" size={13} color={Colors.textMuted} />
          <Text style={pS.viewsTxt}>{permVacancyViewsMap[v.id] ?? 0} просмотрели</Text>
        </View>

        {/* Actions (в списках «Отклики»/«Избранное»). В колоде «Открытые» —
            отдельная карточка renderPermDeckCard со свайпом, как в сменах. */}
          <View style={pS.actionRow}>
            <TouchableOpacity
              style={[pS.applyBtn, isApplied && pS.applyBtnDone, isApplying && { opacity: 0.6 }]}
              onPress={(e) => { e.stopPropagation?.(); applyTo(v); }}
              disabled={isApplied || isApplying}
              activeOpacity={0.8}
            >
              <Text style={[pS.applyBtnTxt, isApplied && { color: Colors.green }]}>
                {isApplied ? '✓ Отклик отправлен' : 'Откликнуться'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[pS.actionIconBtn, chatLoading === v.id && { opacity: 0.5 }]}
              onPress={(e) => { e.stopPropagation?.(); openPermChat(v, displayCompany); }}
              disabled={chatLoading === v.id}
              activeOpacity={0.8}
            >
              {chatLoading === v.id
                ? <ActivityIndicator size={14} color={Colors.textSecondary} />
                : <Ionicons name="chatbubble-outline" size={17} color={Colors.textSecondary} />
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={pS.actionIconBtn}
              onPress={(e) => { e.stopPropagation?.(); shareVacancy(v); }}
              activeOpacity={0.8}
            >
              <Ionicons name="share-outline" size={17} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[pS.actionIconBtn, isSaved && pS.actionIconBtnSaved]}
              onPress={(e) => { e.stopPropagation?.(); toggleSaved(v); }}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isSaved ? 'heart' : 'heart-outline'}
                size={17}
                color={isSaved ? Colors.red : Colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
      </>
    );

    return (
      <TouchableOpacity
        style={pS.card}
        onPress={() => router.push({ pathname: '/perm-vacancy-detail', params: { vacancyId: v.id } })}
        activeOpacity={0.92}
      >
        {cardBody}
      </TouchableOpacity>
    );
  };

  const emptyMessages: Record<PermTab, { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; sub: string }> = {
    open:     { icon: 'search-outline', title: 'Нет открытых вакансий', sub: 'Попробуйте изменить фильтры' },
    applied:  { icon: 'paper-plane-outline', title: 'Нет откликов', sub: 'Откликайтесь на вакансии во вкладке «Открытые»' },
    saved:    { icon: 'heart-outline', title: 'Пока пусто', sub: 'Нажмите ♥ на вакансии — она сохранится здесь' },
  };

  // ── Свайп-колода для вкладки «Открытые» ────────────────────────────────────
  // Верхняя открытая вакансия — карточка, которую листают, как смены: вправо —
  // откликнуться, влево — пропустить. Поиск и вкладки «Отклики»/«Избранное»
  // остаются обычным списком. Карточку берём ту же (renderPerm), поэтому вид
  // один в один со списком, только сверху свайп-слой.
  // Порядок пролистанных карточек хранится в swHistory, чтобы кнопка
  // «назад» вернула последнюю карточку.
  // Колода-свайп для «Открытых» и «Избранного». «Отклики» остаются списком.
  const deckActive = tab === 'open' || tab === 'saved';
  const deckCards = deckActive ? shownVacancies.filter(v => !swSkipped.has(v.id)) : [];
  const swTop = deckCards[0];
  const swSnapBack = swDeck.snapBack;
  const swFly = swDeck.flyOut;

  const openPermDetail = (v: PermVacancy | ExternalVacancy) => {
    if (swDeck.wasSwipe()) return;
    if ('sourceId' in v) setPermExternalDetail(v as ExternalVacancy);
    else router.push({ pathname: '/perm-vacancy-detail', params: { vacancyId: v.id } });
  };
  // Вправо — принять: отклик (уходит в «Отклики» → матчи, ждёт ответа). В
  // «Избранном» вдобавок убираем из избранного. У партнёрских вакансий способ
  // отклика определяется режимом интеграции источника.
  const swWant = (vx = 0.5) => {
    const c = swTop;
    if (!c) return;
    if ('sourceId' in c) {
      swSnapBack();
      const external = c as ExternalVacancy;
      if (external.connectorKind === 'superjob') void prepareSuperJobApplication(external);
      else if (external.integrationMode === 'embedded') setPartnerConsentFor(external);
      else setExternalConfirm(external);
      return;
    }
    swFly('right', vx, () => {
      setSwSkipped(s => new Set(s).add(c.id));
      setSwHistory(h => [...h, c.id]);
      if (tab === 'saved' && permSavedIds.includes(c.id)) toggleSaved(c as PermVacancy);
      applyTo(c as PermVacancy);
    });
  };
  // Влево — отказ: листаем дальше. В «Избранном» отказ убирает из избранного.
  const swSkip = (vx = 0.5) => {
    const c = swTop;
    if (!c) return;
    // Гость: тот же лимит «отклонить», что и в сменах (счётчик общий).
    if (isGuest) {
      if (guestSkipCount >= GUEST_SKIP_LIMIT) { promptRegister({ vacancyKind: 'permanent' }); return; }
      guestSkipCount += 1;
    }
    swFly('left', vx, () => {
      setSwSkipped(s => new Set(s).add(c.id));
      setSwHistory(h => [...h, c.id]);
      if (tab === 'saved' && !('sourceId' in c) && permSavedIds.includes(c.id)) toggleSaved(c as PermVacancy);
    });
  };
  swWantRef.current = swWant;
  swSkipRef.current = swSkip;

  // Карточка колоды «Работа» — тот же макет, что у смены: рамка во весь экран,
  // чипы с иконками, снизу футер undo / ✕ / чат / ♥. Отличается только данными
  // (зарплата, график, описание вместо времени смены).
  const renderPermDeckCard = (v: PermVacancy | ExternalVacancy) => {
    const isExternal = 'sourceId' in v;
    const sourceName = isExternal ? (v as ExternalVacancy).sourceName : undefined;
    const displayCompany = isExternal ? (v.company ?? sourceName ?? 'Компания') : normalizeCompany(v.company);
    const salary = typeof v.salary === 'number' ? v.salary : 0;
    const schedule = isExternal ? v.schedule : (v as PermVacancy).schedule;
    const workTypeRaw = isExternal ? undefined : (v as PermVacancy).workType;
    // Профессия хранится кодом (stocker/cook/…) — показываем русское название.
    const workType = workTypeRaw ? (WORK_TYPE_META[workTypeRaw]?.label ?? workTypeRaw) : undefined;
    // Описание есть и у внешних (адаптер уже очистил его от HTML) — раньше здесь
    // стояла пустая строка, и партнёрская карточка выглядела пустой.
    const description = isExternal
      ? ((v as ExternalVacancy).description ?? '')
      : cleanDescription((v as PermVacancy).description);
    // У партнёрских дата публикации своя; если источник её не дал — строки
    // просто не будет, это честнее выдуманного «только что».
    const posted = agoRu(isExternal ? (v as ExternalVacancy).createdAt : (v as PermVacancy).createdAt);
    return (
      <View style={styles.cardArea}>
        {deckCards[2] ? <View style={styles.ghost2} /> : null}
        {deckCards[1] ? <View style={styles.ghost1} /> : null}
        {/* Потягивание вниз обновляет ленту. Список ровно по высоте карточки,
            прокручивать в нём нечего — он здесь только ради RefreshControl:
            внутри самой карточки прокрутки нет, и потянуть её нельзя.

            Со свайпом это не спорит: жест карточки срабатывает на восьми
            пикселях вбок, а на двадцати вниз проигрывает и отдаёт касание
            списку (см. failOffsetY в useSwipeDeck).

            «Призраки» колоды остались снаружи: они позиционированы абсолютно
            от области карточек, и внутри списка их отступы сложились бы с её
            внутренними полями. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        >
          <GestureDetector gesture={swDeck.gesture}>
            <Reanimated.View style={[styles.cardAnimated, swDeck.cardStyle]}>
              <View style={styles.card}>
                <Reanimated.View style={[styles.wantOverlay, swDeck.wantStyle]}>
                  <Text style={styles.wantText}>ОТКЛИК ♥</Text>
                </Reanimated.View>
                <Reanimated.View style={[styles.skipOverlay, swDeck.skipStyle]}>
                  <Text style={styles.skipText}>НЕТ ✕</Text>
                </Reanimated.View>

                {/* Как и в сменах: прокрутки внутри нет, весь текст — по
                    «Читать полностью». У своих вакансий это наш экран, у
                    партнёрских — окно с описанием источника и переходом к нему. */}
                <Pressable
                  style={styles.cardBody}
                  accessibilityRole="button"
                  accessibilityLabel="Открыть вакансию полностью"
                  onPress={() => openPermDetail(v)}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.companyRow}>
                      <CompanyMark company={v.company ?? sourceName} size={34} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.companyName} numberOfLines={1}>
                          {displayCompany}
                          {posted ? <Text style={styles.postedAgo}>{` · ${posted}`}</Text> : null}
                        </Text>
                      </View>
                      <SourceBadge partnerName={isExternal ? (sourceName ?? 'Партнёр') : undefined} />
                    </View>

                    {!isExternal ? (
                      <View style={pS.deckUtilityActions}>
                        <TouchableOpacity
                          accessibilityLabel="Поделиться вакансией"
                          style={pS.deckUtilityBtn}
                          onPress={() => { if (swDeck.wasSwipe()) return; void shareVacancy(v as PermVacancy); }}
                          activeOpacity={0.75}
                        >
                          <Ionicons name="share-outline" size={18} color={Colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          accessibilityLabel={permSavedIds.includes(v.id) ? 'Удалить из избранного' : 'Добавить в избранное'}
                          style={[pS.deckUtilityBtn, permSavedIds.includes(v.id) && pS.deckUtilityBtnSaved]}
                          onPress={() => { if (swDeck.wasSwipe()) return; toggleSaved(v as PermVacancy); }}
                          activeOpacity={0.75}
                        >
                          <Ionicons
                            name={permSavedIds.includes(v.id) ? 'heart' : 'heart-outline'}
                            size={18}
                            color={permSavedIds.includes(v.id) ? Colors.red : Colors.textSecondary}
                          />
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    <Text style={styles.jobTitle} numberOfLines={2}>{v.title}</Text>

                    <View style={styles.chipsRow}>
                      {salary > 0 ? <Chip label={`${salary.toLocaleString('ru-RU')} ₽/мес`} variant="salary" icon="wallet-outline" /> : null}
                      <Chip label="На руки" variant="neutral" icon="checkmark-circle-outline" />
                      {schedule ? <Chip label={schedule} variant="neutral" icon="calendar-outline" /> : null}
                      {workType ? <Chip label={workType} variant="neutral" icon="briefcase-outline" /> : null}
                      {v.metroStation ? <Chip label={v.metroStation} variant="neutral" icon="subway-outline" /> : null}
                      {v.address ? <Chip label={v.address} variant="neutral" icon="location-outline" /> : null}
                    </View>
                  </View>

                  <View style={styles.cardDivider} />

                  <View style={styles.cardMiddle}>
                    <View style={styles.cardSummary}>
                      {description ? <Text style={pS.desc} numberOfLines={4}>{description}</Text> : null}
                    </View>
                    <TouchableOpacity
                      style={styles.readFullRow}
                      onPress={() => openPermDetail(v)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.readFullTxt}>Читать полностью</Text>
                    </TouchableOpacity>
                  </View>
                </Pressable>
              </View>
            </Reanimated.View>
          </GestureDetector>
        </ScrollView>

        <View style={[styles.shiftDeckActions, { bottom: tabBarHeight + rs(18) }]} pointerEvents="box-none">
          <View style={styles.shiftDeckRow}>
          <TouchableOpacity
            accessibilityLabel="Отклонить вакансию"
            style={[styles.deckFloatingAction, styles.deckFloatingSkip]}
            onPress={() => swSkip(0.5)}
            activeOpacity={0.75}
          >
            <Ionicons name="close" size={34} color={Colors.red} />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityLabel={isExternal ? 'Открыть вакансию у источника' : 'Написать работодателю'}
            style={[styles.deckFloatingAction, styles.deckFloatingChat]}
            onPress={() => { if (isExternal) openExternalVacancy(v as ExternalVacancy); else openPermChat(v as PermVacancy, displayCompany); }}
            activeOpacity={0.75}
          >
            <Ionicons name="chatbubble-outline" size={24} color={Colors.blue} />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityLabel="Откликнуться на вакансию"
            style={[styles.deckFloatingAction, styles.deckFloatingWant]}
            onPress={() => swWant(0.5)}
            activeOpacity={0.75}
          >
            <Ionicons name="heart" size={31} color="#fff" />
          </TouchableOpacity>
          </View>
          <View style={styles.swipeHintRow}>
            <Ionicons name="arrow-undo-outline" size={20} color="#9AA3B2" />
            <Text style={styles.swipeHint}>Свайпай</Text>
            <Ionicons name="arrow-redo-outline" size={20} color="#9AA3B2" />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {externalVacanciesLoadFailed ? (
        <TouchableOpacity
          style={pS.offlineBar}
          onPress={() => void loadExternalVacancies(externalSelection)}
          activeOpacity={0.8}
        >
          <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
          <Text style={pS.offlineTxt}>
            Партнёрские вакансии не обновились — свои и ранее загруженные остаются доступны. Нажмите, чтобы повторить.
          </Text>
        </TouchableOpacity>
      ) : null}
      {filterStations.length > 0 ? (
        <TouchableOpacity style={pS.activeStationChip} onPress={() => setFilterStations([])} activeOpacity={0.8}>
          <Ionicons name="location" size={13} color={Colors.primary} />
          <Text style={pS.activeStationTxt}>
            {filterStations.length === 1 ? `м. ${filterStations[0]}` : `Станций: ${filterStations.length}`}
          </Text>
          <Ionicons name="close" size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      ) : null}

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

      {/* Tab chips + map filter */}
      <View style={pS.tabsBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={pS.tabChipsRow}
          style={pS.tabChipsScroll}
        >
          <TouchableOpacity
            style={[pS.tabChip, tab === 'saved' && pS.tabChipActive]}
            onPress={() => setTab(current => current === 'saved' ? 'open' : 'saved')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === 'saved' }}
            accessibilityLabel={tab === 'saved' ? 'Показать все вакансии' : 'Показать избранные вакансии'}
          >
            <Ionicons name="heart" size={15} color={Colors.red} />
            <Text style={[pS.tabChipTxt, tab === 'saved' && pS.tabChipTxtActive]}>
              Избранное
            </Text>
          </TouchableOpacity>
        </ScrollView>
        <TouchableOpacity
          style={[pS.filtersBtn, { marginLeft: rs(10) }, permFiltersActive ? pS.filtersBtnActive : null]}
          onPress={() => setPermFilterOpen(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="options-outline" size={16} color={permFiltersActive ? '#FFFFFF' : Colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={pS.filtersBtn}
          onPress={() => setMapOpen(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="map-outline" size={16} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {permFilterOpen && (
        <PermFilterSheet
          initial={permF}
          sourceOptions={permSourceOptions}
          countLocal={countPermLocal}
          countExternal={countExternalPerm}
          onApply={(f) => {
            setSearchText(f.query);
            setSearchIn(f.searchIn);
            setPosted(f.posted);
            setFilterStations(f.stations);
            setMinSalary(parseInt(f.salaryFrom || '0', 10) || 0);
            setSchedules(f.schedules);
            setFilterSources(f.sources);
          }}
          onClose={() => setPermFilterOpen(false)}
        />
      )}

      {deckActive ? (
        // «Открытые» и «Избранное» — свайп-колода (как в сменах и матчах).
        !swTop ? (
          // Пустое состояние делаем прокручиваемым, иначе «потяните вниз»
          // некуда тянуть — жест обновления не срабатывал (особенно офлайн).
          <ScrollView
            contentContainerStyle={[styles.emptyState, { flexGrow: 1 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
          >
            <Ionicons name={backendOffline ? 'cloud-offline-outline' : emptyMessages[tab].icon} size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{backendOffline ? 'Нет связи с сервером' : emptyMessages[tab].title}</Text>
            <Text style={styles.emptySubtitle}>{backendOffline ? 'Показаны последние данные. Потяните вниз, чтобы обновить.' : emptyMessages[tab].sub}</Text>
          </ScrollView>
        ) : (
          <>
            <PermDeckViewRecorder vacancy={swTop} userId={currentUser.id} isGuest={isGuest} />
            {renderPermDeckCard(swTop)}
          </>
        )
      ) : shownVacancies.length === 0 ? (
        <ScrollView
          contentContainerStyle={[styles.emptyState, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
        >
          <Ionicons name={backendOffline ? 'cloud-offline-outline' : emptyMessages[tab].icon} size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>{backendOffline ? 'Нет связи с сервером' : emptyMessages[tab].title}</Text>
          <Text style={styles.emptySubtitle}>{backendOffline ? 'Показаны последние данные. Потяните вниз, чтобы обновить.' : emptyMessages[tab].sub}</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={shownVacancies}
          keyExtractor={v => ('sourceId' in v ? `external:${v.id}` : v.id)}
          extraData={{ users, permVacancyViewsMap }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabBarHeight + 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
          renderItem={renderPerm}
          onViewableItemsChanged={onViewableItemsChanged.current}
          viewabilityConfig={viewabilityConfig.current}
        />
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

      <PartnerConsentSheet
        visible={!!partnerConsentFor}
        partnerName={partnerConsentFor?.sourceName ?? 'Партнёр'}
        companyName={partnerConsentFor?.company}
        onClose={() => setPartnerConsentFor(null)}
        onAccept={() => partnerConsentFor
          ? submitPartnerApplication(partnerConsentFor)
          : Promise.resolve()}
      />

      {/* Подключение показываем отдельным понятным шагом. После OAuth эта же
          вакансия автоматически продолжит отклик — повторный свайп не нужен. */}
      {superJobConnectFor ? (
        <View style={pS.confirmOverlay}>
          <View style={pS.confirmCard} accessibilityViewIsModal>
            <View style={pS.connectIcon}>
              <Ionicons name="link-outline" size={25} color={Colors.primary} />
            </View>
            <Text style={pS.confirmTitle}>Подключить SuperJob</Text>
            <Text style={pS.confirmVacancy} numberOfLines={2}>{superJobConnectFor.title}</Text>
            <Text style={pS.confirmHint}>
              Войдите в SuperJob один раз. После возврата JobToo автоматически продолжит этот отклик — повторно свайпать не придётся.
            </Text>
            <View style={pS.connectPrivacy}>
              <Ionicons name="shield-checkmark-outline" size={17} color={Colors.green} />
              <Text style={pS.connectPrivacyTxt}>Пароль остаётся в SuperJob и не передаётся JobToo</Text>
            </View>
            {superJobConnectError ? <Text style={pS.connectError}>{superJobConnectError}</Text> : null}
            <TouchableOpacity
              style={[pS.connectPrimary, superJobConnecting && pS.connectPrimaryDisabled]}
              onPress={() => void connectSuperJobAndContinue()}
              disabled={superJobConnecting}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Подключить SuperJob и продолжить отклик"
            >
              {superJobConnecting ? <ActivityIndicator size="small" color="#fff" /> : null}
              <Text style={pS.connectPrimaryTxt}>
                {superJobConnecting ? 'Подключаем…' : (superJobConnectError ? 'Попробовать снова' : 'Подключить и откликнуться')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={pS.connectLater}
              onPress={() => { if (!superJobConnecting) setSuperJobConnectFor(null); }}
              disabled={superJobConnecting}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Text style={pS.connectLaterTxt}>Не сейчас</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Плашка подтверждения перехода к партнёрской вакансии (свайп вправо). */}
      <ExternalVacancyDetail
        vacancy={permExternalDetail}
        onClose={() => setPermExternalDetail(null)}
        onOpenSource={(v: ExternalVacancy) => { setPermExternalDetail(null); void openExternalVacancy(v); }}
        locked={isGuest}
        onLogin={() => { setPermExternalDetail(null); promptRegister({ vacancyKind: 'external' }); }}
      />

      {externalConfirm ? (
        <View style={pS.confirmOverlay}>
          <View style={pS.confirmCard}>
            <Text style={pS.confirmTitle}>Открыть сайт вакансии?</Text>
            <Text style={pS.confirmVacancy} numberOfLines={2}>{externalConfirm.title}</Text>
            <Text style={pS.confirmHint}>
              Отклик на эту вакансию — на сайте источника ({externalConfirm.sourceName ?? 'партнёр'}).
            </Text>
            <View style={pS.confirmBtns}>
              <TouchableOpacity style={pS.confirmCancel} onPress={() => setExternalConfirm(null)} activeOpacity={0.8}>
                <Text style={pS.confirmCancelTxt}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={pS.confirmOpen}
                onPress={() => { const v = externalConfirm; setExternalConfirm(null); if (v) openExternalVacancy(v); }}
                activeOpacity={0.85}
              >
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={pS.confirmOpenTxt}>Открыть</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
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
  const { currentUser, vacancies, likes, permVacancies, permApplications, refreshVacancies, refreshPermVacancies, refreshPermApplications, refreshLikes, refreshAll, showToast, vacancyStatsMap, permVacancyViewsMap } = useApp();
  const tabBarHeight = useBottomTabBarHeight();
  const fabRef = useRef<View>(null);
  // Способ перемерить кнопку «+» по требованию: одного onLayout мало —
  // первый замер нередко приходит с нулями, и цель не регистрируется.
  const measureFab = useCallback(() => {
    fabRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setOnboardingTarget('fab', { x, y, w, h });
    });
  }, []);
  useEffect(() => registerOnboardingMeasurer('fab', measureFab), [measureFab]);
  const [mode, setMode] = useState<AppMode>('shift');
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  // Смена раздела — это переход в другое место, а не продолжение прежнего.
  // Раньше «Закрытые» тянулись из смен в постоянные вакансии, и человек
  // попадал сразу в архив вместо списка активных.
  const changeMode = (m: AppMode) => { setMode(m); setTab('active'); };
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [workerListModal, setWorkerListModal] = useState<{ vacId: string; type: 'applicants' | 'hired' | 'rejected' } | null>(null);
  const [viewersModal, setViewersModal] = useState<{ id: string; kind: 'shift' | 'perm' } | null>(null);
  const didAutoClose = useRef(false);
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set());
  const [closingPermIds, setClosingPermIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  // Отклики на постоянную вакансию — шторкой поверх списка, а не отдельным
  // экраном: директор смотрит их между делом и возвращается к вакансиям.
  const [appsVacancyId, setAppsVacancyId] = useState<string | null>(null);
  const [deletingPermIds, setDeletingPermIds] = useState<Set<string>>(new Set());
  const [deletedPermIds, setDeletedPermIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
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

  const shown = myVacancies.filter(v => {
    if (deletedIds.has(v.id)) return false;
    const isClosing = closingIds.has(v.id);
    if (tab === 'active') return !isClosing && v.status === 'open' && v.date >= todayISO;
    return isClosing || v.status === 'closed' || (v.status === 'open' && v.date < todayISO);
  });

  const shownPerm = myPermVacancies.filter(v => {
    if (deletedPermIds.has(v.id)) return false;
    const isClosing = closingPermIds.has(v.id);
    if (tab === 'active') return !isClosing && v.status === 'open';
    return isClosing || v.status === 'closed';
  });

  const applicantCount = (vacId: string) =>
    likes.filter(l => l.vacancyId === vacId && l.workerLiked && !l.isMatch && l.employerLiked !== false).length;
  const rejectedCount = (vacId: string) =>
    likes.filter(
      l => l.vacancyId === vacId && (
        l.employerLiked === false ||
        (l.workerLiked === false && l.workerSkipped === true)
      )
    ).length;

  const permApplicantCount = (vacId: string) =>
    permApplications.filter(a => a.vacancyId === vacId).length;

  const closeVacancy = async (id: string) => {
    if (closingIds.has(id)) return;
    setConfirmClose(null);
    setClosingIds(prev => new Set([...prev, id]));
    try {
      await dbUpdateVacancy(id, { status: 'closed' });
      // Успех показываем только после подтверждения сервера. closingIds
      // оставляем до refresh: если сам refresh сорвётся, уже закрытая на
      // сервере вакансия не должна на мгновение вернуться в «Активные».
      showToast('Вакансия закрыта', 'success');
      refreshVacancies().catch(() => {});
    } catch (e) {
      setClosingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast('Не удалось закрыть вакансию. Проверьте связь.', 'error');
      console.warn('[closeVacancy]', e);
    }
  };

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

  const deleteVacancy = async (id: string) => {
    if (deletingIds.has(id)) return;
    setConfirmDelete(null);
    setDeletingIds(prev => new Set([...prev, id]));
    try {
      await dbDeleteVacancy(id);
      // Строку прячем только после подтверждения сервера. До этого пользователь
      // видит прежнее состояние, а не ложный успешный результат.
      setDeletedIds(prev => new Set([...prev, id]));
      try {
        await refreshVacancies();
        showToast('Вакансия удалена', 'success');
      } catch {
        showToast('Вакансия удалена, но список не обновился. Потяните вниз.', 'info');
      }
    } catch (e) {
      showToast('Не удалось удалить вакансию. Проверьте связь.', 'error');
      console.warn('[deleteVacancy]', e);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
      <TabHeader tgAnchor />

      <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        <ModeSwitcher mode={mode} onChange={changeMode} />
      </View>

      <View style={styles.tabs}>
        {(['active', 'closed'] as const).map(t => (
          <TouchableOpacity key={t} style={styles.tabItem2} onPress={() => setTab(t)} activeOpacity={0.8}>
            <Text style={[styles.tabLabel2, tab === t && styles.tabLabelActive]}>{t === 'active' ? 'Активные' : 'Закрытые'}</Text>
            {tab === t ? <View style={styles.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabBarHeight + 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
        }
      >
        {mode === 'shift' ? (
          shown.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={52} color={Colors.textMuted} />
              {tab === 'active' ? (
                <>
                  <Text style={styles.emptyTitle}>Нет активных вакансий</Text>
                  <Text style={styles.emptySubtitle}>Создайте первую вакансию</Text>
                  <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/create-vacancy')}>
                    <Text style={styles.createBtnText}>+ Создать смену</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Нет закрытых вакансий</Text>
                  <Text style={styles.emptySubtitle}>Здесь появятся завершённые смены</Text>
                </>
              )}
            </View>
          ) : (
            shown.map(v => (
              <View key={v.id} style={styles.vacCard}>
                <View style={styles.vacTop}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {v.isUrgent ? <View style={styles.urgentBadge}><Ionicons name="flash" size={12} color="#D97706" /></View> : null}
                    <Text style={styles.vacTitle} numberOfLines={1}>{v.title}</Text>
                  </View>
                  <View style={styles.vacTopRight}>
                    <TouchableOpacity
                      style={[styles.editBtn, { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }]}
                      onPress={() => router.push({ pathname: '/create-vacancy', params: { copyId: v.id } })}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="repeat" size={16} color={Colors.green} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.editBtn}
                      onPress={() => router.push({ pathname: '/create-vacancy', params: { editId: v.id } })}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="create-outline" size={16} color={Colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editBtn, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}
                      onPress={() => tab === 'closed' ? setConfirmDelete(v.id) : setConfirmClose(v.id)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={Colors.red} />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.vacMeta}>м. {v.metroStation} · {formatDate(v.date)} · {v.timeStart}–{v.timeEnd}</Text>
                {v.address ? <Text style={styles.vacAddress}>{v.address}</Text> : null}

                <View style={styles.statsRow}>
                  {[
                    { num: applicantCount(v.id), label: 'Отклики', color: Colors.blue, onTap: () => setWorkerListModal({ vacId: v.id, type: 'applicants' }) },
                    { num: rejectedCount(v.id), label: 'Отклонено', color: Colors.red, onTap: () => setWorkerListModal({ vacId: v.id, type: 'rejected' }) },
                    { num: vacancyStatsMap[v.id]?.views ?? 0, label: 'Просмотрели', color: Colors.textMuted, onTap: () => setViewersModal({ id: v.id, kind: 'shift' }) },
                  ].map((s, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.statBox}
                      onPress={s.onTap}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.statNum, { color: s.color }]}>{s.num}</Text>
                      <Text style={styles.statLabel}>{s.label}</Text>
                      <Text style={styles.statTap}>↗</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.vacProgress}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, (v.workersFound / v.workersNeeded) * 100)}%` }]} />
                </View>
              </View>
            ))
          )
        ) : (
          shownPerm.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="briefcase-outline" size={52} color={Colors.textMuted} />
              {tab === 'active' ? (
                <>
                  <Text style={styles.emptyTitle}>Нет постоянных вакансий</Text>
                  <Text style={styles.emptySubtitle}>Создайте первую вакансию на постоянную работу</Text>
                  <TouchableOpacity style={[styles.createBtn, { borderColor: '#7C3AED' }]} onPress={() => router.push('/create-perm-vacancy')}>
                    <Text style={[styles.createBtnText, { color: '#7C3AED' }]}>+ Создать вакансию</Text>
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
        )}
      </ScrollView>

      {workerListModal ? (
        <WorkerListModal
          vacancyId={workerListModal.vacId}
          type={workerListModal.type}
          onClose={() => setWorkerListModal(null)}
        />
      ) : null}

      {viewersModal ? (
        <VacancyViewersModal
          vacancyId={viewersModal.id}
          kind={viewersModal.kind}
          onClose={() => setViewersModal(null)}
        />
      ) : null}

      {confirmClose ? (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Закрыть вакансию?</Text>
            <Text style={styles.confirmBody}>Вакансия будет перемещена в архив</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmClose(null)}><Text style={styles.cancelBtnText}>Отмена</Text></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={() => closeVacancy(confirmClose)}><Text style={styles.confirmBtnText}>Закрыть</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {confirmDelete ? (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Удалить вакансию?</Text>
            <Text style={styles.confirmBody}>Вакансия будет полностью удалена из истории</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmDelete(null)}><Text style={styles.cancelBtnText}>Отмена</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: '#EF4444' }]} onPress={() => deleteVacancy(confirmDelete)}><Text style={styles.confirmBtnText}>Удалить</Text></TouchableOpacity>
            </View>
          </View>
        </View>
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
      <TouchableOpacity
        ref={fabRef}
        onLayout={measureFab}
        style={[
          styles.fab,
          { bottom: tabBarHeight + 14, backgroundColor: mode === 'shift' ? Colors.primary : '#7C3AED' },
        ]}
        onPress={() => router.push(mode === 'shift' ? '/create-vacancy' : '/create-perm-vacancy')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────
// Worker Home (wrapper with mode switcher)
// ─────────────────────────────────────────────────
// Вкладка «Подработка» — только смены (свайп-лента). Переключатель
// Смены/Работа убран: постоянная работа теперь отдельная вкладка «Карьера».
// title='Подработка' убирает логотип JobToo и подписывает раздел.
function WorkerHome() {
  const { currentUser } = useApp();

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeader title="Подработка" tgAnchor />
      <WorkerFeed />
    </SafeAreaView>
  );
}

// Вкладка «Карьера» — постоянная работа (та же свайп-колода, что была под
// переключателем «Работа»).
function WorkerCareer() {
  const { currentUser } = useApp();
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const handleUndoChange = useCallback((action: (() => void) | null) => {
    setUndoAction(() => action);
  }, []);

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeader
        title="Работа"
        primaryAction={undoAction ? (
          <TouchableOpacity
            accessibilityLabel="Вернуть предыдущую вакансию"
            onPress={undoAction}
            activeOpacity={0.7}
            style={{ width: rs(30), height: rs(30), alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="arrow-undo-outline" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : undefined}
      />
      <WorkerPermMode onUndoChange={handleUndoChange} />
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
  return currentUser.role === 'worker' ? <WorkerHome /> : <EmployerHome />;
}

// Экран вкладки «Карьера». У работника — постоянная работа; у директора
// этой вкладки в меню нет, поэтому запасной вариант ведёт на его домашний
// экран (не отображается, но безопасен, если сюда как-то попасть).
export function CareerScreen() {
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
  filtersBtn: {
    width: rs(42), height: rs(42), alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(10),
    backgroundColor: Colors.bg,
  },
  filtersBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  activeStationChip: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6), alignSelf: 'flex-start',
    marginHorizontal: rs(16), marginBottom: rs(4),
    backgroundColor: Colors.primaryLight, borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(6),
  },
  activeStationTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },

  // — tab chips —
  tabsBar: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    paddingRight: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  offlineBar: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    backgroundColor: '#FEF3C7', paddingHorizontal: rs(14), paddingVertical: rs(8),
  },
  offlineTxt: { flex: 1, fontSize: rf(12), color: '#92400E', lineHeight: rf(16) },
  tabChipsScroll: {
    flex: 1, flexShrink: 1, alignSelf: 'stretch', minWidth: 0,
  },
  tabChipsRow: {
    flexDirection: 'row', gap: rs(6),
    paddingLeft: rs(12), paddingVertical: rs(10),
  },
  tabChip: {
    alignSelf: 'center', flexShrink: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(4),
    borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(8),
    borderWidth: 1.5, borderColor: Colors.inputBorder,
    backgroundColor: Colors.bg,
  },
  tabChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  tabChipTxt: { fontSize: rf(12.5), fontWeight: '500', color: Colors.textSecondary, flexShrink: 1 },
  tabChipTxtActive: { color: Colors.primary, fontWeight: '700' },
  deckUtilityActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: rs(8),
    marginTop: rs(-2),
  },
  deckUtilityBtn: {
    width: rs(38), height: rs(38), borderRadius: rs(12),
    borderWidth: 1, borderColor: Colors.divider, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  deckUtilityBtnSaved: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },

  // — card —
  card: {
    backgroundColor: Colors.bg, borderRadius: rs(18),
    padding: rs(16), gap: rs(10), ...Shadow.card,
  },
  externalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(10) },
  externalBadge: {
    maxWidth: rs(110), paddingHorizontal: rs(8), paddingVertical: rs(4),
    borderRadius: rs(100), backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.divider,
  },
  externalBadgeTxt: { fontSize: rf(11), fontWeight: '700', color: Colors.textMuted },
  externalAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: rs(5),
    paddingTop: rs(2),
  },
  externalActionTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },
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

  // desc
  desc: { fontSize: rf(13), color: Colors.textMuted, lineHeight: rf(19) },

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
  permVacCard: { borderLeftWidth: 3, borderLeftColor: '#7C3AED' },
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
  appStatNum: { fontSize: rf(20), fontWeight: '800', color: '#7C3AED' },
  appStatLabel: { fontSize: rf(12), color: '#7C3AED', flex: 1 },
  appStatArrow: { fontSize: rf(12), color: '#7C3AED', fontWeight: '600' },

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
  // Нижний резерв под плавающие кнопки + подсказку «Свайпай»: карточка кончается
  // выше, а в зазоре под ней стоят кнопки — как на референсе. Раньше было 96 и
  // кнопки жались к навбару, подсказка уходила под него.
  cardArea: { flex: 1, flexDirection: 'column', paddingHorizontal: rs(10), paddingTop: rs(10), paddingBottom: rs(164) },
  ghost1: { position: 'absolute', left: rs(10), right: rs(10), top: rs(10), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.xl, transform: [{ scale: 0.97 }, { translateY: 6 }], opacity: 0.5, zIndex: 0, ...Shadow.card },
  ghost2: { position: 'absolute', left: rs(10), right: rs(10), top: rs(10), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.xl, transform: [{ scale: 0.94 }, { translateY: 12 }], opacity: 0.3, zIndex: 0, ...Shadow.card },
  cardAnimated: { flex: 1, zIndex: 1, elevation: 10 },
  // Тело занимает карточку целиком, чтобы нажатие ловилось всюду, а не только
  // по ссылке «Читать полностью».
  cardBody: { flex: 1 },
  postedAgo: { fontWeight: '500', color: Colors.textMuted },
  readFullRow: { alignSelf: 'flex-start', paddingVertical: rs(6) },
  readFullTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.primary },
  card: { flex: 1, backgroundColor: Colors.bg, borderRadius: Radius.xl, ...Shadow.strong, overflow: 'hidden', borderWidth: 1, borderColor: Colors.inputBorder },
  wantOverlay: { position: 'absolute', top: rs(20), left: rs(20), zIndex: 10, backgroundColor: Colors.green, borderRadius: rs(10), paddingHorizontal: rs(14), paddingVertical: rs(8), transform: [{ rotate: '-10deg' }] },
  wantText: { color: '#fff', fontSize: rf(20), fontWeight: '800' },
  skipOverlay: { position: 'absolute', top: rs(20), right: rs(20), zIndex: 10, backgroundColor: Colors.red, borderRadius: rs(10), paddingHorizontal: rs(14), paddingVertical: rs(8), transform: [{ rotate: '10deg' }] },
  skipText: { color: '#fff', fontSize: rf(20), fontWeight: '800' },
  cardTop: { padding: rs(14), paddingBottom: rs(12), gap: rs(10) },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  avatar: { width: rs(44), height: rs(44), borderRadius: rs(22), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarImg: { width: rs(44), height: rs(44), borderRadius: rs(22), flexShrink: 0 },
  avatarText: { fontSize: rf(17), fontWeight: '700', color: '#fff' },
  companyName: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  metroHint: { fontSize: rf(12), color: Colors.textMuted },
  urgentTag: { flexDirection: 'row', alignItems: 'center', gap: rs(3), backgroundColor: '#FEF3C7', borderRadius: rs(8), paddingHorizontal: rs(8), paddingVertical: rs(4), flexShrink: 0 },
  urgentTagTxt: { fontSize: rf(11), fontWeight: '700', color: '#92400E' },
  cardBadges: { alignItems: 'flex-end', gap: rs(4), flexShrink: 0 },
  jtBadge: { backgroundColor: Colors.primaryLight, borderRadius: rs(8), paddingHorizontal: rs(8), paddingVertical: rs(4), flexShrink: 0 },
  jtBadgeTxt: { fontSize: rf(12.5) },
  jtBadgeB: { fontWeight: '800', color: Colors.textPrimary },
  jtBadgeO: { fontWeight: '800', color: Colors.primary },
  sourceBadge: { backgroundColor: '#EEF1F4', borderRadius: rs(8), paddingHorizontal: rs(8), paddingVertical: rs(4), maxWidth: rs(120), flexShrink: 0 },
  sourceBadgeTxt: { fontSize: rf(11), fontWeight: '700', color: Colors.textSecondary },
  metroHintRow: { flexDirection: 'row', alignItems: 'center', gap: rs(4), marginTop: rs(2) },
  jobTitle: { fontSize: rf(22), fontWeight: '800', color: Colors.textPrimary, lineHeight: rf(28) },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(6) },
  addressChip: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    backgroundColor: '#F3F4F6', borderRadius: rs(13), paddingHorizontal: rs(12), paddingVertical: rs(10),
  },
  addressChipIcon: { fontSize: rf(15), marginTop: rs(1) },
  addressChipText: { flex: 1, fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary, lineHeight: rf(20) },
  cardDivider: { height: 1, backgroundColor: Colors.divider, marginHorizontal: rs(14) },
  cardMiddle: { flex: 1, padding: rs(10), paddingHorizontal: rs(14), gap: rs(4) },
  // flexShrink, а не flex. С flex блок текста занимал всё свободное место и
  // прижимал «Читать полностью» к нижнему краю карточки — ровно туда, где над
  // карточкой висят кнопки ✕ / чат / ♥, и ссылка оказывалась под ними.
  // Теперь текст занимает свою высоту, ссылка идёт сразу за ним, а ужимается
  // текст только если места совсем мало.
  cardSummary: { flexShrink: 1, overflow: 'hidden' },
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
  deckFloatingWant: { width: rs(68), height: rs(68), borderRadius: rs(34), backgroundColor: Colors.primary, borderColor: Colors.primary },
  // Плавающие кнопки сменной колоды + подсказка «Свайпай» — как в «Работе» и на
  // образце. Колонка: ряд кнопок сверху, подсказка снизу, прижата к низу карточки.
  shiftDeckActions: {
    position: 'absolute', left: rs(24), right: rs(24), bottom: rs(28), zIndex: 20, elevation: 20,
    alignItems: 'center', gap: rs(10),
  },
  shiftDeckRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(30),
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
