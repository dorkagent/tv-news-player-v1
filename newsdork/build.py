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
