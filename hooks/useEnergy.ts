import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DAILY_ENERGY, EnergyState, energyDay, parseEnergy, reconcile, refund, rollover, spend,
} from '@/services/energy';
import { dbEnergyLeft } from '@/services/db';

const KEY = 'jt_energy_v1';

/**
 * Дневной запас свайпов: хранение и пересчёт на новый день.
 *
 * Логика — в services/energy.ts, здесь только чтение и запись. Местная
 * запись нужна, чтобы шапка отвечала сразу, без сети. Но решает сервер
 * (php-proxy/energy.php, с 02.10.2026): он считает отклики за московские сутки
 * на всех устройствах и сверх запаса не примет. Поэтому при каждом пересчёте
 * местный остаток сводится с серверным — переустановка, второй телефон или
 * сайт больше не дают новых двадцати.
 *
 * Пересчёт на новый день делается не только при запуске. Приложение живёт в
 * фоне сутками — человек, у которого оно провисело с вечера, иначе получил бы
 * вчерашний остаток. Поэтому пересчитываем и при возврате из фона.
 */
export function useEnergy(userId?: string | null) {
  const [state, setState] = useState<EnergyState>(() => ({ day: energyDay(), left: DAILY_ENERGY }));
  // Пока не прочитали хранилище, показывать полный запас нельзя: человек с
  // исчерпанным лимитом на секунду увидел бы полный запас и решил, что свайпы вернулись.
  const [ready, setReady] = useState(false);
  // Свежее состояние для обработчиков: они замыкают его на момент отрисовки,
  // а свайпы идут быстрее, чем перерисовка.
  const ref = useRef(state);
  ref.current = state;

  const persist = useCallback((next: EnergyState) => {
    setState(next);
    ref.current = next;
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  /** Перечитать хранилище и пересчитать на текущий день. */
  const sync = useCallback(async () => {
    try {
      const stored = parseEnergy(await AsyncStorage.getItem(KEY));
      let next = rollover(stored, energyDay());
      if (userId) {
        // Сеть упала — остаёмся на местном счёте: сервер всё равно не
        // пропустит лишний отклик, а запирать ленту из-за связи незачем.
        try { next = reconcile(next, await dbEnergyLeft(userId)); } catch { /* см. выше */ }
      }
      setState(next);
      ref.current = next;
      // Записываем только если пересчёт что-то изменил: лишняя запись на
      // каждом возврате из фона ничего не даёт.
      if (!stored || stored.day !== next.day || stored.left !== next.left) {
        AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      }
    } catch {
      // Хранилище не прочиталось — работаем с тем, что в памяти. Отказать
      // человеку в свайпах из-за сбоя диска было бы хуже, чем дать лишние.
    } finally {
      setReady(true);
    }
  }, [userId]);

  useEffect(() => {
    void sync();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void sync(); });
    return () => sub.remove();
  }, [sync]);

  /**
   * Списать свайп. Возвращает false, если списывать нечего — тогда свайп
   * выполнять нельзя и надо показать плашку лимита.
   */
  const spendOne = useCallback((): boolean => {
    // Сутки могли смениться прямо во время работы приложения.
    const day = energyDay();
    const cur = ref.current.day === day ? ref.current : rollover(ref.current, day);
    if (cur.left <= 0) {
      if (cur !== ref.current) persist(cur);
      return false;
    }
    persist(spend(cur));
    return true;
  }, [persist]);

  /** Вернуть свайп — за кнопкой возврата вакансии. */
  const refundOne = useCallback(() => {
    const day = energyDay();
    const cur = ref.current.day === day ? ref.current : rollover(ref.current, day);
    persist(refund(cur));
  }, [persist]);

  return { left: state.left, ready, spendOne, refundOne, sync };
}
