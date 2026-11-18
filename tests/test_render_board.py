"""Tests for tools/render_board.py's two steps that need no browser: board to page, and the crop.

    python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import render_board  # noqa: E402

COVER = 'file:///C:/kit/cover.jpg'
BOARD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bar</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow">
<style>
body{margin:0}
</style>
</helmet>
<div style="width: 40px; height: 20px; background: #212121"><img src="/_blob/8a506300e2679ad63cfe0541d030d98a" alt="cover"></div>
</x-dc>
<script type="text/x-dc" data-dc-script>class Component extends DCLogic {}</script>
</body>
</html>'''


class PageHtml(unittest.TestCase):
    def test_keeps_the_board_markup_with_the_cover_pointing_at_the_local_file(self):
        page = render_board.page_html(BOARD, COVER)
        self.assertIn('<div style="width: 40px; height: 20px; background: #212121">', page)
        self.assertIn(f'<img src="{COVER}" alt="cover">', page)
        self.assertNotIn('/_blob/', page)

    def test_leaves_out_the_canvas_runtime_on_a_white_page(self):
        page = render_board.page_html(BOARD, COVER)
        for gone in ('support.js', '<x-dc>', '<helmet>', 'fonts.googleapis.com', 'DCLogic'):
            self.assertNotIn(gone, page)
        self.assertIn('background:#fff', page)


class CropToBoard(unittest.TestCase):
    def test_crops_the_screenshot_to_the_board_at_its_top_left(self):
        shot = Image.new('RGB', (100, 50), 'white')
        shot.paste((33, 33, 33), (0, 0, 40, 20))
        shot.putpixel((39, 19), (255, 255, 255))  # white inside the board stays in
        self.assertEqual(render_board.crop_to_board(shot).size, (40, 20))


if __name__ == '__main__':
    unittest.main()
