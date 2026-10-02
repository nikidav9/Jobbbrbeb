"""Музыка к рекламному ролику JobToo — синтез в коде, без чужих сэмплов.

Решение владельца 02.10.2026: своя, чтобы не было вопросов с лицензией.
Лёгкий динамичный луп: 112 уд/мин, ля минор (Am–F–C–G), бочка, хлопок,
хэты, бас, пэд и арпеджио. Длина — как у Promo (21,5 с): первые такты
только пэд и арпеджио (заставка), дальше бит, в конце затихание.

    python3 scripts/music.py public/music.wav

Только стандартная библиотека Python. Шум — с фиксированным зерном: файл
собирается одинаково при каждом запуске.
"""
import array
import math
import random
import sys
import wave

SR = 44100
SECONDS = 21.5          # PROMO_FRAMES / 30 (src/Hero.tsx)
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
N = int(SR * SECONDS)
rng = random.Random(2026)

# Am – F – C – G: корень баса и аккорд пэда (частоты нот).
def hz(semi_from_a4: float) -> float:
    return 440.0 * 2 ** (semi_from_a4 / 12)

CHORDS = [  # (бас, ноты аккорда) в полутонах от A4
    (-24, [-12, -9, -5]),    # Am: A2 | A3 C4 E4
    (-28, [-16, -12, -9]),   # F:  F2 | F3 A3 C4
    (-33, [-9, -5, -2]),     # C:  C2 | C4 E4 G4 (обращение)
    (-26, [-14, -10, -7]),   # G:  G2 | G3 B3 D4
]
ARP = [0, 1, 2, 1, 2, 0, 1, 2]  # порядок нот аккорда в арпеджио (восьмые)

out = array.array('d', [0.0]) * N


def add(start: float, samples, gain: float = 1.0) -> None:
    i0 = int(start * SR)
    for k, v in enumerate(samples):
        i = i0 + k
        if i >= N:
            break
        out[i] += v * gain


def kick():
    n = int(0.32 * SR)
    phase = 0.0
    for k in range(n):
        t = k / SR
        f = 45 + 95 * math.exp(-t * 28)
        phase += 2 * math.pi * f / SR
        yield math.sin(phase) * math.exp(-t * 9)


def clap():
    n = int(0.22 * SR)
    prev = 0.0
    for k in range(n):
        t = k / SR
        x = rng.uniform(-1, 1)
        hp = x - prev  # грубый фильтр верхних — «хлопок», а не «шум»
        prev = x
        env = math.exp(-t * 22) * (1 + 0.6 * (t < 0.012))
        yield hp * env * 0.6


def hat(open_: bool = False):
    n = int((0.14 if open_ else 0.045) * SR)
    prev = 0.0
    for k in range(n):
        t = k / SR
        x = rng.uniform(-1, 1)
        hp = x - prev
        prev = x
        yield hp * math.exp(-t * (18 if open_ else 70)) * 0.35


def tone(freq: float, dur: float, harmonics, attack: float, decay: float):
    n = int(dur * SR)
    for k in range(n):
        t = k / SR
        env = min(1.0, t / attack) * math.exp(-t * decay)
        v = sum(a * math.sin(2 * math.pi * freq * h * t) for h, a in harmonics)
        yield v * env


bars = int(SECONDS / BAR) + 1
for b in range(bars):
    t0 = b * BAR
    bass, notes = CHORDS[b % 4]
    beat_on = b >= 1  # первый такт — заставка: без бита
    # Пэд: три ноты, мягкая атака, лёгкая расстройка — «воздух».
    for semi in notes:
        for det in (-0.06, 0.06):
            add(t0, tone(hz(semi + det), BAR, [(1, 1.0), (2, 0.25)], 0.25, 0.6), 0.045)
    # Арпеджио восьмыми, октавой выше.
    for j in range(8):
        semi = notes[ARP[j]] + 12
        add(t0 + j * BEAT / 2, tone(hz(semi), 0.3, [(1, 1.0), (2, 0.4), (3, 0.15)], 0.004, 9), 0.07)
    if not beat_on:
        continue
    for q in range(4):
        tb = t0 + q * BEAT
        add(tb, kick(), 0.9)
        if q in (1, 3):
            add(tb, clap(), 0.55)
        add(tb + BEAT / 2, hat(open_=(q == 3)), 0.5)
        add(tb, hat(), 0.3)
        # Бас: восьмые с акцентом на долю.
        for e in range(2):
            add(tb + e * BEAT / 2, tone(hz(bass), BEAT / 2 * 0.9, [(1, 1.0), (2, 0.5), (3, 0.2)], 0.005, 5),
                0.22 if e == 0 else 0.15)

# Затухание в конце и мягкий вход, затем нормировка с мягким ограничением.
fade_in, fade_out = int(0.4 * SR), int(1.6 * SR)
for i in range(N):
    g = 1.0
    if i < fade_in:
        g = i / fade_in
    if i > N - fade_out:
        g = min(g, (N - i) / fade_out)
    out[i] = math.tanh(out[i] * 1.2) * g
peak = max(abs(v) for v in out) or 1.0
scale = 0.7 / peak  # около −3 дБ

pcm = array.array('h', (int(v * scale * 32767) for v in out))
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'public/music.wav', 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
