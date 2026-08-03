import qrcode
import base64
from io import BytesIO

URL = "https://survey.xunxinli.com"
OUT_PNG = "/Users/jinnan/WorkBuddy/2026-07-14-09-47-59/qr-survey-xunxinli.png"
OUT_HTML = "/Users/jinnan/WorkBuddy/2026-07-14-09-47-59/poster-survey-xunxinli.html"

# 与问卷前端配色保持一致：暖珊瑚橙主色 #e07a5f / 渐变 #e89b7b / 暖米背景 #fbf5ee
BRAND = "#e07a5f"
BRAND_SOFT = "#e89b7b"
BG = "#fbf5ee"

qr = qrcode.QRCode(
    version=None,
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=22,
    border=4,
)
qr.add_data(URL)
qr.make(fit=True)
img = qr.make_image(fill_color=BRAND, back_color="white")
img.save(OUT_PNG)

buf = BytesIO()
img.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>扫码作答 · 寻心理</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, {BG} 0%, #fbeede 100%);
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    padding: 24px;
  }}
  .card {{
    background: #ffffff;
    border-radius: 24px;
    padding: 40px 36px 32px;
    width: 380px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(224,122,95,.18);
    border: 1px solid #f3e2d8;
  }}
  .eyebrow {{
    font-size: 13px; letter-spacing: 4px; color: {BRAND};
    font-weight: 600; margin-bottom: 10px;
  }}
  .title {{
    font-size: 22px; font-weight: 700; color: #3e332b; margin-bottom: 24px;
  }}
  .qr-wrap {{
    display: inline-block; padding: 16px; border-radius: 18px;
    background: {BG}; border: 1px solid #f0e4d8;
  }}
  .qr-wrap img {{ display: block; width: 256px; height: 256px; }}
  .domain {{
    margin-top: 22px; font-size: 18px; font-weight: 700;
    color: {BRAND}; letter-spacing: 1px;
  }}
  .tip {{ margin-top: 8px; font-size: 13px; color: #8a7b6c; }}
  .btn {{
    margin-top: 24px; display: inline-block; cursor: pointer; border: none;
    background: linear-gradient(135deg, {BRAND_SOFT}, {BRAND});
    color: #fff; padding: 12px 28px; border-radius: 999px;
    font-size: 14px; font-weight: 600;
    box-shadow: 0 6px 18px rgba(224,122,95,.28);
  }}
  .btn:active {{ transform: scale(.97); }}
</style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">寻心理 · 亲子心理关爱</div>
    <div class="title">微信扫码 · 立即开始作答</div>
    <div class="qr-wrap">
      <img id="qr" src="data:image/png;base64,{b64}" alt="survey.xunxinli.com 二维码">
    </div>
    <div class="domain">survey.xunxinli.com</div>
    <div class="tip">用微信扫一扫，手机端即可填写问卷</div>
    <button class="btn" onclick="downloadPoster()">下载二维码 PNG</button>
  </div>
<script>
  function downloadPoster() {{
    const a = document.createElement('a');
    a.href = document.getElementById('qr').src;
    a.download = 'xunxinli-survey-qr.png';
    a.click();
  }}
</script>
</body>
</html>
"""

with open(OUT_HTML, "w", encoding="utf-8") as f:
    f.write(html)

print("OK ->", OUT_PNG)
print("OK ->", OUT_HTML)
