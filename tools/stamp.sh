#!/bin/sh
# ใส่เลขเวอร์ชันท้ายไฟล์ css/js ทุกครั้งก่อน commit มือถือจะได้โหลดไฟล์ใหม่ทุกตัวพร้อมกัน
# และตรวจว่าโค้ด JS ไม่มี syntax error (ตรวจแบบ ES module)
set -e
cd "$(dirname "$0")/.."
V=$(date +%Y%m%d%H%M%S)
sed -i -E "s#href=\"app\.css(\?v=[0-9]+)?\"#href=\"app.css?v=$V\"#; s#src=\"app\.js(\?v=[0-9]+)?\"#src=\"app.js?v=$V\"#" index.html
sed -i -E "s#from '\./config\.js(\?v=[0-9]+)?'#from './config.js?v=$V'#; s#from '\./i18n\.js(\?v=[0-9]+)?'#from './i18n.js?v=$V'#" app.js
T=$(mktemp -d)
for f in app.js i18n.js config.js sw.js; do cp "$f" "$T/${f%.js}.mjs"; node --check "$T/${f%.js}.mjs"; done
rm -rf "$T"
grep -q "isAdmin = " app.js
echo "stamped v=$V, syntax OK"
