/**
 * Закладки карьерных вакансий — одно хранилище на ленту, «Вакансию подробно»
 * и экран избранного (app/saved.tsx), чтобы отметка совпадала везде.
 *
 * Список с сервера (dbGetExtSaved) приходит сразу с вакансиями: лента держит
 * только свою порцию, а избранное должно показать и ушедшие из неё.
 * Добавление и снятие ждут сервера и только потом меняют отметку — обрыв
 * связи не должен выглядеть как сохранение или удаление.
 */
import { useSyncExternalStore } from 'react';
import type { ExtVacancy } from '@/constants/types';
import { dbAddExtSaved, dbGetExtSaved, dbRemoveExtSaved } from '@/services/db';

export type ExtSavedItem = { vacancy: ExtVacancy; savedAt: string | null };

let items: ExtSavedItem[] = [];
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function emit(next: ExtSavedItem[]) {
  items = next;
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Список закладок; перечитывается с сервера по `force` или при смене человека. */
export async function loadExtSaved(userId: string, force = false): Promise<ExtSavedItem[]> {
  if (!force && loadedFor === userId) return items;
  // Другой человек на том же телефоне: прежние закладки убираем сразу, не
  // дожидаясь ответа, — чужие вакансии не должны мелькнуть отмеченными.
  if (loadedFor !== userId) { loadedFor = null; emit([]); }
  const rows = await dbGetExtSaved(userId);
  loadedFor = userId;
  emit(rows);
  return rows;
}

export function isExtSaved(id: string): boolean {
  return items.some(i => i.vacancy.id === id);
}

/** Сохранить или снять. Возвращает новое состояние (true — сохранена). */
export async function toggleExtSaved(userId: string, v: ExtVacancy): Promise<boolean> {
  if (isExtSaved(v.id)) {
    await dbRemoveExtSaved(userId, v.id);
    emit(items.filter(i => i.vacancy.id !== v.id));
    return false;
  }
  await dbAddExtSaved(userId, v.id);
  emit([{ vacancy: v, savedAt: new Date().toISOString() }, ...items.filter(i => i.vacancy.id !== v.id)]);
  return true;
}

/** Выход из аккаунта: чужие закладки не должны остаться на экране. */
export function resetExtSaved(): void {
  loadedFor = null;
  emit([]);
}

export function useExtSaved(): ExtSavedItem[] {
  return useSyncExternalStore(subscribe, () => items, () => items);
}
