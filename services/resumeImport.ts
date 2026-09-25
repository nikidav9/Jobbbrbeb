import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { parseResumeText, parseResumeIdentity, inferWorkTypes } from '@/lib/resumeParser';
import { ResumeProfile, User } from '@/constants/types';

type PdfTextItem = {
  str: string;
  transform: number[];
};

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const size = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(size);
  let position = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0;
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
    bytes[position++] = (a << 2) | (b >> 4);
    if (position < size) bytes[position++] = ((b & 15) << 4) | (c >> 2);
    if (position < size) bytes[position++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

async function readAsset(asset: DocumentPickerAsset): Promise<Uint8Array> {
  if ((asset.size ?? 0) > 10 * 1024 * 1024) {
    throw new Error('Файл больше 10 МБ');
  }
  if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error('Не удалось прочитать файл');
    return new Uint8Array(await response.arrayBuffer());
  }
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(base64);
}

function joinItemsIntoLines(items: PdfTextItem[]): string[] {
  const rows: { y: number; items: { x: number; text: string }[] }[] = [];
  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;
    const x = Number(item.transform[4] ?? 0);
    const y = Number(item.transform[5] ?? 0);
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= 2);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' '));
}

export async function extractResumePdf(asset: DocumentPickerAsset) {
  const bytes = await readAsset(asset);
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Файл больше 10 МБ');
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
    throw new Error('Выберите PDF-файл');
  }
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.js'),
    import('pdfjs-dist/legacy/build/pdf.worker.js'),
  ]);
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const document = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;
  if (document.numPages > 12) throw new Error('В резюме больше 12 страниц');

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if ('str' in item && 'transform' in item) {
        items.push({ str: item.str, transform: item.transform });
      }
    }
    pages.push(joinItemsIntoLines(items).join('\n'));
  }
  const text = pages.join('\n');
  const resume = parseResumeText(text, asset.name);
  const structuredItems =
    resume.experience.length
    + resume.education.length
    + resume.projects.length
    + resume.exams.length
    + resume.languages.length
    + resume.skills.length
    + resume.interests.length
    + resume.certifications.length
    + resume.awards.length
    + resume.coursework.length;
  if (!resume.desiredPosition && !resume.email && !resume.summary && structuredItems < 2) {
    throw new Error('Не удалось распознать структуру резюме. Проверьте, что PDF содержит выделяемый текст, а не только скан.');
  }
  return { resume, identity: parseResumeIdentity(text), text, bytes };
}

/**
 * Перенести данные распознанного резюме в профиль пользователя.
 *
 * Общая для импорта в профиле и для регистрации — расхождение между ними
 * значило бы, что после регистрации профиль выглядит иначе, чем после
 * обычного импорта тем же файлом.
 */
export function mergeResumeIntoUser(
  user: User,
  resume: ResumeProfile,
  identity?: {
    firstName?: string;
    lastName?: string;
    middleName?: string;
    age?: number;
  },
): User {
  const importedAvailability = [resume.employmentType, resume.workFormat].filter(Boolean).join(' · ');
  const importedRelocation = resume.businessTrips?.match(/(?:не\s+)?готов[а]?\s+к\s+переезд\w*/i)?.[0];
  const inferredWorkTypes = inferWorkTypes(resume);

  return {
    ...user,
    resume,
    firstName: identity?.firstName ?? user.firstName,
    lastName: identity?.lastName ?? user.lastName,
    age: identity?.age ?? user.age,
    bio: resume.summary?.trim() || user.bio,
    workTypes: inferredWorkTypes.length > 0 ? inferredWorkTypes : user.workTypes,
    personalDetails: {
      ...(user.personalDetails ?? {}),
      ...(identity?.middleName ? { middleName: identity.middleName } : {}),
      ...(resume.email ? { contactEmail: resume.email } : {}),
      ...(resume.citizenship ? { citizenship: resume.citizenship } : {}),
      ...(resume.workPermit ? { workAuthorization: resume.workPermit } : {}),
      ...(resume.city ? { location: resume.city } : {}),
      ...(importedAvailability ? { workAvailability: importedAvailability } : {}),
      ...(importedRelocation ? { relocation: importedRelocation } : {}),
    },
  };
}
