/**
 * Обучающий ролик для сайта (решения владельца 02.10.2026): весь путь в
 * приложении — лента, свайп влево, свайп вправо, Юпитер заполняет анкету,
 * вопрос человеку, вкладка «Отклики», экран отклика со статусом и историей,
 * ответ работодателя. Голос — Яндекс SpeechKit (scripts/voice.py), текст —
 * voice/script.json, длины реплик — public/voice/durations.json: каждая сцена
 * идёт ровно столько, сколько звучит её реплика.
 *
 * Раскладка кадра 1920×1080: телефон справа, слева колонка — шаг, заголовок,
 * наглядная часть (анкета, вопрос, сообщение) и субтитр карточкой в стиле
 * приложения. Субтитр живёт в своей колонке и ничего не закрывает.
 */
import React from 'react';
import {
  AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { A, ActionRow, F, FeedCard, FeedHeader, Icon, ResponsesScreen, TabBar, VACS } from './AppScreen';
import { BRANDS, BrandMark } from './Brands';
import { Chat, Form, FONTS, Title } from './Hero';
import script from '../voice/script.json';
import durations from '../public/voice/durations.json';

const FPS = 30;
const PAD = 0.7; // пауза после реплики, с
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
const lerp = (t: number, a: number, b: number, from = 0, to = 1) =>
  interpolate(t, [a, b], [from, to], { ...clamp, easing: ease });

const D = durations as Record<string, number>;
const SEGMENTS = (script.lines as { id: string; text: string }[]).map(line => ({
  ...line, frames: Math.ceil(((D[line.id] ?? 3) + PAD) * FPS),
}));
const STARTS = SEGMENTS.reduce<number[]>((acc, _s, i) => [...acc, i ? acc[i - 1] + SEGMENTS[i - 1].frames : 0], []);
export const TUTORIAL_FRAMES = SEGMENTS.reduce((n, s) => n + s.frames, 0);

/** Шаг и крупный заголовок слева для каждой реплики. */
const LEFT: Record<string, { step: string; title?: [string, string] }> = {
  '02-feed': { step: 'Шаг 1 · Лента', title: ['Листайте', 'вакансии как ленту'] },
  '03-left': { step: 'Шаг 1 · Не подходит', title: ['Свайп влево', '= мимо'] },
  '04-right': { step: 'Шаг 1 · Нравится', title: ['Свайп вправо', '= отклик'] },
  '05-agent': { step: 'Шаг 2 · Юпитер — ИИ-агент' },
  '06-ask': { step: 'Шаг 2 · Чего нет в профиле' },
  '07-tab': { step: 'Шаг 3 · Вкладка «Отклики»', title: ['Отклики', 'все в одном месте'] },
  '08-open': { step: 'Шаг 3 · Статус и история', title: ['Откройте', 'отклик'] },
  '09-reply': { step: 'Шаг 4 · Ответ работодателя' },
};

// ── Экран отклика: статус и история, как app/jupiter-application.tsx ─────────
const AppDetail: React.FC<{ invited: number }> = ({ invited }) => {
  const rows: [string, string, boolean][] = [
    ...(invited > 0.5 ? [['Ответ работодателя: приглашение на собеседование', '14:05', true] as [string, string, boolean]] : []),
    ['Отклик отправлен на сайт компании', '12:41', false],
    ['Юпитер заполнил анкету из вашего профиля', '12:40', false],
    ['Вы откликнулись свайпом', '12:39', false],
  ];
  return (
    <div style={{ padding: '0 21px' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 46, gap: 10 }}>
        <span style={{ ...F.bold, fontSize: 22 }}>&#8249;</span>
        <div style={{ ...F.head, fontSize: 18 }}>Отклик</div>
      </div>
      <div style={{ marginTop: 10, padding: 18, borderRadius: 24, border: `2px solid ${A.ink}`, background: A.surface, boxShadow: `5px 5px 0 ${A.ink}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BrandMark b="nimbus" size={46} />
          <div>
            <div style={{ ...F.bold, fontSize: 14, color: A.muted }}>{BRANDS.nimbus.name}</div>
            <div style={{ ...F.bold, fontSize: 17, lineHeight: 1.25 }}>{VACS[0].title}</div>
          </div>
        </div>
        <div style={{ ...F.bold, display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '8px 13px', borderRadius: 999,
          fontSize: 14, border: `1.5px solid ${A.ink}`, background: invited > 0.5 ? A.accent : A.ok, color: invited > 0.5 ? A.ink : '#fff' }}>
          {invited > 0.5 ? 'Приглашение на собеседование' : <>{Icon.check('#fff')} Отправлено</>}
        </div>
      </div>
      <div style={{ ...F.head, fontSize: 16, marginTop: 22 }}>История отклика</div>
      <div style={{ marginTop: 10 }}>
        {rows.map(([text, time, hot], i) => (
          <div key={text} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: 18, height: 18, borderRadius: 9, border: `2px solid ${A.ink}`, background: hot ? A.accent : i === 0 ? A.ok : A.surface }} />
              {i < rows.length - 1 ? <span style={{ width: 2, flex: 1, minHeight: 34, background: A.line }} /> : null}
            </div>
            <div style={{ paddingBottom: 14 }}>
              <div style={{ ...F.bold, fontSize: 14.5, lineHeight: 1.3 }}>{text}</div>
              <div style={{ ...F.body, fontSize: 12.5, color: A.muted, marginTop: 2 }}>сегодня, {time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Телефон: всё, что происходит в приложении, по репликам ──────────────────
type PhoneState = {
  screen: 'feed' | 'responses' | 'app';
  top: number; next: number;          // индексы карточек в VACS
  dx: number; rot: number;            // сдвиг верхней карточки
  stampYes: number; stampNo: number;
  promote: number;                    // следующая карточка поднимается
  press: 'yes' | 'no' | null; pressAmt: number;
  bolts: number; boltPulse: number;
  invited: number; push: number;
  finger?: { x: number; y: number; o: number; s?: number };
  rowPress?: number;
};

const SCALE = 1.17;
const Phone: React.FC<{ st: PhoneState }> = ({ st }) => (
  <div style={{ position: 'relative', width: 390 * SCALE + 32, height: 844 * SCALE + 32, padding: 16, borderRadius: 74, background: A.ink,
    border: `4px solid ${A.ink}`, boxShadow: '22px 26px 0 rgba(20,20,20,.2)' }}>
    <div style={{ position: 'relative', width: 390 * SCALE, height: 844 * SCALE, borderRadius: 58, overflow: 'hidden', background: A.bg }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 390, height: 844, transform: `scale(${SCALE})`, transformOrigin: '0 0' }}>
        <div style={{ ...F.bold, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 30px 0', fontSize: 15 }}>
          <span>9:41</span><span style={{ width: 110, height: 30, borderRadius: 16, background: A.ink }} />
          <span style={{ width: 22, height: 12, borderRadius: 3, border: `2px solid ${A.ink}` }} />
        </div>
        {st.screen === 'feed' ? (
          <div style={{ position: 'absolute', top: 58, left: 0, right: 0, bottom: 0 }}>
            <FeedHeader bolts={st.bolts} boltPulse={st.boltPulse} />
            <div style={{ position: 'relative', height: 452, margin: '14px 21px 0' }}>
              <div style={{ position: 'absolute', left: 22, right: 22, top: 26, bottom: -26, borderRadius: 30, border: `2px solid ${A.ink}`, background: A.stack2 }} />
              <div style={{ position: 'absolute', left: 11, right: 11, top: 13, bottom: -13, borderRadius: 30, border: `2px solid ${A.ink}`, background: A.stack1 }} />
              <div style={{ position: 'absolute', inset: 0, transform: `translateY(${13 - 13 * st.promote}px) scale(${0.96 + 0.04 * st.promote})`, opacity: st.promote }}>
                <FeedCard v={VACS[st.next]} />
              </div>
              <div style={{ position: 'absolute', inset: 0, transform: `translateX(${st.dx}px) rotate(${st.rot}deg)` }}>
                <FeedCard v={VACS[st.top]} stampYes={st.stampYes} stampNo={st.stampNo} />
              </div>
            </div>
            <div style={{ marginTop: 40 }}><ActionRow press={st.press} amount={st.pressAmt} /></div>
          </div>
        ) : null}
        {st.screen === 'responses' ? (
          <div style={{ position: 'absolute', top: 58, left: 0, right: 0, bottom: 0 }}>
            <div style={{ transform: `scale(${1 - 0.03 * (st.rowPress ?? 0)})`, transformOrigin: '50% 30%' }}>
              <ResponsesScreen invited={st.invited} />
            </div>
          </div>
        ) : null}
        {st.screen === 'app' ? (
          <div style={{ position: 'absolute', top: 58, left: 0, right: 0, bottom: 0 }}><AppDetail invited={st.invited} /></div>
        ) : null}
        <TabBar active={st.screen === 'feed' ? 0 : 1} />
        <div style={{ position: 'absolute', left: 12, right: 12, top: 8, padding: '12px 14px', borderRadius: 22, background: 'rgba(255,255,255,.97)',
          border: `2px solid ${A.ink}`, boxShadow: `4px 4px 0 ${A.ink}`, display: 'flex', gap: 11, alignItems: 'center',
          transform: `translateY(${(1 - st.push) * -140}px)` }}>
          <div style={{ flex: 'none', width: 40, height: 40, borderRadius: 11, background: A.surface, border: `1.5px solid ${A.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Img src={staticFile('jt-logo.png')} style={{ width: 30, height: 20, objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ ...F.bold, fontSize: 13, color: A.muted }}>JobToo · сейчас</div>
            <div style={{ ...F.bold, fontSize: 14.5, lineHeight: 1.3 }}>{BRANDS.nimbus.name} приглашает вас на собеседование</div>
          </div>
        </div>
      </div>
    </div>
    {st.finger ? (
      <div style={{ position: 'absolute', left: st.finger.x * SCALE, top: st.finger.y * SCALE, width: 72, height: 72, borderRadius: 36,
        background: 'rgba(20,20,20,.25)', border: '4px solid rgba(255,255,255,.95)', opacity: st.finger.o, transform: `scale(${st.finger.s ?? 1})` }} />
    ) : null}
  </div>
);

const BASE: PhoneState = {
  screen: 'feed', top: 1, next: 0, dx: 0, rot: 0, stampYes: 0, stampNo: 0, promote: 0, press: null, pressAmt: 0,
  bolts: 10, boltPulse: 0, invited: 0, push: 0,
};

/** Что на телефоне в момент t реплики id (len — её длина в кадрах). */
function phoneAt(id: string, t: number, len: number, fps: number): PhoneState {
  const k = (a: number) => a * len; // доля реплики → кадры
  switch (id) {
    case '02-feed': {
      const peek = Math.sin(t / 16) * 6 * lerp(t, k(.3), k(.5));
      return { ...BASE, dx: peek };
    }
    case '03-left': {
      const follow = lerp(t, k(.15), k(.45));
      const out = spring({ frame: t - k(.45), fps, config: { damping: 18, mass: .9 } });
      return { ...BASE, dx: -(follow * 120 + out * 700), rot: -(follow * 7 + out * 16), stampNo: lerp(t, k(.2), k(.4)) * (1 - out),
        promote: out, press: 'no', pressAmt: lerp(t, k(.42), k(.46)) * (1 - lerp(t, k(.5), k(.55))),
        finger: { x: 150 - follow * 120, y: 470, o: lerp(t, k(.08), k(.15)) * (1 - lerp(t, k(.45), k(.5))) } };
    }
    case '04-right': {
      const follow = lerp(t, k(.15), k(.42));
      const out = spring({ frame: t - k(.42), fps, config: { damping: 18, mass: .9 } });
      return { ...BASE, top: 0, next: 2, dx: follow * 120 + out * 700, rot: follow * 7 + out * 16, stampYes: lerp(t, k(.18), k(.38)) * (1 - out),
        promote: out, press: 'yes', pressAmt: lerp(t, k(.4), k(.44)) * (1 - lerp(t, k(.48), k(.53))),
        bolts: t > k(.45) ? 9 : 10, boltPulse: lerp(t, k(.45), k(.5)) * (1 - lerp(t, k(.55), k(.65))),
        finger: { x: 150 + follow * 120, y: 470, o: lerp(t, k(.08), k(.15)) * (1 - lerp(t, k(.42), k(.47))) } };
    }
    case '05-agent':
    case '06-ask':
      return { ...BASE, top: 2, next: 1, bolts: 9 };
    case '07-tab': {
      const tap = lerp(t, k(.08), k(.18)) * (1 - lerp(t, k(.3), k(.38)));
      const on = t > k(.26);
      return { ...BASE, top: 2, next: 1, bolts: 9, screen: on ? 'responses' : 'feed',
        finger: { x: 205, y: 790, o: tap, s: 1 - 0.2 * lerp(t, k(.2), k(.25)) * (1 - lerp(t, k(.26), k(.3))) } };
    }
    case '08-open': {
      const tap = lerp(t, k(.06), k(.14)) * (1 - lerp(t, k(.24), k(.3)));
      const open = t > k(.22);
      return { ...BASE, screen: open ? 'app' : 'responses', rowPress: lerp(t, k(.16), k(.2)) * (1 - lerp(t, k(.21), k(.24))),
        finger: { x: 180, y: 230, o: tap } };
    }
    case '09-reply': {
      const push = lerp(t, k(.05), k(.15)) * (1 - lerp(t, k(.55), k(.65)));
      return { ...BASE, screen: 'app', invited: lerp(t, k(.15), k(.2)), push };
    }
    default:
      return BASE;
  }
}

// ── Левая колонка ───────────────────────────────────────────────────────────
const StepChip: React.FC<{ text: string; t: number }> = ({ text, t }) => {
  const k = lerp(t, 0, 10);
  return (
    <div style={{ ...F.bold, position: 'absolute', left: 90, top: 70, padding: '12px 22px', borderRadius: 999, border: `3px solid ${A.ink}`,
      background: A.surface, fontSize: 26, boxShadow: `5px 5px 0 ${A.ink}`, opacity: k, transform: `translateY(${(1 - k) * -16}px)` }}>{text}</div>
  );
};

const BigTitle: React.FC<{ title: [string, string]; t: number }> = ({ title, t }) => {
  const k = lerp(t, 4, 18);
  return (
    <div style={{ position: 'absolute', left: 90, top: 250, opacity: k, transform: `translateY(${(1 - k) * 40}px)` }}>
      <div style={{ ...F.head, fontSize: 96, lineHeight: 1 }}>{title[0]}</div>
      <div style={{ ...F.head, marginTop: 18, fontSize: 60, color: A.accent, textShadow: `4px 4px 0 ${A.ink}` }}>{title[1]}</div>
    </div>
  );
};

/** Субтитр — карточка в стиле приложения: белая, обводка, жёсткая тень. */
const Subtitle: React.FC<{ text: string; t: number }> = ({ text, t }) => {
  const k = lerp(t, 0, 9);
  return (
    <div style={{ position: 'absolute', left: 90, bottom: 60, width: 920, opacity: k, transform: `translateY(${(1 - k) * 20}px)` }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', padding: '22px 26px', borderRadius: 28, border: `3px solid ${A.ink}`,
        background: A.surface, boxShadow: `8px 8px 0 ${A.ink}` }}>
        <div style={{ flex: 'none', width: 52, height: 52, borderRadius: 16, border: `2px solid ${A.ink}`, background: A.soft,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Img src={staticFile('jt-logo.png')} style={{ width: 38, height: 26, objectFit: 'contain' }} />
        </div>
        <div style={{ ...F.bold, fontSize: 31, lineHeight: 1.32, color: A.ink }}>{text}</div>
      </div>
    </div>
  );
};

/** Юпитер заполняет анкету на сайте работодателя (анкета из Hero, мельче). */
const AgentVisual: React.FC<{ t: number; len: number }> = ({ t, len }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: t - 4, fps, config: { damping: 14 } });
  return (
    <>
      <div style={{ position: 'absolute', left: 90, top: 150, transform: 'scale(.78)', transformOrigin: '0 0' }}>
        <Form f={interpolate(t, [0, len], [116, 300], clamp)} />
      </div>
      <div style={{ position: 'absolute', left: 640, top: 120, width: 240, transform: `scale(${pop}) rotate(${(1 - pop) * 20}deg)` }}>
        <Img src={staticFile('jupiter.webp')} style={{ width: '100%' }} />
      </div>
      <div style={{ ...F.bold, position: 'absolute', left: 700, top: 360, padding: '10px 18px', borderRadius: 999, border: `3px solid ${A.ink}`,
        background: A.accent, fontSize: 24, boxShadow: `5px 5px 0 ${A.ink}`, opacity: pop }}>ИИ-агент</div>
    </>
  );
};

const AskVisual: React.FC<{ t: number; len: number }> = ({ t, len }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: t, fps, config: { damping: 14 } });
  const pick = t > len * 0.5;
  const saved = lerp(t, len * 0.62, len * 0.62 + 12);
  return (
    <div style={{ position: 'absolute', left: 90, top: 190, display: 'flex', gap: 26, alignItems: 'center', opacity: pop, transform: `scale(${0.92 + 0.08 * pop})`, transformOrigin: '0 50%' }}>
      <Img src={staticFile('jupiter.webp')} style={{ width: 220, transform: `translateY(${Math.sin(t / 12) * 8}px)` }} />
      <div style={{ width: 640, padding: '28px 32px', borderRadius: 30, border: `3px solid ${A.ink}`, background: A.surface, boxShadow: `8px 8px 0 ${A.ink}` }}>
        <div style={{ ...F.bold, fontSize: 20, color: A.muted }}>Юпитер спрашивает · {BRANDS.nimbus.name}</div>
        <div style={{ ...F.head, marginTop: 10, fontSize: 32, lineHeight: 1.2 }}>С какой даты готовы выйти на работу?</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {['Сразу', 'Через 2 недели', 'Через месяц'].map((o, i) => (
            <div key={o} style={{ ...F.bold, padding: '12px 18px', borderRadius: 999, border: `3px solid ${A.ink}`, fontSize: 21,
              background: pick && i === 1 ? A.accent : A.surface, boxShadow: pick && i === 1 ? `4px 4px 0 ${A.ink}` : 'none' }}>{o}</div>
          ))}
        </div>
        <div style={{ ...F.bold, marginTop: 18, fontSize: 20, color: A.ok, opacity: saved }}>&#10003; Сохранено — дальше Юпитер ответит сам</div>
      </div>
    </div>
  );
};

/** Сцена с телефоном: фон, телефон справа, колонка слева. */
const PhoneScene: React.FC<{ id: string; text: string; t: number; len: number }> = ({ id, text, t, len }) => {
  const { fps } = useVideoConfig();
  const left = LEFT[id];
  const st = phoneAt(id, t, len, fps);
  const drift = Math.sin((t + id.length * 40) / 60) * 6;
  return (
    <AbsoluteFill style={{ background: A.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 1150, height: 1150, borderRadius: '50%', left: 1050, top: -420,
        background: 'radial-gradient(circle, rgba(255,107,26,.5), rgba(255,107,26,0) 62%)' }} />
      <div style={{ position: 'absolute', width: 950, height: 950, borderRadius: '50%', left: -380, top: 420,
        background: 'radial-gradient(circle, rgba(255,190,140,.6), rgba(255,190,140,0) 62%)' }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(20,20,20,.12) 2px, transparent 2px)', backgroundSize: '44px 44px' }} />
      <div style={{ position: 'absolute', left: 1190, top: 22 + drift, transform: 'rotate(-3deg)' }}><Phone st={st} /></div>
      {left ? <StepChip text={left.step} t={t} /> : null}
      {left?.title ? <BigTitle title={left.title} t={t} /> : null}
      {id === '05-agent' ? <AgentVisual t={t} len={len} /> : null}
      {id === '06-ask' ? <AskVisual t={t} len={len} /> : null}
      {id === '09-reply' ? <div style={{ position: 'absolute', left: 90, top: 300, transform: 'scale(.95)', transformOrigin: '0 0' }}>
        <Chat f={interpolate(t, [0, len], [330, 380], clamp)} /></div> : null}
      <Subtitle text={text} t={t} />
    </AbsoluteFill>
  );
};

export const Tutorial: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      <style>{FONTS}</style>
      {/* Музыка — тише голоса и по кругу (scripts/music.py). */}
      <Audio src={staticFile('music.wav')} loop volume={k => interpolate(k, [0, 15, TUTORIAL_FRAMES - 30, TUTORIAL_FRAMES], [0, 0.14, 0.14, 0], clamp)} />
      {SEGMENTS.map((s, i) => {
        const t = f - STARTS[i];
        return (
          <Sequence key={s.id} from={STARTS[i]} durationInFrames={s.frames}>
            {s.id === '01-intro' ? <Title f={t} sub="Как работает JobToo — весь путь за минуту" /> : null}
            {s.id === '10-outro' ? (
              <Title f={t} sub="jobtoo.ru" extra={
                <div style={{ ...F.bold, marginTop: 40, padding: '22px 44px', borderRadius: 999, border: `4px solid ${A.ink}`, background: A.accent,
                  boxShadow: `8px 8px 0 ${A.ink}`, fontSize: 38 }}>Скачайте в RuStore</div>
              } />
            ) : null}
            {s.id !== '01-intro' && s.id !== '10-outro' ? <PhoneScene id={s.id} text={s.text} t={t} len={s.frames} /> : null}
            {s.id === '01-intro' || s.id === '10-outro' ? <Subtitle text={s.text} t={t} /> : null}
            <Audio src={staticFile(`voice/${s.id}.wav`)} />
          </Sequence>
        );
      })}
    </>
  );
};
