"""Озвучка обучающего ролика — Яндекс SpeechKit (решение владельца 02.10.2026).

Текст диктора — voice/script.json. Ключ и каталог — те же, что у YandexGPT
(YANDEX_GPT_API_KEY, YANDEX_GPT_FOLDER_ID), только в окружении: в репозиторий
не попадают. Запускается в GitHub (.github/workflows/tutorial-voice.yml),
результат — public/voice/<id>.wav и public/voice/durations.json (робот кладёт
их коммитом в ту же ветку, кроме main),
по которому src/Tutorial.tsx раскладывает сцены. В тексте нет данных людей —
только дикторский текст о продукте.

    python3 scripts/voice.py voice/script.json public/voice
"""
import json
import os
import sys
import urllib.parse
import urllib.request
import array
import wave
from pathlib import Path

URL = 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize'
RATE = 48000  # lpcm у SpeechKit — только 8, 16 или 48 кГц
OUT_RATE = 24000  # голосу хватает; файлы лежат в git — вдвое меньше


def synth(text: str, cfg: dict, key: str, folder: str) -> bytes:
    form = {'text': text, 'lang': 'ru-RU', 'voice': cfg['voice'], 'speed': str(cfg.get('speed', 1.0)),
            'format': 'lpcm', 'sampleRateHertz': str(RATE)}
    if cfg.get('emotion'):
        form['emotion'] = cfg['emotion']
    if folder:
        form['folderId'] = folder
    req = urllib.request.Request(URL, data=urllib.parse.urlencode(form).encode(),
                                 headers={'Authorization': f'Api-Key {key}'})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except urllib.error.HTTPError as err:
        body = err.read().decode('utf-8', 'replace')[:300]
        raise SystemExit(f'SpeechKit {err.code}: {body}')


def main() -> None:
    script, out = Path(sys.argv[1]), Path(sys.argv[2])
    cfg = json.loads(script.read_text(encoding='utf-8'))
    key = os.environ['YANDEX_GPT_API_KEY']
    folder = os.environ.get('YANDEX_GPT_FOLDER_ID', '')
    out.mkdir(parents=True, exist_ok=True)
    durations = {}
    for line in cfg['lines']:
        src = array.array('h', synth(line['text'], cfg, key, folder))
        # 48 → 24 кГц: среднее пары отсчётов — простой фильтр от наложения.
        half = array.array('h', ((src[i] + src[i + 1]) // 2 for i in range(0, len(src) - 1, 2)))
        path = out / f"{line['id']}.wav"
        with wave.open(str(path), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(OUT_RATE)
            w.writeframes(half.tobytes())
        durations[line['id']] = round(len(half) / OUT_RATE, 3)
        print(line['id'], durations[line['id']], 's')
    (out / 'durations.json').write_text(json.dumps(durations, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
