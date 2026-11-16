import json, pathlib, shutil, subprocess, tarfile
from importlib.util import spec_from_file_location,module_from_spec
root = pathlib.Path(__file__).resolve().parents[1]
out = root / '_gui-test/lab-build'
refs = root / '_gui-test/references'
out.mkdir(parents=True, exist_ok=True)
ignore = shutil.ignore_patterns('.git', 'node_modules', '*.map', 'tests', 'test', '.github')
shutil.copytree(refs / 'sillytavern', out / 'sillytavern', ignore=ignore, dirs_exist_ok=True)
# The image is immutable and its native library is already compiled at build time.
# Retain upstream serving behavior, but skip per-lease compilation in this image.
middleware=out/'sillytavern/src/middleware/webpack-serve.js'
source=middleware.read_text(encoding='utf-8')
source=source.replace("import path from 'node:path';", "import path from 'node:path';\nimport fs from 'node:fs';")
source=source.replace("        console.log('Compiling frontend libraries...');", """        if (process.env.FORGE_PRECOMPILED_LIB === '1') {
            const config = getPublicLibConfig({ forceDist });
            const library = path.join(config.output.path, config.output.filename);
            if (!fs.existsSync(library) || fs.statSync(library).size < 100000) throw new Error('Missing compiled native library');
            return Promise.resolve();
        }
        console.log('Compiling frontend libraries...');""")
middleware.write_text(source,encoding='utf-8')
extensions = out / 'extensions'
extensions.mkdir(exist_ok=True)
for source, name in [('tavern-helper', 'JS-Slash-Runner'), ('prompt-template', 'ST-Prompt-Template')]:
    dest = extensions / name
    dest.mkdir(exist_ok=True)
    for entry in (refs / source).iterdir():
        if entry.name not in ['dist','lib','libs','locales','i18n','manifest.json','settings.html','LICENSE']: continue
        if entry.is_dir(): shutil.copytree(entry, dest / entry.name, ignore=ignore, dirs_exist_ok=True)
        else: shutil.copy2(entry, dest / entry.name)
    manifest = json.loads((dest/'manifest.json').read_text(encoding='utf-8'))
    manifest['auto_update'] = False
    (dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
shutil.copytree(root / 'lab/bridge', extensions / 'forge-lab-bridge', dirs_exist_ok=True)
for name in ['worker.mjs', 'browser-proxy.mjs', 'Dockerfile']: shutil.copy2(root / 'lab' / name, out / name)
for name in ['lab-bundle-native.mjs','lab-pack-shared.mjs']: shutil.copy2(root / 'deploy' / name, out / name)
spec=spec_from_file_location('worldbook_module',root/'deploy/lab-worldbook-module.py');module=module_from_spec(spec);spec.loader.exec_module(module);module.generate(refs,out)
profile = {'id':'forge-player-v6','browser':'player browser only','network':'isolated, cached dependencies only','interaction':'native player iframe; direct ST import, precompiled libraries and bundled shared core'}
pinned = json.loads((root / 'lab/pinned-revisions.json').read_text(encoding='utf-8'))
for repo in ['sillytavern','tavern-helper','prompt-template','mvu']:
    expected = pinned[repo]
    # Without a nested checkout, git -C would incorrectly resolve the parent project.
    if (refs / repo / '.git').exists():
        actual = subprocess.check_output(['git','-C',str(refs/repo),'rev-parse','HEAD'],text=True).strip()
        if actual != expected:
            raise RuntimeError('Unexpected upstream revision for ' + repo)
    else:
        actual = expected  # Pinned archive provenance is held outside the source project.
    profile[repo] = actual
(out / 'profile.json').write_text(json.dumps(profile,indent=2),encoding='utf-8')
archive = root / 'deploy/card-forge-lab-build.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
    for entry in out.iterdir(): tar.add(entry,arcname=entry.name)
print(json.dumps({'archive':str(archive),'sizeMiB':round(archive.stat().st_size/1048576,2),'profile':profile}))
