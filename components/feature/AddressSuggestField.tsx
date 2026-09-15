import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, FlatList, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { dbAddressSuggest, AddressSuggestion } from '@/services/db';

import { rs, rf } from '@/constants/scale';

// Поле адреса с подсказками. Подсказки приходят с нашего сервера
// (jobtoo.ru/api → OpenStreetMap/Nominatim), поэтому не нужен ни ключ, ни WebView.
// Пользователь печатает/выбирает подсказку сверху, внизу — кнопка «Подтвердить».
// При выборе подсказки сохраняем координаты; при ручном вводе координат нет.
export function AddressSuggestField({
  value, onChange, placeholder, error,
}: {
  value: string;
  onChange: (address: string, lat: number | null, lng: number | null) => void;
  placeholder?: string;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  const openModal = () => {
    setQuery(value || '');
    setResults([]);
    setTouched(false);
    setSearchFailed(false);
    setPicked(null);
    setOpen(true);
  };

  const confirm = useCallback(() => {
    const addr = query.trim();
    if (!addr) return;
    // координаты берём, только если текст всё ещё совпадает с выбранной подсказкой
    const coordsOk = picked && picked.name === addr;
    onChange(addr, coordsOk ? picked!.lat : null, coordsOk ? picked!.lng : null);
    setOpen(false);
  }, [query, picked, onChange]);

  const onPick = (item: AddressSuggestion) => {
    setPicked(item);
    setQuery(item.name);
    setResults([]);        // список сворачиваем — адрес выбран
    setTouched(false);
  };

  const onType = (t: string) => {
    setQuery(t);
    setSearchFailed(false);
    if (picked && picked.name !== t) setPicked(null); // текст изменили — координаты сбрасываем
  };

  // Дебаунс + защита от устаревших ответов (гонки)
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    // если только что выбрали подсказку — не ищем снова
    if (q.length < 3 || (picked && picked.name === q)) {
      setResults([]);
      setLoading(false);
      setSearchFailed(false);
      return;
    }
    setLoading(true);
    setSearchFailed(false);
    const my = ++reqId.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await dbAddressSuggest(q);
        if (my !== reqId.current) return;
        setResults(r);
        setTouched(true);
      } catch {
        if (my !== reqId.current) return;
        setResults([]);
        setTouched(false);
        setSearchFailed(true);
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, open, picked, retrySeq]);

  const trimmed = query.trim();

  return (
    <>
      <TouchableOpacity
        style={[s.field, error ? s.fieldError : null]}
        onPress={openModal}
        activeOpacity={0.8}
      >
        <Ionicons name="location-outline" size={18} color={Colors.primary} style={{ marginRight: 8 }} />
        <Text style={[s.fieldTxt, !value ? s.placeholder : null]} numberOfLines={2}>
          {value || placeholder || 'Указать адрес'}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      </TouchableOpacity>

      <Modal statusBarTranslucent navigationBarTranslucent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <View style={s.header}>
            <Text style={s.title} numberOfLines={1}>Адрес</Text>
            <TouchableOpacity onPress={() => setOpen(false)} style={s.closeBtn} activeOpacity={0.8}>
              <Ionicons name="close" size={20} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={s.searchBox}>
              <Ionicons name="search" size={18} color={Colors.textMuted} />
              <TextInput
                style={s.searchInput}
                value={query}
                onChangeText={onType}
                placeholder="Начните вводить адрес…"
                placeholderTextColor={Colors.textMuted}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <TouchableOpacity onPress={() => { setQuery(''); setPicked(null); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>

            {picked && picked.name === trimmed ? (
              <View style={s.pickedRow}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.primary} />
                <Text style={s.pickedTxt}>Адрес найден на карте — координаты сохранятся</Text>
              </View>
            ) : null}

            <FlatList
              data={results}
              keyExtractor={(item, i) => item.name + '::' + i}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const short = item.name.split(',').slice(0, 2).join(',').trim();
                return (
                  <TouchableOpacity style={s.row} onPress={() => onPick(item)} activeOpacity={0.7}>
                    <Ionicons name="location-sharp" size={18} color={Colors.primary} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowHead}>{short}</Text>
                      <Text style={s.rowSub} numberOfLines={1}>{item.name}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListHeaderComponent={
                loading ? (
                  <View style={s.statusRow}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={s.statusTxt}>Ищем адрес…</Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                loading || (picked && picked.name === trimmed) ? null : searchFailed ? (
                  <View style={s.searchError}>
                    <Text style={s.hint}>Не удалось загрузить подсказки. Проверьте связь или подтвердите адрес как есть.</Text>
                    <TouchableOpacity onPress={() => setRetrySeq(x => x + 1)} activeOpacity={0.8}>
                      <Text style={s.retry}>Повторить</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={s.hint}>
                    {trimmed.length < 3
                      ? 'Введите улицу и дом — подскажем адрес'
                      : touched
                        ? 'Ничего не нашлось. Можно подтвердить адрес как есть.'
                        : 'Введите улицу и дом — подскажем адрес'}
                  </Text>
                )
              }
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}
              style={{ flex: 1 }}
            />

            <View style={s.footer}>
              <PrimaryButton label="Подтвердить" onPress={confirm} disabled={trimmed.length === 0} />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.divider,
    borderRadius: rs(12), paddingHorizontal: rs(14), paddingVertical: rs(14),
  },
  fieldError: { borderColor: '#E03A3A' },
  fieldTxt: { flex: 1, fontSize: rf(15), color: Colors.textPrimary },
  placeholder: { color: Colors.textMuted },
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingTop: rs(12), paddingBottom: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary, flex: 1 },
  closeBtn: {
    width: rs(36), height: rs(36), borderRadius: rs(18), alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.divider,
  },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.inputBorder,
    borderRadius: rs(12), paddingHorizontal: rs(12), paddingVertical: rs(10),
    marginHorizontal: rs(16), marginTop: rs(12), marginBottom: rs(6),
  },
  searchInput: { flex: 1, fontSize: rf(16), color: Colors.textPrimary, padding: 0 },
  pickedRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    paddingHorizontal: rs(18), paddingBottom: rs(6),
  },
  pickedTxt: { fontSize: rf(12.5), color: Colors.primary, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8), paddingVertical: rs(14) },
  statusTxt: { fontSize: rf(14), color: Colors.textMuted },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(12),
    paddingVertical: rs(12), borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  rowHead: { fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary },
  rowSub: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2) },
  hint: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', paddingVertical: rs(24), paddingHorizontal: rs(8) },
  searchError: { alignItems: 'center', paddingHorizontal: rs(8) },
  retry: { color: Colors.primary, fontSize: rf(14), fontWeight: '700', paddingVertical: rs(8), paddingHorizontal: rs(18) },
  footer: {
    paddingHorizontal: rs(16), paddingTop: rs(8), paddingBottom: rs(10),
    borderTopWidth: 1, borderTopColor: Colors.divider,
    backgroundColor: Colors.bg,
  },
});
