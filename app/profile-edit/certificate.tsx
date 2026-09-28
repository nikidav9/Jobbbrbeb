import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { confirmAsync } from '@/services/confirm';
import { patchResume, upsertAt, removeAt, MONTHS, normalizeHttpUrl } from '@/lib/profileEdit';
import type { ResumeCertification } from '@/constants/types';
import {
  EditScreen, Field, SelectField, OptionSheet, useUnsavedGuard, type Option,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

/** Экран `resume/07-certificate.html` — лицензия, сертификат или аккредитация. */

const CURRENT_YEAR = new Date().getFullYear();
const YEARS: string[] = [];
for (let y = CURRENT_YEAR; y >= 1960; y--) YEARS.push(String(y));
const MONTH_OPTIONS: Option[] = MONTHS.map((m) => ({ label: m, value: m }));
const YEAR_OPTIONS: Option[] = YEARS.map((y) => ({ label: y, value: y }));
const EXPIRATION_CHOICE_OPTIONS: Option[] = [
  { label: 'Бессрочно', value: 'none' },
  { label: 'Указать дату', value: 'date' },
];

function splitDate(value: string): { month?: string; year?: string } {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) return {};
  return { month: parts[0], year: parts[1] };
}

type DateStep = null | 'issueMonth' | 'issueYear' | 'expChoice' | 'expMonth' | 'expYear';

export default function CertificateScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const params = useLocalSearchParams<{ index?: string }>();

  const list = currentUser?.resume?.certifications ?? [];
  const idx = params.index != null ? Number(params.index) : undefined;
  const original = idx != null && Number.isFinite(idx) && idx >= 0 && idx < list.length ? list[idx] : undefined;
  const isNew = !original;

  const [name, setName] = useState(original?.name ?? '');
  const [issuer, setIssuer] = useState(original?.issuer ?? '');
  const [date, setDate] = useState(original?.date ?? '');
  const [expiration, setExpiration] = useState(original?.expiration ?? '');
  const [noExpiration, setNoExpiration] = useState(original?.noExpiration === true);
  const [credentialUrl, setCredentialUrl] = useState(original?.credentialUrl ?? '');
  const [busy, setBusy] = useState(false);

  const [step, setStep] = useState<DateStep>(null);
  const [pendingMonth, setPendingMonth] = useState<string | undefined>(undefined);

  const initialRef = useRef({
    name: original?.name ?? '',
    issuer: original?.issuer ?? '',
    date: original?.date ?? '',
    expiration: original?.expiration ?? '',
    noExpiration: original?.noExpiration === true,
    credentialUrl: original?.credentialUrl ?? '',
  });

  const dirty = useMemo(() => (
    name !== initialRef.current.name
    || issuer !== initialRef.current.issuer
    || date !== initialRef.current.date
    || expiration !== initialRef.current.expiration
    || noExpiration !== initialRef.current.noExpiration
    || credentialUrl !== initialRef.current.credentialUrl
  ), [name, issuer, date, expiration, noExpiration, credentialUrl]);

  const credentialUrlError = credentialUrl.trim() ? normalizeHttpUrl(credentialUrl).error : undefined;
  const valid = name.trim().length > 0 && !credentialUrlError;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      const record: ResumeCertification = {
        // Вложения — отдельная задача с приватным бакетом, здесь fileUrl не трогаем.
        ...(original ?? {}),
        name: name.trim(),
        issuer: issuer.trim() || undefined,
        date: date || undefined,
        expiration: noExpiration ? undefined : (expiration || undefined),
        noExpiration,
        credentialUrl: normalizeHttpUrl(credentialUrl).url,
      };
      const certifications = upsertAt(list, isNew ? undefined : idx, record);
      await updateUser(patchResume(currentUser, { certifications }));
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

  const handleDelete = async () => {
    if (!currentUser || isNew) return;
    const ok = await confirmAsync({
      title: 'Удалить сертификат?',
      body: 'Запись нельзя будет вернуть.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { certifications: removeAt(list, idx as number) }));
      showToast('Удалено');
      leave();
    } catch {
      showToast('Не удалось удалить. Попробуйте ещё раз', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openIssueDate = () => {
    setPendingMonth(splitDate(date).month);
    setStep('issueMonth');
  };
  const openExpiration = () => setStep('expChoice');

  const closeStep = () => { setStep(null); setPendingMonth(undefined); };

  if (!currentUser) return null;

  return (
    <>
      <EditScreen
        title="Сертификат"
        onBack={requestClose}
        onDelete={isNew ? undefined : handleDelete}
        primaryLabel={isNew ? 'Добавить' : 'Сохранить'}
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
      >
        <Text style={s.subtitle}>Лицензия, сертификат или аккредитация</Text>

        <Field
          label="Название"
          value={name}
          onChangeText={setName}
          placeholder="Например, Google Project Management"
        />

        <Field
          label="Кем выдан"
          value={issuer}
          onChangeText={setIssuer}
          placeholder="Организация"
        />

        <View style={s.row}>
          <View style={s.rowItem}>
            <SelectField
              label="Дата выдачи"
              value={date}
              placeholder="Месяц, год"
              onPress={openIssueDate}
            />
          </View>
          <View style={s.rowItem}>
            <SelectField
              label="Действует до"
              value={noExpiration ? 'Бессрочно' : expiration}
              placeholder="Месяц, год"
              onPress={openExpiration}
            />
          </View>
        </View>

        <Field
          label="Ссылка для проверки"
          optional
          value={credentialUrl}
          onChangeText={setCredentialUrl}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
        />
        {credentialUrlError ? <Text style={s.error}>{credentialUrlError}</Text> : null}
      </EditScreen>
      {dialog}

      <OptionSheet
        visible={step === 'issueMonth' || step === 'expMonth'}
        title="Месяц"
        options={MONTH_OPTIONS}
        selected={pendingMonth}
        onClose={closeStep}
        onSelect={(month) => {
          setPendingMonth(month);
          setStep(step === 'issueMonth' ? 'issueYear' : 'expYear');
        }}
      />

      <OptionSheet
        visible={step === 'issueYear' || step === 'expYear'}
        title="Год"
        options={YEAR_OPTIONS}
        selected={splitDate(step === 'issueYear' ? date : expiration).year}
        onClose={closeStep}
        onSelect={(year) => {
          const combined = `${pendingMonth} ${year}`;
          if (step === 'issueYear') {
            setDate(combined);
          } else {
            setExpiration(combined);
            setNoExpiration(false);
          }
          closeStep();
        }}
      />

      <OptionSheet
        visible={step === 'expChoice'}
        title="Действует до"
        options={EXPIRATION_CHOICE_OPTIONS}
        selected={noExpiration ? 'none' : expiration ? 'date' : undefined}
        onClose={closeStep}
        onSelect={(value) => {
          if (value === 'none') {
            setNoExpiration(true);
            setExpiration('');
            closeStep();
          } else {
            setPendingMonth(splitDate(expiration).month);
            setStep('expMonth');
          }
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  subtitle: {
    marginTop: -8, fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 14 * 1.45, color: EditColors.textTertiary,
  },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1, minWidth: 0 },
  error: { fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.danger },
});
