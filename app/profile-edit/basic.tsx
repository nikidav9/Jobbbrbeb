import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { patchPersonal, ADDRESS_FORMS, MONTHS } from '@/lib/profileEdit';
import { User } from '@/constants/types';
import {
  EditScreen, Field, BottomSheet, Chip, ChipGroup, Toggle, useUnsavedGuard,
} from '@/components/profile/edit';
import { CalendarIcon } from '@/components/profile/edit/icons';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';

const CURRENT_YEAR = new Date().getFullYear();
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const YEARS = Array.from({ length: CURRENT_YEAR - 1960 + 1 }, (_, i) => String(CURRENT_YEAR - i));

/** Разбирает «ДД.ММ.ГГГГ» на составные числа, если формат верный. */
function parseBirthDate(value: string): { day: string; month: string; year: string } | undefined {
  const m = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return undefined;
  return { day: m[1], month: MONTHS[Number(m[2]) - 1], year: m[3] };
}

/** Возраст на сегодня по дате рождения «ДД.ММ.ГГГГ». */
function calcAge(birthDate: string): number | undefined {
  const m = birthDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age >= 0 ? age : undefined;
}

/** Одна колонка списка в шторке даты рождения — день/месяц/год. */
function DateColumn({
  values, selected, onSelect,
}: {
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={s.dateColumn}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {values.map((value) => {
          const isSelected = value === selected;
          return (
            <TouchableOpacity
              key={value}
              onPress={() => onSelect(value)}
              activeOpacity={0.7}
              style={[s.dateRow, isSelected && s.dateRowSelected]}
            >
              <Text style={[s.dateRowText, isSelected && s.dateRowTextSelected]}>{value}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Шторка выбора даты рождения — три колонки (день/месяц/год), «Готово» ниже. */
function BirthDateSheet({
  visible, value, onClose, onSave,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onSave: (birthDate: string) => void;
}) {
  const parsed = useMemo(() => parseBirthDate(value), [value]);
  const [day, setDay] = useState(parsed?.day ?? '');
  const [month, setMonth] = useState(parsed?.month ?? '');
  const [year, setYear] = useState(parsed?.year ?? '');

  useEffect(() => {
    if (visible) {
      setDay(parsed?.day ?? '');
      setMonth(parsed?.month ?? '');
      setYear(parsed?.year ?? '');
    }
  }, [visible, parsed]);

  const ready = !!day && !!month && !!year;

  const confirm = () => {
    if (!ready) return;
    const monthNum = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
    onSave(`${day}.${monthNum}.${year}`);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Дата рождения">
      <View style={s.dateColumns}>
        <DateColumn values={DAYS} selected={day} onSelect={setDay} />
        <DateColumn values={MONTHS} selected={month} onSelect={setMonth} />
        <DateColumn values={YEARS} selected={year} onSelect={setYear} />
      </View>
      <TouchableOpacity
        onPress={confirm}
        disabled={!ready}
        activeOpacity={0.85}
        style={[s.dateDoneBtn, !ready && s.dateDoneBtnDisabled]}
      >
        <Text style={[s.dateDoneText, !ready && s.dateDoneTextDisabled]}>Готово</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

/**
 * «Основное» — имя, отчество, фамилия, обращение, дата рождения и видимость
 * возраста, экран `personal/11-basic.html`. Открывается с фокусом на поле,
 * у которого нажали карандаш в профиле: `focus` — имя одного из полей.
 */
export default function BasicScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [busy, setBusy] = useState(false);
  const [dobVisible, setDobVisible] = useState(false);

  const p = currentUser?.personalDetails ?? {};

  const [firstName, setFirstName] = useState(currentUser?.firstName ?? '');
  const [middleName, setMiddleName] = useState(p.middleName ?? '');
  const [lastName, setLastName] = useState(currentUser?.lastName ?? '');
  const [addressForm, setAddressForm] = useState(p.title ?? '');
  const [customAddress, setCustomAddress] = useState(p.preferredName ?? '');
  // Дату рождения не храним (миграция 103 намеренно удалила birthday, 152-ФЗ):
  // она живёт только на экране, в базу уходит лишь посчитанный возраст.
  const [birthDate, setBirthDate] = useState('');
  const [showAge, setShowAge] = useState(p.showAge ?? true);

  const firstNameRef = useRef<TextInput>(null);
  const middleNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const customAddressRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (focus === 'firstName') firstNameRef.current?.focus();
      else if (focus === 'middleName') middleNameRef.current?.focus();
      else if (focus === 'lastName') lastNameRef.current?.focus();
      else if (focus === 'age') setDobVisible(true);
      // 'title' (обращение) — чипы видны сразу на экране, отдельной шторки нет.
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = firstName !== (currentUser?.firstName ?? '')
    || middleName !== (p.middleName ?? '')
    || lastName !== (currentUser?.lastName ?? '')
    || addressForm !== (p.title ?? '')
    || customAddress !== (p.preferredName ?? '')
    || birthDate !== ''
    || showAge !== (p.showAge ?? true);

  const valid = firstName.trim().length > 0 && lastName.trim().length > 0;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      // Дату не выбирали — возраст остаётся прежним, а не стирается.
      const age = (birthDate ? calcAge(birthDate) : undefined) ?? currentUser.age;
      const patched = patchPersonal(currentUser, {
        middleName: middleName.trim() || undefined,
        title: addressForm || undefined,
        preferredName: addressForm === 'Свой вариант' ? (customAddress.trim() || undefined) : undefined,
        showAge,
      });
      const next: User = {
        ...patched,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        age,
      };
      await updateUser(next);
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
        title="Основное"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <View style={{ gap: 20 }}>
          <Field
            label="Имя"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Имя"
            inputRef={firstNameRef}
          />
          <Field
            label="Отчество"
            optional
            value={middleName}
            onChangeText={setMiddleName}
            placeholder="Отчество"
            inputRef={middleNameRef}
          />
          <Field
            label="Фамилия"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Фамилия"
            inputRef={lastNameRef}
          />

          <View style={{ gap: 10 }}>
            <Text style={s.label}>Как к вам обращаться</Text>
            <ChipGroup>
              {ADDRESS_FORMS.map((formLabel) => (
                <Chip
                  key={formLabel}
                  label={formLabel}
                  selected={addressForm === formLabel}
                  onPress={() => {
                    setAddressForm(formLabel);
                    if (formLabel === 'Свой вариант') {
                      setTimeout(() => customAddressRef.current?.focus(), 50);
                    }
                  }}
                />
              ))}
            </ChipGroup>
            {addressForm === 'Свой вариант' ? (
              <Field
                value={customAddress}
                onChangeText={setCustomAddress}
                placeholder="Например, Ник"
                inputRef={customAddressRef}
              />
            ) : null}
            <Text style={s.hint}>Так к вам будут обращаться работодатели в чате</Text>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={s.label}>Дата рождения</Text>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => setDobVisible(true)}
              style={[s.dateField, birthDate && s.dateFieldFilled]}
            >
              <Text style={[s.dateFieldText, !birthDate && s.dateFieldPlaceholder]}>
                {birthDate || (currentUser.age ? `Сейчас указано: ${currentUser.age}` : 'ДД.ММ.ГГГГ')}
              </Text>
              <CalendarIcon size={20} />
            </TouchableOpacity>
            <Text style={s.hint}>Возраст посчитаем сами. Дату не храним — работодатели видят только возраст</Text>
          </View>

          <Toggle
            label="Показывать возраст"
            value={showAge}
            onValueChange={setShowAge}
          />
        </View>
      </EditScreen>

      <BirthDateSheet
        visible={dobVisible}
        value={birthDate}
        onClose={() => setDobVisible(false)}
        onSave={setBirthDate}
      />

      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  label: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.label },
  hint: { fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary },
  dateField: {
    height: 56, borderRadius: EditRadius.field, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dateFieldFilled: { borderWidth: 2, borderColor: EditColors.ink },
  dateFieldText: { fontFamily: EditFonts.text700, fontSize: 16, color: EditColors.ink },
  dateFieldPlaceholder: { fontFamily: EditFonts.text600, color: EditColors.placeholder },
  dateColumns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  dateColumn: {
    flex: 1, height: 220, borderRadius: EditRadius.card,
    borderWidth: 1.5, borderColor: EditColors.borderSoft, backgroundColor: EditColors.bg,
    paddingVertical: 4,
  },
  dateRow: { height: 40, alignItems: 'center', justifyContent: 'center' },
  dateRowSelected: { backgroundColor: EditColors.accentSoft, borderRadius: EditRadius.chip },
  dateRowText: { fontFamily: EditFonts.text600, fontSize: 14, color: EditColors.ink },
  dateRowTextSelected: { fontFamily: EditFonts.text800 },
  dateDoneBtn: {
    marginTop: 16, height: 52, borderRadius: EditRadius.button, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.accent, alignItems: 'center', justifyContent: 'center',
  },
  dateDoneBtnDisabled: { borderWidth: 0, backgroundColor: EditColors.disabledBg },
  dateDoneText: { fontFamily: EditFonts.text800, fontSize: 16, color: EditColors.ink },
  dateDoneTextDisabled: { color: EditColors.disabledText },
});
