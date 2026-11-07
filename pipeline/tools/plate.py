# Госномер по ГОСТ Р 50577 тип 1: 520×112 мм, буквы 58 мм, цифры 76 мм, регион в отдельном поле с RUS и флагом.
# python3 plate.py A777AA 77 out.png   (латиница == кириллица для АВЕКМНОРСТУХ)
import sys
from PIL import Image, ImageDraw, ImageFont
num, reg, out = sys.argv[1], sys.argv[2], sys.argv[3]
S = 4                       # пикселей на мм
W, H = 520 * S, 112 * S
FONT = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
mm = lambda v: int(round(v * S))
# подложка и рамка
d.rounded_rectangle([0, 0, W - 1, H - 1], radius=mm(9), fill=(246, 247, 244, 255))
d.rounded_rectangle([mm(2.2), mm(2.2), W - mm(2.2), H - mm(2.2)], radius=mm(7), outline=(18, 18, 18, 255), width=mm(2.6))
DIV = 404
d.rectangle([mm(DIV), mm(2.2), mm(DIV + 2.4), H - mm(2.2)], fill=(18, 18, 18, 255))
# крепёжные отверстия
for x in (14, 390):
    d.ellipse([mm(x - 2.2), mm(56 - 2.2), mm(x + 2.2), mm(56 + 2.2)], fill=(150, 150, 150, 255))

def glyph(ch, h_mm, x_mm, base_mm, w_mm):
    # рисуем символ так, чтобы высота заглавной была ровно h_mm, ширина ужата до w_mm, низ на base_mm
    f = ImageFont.truetype(FONT, 400)
    bb = f.getbbox(ch)
    gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    g = Image.new('L', (gw, gh), 0)
    ImageDraw.Draw(g).text((-bb[0], -bb[1]), ch, font=f, fill=255)
    g = g.resize((mm(w_mm), mm(h_mm)), Image.LANCZOS)
    blk = Image.new('RGBA', g.size, (14, 14, 14, 255))
    im.paste(blk, (mm(x_mm), mm(base_mm - h_mm)), g)

BASE = 97
# буква · три цифры · две буквы (центры подобраны по фото реальных номеров)
glyph(num[0], 58, 24, BASE, 44)
for i, ch in enumerate(num[1:4]):
    glyph(ch, 76, 80 + i * 58, BASE, 48)
glyph(num[4], 58, 262, BASE, 44)
glyph(num[5], 58, 320, BASE, 44)
# регион
rw = 38 if len(reg) == 2 else 30
x0 = DIV + 2.4 + (520 - 2.2 - DIV - 2.4 - (len(reg) * rw + (len(reg) - 1) * 4)) / 2
for i, ch in enumerate(reg):
    glyph(ch, 52, x0 + i * (rw + 4), 63, rw)
# RUS + флаг
f = ImageFont.truetype(FONT, mm(19))
d.text((mm(418), mm(86)), 'RUS', font=f, fill=(14, 14, 14, 255), anchor='lm')
fx, fy, fw, fh = 470, 79, 28, 14
for k, c in enumerate([(255, 255, 255), (0, 57, 166), (213, 43, 30)]):
    d.rectangle([mm(fx), mm(fy + k * fh / 3), mm(fx + fw), mm(fy + (k + 1) * fh / 3)], fill=c + (255,))
d.rectangle([mm(fx), mm(fy), mm(fx + fw), mm(fy + fh)], outline=(60, 60, 60, 255), width=2)
im.save(out)
print(out, im.size)
