import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Linking,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { readFileBase64 } from '@/lib/fileBytes';
import { useApp } from '@/hooks/useApp';
import { confirmAsync } from '@/services/confirm';
import {
  dbSaveCertificateFile, dbSignCertificateFile, dbDeleteCertificateFile,
} from '@/services/db';
import { patchResume, upsertAt, removeAt, MONTHS, normalizeHttpUrl } from '@/lib/profileEdit';
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
  const [filePath, setFilePath] = useState(original?.filePath ?? '');
  const [fileName, setFileName] = useState(original?.fileName ?? '');
  const [uploading, setUploading] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);
  const [busy, setBusy] = useState(false);

  const [step, setStep] = useState<DateStep>(null);
  const [pendingMonth, setPendingMonth] = useState<string | undefined>(undefined);

  // Путь файла, который надо стереть из бакета после того, как запись успешно
  // сохранится — не раньше: сорвавшееся сохранение не должно терять старый файл.
  const oldFilePathToDeleteRef = useRef<string | undefined>(undefined);
  // Только что загруженный файл, ещё не попавший в сохранённую запись. Если
  // экран закрыли без сохранения («Не сохранять» / просто ушли) — файл осиротел.
  const orphanFilePathRef = useRef<string | undefined>(undefined);

  React.useEffect(() => () => {
    if (orphanFilePathRef.current) {
      dbDeleteCertificateFile(orphanFilePathRef.current).catch((error) => {
        console.warn('[certificate] orphan file cleanup failed', error);
      });
    }
  }, []);

  const initialRef = useRef({
    name: original?.name ?? '',
    issuer: original?.issuer ?? '',
    date: original?.date ?? '',
    expiration: original?.expiration ?? '',
    noExpiration: original?.noExpiration === true,
    credentialUrl: original?.credentialUrl ?? '',
    filePath: original?.filePath ?? '',
  });

  const dirty = useMemo(() => (
    name !== initialRef.current.name
    || issuer !== initialRef.current.issuer
    || date !== initialRef.current.date
    || expiration !== initialRef.current.expiration
    || noExpiration !== initialRef.current.noExpiration
    || credentialUrl !== initialRef.current.credentialUrl
    || filePath !== initialRef.current.filePath
  ), [name, issuer, date, expiration, noExpiration, credentialUrl, filePath]);

  const credentialUrlError = credentialUrl.trim() ? normalizeHttpUrl(credentialUrl).error : undefined;
  const valid = name.trim().length > 0 && !credentialUrlError;

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
        credentialUrl: normalizeHttpUrl(credentialUrl).url,
        filePath: filePath || undefined,
        fileName: filePath ? (fileName || undefined) : undefined,
      };
      const certifications = upsertAt(list, isNew ? undefined : idx, record);
      await updateUser(patchResume(currentUser, { certifications }));
      // Запись сохранена — новый файл больше не осиротевший, а старый (если
      // заменяли/убирали вложение) можно стереть из бакета.
      orphanFilePathRef.current = undefined;
      if (oldFilePathToDeleteRef.current) {
        const staleFile = oldFilePathToDeleteRef.current;
        oldFilePathToDeleteRef.current = undefined;
        dbDeleteCertificateFile(staleFile).catch((error) => {
          console.warn('[certificate] stale file cleanup failed', error);
        });
      }
      showToast('Сохранено');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось сохранить. Попробуйте ещё раз', 'error');
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
      if (original?.filePath) {
        dbDeleteCertificateFile(original.filePath).catch((error) => {
          console.warn('[certificate] record file cleanup failed', error);
        });
      }
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
      const base64 = await readFileBase64(asset.uri);
      const saved = await dbSaveCertificateFile(asset.name || 'Файл', base64);
      // Прежний файл: ещё не сохранённый в записи — стираем сразу (иначе он
      // навсегда останется в хранилище); сохранённый — только после успешного
      // сохранения записи, и помним именно его, а не промежуточные.
      if (filePath && filePath !== saved.path) {
        if (filePath === orphanFilePathRef.current) {
          dbDeleteCertificateFile(filePath).catch((error) => {
            console.warn('[certificate] replaced unsaved file cleanup failed', error);
          });
        } else {
          oldFilePathToDeleteRef.current = filePath;
        }
      }
      orphanFilePathRef.current = saved.path;
      setFilePath(saved.path);
      setFileName(saved.fileName || asset.name || 'Файл');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось загрузить файл', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = () => {
    if (!filePath) return;
    if (filePath === orphanFilePathRef.current) {
      // Файл ещё не сохранён в записи — стираем сразу, ждать нечего.
      dbDeleteCertificateFile(filePath).catch((error) => {
        console.warn('[certificate] unsaved file cleanup failed', error);
      });
      orphanFilePathRef.current = undefined;
    } else {
      oldFilePathToDeleteRef.current = filePath;
    }
    setFilePath('');
    setFileName('');
  };

  const openFile = async () => {
    if (!filePath || openingFile) return;
    setOpeningFile(true);
    try {
      const url = await dbSignCertificateFile(filePath);
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось открыть файл', 'error');
    } finally {
      setOpeningFile(false);
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
        {credentialUrlError ? <Text style={s.error}>{credentialUrlError}</Text> : null}

        {filePath ? (
          <View style={s.attach}>
            <View style={s.attachIcon}>
              <UploadIcon size={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.attachTitle} numberOfLines={1}>{fileName || 'Файл прикреплён'}</Text>
              <Text style={s.attachSubtitle}>Открыть можете только вы</Text>
            </View>
            <View style={s.attachActions}>
              <TouchableOpacity onPress={openFile} disabled={openingFile} activeOpacity={0.75}>
                <Text style={s.attachActionText}>{openingFile ? 'Открываем…' : 'Открыть'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={removeFile} activeOpacity={0.75}>
                <Text style={[s.attachActionText, s.attachActionDanger]}>Убрать</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={s.attach} activeOpacity={0.75} onPress={pickFile} disabled={uploading}>
            <View style={s.attachIcon}>
              <UploadIcon size={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.attachTitle} numberOfLines={1}>
                {uploading ? 'Загружаем…' : 'Прикрепить файл'}
              </Text>
              <Text style={s.attachSubtitle} numberOfLines={1}>PDF, JPG или PNG до 10 МБ</Text>
            </View>
          </TouchableOpacity>
        )}
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
  attachActions: { flexShrink: 0, gap: 8, alignItems: 'flex-end' },
  attachActionText: { fontFamily: EditFonts.text700, fontSize: 13, color: EditColors.ink },
  attachActionDanger: { color: EditColors.danger },
});
