import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useApp } from '@/hooks/useApp';
import { confirmAsync } from '@/services/confirm';
import { dbUploadFile } from '@/services/db';
import { patchResume, upsertAt, removeAt, MONTHS } from '@/lib/profileEdit';
import type { ResumeCertification } from '@/constants/types';
import {
  EditScreen, Field, SelectField, OptionSheet, useUnsavedGuard, type Option,
} from '@/components/profile/edit';
import { UploadIcon } from '@/components/profile/edit/icons';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';

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

/** base64 → байты. Своя реализация: atob есть не везде, где мы работаем. */
function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bufLen = Math.floor((clean.length * 3) / 4);
  const buf = new Uint8Array(bufLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0;
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
    buf[p++] = (a << 2) | (b >> 4);
    if (p < bufLen) buf[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < bufLen) buf[p++] = ((c & 3) << 6) | d;
  }
  return buf;
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
  const [fileUrl, setFileUrl] = useState(original?.fileUrl ?? '');
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
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
    fileUrl: original?.fileUrl ?? '',
  });

  const dirty = useMemo(() => (
    name !== initialRef.current.name
    || issuer !== initialRef.current.issuer
    || date !== initialRef.current.date
    || expiration !== initialRef.current.expiration
    || noExpiration !== initialRef.current.noExpiration
    || credentialUrl !== initialRef.current.credentialUrl
    || fileUrl !== initialRef.current.fileUrl
  ), [name, issuer, date, expiration, noExpiration, credentialUrl, fileUrl]);

  const valid = name.trim().length > 0;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      const record: ResumeCertification = {
        ...(original ?? {}),
        name: name.trim(),
        issuer: issuer.trim() || undefined,
        date: date || undefined,
        expiration: noExpiration ? undefined : (expiration || undefined),
        noExpiration,
        credentialUrl: credentialUrl.trim() || undefined,
        fileUrl: fileUrl || undefined,
      };
      const certifications = upsertAt(list, idx, record);
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
    if (!currentUser || idx == null) return;
    const ok = await confirmAsync({
      title: 'Удалить сертификат?',
      body: 'Запись нельзя будет вернуть.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      setBusy(true);
      await updateUser(patchResume(currentUser, { certifications: removeAt(list, idx) }));
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

  const pickFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      if (asset.size && asset.size > 10 * 1024 * 1024) {
        showToast('Файл больше 10 МБ', 'error');
        return;
      }
      setUploading(true);
      let bytes: Uint8Array;
      if (Platform.OS === 'web') {
        const resp = await fetch(asset.uri);
        bytes = new Uint8Array(await (await resp.blob()).arrayBuffer());
      } else {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        bytes = base64ToUint8Array(base64);
      }
      const contentType = asset.mimeType || 'application/octet-stream';
      const safeName = `certificate_${Date.now()}_${(asset.name || 'file').replace(/[^\w.-]+/g, '_')}`;
      const url = await dbUploadFile(safeName, bytes, contentType);
      setFileUrl(url);
      setFileName(asset.name || 'Файл');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось загрузить файл', 'error');
    } finally {
      setUploading(false);
    }
  };

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

        <TouchableOpacity style={s.attach} activeOpacity={0.75} onPress={pickFile} disabled={uploading}>
          <View style={s.attachIcon}>
            <UploadIcon size={22} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.attachTitle} numberOfLines={1}>
              {uploading ? 'Загружаем…' : fileUrl ? 'Файл прикреплён' : 'Прикрепить файл'}
            </Text>
            <Text style={s.attachSubtitle} numberOfLines={1}>
              {fileUrl ? (fileName || 'Нажмите, чтобы заменить') : 'PDF, JPG или PNG до 10 МБ'}
            </Text>
          </View>
        </TouchableOpacity>
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
  attach: {
    padding: 18, borderRadius: EditRadius.card, borderWidth: 2, borderColor: EditColors.ink, borderStyle: 'dashed',
    backgroundColor: EditColors.surface, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  attachIcon: {
    width: 44, height: 44, borderRadius: 13, backgroundColor: EditColors.accentSoft,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  attachTitle: { fontFamily: EditFonts.text800, fontSize: 15, color: EditColors.ink },
  attachSubtitle: { marginTop: 2, fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary },
});
