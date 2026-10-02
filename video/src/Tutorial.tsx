/**
 * Обучающий ролик для сайта (решение владельца 02.10.2026): как устроен
 * отклик через Юпитера — с голосом (Яндекс SpeechKit, scripts/voice.py) и
 * субтитрами. Сцены берутся из Hero (тот же интерфейс приложения), их ход
 * растягивается под длину каждой реплики диктора — длины лежат в
 * public/voice/durations.json, текст — voice/script.json.
 */
import React from 'react';
import {
  AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { A, F } from './AppScreen';
import { FONTS, Scene, Title } from './Hero';
import script from '../voice/script.json';
import durations from '../public/voice/durations.json';

const FPS = 30;
const PAD = 0.7; // пауза после реплики, с
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

type Kind = 'title' | 'scene' | 'ask' | 'outro';
/** Сцена под каждую реплику: какой кадр Hero показывать и под каким шагом. */
const PLAN: Record<string, { kind: Kind; from?: number; to?: number; step?: string }> = {
  '01-intro': { kind: 'title' },
  '02-feed': { kind: 'scene', from: 0, to: 38, step: '1 · Листаете вакансии' },
  '03-swipe': { kind: 'scene', from: 38, to: 104, step: '1 · Свайп вправо — отклик' },
  '04-agent': { kind: 'scene', from: 104, to: 300, step: '2 · Юпитер заполняет анкету' },
  '05-ask': { kind: 'ask', step: '2 · Юпитер спрашивает, если не знает' },
  '06-chat': { kind: 'scene', from: 300, to: 410, step: '3 · Ответ приходит в чат' },
  '07-outro': { kind: 'outro' },
};

const D = durations as Record<string, number>;
const SEGMENTS = (script.lines as { id: string; text: string }[]).map(line => ({
  ...line, frames: Math.ceil(((D[line.id] ?? 3) + PAD) * FPS), plan: PLAN[line.id],
}));
const STARTS = SEGMENTS.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + SEGMENTS[i - 1].frames : 0], []);
export const TUTORIAL_FRAMES = SEGMENTS.reduce((n, s) => n + s.frames, 0);

/** Юпитер рядом с анкетой: подпись «ИИ-агент» и что он делает по шагам. */
const AgentOverlay: React.FC<{ t: number; len: number }> = ({ t, len }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: t - 6, fps, config: { damping: 14 } });
  const steps = ['Открывает сайт работодателя', 'Находит анкету', 'Заполняет из профиля', 'Прикладывает резюме', 'Отправляет отклик'];
  return (
    <>
      <div style={{ position: 'absolute', left: 760, top: 60, width: 300, transform: `scale(${pop}) rotate(${(1 - pop) * 20}deg)`,
        filter: 'drop-shadow(8px 10px 0 rgba(20,20,20,.18))' }}>
        <Img src={staticFile('jupiter.webp')} style={{ width: '100%' }} />
      </div>
      <div style={{ ...F.bold, position: 'absolute', left: 1010, top: 110, padding: '12px 20px', borderRadius: 999, border: `3px solid ${A.ink}`,
        background: A.accent, fontSize: 26, opacity: pop, boxShadow: `5px 5px 0 ${A.ink}` }}>Юпитер — ИИ-агент</div>
      <div style={{ position: 'absolute', left: 790, top: 400, display: 'grid', gap: 12 }}>
        {steps.map((s, i) => {
          const k = interpolate(t, [len * (0.12 + i * 0.15), len * (0.12 + i * 0.15) + 10], [0, 1], { ...clamp, easing: ease });
          return (
            <div key={s} style={{ ...F.bold, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderRadius: 18,
              border: `3px solid ${A.ink}`, background: A.surface, fontSize: 24, opacity: k, transform: `translateX(${(1 - k) * 40}px)` }}>
              <span style={{ width: 30, height: 30, borderRadius: 15, background: A.ok, color: '#fff', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 18 }}>&#10003;</span>{s}
            </div>
          );
        })}
      </div>
    </>
  );
};

/** Вопрос, которого нет в профиле: Юпитер спрашивает человека один раз. */
const AskScene: React.FC<{ t: number; len: number }> = ({ t, len }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: t, fps, config: { damping: 14 } });
  const pick = t > len * 0.45;
  const saved = interpolate(t, [len * 0.6, len * 0.6 + 12], [0, 1], { ...clamp, easing: ease });
  const opts = ['Сразу', 'Через 2 недели', 'Через месяц'];
  return (
    <AbsoluteFill style={{ background: A.bg, alignItems: 'center', justifyContent: 'center' }}>
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(20,20,20,.13) 2px, transparent 2px)', backgroundSize: '44px 44px' }} />
      <div style={{ position: 'absolute', width: 1100, height: 1100, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,107,26,.35), rgba(255,107,26,0) 62%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 50, transform: `scale(${0.9 + 0.1 * pop})`, opacity: pop }}>
        <Img src={staticFile('jupiter.webp')} style={{ width: 360, transform: `translateY(${Math.sin(t / 12) * 10}px)` }} />
        <div style={{ width: 760, padding: '36px 40px', borderRadius: 34, border: `4px solid ${A.ink}`, background: A.surface, boxShadow: `10px 10px 0 ${A.ink}` }}>
          <div style={{ ...F.bold, fontSize: 24, color: A.muted }}>Юпитер спрашивает · анкета Нимбус Пэй</div>
          <div style={{ ...F.head, marginTop: 14, fontSize: 40, lineHeight: 1.2 }}>С какой даты готовы выйти на работу?</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 28, flexWrap: 'wrap' }}>
            {opts.map((o, i) => (
              <div key={o} style={{ ...F.bold, padding: '16px 26px', borderRadius: 999, border: `3px solid ${A.ink}`, fontSize: 26,
                background: pick && i === 1 ? A.accent : A.surface, boxShadow: pick && i === 1 ? `5px 5px 0 ${A.ink}` : 'none' }}>{o}</div>
            ))}
          </div>
          <div style={{ ...F.bold, marginTop: 28, display: 'flex', alignItems: 'center', gap: 12, fontSize: 24, color: A.ok, opacity: saved }}>
            &#10003; Сохранено — в следующих анкетах Юпитер ответит сам
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Subtitle: React.FC<{ text: string; t: number }> = ({ text, t }) => {
  const k = interpolate(t, [0, 8], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ position: 'absolute', left: 50, bottom: 46, width: 1180, opacity: k }}>
      {/* Слева: справа в кадре телефон, субтитр не должен его закрывать. */}
      <div style={{ ...F.bold, display: 'inline-block', padding: '16px 28px', borderRadius: 22, background: 'rgba(20,20,20,.86)', color: '#fff',
        fontSize: 32, lineHeight: 1.3 }}>{text}</div>
    </div>
  );
};

/** Крупный заголовок шага слева — там, где в сцене ленты пусто. */
const BIG: Record<string, [string, string]> = {
  '02-feed': ['Листайте', 'вакансии как ленту'],
  '03-swipe': ['Свайп вправо', '= отклик'],
};
const BigTitle: React.FC<{ id: string; t: number }> = ({ id, t }) => {
  const k = interpolate(t, [4, 18], [0, 1], { ...clamp, easing: ease });
  const [a, b] = BIG[id];
  return (
    <div style={{ position: 'absolute', left: 90, top: 300, opacity: k, transform: `translateY(${(1 - k) * 40}px)` }}>
      <div style={{ ...F.head, fontSize: 104, lineHeight: 1 }}>{a}</div>
      <div style={{ ...F.head, marginTop: 16, fontSize: 64, color: A.accent, textShadow: `4px 4px 0 ${A.ink}` }}>{b}</div>
    </div>
  );
};

const StepChip: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ ...F.bold, position: 'absolute', left: 50, top: 44, padding: '12px 22px', borderRadius: 999, border: `3px solid ${A.ink}`,
    background: A.surface, fontSize: 26, boxShadow: `5px 5px 0 ${A.ink}` }}>{text}</div>
);

export const Tutorial: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      <style>{FONTS}</style>
      {/* Музыка — тише голоса и по кругу (scripts/music.py). */}
      <Audio src={staticFile('music.wav')} loop volume={k => interpolate(k, [0, 15, TUTORIAL_FRAMES - 30, TUTORIAL_FRAMES], [0, 0.16, 0.16, 0], clamp)} />
      {SEGMENTS.map((s, i) => {
        const t = f - STARTS[i];
        const { kind, from = 0, to = 0, step } = s.plan;
        return (
          <Sequence key={s.id} from={STARTS[i]} durationInFrames={s.frames}>
            {kind === 'title' ? <Title f={t} sub="Как работает JobToo — за минуту" /> : null}
            {kind === 'outro' ? (
              <Title f={t} sub="jobtoo.ru" extra={
                <div style={{ ...F.bold, marginTop: 40, padding: '22px 44px', borderRadius: 999, border: `4px solid ${A.ink}`, background: A.accent,
                  boxShadow: `8px 8px 0 ${A.ink}`, fontSize: 38 }}>Скачайте в RuStore</div>
              } />
            ) : null}
            {kind === 'scene' ? (
              <>
                <Scene f={interpolate(t, [0, s.frames], [from, to], clamp)} />
                {s.id === '04-agent' ? <AgentOverlay t={t} len={s.frames} /> : null}
                {BIG[s.id] ? <BigTitle id={s.id} t={t} /> : null}
              </>
            ) : null}
            {kind === 'ask' ? <AskScene t={t} len={s.frames} /> : null}
            {step ? <StepChip text={step} /> : null}
            <Subtitle text={s.text} t={t} />
            <Audio src={staticFile(`voice/${s.id}.wav`)} />
          </Sequence>
        );
      })}
    </>
  );
};
