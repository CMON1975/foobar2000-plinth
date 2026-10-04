"""Render icons/*.ico — the Lucide "boom-box" glyph as foobar2000's tray and taskbar icons.

    python tools/make_icons.py

Needs Pillow; renders from fonts/lucide.ttf. Each size is rendered from the font at that size rather
than scaled down, so the small sizes stay sharp.

- boombox-tray.ico: bare glyph in bone, for Columns UI's custom system tray icon (dark taskbar).
- boombox-taskbar.ico: the same bare glyph up to 256 px, for the pinned taskbar shortcut.
- boombox-tile.ico: bone glyph on a rounded g4 tile, a taskbar alternative that also shows on a light taskbar.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'icons'
FONT = REPO / 'fonts' / 'lucide.ttf'
BOOM_BOX = chr(0xE4EE)

# From the palette in scripts/lib/common.js (SHADES.soft)
BONE = (0xE8, 0xE6, 0xE2, 255)  # t1
TILE = (0x38, 0x38, 0x38, 255)  # g4

TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64]
APP_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def glyph(size, em, colour):
    """The glyph centred on a transparent size×size square. Lucide's em box is the icon's 24-unit grid."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    off = (size - em) / 2
    ImageDraw.Draw(img).text((off, off + em), BOOM_BOX, font=ImageFont.truetype(str(FONT), em), fill=colour, anchor='ls')
    return img


def tile(size):
    ss = 4  # supersample the rounded corners
    big = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=round(size * ss * 0.22), fill=TILE)
    img = big.resize((size, size), Image.LANCZOS)
    scale = 0.8 if size <= 20 else 0.7  # bigger glyph where the tile would otherwise swallow it
    img.alpha_composite(glyph(size, round(size * scale), BONE))
    return img


def save_ico(path, images):
    largest = images[-1]
    largest.save(path, format='ICO', sizes=[im.size for im in images], append_images=images[:-1])
    print(f'wrote {path.relative_to(REPO)} ({", ".join(str(im.width) for im in images)})')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    save_ico(OUT / 'boombox-tray.ico', [glyph(s, s, BONE) for s in TRAY_SIZES])
    save_ico(OUT / 'boombox-taskbar.ico', [glyph(s, s, BONE) for s in APP_SIZES])
    save_ico(OUT / 'boombox-tile.ico', [tile(s) for s in APP_SIZES])


if __name__ == '__main__':
    main()
