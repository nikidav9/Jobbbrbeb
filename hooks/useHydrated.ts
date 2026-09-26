import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Прошёл ли первый рендер в браузере.
 *
 * Сайт собирается заранее в статический HTML (expo export), и параметров
 * адреса (?doc=…, ?company=…) при этой сборке нет. Если экран сразу рисует
 * по параметру, первый рендер в браузере расходится со статикой, и React
 * падает с ошибкой гидратации #418. Такой экран берёт параметр только после
 * первого рендера — тогда он совпадает со статикой, а через кадр рисует своё.
 * На телефоне статики нет, там сразу true.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(Platform.OS !== 'web');
  useEffect(() => { setHydrated(true); }, []);
  return hydrated;
}
