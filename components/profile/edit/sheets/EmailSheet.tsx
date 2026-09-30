import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { patchPersonal } from '@/lib/profileEdit';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { BottomSheet } from '../BottomSheet';
import { Field } from '../Field';
import { ConfirmDialog } from '../ConfirmDialog';
import { MailIcon, CloseIcon, LockIcon } from '../icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Шторка «Email для связи» — `docs/design/profile-edit/personal/12-email.html`.
 * Правит только `personalDetails.contactEmail`: «Почта для входа» (`User.email`)
 * из профиля не редактируется, о чём говорит подсказка с замком.
 */
export function EmailSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { currentUser, updateUser, showToast } = useApp();
  const initial = currentUser?.personalDetails?.contactEmail ?? currentUser?.resume?.email ?? '';
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  // Шторка переиспользуется между открытиями — поле должно каждый раз
  // подхватывать актуальное значение, а не то, что осталось от прошлого раза.
  useEffect(() => {
    if (visible) setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmed = value.trim();
  const dirty = trimmed !== initial.trim();
  const valid = trimmed.length > 0 && EMAIL_RE.test(trimmed);

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      setBusy(true);
      await updateUser(patchPersonal(currentUser, { contactEmail: trimmed }));
      showToast('Сохранено');
      return true;
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Не удалось сохранить. Попробуйте ещё раз', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (!dirty) { onClose(); return; }
    setConfirmVisible(true);
  };
  const discard = () => { setConfirmVisible(false); onClose(); };
  const confirmSave = async () => {
    setConfirmVisible(false);
    if (await save()) onClose();
  };

  if (!currentUser) return null;
  const disabled = !dirty || !valid || busy;

  return (
    <>
      <BottomSheet visible={visible} onClose={requestClose}>
        <View style={s.header}>
          <View style={s.iconBox}>
            <MailIcon size={22} />
          </View>
          <Text style={s.title} numberOfLines={1}>Email для связи</Text>
          <TouchableOpacity onPress={requestClose} style={s.closeBtn} accessibilityLabel="Закрыть" accessibilityRole="button">
            <CloseIcon size={16} />
          </TouchableOpacity>
        </View>

        <Text style={s.hint}>Сюда работодатели пришлют ответ на отклик и приглашение на собеседование</Text>

        <View style={{ marginTop: 18 }}>
          <Field
            value={value}
            onChangeText={setValue}
            placeholder="name@mail.ru"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Email для связи"
          />
        </View>

        <View style={s.note}>
          <LockIcon size={18} color={EditColors.textTertiary} />
          <Text style={s.noteText}>Почта для входа не меняется — она задаётся в настройках безопасности</Text>
        </View>

        <View style={s.buttonWrap}>
          {!disabled ? <View pointerEvents="none" style={s.buttonShadow} /> : null}
          <TouchableOpacity
            onPress={confirmSave}
            disabled={disabled}
            activeOpacity={0.85}
            style={[s.button, disabled && s.buttonDisabled]}
          >
            <Text style={[s.buttonText, disabled && s.buttonTextDisabled]}>Сохранить</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmVisible}
        title="Сохранить изменения?"
        confirmLabel="Сохранить"
        cancelLabel="Не сохранять"
        onConfirm={confirmSave}
        onCancel={discard}
        onDismiss={() => setConfirmVisible(false)}
      />
    </>
  );
}

const s = StyleSheet.create({
  header: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    flexShrink: 0, width: 44, height: 44, borderRadius: 13, backgroundColor: EditColors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, minWidth: 0, fontFamily: EditFonts.heading, fontSize: 19, color: EditColors.ink },
  closeBtn: {
    flexShrink: 0, width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { marginTop: 12, fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.label },
  note: { marginTop: 14, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  noteText: { flex: 1, fontFamily: EditFonts.text600, fontSize: 13, lineHeight: 19, color: EditColors.textTertiary },
  buttonWrap: { marginTop: 22 },
  buttonShadow: {
    position: 'absolute', top: 4, left: 4, right: -4, bottom: -4,
    backgroundColor: EditColors.ink, borderRadius: EditRadius.button,
  },
  button: {
    height: 60, borderRadius: EditRadius.button, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.accent, alignItems: 'center', justifyContent: 'center',
  },
  buttonDisabled: { borderWidth: 0, backgroundColor: EditColors.disabledBg },
  buttonText: { fontFamily: EditFonts.text800, fontSize: 18, color: EditColors.ink },
  buttonTextDisabled: { color: EditColors.disabledText },
});
