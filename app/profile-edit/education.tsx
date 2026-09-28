import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { patchResume, upsertAt, removeAt, EDUCATION_LEVELS } from '@/lib/profileEdit';
import { ResumeEducation } from '@/constants/types';
import {
  EditScreen, Field, SelectField, OptionSheet, InfoNote, FieldLabel, ChipGroup, Chip, AddDashedButton,
  useUnsavedGuard,
} from '@/components/profile/edit';

const CURRENT_YEAR = 2026;
const YEARS = Array.from({ length: CURRENT_YEAR - 1960 + 1 }, (_, i) => String(CURRENT_YEAR - i));

/**
 * Образование — `resume/05-education.html`. Без `index` в параметрах —
 * добавление новой записи `resume.education`, с `index` — редактирование
 * существующей (несуществующий индекс ведёт себя как добавление).
 */
export default function EducationScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const router = useRouter();
  const { index } = useLocalSearchParams<{ index?: string }>();
  const [busy, setBusy] = useState(false);
  const [yearSheetVisible, setYearSheetVisible] = useState(false);

  const education = currentUser?.resume?.education ?? [];
  const recordIndex = index != null ? Number(index) : undefined;
  const isNew = recordIndex == null || !education[recordIndex];
  const existing = isNew ? undefined : education[recordIndex];

  const [level, setLevel] = useState(existing?.level ?? '');
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [specialty, setSpecialty] = useState(existing?.specialty ?? '');
  const [endYear, setEndYear] = useState(existing?.endYear != null ? String(existing.endYear) : '');

  // Поле «Специальность» появляется, как только уровень выбран и это не «Среднее» — см. InfoNote.
  const showSpecialty = level.length > 0 && level !== 'Среднее';

  const dirty = level !== (existing?.level ?? '')
    || institution !== (existing?.institution ?? '')
    || specialty !== (existing?.specialty ?? '')
    || endYear !== (existing?.endYear != null ? String(existing.endYear) : '');
  const valid = institution.trim().length > 0;

  const yearOptions = useMemo(() => YEARS.map((y) => ({ label: y, value: y })), []);

  const buildItem = (): ResumeEducation => ({
    level: level || undefined,
    institution: institution.trim(),
    specialty: specialty.trim() || undefined,
    endYear: endYear ? Number(endYear) : undefined,
  });

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      const nextEducation = upsertAt(education, isNew ? undefined : recordIndex, buildItem());
      await updateUser(patchResume(currentUser, { education: nextEducation }));
      showToast('Сохранено');
      return true;
    } catch {
      showToast('Не удалось сохранить. Попробуйте ещё раз', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!currentUser || isNew) return;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { education: removeAt(education, recordIndex as number) }));
      showToast('Удалено');
      leave();
    } catch {
      showToast('Не удалось сохранить. Попробуйте ещё раз', 'error');
    } finally {
      setBusy(false);
    }
  };

  const { requestClose, dialog, leave } = useUnsavedGuard({ dirty, onSave: save });

  const handleAddAnother = async () => {
    if (dirty && valid) {
      const ok = await save();
      if (!ok) return;
    }
    router.push('/profile-edit/education');
  };

  if (!currentUser) return null;

  return (
    <>
      <EditScreen
        title="Образование"
        onBack={requestClose}
        primaryLabel={isNew ? 'Добавить' : 'Сохранить'}
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
        onDelete={isNew ? undefined : handleDelete}
      >
        <View style={{ gap: 10 }}>
          <FieldLabel label="Уровень" />
          <ChipGroup>
            {EDUCATION_LEVELS.map((option) => (
              <Chip key={option} label={option} selected={level === option} onPress={() => setLevel(option)} />
            ))}
          </ChipGroup>
        </View>

        <Field
          label="Учебное заведение"
          value={institution}
          onChangeText={setInstitution}
          placeholder="Школа, колледж или вуз"
        />

        {showSpecialty ? (
          <Field
            label="Специальность"
            optional
            value={specialty}
            onChangeText={setSpecialty}
            placeholder="Направление подготовки"
          />
        ) : null}

        <View style={{ gap: 8 }}>
          <FieldLabel label="Год окончания" />
          <SelectField
            value={endYear}
            placeholder="Выбрать год"
            onPress={() => setYearSheetVisible(true)}
          />
        </View>

        <InfoNote>Для среднего специального и высшего появятся поля «Факультет» и «Специальность»</InfoNote>

        <AddDashedButton label="Добавить ещё учебное заведение" onPress={handleAddAnother} />
      </EditScreen>

      <OptionSheet
        visible={yearSheetVisible}
        title="Год окончания"
        options={yearOptions}
        selected={endYear}
        onSelect={(value) => { setEndYear(value); setYearSheetVisible(false); }}
        onClose={() => setYearSheetVisible(false)}
      />

      {dialog}
    </>
  );
}
