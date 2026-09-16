-- Фильтр «Компания» должен показывать работодателей, а не их внутренние команды.
--
-- До company_const часть вакансий Авиасейлс успела сохраниться с полем team
-- в company: «Marketing», «Product», «Travelpayouts: Technology» и т.п.
-- Текущий парсер уже всегда ставит company_const = «Авиасейлс», но продовый
-- сервер сейчас не может дочитать этот endpoint, поэтому старые активные строки
-- безопасно остаются в базе при partial-обходе и загрязняют фасет.
--
-- Исправляем только строки, чей первоисточник однозначно принадлежит
-- aviasales.ru. Это не словарь названий команд: если команда переименуется,
-- адрес всё равно останется тем же работодателем.

update public.jm_ext_vacancies
   set company = 'Авиасейлс'
 where source_id = 'career'
   and (
     url like 'https://www.aviasales.ru/about/vacancies/%'
     or url like 'https://aviasales.ru/about/vacancies/%'
   )
   and company is distinct from 'Авиасейлс';
