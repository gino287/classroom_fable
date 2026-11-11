"""
serve.py — 啟動本機網頁伺服器並打開瀏覽器（start_game.bat 用）

出處表
- 用途：取代「python -m http.server 8000」。只用 Python 標準函式庫，不用安裝東西
- 為什麼要多這個檔（2026-11-11 遇到的問題，見 docs/decision_log.md 決定 21）：
  1. 8000 埠被一個之前沒關掉、已經壞掉的伺服器占住時，新的伺服器開不起來，
     瀏覽器卻連到壞掉的那個，畫面就是「無法連上」。這裡改成 8000 被占用就自動換下一個埠
  2. 瀏覽器會記住舊的 JS／CSS，改了程式重新整理卻沒變。這裡叫瀏覽器不要快取
- 用法：python serve.py [要打開的頁面，例如 game.html] [--no-browser]
"""
import http.server
import os
import sys
import webbrowser

args = [a for a in sys.argv[1:] if not a.startswith("--")]
page = args[0] if args else ""
os.chdir(os.path.dirname(os.path.abspath(__file__)))   # 不管從哪裡執行，都以這個檔所在的資料夾當網站根目錄


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # 不要快取：改了檔案，重新整理就看得到
        super().end_headers()

    def log_message(self, *a):
        pass   # 不在黑色視窗印每一筆請求（視窗出問題時，印東西失敗會讓整個請求失敗）


class Server(http.server.ThreadingHTTPServer):
    # Windows 上這個設成 True 的話，埠被別人占用也「綁得上去」，結果兩個伺服器搶同一個埠。所以關掉
    allow_reuse_address = False


server = None
for port in range(8000, 8020):
    try:
        server = Server(("127.0.0.1", port), Handler)
        break
    except OSError:
        print(f"port {port} is in use, trying the next one...")
if server is None:
    sys.exit("No free port between 8000 and 8019. Close other server windows and try again.")

url = f"http://localhost:{port}/{page}"
print(f"Classroom UI is running at {url}")
print("Keep this window open. Close it (or press Ctrl+C) to stop.")
if "--no-browser" not in sys.argv:
    webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
