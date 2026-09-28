import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { patchResume, upsertAt, removeAt } from '@/lib/profileEdit';
import { ResumeExam } from '@/constants/types';
import {
  EditScreen, Field, SelectField, OptionSheet, useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

const CURRENT_YEAR = 2026;
const YEARS = Array.from({ length: CURRENT_YEAR - 1960 + 1 }, (_, i) => String(CURRENT_YEAR - i));

/**
 * Экзамен или тест — `resume/06-exam.html`. Без `index` в параметрах —
 * добавление новой записи `resume.exams`, с `index` — редактирование
 * существующей (несуществующий индекс ведёт себя как добавление).
 */
export default function ExamScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const { index } = useLocalSearchParams<{ index?: string }>();
  const [busy, setBusy] = useState(false);
  const [yearSheetVisible, setYearSheetVisible] = useState(false);

  const exams = currentUser?.resume?.exams ?? [];
  const recordIndex = index != null ? Number(index) : undefined;
  const isNew = recordIndex == null || !exams[recordIndex];
  const existing = isNew ? undefined : exams[recordIndex];

  const [name, setName] = useState(existing?.name ?? '');
  const [issuer, setIssuer] = useState(existing?.issuer ?? '');
  const [date, setDate] = useState(existing?.date ?? '');
  const [score, setScore] = useState(existing?.score ?? '');

  const dirty = name !== (existing?.name ?? '')
    || issuer !== (existing?.issuer ?? '')
    || date !== (existing?.date ?? '')
    || score !== (existing?.score ?? '');
  const valid = name.trim().length > 0;

  const yearOptions = useMemo(() => YEARS.map((y) => ({ label: y, value: y })), []);

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      const item: ResumeExam = {
        name: name.trim(),
        issuer: issuer.trim() || undefined,
        date: date || undefined,
        score: score.trim() || undefined,
      };
      const nextExams = upsertAt(exams, isNew ? undefined : recordIndex, item);
      await updateUser(patchResume(currentUser, { exams: nextExams }));
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
      await updateUser(patchResume(currentUser, { exams: removeAt(exams, recordIndex as number) }));
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
        title="Экзамен или тест"
        onBack={requestClose}
        primaryLabel={isNew ? 'Добавить' : 'Сохранить'}
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
        onDelete={isNew ? undefined : handleDelete}
      >
        <Text style={s.hint}>Например, IELTS, TOEFL или тестирование от компании</Text>

        <View style={{ gap: 20 }}>
          <Field label="Название" value={name} onChangeText={setName} placeholder="IELTS Academic" />
          <Field label="Кто проводил" value={issuer} onChangeText={setIssuer} placeholder="Организация" />
          <View style={s.row}>
            <View style={s.rowItem}>
              <SelectField
                label="Год"
                value={date}
                placeholder="Выбрать"
                onPress={() => setYearSheetVisible(true)}
              />
            </View>
            <View style={s.rowItem}>
              <Field label="Результат" value={score} onChangeText={setScore} placeholder="7.0" />
            </View>
          </View>
        </View>
      </EditScreen>

      <OptionSheet
        visible={yearSheetVisible}
        title="Год"
        options={yearOptions}
        selected={date}
        onSelect={(value) => { setDate(value); setYearSheetVisible(false); }}
        onClose={() => setYearSheetVisible(false)}
      />

      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  hint: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.textTertiary,
  },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1, minWidth: 0 },
});
