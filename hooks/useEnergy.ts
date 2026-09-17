import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DAILY_ENERGY, EnergyState, energyDay, parseEnergy, refund, rollover, spend,
} from '@/services/energy';

const KEY = 'jt_energy_v1';

/**
 * Дневной запас свайпов: хранение и пересчёт на новый день.
 *
 * Логика — в services/energy.ts, здесь только чтение и запись. Хранится
 * локально: мера временная, до монетизации, и переносить её на сервер сейчас
 * значило бы заводить миграцию ради того, что через месяц переделают. Цена
 * решения известна и принята: переустановка приложения обнуляет счётчик.
 *
 * Пересчёт на новый день делается не только при запуске. Приложение живёт в
 * фоне сутками — человек, у которого оно провисело с вечера, иначе получил бы
 * вчерашний остаток. Поэтому пересчитываем и при возврате из фона.
 */
export function useEnergy() {
  const [state, setState] = useState<EnergyState>(() => ({ day: energyDay(), left: DAILY_ENERGY }));
  // Пока не прочитали хранилище, показывать полный запас нельзя: человек с
  // исчерпанным лимитом на секунду увидел бы 40 и решил, что свайпы вернулись.
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
      const next = rollover(stored, energyDay());
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
  }, []);

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
