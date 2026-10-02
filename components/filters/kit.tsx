/**
 * Элементы экранов фильтров — 1:1 с макетом «JT-filters» (27.09.2026):
 * каркас с шапкой («назад» 44 с контуром, заголовок Unbounded, «Сбросить» с
 * оранжевым подчёркиванием) и закреплённой кнопкой внизу (60 pt, скругление
 * 30, тень 4/4, растворение фона над ней), чип 40/20, чекбокс 26, переключатель
 * 52×32, иконки специализаций из макета.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, type ScrollView as SV } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Circle, Ellipse } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/ui/BackButton';
import { jtBackStyle } from '@/components/ui/jt';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import type { VacancySpec, VacancyLevel } from '@/services/vacancyFacets';

// ── Варианты разделов (общие для «Всех фильтров» и отдельных экранов) ──────
export const SALARY_CHIPS: { value: number; label: string }[] = [
  { value: 0, label: 'Любая' },
  { value: 150000, label: 'от 150 000' },
  { value: 200000, label: 'от 200 000' },
  { value: 250000, label: 'от 250 000' },
  { value: 350000, label: 'от 350 000' },
];

// Грейды макета. Стажёров отдельной кнопкой в макете нет — они идут с Junior.
export const GRADES: { label: string; ids: VacancyLevel[] }[] = [
  { label: 'Junior', ids: ['intern', 'junior'] },
  { label: 'Middle', ids: ['middle'] },
  { label: 'Senior', ids: ['senior'] },
  { label: 'Lead / Manager', ids: ['lead'] },
  { label: 'C-level', ids: ['head'] },
];

// Формат: лента только по Москве и удалёнке (решение владельца 26.09) —
// в макете ещё Питер, другие города и релокейт, но они всегда были бы пусты.
export const FORMATS: { id: 'office' | 'hybrid' | 'remote'; chip: string; title: string; sub: string }[] = [
  { id: 'office', chip: 'Москва · офис', title: 'Москва', sub: 'Офис' },
  { id: 'hybrid', chip: 'Москва · гибрид', title: 'Москва', sub: 'Гибрид' },
  { id: 'remote', chip: 'Удалённо', title: 'Полная удалёнка', sub: 'Из любого города' },
];

export const POSTED: { id: 'day' | '3days' | 'week' | 'month'; label: string }[] = [
  { id: 'day', label: 'За сутки' },
  { id: '3days', label: 'За 3 дня' },
  { id: 'week', label: 'За неделю' },
  { id: 'month', label: 'За месяц' },
];

export function toggleIn<T>(list: T[], items: T[]): T[] {
  const on = items.every(i => list.includes(i));
  return on ? list.filter(x => !items.includes(x)) : [...list, ...items.filter(i => !list.includes(i))];
}

// ── Каркас экрана ───────────────────────────────────────────────────────────
export function FilterScaffold({
  title, titleSize = 24, subtitle, onBack, onReset, button, children, scrollRef,
}: {
  title: string;
  titleSize?: number;
  subtitle?: string;
  onBack: () => void;
  onReset: () => void;
  button: { label: string; onPress: () => void; count?: number; testID?: string };
  children: React.ReactNode;
  scrollRef?: React.RefObject<SV | null>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={k.safe}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[k.body, { paddingTop: insets.top + rs(12), paddingBottom: insets.bottom + rs(130) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={k.head}>
          <BackButton onPress={onBack} style={jtBackStyle} label="Назад" />
          <Text style={[k.title, { fontSize: rf(titleSize) }]} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
          <TouchableOpacity onPress={onReset} hitSlop={8} accessibilityRole="button" testID="filters-reset">
            <Text style={k.reset}>Сбросить</Text>
          </TouchableOpacity>
        </View>
        {subtitle ? <Text style={k.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
      <LinearGradient
        colors={['rgba(245,239,230,0)', JT.background, JT.background]}
        locations={[0, 0.5, 1]}
        style={[k.fade, { height: rs(140) + insets.bottom }]}
        pointerEvents="none"
      />
      <View style={[k.btnWrap, { bottom: insets.bottom + rs(24) }]}>
        <View style={k.btnShadow} pointerEvents="none" />
        <TouchableOpacity style={k.btn} onPress={button.onPress} activeOpacity={0.85}
          accessibilityRole="button" testID={button.testID ?? 'filters-apply'}>
          <Text style={k.btnTxt}>{button.label}</Text>
          {button.count ? (
            <View style={k.btnCount}><Text style={k.btnCountTxt}>{button.count}</Text></View>
          ) : null}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function SectionTitle({ title, hint, link }: {
  title: string; hint?: string; link?: { label: string; onPress: () => void };
}) {
  return (
    <View style={k.secHead}>
      <Text style={k.secTitle}>{title}{hint ? <Text style={k.secHint}>{'  '}{hint}</Text> : null}</Text>
      {link ? (
        <TouchableOpacity onPress={link.onPress} hitSlop={8} accessibilityRole="link">
          <Text style={k.secLink}>{link.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function FChip({ label, on, onPress, big }: { label: string; on: boolean; onPress: () => void; big?: boolean }) {
  return (
    <TouchableOpacity
      style={[k.chip, big && k.chipBig, on && k.chipOn]} onPress={onPress} activeOpacity={0.8}
      accessibilityRole="button" accessibilityState={{ selected: on }}
    >
      <Text style={[k.chipTxt, big && k.chipTxtBig, on && k.chipTxtOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Chips({ children }: { children: React.ReactNode }) {
  return <View style={k.chips}>{children}</View>;
}

export function FCheck({ on }: { on: boolean }) {
  return (
    <View style={[k.check, on && k.checkOn]}>
      {on ? (
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path d="M5 12l5 5l9-10" stroke={JT.ink} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      ) : null}
    </View>
  );
}

export function FToggle({ on }: { on: boolean }) {
  return (
    <View style={[k.toggle, on && k.toggleOn]}>
      <View style={k.knob} />
    </View>
  );
}

/** Строка-переключатель в белой карточке («Скрыть просмотренные», «Только с зарплатой»). */
export function ToggleRow({ title, sub, on, onPress, testID }: {
  title: string; sub: string; on: boolean; onPress: () => void; testID?: string;
}) {
  return (
    <TouchableOpacity style={k.toggleRow} onPress={onPress} activeOpacity={0.85}
      accessibilityRole="switch" accessibilityState={{ checked: on }} testID={testID}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={k.toggleTitle}>{title}</Text>
        <Text style={k.toggleSub}>{sub}</Text>
      </View>
      <FToggle on={on} />
    </TouchableOpacity>
  );
}

// ── Иконки специализаций — пути из assets/icons/specializations макета ────
const S = { stroke: JT.ink, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const SPEC_ICON: Record<VacancySpec, React.ReactNode> = {
  backend: <><Ellipse cx={12} cy={6} rx={7} ry={3} {...S} /><Path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" {...S} /></>,
  frontend: <><Rect x={3} y={4} width={18} height={16} rx={2.5} {...S} /><Path d="M3 9h18" {...S} /></>,
  mobile: <><Rect x={6} y={2} width={12} height={20} rx={2.5} {...S} /><Path d="M11 18h2" {...S} /></>,
  qa: <><Rect x={8} y={7} width={8} height={13} rx={4} {...S} /><Path d="M9.5 7a2.5 2.5 0 0 1 5 0M4 12h4M16 12h4M4 18l4-2M20 18l-4-2M5 6l3 2M19 6l-3 2" {...S} /></>,
  management: <><Rect x={4} y={4} width={7} height={7} rx={1.5} {...S} /><Rect x={13} y={4} width={7} height={7} rx={1.5} {...S} /><Rect x={4} y={13} width={7} height={7} rx={1.5} {...S} /><Rect x={13} y={13} width={7} height={7} rx={1.5} {...S} /></>,
  design: <><Path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.6-.8 1.6-1.6c0-1.3-1-1.5-1-2.7c0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" {...S} /><Circle cx={7.5} cy={11} r={1.2} {...S} /><Circle cx={10.5} cy={7} r={1.2} {...S} /><Circle cx={15} cy={7.5} r={1.2} {...S} /></>,
  analytics: <Path d="M5 20v-5M11 20V9M17 20V4M3 20h18" {...S} />,
  // Рупор в том же штрихе — «Маркетинг и контент» (01.10.2026).
  marketing: <><Path d="M4 10v4a1 1 0 0 0 1 1h3l7 4V5L8 9H5a1 1 0 0 0-1 1z" {...S} /><Path d="M8 15l1.5 5M18.5 9.5a3.5 3.5 0 0 1 0 5" {...S} /></>,
  devops: <><Rect x={3} y={4} width={18} height={16} rx={2.5} {...S} /><Path d="M7 9l3 3l-3 3M13 15h4" {...S} /></>,
  security: <Path d="M12 3l8 3v6c0 4.5-3.4 8-8 9c-4.6-1-8-4.5-8-9V6z" {...S} />,
  support: <><Path d="M4 14v-2a8 8 0 0 1 16 0v2" {...S} /><Rect x={3} y={13} width={4} height={6} rx={1.5} {...S} /><Rect x={17} y={13} width={4} height={6} rx={1.5} {...S} /><Path d="M19 19c0 1.5-1.5 2-4 2h-2" {...S} /></>,
  data: <><Rect x={6} y={6} width={12} height={12} rx={2} {...S} /><Path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" {...S} /></>,
  hr: <><Circle cx={12} cy={12} r={9} {...S} /><Circle cx={12} cy={10} r={3} {...S} /><Path d="M6.5 18.5c1.2-2 3.2-3.2 5.5-3.2s4.3 1.2 5.5 3.2" {...S} /></>,
  // Финансы и юристы (02.10.2026) — в том же штрихе: монета с ₽ и весы.
  finance: <><Circle cx={12} cy={12} r={9} {...S} /><Path d="M10 17V7h3a2.5 2.5 0 0 1 0 5h-4.5M8.5 14.5H14" {...S} /></>,
  legal: <Path d="M12 3v18M8 21h8M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z" {...S} />,
  top: <><Path d="M8 4h8v6a4 4 0 0 1-8 0z" {...S} /><Path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4M8 21h8M9 18h6" {...S} /></>,
  // «1С» в макете нет — калькулятор в том же штрихе.
  onec: <><Rect x={5} y={3} width={14} height={18} rx={2.5} {...S} /><Path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" {...S} /></>,
};

export function SpecTile({ spec, on }: { spec: VacancySpec; on: boolean }) {
  return (
    <View style={[k.tile, on && k.tileOn]}>
      <Svg width={20} height={20} viewBox="0 0 24 24">{SPEC_ICON[spec]}</Svg>
    </View>
  );
}

export function Chevron() {
  return <Ionicons name="chevron-forward" size={rs(20)} color={JT.ink} />;
}

const k = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  body: { paddingHorizontal: rs(20) },
  head: { flexDirection: 'row', alignItems: 'center', gap: rs(14), minHeight: rs(44) },
  title: { flex: 1, fontFamily: JT_FONT.head, letterSpacing: -0.2, color: JT.ink },
  reset: {
    fontFamily: JT_FONT.heavy, fontSize: rf(15), color: JT.ink,
    textDecorationLine: 'underline', textDecorationColor: JT.accent,
  },
  subtitle: { marginTop: rs(12), fontFamily: JT_FONT.bold, fontSize: rf(14), color: JT.textTertiary },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  btnWrap: { position: 'absolute', left: rs(20), right: rs(24), height: rs(60) },
  btnShadow: { position: 'absolute', left: rs(4), top: rs(4), right: -rs(4), bottom: -rs(4), borderRadius: rs(30), backgroundColor: JT.ink },
  btn: {
    flex: 1, flexDirection: 'row', gap: rs(10), alignItems: 'center', justifyContent: 'center',
    borderRadius: rs(30), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent,
  },
  btnTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(18), color: JT.ink },
  btnCount: {
    minWidth: rs(26), height: rs(26), borderRadius: rs(13), paddingHorizontal: rs(6),
    backgroundColor: JT.ink, alignItems: 'center', justifyContent: 'center',
  },
  btnCountTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(13), color: JT.surface },

  secHead: { marginTop: rs(28), marginBottom: rs(12), flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: rs(8) },
  secTitle: { flexShrink: 1, fontFamily: JT_FONT.head, fontSize: rf(16), color: JT.ink },
  secHint: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary },
  secLink: {
    fontFamily: JT_FONT.heavy, fontSize: rf(14), color: JT.ink,
    textDecorationLine: 'underline', textDecorationColor: JT.accent,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8) },
  chip: {
    height: rs(40), paddingHorizontal: rs(16), borderRadius: rs(20), maxWidth: '100%',
    borderWidth: 1.5, borderColor: JT.borderSoft, backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  chipBig: { height: rs(44), borderRadius: rs(22), paddingHorizontal: rs(18) },
  chipOn: { borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent },
  chipTxt: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.ink, flexShrink: 1 },
  chipTxtBig: { fontSize: rf(16) },
  chipTxtOn: { fontFamily: JT_FONT.heavy },

  check: {
    width: rs(26), height: rs(26), borderRadius: rs(8), borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: JT.accent },
  toggle: {
    width: rs(52), height: rs(32), borderRadius: rs(16), borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.stack2, paddingHorizontal: 3, justifyContent: 'center', alignItems: 'flex-start',
  },
  toggleOn: { backgroundColor: JT.accent, alignItems: 'flex-end' },
  knob: { width: rs(22), height: rs(22), borderRadius: rs(11), backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink },
  toggleRow: {
    minHeight: rs(58), flexDirection: 'row', alignItems: 'center', gap: rs(12),
    paddingVertical: rs(10), paddingLeft: rs(16), paddingRight: rs(14), borderRadius: rs(18), backgroundColor: JT.surface,
  },
  toggleTitle: { fontFamily: JT_FONT.heavy, fontSize: rf(15), color: JT.ink },
  toggleSub: { fontFamily: JT_FONT.bold, fontSize: rf(12), color: JT.textTertiary },
  tile: {
    width: rs(38), height: rs(38), borderRadius: rs(11), backgroundColor: JT.background,
    alignItems: 'center', justifyContent: 'center',
  },
  tileOn: { backgroundColor: JT.accent, borderWidth: 2, borderColor: JT.ink },
});

export const filterStyles = k;
