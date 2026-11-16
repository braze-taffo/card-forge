# Card Forge visual assets

The final application mark was generated with the built-in imagegen tool on 2026-10-06. The earlier glass-style variant was discarded after the user requested hand-drawn line art.

- `card-forge-icon-source.png`: original transparent generated asset.
- `card-forge-icon.png`: 512 px app mark, downsampled with alpha preserved.
- `favicon.png`: 64 px browser icon, downsampled from the same original.

Final generation prompt:

> Use case: logo-brand. Asset type: final standalone app icon for Card Forge, an AI character card writing workspace. Primary request: a minimalist HAND DRAWN INK LINE ART mark showing a slightly tilted portrait character card with a simple small flame inside. Style: delicate editorial pen drawing, warm dark graphite outlines, organic imperfect gently wavering strokes, restrained beautiful simple silhouette, tiny pale terracotta watercolor wash inside the flame only. Strictly flat hand drawn linework, mostly empty transparent space inside the card, no filled background tile. Composition: single centered icon occupying 82% of square canvas, generous clean margins, bold enough to read at 32 pixels. Background truly transparent alpha. No text, letters, emoji, 3D, glass, gradients, gloss, photorealism, shadows, heavy hatching, paper background, extra objects, or watermark.

The interface uses locally bundled LXGW WenKai regular/bold with Unicode subsets from `lxgw-wenkai-webfont`. Fonts load from the application origin; no external font service is required. Font and web packaging licenses are preserved in this folder. Project: https://github.com/lxgw/LxgwWenKai; web packaging: https://github.com/chawyehsu/lxgw-wenkai-webfont.

Functional icons are reusable inline SVG line drawings in `src/components/AppIcon.vue`; they match the ink style and retain legibility at small sizes.
