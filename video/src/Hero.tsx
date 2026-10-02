/**
 * Ролики JobToo (решение владельца 02.10.2026). Интерфейс в телефоне — 1:1 с
 * приложением (AppScreen.tsx), логотип — тот же, что в шапке приложения.
 *
 * Hero — фон первого экрана сайта: 15 с по кругу, без звука, центр кадра
 * спокойный (поверх лежит заголовок). Такты:
 *   0–4 с    лента: палец тянет карточку вправо, «ОТКЛИК», молнии 15 → 14;
 *   4–11 с   слева анкета на сайте работодателя — её заполняет Юпитер;
 *   8–13 с   в телефоне вкладка «Отклики»: «Отправлено», затем уведомление
 *            и значок «Приглашение»; слева — сообщение работодателя;
 *   13–15 с  возврат к первому кадру — шва при зацикливании нет.
 * Promo — то же с заставкой (большой логотип) и концовкой «Скачайте в RuStore»:
 * для окна «Смотреть ролик», RuStore и соцсетей.
 * Вакансии, компании и кандидат — образцы; почта example.ru.
 */
import React from 'react';
import {
  AbsoluteFill, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { A, ActionRow, F, FeedCard, FeedHeader, ResponsesScreen, TabBar, VACS } from './AppScreen';

export const HERO_FRAMES = 450;
export const INTRO = 90;
export const OUTRO = 105;
export const PROMO_FRAMES = INTRO + HERO_FRAMES + OUTRO;

const FONTS = `
@font-face { font-family: 'U'; font-weight: 700; src: url('${staticFile('unbounded-cyrillic-700-normal.woff2')}') format('woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: 'U'; font-weight: 700; src: url('${staticFile('unbounded-latin-700-normal.woff2')}') format('woff2'); unicode-range: U+0000-00FF, U+2000-206F, U+20BD; }
@font-face { font-family: 'M'; font-weight: 700; src: url('${staticFile('manrope-cyrillic-700-normal.woff2')}') format('woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: 'M'; font-weight: 700; src: url('${staticFile('manrope-latin-700-normal.woff2')}') format('woff2'); unicode-range: U+0000-00FF, U+2000-206F, U+20BD; }
@font-face { font-family: 'M'; font-weight: 500; src: url('${staticFile('manrope-500.ttf')}') format('truetype'); }
`;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
const win = (f: number, a: number, b: number, c: number, d: number) =>
  interpolate(f, [a, b, c, d], [0, 1, 1, 0], { ...clamp, easing: ease });

// ── Телефон с экраном приложения ────────────────────────────────────────────
const SCALE = 1.15;

const Phone: React.FC<{ f: number }> = ({ f }) => {
  const { fps } = useVideoConfig();
  const back = interpolate(f, [400, 440], [0, 1], { ...clamp, easing: ease });   // возврат к началу
  // Свайп: карточка едет за пальцем, после отпускания — улетает пружиной.
  const follow = interpolate(f, [40, 86], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const out = spring({ frame: f - 86, fps, config: { damping: 18, mass: 0.9 } });
  const x = (follow * 120 + out * 700) * (1 - back);
  const rot = (follow * 7 + out * 16) * (1 - back);
  const stamp = interpolate(f, [48, 78], [0, 1], clamp) * (1 - back);
  const promote = out * (1 - back);
  const press = win(f, 84, 88, 92, 100);
  const bolts = f >= 90 && back < 0.5 ? 14 : 15;
  const boltPulse = win(f, 90, 94, 98, 108);
  // Палец: свайп по карточке, потом тап по вкладке «Отклики».
  const fIn = win(f, 28, 40, 86, 98);
  const tap = win(f, 222, 232, 244, 254);
  const tapPress = win(f, 236, 239, 241, 246);
  // Экран «Отклики» поверх ленты.
  const resp = interpolate(f, [244, 262, 392, 410], [0, 1, 1, 0], { ...clamp, easing: ease });
  const invited = interpolate(f, [318, 322], [0, 1], clamp);
  const push = win(f, 300, 316, 372, 386);

  return (
    <div style={{ position: 'relative', width: 390 * SCALE + 32, height: 844 * SCALE + 32, padding: 16, borderRadius: 74, background: A.ink,
      border: `4px solid ${A.ink}`, boxShadow: '22px 26px 0 rgba(20,20,20,.2)' }}>
      <div style={{ position: 'relative', width: 390 * SCALE, height: 844 * SCALE, borderRadius: 58, overflow: 'hidden', background: A.bg }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 390, height: 844, transform: `scale(${SCALE})`, transformOrigin: '0 0' }}>
          {/* статус-бар */}
          <div style={{ ...F.bold, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 30px 0', fontSize: 15 }}>
            <span>9:41</span>
            <span style={{ width: 110, height: 30, borderRadius: 16, background: A.ink }} />
            <span style={{ width: 22, height: 12, borderRadius: 3, border: `2px solid ${A.ink}` }} />
          </div>
          {/* Лента */}
          <div style={{ position: 'absolute', top: 58, left: 0, right: 0, bottom: 0, opacity: 1 - resp }}>
            <FeedHeader bolts={bolts} boltPulse={boltPulse} />
            <div style={{ position: 'relative', height: 452, margin: '14px 21px 0' }}>
              <div style={{ position: 'absolute', left: 22, right: 22, top: 26, bottom: -26, borderRadius: 30, border: `2px solid ${A.ink}`, background: A.stack2 }} />
              <div style={{ position: 'absolute', left: 11, right: 11, top: 13, bottom: -13, borderRadius: 30, border: `2px solid ${A.ink}`, background: A.stack1 }} />
              <div style={{ position: 'absolute', inset: 0, transform: `translateY(${13 - 13 * promote}px) scale(${0.96 + 0.04 * promote})`, opacity: promote }}>
                <FeedCard v={VACS[1]} />
              </div>
              <div style={{ position: 'absolute', inset: 0, transform: `translateX(${x}px) rotate(${rot}deg)` }}>
                <FeedCard v={VACS[0]} stampYes={stamp} />
              </div>
            </div>
            <div style={{ marginTop: 40 }}><ActionRow press="yes" amount={press} /></div>
          </div>
          {/* Отклики */}
          <div style={{ position: 'absolute', top: 58, left: 0, right: 0, bottom: 0, opacity: resp, transform: `translateX(${(1 - resp) * 40}px)` }}>
            <ResponsesScreen invited={invited} />
          </div>
          <TabBar active={resp > 0.5 ? 1 : 0} />
          {/* уведомление */}
          <div style={{ position: 'absolute', left: 12, right: 12, top: 8, padding: '12px 14px', borderRadius: 22, background: 'rgba(255,255,255,.96)',
            border: `2px solid ${A.ink}`, boxShadow: `4px 4px 0 ${A.ink}`, display: 'flex', gap: 11, alignItems: 'center',
            transform: `translateY(${(1 - push) * -130}px)` }}>
            <div style={{ flex: 'none', width: 40, height: 40, borderRadius: 11, background: A.surface, border: `1.5px solid ${A.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Img src={staticFile('jt-logo.png')} style={{ width: 30, height: 20, objectFit: 'contain' }} />
            </div>
            <div>
              <div style={{ ...F.bold, fontSize: 13, color: A.muted }}>JobToo · сейчас</div>
              <div style={{ ...F.bold, fontSize: 14.5, lineHeight: 1.3 }}>Финтех приглашает вас на собеседование</div>
            </div>
          </div>
        </div>
      </div>
      {/* палец: свайп по карточке и тап по вкладке */}
      <div style={{ position: 'absolute', left: (150 + follow * 120) * SCALE, top: 470 * SCALE, width: 70, height: 70, borderRadius: 35,
        background: 'rgba(20,20,20,.25)', border: '4px solid rgba(255,255,255,.95)', opacity: fIn }} />
      <div style={{ position: 'absolute', left: 205 * SCALE, top: 790 * SCALE, width: 70, height: 70, borderRadius: 35,
        background: 'rgba(20,20,20,.25)', border: '4px solid rgba(255,255,255,.95)', opacity: tap, transform: `scale(${1 - 0.2 * tapPress})` }} />
    </div>
  );
};

// ── Анкета на сайте работодателя ────────────────────────────────────────────
const FIELDS: [string, string][] = [
  ['Имя и фамилия', 'Алексей Смирнов'],
  ['Почта', 'a.smirnov@example.ru'],
  ['Опыт', '4 года, React и TypeScript'],
  ['Резюме', 'Резюме.pdf'],
];

const Form: React.FC<{ f: number }> = ({ f }) => {
  const shown = win(f, 104, 128, 322, 338);
  const start = 132;
  const per = 36;
  const sentAt = start + per * FIELDS.length;
  const sent = f >= sentAt + 6;
  return (
    <div style={{ width: 640, borderRadius: 30, border: `3px solid ${A.ink}`, background: A.surface, boxShadow: `8px 8px 0 ${A.ink}`,
      overflow: 'hidden', opacity: shown, transform: `translateY(${(1 - shown) * 60}px) rotate(${-3 + shown}deg)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderBottom: `3px solid ${A.ink}`, background: A.chip }}>
        {['#E5484D', '#F5B700', A.ok].map(c => <span key={c} style={{ width: 15, height: 15, borderRadius: '50%', background: c, border: `2px solid ${A.ink}` }} />)}
        <span style={{ ...F.bold, marginLeft: 12, fontSize: 19, color: A.muted }}>careers.fintech.ru / отклик</span>
      </div>
      <div style={{ padding: '24px 30px 30px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ ...F.head, fontSize: 28 }}>Анкета кандидата</div>
          <div style={{ ...F.bold, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, border: `2px solid ${A.ink}`,
            background: A.soft, fontSize: 16 }}>
            <Img src={staticFile('jt-logo.png')} style={{ width: 26, height: 17, objectFit: 'contain' }} />Заполняет Юпитер
          </div>
        </div>
        {FIELDS.map(([label, value], i) => {
          const t0 = start + i * per;
          const typed = Math.floor(interpolate(f, [t0, t0 + per - 8], [0, value.length], clamp));
          const done = f >= t0 + per - 8;
          const active = f >= t0 && !done;
          return (
            <div key={label} style={{ marginTop: 16 }}>
              <div style={{ ...F.bold, fontSize: 17, color: A.muted }}>{label}</div>
              <div style={{ ...F.body, marginTop: 7, height: 54, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 21,
                borderRadius: 16, border: `3px solid ${active ? A.accent : A.ink}`, background: done ? '#FAF6F0' : A.surface }}>
                {value.slice(0, typed)}
                {active && f % 16 < 9 ? <span style={{ width: 3, height: 26, background: A.ink }} /> : null}
                {done ? <span style={{ ...F.bold, marginLeft: 'auto', color: A.ok }}>&#10003;</span> : null}
              </div>
            </div>
          );
        })}
        <div style={{ ...F.bold, marginTop: 24, height: 62, borderRadius: 999, border: `3px solid ${A.ink}`, background: sent ? A.ok : A.accent,
          color: sent ? '#fff' : A.ink, fontSize: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `5px 5px 0 ${A.ink}`,
          transform: `scale(${1 + 0.06 * win(f, sentAt, sentAt + 5, sentAt + 9, sentAt + 18)})` }}>
          {sent ? 'Отклик отправлен' : 'Отправить'}
        </div>
      </div>
    </div>
  );
};

// ── Сообщение работодателя ──────────────────────────────────────────────────
const Chat: React.FC<{ f: number }> = ({ f }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 334, fps, config: { damping: 13, mass: 0.8 } });
  const fade = interpolate(f, [392, 410], [1, 0], clamp);
  return (
    <div style={{ width: 640, display: 'flex', gap: 18, alignItems: 'flex-end', opacity: Math.min(1, pop) * fade,
      transform: `translateY(${(1 - pop) * 80}px) scale(${0.85 + 0.15 * pop})`, transformOrigin: 'bottom left' }}>
      <div style={{ ...F.bold, flex: 'none', width: 76, height: 76, borderRadius: 38, background: A.purple, color: '#fff', fontSize: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${A.ink}` }}>Ф</div>
      <div style={{ padding: '22px 28px', borderRadius: '30px 30px 30px 8px', border: `3px solid ${A.ink}`, background: A.surface, boxShadow: `6px 6px 0 ${A.ink}` }}>
        <div style={{ ...F.bold, fontSize: 18, color: A.muted }}>Финтех · HR</div>
        <div style={{ ...F.bold, marginTop: 8, fontSize: 28, lineHeight: 1.3 }}>Здравствуйте! Приглашаем на собеседование в четверг в 15:00</div>
      </div>
    </div>
  );
};

// ── Логотип-наклейка (тот же, что в шапке приложения) ───────────────────────
const LogoSticker: React.FC<{ f: number; size: number }> = ({ f, size }) => {
  const loop = (f / HERO_FRAMES) * Math.PI * 2;
  return (
    <div style={{ width: size * 1.35, height: size, padding: size * 0.16, borderRadius: size * 0.28, border: `4px solid ${A.ink}`,
      background: A.surface, boxShadow: `7px 7px 0 ${A.ink}`, transform: `rotate(${-7 + Math.sin(loop * 2) * 3}deg) translateY(${Math.sin(loop) * 10}px)` }}>
      <Img src={staticFile('jt-logo.png')} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
};

/** Сцена 15 с: фон, телефон, анкета, сообщение, логотип. */
const Scene: React.FC<{ f: number }> = ({ f }) => {
  const loop = (f / HERO_FRAMES) * Math.PI * 2;
  const zoom = 1 + 0.03 * (1 - Math.cos(loop)) / 2;
  return (
    <AbsoluteFill style={{ background: A.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 1150, height: 1150, borderRadius: '50%', left: 1000 + Math.sin(loop) * 60, top: -400 + Math.cos(loop) * 40,
        background: 'radial-gradient(circle, rgba(255,107,26,.55), rgba(255,107,26,0) 62%)' }} />
      <div style={{ position: 'absolute', width: 950, height: 950, borderRadius: '50%', left: -340 + Math.cos(loop) * 50, top: 400 + Math.sin(loop) * 50,
        background: 'radial-gradient(circle, rgba(255,190,140,.75), rgba(255,190,140,0) 62%)' }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(20,20,20,.13) 2px, transparent 2px)', backgroundSize: '44px 44px',
        transform: `translate(${(f * 0.4) % 44}px, ${(f * 0.25) % 44}px)` }} />
      <AbsoluteFill style={{ transform: `scale(${zoom}) translateX(${Math.sin(loop) * 16}px)` }}>
        <div style={{ position: 'absolute', left: 1300, top: 40, transform: `rotate(${-5 + Math.sin(loop) * 1.2}deg)` }}><Phone f={f} /></div>
        <div style={{ position: 'absolute', left: 100, top: 150 }}><Form f={f} /></div>
        <div style={{ position: 'absolute', left: 120, top: 430 }}><Chat f={f} /></div>
        <div style={{ position: 'absolute', left: 1040, top: 790 }}><LogoSticker f={f} size={170} /></div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Hero: React.FC = () => {
  const f = useCurrentFrame();
  return (<><style>{FONTS}</style><Scene f={f} /></>);
};

// ── Рекламная версия: заставка → сцена → концовка ───────────────────────────
const Title: React.FC<{ f: number; sub: string; extra?: React.ReactNode }> = ({ f, sub, extra }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 12, mass: 0.9 } });
  const text = spring({ frame: f - 14, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: A.bg, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: 1300, height: 1300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,107,26,.45), rgba(255,107,26,0) 62%)' }} />
      <div style={{ width: 470, height: 340, padding: 56, borderRadius: 90, border: `6px solid ${A.ink}`, background: A.surface, boxShadow: `14px 14px 0 ${A.ink}`,
        transform: `scale(${pop}) rotate(${(1 - pop) * -20}deg)` }}>
        <Img src={staticFile('jt-logo.png')} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <div style={{ ...F.head, marginTop: 70, fontSize: 92, textTransform: 'uppercase', opacity: text, transform: `translateY(${(1 - text) * 50}px)` }}>
        Работа в IT — <span style={{ color: A.accent, textShadow: `6px 6px 0 ${A.ink}` }}>свайпом</span>
      </div>
      <div style={{ ...F.bold, marginTop: 26, fontSize: 36, color: A.body, opacity: text }}>{sub}</div>
      {extra}
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outro = f - INTRO - HERO_FRAMES;
  const badge = spring({ frame: outro - 30, fps, config: { damping: 14 } });
  return (
    <>
      <style>{FONTS}</style>
      <Sequence durationInFrames={INTRO}><Title f={f} sub="Листайте IT-вакансии — откликается Юпитер" /></Sequence>
      <Sequence from={INTRO} durationInFrames={HERO_FRAMES}><Scene f={f - INTRO} /></Sequence>
      <Sequence from={INTRO + HERO_FRAMES}>
        <Title f={outro} sub="jobtoo.ru" extra={
          <div style={{ ...F.bold, marginTop: 40, padding: '22px 44px', borderRadius: 999, border: `4px solid ${A.ink}`, background: A.accent,
            boxShadow: `8px 8px 0 ${A.ink}`, fontSize: 38, transform: `scale(${badge})` }}>Скачайте в RuStore</div>
        } />
      </Sequence>
    </>
  );
};
