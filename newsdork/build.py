import pathlib,shutil
R=pathlib.Path('/workspace/work/newsdork-v3');S=R/'src';D=R/'dist'
if D.exists():shutil.rmtree(D)
(D/'assets/vendor').mkdir(parents=True)
css=(S/'base.css').read_text()+(S/'watch.css').read_text()
for f in ['base.css','watch.css','app.js','captions.js','engines.js','cast.js']:shutil.copy(S/f,D/'assets'/f)
shutil.copy(S/'vendor/mp4box.all.min.js',D/'assets/vendor/')
html=(S/'index.html').read_text();(D/'index.html').write_text(html)
one=html.replace('<link rel="stylesheet" href="assets/base.css">\n<link rel="stylesheet" href="assets/watch.css">','<style>\n'+css+'\n</style>')
for f in ['vendor/mp4box.all.min.js','captions.js','engines.js','cast.js','app.js']:
    js=(S/f).read_text().replace('</script','<\\/script')
    one=one.replace(f'<script src="assets/{f}"></script>','<script>\n'+js+'\n</script>')
assert 'assets/' not in one
(R/'newsdork.html').write_text(one);print(len(one))
shutil.copy(S/'README.md',D/'README.md');shutil.copy(R/'newsdork.html',D/'newsdork.html')
if (R/'LICENSE').exists():shutil.copy(R/'LICENSE',D/'LICENSE')

# --- GitHub Pages hardening ---------------------------------------------------
# Pages serves everything with max-age=600, and the browser caches index.html and each
# asset separately, so after a deploy a visitor can get the NEW page with OLD scripts.
# Stamp every asset URL with a content hash so a new page always pulls matching files.
import hashlib,json,re
idx=D/'index.html';html=idx.read_text()
# mp4box is split in two (the GitHub upload path can't take one 157KB file); same code, eval'd globally.
mp=(D/'assets/vendor/mp4box.all.min.js').read_text();h=len(mp)//2
(D/'assets/vendor/mp4box.1.js').write_text('window.__mp4box='+json.dumps(mp[:h])+';\n')
(D/'assets/vendor/mp4box.2.js').write_text('window.__mp4box+='+json.dumps(mp[h:])+';(0,eval)(window.__mp4box);delete window.__mp4box;\n')
(D/'assets/vendor/mp4box.all.min.js').unlink()
html=html.replace('<script src="assets/vendor/mp4box.all.min.js"></script>','<script src="assets/vendor/mp4box.1.js"></script>\n<script src="assets/vendor/mp4box.2.js"></script>')
def stamp(m):
    p=m.group(2);v=hashlib.sha1((D/p).read_bytes()).hexdigest()[:8];return f'{m.group(1)}="{p}?v={v}"'
html=re.sub(r'(src|href)="(assets/[^"?]+)"',stamp,html)
idx.write_text(html);print('stamped',len(re.findall(r'\?v=',html)),'assets')
