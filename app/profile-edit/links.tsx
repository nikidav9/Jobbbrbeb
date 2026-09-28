import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import type { LinkType, PersonalLink } from '@/constants/types';
import { patchPersonal, LINK_TYPES, upsertAt, removeAt, normalizeHttpUrl } from '@/lib/profileEdit';
import {
  EditScreen, FieldLabel, Field, Chip, ChipGroup, InfoNote, useUnsavedGuard, LinkIcon,
} from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

/** Разбирает легаси-строку `links` (переводы строк) в список ссылок типа «Другое». */
function parseLegacyLinks(links: string | undefined): PersonalLink[] {
  if (!links) return [];
  return links
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => ({ type: 'other' as LinkType, url }));
}

export default function LinksScreen() {
  const { currentUser, updateUser, showToast } = useApp();
  const { index: indexParam } = useLocalSearchParams<{ index?: string }>();

  const index = indexParam != null ? Number(indexParam) : undefined;
  const baseList = useMemo(
    () => currentUser?.personalDetails?.linksList ?? parseLegacyLinks(currentUser?.personalDetails?.links),
    [currentUser],
  );
  const existing = index != null && Number.isFinite(index) ? baseList[index] : undefined;
  const isNew = !existing;

  const [type, setType] = useState<LinkType | null>(existing?.type ?? null);
  const [urlText, setUrlText] = useState(existing?.url ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [busy, setBusy] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);

  const normalized = normalizeHttpUrl(urlText);
  const urlError = urlTouched && urlText.trim().length > 0 ? normalized.error : undefined;

  const dirty = type !== (existing?.type ?? null)
    || urlText !== (existing?.url ?? '')
    || label !== (existing?.label ?? '');
  const valid = !!type && urlText.trim().length > 0 && !normalized.error;

  const save = async (): Promise<boolean> => {
    if (!currentUser || !valid || !type) return false;
    try {
      setBusy(true);
      const item: PersonalLink = { type, url: normalized.url ?? urlText.trim(), label: label.trim() || undefined };
      const nextList = upsertAt(baseList, index != null && existing ? index : undefined, item);
      await updateUser(patchPersonal(currentUser, { linksList: nextList }));
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
    if (!currentUser || index == null || !existing) return;
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, { linksList: removeAt(baseList, index) }));
      showToast('Удалено');
      leave();
    } catch {
      showToast('Не удалось удалить. Попробуйте ещё раз', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!currentUser) return null;

  return (
    <>
      <EditScreen
        title="Ссылка"
        onBack={requestClose}
        primaryLabel={isNew ? 'Добавить' : 'Сохранить'}
        primaryDisabled={!dirty || !valid}
        busy={busy}
        onPrimary={async () => { if (await save()) leave(); }}
        onDelete={isNew ? undefined : handleDelete}
      >
        <Text style={s.subtitle}>Портфолио, профиль или другой профессиональный ресурс</Text>

        <View style={{ gap: 10 }}>
          <FieldLabel label="Что это" />
          <ChipGroup>
            {LINK_TYPES.map((t) => (
              <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />
            ))}
          </ChipGroup>
        </View>

        <View style={{ gap: 8 }}>
          <Field
            label="Ссылка"
            value={urlText}
            onChangeText={(text) => { setUrlText(text); setUrlTouched(true); }}
            placeholder="https://"
            left={<LinkIcon size={20} />}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {urlError ? <Text style={s.error}>{urlError}</Text> : null}
        </View>

        <Field
          label="Подпись"
          optional
          value={label}
          onChangeText={setLabel}
          placeholder="Например, Мои проекты"
        />

        <InfoNote>Можно добавить до 5 ссылок. Работодатель увидит их в вашем резюме</InfoNote>
      </EditScreen>
      {dialog}
    </>
  );
}

const s = StyleSheet.create({
  subtitle: {
    fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.textTertiary,
  },
  error: { fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.danger },
});
