import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { patchResume, upsertAt, removeAt, normalizeHttpUrl } from '@/lib/profileEdit';
import { ResumeCoursework } from '@/constants/types';
import {
  EditScreen, Field, SelectField, OptionSheet, FieldLabel, useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

const CURRENT_YEAR = 2026;
const YEARS = Array.from({ length: CURRENT_YEAR - 1960 + 1 }, (_, i) => String(CURRENT_YEAR - i));

/**
 * Курс — `resume/08-course.html`. Без `index` в параметрах — добавление новой
 * записи `resume.coursework`, с `index` — редактирование существующей
 * (несуществующий индекс ведёт себя как добавление).
 */
export default function CourseScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const { index } = useLocalSearchParams<{ index?: string }>();
  const [busy, setBusy] = useState(false);
  const [yearSheetVisible, setYearSheetVisible] = useState(false);

  const coursework = currentUser?.resume?.coursework ?? [];
  const recordIndex = index != null ? Number(index) : undefined;
  const isNew = recordIndex == null || !coursework[recordIndex];
  const existing = isNew ? undefined : coursework[recordIndex];

  const [name, setName] = useState(existing?.name ?? '');
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [endYear, setEndYear] = useState(existing?.endYear != null ? String(existing.endYear) : '');
  const [duration, setDuration] = useState(existing?.duration ?? '');
  const [credentialUrl, setCredentialUrl] = useState(existing?.credentialUrl ?? '');

  const dirty = name !== (existing?.name ?? '')
    || institution !== (existing?.institution ?? '')
    || endYear !== (existing?.endYear != null ? String(existing.endYear) : '')
    || duration !== (existing?.duration ?? '')
    || credentialUrl !== (existing?.credentialUrl ?? '');
  const credentialUrlError = credentialUrl.trim() ? normalizeHttpUrl(credentialUrl).error : undefined;
  const valid = name.trim().length > 0 && !credentialUrlError;

  const yearOptions = useMemo(() => YEARS.map((y) => ({ label: y, value: y })), []);

  const buildItem = (): ResumeCoursework => ({
    // description на макете нет поля для него — не трогаем, если запись пришла с ним извне (импорт).
    ...(existing?.description ? { description: existing.description } : {}),
    name: name.trim(),
    institution: institution.trim() || undefined,
    endYear: endYear ? Number(endYear) : undefined,
    duration: duration.trim() || undefined,
    credentialUrl: normalizeHttpUrl(credentialUrl).url,
  });

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      const nextCoursework = upsertAt(coursework, isNew ? undefined : recordIndex, buildItem());
      await updateUser(patchResume(currentUser, { coursework: nextCoursework }));
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
      await updateUser(patchResume(currentUser, { coursework: removeAt(coursework, recordIndex as number) }));
      showToast('Удалено');
      leave();
    } catch {
      showToast('Не удалось сохранить. Попробуйте ещё раз', 'error');
    } finally {
      setBusy(false);
    }
  };

  const { requestClose, dialog, leave } = useUnsavedGuard({ dirty, onSave: save });

  if (!currentUser) return null;

  return (
    <>
      <EditScreen
        title="Курс"
        onBack={requestClose}
        primaryLabel={isNew ? 'Добавить' : 'Сохранить'}
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
        onDelete={isNew ? undefined : handleDelete}
      >
        <Field
          label="Название курса"
          value={name}
          onChangeText={setName}
          placeholder="Например, Управление IT-проектами"
        />

        <Field
          label="Где проходили"
          value={institution}
          onChangeText={setInstitution}
          placeholder="Школа или платформа"
        />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, gap: 8 }}>
            <FieldLabel label="Год окончания" />
            <SelectField
              value={endYear}
              placeholder="Выбрать"
              onPress={() => setYearSheetVisible(true)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Длительность"
              value={duration}
              onChangeText={setDuration}
              placeholder="3 месяца"
            />
          </View>
        </View>

        <Field
          label="Ссылка на сертификат"
          optional
          value={credentialUrl}
          onChangeText={setCredentialUrl}
          placeholder="https://"
        />
        {credentialUrlError ? <Text style={s.error}>{credentialUrlError}</Text> : null}
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

const s = StyleSheet.create({
  error: { fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.danger },
});
