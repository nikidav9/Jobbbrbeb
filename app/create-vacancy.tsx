import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Switch, TextInput,
  KeyboardAvoidingView, Platform, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { MetroPicker } from '@/components/feature/MetroPicker';
import { AddressSuggestField } from '@/components/feature/AddressSuggestField';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO } from '@/services/storage';
import { dbUpsertVacancy, dbUpsertVacancyBatch } from '@/services/db';
import { notifyWorkersNewVacancy } from '@/services/notifications';
import { Vacancy, WorkType } from '@/constants/types';
import { METRO_LINES } from '@/constants/metro';
import { WorkTypeSelector, WORK_TYPE_META } from '@/components/feature/WorkTypeSelector';
import { TelegramLinkBanner } from '@/components/TelegramLinkBanner';
import { AutoRejectNotice } from '@/components/AutoRejectNotice';
import { Ionicons } from '@expo/vector-icons';

import { rs, rf } from '@/constants/scale';

function pad2(n: number) { return n.toString().padStart(2, '0'); }
function formatDisplayDate(d: Date) { return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`; }
function formatISODate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function formatTime(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function parseISOToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(); dt.setFullYear(y, m - 1, d); dt.setHours(0, 0, 0, 0); return dt;
}
function parseTimeToDate(time: string): Date {
  const [h, min] = time.split(':').map(Number);
  const d = new Date(); d.setHours(h, min, 0, 0); return d;
}
// Generate all dates in range [start, end] inclusive
function getDatesBetween(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const endCopy = new Date(end); endCopy.setHours(0, 0, 0, 0);
  while (cur <= endCopy) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
  return dates;
}

// Norm fields (stocker)
const NORM_FIELDS = [
  { key: 'sborka',     label: 'Сборка товара',          max: 20  },
  { key: 'razmTovara', label: 'Размещение товара',       max: 20  },
  { key: 'razmMaketa', label: 'Размещение маркета',      max: 20  },
  { key: 'razmMoroza', label: 'Размещение мороза',       max: 20  },
  { key: 'razmMulti',  label: 'Размещение многоштучки',  max: 20  },
  { key: 'npo',        label: 'НПО',                    max: 999 },
] as const;

type NormKey = typeof NORM_FIELDS[number]['key'];
type Norms = Record<NormKey, string>;
const DEFAULT_NORMS: Norms = { sborka: '', razmTovara: '', razmMaketa: '', razmMoroza: '', razmMulti: '', npo: '' };

// Разумные границы для «сколько выходит за смену»: ниже — похоже на опечатку
// в рублях за час, выше — на месячный оклад, вписанный не в то поле.
const PAY_MIN = 500;
const PAY_MAX = 15000;

function buildNormsText(address: string, norms: Norms): string {
  const lines = NORM_FIELDS.map(f => `— ${f.label}: ${norms[f.key] || '0'} ₽`).join('\n');
  return `📍 Адрес: ${address}\nНормативы:\n${lines}`;
}

/**
 * Обратный разбор: нормативы лежат в базе одной строкой, а форме нужны поля.
 *
 * Раньше это умело только «повторить смену», а правка — нет. Из-за этого
 * директор, который хотел сдвинуть смену на час, открывал форму с шестью
 * пустыми нормативами, и сохранить она не давала: «Проверьте нормативы».
 * Приходилось вбивать всё заново ради одной цифры времени.
 */
function parseNorms(text?: string | null): Norms | null {
  if (!text) return null;
  const next: Norms = { ...DEFAULT_NORMS };
  let found = false;
  for (const f of NORM_FIELDS) {
    const m = text.match(new RegExp(`— ${f.label}: ([0-9.]+)`));
    if (m) { next[f.key] = m[1]; found = true; }
  }
  return found ? next : null;
}

// Role-specific single norm configs
const ROLE_NORM: Record<string, { label: string; unit: string; hint: string; min: number; max: number; placeholder: string }> = {
  cook:             { label: 'Почасовая ставка',  unit: '₽/час',   hint: 'Диапазон: 1–999 ₽/час',              min: 1, max: 999,   placeholder: '250'  },
  shift_supervisor: { label: 'Оплата за смену',   unit: '₽/смену', hint: 'Укажите фиксированную оплату за смену', min: 1, max: 99999, placeholder: '3000' },
  picker:           { label: 'Сборка заказов',    unit: '₽/шт',    hint: 'За 1 позицию · диапазон: 1–99 ₽',    min: 1, max: 99,    placeholder: '5'    },
};

// Максимум дней в мультидневной публикации за один раз
const MAX_MULTI_DAYS = 14;

// И насколько далеко вперёд вообще можно ставить дату. Раньше границы не было:
// у выбора даты стоял только minimumDate, поэтому смену можно было выложить
// хоть на март следующего года. Так и появилась серия до 10 сентября.
// Тот же предел проверяется на сервере — форма живёт в приложении, а оно у
// людей на руках бывает старым.
const HORIZON_DAYS = 14;
function horizonDate() {
  const d = new Date();
  d.setDate(d.getDate() + HORIZON_DAYS);
  return d;
}

type PickerMode = 'date' | 'endDate' | 'timeStart' | 'timeEnd' | null;

export default function CreateVacancy() {
  const router = useRouter();
  const { editId, copyId } = useLocalSearchParams<{ editId?: string; copyId?: string }>();
  const { currentUser, vacancies, refreshVacancies, showToast, optimisticAddVacancy, optimisticUpdateVacancy } = useApp();

  const existing = editId ? vacancies.find(v => v.id === editId) : undefined;
  const isEdit = !!existing;
  // «Повторить смену»: копируем все поля из исходной, дата — завтра
  const source = !isEdit && copyId ? vacancies.find(v => v.id === copyId) : undefined;
  const isCopy = !!source;

  const [loadingInit, setLoadingInit] = useState(isEdit);
  const [selectedWorkType, setSelectedWorkType] = useState<WorkType>(existing?.workType ?? 'stocker');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [metroLineId, setMetroLineId] = useState('');
  const [metroLineName, setMetroLineName] = useState('');
  const [metroStation, setMetroStation] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(new Date());
  const [selectedTimeStart, setSelectedTimeStart] = useState<Date>(() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; });
  const [selectedTimeEnd, setSelectedTimeEnd] = useState<Date>(() => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; });
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [norms, setNorms] = useState<Norms>(DEFAULT_NORMS);
  // Сколько выходит за смену. У кладовщика оплата сдельная, и в карточке до
  // сих пор стояло «оплата сдельная, нормативы в карточке» — человек должен
  // был сам сложить расценки и угадать выработку. Девять смен из одиннадцати
  // висели без единой цифры; двое из десяти опрошенных назвали причиной
  // именно оплату. Директор эту цифру знает, работник — нет.
  const [shiftPay, setShiftPay] = useState(existing?.salary ? String(existing.salary) : '');
  const [workersNeeded, setWorkersNeeded] = useState(1);
  const [isUrgent, setIsUrgent] = useState(false);
  const [noExp, setNoExp] = useState(true);
  const [metroPicker, setMetroPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fixedSalary, setFixedSalary] = useState(existing?.salary ? String(existing.salary) : '');
  const [saving, setSaving] = useState(false);
  // Multi-day toggle (disabled in edit mode)
  const [multiDay, setMultiDay] = useState(false);

  useEffect(() => {
    if (!existing) { setLoadingInit(false); return; }
    setSelectedWorkType(existing.workType ?? 'stocker');
    setAddress(existing.address ?? '');
    setLat(existing.lat ?? null);
    setLng(existing.lng ?? null);
    setMetroLineId(existing.metroLineId ?? '');
    setMetroStation(existing.metroStation ?? '');
    const ln = METRO_LINES.find(l => l.id === existing.metroLineId);
    setMetroLineName(ln?.name ?? '');
    if (existing.date) setSelectedDate(parseISOToDate(existing.date));
    if (existing.timeStart) setSelectedTimeStart(parseTimeToDate(existing.timeStart));
    if (existing.timeEnd) setSelectedTimeEnd(parseTimeToDate(existing.timeEnd));
    setWorkersNeeded(existing.workersNeeded);
    setIsUrgent(existing.isUrgent);
    setNoExp(existing.noExperienceNeeded);
    // Нормативы и оплата. Их восстановление тут и пропустили.
    const parsed = parseNorms(existing.normsAndPay);
    if (parsed) setNorms(parsed);
    // Ставим и здесь, а не только в начальном значении поля: список смен
    // может подъехать из сети уже после того, как экран отрисовался, и тогда
    // начальное значение успело посчитаться от пустоты.
    if (existing.salary) {
      setShiftPay(String(existing.salary));
      setFixedSalary(String(existing.salary));
    }
    setLoadingInit(false);
  }, [existing?.id]);

  useEffect(() => {
    if (!source) return;
    setSelectedWorkType(source.workType ?? 'stocker');
    setAddress(source.address ?? '');
    setLat(source.lat ?? null);
    setLng(source.lng ?? null);
    setMetroLineId(source.metroLineId ?? '');
    setMetroStation(source.metroStation ?? '');
    const ln = METRO_LINES.find(l => l.id === source.metroLineId);
    setMetroLineName(ln?.name ?? '');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    setSelectedDate(tomorrow);
    setSelectedEndDate(tomorrow);
    if (source.timeStart) setSelectedTimeStart(parseTimeToDate(source.timeStart));
    if (source.timeEnd) setSelectedTimeEnd(parseTimeToDate(source.timeEnd));
    setWorkersNeeded(source.workersNeeded);
    setIsUrgent(source.isUrgent);
    setNoExp(source.noExperienceNeeded);
    if (source.salary) { setFixedSalary(String(source.salary)); setShiftPay(String(source.salary)); }
    const parsed = parseNorms(source.normsAndPay);
    if (parsed) setNorms(parsed);
  }, [source?.id]);

  const line = METRO_LINES.find(l => l.id === metroLineId);

  const openPicker = (mode: PickerMode) => {
    if (!mode) return;
    const dateVal = mode === 'date' ? selectedDate
      : mode === 'endDate' ? selectedEndDate
      : mode === 'timeStart' ? selectedTimeStart
      : selectedTimeEnd;
    setTempDate(dateVal);
    if (Platform.OS === 'ios') { setPickerMode(mode); setIosPickerVisible(true); }
    else setPickerMode(mode);
  };

  const onAndroidChange = (event: DateTimePickerEvent, date?: Date) => {
    setPickerMode(null);
    if (event.type === 'dismissed' || !date) return;
    applyDate(pickerMode, date);
  };

  const onIOSChange = (_: DateTimePickerEvent, date?: Date) => { if (date) setTempDate(date); };
  const confirmIOS = () => { applyDate(pickerMode, tempDate); setIosPickerVisible(false); setPickerMode(null); };

  const applyDate = (mode: PickerMode, date: Date) => {
    if (mode === 'date') {
      setSelectedDate(date);
      if (date > selectedEndDate) setSelectedEndDate(date);
    } else if (mode === 'endDate') {
      setSelectedEndDate(date);
    } else if (mode === 'timeStart') {
      setSelectedTimeStart(date);
    } else if (mode === 'timeEnd') {
      setSelectedTimeEnd(date);
    }
  };

  const pickerDateValue =
    pickerMode === 'date' ? (Platform.OS === 'ios' ? tempDate : selectedDate)
    : pickerMode === 'endDate' ? (Platform.OS === 'ios' ? tempDate : selectedEndDate)
    : pickerMode === 'timeStart' ? (Platform.OS === 'ios' ? tempDate : selectedTimeStart)
    : (Platform.OS === 'ios' ? tempDate : selectedTimeEnd);

  const setNormVal = (key: NormKey, val: string) => {
    const normalized = val.replace(',', '.');
    const cleaned = normalized.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
    setNorms(prev => ({ ...prev, [key]: sanitized }));
  };

  const normFieldValid = (key: NormKey): boolean => {
    const field = NORM_FIELDS.find(f => f.key === key)!;
    const v = norms[key];
    if (v === '') return false;
    const num = parseFloat(v);
    return !isNaN(num) && num >= 0 && num <= field.max;
  };

  const normsValid = NORM_FIELDS.every(f => normFieldValid(f.key));

  const isStorcker = selectedWorkType === 'stocker';
  const meta = WORK_TYPE_META[selectedWorkType];
  const roleNorm = ROLE_NORM[selectedWorkType];

  const validate = () => {
    const e: Record<string, string> = {};
    if (!address.trim()) e.address = 'Введите адрес';
    if (!metroStation) e.metro = 'Выберите станцию метро';
    if (isStorcker) {
      if (!normsValid) e.norms = 'Проверьте нормативы (0–20 ₽, НПО: 1–999)';
      const pay = parseFloat(shiftPay);
      if (isNaN(pay) || pay < PAY_MIN || pay > PAY_MAX) {
        e.pay = `Укажите, сколько примерно выходит за смену: от ${PAY_MIN} до ${PAY_MAX} ₽`;
      }
    } else {
      const val = parseFloat(fixedSalary);
      if (isNaN(val) || val < roleNorm.min || val > roleNorm.max) {
        e.salary = `Введите значение от ${roleNorm.min} до ${roleNorm.max}`;
      }
    }
    if (!isEdit && multiDay) {
      const n = getDatesBetween(selectedDate, selectedEndDate).length;
      if (n > MAX_MULTI_DAYS) e.multiDay = `Максимум ${MAX_MULTI_DAYS} дней за одну публикацию`;
    }
    // Календарь дальше горизонта уже не пускает, но дата могла прийти из
    // «повторить смену» или из правки старой записи.
    const last = !isEdit && multiDay ? selectedEndDate : selectedDate;
    if (formatISODate(last) > formatISODate(horizonDate())) {
      e.multiDay = `Смену можно выложить не дальше чем на ${HORIZON_DAYS} дней вперёд`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Wraps any upsert with a 15 s timeout so the save button never spins forever.
  const upsertWithTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error('Превышено время ожидания. Проверьте интернет.')), 15000)
      ),
    ]);

  const submit = async () => {
    if (!validate() || !currentUser || saving) return;
    setSaving(true);
    const normsAndPay = isStorcker
      ? buildNormsText(address, norms)
      : `📍 Адрес: ${address}\nНормативы:\n— ${roleNorm.label}: ${fixedSalary} ${roleNorm.unit}`;
    const base = {
      employerId: existing?.employerId ?? currentUser.id,
      company: existing?.company ?? (currentUser.company ?? `${currentUser.firstName} ${currentUser.lastName}`),
      title: meta.label,
      workType: selectedWorkType,
      workTypeLabel: meta.label,
      metroLineId,
      metroStation,
      address,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      timeStart: formatTime(selectedTimeStart),
      timeEnd: formatTime(selectedTimeEnd),
      salary: isStorcker ? parseFloat(shiftPay) : parseFloat(fixedSalary),
      normsAndPay,
      workersNeeded,
      isUrgent,
      noExperienceNeeded: noExp,
      conditions: normsAndPay,
    };

    try {
      if (isEdit && existing) {
        if (existing.employerId !== currentUser.id) {
          showToast('Нет прав для редактирования этой вакансии', 'error');
          setSaving(false);
          return;
        }
        const vac: Vacancy = {
          ...base,
          id: existing.id,
          date: formatISODate(selectedDate),
          workersFound: existing.workersFound,
          status: existing.status,
          createdAt: existing.createdAt,
        };
        await upsertWithTimeout(dbUpsertVacancy(vac));
        optimisticUpdateVacancy(vac);
        showToast('Вакансия обновлена', 'success');
      } else if (multiDay) {
        const dates = getDatesBetween(selectedDate, selectedEndDate);
        if (dates.length > MAX_MULTI_DAYS) {
          showToast(`Максимум ${MAX_MULTI_DAYS} дней за одну публикацию`, 'error');
          setSaving(false);
          return;
        }
        const vacs: Vacancy[] = dates.map(d => ({
          ...base,
          id: uid(),
          date: formatISODate(d),
          workersFound: 0,
          status: 'open' as const,
          createdAt: nowISO(),
        }));
        await upsertWithTimeout(dbUpsertVacancyBatch(vacs));
        vacs.forEach(v => optimisticAddVacancy(v));
        if (metroStation) {
          void notifyWorkersNewVacancy({
            metroStation, title: meta.label, company: base.company, type: 'shift',
            workType: base.workType,
            date: vacs[0]?.date, daysCount: vacs.length, vacancyId: vacs[0]?.id,
            timeStart: base.timeStart, timeEnd: base.timeEnd, salary: base.salary,
            estimated: isStorcker,
          }).then(ok => {
            if (!ok) showToast('Вакансия опубликована, но рассылку не удалось отправить. Вакансия остаётся доступна в ленте.', 'error');
          });
        }
        showToast(`Опубликовано ${dates.length} вакансий`, 'success');
      } else {
        const vac: Vacancy = {
          ...base,
          id: uid(),
          date: formatISODate(selectedDate),
          workersFound: 0,
          status: 'open',
          createdAt: nowISO(),
        };
        await upsertWithTimeout(dbUpsertVacancy(vac));
        optimisticAddVacancy(vac);
        if (metroStation) {
          void notifyWorkersNewVacancy({
            metroStation, title: meta.label, company: base.company, type: 'shift',
            workType: base.workType,
            date: vac.date, vacancyId: vac.id, timeStart: base.timeStart, timeEnd: base.timeEnd, salary: base.salary,
            estimated: isStorcker,
          }).then(ok => {
            if (!ok) showToast('Вакансия опубликована, но рассылку не удалось отправить. Вакансия остаётся доступна в ленте.', 'error');
          });
        }
        showToast('Вакансия опубликована', 'success');
      }
      router.back();
      refreshVacancies().catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Ошибка: ${msg}`, 'error');
      console.error('[CreateVacancy] submit error', e);
      setSaving(false);
    }
  };

  // Days preview for multi-day
  const daysInRange = multiDay ? getDatesBetween(selectedDate, selectedEndDate) : [];

  if (loadingInit) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Редактировать' : isCopy ? 'Повтор смены' : 'Новая вакансия'}</Text>
        <View style={{ width: 70 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TelegramLinkBanner />
          <AutoRejectNotice />

          {/* Work type */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Специальность *</Text>
            <WorkTypeSelector selected={[selectedWorkType]} onToggle={t => setSelectedWorkType(t)} />
          </View>

          {/* Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Адрес *</Text>
            <AddressSuggestField
              value={address}
              error={!!errors.address}
              placeholder="ул. Складская, д. 5, Москва"
              onChange={(addr, la, ln) => { setAddress(addr); setLat(la); setLng(ln); }}
            />
            {errors.address ? <Text style={styles.errMsg}>{errors.address}</Text> : null}
          </View>

          {/* Metro */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Метро *</Text>
            {metroStation ? (
              <View style={styles.metroSelected}>
                <View style={[styles.dot, { backgroundColor: line?.color ?? Colors.blue }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.metroLineTxt}>{metroLineName}</Text>
                  <Text style={styles.metroStTxt}>{metroStation}</Text>
                </View>
                <TouchableOpacity onPress={() => setMetroPicker(true)}>
                  <Text style={styles.changeLink}>Изменить</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.metroField} onPress={() => setMetroPicker(true)}>
                <Text style={styles.metroFieldTxt}>🚇 Выбрать станцию</Text>
                <Text style={{ color: Colors.textMuted, fontSize: rf(20) }}>›</Text>
              </TouchableOpacity>
            )}
            {errors.metro ? <Text style={styles.errMsg}>{errors.metro}</Text> : null}
            <MetroPicker
              visible={metroPicker}
              onClose={() => setMetroPicker(false)}
              onSelect={(lid, lname, st) => { setMetroLineId(lid); setMetroLineName(lname); setMetroStation(st); setMetroPicker(false); }}
              selectedLineId={metroLineId}
              selectedStation={metroStation}
            />
          </View>

          {/* Date / Multi-day */}
          <View style={styles.fieldGroup}>
            {!isEdit ? (
              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.sectionLabel}>Несколько дней</Text>
                  <Text style={styles.normHint}>Создать вакансии на каждый день</Text>
                </View>
                <Switch
                  value={multiDay}
                  onValueChange={v => setMultiDay(v)}
                  trackColor={{ false: Colors.inputBorder, true: Colors.primary }}
                  thumbColor="#fff"
                />
              </View>
            ) : null}

            {Platform.OS === 'web' ? (
              <View style={styles.pickerField}>
                <Ionicons name="calendar-outline" size={18} color={Colors.textMuted} />
                {/* @ts-ignore */}
                <input type="date" value={formatISODate(selectedDate)} min={formatISODate(new Date())} max={formatISODate(horizonDate())}
                  onChange={(e: any) => e.target.value && applyDate('date', parseISOToDate(e.target.value))}
                  style={{ flex: 1, border: 'none', background: 'transparent', fontSize: rf(16), color: '#111111', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }} />
              </View>
            ) : (
              <TouchableOpacity style={styles.pickerField} onPress={() => openPicker('date')} activeOpacity={0.8}>
                <Ionicons name="calendar-outline" size={18} color={Colors.textMuted} />
                <Text style={styles.pickerValue}>{multiDay ? `С ${formatDisplayDate(selectedDate)}` : formatDisplayDate(selectedDate)}</Text>
                <Text style={styles.pickerArrow}>›</Text>
              </TouchableOpacity>
            )}
            {Platform.OS === 'android' && pickerMode === 'date' ? (
              <DateTimePicker value={selectedDate} mode="date" display="calendar" minimumDate={new Date()} maximumDate={horizonDate()} onChange={onAndroidChange} />
            ) : null}

            {multiDay ? (
              <>
                {Platform.OS === 'web' ? (
                  <View style={styles.pickerField}>
                    <Ionicons name="calendar-outline" size={18} color={Colors.textMuted} />
                    {/* @ts-ignore */}
                    <input type="date" value={formatISODate(selectedEndDate)} min={formatISODate(selectedDate)} max={formatISODate(horizonDate())}
                      onChange={(e: any) => e.target.value && applyDate('endDate', parseISOToDate(e.target.value))}
                      style={{ flex: 1, border: 'none', background: 'transparent', fontSize: rf(16), color: '#111111', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }} />
                  </View>
                ) : (
                  <TouchableOpacity style={styles.pickerField} onPress={() => openPicker('endDate')} activeOpacity={0.8}>
                    <Ionicons name="calendar-outline" size={18} color={Colors.textMuted} />
                    <Text style={styles.pickerValue}>По {formatDisplayDate(selectedEndDate)}</Text>
                    <Text style={styles.pickerArrow}>›</Text>
                  </TouchableOpacity>
                )}
                {Platform.OS === 'android' && pickerMode === 'endDate' ? (
                  <DateTimePicker value={selectedEndDate} mode="date" display="calendar" minimumDate={selectedDate} maximumDate={horizonDate()} onChange={onAndroidChange} />
                ) : null}

                {daysInRange.length > 0 ? (
                  <View style={styles.daysPreview}>
                    <Text style={styles.daysPreviewTitle}>
                      Будет создано {daysInRange.length} {daysInRange.length === 1 ? 'вакансия' : daysInRange.length < 5 ? 'вакансии' : 'вакансий'}:
                    </Text>
                    <Text style={styles.daysPreviewDates}>
                      {daysInRange.map(d => `${d.getDate()}.${pad2(d.getMonth() + 1)}`).join(' · ')}
                    </Text>
                  </View>
                ) : null}
                {daysInRange.length > MAX_MULTI_DAYS ? (
                  <Text style={styles.errMsg}>Максимум {MAX_MULTI_DAYS} дней за одну публикацию — сократите период</Text>
                ) : errors.multiDay ? (
                  <Text style={styles.errMsg}>{errors.multiDay}</Text>
                ) : null}
              </>
            ) : null}
          </View>

          {/* Time */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Время смены</Text>
            {Platform.OS === 'web' ? (
              <View style={styles.timeRow}>
                <View style={[styles.pickerField, { flex: 1 }]}>
                  <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
                  {/* @ts-ignore */}
                  <input type="time" value={formatTime(selectedTimeStart)}
                    onChange={(e: any) => e.target.value && applyDate('timeStart', parseTimeToDate(e.target.value))}
                    style={{ flex: 1, border: 'none', background: 'transparent', fontSize: rf(16), color: '#111111', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }} />
                </View>
                <Text style={styles.timeSep}>–</Text>
                <View style={[styles.pickerField, { flex: 1 }]}>
                  <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
                  {/* @ts-ignore */}
                  <input type="time" value={formatTime(selectedTimeEnd)}
                    onChange={(e: any) => e.target.value && applyDate('timeEnd', parseTimeToDate(e.target.value))}
                    style={{ flex: 1, border: 'none', background: 'transparent', fontSize: rf(16), color: '#111111', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }} />
                </View>
              </View>
            ) : (
              <>
                <View style={styles.timeRow}>
                  <TouchableOpacity style={[styles.pickerField, { flex: 1 }]} onPress={() => openPicker('timeStart')} activeOpacity={0.8}>
                    <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
                    <Text style={styles.pickerValue}>{formatTime(selectedTimeStart)}</Text>
                  </TouchableOpacity>
                  <Text style={styles.timeSep}>–</Text>
                  <TouchableOpacity style={[styles.pickerField, { flex: 1 }]} onPress={() => openPicker('timeEnd')} activeOpacity={0.8}>
                    <Ionicons name="time-outline" size={18} color={Colors.textMuted} />
                    <Text style={styles.pickerValue}>{formatTime(selectedTimeEnd)}</Text>
                  </TouchableOpacity>
                </View>
                {Platform.OS === 'android' && pickerMode === 'timeStart' ? (
                  <DateTimePicker value={selectedTimeStart} mode="time" display="spinner" is24Hour onChange={onAndroidChange} />
                ) : null}
                {Platform.OS === 'android' && pickerMode === 'timeEnd' ? (
                  <DateTimePicker value={selectedTimeEnd} mode="time" display="spinner" is24Hour onChange={onAndroidChange} />
                ) : null}
              </>
            )}
          </View>

          {/* Norms (stocker) / Salary (other) */}
          {isStorcker ? (
            <View style={styles.fieldGroup}>
              <Text style={styles.sectionLabel}>Нормативы (₽ за единицу) *</Text>
              <Text style={styles.normHint}>Сборка/размещение: 0–20 ₽ (дробные значения допустимы) · НПО: 1–999</Text>
              {errors.norms ? <Text style={styles.errMsg}>{errors.norms}</Text> : null}
              {NORM_FIELDS.map(f => {
                const v = norms[f.key];
                const num = parseFloat(v);
                const invalid = v !== '' && (isNaN(num) || num < 0 || num > f.max);
                return (
                  <View key={f.key} style={styles.normRow}>
                    <Text style={styles.normLabel}>{f.label}</Text>
                    <TextInput
                      style={[styles.normInput, invalid ? styles.inputError : null]}
                      value={v}
                      onChangeText={val => setNormVal(f.key, val)}
                      placeholder={f.key === 'npo' ? '1' : '0'}
                      keyboardType="decimal-pad"
                      placeholderTextColor={Colors.textMuted}
                    />
                    <Text style={styles.normUnit}>₽</Text>
                  </View>
                );
              })}

              <Text style={[styles.sectionLabel, { marginTop: rs(16) }]}>Сколько выходит за смену *</Text>
              <Text style={styles.normHint}>
                Сколько обычно выходит на руки за смену. Работник увидит её со знаком
                «примерно» и с пояснением, что оплата сдельная, — обещанием это не станет.
                Без суммы в объявлении стоит «оплата сдельная», и на такое не откликаются.
              </Text>
              {errors.pay ? <Text style={styles.errMsg}>{errors.pay}</Text> : null}
              <View style={styles.normRow}>
                <Text style={styles.normLabel}>Примерно за смену</Text>
                <TextInput
                  style={[styles.normInput, errors.pay ? styles.inputError : null]}
                  value={shiftPay}
                  onChangeText={setShiftPay}
                  placeholder="3000"
                  keyboardType="number-pad"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.normUnit}>₽</Text>
              </View>
            </View>
          ) : (
            <View style={styles.fieldGroup}>
              <Text style={styles.sectionLabel}>Нормативы *</Text>
              <Text style={styles.normHint}>{roleNorm.hint}</Text>
              {errors.salary ? <Text style={styles.errMsg}>{errors.salary}</Text> : null}
              <View style={styles.normRow}>
                <Text style={styles.normLabel}>{roleNorm.label}</Text>
                <TextInput
                  style={[styles.normInput, errors.salary ? styles.inputError : null]}
                  value={fixedSalary}
                  onChangeText={setFixedSalary}
                  placeholder={roleNorm.placeholder}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.normUnit}>{roleNorm.unit}</Text>
              </View>
            </View>
          )}

          {/* Workers needed */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Количество мест{multiDay ? ' (на каждый день)' : ''}</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setWorkersNeeded(n => Math.max(1, n - 1))}>
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepNum}>{workersNeeded}</Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setWorkersNeeded(n => n + 1)}>
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>🔥 Срочная вакансия</Text>
            <Switch value={isUrgent} onValueChange={setIsUrgent} trackColor={{ false: Colors.inputBorder, true: Colors.primary }} thumbColor="#fff" />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>🎓 Опыт не требуется</Text>
            <Switch value={noExp} onValueChange={setNoExp} trackColor={{ false: Colors.inputBorder, true: Colors.primary }} thumbColor="#fff" />
          </View>

          {/* Preview */}
          {address.trim() ? (
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Предпросмотр описания</Text>
              <Text style={styles.previewText}>{buildNormsText(address, norms)}</Text>
            </View>
          ) : null}

          <View style={{ marginBottom: 40 }}>
            <TouchableOpacity
              style={[styles.submitBtn, (saving || daysInRange.length > MAX_MULTI_DAYS) && { opacity: 0.6 }]}
              onPress={submit}
              disabled={saving || daysInRange.length > MAX_MULTI_DAYS}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnTxt}>
                  {isEdit ? 'Сохранить изменения'
                    : multiDay ? `Опубликовать ${daysInRange.length} вакансий`
                    : 'Опубликовать вакансию'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* iOS date/time picker modal */}
      {Platform.OS === 'ios' ? (
        <Modal statusBarTranslucent navigationBarTranslucent visible={iosPickerVisible} transparent animationType="slide">
          <View style={styles.iosOverlay}>
            <View style={styles.iosSheet}>
              <View style={styles.iosSheetHeader}>
                <TouchableOpacity onPress={() => { setIosPickerVisible(false); setPickerMode(null); }}>
                  <Text style={styles.iosCancelText}>Отмена</Text>
                </TouchableOpacity>
                <Text style={styles.iosSheetTitle}>
                  {pickerMode === 'date' ? (multiDay ? 'Начало периода' : 'Дата смены')
                    : pickerMode === 'endDate' ? 'Конец периода'
                    : pickerMode === 'timeStart' ? 'Начало смены'
                    : 'Конец смены'}
                </Text>
                <TouchableOpacity onPress={confirmIOS}>
                  <Text style={styles.iosDoneText}>Готово</Text>
                </TouchableOpacity>
              </View>
              {pickerMode ? (
                <View style={styles.iosPickerWrap}>
                  <DateTimePicker
                    value={pickerDateValue ?? new Date()}
                    mode={pickerMode === 'date' || pickerMode === 'endDate' ? 'date' : 'time'}
                    display="spinner"
                    is24Hour
                    minimumDate={pickerMode === 'date' ? new Date() : pickerMode === 'endDate' ? selectedDate : undefined}
                    maximumDate={pickerMode === 'date' || pickerMode === 'endDate' ? horizonDate() : undefined}
                    onChange={onIOSChange}
                    style={styles.iosPicker}
                    textColor="#111111"
                  />
                </View>
              ) : null}
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(14),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  backText: { fontSize: rf(15), color: Colors.textSecondary, fontWeight: '500' },
  headerTitle: { fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  body: { padding: rs(20), gap: rs(18), paddingBottom: rs(20) },
  typeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeLabel: { fontSize: rf(13), color: Colors.textMuted, fontWeight: '500' },
  typeBadge: { backgroundColor: Colors.primaryLight, borderRadius: rs(100), paddingHorizontal: rs(14), paddingVertical: rs(6) },
  typeBadgeText: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },
  fieldGroup: { gap: rs(8) },
  sectionLabel: { fontSize: rf(13), color: Colors.textMuted, fontWeight: '600' },
  normHint: { fontSize: rf(11), color: Colors.textMuted, lineHeight: rf(16) },
  errMsg: { color: Colors.red, fontSize: rf(12) },
  input: {
    borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(12),
    paddingHorizontal: rs(14), paddingVertical: rs(13),
    fontSize: rf(15), color: Colors.textPrimary, backgroundColor: Colors.bg,
  },
  inputError: { borderColor: Colors.red },
  metroField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(12), padding: rs(16),
  },
  metroFieldTxt: { fontSize: rf(15), color: Colors.textPrimary },
  metroSelected: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: rs(12), padding: rs(14),
    backgroundColor: Colors.primaryLight,
  },
  dot: { width: rs(12), height: rs(12), borderRadius: rs(6) },
  metroLineTxt: { fontSize: rf(11), color: Colors.textMuted },
  metroStTxt: { fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary, marginTop: rs(2) },
  changeLink: { color: Colors.primary, fontSize: rf(13), fontWeight: '600' },
  pickerField: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(12),
    paddingHorizontal: rs(16), paddingVertical: rs(14), backgroundColor: Colors.bg,
  },
  pickerIcon: { fontSize: rf(18) },
  pickerValue: { flex: 1, fontSize: rf(16), fontWeight: '600', color: Colors.textPrimary },
  pickerArrow: { fontSize: rf(20), color: Colors.textMuted },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  timeSep: { fontSize: rf(20), color: Colors.textMuted, fontWeight: '600', paddingBottom: rs(4) },
  daysPreview: { backgroundColor: Colors.primaryLight, borderRadius: rs(12), padding: rs(12), gap: rs(4) },
  daysPreviewTitle: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },
  daysPreviewDates: { fontSize: rf(12), color: Colors.primary, lineHeight: rf(18) },
  normRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    paddingVertical: rs(10), borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  normLabel: { flex: 1, fontSize: rf(14), color: Colors.textPrimary },
  normInput: {
    width: rs(72), borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(8),
    paddingHorizontal: rs(10), paddingVertical: rs(8),
    fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary, textAlign: 'center',
  },
  normUnit: { fontSize: rf(14), color: Colors.textMuted, width: rs(16) },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: rs(20) },
  stepBtn: {
    width: rs(44), height: rs(44), borderRadius: rs(100), backgroundColor: Colors.surface,
    borderWidth: 1.5, borderColor: Colors.inputBorder, alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { fontSize: rf(22), color: Colors.textPrimary, fontWeight: '600' },
  stepNum: { fontSize: rf(22), fontWeight: '800', color: Colors.textPrimary, minWidth: rs(32), textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: rs(12), borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  toggleLabel: { fontSize: rf(15), fontWeight: '500', color: Colors.textPrimary },
  previewBox: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: rs(14), borderWidth: 1, borderColor: Colors.inputBorder,
  },
  previewTitle: { fontSize: rf(12), color: Colors.textMuted, fontWeight: '600', marginBottom: rs(8) },
  previewText: { fontSize: rf(13), color: Colors.textPrimary, lineHeight: rf(20) },
  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: rs(100),
    paddingVertical: rs(16), alignItems: 'center',
  },
  submitBtnTxt: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  iosOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  iosSheet: { backgroundColor: Colors.bg, borderTopLeftRadius: rs(20), borderTopRightRadius: rs(20), paddingBottom: rs(32) },
  iosPickerWrap: { backgroundColor: '#FFFFFF', width: '100%' },
  iosPicker: { width: '100%', height: rs(200), backgroundColor: '#FFFFFF' },
  iosSheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(20), paddingVertical: rs(16),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  iosSheetTitle: { fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  iosCancelText: { fontSize: rf(15), color: Colors.textSecondary, fontWeight: '500' },
  iosDoneText: { fontSize: rf(15), color: Colors.primary, fontWeight: '700' },
});
