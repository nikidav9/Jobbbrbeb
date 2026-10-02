/**
 * Экран приложения JobToo 1:1 — по снимкам настоящей веб-сборки (390×844,
 * 02.10.2026): лента «Вакансии» (шапка с логотипом JT, поиск, молнии, чипы,
 * карточка, кнопки, нижнее меню) и вкладка «Отклики» (строка отклика через
 * Юпитера со значком «Отправлено»). Размеры — в логических точках телефона;
 * снаружи экран масштабируется целиком. Поменялся вид в приложении — сверь
 * здесь (снимки: video/README в docs/MAP.md, раздел «Ролики»).
 */
import React from 'react';
import { Img, staticFile } from 'remotion';
import { BRANDS, BrandKey, BrandMark } from './Brands';

export const A = {
  bg: '#F5EFE6', ink: '#141414', accent: '#FF6B1A', soft: '#FFE2CC', surface: '#FFFFFF',
  chip: '#F1E9DE', stack1: '#F1E9DE', stack2: '#E8DED1', line: '#D9CFC2', muted: '#6B645C', body: '#5C554D',
  purple: '#7C3AED', ok: '#2BB673',
};
export const F = {
  head: { fontFamily: 'U, sans-serif', fontWeight: 700, letterSpacing: '-0.02em' } as React.CSSProperties,
  body: { fontFamily: 'M, sans-serif', fontWeight: 500 } as React.CSSProperties,
  bold: { fontFamily: 'M, sans-serif', fontWeight: 700 } as React.CSSProperties,
};

// ── Значки (контурные, как Ionicons/Lucide в приложении) ────────────────────
const S = { fill: 'none', stroke: A.ink, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const Icon = {
  search: (c = A.ink) => <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" {...S} stroke={c} strokeWidth={2.4} /><path d="m20 20-4-4" {...S} stroke={c} strokeWidth={2.4} /></svg>,
  bolt: () => <svg width="22" height="22" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill={A.accent} stroke={A.ink} strokeWidth="2" strokeLinejoin="round" /></svg>,
  sliders: () => <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" {...S} stroke="#fff" /><circle cx="9" cy="6" r="2" fill={A.ink} stroke="#fff" strokeWidth="2" /><circle cx="15" cy="12" r="2" fill={A.ink} stroke="#fff" strokeWidth="2" /><circle cx="8" cy="18" r="2" fill={A.ink} stroke="#fff" strokeWidth="2" /></svg>,
  pin: () => <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" {...S} /><circle cx="12" cy="10" r="2.5" {...S} /></svg>,
  chevron: () => <svg width="14" height="14" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" {...S} strokeWidth={2.6} /></svg>,
  undo: () => <svg width="22" height="22" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5" fill="none" stroke="#9A9188" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 9h10a6 6 0 0 1 6 6v3" fill="none" stroke="#9A9188" strokeWidth="2.6" strokeLinecap="round" /></svg>,
  x: () => <svg width="26" height="26" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" {...S} strokeWidth={3} /></svg>,
  heart: (c = A.ink) => <svg width="28" height="28" viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11.2A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8 3.2C20 16 12 21 12 21z" fill={c} /></svg>,
  bookmark: () => <svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z" {...S} /></svg>,
  case: (c: string) => <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" fill={c === A.ink ? A.ink : 'none'} stroke={c} strokeWidth="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" fill="none" stroke={c === A.ink ? A.accent : c} strokeWidth="2" /></svg>,
  doc: (c: string) => <svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 2h8l5 5v15H6z" fill={c === A.ink ? A.ink : 'none'} stroke={c} strokeWidth="2" strokeLinejoin="round" /><path d="M9 13h6M9 17h6" stroke={c === A.ink ? A.accent : c} strokeWidth="2" strokeLinecap="round" /></svg>,
  user: (c: string) => <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke={c} strokeWidth="2" /><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" /></svg>,
  check: (c = A.body) => <svg width="12" height="12" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

// ── Карточка вакансии ленты ─────────────────────────────────────────────────
export type Vac = { brand: BrandKey; ago: string; title: string; place: string; format: string; pay: string; desc: string };
export const VACS: Vac[] = [
  { brand: 'nimbus', ago: '40 минут назад', title: 'Frontend-разработчик (React)', place: 'Москва', format: 'Удалённо',
    pay: '250 000 ₽/мес', desc: 'Ищем frontend-разработчика в команду платёжного продукта. TypeScript, React, дизайн-система, релизы каждую неделю.' },
  { brand: 'hexa', ago: '2 часа назад', title: 'Data Scientist', place: 'Москва', format: 'Гибрид',
    pay: '300 000 ₽/мес', desc: 'Рекомендации и поиск. Python, SQL, A/B-тесты на миллионах пользователей. Senior.' },
  { brand: 'lampa', ago: 'сегодня', title: 'QA-инженер (автотесты)', place: 'Москва', format: 'Офис',
    pay: '180 000 ₽/мес', desc: 'Playwright, CI, тест-дизайн. Наставник на первые три месяца.' },
];

const chip = (extra?: React.CSSProperties): React.CSSProperties => ({
  ...F.bold, fontSize: 14.5, padding: '8px 12px', borderRadius: 12, background: A.chip, display: 'inline-flex', alignItems: 'center', gap: 6, ...extra,
});

export const FeedCard: React.FC<{ v: Vac; stampYes?: number; stampNo?: number }> = ({ v, stampYes = 0, stampNo = 0 }) => (
  <div style={{ position: 'absolute', inset: 0, padding: '22px 22px 0', borderRadius: 30, border: `2px solid ${A.ink}`, background: A.surface,
    boxShadow: `6px 6px 0 ${A.ink}`, overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
      <BrandMark b={v.brand} size={46} round />
      <div>
        <div style={{ ...F.bold, fontSize: 16 }}>{BRANDS[v.brand].name}</div>
        <div style={{ ...F.bold, fontSize: 13, color: A.muted, marginTop: 2 }}>Карьерный сайт · {v.ago}</div>
      </div>
    </div>
    <div style={{ ...F.head, fontSize: 23, lineHeight: 1.12, marginTop: 18 }}>{v.title}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
      <span style={chip()}>{Icon.pin()}{v.place}</span>
      <span style={chip()}>{v.format}</span>
      <span style={chip({ background: A.soft })}>{v.pay}</span>
    </div>
    <div style={{ ...F.body, fontSize: 15, lineHeight: 1.5, color: A.body, marginTop: 14, height: 92, overflow: 'hidden',
      WebkitMaskImage: 'linear-gradient(180deg, #000 55%, transparent)' }}>{v.desc}</div>
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
      <span style={{ ...F.bold, fontSize: 15, padding: '9px 18px', borderRadius: 999, border: `1.5px solid ${A.line}`, background: A.surface,
        display: 'inline-flex', alignItems: 'center', gap: 8 }}>Подробнее {Icon.chevron()}</span>
    </div>
    <div style={{ ...F.head, position: 'absolute', top: 26, right: 20, padding: '6px 12px', border: `4px solid ${A.ok}`, borderRadius: 12,
      color: A.ok, fontSize: 22, transform: 'rotate(12deg)', opacity: stampYes, background: 'rgba(255,255,255,.9)' }}>ОТКЛИК</div>
    <div style={{ ...F.head, position: 'absolute', top: 26, left: 20, padding: '6px 12px', border: '4px solid #E5484D', borderRadius: 12,
      color: '#E5484D', fontSize: 22, transform: 'rotate(-12deg)', opacity: stampNo, background: 'rgba(255,255,255,.9)' }}>МИМО</div>
  </div>
);

// ── Шапка, чипы, кнопки, меню ───────────────────────────────────────────────
export const FeedHeader: React.FC<{ bolts: number; boltPulse?: number }> = ({ bolts, boltPulse = 0 }) => (
  <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 21px', height: 46 }}>
      <Img src={staticFile('jt-logo.png')} style={{ width: 50, height: 32, objectFit: 'contain' }} />
      <div style={{ flex: 1, height: 44, borderRadius: 22, border: `2px solid ${A.ink}`, background: A.surface, display: 'flex',
        alignItems: 'center', gap: 9, padding: '0 14px' }}>
        {Icon.search()}<span style={{ ...F.body, fontSize: 15, color: A.muted }}>Вакансия или стек</span>
      </div>
      <div style={{ ...F.bold, width: 76, height: 44, borderRadius: 22, border: `2px solid ${A.ink}`, background: A.surface, fontSize: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transform: `scale(${1 + 0.12 * boltPulse})` }}>
        {Icon.bolt()}{bolts}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8, padding: '10px 0 0 21px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <span style={{ width: 46, height: 38, borderRadius: 19, background: A.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{Icon.sliders()}</span>
      {['Зарплата', 'Специализация', 'Грейд'].map(t => (
        <span key={t} style={{ ...F.bold, flex: 'none', height: 38, padding: '0 15px', borderRadius: 19, border: `1.5px solid ${A.line}`, background: A.surface,
          fontSize: 15, display: 'flex', alignItems: 'center' }}>{t}</span>
      ))}
    </div>
    <div style={{ ...F.bold, fontSize: 13, color: A.muted, padding: '12px 21px 0' }}>Всего 128 вакансий</div>
  </>
);

export const ActionRow: React.FC<{ press: 'yes' | 'no' | null; amount: number }> = ({ press, amount }) => {
  const sq = (k: 'yes' | 'no') => `scale(${press === k ? 1 - 0.12 * amount : 1})`;
  const round = (size: number, extra: React.CSSProperties, child: React.ReactNode, tf?: string) => (
    <div style={{ width: size, height: size, borderRadius: size / 2, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: tf, ...extra }}>{child}</div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
      {round(48, { border: '2px solid #B9B1A7', background: A.bg }, Icon.undo())}
      {round(66, { border: `2px solid ${A.ink}`, background: A.surface, boxShadow: `4px 4px 0 ${A.ink}` }, Icon.x(), sq('no'))}
      {round(70, { border: `2px solid ${A.ink}`, background: A.accent, boxShadow: `4px 4px 0 ${A.ink}` }, Icon.heart(), sq('yes'))}
      {round(48, { border: `2px solid ${A.ink}`, background: A.surface }, Icon.bookmark())}
    </div>
  );
};

export const TabBar: React.FC<{ active: 0 | 1 }> = ({ active }) => {
  const tabs: [string, (c: string) => React.ReactNode][] = [['Вакансии', Icon.case], ['Отклики', Icon.doc], ['Профиль', Icon.user]];
  return (
    <div style={{ position: 'absolute', left: 21, right: 21, bottom: 13, height: 66, borderRadius: 33, background: A.ink, display: 'flex',
      alignItems: 'center', padding: 5 }}>
      {tabs.map(([t, ic], i) => {
        const on = i === active;
        return (
          <div key={t} style={{ ...F.bold, flex: i === 2 ? 0.95 : 1.05, height: 56, borderRadius: 28, background: on ? A.accent : 'transparent',
            color: on ? A.ink : '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {ic(on ? A.ink : '#fff')}{t}
          </div>
        );
      })}
    </div>
  );
};

// ── «Отклики»: строка отклика через Юпитера ─────────────────────────────────
export const ResponsesScreen: React.FC<{ invited: number }> = ({ invited }) => (
  <div style={{ padding: '0 21px' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 46 }}>
      <Img src={staticFile('jt-logo.png')} style={{ width: 50, height: 32, objectFit: 'contain' }} />
      <div style={{ ...F.head, fontSize: 20 }}>Отклики</div>
      <div style={{ width: 50 }} />
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
      {['Все', 'Нужны вы', 'Рассматривают'].map((t, i) => (
        <span key={t} style={{ ...F.bold, height: 36, padding: '0 15px', borderRadius: 18, fontSize: 14.5, display: 'flex', alignItems: 'center',
          background: i === 0 ? A.ink : A.surface, color: i === 0 ? '#fff' : A.ink, border: `1.5px solid ${i === 0 ? A.ink : A.line}` }}>{t}</span>
      ))}
    </div>
    <div style={{ ...F.bold, fontSize: 13, color: A.muted, marginTop: 18 }}>Сегодня</div>
    {[
      { b: 'nimbus' as BrandKey, t: 'Frontend-разработчик (React)', s: invited > 0.5 ? 'Ответ работодателя: приглашение на собеседование' : 'Юпитер заполнил анкету на сайте компании', fresh: true },
      { b: 'veter' as BrandKey, t: 'Backend-разработчик на Go', s: 'Юпитер заполнил анкету на сайте компании', fresh: false },
    ].map((r, i) => (
      <div key={r.b} style={{ display: 'flex', gap: 12, padding: 16, marginTop: 10, borderRadius: 22, background: A.surface,
        border: `2px solid ${r.fresh ? A.ink : 'transparent'}`, boxShadow: r.fresh ? `5px 5px 0 ${A.ink}` : 'none' }}>
        <BrandMark b={r.b} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ ...F.bold, fontSize: 14, color: A.muted }}>{BRANDS[r.b].name}</span>
            {i === 0 && invited > 0.5
              ? <span style={{ ...F.bold, fontSize: 12, padding: '5px 9px', borderRadius: 999, background: A.accent, border: `1.5px solid ${A.ink}` }}>Приглашение</span>
              : <span style={{ ...F.bold, fontSize: 12, padding: '5px 9px', borderRadius: 999, background: A.chip, color: A.body, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{Icon.check()}Отправлено</span>}
          </div>
          <div style={{ ...F.bold, fontSize: 16, marginTop: 4, lineHeight: 1.25 }}>{r.t}</div>
          <div style={{ ...F.body, fontSize: 13.5, color: A.body, marginTop: 4, lineHeight: 1.35 }}>{r.s}</div>
        </div>
      </div>
    ))}
  </div>
);
