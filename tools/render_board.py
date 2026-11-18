"""Render a static design-canvas board to a PNG for screenshots/, through headless Microsoft Edge.

    python tools/render_board.py BOARD.dc.html screenshots/bar.png [--scale 2]

BOARD is a canvas board with no template holes (literal colours and sizes), such as the design canvas's
Mini139.dc.html and Bar32.dc.html behind screenshots/miniplayer.png and bar.png. Its <x-dc> markup is
plain HTML, so it renders without the canvas runtime: it goes on a white page, with the canvas's
placeholder cover swapped for the same cover cut from screenshots/centre.png; Edge screenshots it at
--scale (2 by default; the README shows these at half size) and the PNG is cropped to the board.
Boards up to 1000x400 px fit the window.

Needs Pillow and Edge (Windows).
"""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

REPO = Path(__file__).resolve().parent.parent
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
COVER_BLOB = '/_blob/8a506300e2679ad63cfe0541d030d98a'  # the canvas's placeholder cover
COVER_IN_CENTRE = (680, 96, 1240, 656)  # where screenshots/centre.png draws that cover, 560 px square


def page_html(board_src, cover_uri):
    """A plain page holding the board's markup on white, with the cover at cover_uri."""
    body = re.search(r'<x-dc>(.*)</x-dc>', board_src, re.S).group(1)
    body = re.sub(r'<helmet>.*?</helmet>', '', body, flags=re.S)
    body = body.replace(COVER_BLOB, cover_uri)
    return ('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}</style>'
            f'</head><body>{body}</body></html>')


def crop_to_board(shot):
    """The screenshot cut down to the board: everything from the top left that isn't the white page."""
    shot = shot.convert('RGB')
    box = ImageChops.difference(shot, Image.new('RGB', shot.size, 'white')).getbbox()
    return shot.crop((0, 0, box[2], box[3]))


def render(board, out, scale=2, edge=EDGE):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        cover, page, shot = tmp / 'cover.jpg', tmp / 'page.html', tmp / 'shot.png'
        with Image.open(REPO / 'screenshots' / 'centre.png') as centre:
            centre.convert('RGB').crop(COVER_IN_CENTRE).save(cover, quality=95)
        page.write_text(page_html(board.read_text(encoding='utf-8'), cover.as_uri()), encoding='utf-8')
        subprocess.run([edge, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        f'--force-device-scale-factor={scale}', '--window-size=1000,400',
                        '--virtual-time-budget=3000', f'--screenshot={shot}', page.as_uri()],
                       check=True, capture_output=True)
        with Image.open(shot) as raw:
            img = crop_to_board(raw)
    img.save(out, optimize=True)
    print(f'wrote {out} ({img.width}x{img.height}, {img.width / scale:g}x{img.height / scale:g} at 1x)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('board', type=Path, help='a static .dc.html board')
    ap.add_argument('out', type=Path, help='the PNG to write')
    ap.add_argument('--scale', type=int, default=2, help='device pixels per CSS pixel (default 2)')
    ap.add_argument('--edge', default=EDGE, help='path to msedge.exe')
    args = ap.parse_args()
    render(args.board, args.out, args.scale, args.edge)


if __name__ == '__main__':
    main()
