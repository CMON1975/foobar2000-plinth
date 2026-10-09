'use strict';
// Shared palette, fonts and drawing helpers for the Plinth theme.
// Used by plinth.js (JSplitter root) and playlist.js (Spider Monkey Panel); see tools/build_plinth.py.

const Plinth = (() => {
	// ---- colour ---------------------------------------------------------------------------
	const rgb = (r, g, b) => (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
	const hex = (s) => rgb(parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16));
	const withAlpha = (colour, a) => ((colour & 0x00ffffff) | (Math.round(a * 255) << 24)) >>> 0;

	// Soft dark grey. g = grounds (room → track), t = inks (bone, ash, dust).
	const SHADES = {
		deep: { g1: '#1B1B1B', g2: '#212121', g3: '#2A2A2A', g4: '#323232', g5: '#3E3E3E', t1: '#E8E6E2', t2: '#BDBBB6', t3: '#908E8A' },
		soft: { g1: '#212121', g2: '#272727', g3: '#303030', g4: '#383838', g5: '#444444', t1: '#E8E6E2', t2: '#BDBBB6', t3: '#989692' },
		light: { g1: '#272727', g2: '#2D2D2D', g3: '#363636', g4: '#3E3E3E', g5: '#4A4A4A', t1: '#ECEAE6', t2: '#C2C0BB', t3: '#A09E9A' },
	};
	const SHADE = 'soft';
	const palette = {};
	for (const [k, v] of Object.entries(SHADES[SHADE])) palette[k] = hex(v);
	palette.hover = withAlpha(0xffffff, 0.03);
	palette.shadow = 0xff000000;

	// ---- scale ----------------------------------------------------------------------------
	let dpi = 96;
	try {
		if (typeof window.DPI === 'number' && window.DPI > 0) dpi = window.DPI;
		else dpi = new ActiveXObject('WScript.Shell').RegRead('HKCU\\Control Panel\\Desktop\\WindowMetrics\\AppliedDPI');
	} catch (e) { /* keep 96 */ }
	const scale = dpi / 96;
	const px = (v) => Math.round(v * scale);

	// ---- fonts ----------------------------------------------------------------------------
	// Bahnschrift ships with Windows 10+; GDI exposes its weights as separate families.
	const pick = (...names) => names.find((n) => utils.CheckFont(n)) || 'Segoe UI';
	const family = {
		light: pick('Bahnschrift Light', 'Segoe UI Light'),
		regular: pick('Bahnschrift', 'Segoe UI'),
		icons: pick('lucide'),
	};
	const fontCache = {};
	const font = (kind, size, style = 0) => {
		const key = `${kind}|${size}|${style}`;
		return fontCache[key] || (fontCache[key] = gdi.Font(family[kind], px(size), style));
	};

	// ---- Lucide glyphs (codepoints from the installed lucide.ttf) -------------------------
	const icon = {
		menu: 0xe115, play: 0xe13c, pause: 0xe12e, prev: 0xe15f, next: 0xe160,
		shuffle: 0xe15e, repeat: 0xe146, repeatOne: 0xe1fd,
		volume: 0xe1a9, volumeLow: 0xe1aa, volumeHigh: 0xe1ab, volumeMute: 0xe1ac,
		playing: 0xe55a, chevronDown: 0xe06d, chevronRight: 0xe06f, close: 0xe1b2,
		search: 0xe151, music: 0xe122, plus: 0xe13d, pip: 0xe3af, star: 0xe176,
	};
	const glyph = (name) => String.fromCharCode(icon[name]);

	// Lucide's glyphs are outlines only. A fill is a polygon on the icon's 24-unit grid that runs along the
	// middle of the glyph's stroke, so the glyph drawn over it hides its edge. star: star.svg's path, flattened.
	const fills = {
		star: [
			11.53, 2.29, 11.81, 2.04, 12.19, 2.04, 12.47, 2.29, 14.79, 6.97, 15.44, 7.75, 16.38, 8.13, 21.55, 8.89, 21.88, 9.08,
			22, 9.44, 21.84, 9.79, 18.1, 13.43, 17.57, 14.3, 17.49, 15.31, 18.38, 20.45, 18.3, 20.83, 17.99, 21.05, 17.6, 21.01,
			12.99, 18.58, 12, 18.34, 11.01, 18.58, 6.4, 21.01, 6.01, 21.05, 5.7, 20.83, 5.63, 20.45, 6.51, 15.31, 6.43, 14.3,
			5.9, 13.43, 2.16, 9.79, 2, 9.44, 2.12, 9.08, 2.45, 8.89, 7.62, 8.13, 8.56, 7.75, 9.22, 6.97,
		],
	};

	// ---- text -----------------------------------------------------------------------------
	const DT = {
		LEFT: 0x0, CENTER: 0x1, RIGHT: 0x2, VCENTER: 0x4, WORDBREAK: 0x10, SINGLELINE: 0x20,
		NOCLIP: 0x100, CALCRECT: 0x400, NOPREFIX: 0x800, END_ELLIPSIS: 0x8000,
	};
	const LINE = DT.SINGLELINE | DT.VCENTER | DT.NOPREFIX | DT.END_ELLIPSIS;

	const text = (gr, str, f, colour, x, y, w, h, align = DT.LEFT) => gr.GdiDrawText(str, f, colour, x, y, w, h, LINE | align);
	const drawGlyph = (gr, name, size, colour, x, y, w, h) =>
		gr.GdiDrawText(glyph(name), font('icons', size), colour, x, y, w, h, DT.CENTER | DT.VCENTER | DT.SINGLELINE | DT.NOPREFIX);
	// The inside of a glyph from fills, placed where drawGlyph puts the glyph: its cell centred as DrawText centres
	// it. A glyph is one em wide, its em box is the 24-unit grid, and Lucide has no descent, so the cell's bottom
	// is the baseline the box stands on. GDI+ centres pixels on whole coordinates and GDI on halves, hence -0.5.
	const fillGlyph = (gr, name, size, colour, x, y, w, h) => {
		const f = font('icons', size), str = glyph(name);
		const em = gr.CalcTextWidth(str, f), cell = gr.CalcTextHeight(str, f);
		const left = x + Math.trunc((w - em) / 2), top = y + Math.trunc((h - cell) / 2) + cell - em, k = em / 24;
		gr.SetSmoothingMode(4);
		gr.FillPolygon(colour, 0, fills[name].map((v, i) => (i % 2 ? top : left) + v * k - 0.5));
		gr.SetSmoothingMode(0);
	};

	const formatTime = (s) => {
		s = Math.max(0, Math.floor(s));
		const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
		return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
	};
	const formatLength = (s) => {
		s = Math.round(s);
		const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
		return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
	};

	// ---- misc -----------------------------------------------------------------------------
	const IDC = { ARROW: 32512, HAND: 32649, IBEAM: 32513 };
	const VK = {
		BACK: 0x08, RETURN: 0x0d, SHIFT: 0x10, CONTROL: 0x11, ESCAPE: 0x1b, SPACE: 0x20, PRIOR: 0x21, NEXT: 0x22,
		END: 0x23, HOME: 0x24, LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, DELETE: 0x2e, A: 0x41, F5: 0x74,
	};
	const MK = { LBUTTON: 0x1, RBUTTON: 0x2, SHIFT: 0x4, CONTROL: 0x8 };
	const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
	const inRect = (x, y, r) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

	// Debug logging for the isolated test harness; off unless the panel property is set.
	const debugDir = window.GetProperty('Plinth.DebugDir') || '';
	const log = (name, lines) => {
		if (!debugDir) return;
		try { utils.WriteTextFile(`${debugDir}/${name}`, [].concat(lines).join('\r\n')); } catch (e) { /* ignore */ }
	};

	return { rgb, hex, withAlpha, palette, scale, px, font, family, glyph, icon, DT, text, drawGlyph, fillGlyph, formatTime, formatLength, IDC, VK, MK, clamp, inRect, debugDir, log };
})();
