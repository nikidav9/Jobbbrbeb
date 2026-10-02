/**
 * Сайт компании для компьютера (решение владельца 02.10.2026).
 *
 * На jobtoo.ru с компьютера (широкий экран, мышь) главная показывает
 * ознакомительный сайт, а не растянутое приложение. На телефоне, в Telegram
 * и в установленном веб-приложении — всё как раньше. Структура — по образцу
 * sorce.jobs (первый экран: ролик на всю рамку, затемнение, заголовок по
 * центру, QR в углу, окошко-превью; «как это работает»; цифры; огромное
 * «JobToo» в подвале), тексты и оформление свои, стиль JobToo: тёплый фон,
 * чёрная обводка, жёсткая тень, оранжевый акцент, Unbounded в заголовках.
 * Ролики — public/landing/hero.{mp4,webm,jpg} (фон) и promo.{mp4,webm} (окно «Смотреть
 * ролик»), собираются в video/ (Remotion, `npm run render`); поменял сценарий —
 * перерендери и замени файлы.
 *
 * Всё лежит в той же веб-сборке (app/+html.tsx), без правок nginx:
 *  - LANDING_DETECT стоит первым в <head> и решает до отрисовки, показывать
 *    ли сайт (класс jt-landing на <html>);
 *  - приложение под сайтом грузится как обычно, только невидимо — «Войти»
 *    снимает класс и показывает его сразу, без перезагрузки;
 *  - сайт видят только с компьютера и только на «/»: ссылки на вакансии,
 *    документы, приглашения открывают приложение как раньше.
 *
 * Цифры на сайте — факты о продукте, а не статистика (её у IT-приложения ещё
 * нет): отклик бесплатен, 15 откликов в день (services/energy.ts), анкету на
 * сайте работодателя заполняет Юпитер. Изменились правила — поправь и здесь.
 */

/** RuStore — нынешний пакет. Выйдет ru.jobtoo — заменить ссылку. */
const RUSTORE_URL = 'https://www.rustore.ru/catalog/app/com.nikidav23.onspaceapp';

// QR-код на https://jobtoo.ru/?from=qr: с телефона откроется приложение.
// Собран один раз (segno), значения не меняются — новые зависимости не нужны.
const QR_PATH =
  'M0 0.5h7m1 0h1m2 0h2m1 0h1m1 0h1m1 0h7m-25 1h1m5 0h1m1 0h2m1 0h2m3 0h1m1 0h1m5 0h1m-25 1h1m1 0h3m1 0h1m1 0h1m1 0h1m2 0h3m2 0h1m1 0h3m1 0h1m-25 1h1m1 0h3m1 0h1m3 0h1m1 0h3m3 0h1m1 0h3m1 0h1m-25 1h1m1 0h3m1 0h1m1 0h2m3 0h1m2 0h1m1 0h1m1 0h3m1 0h1m-25 1h1m5 0h1m3 0h5m1 0h1m1 0h1m5 0h1m-25 1h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7m-16 1h1m2 0h2m1 0h1m-16 1h1m2 0h6m1 0h1m3 0h2m1 0h1m2 0h1m1 0h3m-24 1h2m1 0h2m4 0h1m3 0h2m3 0h5m-22 1h3m1 0h6m1 0h1m1 0h1m5 0h1m2 0h1m-25 1h1m3 0h1m3 0h1m1 0h2m3 0h1m4 0h5m-25 1h1m2 0h1m1 0h2m1 0h2m1 0h2m3 0h1m1 0h2m4 0h1m-25 1h1m1 0h1m5 0h1m1 0h1m1 0h2m1 0h1m4 0h1m2 0h1m-24 1h5m1 0h3m3 0h1m2 0h1m2 0h1m1 0h5m-25 1h1m2 0h3m2 0h1m2 0h2m1 0h2m3 0h1m1 0h2m1 0h1m-25 1h1m2 0h1m1 0h4m2 0h1m1 0h1m2 0h5m1 0h2m-16 1h3m2 0h1m2 0h1m3 0h1m1 0h2m-24 1h7m1 0h4m4 0h1m1 0h1m1 0h1m3 0h1m-25 1h1m5 0h1m1 0h3m1 0h2m1 0h2m3 0h1m-21 1h1m1 0h3m1 0h1m1 0h2m4 0h7m-21 1h1m1 0h3m1 0h1m1 0h1m1 0h2m1 0h3m1 0h2m4 0h2m-25 1h1m1 0h3m1 0h1m4 0h1m4 0h1m3 0h5m-25 1h1m5 0h1m4 0h1m2 0h1m3 0h3m1 0h3m-25 1h7m1 0h1m5 0h1m1 0h3m2 0h1m2 0h1';

/**
 * Показывать ли сайт. Только «/», только компьютер (≥1024 px, мышь), не в
 * Telegram (параметры tgWebApp*, iframe Telegram Web, мост TelegramWebviewProxy),
 * не в установленном веб-приложении и не после «Войти» в этой вкладке (?app=1
 * или запомненный выбор). Ошибка — значит приложение: сломанный сайт хуже,
 * чем растянутое приложение.
 */
export const LANDING_DETECT = `(function(){try{
var L=location,q=L.search,h=L.hash,p=L.pathname,ss=window.sessionStorage;
var tg=/tgWebApp/.test(h+q)||window.top!==window.self||!!window.TelegramWebviewProxy;
if(tg||/[?&]app=1/.test(q))ss.setItem('jt_app','1');
var standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
var desk=matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;
if((p==='/'||p==='/index.html')&&desk&&!tg&&!standalone&&ss.getItem('jt_app')!=='1'){
document.documentElement.className+=' jt-landing';window.__JT_LANDING__=true;}
}catch(e){}})();`;

export const LANDING_STYLE = `
@font-face { font-family: 'JTLManrope'; font-weight: 500; font-display: swap;
  src: url('/landing/manrope-500.ttf') format('truetype'); }
#jtl { display: none; }
html.jt-landing #jtl { display: block; }
html.jt-landing #splash { display: none !important; }
html.jt-landing #root { visibility: hidden; }
#jtl {
  --bg: #F5EFE6; --ink: #141414; --accent: #FF6B1A; --soft: #FFE2CC; --surface: #FFFFFF;
  --muted: #5C554D; --line: #E3D9CC; --ok: #2BB673;
  position: fixed; inset: 0; z-index: 10000; overflow-y: auto; overflow-x: hidden;
  background: var(--bg); color: var(--ink); scroll-behavior: smooth;
  font: 500 17px/1.55 'JTLManrope', 'JTSplashManrope', -apple-system, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
#jtl *, #jtl *::before, #jtl *::after { box-sizing: border-box; }
#jtl a { color: inherit; text-decoration: none; }
#jtl h1, #jtl h2, #jtl h3 { margin: 0; font-family: 'JTSplashUnbounded', -apple-system, 'Segoe UI', sans-serif; font-weight: 700; letter-spacing: -0.02em; }
#jtl p { margin: 0; }
#jtl .wrap { width: min(1200px, calc(100% - 64px)); margin: 0 auto; }

/* Кнопки — «наклейки» JobToo: обводка 2px и жёсткая тень, при наведении поднимаются */
#jtl .btn { display: inline-flex; align-items: center; gap: 10px; padding: 14px 26px; border: 2px solid var(--ink);
  border-radius: 999px; background: var(--surface); color: var(--ink); cursor: pointer;
  font: 700 16px/1 'JTSplashManrope', -apple-system, sans-serif; box-shadow: 4px 4px 0 var(--ink);
  transition: transform .18s ease, box-shadow .18s ease; }
#jtl .btn:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--ink); }
#jtl .btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink); }
#jtl .btn-accent { background: var(--accent); }
#jtl .btn-sm { padding: 10px 18px; font-size: 14px; box-shadow: 3px 3px 0 var(--ink); }
#jtl .btn:focus-visible, #jtl a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }

/* Шапка */
#jtl .top { position: sticky; top: 0; z-index: 5; padding: 14px 0; background: rgba(245,239,230,.86);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid transparent;
  transition: border-color .2s ease; }
#jtl .top.scrolled { border-bottom-color: var(--line); }
#jtl .top .wrap { display: flex; align-items: center; gap: 28px; }
#jtl .brand { display: flex; align-items: center; gap: 10px; font: 700 20px/1 'JTSplashUnbounded', sans-serif; }
#jtl .brand img { width: 40px; height: 40px; border: 2px solid var(--ink); border-radius: 12px; background: var(--surface); padding: 4px; }
#jtl .nav { display: flex; gap: 26px; margin-left: auto; }
#jtl .nav a { font-weight: 700; font-family: 'JTSplashManrope', sans-serif; font-size: 15px; position: relative; }
#jtl .nav a::after { content: ''; position: absolute; left: 0; right: 0; bottom: -4px; height: 2px; background: var(--accent);
  transform: scaleX(0); transform-origin: left; transition: transform .2s ease; }
#jtl .nav a:hover::after { transform: scaleX(1); }
#jtl .top .actions { display: flex; gap: 12px; }

/* Первый экран — как у sorce.jobs: ролик на всю рамку, затемнение, заголовок по центру.
   Ролик собран в Remotion (video/), подставляется скриптом только на компьютере:
   на телефоне сайт скрыт, и 1,7 МБ не качаются зря. */
#jtl .hero { padding: 18px 0 30px; }
#jtl .hero-frame { position: relative; min-height: calc(100vh - 110px); display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; padding: 90px 40px; color: #fff;
  border: 2px solid var(--ink); border-radius: 36px; box-shadow: 8px 8px 0 var(--ink); overflow: hidden;
  background: var(--ink) url('/landing/hero.jpg') center / cover no-repeat; }
#jtl .hero-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; animation: jtl-zoom 20s ease-out both; }
#jtl .hero-shade { position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 70% at 50% 50%, rgba(20,20,20,.66), rgba(20,20,20,.34)),
              linear-gradient(180deg, rgba(20,20,20,.28), rgba(20,20,20,.5)); }
#jtl .hero-in { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; }
#jtl .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 8px 15px; border: 2px solid var(--ink);
  border-radius: 999px; background: var(--surface); color: var(--ink); font: 700 13px/1 'JTSplashManrope', sans-serif;
  margin-bottom: 28px; animation: jtl-fade .7s ease .1s both; }
#jtl .eyebrow i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: jtl-pulse 1.8s ease-in-out infinite; }
#jtl .hero h1 { font-size: clamp(56px, 7.2vw, 118px); line-height: .98; text-transform: uppercase; }
#jtl .hero h1 .mark { color: var(--accent); text-shadow: 5px 5px 0 var(--ink); }
#jtl .hero h1 .line { display: block; overflow: hidden; white-space: nowrap; padding: 0 10px 10px; }
#jtl .hero h1 .line > span { display: inline-block; animation: jtl-rise 1s cubic-bezier(.2,.8,.2,1) .15s both; }
#jtl .hero h1 .line:nth-child(2) > span { animation-delay: .3s; }
#jtl .hero .lead { max-width: 640px; margin-top: 26px; font-size: 21px; color: rgba(255,255,255,.9); animation: jtl-fade .8s ease .5s both; }
#jtl .hero .cta { display: flex; gap: 16px; margin-top: 36px; animation: jtl-fade .8s ease .65s both; }
#jtl .hero .note { margin-top: 18px; font-size: 14px; color: rgba(255,255,255,.72); animation: jtl-fade .8s ease .75s both; }
#jtl .qr { position: absolute; right: 22px; bottom: 22px; z-index: 2; display: flex; align-items: center; gap: 12px;
  padding: 10px 16px 10px 10px; border: 2px solid var(--ink); border-radius: 18px; background: var(--surface); color: var(--ink);
  box-shadow: 4px 4px 0 var(--ink); text-align: left; animation: jtl-fade .8s ease .9s both; transition: transform .2s ease; }
#jtl .qr:hover { transform: translate(-2px, -2px) rotate(-1deg); }
#jtl .qr svg { width: 84px; height: 84px; display: block; }
#jtl .qr span { max-width: 130px; font: 700 12px/1.35 'JTSplashManrope', sans-serif; }
/* Окошко-превью слева сверху: открывает ролик целиком */
#jtl .reel { position: absolute; left: 22px; top: 22px; z-index: 2; width: 168px; height: 100px; padding: 0; cursor: pointer;
  border: 2px solid #fff; border-radius: 18px; overflow: hidden; background: var(--ink) url('/landing/hero.jpg') 70% 40% / 340% no-repeat;
  box-shadow: 4px 4px 0 rgba(20,20,20,.6); transition: transform .2s ease; animation: jtl-fade .8s ease .9s both; }
#jtl .reel:hover { transform: scale(1.05) rotate(-1.5deg); }
#jtl .reel::before { content: ''; position: absolute; inset: 0; background: rgba(20,20,20,.25); }
#jtl .reel b { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--ink); display: flex; align-items: center; justify-content: center; }
#jtl .reel b::after { content: ''; margin-left: 4px; border-left: 14px solid var(--ink); border-top: 9px solid transparent; border-bottom: 9px solid transparent; }
#jtl .modal { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; padding: 48px;
  background: rgba(20,20,20,.82); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
#jtl .modal.on { display: flex; animation: jtl-fade .25s ease both; }
#jtl .modal video { width: min(1280px, 100%); border: 3px solid #fff; border-radius: 26px; background: var(--ink); }
#jtl .modal .close { position: absolute; top: 22px; right: 26px; }

/* Секции */
#jtl section.block { padding: 110px 0 40px; }
#jtl .kicker { font: 700 14px/1 'JTSplashManrope', sans-serif; color: var(--accent); text-transform: uppercase; letter-spacing: .08em; }
#jtl h2 { margin-top: 14px; font-size: clamp(34px, 3.6vw, 52px); line-height: 1.05; }
#jtl .sub { margin-top: 16px; max-width: 640px; font-size: 19px; color: var(--muted); }
/* История на прокрутке: сцена прилипает, герои разыгрывают сюжет по мере прокрутки.
   Сцена задаётся data-scene (1–3) у #jtl-stage, внутри сцены ход — переменная --lp. */
#jtl .story { position: relative; height: 330vh; margin-top: 40px; }
#jtl .story-pin { position: sticky; top: 72px; height: calc(100vh - 72px); display: flex; align-items: center; }
#jtl .story-grid { display: grid; grid-template-columns: .9fr 1.1fr; gap: 40px; align-items: center; }
#jtl .story-steps { list-style: none; margin: 34px 0 0; padding: 0; display: grid; gap: 14px; }
#jtl .story-steps li { padding: 20px 24px; border: 2px solid transparent; border-radius: 24px; opacity: .38;
  transition: opacity .35s ease, background-color .35s ease, border-color .35s ease, transform .35s ease, box-shadow .35s ease; }
#jtl .story-steps li.on { opacity: 1; background: var(--surface); border-color: var(--ink); box-shadow: 6px 6px 0 var(--ink); transform: translateX(8px); }
#jtl .story-steps b { font: 700 14px/1 'JTSplashUnbounded', sans-serif; color: var(--accent); }
#jtl .story-steps h3 { margin-top: 8px; font-size: 26px; }
#jtl .story-steps p { margin-top: 8px; color: var(--muted); }
#jtl .story-bar { margin-top: 26px; height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; }
#jtl .story-bar i { display: block; height: 100%; width: calc(var(--p, 0) * 100%); background: var(--accent); border-radius: 4px; }

#jtl .stage { position: relative; height: min(640px, calc(100vh - 140px)); border: 2px solid var(--ink); border-radius: 36px;
  background: #F7ECE0; box-shadow: 8px 8px 0 var(--ink); overflow: hidden; --mx: 0; --my: 0; }
#jtl .stage::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(150,105,70,.16) 2px, transparent 2.5px); background-size: 34px 34px; }
/* Герои — 3D-картинки владельца (public/landing/hero-*.webp, фон картинки = фон
   сцены #F7ECE0, края мягкие). Размер меняем transform, чтобы ход был плавным. */
#jtl .actor { position: absolute; z-index: 1; transition: left .8s cubic-bezier(.3,.7,.2,1), top .8s cubic-bezier(.3,.7,.2,1),
  transform .8s cubic-bezier(.3,.7,.2,1), opacity .5s ease; }
#jtl .actor img { display: block; width: 100%; height: auto; }
#jtl .depth1 { translate: calc(var(--mx) * 14px) calc(var(--my) * 10px); }
#jtl .depth2 { translate: calc(var(--mx) * -22px) calc(var(--my) * -14px); }
#jtl .depth3 { translate: calc(var(--mx) * 30px) calc(var(--my) * 18px); }

/* Соискательница */
#jtl .a-dev { width: 100%; left: 0; bottom: -2px; transform-origin: bottom left; }
#jtl .stage[data-scene="2"] .a-dev { left: 0; transform: scale(.56); }
#jtl .stage[data-scene="3"] .a-dev { left: 0; transform: scale(.48); }
#jtl .stage[data-scene="3"] .a-dev img { animation: jtl-hop .9s ease-in-out infinite; }

/* Юпитер */
#jtl .a-jup { width: 50%; left: 60%; top: -60%; opacity: 0; transform: rotate(-30deg); transform-origin: top left; }
#jtl .a-jup img { animation: jtl-bob 3s ease-in-out infinite; }
#jtl .stage[data-scene="2"] .a-jup { left: 46%; top: 4%; opacity: 1; transform: none; }
#jtl .stage[data-scene="3"] .a-jup { left: 5%; top: 14%; opacity: 1; transform: scale(.5) rotate(-8deg); }

/* Анкета, которую пишет Юпитер */
#jtl .s-form { position: absolute; z-index: 2; width: 260px; left: 52%; top: 52%; padding: 18px 20px 20px; border: 2px solid var(--ink); border-radius: 22px;
  background: var(--surface); box-shadow: 6px 6px 0 var(--ink); opacity: 0; transform: translateY(40px) rotate(3deg); transition: opacity .5s ease, transform .6s cubic-bezier(.3,.7,.2,1); }
#jtl .stage[data-scene="2"] .s-form { opacity: 1; transform: rotate(-2deg); }
#jtl .s-form .hd { display: flex; align-items: center; gap: 10px; font: 700 14px/1 'JTSplashManrope', sans-serif; color: var(--muted); }
#jtl .s-form .hd i { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg, #8B5CF6, #4F46E5); }
#jtl .s-form .f { margin-top: 12px; height: 34px; border: 2px solid var(--ink); border-radius: 12px; padding: 0 10px; display: flex; align-items: center; }
#jtl .s-form .f span { display: block; height: 9px; border-radius: 5px; background: var(--ink); width: 0; transition: width .2s linear; }
#jtl .s-form .go { margin-top: 14px; height: 40px; border: 2px solid var(--ink); border-radius: 999px; background: var(--accent);
  display: flex; align-items: center; justify-content: center; font: 700 14px/1 'JTSplashManrope', sans-serif; transition: background-color .3s ease, color .3s ease; }
#jtl .s-form.sent .go { background: var(--ok); color: #fff; }

/* HR и приглашение */
#jtl .a-hr { width: 58%; left: 110%; bottom: -2px; opacity: 0; }
#jtl .stage[data-scene="3"] .a-hr { left: 43%; opacity: 1; }
#jtl .s-bubble { position: absolute; z-index: 3; left: 38%; top: 19%; max-width: 250px; padding: 16px 18px; border: 2px solid var(--ink);
  border-radius: 22px 22px 6px 22px; background: var(--surface); box-shadow: 5px 5px 0 var(--ink); font: 700 16px/1.35 'JTSplashManrope', sans-serif;
  opacity: 0; transform: scale(.6) translateX(80px); transform-origin: right bottom; transition: opacity .4s ease .3s, transform .5s cubic-bezier(.3,1.5,.5,1) .3s; }
#jtl .s-bubble small { display: block; margin-bottom: 4px; font-size: 12px; color: var(--muted); }
#jtl .stage[data-scene="3"] .s-bubble { opacity: 1; transform: none; }
#jtl .confetti { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
#jtl .confetti i { position: absolute; top: -20px; width: 12px; height: 18px; border: 2px solid var(--ink); border-radius: 3px; opacity: 0; }
#jtl .stage[data-scene="3"] .confetti i { animation: jtl-fall 2.6s cubic-bezier(.3,.6,.5,1) infinite; opacity: 1; }
#jtl .s-caption { position: absolute; z-index: 5; left: 22px; top: 20px; padding: 8px 14px; border: 2px solid var(--ink); border-radius: 999px;
  background: var(--surface); font: 700 13px/1 'JTSplashManrope', sans-serif; }

/* Бегущая лента направлений */
#jtl .marquee { margin-top: 70px; display: grid; gap: 14px; transform: rotate(-1.5deg); }
#jtl .row { display: flex; width: max-content; gap: 14px; animation: jtl-run 38s linear infinite; }
#jtl .row.rev { animation-direction: reverse; animation-duration: 44s; }
#jtl .marquee:hover .row { animation-play-state: paused; }
#jtl .tag { padding: 14px 24px; border: 2px solid var(--ink); border-radius: 999px; background: var(--surface);
  font: 700 18px/1 'JTSplashUnbounded', sans-serif; white-space: nowrap; }
#jtl .tag.hot { background: var(--accent); }
#jtl .tag.soft { background: var(--soft); }

/* Цифры */
#jtl .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 54px; }
#jtl .stat { padding: 34px 28px; border: 2px solid var(--ink); border-radius: 28px; background: var(--surface); box-shadow: 6px 6px 0 var(--ink); }
#jtl .stat b { display: block; font: 700 clamp(46px, 4.6vw, 68px)/1 'JTSplashUnbounded', sans-serif; letter-spacing: -0.03em; }
#jtl .stat b em { font-style: normal; color: var(--accent); }
#jtl .stat > span { display: block; margin-top: 14px; font-size: 17px; color: var(--muted); }

/* Работодателям */
#jtl .emp { display: grid; grid-template-columns: 1.2fr .8fr; gap: 40px; align-items: center; padding: 56px 64px;
  border: 2px solid var(--ink); border-radius: 36px; background: var(--ink); color: var(--bg); box-shadow: 8px 8px 0 var(--accent); }
#jtl .emp .kicker { color: var(--accent); }
#jtl .emp .sub { color: #CFC4B6; }
#jtl .emp ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 14px; }
#jtl .emp li { display: flex; gap: 12px; align-items: flex-start; font-weight: 700; font-family: 'JTSplashManrope', sans-serif; }
#jtl .emp li::before { content: ''; flex: none; width: 12px; height: 12px; margin-top: 7px; border-radius: 4px; background: var(--accent); }
#jtl .emp .btn { margin-top: 28px; }

/* Финальный призыв и подвал */
#jtl .final { padding: 120px 0 70px; text-align: center; }
#jtl .final h2 { font-size: clamp(40px, 5vw, 76px); text-transform: uppercase; }
#jtl .final .cta { display: flex; justify-content: center; gap: 16px; margin-top: 34px; }
#jtl footer { border-top: 1px solid var(--line); padding: 34px 0 44px; }
#jtl footer .wrap { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
#jtl footer .links { display: flex; gap: 22px; margin-left: auto; flex-wrap: wrap; font-size: 15px; }
#jtl footer .links a:hover { color: var(--accent); }
#jtl footer small { font-size: 14px; color: var(--muted); }

/* Заголовки разделов проявляются по словам (как у sorce) */
#jtl .rv.split { opacity: 1; transform: none; }
#jtl .split .w { display: inline-block; overflow: hidden; vertical-align: top; padding-bottom: .08em; }
#jtl .split .w > span { display: inline-block; transform: translateY(110%); transition: transform .8s cubic-bezier(.2,.8,.2,1); }
#jtl .split.in .w > span { transform: none; }

/* Огромное «JobToo» в подвале, как «Sorce» у образца: переливается и встаёт при прокрутке */
#jtl .giant { padding: 40px 0 10px; text-align: center; overflow: hidden; }
#jtl .giant b { display: block; font: 700 clamp(120px, 20vw, 330px)/.92 'JTSplashUnbounded', sans-serif; letter-spacing: -0.055em;
  background: linear-gradient(100deg, var(--accent) 0%, #FFB37A 35%, var(--accent) 55%, #FF8A3D 100%); background-size: 220% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; animation: jtl-shine 7s linear infinite; }
#jtl .giant span { display: block; margin-top: 10px; font-size: 20px; color: var(--muted); }

/* Появление при прокрутке */
#jtl .rv { opacity: 0; transform: translateY(34px); transition: opacity .7s ease, transform .7s cubic-bezier(.2,.8,.2,1); }
#jtl .rv.in { opacity: 1; transform: none; }

@keyframes jtl-rise { from { transform: translateY(105%); } to { transform: none; } }
@keyframes jtl-fade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes jtl-bob { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-12px) rotate(3deg); } }
@keyframes jtl-hop { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-16px); } }
@keyframes jtl-fall { 0% { transform: translateY(0) rotate(0); } 100% { transform: translateY(700px) rotate(540deg); } }
@keyframes jtl-zoom { from { transform: scale(1.12); } to { transform: scale(1); } }
@keyframes jtl-shine { from { background-position: 0% 0; } to { background-position: -220% 0; } }
@keyframes jtl-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(43,182,115,.55); } 50% { box-shadow: 0 0 0 6px rgba(43,182,115,0); } }
@keyframes jtl-run { from { transform: translateX(0); } to { transform: translateX(-50%); } }

@media (max-width: 1180px) {
  #jtl .hero-frame { padding: 48px 40px; }
  #jtl .nav { display: none; }
  #jtl .top .actions { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) {
  #jtl *, #jtl *::before, #jtl *::after { animation: none !important; transition: none !important; }
  #jtl .rv { opacity: 1; transform: none; }
}
`;

const DIRECTIONS = [
  'Frontend', 'Backend', 'QA', 'DevOps', 'Data Science', 'Мобильная разработка',
  'Дизайн', 'Продакт', 'Аналитика', 'Тимлид', 'Системный аналитик', 'ML-инженер',
];
const DIRECTIONS_B = [
  'Python', 'Java', 'Go', 'React', 'iOS', 'Android', 'SQL', 'Kotlin',
  '1С', 'C#', 'Node.js', 'Тестирование', 'Поддержка', 'Безопасность',
];

function tags(list: string[], offset: number): string {
  // Лента бесконечная: два одинаковых прохода, анимация сдвигает ровно на половину.
  const once = list
    .map((t, i) => {
      const cls = (i + offset) % 5 === 0 ? 'tag hot' : (i + offset) % 3 === 0 ? 'tag soft' : 'tag';
      return `<span class="${cls}">${t}</span>`;
    })
    .join('');
  return once + once.replace(/<span /g, '<span aria-hidden="true" ');
}

export const LANDING_MARKUP = `
<div id="jtl" role="document">
  <header class="top" id="jtl-top">
    <div class="wrap">
      <a class="brand" href="/" aria-label="JobToo — на главную"><img src="/splash/logo.png" alt="" />JobToo</a>
      <nav class="nav" aria-label="Разделы">
        <a href="#how">Как это работает</a>
        <a href="#numbers">Почему JobToo</a>
        <a href="#employers">Работодателям</a>
      </nav>
      <div class="actions">
        <button class="btn btn-sm" type="button" data-jtl-open>Войти</button>
        <a class="btn btn-sm btn-accent" href="${RUSTORE_URL}" target="_blank" rel="noopener">Скачать</a>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap">
        <div class="hero-frame">
          <video class="hero-video" id="jtl-video" muted loop playsinline preload="none" aria-hidden="true"></video>
          <div class="hero-shade"></div>
          <button class="reel" type="button" data-jtl-reel aria-label="Смотреть ролик о JobToo"><b></b></button>
          <div class="hero-in">
            <span class="eyebrow"><i></i>Только IT-вакансии</span>
            <h1><span class="line"><span>Работа в IT —</span></span><span class="line"><span class="mark">свайпом</span></span></h1>
            <p class="lead">Листаете вакансии как ленту. Свайп вправо — и Юпитер сам заполняет анкету на сайте работодателя. Ответ приходит в чат приложения.</p>
            <div class="cta">
              <a class="btn btn-accent" href="${RUSTORE_URL}" target="_blank" rel="noopener">Скачать в RuStore →</a>
              <button class="btn" type="button" data-jtl-open>Открыть в браузере</button>
            </div>
            <p class="note">iPhone — пока через браузер: откройте jobtoo.ru в Safari.</p>
          </div>
          <a class="qr" href="/?app=1" title="jobtoo.ru">
            <svg viewBox="0 0 25 25" shape-rendering="crispEdges" role="img" aria-label="QR-код jobtoo.ru"><path stroke="#141414" d="${QR_PATH}"/></svg>
            <span>Наведите камеру телефона — JobToo откроется сразу</span>
          </a>
        </div>
      </div>
    </section>

    <section class="block" id="how">
      <div class="wrap">
        <p class="kicker rv">Как это работает</p>
        <h2 class="rv split">Три шага от вакансии до ответа</h2>
        <p class="sub rv">Никаких одинаковых анкет на десяти сайтах. Вы выбираете — остальное делает приложение.</p>
      </div>
      <div class="story" id="jtl-story">
        <div class="story-pin">
          <div class="wrap story-grid">
            <div>
              <ol class="story-steps">
                <li data-s="1" class="on"><b>01</b><h3>Листаете</h3><p>Карточки IT-вакансий: зарплата, формат, стек. Нравится — свайп вправо, нет — влево.</p></li>
                <li data-s="2"><b>02</b><h3>Юпитер откликается</h3><p>Наш помощник заполняет анкету на сайте работодателя из вашего профиля. Чего нет в профиле — спросит у вас, а не придумает.</p></li>
                <li data-s="3"><b>03</b><h3>Вас приглашают</h3><p>Ответ работодателя приходит в чат приложения. Все отклики и их статусы — в одном разделе.</p></li>
              </ol>
              <div class="story-bar"><i></i></div>
            </div>
            <div class="stage" id="jtl-stage" data-scene="1" aria-hidden="true">
              <span class="s-caption" id="jtl-caption">Листайте вниз</span>
              <div class="actor a-jup"><div class="depth3"><img src="/landing/hero-jup.webp" width="444" height="376" alt="" loading="lazy" decoding="async"></div></div>
              <div class="s-form depth2" id="jtl-sform">
                <div class="hd"><i></i>Нимбус Пэй · анкета</div>
                <div class="f"><span></span></div><div class="f"><span></span></div><div class="f"><span></span></div>
                <div class="go" id="jtl-sgo">Отправить</div>
              </div>
              <div class="actor a-dev"><div class="depth1"><img src="/landing/hero-dev.webp" width="648" height="505" alt="" loading="lazy" decoding="async"></div></div>
              <div class="actor a-hr"><div class="depth2"><img src="/landing/hero-hr.webp" width="598" height="540" alt="" loading="lazy" decoding="async"></div></div>
              <div class="s-bubble"><small>Нимбус Пэй · HR</small>Приглашаем на собеседование в четверг!</div>
              <div class="confetti"><i style="left:8%;background:#FF6B1A;animation-delay:0s"></i><i style="left:18%;background:#FDE68A;animation-delay:0.4s"></i><i style="left:28%;background:#8B5CF6;animation-delay:0.9s"></i><i style="left:39%;background:#14B8A6;animation-delay:0.2s"></i><i style="left:50%;background:#FF6B1A;animation-delay:1.1s"></i><i style="left:61%;background:#FFE2CC;animation-delay:0.6s"></i><i style="left:72%;background:#E11D48;animation-delay:1.4s"></i><i style="left:83%;background:#FDE68A;animation-delay:0.3s"></i><i style="left:92%;background:#14B8A6;animation-delay:0.8s"></i></div>
            </div>
          </div>
        </div>
      </div>
      <div class="marquee" aria-label="Направления">
        <div class="row">${tags(DIRECTIONS, 0)}</div>
        <div class="row rev">${tags(DIRECTIONS_B, 2)}</div>
      </div>
    </section>

    <section class="block" id="numbers">
      <div class="wrap">
        <p class="kicker rv">Почему JobToo</p>
        <h2 class="rv split">Честные цифры с первого дня</h2>
        <div class="stats">
          <div class="stat rv"><b><span data-count-from="990" data-count-to="0">0</span><em> ₽</em></b><span>для соискателя — отклики бесплатны</span></div>
          <div class="stat rv"><b><span data-count-from="0" data-count-to="15">15</span></b><span>откликов в день — осмысленно, а не по шаблону</span></div>
          <div class="stat rv"><b>1<em>&nbsp;=&nbsp;</em>1</b><span>один свайп — один отклик на сайте работодателя</span></div>
        </div>
      </div>
    </section>

    <section class="block" id="employers">
      <div class="wrap">
        <div class="emp rv">
          <div>
            <p class="kicker">Работодателям</p>
            <h2>Кандидаты, которые сами выбрали вашу вакансию</h2>
            <p class="sub">Опубликуйте IT-вакансию в JobToo: её увидят в ленте те, кому она подходит, а отвечать им можно прямо в чате.</p>
            <a class="btn btn-accent" href="/register-employer">Разместить вакансию →</a>
          </div>
          <ul>
            <li>Вакансия в общей ленте IT-вакансий</li>
            <li>Отклик — осознанный выбор: у кандидата 15 откликов в день</li>
            <li>Переписка с кандидатом в чате, без лишних писем</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="final">
      <div class="wrap">
        <h2 class="rv split">Следующая работа —<br />в одном свайпе</h2>
        <div class="cta rv">
          <a class="btn btn-accent" href="${RUSTORE_URL}" target="_blank" rel="noopener">Скачать в RuStore →</a>
          <button class="btn" type="button" data-jtl-open>Открыть в браузере</button>
        </div>
      </div>
    </section>
  </main>

  <section class="giant" aria-hidden="true"><b class="rv">JobToo</b><span class="rv">Работа в IT — свайпом</span></section>

  <div class="modal" id="jtl-modal" role="dialog" aria-modal="true" aria-label="Ролик о JobToo">
    <button class="btn btn-sm close" type="button" data-jtl-close>Закрыть</button>
    <video id="jtl-modal-video" controls playsinline loop preload="none"></video>
  </div>

  <footer>
    <div class="wrap">
      <a class="brand" href="/"><img src="/splash/logo.png" alt="" />JobToo</a>
      <small>Работа в IT — свайпом</small>
      <nav class="links" aria-label="Документы и контакты">
        <a href="/legal?doc=terms">Соглашение</a>
        <a href="/legal?doc=privacy">Политика конфиденциальности</a>
        <a href="/legal">Документы</a>
        <a href="https://t.me/JobToo_bot" target="_blank" rel="noopener">Telegram</a>
        <a href="mailto:support@jobtoo.ru">support@jobtoo.ru</a>
      </nav>
    </div>
  </footer>
</div>
`;

/** Поведение сайта: «Войти», шапка, появление при прокрутке, счётчики, карточки. */
export const LANDING_SCRIPT = `(function(){
if(!window.__JT_LANDING__)return;
var root=document.getElementById('jtl');if(!root)return;
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

// «Войти» / «Открыть в браузере»: приложение уже загружено под сайтом — показываем его.
root.addEventListener('click',function(e){
  var t=e.target.closest&&e.target.closest('[data-jtl-open]');if(!t)return;
  e.preventDefault();
  try{sessionStorage.setItem('jt_app','1');}catch(_){}
  window.__JT_LANDING__=false;if(video)video.pause();
  document.documentElement.className=document.documentElement.className.replace(/\\s*jt-landing/g,'');
});

var top=document.getElementById('jtl-top');
root.addEventListener('scroll',function(){top.classList.toggle('scrolled',root.scrollTop>8);},{passive:true});

function count(el){
  var a=+el.getAttribute('data-count-from'),b=+el.getAttribute('data-count-to'),t0=null,d=1400;
  if(reduce){el.textContent=b;return;}
  function f(ts){if(t0===null)t0=ts;var k=Math.min(1,(ts-t0)/d),e=1-Math.pow(1-k,3);
    el.textContent=Math.round(a+(b-a)*e).toLocaleString('ru-RU');if(k<1)requestAnimationFrame(f);}
  requestAnimationFrame(f);
}
var io=new IntersectionObserver(function(es){es.forEach(function(en){
  if(!en.isIntersecting)return;var el=en.target;io.unobserve(el);
  var sibs=el.parentElement?Array.prototype.indexOf.call(el.parentElement.querySelectorAll(':scope > .rv'),el):0;
  setTimeout(function(){el.classList.add('in');
    el.querySelectorAll('[data-count-to]').forEach(count);},Math.max(0,sibs)*110);
});},{root:root,threshold:.18});
root.querySelectorAll('.rv').forEach(function(el){io.observe(el);});

// История на прокрутке: сцена 1–3 по доле прокрутки раздела, внутри сцены — ход 0..1.
var story=document.getElementById('jtl-story'),stage=document.getElementById('jtl-stage'),
    sform=document.getElementById('jtl-sform'),sgo=document.getElementById('jtl-sgo'),cap=document.getElementById('jtl-caption'),
    steps=story?story.querySelectorAll('.story-steps li'):[],fields=sform?sform.querySelectorAll('.f span'):[],
    CAPS=['','Листает вакансии','Юпитер заполняет анкету','Пришло приглашение!'];
function storyTick(){
  if(!story)return;
  var pin=story.firstElementChild,run=story.offsetHeight-pin.offsetHeight,
      p=Math.max(0,Math.min(1,(root.scrollTop-story.offsetTop+80)/Math.max(1,run))),
      scene=p<.34?1:p<.67?2:3,lp=Math.max(0,Math.min(1,(p-(scene-1)/3)*3));
  story.style.setProperty('--p',p.toFixed(3));
  if(stage.dataset.scene!==String(scene)){
    stage.dataset.scene=String(scene);cap.textContent=CAPS[scene];
    steps.forEach(function(li){li.classList.toggle('on',li.getAttribute('data-s')===String(scene));});
  }
  // анкета пишется по мере прокрутки: поле за полем, потом «Отклик отправлен»
  var w=[100,72,86];
  fields.forEach(function(f,i){var k=Math.max(0,Math.min(1,lp*4-i));f.style.width=(scene>2?w[i]:scene<2?0:k*w[i])+'%';});
  var sent=scene>2||(scene===2&&lp>.78);
  sform.classList.toggle('sent',sent);sgo.textContent=sent?'Отклик отправлен':'Отправить';
}
root.addEventListener('scroll',storyTick,{passive:true});storyTick();
// Объём: герои чуть следуют за курсором, каждый на своей глубине.
if(stage&&!reduce){
  stage.addEventListener('mousemove',function(e){
    var r=stage.getBoundingClientRect();
    stage.style.setProperty('--mx',((e.clientX-r.left)/r.width*2-1).toFixed(3));
    stage.style.setProperty('--my',((e.clientY-r.top)/r.height*2-1).toFixed(3));
  });
  stage.addEventListener('mouseleave',function(){stage.style.setProperty('--mx','0');stage.style.setProperty('--my','0');});
}

// Заголовки по словам: каждое слово в своей «щели», выезжает снизу с задержкой.
root.querySelectorAll('.split').forEach(function(h){
  var i=0;
  (function walk(node){
    Array.prototype.slice.call(node.childNodes).forEach(function(n){
      if(n.nodeType===3){
        var frag=document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function(part){
          if(!part)return;
          if(/^\s+$/.test(part)){frag.appendChild(document.createTextNode(part));return;}
          var w=document.createElement('span');w.className='w';
          var inner=document.createElement('span');inner.textContent=part;
          inner.style.transitionDelay=(i++*70)+'ms';w.appendChild(inner);frag.appendChild(w);
        });
        n.parentNode.replaceChild(frag,n);
      }else if(n.nodeType===1&&n.tagName!=='BR'){walk(n);}
    });
  })(h);
});

// Ролик первого экрана: адрес подставляем только здесь — на телефоне файл не качается.
// H.264 играют Chrome, Яндекс и Safari; открытые сборки Chromium и часть Firefox на Linux — только WebM.
var video=document.getElementById('jtl-video');
var MP4=!!video&&!!video.canPlayType('video/mp4; codecs="avc1.42E01E"');
var SRC=MP4?'/landing/hero.mp4':'/landing/hero.webm';
// В окне «Смотреть ролик» — рекламная версия: заставка, сюжет, «Скачайте в RuStore».
var PROMO=MP4?'/landing/promo.mp4':'/landing/promo.webm';
if(video&&!reduce){video.src=SRC;var p=video.play();if(p&&p.catch)p.catch(function(){});}
var modal=document.getElementById('jtl-modal'),mv=document.getElementById('jtl-modal-video');
function closeModal(){modal.classList.remove('on');mv.pause();}
root.addEventListener('click',function(e){
  if(e.target.closest('[data-jtl-reel]')){
    if(!mv.src)mv.src=PROMO;modal.classList.add('on');mv.currentTime=0;
    var q=mv.play();if(q&&q.catch)q.catch(function(){});return;
  }
  if(e.target.closest('[data-jtl-close]')||e.target===modal)closeModal();
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.classList.contains('on'))closeModal();});
})();`;
