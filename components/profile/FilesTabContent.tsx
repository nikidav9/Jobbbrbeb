import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeIllustration } from './illustrations';
import { ResumeFileCard } from './ResumeFileCard';
import { UploadIcon } from './icons';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';
import type { ResumeProfile } from '@/constants/types';
import type { ResumeVaultItem } from '@/services/db';

export function FilesTabContent({
  items, loading, loadFailed, legacyResume, busyId, importing,
  onAdd, onOpen, onSelect, onDelete,
}: {
  items: ResumeVaultItem[];
  loading: boolean;
  loadFailed: boolean;
  legacyResume?: ResumeProfile;
  busyId: string | null;
  importing: boolean;
  onAdd: () => void;
  onOpen: (item: ResumeVaultItem) => void;
  onSelect: (item: ResumeVaultItem) => void;
  onDelete: (item: ResumeVaultItem) => void;
}) {
  const active = items.find(item => item.selected) ?? null;
  const others = items.filter(item => item !== active);

  return (
    <View style={s.content}>
      <View style={s.intro}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={s.introTitle}>Сейф резюме</Text>
          <Text style={s.introText}>
            Храните несколько PDF и выбирайте активное — оно сразу подтянется в профиль
          </Text>
        </View>
        <SafeIllustration size={76} />
      </View>

      <TouchableOpacity style={s.uploadOuter} onPress={onAdd} disabled={importing} activeOpacity={0.85}>
        <View pointerEvents="none" style={s.uploadShadow} />
        <View style={s.uploadBtn}>
          {importing
            ? <ActivityIndicator size="small" color={ProfileColors.ink} />
            : <UploadIcon size={18} color={ProfileColors.ink} />}
          <Text style={s.uploadText}>{importing ? 'Добавляем PDF…' : 'Загрузить PDF'}</Text>
        </View>
      </TouchableOpacity>
      <Text style={s.uploadHint}>До 10 МБ · файл хранится приватно</Text>

      {loading ? (
        <View style={s.state}>
          <ActivityIndicator size="small" color={ProfileColors.ink} />
          <Text style={s.stateText}>Загружаем ваши резюме…</Text>
        </View>
      ) : loadFailed ? (
        <View style={s.state}>
          <Text style={s.stateText}>Не удалось загрузить сейф. Откройте вкладку ещё раз.</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={s.state}>
          <Text style={s.stateTitle}>В сейфе пока нет PDF</Text>
          <Text style={s.stateText}>
            {legacyResume
              ? 'Текущее резюме было загружено до появления сейфа. Добавьте PDF ещё раз — после этого его можно будет смотреть и переключать здесь.'
              : 'Добавьте первое резюме — оно автоматически станет активным в профиле.'}
          </Text>
        </View>
      ) : (
        <>
          {active ? (
            <View style={s.section}>
              <Text style={s.eyebrow}>СЕЙЧАС В ПРОФИЛЕ</Text>
              <ResumeFileCard
                active
                fileName={active.fileName}
                meta={[active.resume.desiredPosition, active.importedAt ? new Date(active.importedAt).toLocaleDateString('ru-RU') : null].filter(Boolean).join(' · ')}
                onOpen={() => onOpen(active)}
                busy={busyId === active.id}
              />
            </View>
          ) : null}

          {others.length ? (
            <View style={s.section}>
              <Text style={s.eyebrow}>ДРУГИЕ ВЕРСИИ · {others.length}</Text>
              <View style={{ gap: 8 }}>
                {others.map(item => (
                  <ResumeFileCard
                    key={item.id}
                    active={false}
                    fileName={item.fileName}
                    meta={[item.resume.desiredPosition, item.importedAt ? new Date(item.importedAt).toLocaleDateString('ru-RU') : null].filter(Boolean).join(' · ')}
                    onOpen={() => onOpen(item)}
                    onSelect={() => onSelect(item)}
                    onDelete={() => onDelete(item)}
                    busy={busyId === item.id}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  content: { gap: 14 },
  intro: {
    backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 18,
    flexDirection: 'row', gap: 14, alignItems: 'center',
  },
  introTitle: { fontFamily: ProfileFonts.headingExtra, fontSize: 18, color: ProfileColors.ink },
  introText: { fontFamily: ProfileFonts.textRegular, fontSize: 13, lineHeight: 19, color: ProfileColors.muted },

  uploadOuter: { width: '100%', height: 54 },
  uploadShadow: {
    position: 'absolute', top: 4, left: 3, right: -3, bottom: -4,
    backgroundColor: ProfileColors.ink, borderRadius: ProfileRadius.pill,
  },
  uploadBtn: {
    height: 54, borderRadius: ProfileRadius.pill, borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    backgroundColor: ProfileColors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  uploadText: { fontFamily: ProfileFonts.textBold, fontSize: 15, color: ProfileColors.ink },
  uploadHint: { marginTop: -8, textAlign: 'center', fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted },

  state: { backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 20, gap: 6, alignItems: 'center' },
  stateTitle: { fontFamily: ProfileFonts.headingBold, fontSize: 15, color: ProfileColors.ink },
  stateText: { fontFamily: ProfileFonts.textRegular, fontSize: 13, color: ProfileColors.muted, textAlign: 'center', lineHeight: 19 },

  section: { gap: 8 },
  eyebrow: { fontFamily: ProfileFonts.textBold, fontSize: 11, letterSpacing: 0.9, color: ProfileColors.muted, paddingHorizontal: 4 },
});
