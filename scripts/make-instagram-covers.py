#!/usr/bin/env python3
"""Обложки «Актуальных» Instagram: 4 штуки 1080×1920, с текстом и без.

Персонажи — только три из лендинга (вырезки в docs/instagram-covers/src/).
Запуск: python3 scripts/make-instagram-covers.py [каталог-вывода]
Нужен только Pillow. Рисуем в удвоенном размере и уменьшаем: края получаются гладкими.
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs/instagram-covers/src')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs/instagram-covers')
FONT = os.path.join(ROOT, 'assets/fonts/Manrope-800.ttf')
LOGO = os.path.join(ROOT, 'assets/images/jt-logo-wide.png')

W, H, K = 1080, 1920, 2           # итоговый размер и коэффициент сглаживания
ORANGE, BLACK, CREAM, GREY = '#FF7A1A', '#0C0D0F', '#FFF4EA', '#2B2C30'

# Сетка серии: одинаковая у всех обложек.
CX, CY, R = 540, 940, 400          # диск под персонажем (внутри круга Instagram ~900 px)
CHAR_W = {'girl.png': 610, 'man.png': 640, 'jupiter.png': 700}   # ширина: у всех персонаж одного визуального размера
CHAR_BOTTOM = CY + R - 10          # низ персонажа — у низа диска
CAPTION_Y = 1585                   # центр подписи
CAPTION_W = 900                    # макс. ширина подписи
LOGO_BOX = (70, 90, 150)           # x, y, сторона плашки логотипа


def s(v):
    return int(round(v * K))


def font(size):
    return ImageFont.truetype(FONT, s(size))


def hard_shadow(d, box, radius, fill, shadow, off=7):
    x0, y0, x1, y1 = box
    d.rounded_rectangle((s(x0 + off), s(y0 + off), s(x1 + off), s(y1 + off)), s(radius), fill=shadow)
    d.rounded_rectangle((s(x0), s(y0), s(x1), s(y1)), s(radius), fill=fill)


def star(d, cx, cy, r, fill):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.42
        pts.append((s(cx + rr * math.cos(a)), s(cy + rr * math.sin(a))))
    d.polygon(pts, fill=fill)


def logo_badge(img, bg_is_light):
    """Плашка с логотипом: J тёмная/кремовая, T оранжевая — на контрастной подложке."""
    x, y, side = LOGO_BOX
    d = ImageDraw.Draw(img)
    plate, jcol = (BLACK, CREAM) if bg_is_light else (CREAM, BLACK)
    d.rounded_rectangle((s(x), s(y), s(x + side), s(y + side)), s(34), fill=plate)
    lg = Image.open(LOGO).convert('RGBA')
    px = lg.load()
    for yy in range(lg.height):
        for xx in range(lg.width):
            r, g, b, a = px[xx, yy]
            if a < 8:
                continue
            orange = r > 190 and b < 140 and r - b > 90
            px[xx, yy] = ((255, 122, 26) if orange else tuple(int(jcol[i:i + 2], 16) for i in (1, 3, 5))) + (a,)
    inner = side * 0.62
    lg = lg.resize((s(inner), s(inner * lg.height / lg.width)), Image.LANCZOS)
    img.alpha_composite(lg, (s(x + (side - inner) / 2), s(y + (side - lg.height / K) / 2)))


def paste_character(img, name, disc_fill):
    d = ImageDraw.Draw(img)
    d.ellipse((s(CX - R), s(CY - R), s(CX + R), s(CY + R)), fill=disc_fill)
    ch = Image.open(os.path.join(SRC, name)).convert('RGBA')
    cw = CHAR_W[name]
    h = cw * ch.height / ch.width
    ch = ch.resize((s(cw), s(h)), Image.LANCZOS)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    layer.alpha_composite(ch, (s(CX - cw / 2), s(CHAR_BOTTOM - h)))
    # низ персонажа обрезаем по окружности диска, верх оставляем как есть
    mask = Image.new('L', img.size, 0)
    md = ImageDraw.Draw(mask)
    md.rectangle((0, 0, img.width, s(CY)), fill=255)
    md.ellipse((s(CX - R), s(CY - R), s(CX + R), s(CY + R)), fill=255)
    a = layer.getchannel('A')
    from PIL import ImageChops
    layer.putalpha(ImageChops.multiply(a, mask))
    img.alpha_composite(layer)


def caption(img, text, color, size):
    d = ImageDraw.Draw(img)
    f = font(size)
    w = d.textlength(text, font=f)
    d.text((s(W / 2) - w / 2, s(CAPTION_Y)), text, font=f, fill=color, anchor='ls')
    bw = 130
    d.rounded_rectangle((s(W / 2 - bw / 2), s(CAPTION_Y + 46), s(W / 2 + bw / 2), s(CAPTION_Y + 60)), s(7), fill=color)


def pill(img, cx, cy, text, fill, ink, shadow, angle=0, size=54, pad=34):
    f = font(size)
    d0 = ImageDraw.Draw(img)
    tw = d0.textlength(text, font=f) / K
    w, h = tw + 2 * pad, size * 1.7
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    hard_shadow(d, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), h / 2, fill, shadow, 7)
    d.text((s(cx), s(cy)), text, font=f, fill=ink, anchor='mm')
    layer = layer.rotate(-angle, center=(s(cx), s(cy)), resample=Image.BICUBIC)
    img.alpha_composite(layer)


def card(img, cx, cy, w, h, angle, with_text, shadow):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    hard_shadow(d, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), 30, CREAM, shadow, 8)
    x0, y0 = cx - w / 2 + 28, cy - h / 2 + 26
    d.rounded_rectangle((s(x0), s(y0), s(x0 + 52), s(y0 + 52)), s(14), fill=ORANGE)
    if with_text:
        d.text((s(x0 + 66), s(y0 + 26)), 'React', font=font(38), fill=BLACK, anchor='lm')
        d.text((s(x0), s(y0 + 84)), 'Senior', font=font(42), fill=BLACK, anchor='lm')
        d.text((s(x0), s(y0 + 122)), 'удалённо', font=font(28), fill='#7A6E64', anchor='lm')
    else:
        d.rounded_rectangle((s(x0 + 66), s(y0 + 16), s(x0 + 190), s(y0 + 36)), s(10), fill=BLACK)
        d.rounded_rectangle((s(x0), s(y0 + 74), s(x0 + 190), s(y0 + 94)), s(10), fill=BLACK)
        d.rounded_rectangle((s(x0), s(y0 + 112), s(x0 + 140), s(y0 + 130)), s(9), fill='#BDB1A6')
    layer = layer.rotate(-angle, center=(s(cx), s(cy)), resample=Image.BICUBIC)
    img.alpha_composite(layer)


def arrow_right(img, x0, x1, y, color, thick=26):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((s(x0), s(y - thick / 2), s(x1 - 30), s(y + thick / 2)), s(thick / 2), fill=color)
    d.polygon([(s(x1), s(y)), (s(x1 - 64), s(y - 50)), (s(x1 - 64), s(y + 50))], fill=color)
    j = s(thick / 2)
    d.ellipse((s(x1 - 70), s(y) - j * 2, s(x1 - 70) + j * 4, s(y) + j * 2), fill=color)


def briefcase(img, cx, cy, size, fill, ink):
    d = ImageDraw.Draw(img)
    w, h = size, size * 0.72
    d.rounded_rectangle((s(cx - w * 0.2), s(cy - h / 2 - size * 0.16), s(cx + w * 0.2), s(cy - h / 2 + 10)), s(size * 0.07), outline=ink, width=s(size * 0.07))
    d.rounded_rectangle((s(cx - w / 2), s(cy - h / 2), s(cx + w / 2), s(cy + h / 2)), s(size * 0.12), fill=fill)
    d.rectangle((s(cx - w / 2), s(cy - 4), s(cx + w / 2), s(cy + 8)), fill=ink)
    d.rounded_rectangle((s(cx - size * 0.07), s(cy - size * 0.05), s(cx + size * 0.07), s(cy + size * 0.1)), s(8), fill=ink)


def build(n, with_text):
    spec = {
        1: dict(bg=ORANGE, disc=CREAM, char='girl.png', ink=BLACK, light=False, cap='Как это работает', shadow=BLACK),
        2: dict(bg=BLACK, disc=ORANGE, char='man.png', ink=CREAM, light=False, cap='Вакансии', shadow=ORANGE),
        3: dict(bg=CREAM, disc=BLACK, char='girl.png', ink=BLACK, light=True, cap='Отзывы', shadow=BLACK),
        4: dict(bg=GREY, disc=CREAM, char='jupiter.png', ink=CREAM, light=False, cap='Частые вопросы', shadow=ORANGE),
    }[n]
    img = Image.new('RGBA', (s(W), s(H)), spec['bg'])
    paste_character(img, spec['char'], spec['disc'])
    d = ImageDraw.Draw(img)
    sh = spec['shadow']
    if n == 1:
        card(img, 835, 805, 250, 190, 10, with_text, BLACK)
        arrow_right(img, 735, 950, 985, BLACK)
    elif n == 2:
        if with_text:
            pill(img, 360, 700, 'React', CREAM, BLACK, sh, -7)
            pill(img, 735, 670, 'QA', ORANGE, BLACK, CREAM, 6)
            pill(img, 335, 1170, 'Go', CREAM, BLACK, sh, 5)
            pill(img, 735, 1225, 'удалёнка', CREAM, BLACK, sh, -5)
        else:
            briefcase(img, 745, 720, 170, CREAM, BLACK)
    elif n == 3:
        bx0, by0, bx1, by1 = 585, 585, 865, 805
        if with_text:
            hard_shadow(d, (bx0, by0, bx1, by1), 36, BLACK, ORANGE, 8)
            d.polygon([(s(bx0 + 40), s(by1 - 4)), (s(bx0 + 10), s(by1 + 50)), (s(bx0 + 100), s(by1 - 4))], fill=BLACK)
            for i in range(5):
                star(d, bx0 + 42 + i * 49, by0 + 54, 21, ORANGE)
            d.text((s((bx0 + bx1) / 2), s(by0 + 120)), 'Оффер за', font=font(42), fill=CREAM, anchor='mm')
            d.text((s((bx0 + bx1) / 2), s(by0 + 168)), '6 дней!', font=font(42), fill=CREAM, anchor='mm')
        else:
            hard_shadow(d, (bx0, by0 + 40, bx1, by0 + 150), 36, BLACK, ORANGE, 8)
            for i in range(5):
                star(d, bx0 + 42 + i * 49, by0 + 95, 21, ORANGE)
    elif n == 4:
        d.text((s(770), s(750)), '?', font=font(380), fill=ORANGE, anchor='mm')
    if with_text:
        caption(img, spec['cap'], spec['ink'], CAP_SIZE)
        logo_badge(img, spec['light'])
    return img.resize((W, H), Image.LANCZOS).convert('RGB')


def fit_caption_size():
    d = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    size = 140
    caps = ('Как это работает', 'Вакансии', 'Отзывы', 'Частые вопросы')
    while size > 60 and max(d.textlength(c, font=font(size)) for c in caps) / K > CAPTION_W:
        size -= 2
    return size


CAP_SIZE = fit_caption_size()

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    names = {1: 'kak-eto-rabotaet', 2: 'vakansii', 3: 'otzyvy', 4: 'voprosy'}
    for n in range(1, 5):
        build(n, True).save(os.path.join(OUT, f'{n}-{names[n]}.png'), optimize=True)
        build(n, False).save(os.path.join(OUT, f'{n}-{names[n]}-bez-teksta.png'), optimize=True)
    print('шрифт подписи:', CAP_SIZE)
