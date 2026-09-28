import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { patchPersonal } from '@/lib/profileEdit';
import { METRO_LINES } from '@/constants/metro';
import type { MetroStationChoice } from '@/constants/types';
import {
  EditScreen, FieldLabel, useUnsavedGuard, PinIcon, SearchIcon, CloseIcon,
} from '@/components/profile/edit';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';

const MAX_STATIONS = 3;

/** Крупные города РФ по населению, Москва первой — `personal/15-city-metro.html`. */
const CITIES = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань',
  'Нижний Новгород', 'Челябинск', 'Красноярск', 'Самара', 'Уфа',
  'Ростов-на-Дону', 'Краснодар', 'Омск', 'Воронеж', 'Пермь',
  'Волгоград', 'Саратов', 'Тюмень', 'Тольятти', 'Махачкала',
  'Барнаул', 'Ижевск', 'Ульяновск', 'Иркутск', 'Хабаровск',
  'Ярославль', 'Владивосток', 'Томск', 'Оренбург', 'Кемерово',
  'Новокузнецк', 'Рязань', 'Набережные Челны', 'Астрахань', 'Пенза',
  'Липецк', 'Киров', 'Чебоксары', 'Балашиха', 'Калининград',
  'Тула', 'Курск', 'Севастополь', 'Ставрополь', 'Улан-Удэ',
  'Сочи', 'Тверь', 'Магнитогорск', 'Иваново', 'Брянск',
  'Белгород', 'Сургут', 'Владимир', 'Нижний Тагил', 'Архангельск',
  'Чита', 'Калуга', 'Смоленск', 'Волжский', 'Череповец',
  'Вологда', 'Саранск', 'Якутск', 'Орёл', 'Подольск',
];

/** Без регистра и ё/е — для поиска города и станции метро. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е');
}

type StationOption = { station: string; lineId: string; lineName: string; lineColor: string };

/** Одна строка на каждую линию, где есть станция. */
const ALL_STATIONS: StationOption[] = METRO_LINES.flatMap((line) => (
  line.stations.map((station) => ({
    station, lineId: line.id, lineName: line.name, lineColor: line.color,
  }))
));

function lineById(lineId?: string) {
  return METRO_LINES.find((l) => l.id === lineId);
}

function sameStations(a: MetroStationChoice[], b: MetroStationChoice[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.station === b[i].station && s.lineId === b[i].lineId);
}

/**
 * Город и метро — `personal/15-city-metro.html`. Метро доступно только для
 * Москвы, до 3 станций; поиск по всем линиям `constants/metro.ts`.
 */
export default function CityMetroScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);

  const initial = useMemo(() => {
    const personal = currentUser?.personalDetails;
    const location = personal?.location || currentUser?.resume?.city || (currentUser?.metroStation ? 'Москва' : '');
    let metroStations: MetroStationChoice[] = personal?.metroStations ?? [];
    if (metroStations.length === 0 && currentUser?.metroStation) {
      metroStations = [{ station: currentUser.metroStation, lineId: currentUser.metroLineId }];
    }
    return { location, metroStations };
  }, [currentUser]);

  const [location, setLocation] = useState(initial.location);
  const [stations, setStations] = useState<MetroStationChoice[]>(initial.metroStations);
  const [metroQuery, setMetroQuery] = useState('');

  const isMoscow = normalize(location) === 'москва';
  const effectiveStations = isMoscow ? stations : [];

  const dirty = location !== initial.location
    || !sameStations(effectiveStations, initial.metroStations);

  const citySuggestions = useMemo(() => {
    const q = normalize(location);
    if (!q) return [];
    return CITIES.filter((c) => normalize(c) !== q && normalize(c).includes(q)).slice(0, 8);
  }, [location]);

  const selectCity = (city: string) => {
    setLocation(city);
    if (normalize(city) !== 'москва') setStations([]);
  };

  const clearCity = () => {
    setLocation('');
    setStations([]);
  };

  const metroFull = stations.length >= MAX_STATIONS;

  const metroSuggestions = useMemo(() => {
    const q = normalize(metroQuery);
    if (!q || metroFull) return [];
    return ALL_STATIONS.filter((opt) => (
      normalize(opt.station).includes(q)
      && !stations.some((s) => s.station === opt.station && s.lineId === opt.lineId)
    )).slice(0, 30);
  }, [metroQuery, metroFull, stations]);

  const addStation = (opt: StationOption) => {
    if (metroFull) return;
    setStations([...stations, { station: opt.station, lineId: opt.lineId }]);
    setMetroQuery('');
  };

  const removeStation = (index: number) => {
    setStations(stations.filter((_, i) => i !== index));
  };

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, {
        location: location || undefined,
        metroStations: effectiveStations,
      }));
      showToast('Сохранено');
      return true;
    } catch {
      showToast('Не удалось сохранить. Попробуйте ещё раз', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const { requestClose, dialog, leave } = useUnsavedGuard({ dirty, onSave: save });

  if (!currentUser) return null;

  return (
    <>
      <EditScreen
        title="Город и метро"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <View style={{ gap: 8 }}>
          <FieldLabel label="Город" />
          <View style={[s.cityBox, location.length > 0 && s.cityBoxFilled]}>
            <PinIcon size={20} />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Укажите город"
              placeholderTextColor={EditColors.placeholder}
              accessibilityLabel="Город"
              style={s.cityInput}
            />
            {location.length > 0 ? (
              <TouchableOpacity
                onPress={clearCity}
                style={s.clearBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Очистить"
              >
                <CloseIcon size={12} />
              </TouchableOpacity>
            ) : null}
          </View>

          {citySuggestions.length > 0 ? (
            <View style={s.citySuggestCard}>
              {citySuggestions.map((city, i) => (
                <TouchableOpacity
                  key={city}
                  style={[s.citySuggestRow, i === citySuggestions.length - 1 && s.rowLast]}
                  activeOpacity={0.7}
                  onPress={() => selectCity(city)}
                >
                  <Text style={s.citySuggestText}>{city}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        {isMoscow ? (
          <View style={{ gap: 8 }}>
            <Text style={s.metroLabel}>
              Метро <Text style={s.metroLabelHint}>· до {MAX_STATIONS} станций</Text>
            </Text>
            <View style={[s.metroBox, metroFull && s.metroBoxDisabled]}>
              <SearchIcon size={20} color={metroFull ? EditColors.textTertiary : EditColors.ink} />
              <TextInput
                value={metroQuery}
                onChangeText={setMetroQuery}
                editable={!metroFull}
                placeholder={metroFull ? 'Уберите станцию, чтобы добавить другую' : 'Найти станцию'}
                placeholderTextColor={EditColors.placeholder}
                accessibilityLabel="Найти станцию метро"
                style={[s.metroInput, metroFull && s.metroInputDisabled]}
              />
            </View>

            {metroSuggestions.length > 0 ? (
              <View style={s.metroCard}>
                {metroSuggestions.map((opt, i) => (
                  <TouchableOpacity
                    key={`${opt.lineId}-${opt.station}`}
                    style={[s.stationRow, i === metroSuggestions.length - 1 && s.rowLast]}
                    activeOpacity={0.7}
                    onPress={() => addStation(opt)}
                  >
                    <View style={[s.dot, { backgroundColor: opt.lineColor }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.stationName}>{opt.station}</Text>
                      <Text style={s.stationLine}>{opt.lineName}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {stations.length > 0 ? (
              <View style={s.metroCard}>
                {stations.map((st, i) => {
                  const line = lineById(st.lineId);
                  return (
                    <View
                      key={`${st.lineId}-${st.station}`}
                      style={[s.stationRow, i === stations.length - 1 && s.rowLast]}
                    >
                      <View style={[s.dot, { backgroundColor: line?.color ?? EditColors.border }]} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.stationName}>{st.station}</Text>
                        {line ? <Text style={s.stationLine}>{line.name}</Text> : null}
                      </View>
                      <TouchableOpacity
                        onPress={() => removeStation(i)}
                        style={s.removeBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Убрать станцию: ${st.station}`}
                      >
                        <CloseIcon size={10} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  cityBox: {
    height: 56, borderRadius: EditRadius.field, paddingLeft: 16, paddingRight: 8,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  cityBoxFilled: { borderWidth: 2, borderColor: EditColors.ink },
  cityInput: {
    flex: 1, minWidth: 0, fontFamily: EditFonts.text700, fontSize: 16, color: EditColors.ink, padding: 0,
  },
  clearBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: EditColors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  citySuggestCard: {
    borderRadius: EditRadius.card, backgroundColor: EditColors.surface, paddingHorizontal: 16,
  },
  citySuggestRow: {
    height: 52, justifyContent: 'center', borderBottomWidth: 1.5, borderBottomColor: EditColors.fieldDisabledBg,
  },
  citySuggestText: { fontFamily: EditFonts.text600, fontSize: 16, color: EditColors.ink },
  rowLast: { borderBottomWidth: 0 },

  metroLabel: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.label },
  metroLabelHint: { fontFamily: EditFonts.text600, color: EditColors.textTertiary },
  metroBox: {
    height: 56, borderRadius: EditRadius.field, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  metroBoxDisabled: { backgroundColor: EditColors.fieldDisabledBg, borderColor: EditColors.borderSoft },
  metroInput: {
    flex: 1, minWidth: 0, fontFamily: EditFonts.text600, fontSize: 16, color: EditColors.ink, padding: 0,
  },
  metroInputDisabled: { color: EditColors.textTertiary },

  metroCard: {
    borderRadius: 22, backgroundColor: EditColors.surface, paddingHorizontal: 16,
  },
  stationRow: {
    height: 60, flexDirection: 'row', alignItems: 'center', gap: 12,
    borderBottomWidth: 1.5, borderBottomColor: EditColors.fieldDisabledBg,
  },
  dot: { width: 14, height: 14, borderRadius: 7, flexShrink: 0 },
  stationName: { fontFamily: EditFonts.text700, fontSize: 16, color: EditColors.ink },
  stationLine: { fontFamily: EditFonts.text600, fontSize: 12, color: EditColors.textTertiary },
  removeBtn: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: EditColors.bg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
});
