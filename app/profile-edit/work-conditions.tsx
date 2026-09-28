/**
 * «Занятость и формат» — `docs/design/profile-edit/personal/16-work-conditions.html`.
 * Три группы чипов с множественным выбором: занятость, формат, график.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import {
  EditScreen, ChipGroup, Chip, SectionTitle, useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { patchResume, EMPLOYMENT_TYPES, WORK_FORMATS, SCHEDULES } from '@/lib/profileEdit';

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

/** Значение из PDF-импорта, если оно совпадает со справочником (без регистра). */
function matchOption(options: string[], value?: string): string | undefined {
  if (!value) return undefined;
  return options.find((o) => o.toLowerCase() === value.toLowerCase());
}

export default function WorkConditionsScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);

  // Единственный источник — резюме. Легаси employmentType/workFormat (один
  // вариант) и personalDetails старой версии этого экрана — запасные пути
  // для тех, у кого resume ещё не заполнен структурно.
  const resume = currentUser?.resume;
  const personal = currentUser?.personalDetails;
  const legacyEmploymentType = matchOption(EMPLOYMENT_TYPES, resume?.employmentType);
  const legacyWorkFormat = matchOption(WORK_FORMATS, resume?.workFormat);

  const initial = {
    employmentTypes: resume?.employmentTypes
      ?? (legacyEmploymentType ? [legacyEmploymentType] : (personal?.employmentTypes ?? [])),
    workFormats: resume?.workFormats
      ?? (legacyWorkFormat ? [legacyWorkFormat] : (personal?.workFormats ?? [])),
    schedule: resume?.schedule ?? personal?.schedule ?? [],
  };
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(initial.employmentTypes);
  const [workFormats, setWorkFormats] = useState<string[]>(initial.workFormats);
  const [schedule, setSchedule] = useState<string[]>(initial.schedule);

  const dirty = !sameSet(employmentTypes, initial.employmentTypes)
    || !sameSet(workFormats, initial.workFormats)
    || !sameSet(schedule, initial.schedule);
  // Пустой выбор допустим — человек может не хотеть указывать занятость/формат.

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { employmentTypes, workFormats, schedule }));
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
        title="Условия работы"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <Text style={s.hint}>В каждом разделе можно выбрать несколько вариантов</Text>

        <View style={s.section}>
          <SectionTitle>Занятость</SectionTitle>
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
          <SectionTitle>Формат</SectionTitle>
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

        <View style={s.section}>
          <SectionTitle>График</SectionTitle>
          <ChipGroup>
            {SCHEDULES.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={schedule.includes(option)}
                onPress={() => setSchedule((cur) => toggle(cur, option))}
              />
            ))}
          </ChipGroup>
        </View>
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  hint: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 14 * 1.45, color: EditColors.textTertiary,
  },
  section: { gap: 12 },
});
