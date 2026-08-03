import qrcode
import base64
from io import BytesIO

URL = "https://xunxinli.com"
OUT_PNG = "/Users/jinnan/WorkBuddy/2026-07-14-09-47-59/survey/qr-xunxinli.png"
OUT_HTML = "/Users/jinnan/WorkBuddy/2026-07-14-09-47-59/survey/poster-xunxinli.html"

# 高纠错等级，方便手机远距离/弱光识别
qr = qrcode.QRCode(
    version=None,
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=22,
    border=4,
)
qr.add_data(URL)
qr.make(fit=True)
img = qr.make_image(fill_color="#16213e", back_color="white")

# 保存独立 PNG（核心交付物）
img.save(OUT_PNG)

# 转 base64 供 HTML 内嵌（完全离线自包含）
buf = BytesIO()
img.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>扫码作答 · xunxinli.com</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #16213e 0%, #0f3460 100%);
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    padding: 24px;
  }}
  .card {{
    background: #ffffff;
    border-radius: 24px;
    padding: 40px 36px 32px;
    width: 380px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,.35);
  }}
  .eyebrow {{
    font-size: 13px; letter-spacing: 4px; color: #0f3460;
    font-weight: 600; margin-bottom: 10px;
  }}
  .title {{
    font-size: 22px; font-weight: 700; color: #16213e; margin-bottom: 24px;
  }}
  .qr-wrap {{
    display: inline-block; padding: 16px; border-radius: 18px;
    background: #f4f6fb; border: 1px solid #e3e8f2;
  }}
  .qr-wrap img {{ display: block; width: 256px; height: 256px; }}
  .domain {{
    margin-top: 22px; font-size: 18px; font-weight: 700;
    color: #0f3460; letter-spacing: 1px;
  }}
  .tip {{ margin-top: 8px; font-size: 13px; color: #8a93a6; }}
  .btn {{
    margin-top: 24px; display: inline-block; cursor: pointer;
    background: #0f3460; color: #fff; border: none;
    padding: 12px 28px; border-radius: 999px; font-size: 14px; font-weight: 600;
  }}
  .btn:active {{ transform: scale(.97); }}
</style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">中石油 · 亲子心理关爱</div>
    <div class="title">微信扫码 · 立即开始作答</div>
    <div class="qr-wrap">
      <img id="qr" src="data:image/png;base64,{b64}" alt="xunxinli.com 二维码">
    </div>
    <div class="domain">xunxinli.com</div>
    <div class="tip">用微信扫一扫，手机端即可填写问卷</div>
    <button class="btn" onclick="downloadPoster()">下载二维码 PNG</button>
  </div>
<script>
  function downloadPoster() {{
    const a = document.createElement('a');
    a.href = document.getElementById('qr').src;
    a.download = 'xunxinli-qr.png';
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
