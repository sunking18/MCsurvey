#!/usr/bin/env python3
"""
寻心理问卷海报图片 v2（PNG）
布局参考 poster-survey-xunxinli.html 卡片式设计，文案按用户要求调整：
  ① 眉批 → 「微信扫码 · 立即开始作答」（官网绿色）
  ② 标题 → 「微信扫码 · 立即开始作答」（大字深色）
  ③ 大二维码（圆角暖白底）
  ④ 域名 → xunxinli.com（铜色加粗）
  ⑤ 提示 → 微信扫码，立即开始作答（小灰字）
  ⑥ 底部品牌区 → 小图标 + 寻心理 + 向内寻，向外生（无按钮）
"""

import os
import math
from PIL import Image, ImageDraw, ImageFont

# ── 路径 ──
BASE = "/Users/jinnan/WorkBuddy/2026-07-14-09-47-59"
QR_PATH   = os.path.join(BASE, "survey/qr-survey-xunxinli.png")
LOGO_ICON = os.path.join(BASE, "xunpsy-src/logo.png")       # 小图标（种子+爱心）
OUT_PATH  = os.path.join(BASE, "survey/poster-xunxinli-final.png")

# ── 品牌色 ──
def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

C_GREEN      = "#4A7C6F"   # 官网绿（眉批用）
C_COPPER     = "#D4A574"   # 铜（域名）
C_CORAL      = "#E89B7B"   # 珊瑚（按钮底色参考）
C_TEXT_DARK  = "#2D4A42"   # 深文字（标题）
C_TEXT_MID   = "#6B5E52"   # 中文字（提示）
C_WARM_BG    = "#FBF5EE"   # 暖白渐变起
C_WARM_BG2   = "#F8EDE6"   # 暖白渐变终
C_WHITE      = "#FFFFFF"
C_CARD_BG    = "#FFF9F5"   # 卡片内白
C_QR_BG      = "#FBF5EE"   # 二维码底
C_BORDER     = "#E8E4DF"
C_SHADOW     = (224, 122, 95, 28)

# ── 画布：竖版卡片比例 ──
W, H = 750, 1100

# 渐变背景
img = Image.new("RGB", (W, H), hex_rgb(C_WARM_BG))
draw = ImageDraw.Draw(img)
for y in range(H):
    r = y / H
    c1, c2 = hex_rgb(C_WARM_BG), hex_rgb(C_WARM_BG2)
    col = tuple(int(c1[i] * (1 - r) + c2[i] * r) for i in range(3))
    draw.line([(0, y), (W, y)], fill=col)

# ── 字体（Hiragino Sans GB / STHeiti 均支持中文）──
FONT_MAIN = "/System/Library/Fonts/Hiragino Sans GB.ttc"
FONT_BOLD = "/System/Library/Fonts/STHeiti Medium.ttc"
try:
    font_xs   = ImageFont.truetype(FONT_MAIN, 18)    # 眉批
    font_lg   = ImageFont.truetype(FONT_BOLD, 30)    # 标题
    font_md   = ImageFont.truetype(FONT_BOLD, 26)    # 域名
    font_sm   = ImageFont.truetype(FONT_MAIN, 17)    # 提示
    font_brand= ImageFont.truetype(FONT_BOLD, 22)    # 品牌「寻心理」
    font_tag  = ImageFont.truetype(FONT_MAIN, 14)    # slogan
except Exception:
    font_xs = font_lg = font_md = font_sm = font_brand = font_tag = ImageFont.load_default()

def txt_w(t, f):
    b = draw.textbbox((0, 0), t, font=f)
    return b[2] - b[0]

def ctr(y, t, f, fill):
    draw.text(((W - txt_w(t, f)) // 2, y), t, font=f, fill=fill)

# ══════════════════════════════
# 白色圆角卡片（主体容器）
# ══════════════════════════════
card_pad_x = 36
card_pad_top = 40
card_pad_bottom = 44
card_rx = 28
card_x = card_pad_x
card_y = card_pad_top
card_w = W - card_pad_x * 2
card_h = H - card_pad_top - card_pad_bottom

# 卡片阴影层
shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow_layer)
sd.rounded_rectangle(
    [card_x + 4, card_y + 6, card_x + card_w + 4, card_y + card_h + 6],
    radius=card_rx,
    fill=(224, 122, 95, 20)
)
img = Image.alpha_composite(img.convert("RGBA"), shadow_layer).convert("RGB")
draw = ImageDraw.Draw(img)

# 卡片本体
draw.rounded_rectangle(
    [card_x, card_y, card_x + card_w, card_y + card_h],
    radius=card_rx,
    fill=hex_rgb(C_WHITE),
    outline=hex_rgb(C_BORDER),
    width=1
)

cx = card_x + card_w // 2  # 卡片中心 X

# ══════════════════════════════
# ① 眉批：微信扫码 · 立即开始作答（绿色小字）
# ══════════════════════════════
y = card_y + 32
ctr(y, "微信扫码 · 立即开始作答", font_xs, hex_rgb(C_GREEN))

# ══════════════════════════════
# ② 标题：微信扫码 · 立即开始作答（大字深色）
# ══════════════════════════════
y += 34
ctr(y, "微信扫码 · 立即开始作答", font_lg, hex_rgb(C_TEXT_DARK))

# ══════════════════════════════
# ③ 大二维码区域
# ══════════════════════════════
qr_img = Image.open(QR_PATH).convert("RGBA")
QR_SIZE = 320
qr_resized = qr_img.resize((QR_SIZE, QR_SIZE), Image.LANCZOS)

pad_qr = 22
qr_bg_w = QR_SIZE + pad_qr * 2
qr_bg_h = QR_SIZE + pad_qr * 2
qr_bg_x = cx - qr_bg_w // 2
qr_bg_y = y + 38

# 圆角二维码底
qr_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
qd = ImageDraw.Draw(qr_layer)
qd.rounded_rectangle(
    [qr_bg_x, qr_bg_y, qr_bg_x + qr_bg_w, qr_bg_y + qr_bg_h],
    radius=18,
    fill=hex_rgb(C_QR_BG) + (255,),
    outline=hex_rgb(C_BORDER) + (180,),
    width=1
)
img = Image.alpha_composite(img.convert("RGBA"), qr_layer).convert("RGB")

# 贴二维码
qr_paste_x = qr_bg_x + pad_qr
qr_paste_y = qr_bg_y + pad_qr
if qr_resized.mode == "RGBA":
    img.paste(qr_resized, (qr_paste_x, qr_paste_y), qr_resized)
else:
    img.paste(qr_resized, (qr_paste_x, qr_paste_y))

draw = ImageDraw.Draw(img)

# ══════════════════════════════
# ④ 域名：xunxinli.com（铜色加粗）
# ══════════════════════════════
domain_y = qr_bg_y + qr_bg_h + 28
ctr(domain_y, "xunxinli.com", font_md, hex_rgb(C_COPPER))

# ══════════════════════════════
# ⑤ 提示：微信扫码，立即开始作答（小灰字）
# ══════════════════════════════
tip_y = domain_y + 36
ctr(tip_y, "微信扫码，立即开始作答", font_sm, hex_rgb(C_TEXT_MID))

# ══════════════════════════════
# ⑥ 底部品牌区：小图标 + 寻心理 + 向内寻，向外生
# ══════════════════════════════
brand_y = tip_y + 52

# 加载小图标
icon = Image.open(LOGO_ICON).convert("RGBA")
ICON_SIZE = 40
icon_resized = icon.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)

# 计算总宽度居中
brand_text_w = txt_w("寻心理", font_brand)
total_brand_w = ICON_SIZE + 10 + brand_text_w
brand_start_x = cx - total_brand_w // 2

# 贴图标
img.paste(icon_resized, (brand_start_x, brand_y), icon_resized)
draw = ImageDraw.Draw(img)

# 「寻心理」文字（与图标基线对齐，略下移视觉居中）
text_offset_y = brand_y + (ICON_SIZE - 22) // 2 + 2
draw.text((brand_start_x + ICON_SIZE + 10, text_offset_y), "寻心理",
          font=font_brand, fill=hex_rgb(C_TEXT_DARK))

# slogan 小字
slogan_y = text_offset_y + 28
ctr(slogan_y, "向内寻，向外生", font_tag, hex_rgb(C_TEXT_MID))

# ══════════════════════════════
# 保存
# ══════════════════════════════
img.save(OUT_PATH, "PNG", quality=95)
print(f"✅ 海报已生成: {OUT_PATH}")
print(f"   尺寸: {W}×{H}px | 大小: {os.path.getsize(OUT_PATH)/1024:.1f} KB")
