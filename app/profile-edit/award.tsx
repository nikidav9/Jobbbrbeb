import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { patchResume, upsertAt, removeAt } from '@/lib/profileEdit';
import { ResumeAward } from '@/constants/types';
import {
  EditScreen, Field, SelectField, OptionSheet, TextArea, useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

const CURRENT_YEAR = 2026;
const YEARS = Array.from({ length: CURRENT_YEAR - 1960 + 1 }, (_, i) => String(CURRENT_YEAR - i));

/**
 * Награда — `resume/09-award.html`. Без `index` в параметрах — добавление
 * новой записи `resume.awards`, с `index` — редактирование существующей
 * (несуществующий индекс ведёт себя как добавление).
 */
export default function AwardScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const { index } = useLocalSearchParams<{ index?: string }>();
  const [busy, setBusy] = useState(false);
  const [yearSheetVisible, setYearSheetVisible] = useState(false);

  const awards = currentUser?.resume?.awards ?? [];
  const recordIndex = index != null ? Number(index) : undefined;
  const isNew = recordIndex == null || !awards[recordIndex];
  const existing = isNew ? undefined : awards[recordIndex];

  const [name, setName] = useState(existing?.name ?? '');
  const [issuer, setIssuer] = useState(existing?.issuer ?? '');
  const [date, setDate] = useState(existing?.date ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');

  const dirty = name !== (existing?.name ?? '')
    || issuer !== (existing?.issuer ?? '')
    || date !== (existing?.date ?? '')
    || description !== (existing?.description ?? '');
  const valid = name.trim().length > 0;

  const yearOptions = useMemo(() => YEARS.map((y) => ({ label: y, value: y })), []);

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      const item: ResumeAward = {
        name: name.trim(),
        issuer: issuer.trim() || undefined,
        date: date || undefined,
        description: description.trim() || undefined,
      };
      const nextAwards = upsertAt(awards, isNew ? undefined : recordIndex, item);
      await updateUser(patchResume(currentUser, { awards: nextAwards }));
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
      await updateUser(patchResume(currentUser, { awards: removeAt(awards, recordIndex as number) }));
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
        title="Награда"
        onBack={requestClose}
        primaryLabel={isNew ? 'Добавить' : 'Сохранить'}
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
        onDelete={isNew ? undefined : handleDelete}
      >
        <Text style={s.hint}>Премии, конкурсы, хакатоны, признание в компании</Text>

        <View style={{ gap: 20 }}>
          <Field
            label="Название"
            value={name}
            onChangeText={setName}
            placeholder="Например, 1 место на хакатоне"
          />
          <View style={s.row}>
            <View style={s.rowItem}>
              <Field label="Кто вручил" value={issuer} onChangeText={setIssuer} placeholder="Организация" />
            </View>
            <View style={s.rowItem}>
              <SelectField
                label="Год"
                value={date}
                placeholder="Выбрать"
                onPress={() => setYearSheetVisible(true)}
              />
            </View>
          </View>
          <TextArea
            label="За что"
            optional
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            placeholder="Коротко о том, за какой результат получили награду"
          />
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
    marginTop: -12, marginBottom: 2, fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20,
    color: EditColors.textTertiary,
  },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1, minWidth: 0 },
});
