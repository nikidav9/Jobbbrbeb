import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { BackIcon } from './icons';

/**
 * Каркас экрана редактирования: шапка (назад + заголовок + «Удалить»),
 * прокручиваемый контент и закреплённая кнопка внизу с растворением фона —
 * общий для всех 20 экранов, эталон `docs/design/profile-edit/README.md`
 * («Общие правила экранов»).
 */
export function EditScreen({
  title, titleCount, onBack, onDelete, primaryLabel, primaryDisabled, onPrimary, busy,
  children, scroll = true, keyboardShouldPersistTaps,
}: {
  title: string;
  titleCount?: number | string;
  onBack: () => void;
  onDelete?: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void | Promise<void>;
  busy?: boolean;
  children?: React.ReactNode;
  scroll?: boolean;
  keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
}) {
  const insets = useSafeAreaInsets();
  const disabled = !!primaryDisabled || !!busy;
  // `busy` включается только после ререндера — двойное нажатие до него зовёт
  // onPrimary дважды (второй save/leave уводит с экрана). Флаг синхронный.
  const inFlightRef = useRef(false);

  const handlePrimary = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await onPrimary();
    } finally {
      inFlightRef.current = false;
    }
  };

  const content = (
    <>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity
          onPress={onBack}
          style={s.backBtn}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Назад в профиль"
        >
          <BackIcon size={20} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>
          {title}
          {titleCount != null ? <Text style={s.titleCount}> {titleCount}</Text> : null}
        </Text>
        {onDelete ? (
          <TouchableOpacity onPress={onDelete} activeOpacity={0.75}>
            <Text style={s.deleteText}>Удалить</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {scroll ? (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={s.scrollContent}>{children}</View>
      )}
    </>
  );

  return (
    <View style={s.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {content}
      </KeyboardAvoidingView>

      {/* Растворение фона над кнопкой — видно, что экран прокручивается. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(245,239,230,0)', EditColors.bg]}
        style={[s.fade, { bottom: 0 }]}
      />

      <View style={[s.buttonWrap, { bottom: Math.max(insets.bottom, 12) + 20 }]}>
        {!disabled ? <View pointerEvents="none" style={s.buttonShadow} /> : null}
        <TouchableOpacity
          onPress={handlePrimary}
          disabled={disabled}
          activeOpacity={0.85}
          style={[s.button, disabled && s.buttonDisabled]}
        >
          {busy ? (
            <ActivityIndicator color={disabled ? EditColors.disabledText : EditColors.ink} />
          ) : (
            <Text style={[s.buttonText, disabled && s.buttonTextDisabled]}>{primaryLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: EditColors.bg },
  // Без фиксированной высоты: сверху добавляется отступ под вырез телефона
  // (insets.top, ~59 на iPhone), и при height: 56 кнопка «назад» и заголовок
  // вываливались ниже шапки — прокрутка рисовала поля поверх них. Свой фон и
  // zIndex — контент уходит под шапку, а не налезает на неё.
  header: {
    paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14,
    minHeight: 44, backgroundColor: EditColors.bg, zIndex: 1,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title: {
    flex: 1, minWidth: 0, fontFamily: EditFonts.heading, fontSize: 20, letterSpacing: -0.01 * 20, color: EditColors.ink,
  },
  titleCount: { fontFamily: EditFonts.heading, color: EditColors.placeholder },
  deleteText: {
    flexShrink: 0, fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.danger,
    textDecorationLine: 'underline',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 130, gap: 22 },
  fade: { position: 'absolute', left: 0, right: 0, height: 130 },
  buttonWrap: { position: 'absolute', left: 20, right: 20 },
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
