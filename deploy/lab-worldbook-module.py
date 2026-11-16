"""Extract the pinned SillyTavern conversion verbatim, without a browser runtime."""
import pathlib,re
def generate(refs,out):
    world=(refs/'sillytavern/public/scripts/world-info.js').read_text(encoding='utf-8')
    script=(refs/'sillytavern/public/script.js').read_text(encoding='utf-8')
    parts=['// Generated verbatim from the pinned SillyTavern world-info.js and script.js.\n// Upstream license: AGPL-3.0. Never maintain a second conversion implementation.']
    for name,source in [('world_info_logic',world),('world_info_position',world),('extension_prompt_roles',script),('DEFAULT_DEPTH',world),('DEFAULT_WEIGHT',world),('newWorldInfoEntryDefinition',world)]:
        pattern=r'^export const '+name+r' = (?:\{[\s\S]*?^\};|[^\n]+;)'
        match=re.search(pattern,source,re.M)
        if not match:raise RuntimeError('Pinned conversion dependency changed: '+name)
        parts.append(match.group(0))
    for pattern in [r'export const newWorldInfoEntryTemplate = Object\.fromEntries\([\s\S]*?\n\);',r'export function convertCharacterBook\(characterBook\) \{[\s\S]*?\n\}']:
        match=re.search(pattern,world)
        if not match:raise RuntimeError('Pinned conversion changed')
        parts.append(match.group(0))
    (out/'worldbook-converter.mjs').write_text('\n\n'.join(parts)+'\n',encoding='utf-8')
if __name__=='__main__':
    root=pathlib.Path(__file__).resolve().parents[1]
    generate(root/'_gui-test/references',root/'_gui-test/lab-build')
