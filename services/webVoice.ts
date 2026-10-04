/**
 * Запись голосовых в браузере.
 *
 * Почему не через expo-audio, как на телефоне. Его веб-часть умеет писать
 * только в webm: ключ `web` из настроек она молча выбрасывает
 * (createRecordingOptions оставляет лишь общие поля и ветки ios/android),
 * а дальше подставляет свой формат. Safari webm записывать не умеет вообще —
 * MediaRecorder с таким типом там сразу падает, то есть на айфоне в браузере
 * кнопка была бы мёртвой.
 *
 * Здесь формат выбираем сами. Первым просим mp4: AAC внутри него открывается
 * во всех браузерах, включая Safari, и совпадает с тем, что пишет само
 * приложение на телефоне. Если браузер так не умеет — пишем webm.
 */

type MediaRecorderCtor = {
  new (stream: MediaStream, options?: { mimeType?: string; bitsPerSecond?: number }): MediaRecorder;
  isTypeSupported?: (type: string) => boolean;
};

function getCtor(): MediaRecorderCtor | null {
  if (typeof window === 'undefined') return null;
  const MR = (window as unknown as { MediaRecorder?: MediaRecorderCtor }).MediaRecorder;
  if (!MR) return null;
  if (!navigator?.mediaDevices?.getUserMedia) return null;
  return MR;
}

/** Формат, в котором браузер согласен записывать. null — записывать нечем. */
const webVoiceMime: string | null = (() => {
  const MR = getCtor();
  if (!MR) return null;
  const wanted = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  if (!MR.isTypeSupported) return 'audio/webm';
  return wanted.find(t => MR.isTypeSupported!(t)) ?? null;
})();

export const webVoiceSupported = webVoiceMime !== null;

export type VoiceClip = {
  bytes: Uint8Array;
  contentType: string;
  ext: string;
  seconds: number;
};

/**
 * Одна запись: create → stop либо cancel. Повторно не используется —
 * на каждое голосовое заводится новая.
 */
export class WebVoiceRecording {
  private rec: MediaRecorder;
  private stream: MediaStream;
  private chunks: BlobPart[] = [];
  private startedAt = 0;

  private constructor(rec: MediaRecorder, stream: MediaStream) {
    this.rec = rec;
    this.stream = stream;
    this.rec.addEventListener('dataavailable', e => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    });
  }

  static async start(): Promise<WebVoiceRecording> {
    const MR = getCtor();
    if (!MR || !webVoiceMime) throw new Error('Браузер не умеет записывать звук');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MR(stream, { mimeType: webVoiceMime, bitsPerSecond: 128000 });
    const self = new WebVoiceRecording(rec, stream);
    self.startedAt = Date.now();
    rec.start();
    return self;
  }

  /** Миллисекунды с начала записи — для счётчика на экране. */
  elapsed(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  async stop(): Promise<VoiceClip> {
    const seconds = Math.max(1, Math.round(this.elapsed() / 1000));
    const done = new Promise<void>(resolve => {
      this.rec.addEventListener('stop', () => resolve(), { once: true });
    });
    this.rec.stop();
    await done;
    this.release();

    const type = this.rec.mimeType || webVoiceMime || 'audio/webm';
    const blob = new Blob(this.chunks, { type });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Тип приходит с параметрами вида «audio/webm;codecs=opus» — хранилищу
    // нужен только сам тип.
    const contentType = type.split(';')[0];
    const ext = contentType.includes('mp4') ? 'm4a' : 'webm';
    return { bytes, contentType, ext, seconds };
  }

  cancel(): void {
    try { this.rec.stop(); } catch {}
    this.release();
  }

  /**
   * Отпускаем микрофон. Без этого в адресной строке остаётся значок записи,
   * и человек думает, что его продолжают слушать.
   */
  private release(): void {
    try { this.stream.getTracks().forEach(t => t.stop()); } catch {}
  }
}
