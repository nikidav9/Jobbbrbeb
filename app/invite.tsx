import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Share, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { JT } from '@/constants/jt';
import { EditFonts } from '@/constants/profileEditTheme';
import { useApp } from '@/hooks/useApp';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import { dbGetMyReferral, MyReferral } from '@/services/db';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { BackIcon } from '@/components/profile/edit/icons';

/**
 * Пригласить друга. Верстка 1:1 по `docs/design/settings-help/02-invite-friend.html`.
 *
 * Денег в программе нет — решение владельца. Экран об этом говорит прямо, а не
 * обходит молчанием: обещание вознаграждения без суммы читается как обман, и
 * один раз обманутый второго знакомого уже не позовёт.
 *
 * Вместо денег — поручительство. Позвать знакомого значит за него поручиться:
 * устроился он на работу через JobToo — это видно работодателям на карточке
 * поручителя. Подработка закрыта, поэтому считаем найм; старые «вышли на
 * смену» (worked) тоже идут в счёт — они уже записаны и заслужены.
 *
 * Регистрации не считаем: за них платил Jobr, партнёрам полетели пустые
 * заявки, и партнёры отключились.
 */
function CopyIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={8} y={8} width={12} height={12} rx={3} stroke={JT.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke={JT.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ShareIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3v12M7 8l5-5l5 5" stroke={JT.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" stroke={JT.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function InfoGlyph() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <Circle cx={12} cy={12} r={9} stroke={JT.textTertiary} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M12 11v5M12 8h.01" stroke={JT.textTertiary} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export default function InviteScreen() {
  useWarmSystemBar();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentUser, showToast } = useApp();

  const [data, setData] = useState<MyReferral | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setFailed(false);
    try {
      setData(await dbGetMyReferral(currentUser.id));
    } catch {
      // Молча пустой экран хуже ошибки: человек решит, что программы нет.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { void load(); }, [load]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const link = data ? `https://t.me/JobToo_bot/app?startapp=ref_${data.code}` : '';

  const copyText = async (text: string, toast: string) => {
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      showToast(toast, 'success');
    } catch {
      showToast('Не удалось скопировать', 'error');
    }
  };

  const share = async () => {
    if (!link) return;
    const message = [
      'Работа в Москве — вакансии рядом с домом.',
      'Регистрируйся по моей ссылке:',
      link,
    ].join('\n');
    try {
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? (navigator as Navigator) : null;
        if (nav && typeof nav.share === 'function') {
          await nav.share({ text: message.replace(`\n${link}`, ''), url: link });
        } else {
          await copyText(link, 'Ссылка скопирована');
        }
        return;
      }
      // На iOS ссылка идёт отдельным полем, иначе она уезжает в текст и часть
      // приложений её не распознаёт как ссылку.
      await Share.share(
        Platform.OS === 'ios'
          ? { message: message.replace(`\n${link}`, ''), url: link }
          : { message },
      );
    } catch {
      // Отмена системного окна «Поделиться» — не ошибка.
    }
  };

  // Устроились = найм + старые выходы на смену.
  const hiredTotal = data ? (data.worked ?? 0) + (data.hired ?? 0) : 0;

  return (
    <View style={s.screen}>
      {/* Своя шапка с фоном и zIndex: контент уходит под неё, а не налезает. */}
      <View style={[s.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity
          onPress={goBack}
          style={s.backBtn}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          testID="back-button"
        >
          <BackIcon size={20} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>Пригласить друга</Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.body, { paddingBottom: Math.max(insets.bottom, 12) + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={JT.accent} style={{ marginTop: 40 }} />
        ) : failed || !data ? (
          <HardShadowBox offset={6} radius={28}>
            <View style={s.card}>
              <Text style={s.lead}>Не получилось загрузить</Text>
              <Text style={s.muted}>Проверьте связь и попробуйте ещё раз.</Text>
              <TouchableOpacity style={s.primaryBtn} onPress={() => void load()} activeOpacity={0.85}>
                <Text style={s.primaryBtnTxt}>Повторить</Text>
              </TouchableOpacity>
            </View>
          </HardShadowBox>
        ) : (
          <>
            <HardShadowBox offset={6} radius={28}>
              <View style={s.card}>
                <Text style={s.lead}>
                  Позовите знакомого, которому нужна работа. Когда он устроится
                  на работу через JobToo, это встанет в вашу карточку:
                  работодатели видят, скольких вы привели и сколько из них
                  устроились.
                </Text>
                <Text style={s.muted}>
                  Денег за приглашение мы не платим — и не обещаем. Платит это
                  другим: из двух похожих анкет работодатель берёт ту, за которой
                  кто-то стоит.
                </Text>

                <Text style={s.codeLabel}>Ваш код</Text>
                <View style={s.codeBox}>
                  <Text style={s.code} selectable>{data.code}</Text>
                  <TouchableOpacity
                    onPress={() => void copyText(data.code, 'Код скопирован')}
                    style={s.codeCopy}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Скопировать код"
                  >
                    <CopyIcon size={20} />
                  </TouchableOpacity>
                </View>

                <View style={s.primaryWrap}>
                  <View pointerEvents="none" style={s.primaryShadow} />
                  <TouchableOpacity style={s.primaryBtn} onPress={() => void share()} activeOpacity={0.85}>
                    <ShareIcon />
                    <Text style={s.primaryBtnTxt}>Поделиться ссылкой</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={s.ghostBtn}
                  onPress={() => void copyText(link, 'Ссылка скопирована')}
                  activeOpacity={0.7}
                >
                  <CopyIcon size={18} />
                  <Text style={s.ghostBtnTxt}>Скопировать ссылку</Text>
                </TouchableOpacity>
              </View>
            </HardShadowBox>

            {/* Не пришедшие «не вышли» на экран не выносим: смен больше нет, а
                новые итоги — только «устроился». Старые невыходы остаются в
                журнале и на карточке не показываются. */}
            <View style={s.stats}>
              <View style={[s.stat, s.statDivider]}>
                <Text style={s.statNum}>{data.invited}</Text>
                <Text style={s.statLabel}>позвали</Text>
              </View>
              <View style={s.stat}>
                <Text style={[s.statNum, { color: '#C2410C' }]}>{hiredTotal}</Text>
                <Text style={s.statLabel}>устроились</Text>
              </View>
            </View>

            <View style={s.note}>
              <InfoGlyph />
              <Text style={s.noteTxt}>
                Считается, что друг устроился на работу, а не зарегистрировался.
                Поэтому зовите тех, за кого готовы поручиться: их трудоустройство
                поднимает вашу карточку.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JT.background },
  header: {
    paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14,
    minHeight: 44, backgroundColor: JT.background, zIndex: 1,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  title: { flex: 1, minWidth: 0, fontFamily: EditFonts.heading, fontSize: 18, color: JT.ink },

  scroll: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 8 },

  card: {
    backgroundColor: JT.surface, borderRadius: 28, borderWidth: 2, borderColor: JT.ink,
    paddingTop: 18, paddingHorizontal: 18, paddingBottom: 12,
  },
  lead: { fontFamily: EditFonts.text700, fontSize: 16, lineHeight: 23, color: JT.ink },
  muted: {
    marginTop: 10, fontFamily: EditFonts.text600, fontSize: 13, lineHeight: 19, color: JT.textBody,
  },

  codeLabel: { marginTop: 16, fontFamily: EditFonts.text700, fontSize: 14, color: JT.textBody },
  codeBox: {
    marginTop: 8, height: 62, paddingLeft: 18, paddingRight: 8, borderRadius: 18,
    borderWidth: 2, borderColor: JT.ink, borderStyle: 'dashed', backgroundColor: JT.accentSoft,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  code: { fontFamily: EditFonts.heading, fontSize: 24, letterSpacing: 0.12 * 24, color: JT.ink },
  codeCopy: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  primaryWrap: { marginTop: 18 },
  primaryShadow: {
    position: 'absolute', top: 4, left: 4, right: -4, bottom: -4,
    backgroundColor: JT.ink, borderRadius: 29,
  },
  primaryBtn: {
    height: 58, borderRadius: 29, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  primaryBtnTxt: { fontFamily: EditFonts.text800, fontSize: 16, color: JT.ink },
  ghostBtn: {
    marginTop: 6, height: 52, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  },
  ghostBtnTxt: { fontFamily: EditFonts.text800, fontSize: 16, color: JT.ink },

  stats: {
    marginTop: 20, flexDirection: 'row', backgroundColor: JT.surface,
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 8,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { borderRightWidth: 1.5, borderRightColor: '#EFE7DC' },
  statNum: { fontFamily: EditFonts.heading, fontSize: 26, color: JT.ink },
  statLabel: { fontFamily: EditFonts.text600, fontSize: 14, color: JT.textTertiary },

  note: { marginTop: 14, flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  noteTxt: {
    flex: 1, fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 21, color: JT.textTertiary,
  },
});
