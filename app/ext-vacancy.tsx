/**
 * «Вакансия подробно» — карьерная вакансия целиком (макет владельца
 * «JT-auth-and-details» 04-vacancy-details, 27.09.2026).
 *
 * Открывается из ленты кнопкой «Подробнее» (решение владельца: тап по самой
 * карточке по-прежнему никуда не ведёт). Вакансию экран берёт у ленты
 * (services/extVacancyHandoff.ts): отдельной серверной функции «по id» нет.
 * ✕ и «Откликнуться» работают как свайпы: экран оставляет решение ленте и
 * возвращается — лента смахивает ту же карточку и показывает следующую.
 *
 * Разделы описания — из текста вакансии (`## Заголовок`, `• пункт`), пустые
 * не показываются. Фактов «опыт», «занятость» у карьерных вакансий нет —
 * в сетке остаются только известные (формат, уровень, отклик).
 * «Сохранить» — закладка (services/extSaved.ts, миграция 129).
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Share, Platform, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BackButton } from '@/components/ui/BackButton';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { jtBackStyle } from '@/components/ui/jt';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import { agoRu } from '@/services/time';
import { parseDescriptionBlocks, type DescriptionBlock } from '@/services/descriptionBlocks';
import { VACANCY_FORMATS, VACANCY_LEVELS, vacancyFormat, vacancyLevel } from '@/services/vacancyFacets';
import { getOpenedExtVacancy, setDeckAction } from '@/services/extVacancyHandoff';
import { toggleExtSaved, useExtSaved } from '@/services/extSaved';
import { useApp } from '@/hooks/useApp';

type Section = { title: string | null; blocks: DescriptionBlock[] };

/** Разделы по заголовкам: текст до первого заголовка — раздел без названия. */
function toSections(text: string): Section[] {
  const out: Section[] = [];
  for (const b of parseDescriptionBlocks(text)) {
    if (b.type === 'heading') { out.push({ title: b.text, blocks: [] }); continue; }
    if (!out.length) out.push({ title: null, blocks: [] });
    out[out.length - 1].blocks.push(b);
  }
  return out.filter(s => s.blocks.length > 0);
}

// Задачи — оранжевые маркеры, остальные списки — чёрные (как в макете).
const TASKS_RE = /задач|обязанност|занимат|предстоит|делать/i;
// Навыки и стек — чипами с контуром, если раздел состоит из коротких пунктов.
const SKILLS_RE = /навык|стек|технолог|инструмент/i;

function companyGenitive(company: string): string {
  return `Карьерный сайт ${company}`;
}

export default function ExtVacancyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const ev = getOpenedExtVacancy(id);
  const { currentUser, showToast } = useApp();
  const saved = useExtSaved().some(i => i.vacancy.id === ev?.id);
  const [saving, setSaving] = React.useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  if (!ev) {
    // Открыли по прямой ссылке или после перезагрузки страницы: вакансии
    // в памяти нет — возвращаем в ленту, а не показываем пустой экран.
    return (
      <SafeAreaView style={[s.safe, s.empty]}>
        <Text style={s.emptyTxt}>Вакансия больше не открыта</Text>
        <TouchableOpacity style={s.linkCard} onPress={close} accessibilityRole="button">
          <Text style={s.linkTitle}>Вернуться в ленту</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const company = ev.company || 'Карьерный сайт';
  const posted = agoRu(ev.firstSeenAt);
  const levelId = vacancyLevel(ev.title);
  const level = levelId ? VACANCY_LEVELS.find(x => x.id === levelId)?.label ?? null : null;
  const formatId = vacancyFormat(ev.schedule, ev.description);
  const format = formatId ? VACANCY_FORMATS.find(x => x.id === formatId)?.label ?? null : null;
  const place = ev.metroStation ? `м. ${ev.metroStation}` : 'Москва';
  const salary = typeof ev.salary === 'number' && ev.salary > 0 ? ev.salary : 0;
  const sections = toSections(ev.description ?? '');
  const facts = [
    format ? { k: 'Формат', v: format } : null,
    level ? { k: 'Уровень', v: level } : null,
    ev.schedule && ev.schedule !== format ? { k: 'График', v: ev.schedule } : null,
    { k: 'Отклик', v: 'Анкета на сайте' },
  ].filter(Boolean) as { k: string; v: string }[];

  const act = (action: 'want' | 'skip') => { setDeckAction(ev.id, action); close(); };

  const share = async () => {
    const message = `${ev.title} — ${company}\n${ev.url}`;
    try {
      await Share.share(Platform.OS === 'ios' ? { message: `${ev.title} — ${company}`, url: ev.url } : { message });
    } catch {
      // Отмена системного окна — не ошибка.
    }
  };

  // Гость сохранить не может — как и откликнуться: решение уходит ленте,
  // она попросит зарегистрироваться (тот же путь, что у ♥).
  const toggleSave = async () => {
    if (!currentUser || saving) return;
    if (currentUser.isGuest) { act('want'); return; }
    setSaving(true);
    try {
      const now = await toggleExtSaved(currentUser.id, ev);
      showToast(now ? 'Сохранено в избранное' : 'Убрано из избранного', 'success');
    } catch {
      showToast('Не удалось сохранить. Проверьте связь.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const report = () => {
    const subject = encodeURIComponent('Жалоба на вакансию');
    const body = encodeURIComponent(`${ev.title} — ${company}\n${ev.url}\n\nЧто не так:`);
    void Linking.openURL(`mailto:support@jobtoo.ru?subject=${subject}&body=${body}`);
  };

  return (
    <View style={s.safe}>
      <ScrollView
        contentContainerStyle={[s.body, { paddingTop: insets.top + rs(12), paddingBottom: insets.bottom + rs(120) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.top}>
          <BackButton onPress={close} style={jtBackStyle} label="Назад к ленте" />
          <View style={s.topRight}>
            <TouchableOpacity style={s.round} onPress={share} accessibilityRole="button" accessibilityLabel="Поделиться">
              <Ionicons name="share-outline" size={rs(20)} color={JT.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.round, saved && s.roundOn]} onPress={() => { void toggleSave(); }}
              accessibilityRole="button" accessibilityLabel={saved ? 'Убрать из избранного' : 'Сохранить вакансию'}
              accessibilityState={{ selected: saved, busy: saving }} testID="detail-save"
            >
              <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={rs(20)} color={JT.ink} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.head}>
          <CompanyMark company={company} size={rs(52)} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={s.company} numberOfLines={1}>{company}</Text>
            <Text style={s.meta} numberOfLines={1}>{posted ? `Карьерный сайт · ${posted}` : 'Карьерный сайт'}</Text>
          </View>
        </View>

        <Text style={s.title}>{ev.title}</Text>

        <View style={s.tags}>
          <View style={s.tag}>
            <Ionicons name="location-outline" size={rs(15)} color={JT.ink} />
            <Text style={s.tagTxt}>{place}</Text>
          </View>
          {format ? <View style={s.tag}><Text style={s.tagTxt}>{format}</Text></View> : null}
          {level ? <View style={s.tag}><Text style={s.tagTxt}>{level}</Text></View> : null}
        </View>

        <View style={s.salaryWrap}>
          <View style={s.salaryShadow} />
          <View style={s.salary}>
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Text style={s.salaryK}>ЗАРПЛАТА</Text>
              <Text style={s.salaryV}>
                {salary ? `${salary.toLocaleString('ru-RU')} ₽/${ev.payPeriod === 'hour' ? 'ч' : 'мес'}` : 'Не указана'}
              </Text>
            </View>
            {!salary ? <Text style={s.salaryNote}>Обсуждается на собеседовании</Text> : null}
          </View>
        </View>

        <View style={s.grid}>
          {facts.map(f => (
            <View key={f.k} style={s.fact}>
              <Text style={s.factK}>{f.k}</Text>
              <Text style={s.factV}>{f.v}</Text>
            </View>
          ))}
        </View>

        {sections.length ? (
          <View style={s.card}>
            {sections.map((sec, i) => {
              const bullets = sec.blocks.filter(b => b.type === 'bullet');
              const asChips = !!sec.title && SKILLS_RE.test(sec.title)
                && bullets.length === sec.blocks.length && bullets.every(b => b.text.length <= 32);
              const marker = sec.title && TASKS_RE.test(sec.title) ? JT.accent : JT.ink;
              return (
                <View key={i} style={s.section}>
                  {sec.title ? <Text style={s.h2}>{sec.title}</Text> : null}
                  {asChips ? (
                    <View style={s.chips}>
                      {bullets.map((b, j) => <View key={j} style={s.chip}><Text style={s.chipTxt}>{b.text}</Text></View>)}
                    </View>
                  ) : sec.blocks.map((b, j) => b.type === 'bullet' ? (
                    <View key={j} style={s.bullet}>
                      <View style={[s.dot, { backgroundColor: marker }]} />
                      <Text style={s.p}>{b.text}</Text>
                    </View>
                  ) : (
                    <Text key={j} style={s.p}>{b.text}</Text>
                  ))}
                </View>
              );
            })}
          </View>
        ) : null}

        {ev.url ? (
          <TouchableOpacity style={s.linkCard} onPress={() => void Linking.openURL(ev.url)} accessibilityRole="link">
            <Ionicons name="globe-outline" size={rs(20)} color={JT.ink} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={s.linkTitle}>Открыть на сайте компании</Text>
              <Text style={s.linkSub} numberOfLines={1}>{companyGenitive(company)}</Text>
            </View>
            <Ionicons name="arrow-up-outline" size={rs(18)} color={JT.ink} style={{ transform: [{ rotate: '45deg' }] }} />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={s.report} onPress={report} accessibilityRole="button">
          <Text style={s.reportTxt}>Пожаловаться на вакансию</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Панель действий закреплена и не прокручивается; над ней — растворение фона. */}
      <LinearGradient
        colors={['rgba(245,239,230,0)', JT.background, JT.background]}
        locations={[0, 0.5, 1]}
        style={[s.fade, { height: rs(150) + insets.bottom }]}
        pointerEvents="none"
      />
      <View style={[s.actions, { bottom: insets.bottom + rs(20) }]}>
        <View style={s.skipWrap}>
          <View style={[s.shadow, { borderRadius: rs(30) }]} />
          <TouchableOpacity
            style={s.skip} onPress={() => act('skip')} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="Пропустить вакансию" testID="detail-skip"
          >
            <Ionicons name="close" size={rs(28)} color={JT.ink} />
          </TouchableOpacity>
        </View>
        <View style={s.wantWrap}>
          <View style={[s.shadow, { borderRadius: rs(30) }]} />
          <TouchableOpacity
            style={s.want} onPress={() => act('want')} activeOpacity={0.85}
            accessibilityRole="button" testID="detail-want"
          >
            <Ionicons name="heart" size={rs(22)} color={JT.ink} />
            <Text style={s.wantTxt}>Откликнуться</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  empty: { alignItems: 'center', justifyContent: 'center', gap: rs(16), padding: rs(24) },
  emptyTxt: { fontFamily: JT_FONT.bold, fontSize: rf(16), color: JT.ink },
  body: { paddingHorizontal: rs(20) },
  top: { height: rs(44), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: {
    width: rs(44), height: rs(44), borderRadius: rs(22), borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, alignItems: 'center', justifyContent: 'center',
  },
  topRight: { flexDirection: 'row', gap: rs(8) },
  roundOn: { backgroundColor: JT.accent },
  head: { flexDirection: 'row', alignItems: 'center', gap: rs(12), marginTop: rs(22) },
  company: { fontFamily: JT_FONT.heavy, fontSize: rf(17), color: JT.ink },
  meta: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary },
  title: {
    fontFamily: JT_FONT.head, fontSize: rf(24), lineHeight: rf(29), letterSpacing: -0.24,
    color: JT.ink, marginTop: rs(16),
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(6), marginTop: rs(14) },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: rs(5), height: rs(30), paddingHorizontal: rs(11),
    borderRadius: rs(10), backgroundColor: JT.surface,
  },
  tagTxt: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.ink },

  salaryWrap: { marginTop: rs(18), marginRight: rs(4), marginBottom: rs(4) },
  salaryShadow: {
    position: 'absolute', left: rs(4), top: rs(4), right: -rs(4), bottom: -rs(4),
    borderRadius: rs(18), backgroundColor: JT.ink,
  },
  salary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: rs(12),
    paddingVertical: rs(14), paddingHorizontal: rs(16), borderRadius: rs(18),
    backgroundColor: JT.accentSoft, borderWidth: 2, borderColor: JT.ink,
  },
  salaryK: { fontFamily: JT_FONT.heavy, fontSize: rf(12), letterSpacing: 0.7, color: JT.textTertiary },
  salaryV: { fontFamily: JT_FONT.head, fontSize: rf(18), color: JT.ink },
  salaryNote: {
    fontFamily: JT_FONT.bold, fontSize: rf(13), lineHeight: rf(17), color: JT.textBody,
    textAlign: 'right', maxWidth: rs(130),
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8), marginTop: rs(8) },
  fact: {
    flexGrow: 1, flexBasis: '45%', paddingVertical: rs(12), paddingHorizontal: rs(14),
    borderRadius: rs(16), backgroundColor: JT.surface, gap: rs(3),
  },
  factK: { fontFamily: JT_FONT.bold, fontSize: rf(12), color: JT.textTertiary },
  factV: { fontFamily: JT_FONT.heavy, fontSize: rf(15), color: JT.ink },

  card: { marginTop: rs(24), padding: rs(20), borderRadius: rs(22), backgroundColor: JT.surface, gap: rs(22) },
  section: { gap: rs(10) },
  h2: { fontFamily: JT_FONT.head, fontSize: rf(16), lineHeight: rf(21), color: JT.ink },
  p: { flex: 1, fontFamily: JT_FONT.medium, fontSize: rf(15), lineHeight: rf(23), color: JT.textBody },
  bullet: { flexDirection: 'row', gap: rs(10) },
  dot: { width: rs(8), height: rs(8), borderRadius: 2, marginTop: rs(8) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(6) },
  chip: {
    height: rs(32), paddingHorizontal: rs(12), borderRadius: rs(16), borderWidth: 1.5, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  chipTxt: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.ink },

  linkCard: {
    marginTop: rs(12), flexDirection: 'row', alignItems: 'center', gap: rs(12),
    paddingVertical: rs(14), paddingHorizontal: rs(16), borderRadius: rs(18),
    borderWidth: 1.5, borderColor: JT.borderSoft,
  },
  linkTitle: { fontFamily: JT_FONT.heavy, fontSize: rf(14), color: JT.ink },
  linkSub: { fontFamily: JT_FONT.bold, fontSize: rf(12), color: JT.textTertiary },
  report: { marginTop: rs(14), alignSelf: 'center', height: rs(36), paddingHorizontal: rs(14), justifyContent: 'center' },
  reportTxt: {
    fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary, textDecorationLine: 'underline',
  },

  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  actions: { position: 'absolute', left: rs(20), right: rs(24), flexDirection: 'row', gap: rs(12), alignItems: 'center' },
  shadow: { position: 'absolute', left: rs(4), top: rs(4), right: -rs(4), bottom: -rs(4), backgroundColor: JT.ink },
  skipWrap: { width: rs(60), height: rs(60) },
  skip: {
    flex: 1, borderRadius: rs(30), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  wantWrap: { flex: 1, height: rs(60) },
  want: {
    flex: 1, flexDirection: 'row', gap: rs(10), borderRadius: rs(30), borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.accent, alignItems: 'center', justifyContent: 'center',
  },
  wantTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(18), color: JT.ink },
});
