import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';

import { JT, JT_FONT } from '@/constants/jt';
import { JTLink } from '@/components/ui/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { rs, rf } from '@/constants/scale';

/**
 * Баннер про cookie и Яндекс.Метрику — только для веб-версии.
 *
 * Зачем: на сайте работает Яндекс.Метрика (счётчик 109805381, с вебвизором —
 * запись действий на странице). Это обработка данных посетителя, и по-честному
 * её нельзя включать до того, как человек согласился. Поэтому Метрику грузим
 * НЕ из index.html автоматически, а отсюда — только после нажатия «Принять».
 * «Закрыть» — отказ: Метрика не загружается вовсе.
 *
 * В приложении (iOS/Android) cookie и Метрики нет, поэтому баннер не для них:
 * на нативных платформах компонент ничего не рисует.
 *
 * Выбор запоминаем в localStorage, чтобы не спрашивать на каждом заходе.
 */

const STORAGE_KEY = 'jobtoo-cookie-consent'; // 'accepted' | 'dismissed'
const YM_ID = 109805381;

function readChoice(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function writeChoice(value: 'accepted' | 'dismissed'): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Приватный режим/заблокированное хранилище — молча: выбор просто не
    // запомнится и баннер покажется снова, это не ошибка для пользователя.
  }
}

/**
 * Убрать данные телеграма из адреса страницы.
 *
 * Мини-приложение получает от телеграма кусок вида
 * `#tgWebAppData=user={"id":…,"first_name":…,"username":…}&signature=…&hash=…`
 * — то есть идентификатор, имя, ник, ссылку на фотографию человека и подпись
 * его входа. Метрика при первом попадании записывает адрес целиком, и всё это
 * уезжает к ней как название страницы. В отчёте «популярные страницы» мы это и
 * увидели: настоящие имена и ники пользователей.
 *
 * Передавать персональные данные посетителей стороннему обработчику мы не
 * обещали — в политике сказано про аналитику посещений, а не про личность.
 * Поэтому адрес чистится ДО загрузки счётчика.
 *
 * Чистить безопасно: параметр запуска приложение берёт из SDK телеграма
 * (`initDataUnsafe.start_param`, см. lib/telegram.ts), а не из адреса, и к
 * моменту согласия на cookie SDK его давно разобрал. Трогаем только ключи
 * `tgWebApp*` — свои параметры вроде vacancyId остаются на месте.
 */
function stripTelegramDataFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const { pathname, search, hash } = window.location;
    const q = new URLSearchParams(search);
    let changed = false;
    for (const key of Array.from(q.keys())) {
      if (key.startsWith('tgWebApp')) { q.delete(key); changed = true; }
    }
    const cleanHash = hash.includes('tgWebApp') ? '' : hash;
    if (cleanHash !== hash) changed = true;
    if (!changed) return;
    const qs = q.toString();
    window.history.replaceState(null, '', pathname + (qs ? `?${qs}` : '') + cleanHash);
  } catch {
    // Адрес почистить не вышло — это не повод ронять загрузку страницы.
  }
}

// Загрузка счётчика Метрики. Повторный вызов безопасен: и наш флаг, и сам
// сниппет проверяют, что тег уже вставлен.
function loadMetrika(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const w = window as any;
  if (w.__ymLoaded) return;
  w.__ymLoaded = true;
  // Порядок важен: сначала чистим адрес, потом грузим счётчик. Наоборот —
  // первое попадание уйдёт с личными данными.
  stripTelegramDataFromUrl();
  (function (m: any, e: any, t: string, r: string, i: string, k?: any, a?: any) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * (new Date() as any);
    for (let j = 0; j < e.scripts.length; j++) { if (e.scripts[j].src === r) { return; } }
    k = e.createElement(t); a = e.getElementsByTagName(t)[0];
    k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
  })(w, w.document, 'script', `https://mc.yandex.ru/metrika/tag.js?id=${YM_ID}`, 'ym');
  w.ym(YM_ID, 'init', {
    ssr: true, webvisor: true, clickmap: true, ecommerce: 'dataLayer',
    accurateTrackBounce: true, trackLinks: true,
  });
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const choice = readChoice();
    if (choice === 'accepted') {
      loadMetrika();        // согласие уже было — включаем аналитику молча
      return;
    }
    if (choice === 'dismissed') return; // отказ — ничего не грузим и не показываем
    setVisible(true);       // выбора ещё не было — показываем баннер
  }, []);

  if (Platform.OS !== 'web' || !visible) return null;

  const accept = () => { writeChoice('accepted'); loadMetrika(); setVisible(false); };
  const dismiss = () => { writeChoice('dismissed'); setVisible(false); };

  // Стиль JT (30.09.2026): белая карточка-наклейка с контуром и жёсткой
  // тенью, оранжевая «Принять» с чёрным текстом — как на остальных экранах.
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <HardShadowBox offset={4} radius={rs(20)} shadowColor={JT.ink} style={styles.cardBox}>
        <View style={styles.card}>
          <Text style={styles.text}>
            Мы используем файлы cookie и Яндекс.Метрику, чтобы сервис работал лучше.
            Нажимая «Принять», вы соглашаетесь с{' '}
            <JTLink onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}>
              политикой конфиденциальности
            </JTLink>
            .
          </Text>
          <View style={styles.btns}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={dismiss} activeOpacity={0.8} accessibilityRole="button">
              <Text style={styles.btnTxt}>Закрыть</Text>
            </TouchableOpacity>
            <HardShadowBox offset={3} radius={rs(14)} shadowColor={JT.ink}>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={accept} activeOpacity={0.85} accessibilityRole="button">
                <Text style={styles.btnTxt}>Принять</Text>
              </TouchableOpacity>
            </HardShadowBox>
          </View>
        </View>
      </HardShadowBox>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    alignItems: 'center', paddingHorizontal: rs(12), paddingTop: rs(12), paddingBottom: rs(16),
    zIndex: 900,
  },
  cardBox: { width: '100%', maxWidth: rs(520) },
  card: {
    backgroundColor: JT.surface,
    borderRadius: rs(20), borderWidth: 2, borderColor: JT.ink,
    padding: rs(16), gap: rs(14),
  },
  text: { fontFamily: JT_FONT.medium, fontSize: rf(13.5), lineHeight: rf(20), color: JT.textBody },
  btns: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: rs(12) },
  btn: {
    paddingHorizontal: rs(20), height: rs(44), borderRadius: rs(14),
    borderWidth: 2, borderColor: JT.ink, alignItems: 'center', justifyContent: 'center',
  },
  btnGhost: { backgroundColor: JT.surface },
  btnPrimary: { backgroundColor: JT.accent },
  // Текст на оранжевом — чёрный (README макетов: белый плохо читается).
  btnTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(14.5), color: JT.ink },
});
