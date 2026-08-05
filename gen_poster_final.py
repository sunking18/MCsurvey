#!/usr/bin/env python3
"""
寻心理问卷海报 —— 恢复为 v2 卡片样式（对齐截图）
- 眉批：寻心理 · 亲子心理关爱（珊瑚橙）
- 大标题：微信扫码 · 立即开始作答（粗黑）
- 大二维码（暖白底圆角容器）
- 域名：survey.xunxinli.com（珊瑚橙）
- 提示：用微信扫一扫，手机端即可填写问卷（灰）
- 按钮：下载二维码 PNG（珊瑚橙圆角胶囊）
"""

import os
from PIL import Image, ImageDraw, ImageFont

BASE = "/Users/jinnan/WorkBuddy/2026-07-14-09-47-59"
QR_PATH  = os.path.join(BASE, "survey/qr-survey-xunxinli.png")
OUT_PATH = os.path.join(BASE, "survey/poster-xunxinli-final.png")

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# ── 调色板（对齐截图） ──
C_BG1     = "#FBF5EE"   # 背景渐变起（暖白）
C_BG2     = "#FBEDE4"   # 背景渐变终
C_CARD    = "#FFFFFF"   # 卡片白
C_BORDER  = "#F0E4D8"   # 卡片细边框
C_CORAL   = "#E07A5F"   # 珊瑚橙·眉批/域名/按钮
C_DARK    = "#2D2D2D"   # 大标题黑
C_GRAY    = "#8A7B6C"   # 提示文字灰
C_QRBG    = "#FBF5EE"   # 二维码底色
C_SHADOW  = (224, 122, 95, 18)  # 卡片阴影

# ── 画布 ──
W, H = 750, 1100
img = Image.new("RGB", (W, H), hex_rgb(C_BG1))
draw = ImageDraw.Draw(img)
# 渐变背景
for y in range(H):
    r = y / H
    c1, c2 = hex_rgb(C_BG1), hex_rgb(C_BG2)
    col = tuple(int(c1[i]*(1-r) + c2[i]*r) for i in range(3))
    draw.line([(0, y), (W, y)], fill=col)

# ── 字体 ──
F_MAIN = "/System/Library/Fonts/Hiragino Sans GB.ttc"
F_BOLD = "/System/Library/Fonts/STHeiti Medium.ttc"
font_eyebrow = ImageFont.truetype(F_MAIN, 20)
font_title   = ImageFont.truetype(F_BOLD, 36)
font_domain  = ImageFont.truetype(F_BOLD, 28)
font_tip     = ImageFont.truetype(F_MAIN, 17)
font_btn     = ImageFont.truetype(F_BOLD, 18)

def tw(t, f):
    b = draw.textbbox((0,0), t, font=f)
    return b[2] - b[0]

def ctext(y, t, f, fill):
    draw.text(((W - tw(t, f)) // 2, y), t, font=f, fill=fill)

# ── 白色圆角卡片（带阴影）──
card_x, card_y = 40, 40
card_w = W - card_x * 2
card_h = H - card_y * 2
card_r = 28

# 阴影层
sh = Image.new("RGBA", (W, H), (0,0,0,0))
ImageDraw.Draw(sh).rounded_rectangle(
    [card_x+5, card_y+10, card_x+card_w+5, card_y+card_h+10],
    radius=card_r, fill=C_SHADOW)
img = Image.alpha_composite(img.convert("RGBA"), sh).convert("RGB")
draw = ImageDraw.Draw(img)
# 卡片本体
draw.rounded_rectangle(
    [card_x, card_y, card_x+card_w, card_y+card_h],
    radius=card_r, fill=hex_rgb(C_CARD),
    outline=hex_rgb(C_BORDER), width=1)

ix = card_x + card_w // 2  # 卡片水平中心

# ══════════════════════════════════
# ① 眉批：寻心理 · 亲子心理关爱
# ══════════════════════════════════
y = card_y + 60
ctext(y, "寻心理 · 亲子心理关爱", font_eyebrow, hex_rgb(C_CORAL))

# ══════════════════════════════════
# ② 大标题：微信扫码 · 立即开始作答
# ══════════════════════════════════
y_title = y + 46
ctext(y_title, "微信扫码 · 立即开始作答", font_title, hex_rgb(C_DARK))

# ══════════════════════════════════
# ③ 二维码（暖白底圆角容器）
# ══════════════════════════════════
qr = Image.open(QR_PATH).convert("RGBA")
QR_SIZE = 320
qr_r = qr.resize((QR_SIZE, QR_SIZE), Image.LANCZOS)
pad = 24
bg_w = QR_SIZE + pad * 2
bg_h = QR_SIZE + pad * 2
bg_x = ix - bg_w // 2
bg_y = y_title + 50

# 二维码底（圆角 + 微阴影）
ql = Image.new("RGBA", (W, H), (0,0,0,0))
qd = ImageDraw.Draw(ql)
qd.rounded_rectangle(
    [bg_x+3, bg_y+5, bg_x+bg_w+3, bg_y+bg_h+5], radius=18,
    fill=(224, 122, 95, 14))
qd.rounded_rectangle(
    [bg_x, bg_y, bg_x+bg_w, bg_y+bg_h], radius=18,
    fill=hex_rgb(C_QRBG)+(255,),
    outline=hex_rgb("#EDE5DC")+(220,), width=1)
img = Image.alpha_composite(img.convert("RGBA"), ql).convert("RGB")
draw = ImageDraw.Draw(img)
img.paste(qr_r, (bg_x + pad, bg_y + pad), qr_r)
draw = ImageDraw.Draw(img)

# ══════════════════════════════════
# ④ 域名：survey.xunxinli.com
# ══════════════════════════════════
y_domain = bg_y + bg_h + 44
ctext(y_domain, "survey.xunxinli.com", font_domain, hex_rgb(C_CORAL))

# ══════════════════════════════════
# ⑤ 提示文字
# ══════════════════════════════════
y_tip = y_domain + 38
ctext(y_tip, "用微信扫一扫，手机端即可填写问卷", font_tip, hex_rgb(C_GRAY))

# ══════════════════════════════════
# ⑥ 下载按钮（珊瑚橙圆角胶囊）
# ══════════════════════════════════
y_btn = y_tip + 48
btn_text = "下载二维码 PNG"
btn_pw = tw(btn_text, font_btn) + 48
btn_ph = 48
btn_x = ix - btn_pw // 2
btn_r = btn_ph // 2

# 按钮阴影
bs = Image.new("RGBA", (W, H), (0,0,0,0))
ImageDraw.Draw(bs).rounded_rectangle(
    [btn_x+2, btn_y_off:=y_btn+4, btn_x+btn_pw+2, y_btn+btn_ph+4],
    radius=btn_r, fill=(224, 122, 95, 30))
img = Image.alpha_composite(img.convert("RGBA"), bs).convert("RGB")
draw = ImageDraw.Draw(img)
# 按钮本体（渐变效果用纯色模拟）
draw.rounded_rectangle(
    [btn_x, y_btn, btn_x+btn_pw, y_btn+btn_ph],
    radius=btn_r, fill=hex_rgb("#E89B7B"))
draw.rounded_rectangle(
    [btn_x, y_btn, btn_x+btn_pw, y_btn+btn_ph],
    radius=btn_r, fill=hex_rgb("#E07A5F"))
# 按钮文字
ctext(y_btn + (btn_ph - 22)//2 + 2, btn_text, font_btn, (255, 255, 255))

img.save(OUT_PATH, "PNG")
print(f"✅ 海报已生成（v2 卡片样式）: {OUT_PATH}")
print(f"   尺寸 {W}×{H}px | {os.path.getsize(OUT_PATH)/1024:.1f} KB")
