import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { METRO_LINES } from '@/constants/metro';
import { rs, rf } from '@/constants/scale';
import { BackButton, BACK_BUTTON_SIZE } from '@/components/ui/BackButton';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (lineId: string, lineName: string, station: string) => void;
  selectedLineId?: string;
  selectedStation?: string;
}

type FlatStation = { station: string; lineId: string; lineName: string; lineColor: string };
const ALL_STATIONS: FlatStation[] = METRO_LINES.flatMap(l =>
  l.stations.map(st => ({ station: st, lineId: l.id, lineName: l.name, lineColor: l.color }))
).sort((a, b) => a.station.localeCompare(b.station, 'ru'));

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function MetroPicker({ visible, onClose, onSelect, selectedLineId, selectedStation }: Props) {
  const [draft, setDraft] = useState<FlatStation | null>(null);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState<(typeof METRO_LINES)[number] | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    const current = selectedStation
      ? ALL_STATIONS.find(s => s.station === selectedStation && (!selectedLineId || s.lineId === selectedLineId)) ?? null
      : null;
    setDraft(current);
    setQuery('');
    setLine(null);
  }, [visible, selectedLineId, selectedStation]);

  const q = norm(query);
  const searchResults = useMemo(() => {
    if (!q) return [];
    return ALL_STATIONS.filter(s => norm(s.station).includes(q));
  }, [q]);

  if (!visible) return null;

  const Check = ({ on }: { on: boolean }) => (
    <View style={[styles.check, on && styles.checkOn]}>
      {on ? <Ionicons name="checkmark" size={rf(14)} color="#fff" /> : null}
    </View>
  );

  const choose = (station: FlatStation) => setDraft(station);

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            {line ? (
              <BackButton onPress={() => setLine(null)} />
            ) : <View style={{ width: BACK_BUTTON_SIZE }} />}
            <Text style={styles.title} numberOfLines={1}>{line ? line.name : 'Метро'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={{ width: BACK_BUTTON_SIZE, alignItems: 'center' }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={rf(16)} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
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
              renderItem={({ item }) => {
                const on = draft?.station === item.station && draft?.lineId === item.lineId;
                return (
                  <TouchableOpacity style={[styles.card, on && styles.cardOn]} onPress={() => choose(item)} activeOpacity={0.8}>
                    <View style={[styles.dot, { backgroundColor: item.lineColor }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.station}</Text>
                      <Text style={styles.sub}>{item.lineName}</Text>
                    </View>
                    <Check on={on} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTxt}>Станция не найдена</Text></View>}
            />
          ) : line ? (
            <FlatList
              data={line.stations}
              keyExtractor={(st, i) => `${st}-${i}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const on = draft?.station === item && draft?.lineId === line.id;
                return (
                  <TouchableOpacity
                    style={[styles.card, on && styles.cardOn]}
                    onPress={() => choose({ station: item, lineId: line.id, lineName: line.name, lineColor: line.color })}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.dot, { backgroundColor: line.color }]} />
                    <Text style={[styles.name, { flex: 1 }]}>{item}</Text>
                    <Check on={on} />
                  </TouchableOpacity>
                );
              }}
            />
          ) : (
            <FlatList
              data={METRO_LINES}
              keyExtractor={l => l.id}
              renderItem={({ item }) => {
                const on = draft?.lineId === item.id;
                return (
                  <TouchableOpacity style={[styles.card, on && styles.cardOn]} onPress={() => setLine(item)} activeOpacity={0.8}>
                    <View style={[styles.bar, { backgroundColor: item.color }]} />
                    <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
                    {on ? <Text style={styles.badge}>1</Text> : null}
                    <Ionicons name="chevron-forward" size={rf(18)} color={Colors.textMuted} />
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <View style={[styles.footer, { paddingBottom: insets.bottom + rs(16) }]}>
            <TouchableOpacity
              style={styles.save}
              onPress={() => {
                if (draft) onSelect(draft.lineId, draft.lineName, draft.station);
                else onSelect('', '', '');
                onClose();
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.saveTxt}>Сохранить{draft ? ' · 1' : ''}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reset} onPress={() => setDraft(null)} activeOpacity={0.85}>
              <Text style={styles.resetTxt}>Сбросить</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: rs(24), borderTopRightRadius: rs(24),
    maxHeight: '90%', minHeight: '72%', overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingTop: rs(16), paddingBottom: rs(8),
  },
  title: { flex: 1, textAlign: 'center', fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
  close: { fontSize: rf(18), color: Colors.textMuted, width: rs(22), textAlign: 'right' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    marginHorizontal: rs(16), marginVertical: rs(10),
    backgroundColor: Colors.surface, borderRadius: rs(12),
    paddingHorizontal: rs(12), paddingVertical: rs(10),
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  searchInput: { flex: 1, fontSize: rf(15), color: Colors.textPrimary, padding: 0 },
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
  empty: { padding: rs(24), alignItems: 'center' },
  emptyTxt: { fontSize: rf(14), color: Colors.textMuted },
});
