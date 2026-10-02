/**
 * Ролик первого экрана jobtoo.ru (решение владельца 02.10.2026): 15 с по кругу,
 * без звука. Три такта, как в самом продукте:
 *   1. листаем IT-вакансии — свайп вправо, штамп «ОТКЛИК»;
 *   2. Юпитер сам заполняет анкету на сайте работодателя;
 *   3. в чат приходит приглашение на собеседование.
 * Последние полсекунды сцена возвращается в состояние первого кадра — шов
 * при зацикливании не виден. Вакансии и компании — образцы, без реальных брендов.
 * На сайте поверх ролика лежит затемнение и белый заголовок по центру, поэтому
 * центр кадра спокойный, а действие — слева и справа.
 */
import React from 'react';
import {
  AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

export const HERO_FRAMES = 450;

const C = {
  bg: '#F5EFE6', ink: '#141414', accent: '#FF6B1A', soft: '#FFE2CC', surface: '#FFFFFF',
  stack1: '#F1E9DE', stack2: '#E8DED1', muted: '#5C554D', ok: '#2BB673', no: '#E5484D',
};

const FONTS = `
@font-face { font-family: 'U'; font-weight: 700; src: url('${staticFile('unbounded-cyrillic-700-normal.woff2')}') format('woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: 'U'; font-weight: 700; src: url('${staticFile('unbounded-latin-700-normal.woff2')}') format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
@font-face { font-family: 'M'; font-weight: 700; src: url('${staticFile('manrope-cyrillic-700-normal.woff2')}') format('woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: 'M'; font-weight: 700; src: url('${staticFile('manrope-latin-700-normal.woff2')}') format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
@font-face { font-family: 'M'; font-weight: 500; src: url('${staticFile('manrope-500.ttf')}') format('truetype'); }
`;

const HEAD: React.CSSProperties = { fontFamily: 'U, sans-serif', fontWeight: 700, letterSpacing: '-0.02em' };
const BODY: React.CSSProperties = { fontFamily: 'M, sans-serif', fontWeight: 500 };
const BOLD: React.CSSProperties = { fontFamily: 'M, sans-serif', fontWeight: 700 };

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Плавное появление в окне [a, b] и исчезновение в [c, d]. */
function window4(f: number, a: number, b: number, c: number, d: number): number {
  return interpolate(f, [a, b, c, d], [0, 1, 1, 0], { ...clamp, easing: ease });
}

// ── Карточка вакансии ───────────────────────────────────────────────────────
type Vac = { letter: string; tint: string; co: string; title: string; pay: string; chips: string[]; desc: string };
const VACS: Vac[] = [
  { letter: 'F', tint: C.soft, co: 'Финтех · 40 минут назад', title: 'Frontend-разработчик (React)', pay: 'от 250 000 ₽',
    chips: ['Удалённо', 'Middle'], desc: 'TypeScript, React, дизайн-система. Релизы каждую неделю.' },
  { letter: 'D', tint: '#D8F0E2', co: 'Маркетплейс · 2 часа назад', title: 'Data Scientist', pay: 'от 300 000 ₽',
    chips: ['Гибрид', 'Senior'], desc: 'Рекомендации и поиск. Python, SQL, A/B-тесты.' },
  { letter: 'Q', tint: '#E1E6FF', co: 'EdTech · сегодня', title: 'QA-инженер (автотесты)', pay: 'от 180 000 ₽',
    chips: ['Москва', 'Junior+'], desc: 'Playwright, CI, тест-дизайн. Наставник на старте.' },
];

const Card: React.FC<{ v: Vac; style?: React.CSSProperties; stamp?: number; dimmed?: boolean }> = ({ v, style, stamp = 0, dimmed }) => (
  <div style={{
    position: 'absolute', inset: 0, padding: 30, borderRadius: 34, border: `3px solid ${C.ink}`,
    background: dimmed ? C.stack1 : C.surface, boxShadow: `6px 6px 0 ${C.ink}`, ...style,
  }}>
    <div style={{ opacity: dimmed ? 0 : 1 }}>
      <div style={{ ...HEAD, width: 84, height: 84, borderRadius: 24, border: `3px solid ${C.ink}`, background: v.tint,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38 }}>{v.letter}</div>
      <div style={{ ...BODY, marginTop: 22, fontSize: 22, color: C.muted }}>{v.co}</div>
      <div style={{ ...HEAD, marginTop: 10, fontSize: 38, lineHeight: 1.12 }}>{v.title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
        <span style={{ ...BOLD, fontSize: 20, padding: '10px 16px', borderRadius: 999, background: C.soft, border: `2px solid ${C.accent}` }}>{v.pay}</span>
        {v.chips.map(c => (
          <span key={c} style={{ ...BOLD, fontSize: 20, padding: '10px 16px', borderRadius: 999, background: C.stack1 }}>{c}</span>
        ))}
      </div>
      <div style={{ ...BODY, marginTop: 22, fontSize: 22, lineHeight: 1.45, color: C.muted }}>{v.desc}</div>
    </div>
    <div style={{ ...HEAD, position: 'absolute', top: 34, right: 30, padding: '10px 18px', border: `5px solid ${C.ok}`,
      borderRadius: 14, color: C.ok, fontSize: 32, transform: 'rotate(12deg)', opacity: stamp }}>ОТКЛИК</div>
  </div>
);

// ── Телефон ─────────────────────────────────────────────────────────────────
const Phone: React.FC<{ f: number }> = ({ f }) => {
  const { fps } = useVideoConfig();
  // Свайп верхней карточки вправо на 75-м кадре; к 400-му колода возвращается в исходное.
  const out = spring({ frame: f - 88, fps, config: { damping: 18, mass: 0.9 } });
  const back = interpolate(f, [400, 440], [0, 1], { ...clamp, easing: ease });
  // Сначала карточка едет за пальцем, после отпускания — улетает пружиной.
  const follow = interpolate(f, [55, 88], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const topX = (follow * 170 + out * 900) * (1 - back);
  const topRot = (follow * 6 + out * 18) * (1 - back);
  const stamp = interpolate(f, [62, 84], [0, 1], clamp) * (1 - back);
  const promote = out * (1 - back); // вторая карточка поднимается на место первой
  // Палец: подходит, жмёт и тянет вправо.
  const fingerIn = interpolate(f, [30, 55], [0, 1], { ...clamp, easing: ease });
  const fingerDrag = interpolate(f, [55, 88], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const fingerOut = interpolate(f, [88, 104], [1, 0], clamp);
  const toast = window4(f, 100, 115, 200, 215);
  return (
    <div style={{ position: 'absolute', width: 520, height: 1060, borderRadius: 78, border: `5px solid ${C.ink}`,
      background: C.ink, padding: 22, boxShadow: '20px 24px 0 rgba(20,20,20,.22)' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 58, background: C.bg, overflow: 'hidden',
        padding: '84px 30px 30px' }}>
        <div style={{ position: 'absolute', top: 18, left: '50%', width: 150, height: 38, marginLeft: -75, borderRadius: 20, background: C.ink }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 }}>
          <span style={{ ...HEAD, fontSize: 32 }}>Вакансии</span>
          <span style={{ ...BOLD, fontSize: 22, padding: '8px 16px', border: `3px solid ${C.ink}`, borderRadius: 999, background: C.surface }}>
            <span style={{ color: C.accent }}>&#9679;</span> {Math.round(20 - promote)}
          </span>
        </div>
        <div style={{ position: 'relative', height: 640 }}>
          <Card v={VACS[2]} dimmed style={{ transform: 'translateY(40px) scale(.9)' }} />
          <Card v={VACS[1]} dimmed={promote < 0.5} style={{
            transform: `translateY(${20 - 20 * promote}px) scale(${0.95 + 0.05 * promote})`,
            background: promote < 0.5 ? C.stack1 : C.surface }} />
          <Card v={VACS[0]} stamp={stamp} style={{ transform: `translateX(${topX}px) rotate(${topRot}deg)` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 46, marginTop: 50 }}>
          {['no', 'yes'].map(k => (
            <div key={k} style={{ width: 98, height: 98, borderRadius: '50%', border: `3px solid ${C.ink}`, background: C.surface,
              boxShadow: `5px 5px 0 ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: k === 'yes' ? `scale(${1 - 0.12 * window4(f, 86, 90, 94, 100)})` : undefined }}>
              <svg width="44" height="44" viewBox="0 0 24 24">
                {k === 'no'
                  ? <path d="M6 6l12 12M18 6 6 18" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
                  : <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill={C.accent} stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />}
              </svg>
            </div>
          ))}
        </div>
        <div style={{ ...BOLD, position: 'absolute', left: 30, right: 30, bottom: 170, padding: '20px 24px', borderRadius: 24,
          border: `3px solid ${C.ink}`, background: C.surface, boxShadow: `5px 5px 0 ${C.ink}`, fontSize: 24, lineHeight: 1.3,
          opacity: toast, transform: `translateY(${(1 - toast) * 30}px)` }}>
          Юпитер заполняет анкету на сайте работодателя
        </div>
      </div>
      {/* палец */}
      <div style={{ position: 'absolute', left: 170 + fingerDrag * 170, top: 520 - fingerDrag * 20, width: 74, height: 74, borderRadius: '50%',
        background: 'rgba(20,20,20,.28)', border: '4px solid rgba(255,255,255,.9)',
        opacity: fingerIn * fingerOut, transform: `scale(${1 - 0.15 * fingerDrag})` }} />
    </div>
  );
};

// ── Анкета работодателя, которую заполняет Юпитер ───────────────────────────
const FIELDS: [string, string][] = [
  ['Имя и фамилия', 'Алексей Смирнов'],
  ['Почта', 'a.smirnov@example.ru'],
  ['Опыт', '4 года, React и TypeScript'],
  ['Резюме', 'Резюме.pdf'],
];

const Form: React.FC<{ f: number }> = ({ f }) => {
  const shown = window4(f, 110, 135, 322, 338);
  const start = 140;
  const per = 38;
  const sent = interpolate(f, [start + per * FIELDS.length, start + per * FIELDS.length + 12], [0, 1], clamp);
  return (
    <div style={{ position: 'absolute', width: 640, borderRadius: 30, border: `3px solid ${C.ink}`, background: C.surface,
      boxShadow: `8px 8px 0 ${C.ink}`, overflow: 'hidden', opacity: shown,
      transform: `translateY(${(1 - shown) * 60}px) rotate(${-3 + shown * 1}deg)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 22px', borderBottom: `3px solid ${C.ink}`, background: C.stack1 }}>
        {[C.no, '#F5B700', C.ok].map(c => <span key={c} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: `2px solid ${C.ink}` }} />)}
        <span style={{ ...BOLD, marginLeft: 12, fontSize: 20, color: C.muted }}>careers.company.ru / отклик</span>
      </div>
      <div style={{ padding: '26px 30px 30px' }}>
        <div style={{ ...HEAD, fontSize: 30 }}>Анкета кандидата</div>
        {FIELDS.map(([label, value], i) => {
          const t0 = start + i * per;
          const typed = Math.floor(interpolate(f, [t0, t0 + per - 8], [0, value.length], clamp));
          const done = f >= t0 + per - 8;
          const active = f >= t0 && !done;
          return (
            <div key={label} style={{ marginTop: 18 }}>
              <div style={{ ...BOLD, fontSize: 18, color: C.muted }}>{label}</div>
              <div style={{ ...BODY, marginTop: 8, height: 58, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 22, borderRadius: 16, border: `3px solid ${active ? C.accent : C.ink}`, background: done ? '#FAF6F0' : C.surface }}>
                {value.slice(0, typed)}
                {active && f % 16 < 9 ? <span style={{ width: 3, height: 28, background: C.ink }} /> : null}
                {done ? <span style={{ marginLeft: 'auto', color: C.ok, ...BOLD }}>&#10003;</span> : null}
              </div>
            </div>
          );
        })}
        <div style={{ ...BOLD, marginTop: 26, height: 66, borderRadius: 999, border: `3px solid ${C.ink}`,
          background: sent > 0.5 ? C.ok : C.accent, color: sent > 0.5 ? C.surface : C.ink, fontSize: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `5px 5px 0 ${C.ink}`,
          transform: `scale(${1 + 0.06 * window4(f, 290, 296, 300, 310)})` }}>
          {sent > 0.5 ? 'Отклик отправлен' : 'Отправить'}
        </div>
      </div>
      <div style={{ ...BOLD, position: 'absolute', top: 76, right: 22, padding: '8px 14px', borderRadius: 999, border: `2px solid ${C.ink}`,
        background: C.soft, fontSize: 18 }}>Заполняет Юпитер</div>
    </div>
  );
};

// ── Сообщение работодателя ──────────────────────────────────────────────────
const Chat: React.FC<{ f: number }> = ({ f }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 334, fps, config: { damping: 13, mass: 0.8 } });
  const fade = interpolate(f, [395, 415], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', width: 620, display: 'flex', gap: 18, alignItems: 'flex-end',
      opacity: Math.min(1, pop) * fade, transform: `translateY(${(1 - pop) * 80}px) scale(${0.85 + 0.15 * pop})`,
      transformOrigin: 'bottom left' }}>
      <div style={{ ...HEAD, flex: 'none', width: 78, height: 78, borderRadius: 24, border: `3px solid ${C.ink}`, background: '#D8F0E2',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>Ф</div>
      <div style={{ padding: '24px 28px', borderRadius: '30px 30px 30px 8px', border: `3px solid ${C.ink}`, background: C.surface,
        boxShadow: `6px 6px 0 ${C.ink}` }}>
        <div style={{ ...BOLD, fontSize: 18, color: C.muted }}>Финтех · HR</div>
        <div style={{ ...BOLD, marginTop: 8, fontSize: 28, lineHeight: 1.3 }}>Здравствуйте! Приглашаем на собеседование в четверг в 15:00</div>
      </div>
    </div>
  );
};

// ── Сцена ───────────────────────────────────────────────────────────────────
export const Hero: React.FC = () => {
  const f = useCurrentFrame();
  const loop = (f / HERO_FRAMES) * Math.PI * 2;
  // Камера: медленный наезд и дрейф, к концу возвращается к началу.
  const zoom = 1 + 0.035 * (1 - Math.cos(loop)) / 2;
  const driftX = Math.sin(loop) * 18;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <style>{FONTS}</style>
      {/* тёплые пятна света */}
      <div style={{ position: 'absolute', width: 1100, height: 1100, borderRadius: '50%', left: 1050 + Math.sin(loop) * 60,
        top: -380 + Math.cos(loop) * 40, background: 'radial-gradient(circle, rgba(255,107,26,.55), rgba(255,107,26,0) 62%)' }} />
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', left: -320 + Math.cos(loop) * 50,
        top: 420 + Math.sin(loop) * 50, background: 'radial-gradient(circle, rgba(255,190,140,.75), rgba(255,190,140,0) 62%)' }} />
      {/* сетка точек */}
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(20,20,20,.13) 2px, transparent 2px)', backgroundSize: '44px 44px',
        transform: `translate(${(f * 0.4) % 44}px, ${(f * 0.25) % 44}px)` }} />
      <AbsoluteFill style={{ transform: `scale(${zoom}) translateX(${driftX}px)` }}>
        {/* телефон справа */}
        <div style={{ position: 'absolute', left: 1240, top: 70, transform: `rotate(${-6 + Math.sin(loop) * 1.5}deg)` }}>
          <Phone f={f} />
        </div>
        {/* анкета и сообщение слева */}
        <div style={{ position: 'absolute', left: 110, top: 150 }}>
          <Form f={f} />
        </div>
        <div style={{ position: 'absolute', left: 140, top: 430 }}>
          <Chat f={f} />
        </div>
        {/* логотип-наклейка */}
        <Img src={staticFile('logo.png')} style={{ position: 'absolute', left: 1120, top: 880, width: 120, height: 120, padding: 14,
          borderRadius: 32, border: `3px solid ${C.ink}`, background: C.surface, boxShadow: `5px 5px 0 ${C.ink}`,
          transform: `rotate(${8 + Math.sin(loop * 2) * 4}deg) translateY(${Math.sin(loop) * 12}px)` }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
