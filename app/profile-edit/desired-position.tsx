/**
 * «Желаемая должность» — `docs/design/profile-edit/resume/01-desired-position.html`.
 * Должность, зарплата (сумма + «на руки»/«до вычета»), занятость, формат, город.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import {
  EditScreen, Field, FieldLabel, ChipGroup, Chip, InfoNote, useUnsavedGuard,
} from '@/components/profile/edit';
import { ChevronRightIcon } from '@/components/profile/edit/icons';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import {
  patchResume, parseSalaryAmount, parseSalaryNet, EMPLOYMENT_TYPES, WORK_FORMATS,
} from '@/lib/profileEdit';

/** Значение из PDF-импорта, если оно совпадает со справочником (без регистра). */
function matchOption(options: string[], value?: string): string | undefined {
  if (!value) return undefined;
  return options.find((o) => o.toLowerCase() === value.toLowerCase());
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

/** Только цифры — зарплата вводится числом, отображается с пробелами-разрядами. */
function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function DesiredPositionScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const resume = currentUser?.resume;
  // У резюме из PDF-импорта числовых salaryAmount/salaryNet может не быть —
  // только легаси-строка salary, из неё и достаём.
  const initialSalaryAmount = resume?.salaryAmount ?? parseSalaryAmount(resume?.salary);
  const initialSalaryNet = resume?.salaryNet ?? parseSalaryNet(resume?.salary);
  const legacyEmploymentType = matchOption(EMPLOYMENT_TYPES, resume?.employmentType);
  const legacyWorkFormat = matchOption(WORK_FORMATS, resume?.workFormat);
  const initialEmploymentTypes = resume?.employmentTypes
    ?? (legacyEmploymentType ? [legacyEmploymentType] : []);
  const initialWorkFormats = resume?.workFormats
    ?? (legacyWorkFormat ? [legacyWorkFormat] : []);
  const initial = {
    desiredPosition: resume?.desiredPosition ?? '',
    salaryDigits: initialSalaryAmount != null ? String(Math.round(initialSalaryAmount)) : '',
    salaryNet: initialSalaryNet,
    employmentTypes: initialEmploymentTypes,
    workFormats: initialWorkFormats,
  };

  const [desiredPosition, setDesiredPosition] = useState(initial.desiredPosition);
  const [salaryDigits, setSalaryDigits] = useState(initial.salaryDigits);
  const [salaryNet, setSalaryNet] = useState<boolean | undefined>(initial.salaryNet);
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(initial.employmentTypes);
  const [workFormats, setWorkFormats] = useState<string[]>(initial.workFormats);
  // Город выбирается и сохраняется на экране «Город и метро» (patchPersonal
  // переносит его и в resume.city) — здесь только показываем, в dirty не входит.
  const city = currentUser?.personalDetails?.location || resume?.city || '';

  const dirty = desiredPosition !== initial.desiredPosition
    || salaryDigits !== initial.salaryDigits
    || salaryNet !== initial.salaryNet
    || !sameSet(employmentTypes, initial.employmentTypes)
    || !sameSet(workFormats, initial.workFormats);
  const valid = desiredPosition.trim().length > 0;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      // salaryAmount/salaryNet кладём в патч только если их правда меняли —
      // иначе у резюме из PDF (там нет числового salaryAmount, только строка
      // salary) сохранение любого другого поля стирало бы зарплату.
      await updateUser(patchResume(currentUser, {
        desiredPosition: desiredPosition.trim(),
        ...(salaryDigits !== initial.salaryDigits ? { salaryAmount: salaryDigits ? Number(salaryDigits) : undefined } : {}),
        ...(salaryNet !== initial.salaryNet ? { salaryNet } : {}),
        employmentTypes,
        workFormats,
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
        title="Желаемая должность"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <Text style={s.hint}>Работодатели видят это первым в вашем резюме</Text>

        <Field
          label="Должность"
          value={desiredPosition}
          onChangeText={setDesiredPosition}
          placeholder="Например, региональный менеджер"
        />

        <View style={{ gap: 8 }}>
          <FieldLabel label="Зарплата" />
          <Field
            value={groupDigits(salaryDigits)}
            onChangeText={(text) => setSalaryDigits(digitsOnly(text))}
            placeholder="0"
            keyboardType="numeric"
            accessibilityLabel="Зарплата"
            right={<Text style={s.currency}>₽</Text>}
          />
          <View style={s.salaryRow}>
            <Chip label="На руки" selected={salaryNet === true} onPress={() => setSalaryNet(true)} />
            <Chip label="До вычета налогов" selected={salaryNet === false} onPress={() => setSalaryNet(false)} />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.groupLabel}>
            Занятость<Text style={s.groupLabelHint}> · можно несколько</Text>
          </Text>
          <ChipGroup>
            {EMPLOYMENT_TYPES.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={employmentTypes.includes(option)}
                onPress={() => setEmploymentTypes((cur) => toggle(cur, option))}
              />
            ))}
          </ChipGroup>
        </View>

        <View style={s.section}>
          <Text style={s.groupLabel}>
            Формат<Text style={s.groupLabelHint}> · можно несколько</Text>
          </Text>
          <ChipGroup>
            {WORK_FORMATS.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={workFormats.includes(option)}
                onPress={() => setWorkFormats((cur) => toggle(cur, option))}
              />
            ))}
          </ChipGroup>
        </View>

        <View style={{ gap: 8 }}>
          <FieldLabel label="Город" />
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => router.push('/profile-edit/city-metro')}
            style={s.cityBox}
          >
            <Text style={s.cityText} numberOfLines={1}>{city || 'Выбрать город'}</Text>
            <ChevronRightIcon size={18} color={EditColors.ink} />
          </TouchableOpacity>
        </View>

        <InfoNote>Опыт работы считается автоматически по местам работы — отдельно указывать не нужно</InfoNote>
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  hint: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 14 * 1.45, color: EditColors.textTertiary,
  },
  groupLabel: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.label },
  groupLabelHint: { fontFamily: EditFonts.text600, color: EditColors.textTertiary },
  currency: { fontFamily: EditFonts.heading, fontSize: 18, color: EditColors.ink },
  salaryRow: { flexDirection: 'row', gap: 8 },
  section: { gap: 10 },
  cityBox: {
    height: 56, borderRadius: EditRadius.field, paddingHorizontal: 16,
    borderWidth: 2, borderColor: EditColors.ink, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  cityText: { flex: 1, minWidth: 0, fontFamily: EditFonts.text700, fontSize: 16, color: EditColors.ink },
});
