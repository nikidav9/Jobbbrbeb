import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useApp } from '@/hooks/useApp';
import { dbSetContactPhone } from '@/services/db';
import { patchPersonal } from '@/lib/profileEdit';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { BottomSheet } from '../BottomSheet';
import { ConfirmDialog } from '../ConfirmDialog';
import { Toggle } from '../Toggle';
import { PhoneIcon, CloseIcon, ChevronDownIcon } from '../icons';
import { nationalDigits, formatNationalDigits } from '@/lib/phone';

/**
 * Шторка «Телефон» — `docs/design/profile-edit/personal/13-phone.html`.
 * Решение владельца: SMS-кода нет, кнопка «Сохранить» сразу зовёт
 * `dbSetContactPhone` (без промежуточного шага подтверждения кодом).
 */
export function PhoneSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { currentUser, updateUser, showToast } = useApp();
  const initialDigits = nationalDigits(currentUser?.phone);
  const initialShowPhone = currentUser?.personalDetails?.showPhone ?? true;
  const [digits, setDigits] = useState(initialDigits);
  const [showPhone, setShowPhone] = useState(initialShowPhone);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setDigits(initialDigits);
      setShowPhone(initialShowPhone);
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dirtyPhone = digits !== initialDigits;
  const dirtyShowPhone = showPhone !== initialShowPhone;
  const dirty = dirtyPhone || dirtyShowPhone;
  const valid = digits.length === 10;

  const save = async (): Promise<boolean> => {
    if (!currentUser) return false;
    setServerError(null);
    try {
      setBusy(true);
      let updated = currentUser;
      if (dirtyPhone) {
        const newPhone = await dbSetContactPhone(currentUser.id, `7${digits}`);
        updated = { ...updated, phone: newPhone ?? '' };
      }
      if (dirtyShowPhone) {
        updated = patchPersonal(updated, { showPhone });
      }
      await updateUser(updated);
      showToast('Сохранено');
      return true;
    } catch (e) {
      setServerError(e instanceof Error && e.message ? e.message : 'Не удалось сохранить. Попробуйте ещё раз');
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
            <PhoneIcon size={22} />
          </View>
          <Text style={s.title} numberOfLines={1}>Телефон</Text>
          <TouchableOpacity onPress={requestClose} style={s.closeBtn} accessibilityLabel="Закрыть" accessibilityRole="button">
            <CloseIcon size={16} />
          </TouchableOpacity>
        </View>

        <View style={s.row}>
          <View style={s.codeBox} accessibilityLabel="Код страны +7">
            <Text style={s.codeText}>+7</Text>
            <ChevronDownIcon size={16} color={EditColors.ink} />
          </View>
          <View style={s.inputWrap}>
            <TextInput
              value={formatNationalDigits(digits)}
              onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 10))}
              placeholder="999 000-00-00"
              placeholderTextColor={EditColors.placeholder}
              keyboardType="phone-pad"
              accessibilityLabel="Номер телефона"
              style={s.input}
            />
          </View>
        </View>

        <Toggle
          value={showPhone}
          onValueChange={setShowPhone}
          label="Показывать номер работодателям"
        />

        {serverError ? <Text style={s.error}>{serverError}</Text> : null}

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
  row: { marginTop: 20, flexDirection: 'row', gap: 10 },
  codeBox: {
    flexShrink: 0, height: 56, paddingHorizontal: 12, borderRadius: EditRadius.field,
    borderWidth: 2, borderColor: EditColors.ink, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  codeText: { fontFamily: EditFonts.text800, fontSize: 16, color: EditColors.ink },
  inputWrap: { flexGrow: 1, minWidth: 0 },
  input: {
    height: 56, borderRadius: EditRadius.field, paddingHorizontal: 16,
    borderWidth: 2, borderColor: EditColors.ink, backgroundColor: EditColors.surface,
    fontFamily: EditFonts.text700, fontSize: 17, color: EditColors.ink,
  },
  error: { marginTop: 12, fontFamily: EditFonts.text600, fontSize: 13, lineHeight: 19, color: EditColors.danger },
  buttonWrap: { marginTop: 20 },
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
