import React, { useMemo, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import {
  EditScreen, Field, SelectField, OptionSheet, InfoNote, useUnsavedGuard,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { patchPersonal } from '@/lib/profileEdit';
import {
  applyAnswersFor, NOTICE_OPTIONS, ENGLISH_OPTIONS, RELOCATION_OPTIONS, FORMAT_OPTIONS,
} from '@/lib/applyAnswers';
import type { ApplyAnswers } from '@/constants/types';

type SheetKey = 'noticePeriod' | 'englishLevel' | 'relocation' | 'workFormat';

const SHEETS: Record<SheetKey, { title: string; options: string[] }> = {
  noticePeriod: { title: 'Когда можете выйти', options: NOTICE_OPTIONS },
  englishLevel: { title: 'Английский', options: ENGLISH_OPTIONS },
  relocation: { title: 'Переезд', options: RELOCATION_OPTIONS },
  workFormat: { title: 'Формат работы', options: FORMAT_OPTIONS },
};

/**
 * «Ответы для откликов» (01.10.2026, решение владельца: «ответьте один раз»).
 * Частые вопросы анкет работодателей — Юпитер подставляет ответы сам и не
 * останавливает отклик на «нужен человек». Подстановка из профиля — applyAnswersFor.
 */
export default function ApplyAnswersScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const initial = useMemo(() => applyAnswersFor(currentUser), [currentUser]);
  const [answers, setAnswers] = useState<ApplyAnswers>(initial);
  const [sheet, setSheet] = useState<SheetKey | null>(null);

  const set = (patch: Partial<ApplyAnswers>) => setAnswers(a => ({ ...a, ...patch }));
  const dirty = JSON.stringify(answers) !== JSON.stringify(initial)
    || !currentUser?.personalDetails?.applyAnswers;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    const clean: ApplyAnswers = {};
    for (const [k, v] of Object.entries(answers) as [keyof ApplyAnswers, string | undefined][]) {
      if (v && v.trim()) clean[k] = v.trim();
    }
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, { applyAnswers: clean, applyAnswersPromptDismissed: true }));
      showToast('Сохранено — Юпитер подставит ответы сам');
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

  const select = (key: SheetKey, label: string) => (
    <SelectField label={label} optional value={answers[key]} placeholder="Выберите" onPress={() => setSheet(key)} />
  );

  return (
    <>
      <EditScreen
        title="Ответы для откликов"
        onBack={requestClose}
        primaryLabel="Сохранить"
        primaryDisabled={!dirty}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <Text style={s.subtitle}>
          Работодатели часто спрашивают одно и то же. Ответьте один раз — Юпитер подставит ответы в анкеты сам
        </Text>
        <Field
          label="Желаемая зарплата, ₽ на руки" optional keyboardType="number-pad"
          value={answers.desiredSalary ?? ''} placeholder="Например, 150000"
          onChangeText={t => set({ desiredSalary: t.replace(/[^\d]/g, '') })}
        />
        {select('noticePeriod', 'Когда можете выйти')}
        <Field
          label="Telegram" optional autoCapitalize="none" autoCorrect={false}
          value={answers.telegram ?? ''} placeholder="@ник"
          onChangeText={t => set({ telegram: t.trim() })}
        />
        {select('englishLevel', 'Английский')}
        {select('relocation', 'Переезд')}
        {select('workFormat', 'Формат работы')}
        <InfoNote>Ответы видят только работодатели, которым Юпитер отправляет отклик</InfoNote>
      </EditScreen>
      {sheet ? (
        <OptionSheet
          visible
          title={SHEETS[sheet].title}
          options={SHEETS[sheet].options.map(o => ({ label: o, value: o }))}
          selected={answers[sheet]}
          onSelect={v => { set({ [sheet]: v } as Partial<ApplyAnswers>); setSheet(null); }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  subtitle: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.textTertiary,
  },
});
