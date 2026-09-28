import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import type { ResumeExperience } from '@/constants/types';
import { patchResume, upsertAt, removeAt, MONTHS } from '@/lib/profileEdit';
import {
  EditScreen, Field, TextArea, OptionSheet, Checkbox, InfoNote, FieldLabel,
  useUnsavedGuard, ChevronDownIcon,
} from '@/components/profile/edit';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';

/** Разбирает «Август 2022» → { month: 'Август', year: '2022' }. Не парсится — пустые поля. */
function parsePeriod(value: string | undefined): { month: string; year: string } {
  const match = value?.trim().match(/^(\S+)\s+(\d{4})$/);
  if (!match) return { month: '', year: '' };
  const month = MONTHS.find((m) => m.toLowerCase() === match[1].toLowerCase()) ?? '';
  return month ? { month, year: match[2] } : { month: '', year: '' };
}

function formatPeriod(month: string, year: string): string {
  return month && year ? `${month} ${year}` : '';
}

type PickerState = { target: 'start' | 'end'; step: 'month' | 'year' } | null;

/**
 * `resume/02-work-place.html` — карандаш у записи опыта работы и «+ Добавить
 * место работы». `index` в `resume.experience` — редактирование, без него —
 * новая запись.
 */
export default function WorkPlaceScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const params = useLocalSearchParams<{ index?: string }>();

  const experienceList = currentUser?.resume?.experience ?? [];
  const idx = params.index !== undefined ? Number(params.index) : undefined;
  const existing: ResumeExperience | undefined = idx !== undefined && !Number.isNaN(idx)
    ? experienceList[idx]
    : undefined;
  const isNew = !existing;

  const initialStart = useMemo(() => parsePeriod(existing?.start), [existing]);
  const initialEnd = useMemo(() => parsePeriod(existing?.end), [existing]);
  const initialCurrent = existing?.current ?? false;
  const initialPosition = existing?.position ?? '';
  const initialCompany = existing?.company ?? '';
  const initialDescription = existing?.description ?? '';

  const [position, setPosition] = useState(initialPosition);
  const [company, setCompany] = useState(initialCompany);
  const [startMonth, setStartMonth] = useState(initialStart.month);
  const [startYear, setStartYear] = useState(initialStart.year);
  const [endMonth, setEndMonth] = useState(initialEnd.month);
  const [endYear, setEndYear] = useState(initialEnd.year);
  const [current, setCurrent] = useState(initialCurrent);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1960 + 1 }, (_, i) => String(currentYear - i));
  }, []);

  const startFilled = !!startMonth && !!startYear;
  const endFilled = current || (!!endMonth && !!endYear);
  const periodOrderValid = (() => {
    if (!startFilled || current || !endFilled) return true;
    const startIndex = MONTHS.indexOf(startMonth) + Number(startYear) * 12;
    const endIndex = MONTHS.indexOf(endMonth) + Number(endYear) * 12;
    return endIndex >= startIndex;
  })();

  const dirty = position !== initialPosition
    || company !== initialCompany
    || startMonth !== initialStart.month
    || startYear !== initialStart.year
    || endMonth !== initialEnd.month
    || endYear !== initialEnd.year
    || current !== initialCurrent
    || description !== initialDescription;

  const valid = position.trim().length > 0
    && company.trim().length > 0
    && startFilled
    && endFilled
    && periodOrderValid;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      const item: ResumeExperience = {
        position: position.trim(),
        company: company.trim(),
        start: formatPeriod(startMonth, startYear),
        end: current ? 'Сейчас' : formatPeriod(endMonth, endYear),
        current,
        ...(existing?.duration ? { duration: existing.duration } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      await updateUser(patchResume(currentUser, { experience: upsertAt(experienceList, idx, item) }));
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

  const openPeriod = (target: 'start' | 'end') => {
    if (target === 'end' && current) return;
    setPicker({ target, step: 'month' });
  };

  const handleDelete = async () => {
    if (!currentUser || idx === undefined) return;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { experience: removeAt(experienceList, idx) }));
      showToast('Удалено');
      leave();
    } catch {
      showToast('Не удалось удалить. Попробуйте ещё раз', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!currentUser) return null;

  const pickerTitle = picker
    ? `${picker.target === 'start' ? 'Начало' : 'Окончание'} — ${picker.step === 'month' ? 'месяц' : 'год'}`
    : '';
  const pickerOptions = picker
    ? (picker.step === 'month'
      ? MONTHS.map((m) => ({ label: m, value: m }))
      : years.map((y) => ({ label: y, value: y })))
    : [];
  const pickerSelected = picker
    ? (picker.step === 'month'
      ? (picker.target === 'start' ? startMonth : endMonth)
      : (picker.target === 'start' ? startYear : endYear))
    : undefined;

  const handlePickerSelect = (value: string) => {
    if (!picker) return;
    if (picker.step === 'month') {
      if (picker.target === 'start') setStartMonth(value); else setEndMonth(value);
      setPicker({ target: picker.target, step: 'year' });
    } else {
      if (picker.target === 'start') setStartYear(value); else setEndYear(value);
      setPicker(null);
    }
  };

  return (
    <>
      <EditScreen
        title="Место работы"
        onBack={requestClose}
        onDelete={isNew ? undefined : handleDelete}
        primaryLabel={isNew ? 'Добавить' : 'Сохранить'}
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <Field label="Должность" value={position} onChangeText={setPosition} placeholder="Например, Супервайзер" />
        <Field label="Компания" value={company} onChangeText={setCompany} placeholder="Название компании" />

        <View style={{ gap: 8 }}>
          <FieldLabel label="Период работы" />
          <View style={s.periodRow}>
            <PeriodButton
              caption="Начало"
              value={formatPeriod(startMonth, startYear)}
              onPress={() => openPeriod('start')}
            />
            <PeriodButton
              caption="Окончание"
              value={current ? 'Сейчас' : formatPeriod(endMonth, endYear)}
              disabled={current}
              onPress={() => openPeriod('end')}
            />
          </View>
          {!periodOrderValid ? <Text style={s.error}>Окончание не может быть раньше начала</Text> : null}
          <Checkbox
            label="Работаю здесь сейчас"
            checked={current}
            onToggle={() => {
              const next = !current;
              setCurrent(next);
              if (next) {
                setEndMonth('');
                setEndYear('');
              }
            }}
          />
        </View>

        <TextArea
          label="Обязанности и достижения"
          value={description}
          onChangeText={setDescription}
          maxLength={2000}
          placeholder="Чем занимались и каких результатов добились. Например: сократил время обработки заказа на 15%"
        />

        <InfoNote>
          Этот же экран открывается по кнопке «+ Добавить место работы» — тогда поля пустые, а «Удалить» скрыто
        </InfoNote>
      </EditScreen>
      {dialog}
      <OptionSheet
        visible={!!picker}
        title={pickerTitle}
        options={pickerOptions}
        selected={pickerSelected}
        onSelect={handlePickerSelect}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

function PeriodButton({
  caption, value, disabled, onPress,
}: {
  caption: string;
  value: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const filled = !!value && !disabled;
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={disabled}
      onPress={onPress}
      style={[s.periodBtn, filled && s.periodBtnFilled, disabled && s.periodBtnDisabled]}
      accessibilityRole="button"
      accessibilityLabel={caption}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.periodCaption, disabled && s.periodCaptionDisabled]}>{caption}</Text>
        <Text
          style={[s.periodValue, disabled && s.periodValueDisabled, !value && s.periodPlaceholder]}
          numberOfLines={1}
        >
          {value || 'Выбрать'}
        </Text>
      </View>
      <ChevronDownIcon size={16} color={disabled ? EditColors.textTertiary : EditColors.ink} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  periodRow: { flexDirection: 'row', gap: 10 },
  periodBtn: {
    flex: 1, height: 56, borderRadius: EditRadius.field, paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  periodBtnFilled: { borderWidth: 2, borderColor: EditColors.ink },
  periodBtnDisabled: { backgroundColor: EditColors.fieldDisabledBg, borderWidth: 1.5, borderColor: EditColors.borderSoft },
  periodCaption: { fontFamily: EditFonts.text700, fontSize: 11, color: EditColors.textTertiary },
  periodCaptionDisabled: { color: EditColors.textTertiary },
  periodValue: { marginTop: 1, fontFamily: EditFonts.text800, fontSize: 15, color: EditColors.ink },
  periodValueDisabled: { color: EditColors.textTertiary },
  periodPlaceholder: { fontFamily: EditFonts.text600, color: EditColors.placeholder },
  error: { fontFamily: EditFonts.text600, fontSize: 12, color: EditColors.danger },
});
