#!/usr/bin/env python3
"""
寻心理问卷海报 v3 —— 重新排版，协调好看
- 去掉重复的大标题（第二行「微信扫码·立即开始作答」）
- 保留：眉批(绿) / 大二维码 / 域名(珊瑚暖橙) / 提示(灰) / 底部品牌
- 新增横向分隔线 + 居中装饰，整体留白均衡
- 配色：官网绿 #4A7C6F + 珊瑚暖橙 #E07A5F + 铜 #D4A574 + 暖白
"""

import os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/jinnan/WorkBuddy/2026-07-14-09-47-59"
QR_PATH   = os.path.join(BASE, "survey/qr-survey-xunxinli.png")
LOGO_ICON = os.path.join(BASE, "xunpsy-src/logo.png")
OUT_PATH  = os.path.join(BASE, "survey/poster-xunxinli-final.png")

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# 调色板
C_GREEN   = "#4A7C6F"   # 眉批·绿
C_CORAL   = "#E07A5F"   # 域名·珊瑚暖橙（温暖）
C_COPPER  = "#D4A574"   # 装饰线·铜
C_DARK    = "#2D4A42"   # 品牌字·深
C_GRAY    = "#8A7B6C"   # 提示·灰
C_WARM1   = "#FBF5EE"   # 背景渐变起
C_WARM2   = "#F6ECE4"   # 背景渐变终
C_CARD    = "#FFFFFF"
C_QRBG    = "#FBF5EE"
C_BORDER  = "#ECE3DA"

# ── 画布 ──
W, H = 750, 1040
img = Image.new("RGB", (W, H), hex_rgb(C_WARM1))
draw = ImageDraw.Draw(img)
for y in range(H):
    r = y / H
    c1, c2 = hex_rgb(C_WARM1), hex_rgb(C_WARM2)
    col = tuple(int(c1[i]*(1-r) + c2[i]*r) for i in range(3))
    draw.line([(0, y), (W, y)], fill=col)

# ── 字体 ──
F_MAIN  = "/System/Library/Fonts/Hiragino Sans GB.ttc"
F_BOLD  = "/System/Library/Fonts/STHeiti Medium.ttc"
font_eyebrow = ImageFont.truetype(F_MAIN, 19)
font_domain  = ImageFont.truetype(F_BOLD, 30)
font_tip     = ImageFont.truetype(F_MAIN, 17)
font_brand   = ImageFont.truetype(F_BOLD, 23)
font_slogan  = ImageFont.truetype(F_MAIN, 14)

def tw(t, f):
    b = draw.textbbox((0,0), t, font=f)
    return b[2]-b[0]

def ctext(y, t, f, fill):
    draw.text(((W - tw(t, f))//2, y), t, font=f, fill=fill)

# ── 白色圆角卡片 ──
card_x, card_y = 38, 46
card_w = W - card_x*2
card_h = H - card_y*2
card_r = 30

# 阴影
sh = Image.new("RGBA", (W, H), (0,0,0,0))
ImageDraw.Draw(sh).rounded_rectangle(
    [card_x+4, card_y+8, card_x+card_w+4, card_y+card_h+8], radius=card_r,
    fill=(224,122,95,22))
img = Image.alpha_composite(img.convert("RGBA"), sh).convert("RGB")
draw = ImageDraw.Draw(img)
draw.rounded_rectangle(
    [card_x, card_y, card_x+card_w, card_y+card_h], radius=card_r,
    fill=hex_rgb(C_CARD), outline=hex_rgb(C_BORDER), width=1)

ix = card_x + card_w//2   # 卡片水平中心

# ══════════════════════════════════
# ① 眉批（绿）+ 上方小装饰短线
# ══════════════════════════════════
y = card_y + 58
# 小装饰短线（铜色，居中，8px 宽）
draw.line([(ix-18, y-16), (ix+18, y-16)], fill=hex_rgb(C_COPPER), width=2)
ctext(y, "微信扫码 · 立即开始作答", font_eyebrow, hex_rgb(C_GREEN))

# ══════════════════════════════════
# ② 大二维码
# ══════════════════════════════════
qr = Image.open(QR_PATH).convert("RGBA")
QR = 300
qr_r = qr.resize((QR, QR), Image.LANCZOS)
pad = 28
bg_w = QR + pad*2
bg_h = QR + pad*2
bg_x = ix - bg_w//2
bg_y = y + 44

# 二维码底（圆角 + 细微阴影）
ql = Image.new("RGBA", (W, H), (0,0,0,0))
qd = ImageDraw.Draw(ql)
qd.rounded_rectangle([bg_x+2, bg_y+4, bg_x+bg_w+2, bg_y+bg_h+4], radius=20,
                     fill=(224,122,95,16))
qd.rounded_rectangle([bg_x, bg_y, bg_x+bg_w, bg_y+bg_h], radius=20,
                     fill=hex_rgb(C_QRBG)+(255,), outline=hex_rgb(C_BORDER)+(200,), width=1)
img = Image.alpha_composite(img.convert("RGBA"), ql).convert("RGB")
draw = ImageDraw.Draw(img)
img.paste(qr_r, (bg_x+pad, bg_y+pad), qr_r)

# ══════════════════════════════════
# ③ 域名（珊瑚暖橙）
# ══════════════════════════════════
y_domain = bg_y + bg_h + 46
ctext(y_domain, "xunxinli.com", font_domain, hex_rgb(C_CORAL))

# ══════════════════════════════════
# ④ 提示（灰）+ 两侧横线装饰
# ══════════════════════════════════
y_tip = y_domain + 50
tip = "微信扫码，立即开始作答"
margin = 90
line_gap = 16
t_w = tw(tip, font_tip)
t_x = ix - t_w//2
# 左线
draw.line([(margin, y_tip+10), (t_x-line_gap, y_tip+10)], fill=hex_rgb(C_COPPER), width=1)
# 右线
draw.line([(t_x+t_w+line_gap, y_tip+10), (W-margin, y_tip+10)], fill=hex_rgb(C_COPPER), width=1)
ctext(y_tip, tip, font_tip, hex_rgb(C_GRAY))

# ══════════════════════════════════
# ⑤ 底部品牌区
# ══════════════════════════════════
y_brand = y_tip + 64
icon = Image.open(LOGO_ICON).convert("RGBA")
IS = 42
icon_r = icon.resize((IS, IS), Image.LANCZOS)
brand_w = tw("寻心理", font_brand)
group_w = IS + 12 + brand_w
gx = ix - group_w//2
img.paste(icon_r, (gx, y_brand), icon_r)
draw = ImageDraw.Draw(img)
ty = y_brand + (IS - 24)//2 + 1
draw.text((gx+IS+12, ty), "寻心理", font=font_brand, fill=hex_rgb(C_DARK))

y_slogan = ty + 30
ctext(y_slogan, "向内寻，向外生", font_slogan, hex_rgb(C_GRAY))

img.save(OUT_PATH, "PNG", quality=95)
print(f"✅ 海报 v3 已生成: {OUT_PATH}")
print(f"   尺寸 {W}×{H}px | {os.path.getsize(OUT_PATH)/1024:.1f} KB")
