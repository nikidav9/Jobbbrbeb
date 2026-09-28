import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import {
  EditScreen, RadioCard, TextArea, InfoNote, useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { patchPersonal } from '@/lib/profileEdit';

const MAX_LENGTH = 500;

/**
 * Экран «Ограничения по трудоустройству» — `docs/design/profile-edit/personal/20-restrictions.html`.
 * Нет/есть ограничения → описание при «есть» (обязательно).
 */
export default function RestrictionsScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);

  const initial = useMemo(() => {
    const personal = currentUser?.personalDetails;
    return {
      hasRestrictions: personal?.hasEmploymentRestrictions ?? false,
      description: personal?.employmentRestrictions ?? '',
    };
  }, [currentUser]);

  const [hasRestrictions, setHasRestrictions] = useState(initial.hasRestrictions);
  const [description, setDescription] = useState(initial.description);

  const dirty = hasRestrictions !== initial.hasRestrictions || description !== initial.description;
  const valid = !hasRestrictions || description.trim().length > 0;

  const selectHasRestrictions = (next: boolean) => {
    setHasRestrictions(next);
    if (!next) setDescription('');
  };

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, {
        hasEmploymentRestrictions: hasRestrictions,
        employmentRestrictions: hasRestrictions ? description.trim() : undefined,
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
        title="Ограничения"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <Text style={s.subtitle}>
          Обязательства или договорённости, которые могут повлиять на новую работу
        </Text>

        <View style={s.radioGroup} accessibilityRole="radiogroup" accessibilityLabel="Ограничения по трудоустройству">
          <RadioCard title="Ограничений нет" selected={!hasRestrictions} onPress={() => selectHasRestrictions(false)} />
          <RadioCard title="Есть ограничения" selected={hasRestrictions} onPress={() => selectHasRestrictions(true)} />
        </View>

        {hasRestrictions ? (
          <TextArea
            label="Опишите коротко"
            value={description}
            onChangeText={setDescription}
            maxLength={MAX_LENGTH}
            placeholder="Например: соглашение о неконкуренции до марта 2027 или отработка 2 недели"
          />
        ) : null}

        <InfoNote>Видят только работодатели, которым вы откликнулись</InfoNote>
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  subtitle: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.textTertiary,
  },
  radioGroup: { gap: 10 },
});
