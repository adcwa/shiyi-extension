"""Local introduction preview. Serves bundled public assets, no model requests.
Open http://127.0.0.1:8428/ . This preview is separate from the extension runtime.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json, urllib.parse

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'src'),**kwargs)
 def log_message(self,*args):pass
 def do_GET(self):
  path=urllib.parse.urlsplit(self.path).path
  if path=='/':self.path='/intro.html'
  if path=='/downloads/dianyi-chrome-edge-'+VERSION+'.zip':
   archive=ROOT/'releases'/('dianyi-chrome-edge-'+VERSION+'.zip')
   if not archive.exists():self.send_error(404);return
   data=archive.read_bytes();self.send_response(200);self.send_header('Content-Type','application/zip');self.send_header('Content-Disposition','attachment; filename="'+archive.name+'"');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  return super().do_GET()
 def list_directory(self,path):self.send_error(404);return None
 def send_error(self,code,message=None,explain=None):
  if code!=404:return super().send_error(code,message,explain)
  data=(ROOT/'src/404.html').read_text().replace('href="assets/','href="/assets/').replace('href="ui/','href="/ui/').replace('href="intro.html"','href="/intro.html"').replace('src="assets/','src="/assets/').replace('href="assets/','href="/assets/').encode()
  self.send_response(404);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

if __name__=='__main__':
 print('点译介绍页预览：http://127.0.0.1:8428/',flush=True)
 ThreadingHTTPServer(('127.0.0.1',8428),Handler).serve_forever()
