'use strict';
// Plinth — root JSplitter script.
// Draws the centre "plinth" (album art, track info, seek bar, transport) and the top chrome,
// and shows the child panels (Library, Playlist, Lyrics, About) as drawers. The miniplayer
// toggle turns the main window into a small borderless strip pinned on top.
// tools/build_plinth.py inlines lib/common.js in place of the include below; in --dev builds the
// panel's stub script defines PLINTH_DIR and includes this file from the checkout.

include(`${PLINTH_DIR}lib/common.js`);

const { palette: C, px, font, text, drawGlyph, DT, clamp, inRect, withAlpha } = Plinth;

const DRAWERS = {
	library: { caption: 'Library', side: 'left', width: 520 },
	playlist: { caption: 'Playlist', side: 'right', width: 680, label: 'Playlist' },
	lyrics: { caption: 'Lyrics', side: 'right', width: 680, label: 'Lyrics' },
	about: { caption: 'About', side: 'right', width: 680, label: 'About' },
};
const RIGHT_VIEWS = ['playlist', 'lyrics', 'about'];

// Miniplayer window (design board "Mini · 120", margins half again): art fills the left square, and
// title, artist, album, seek line and controls stack on the right, 27px in from either side with 19px
// above and below.
const MINI = { w: 471, h: 133, padX: 27 };

// Type and glyph sizes per mode. title lists the sizes tried, largest first, until the title fits.
const SIZES = {
	full: { title: [36, 31, 27], empty: 30, artist: 20, album: 16, time: 14, align: DT.CENTER, side: 19, skip: 22, play: 30, knob: 10, noArt: 40 },
	mini: { title: [15], empty: 15, artist: 12, album: 11, time: 11, align: DT.LEFT, side: 14, skip: 15, play: 18, knob: 8, noArt: 32 },
};

const state = {
	view: window.GetProperty('Plinth.View', ''),
	library: window.GetProperty('Plinth.Library', false),
	mini: window.GetProperty('Plinth.Mini', false),
	w: 0,
	h: 0,
	hover: null,
	pressed: null,
	seek: null, // fraction while dragging the seek bar
	volDrag: false,
};
if (!RIGHT_VIEWS.includes(state.view)) state.view = '';

let L = {}; // layout rects, rebuilt on resize / drawer change

// ---- track info --------------------------------------------------------------------------
const TF = {
	title: fb.TitleFormat('$if2(%title%,%filename%)'),
	artist: fb.TitleFormat('[%artist%]'),
	album: fb.TitleFormat('[%album%]$if($and(%album%,%date%), \u00b7 ,)[$left(%date%,4)]'),
	artKey: fb.TitleFormat('$directory_path(%path%)|%album%'),
};
const info = { handle: null, title: '', artist: '', album: '', playing: false };

function refreshInfo() {
	const playing = fb.IsPlaying;
	const handle = playing ? fb.GetNowPlaying() : fb.GetFocusItem();
	info.handle = handle;
	info.playing = playing;
	if (playing) {
		info.title = TF.title.Eval();
		info.artist = TF.artist.Eval();
		info.album = TF.album.Eval();
	} else if (handle) {
		info.title = TF.title.EvalWithMetadb(handle);
		info.artist = TF.artist.EvalWithMetadb(handle);
		info.album = TF.album.EvalWithMetadb(handle);
	} else {
		info.title = info.artist = info.album = '';
	}
	loadArt(handle);
	if (state.mini) layout(); // the time slots are sized from the track length
	window.Repaint();
}

// ---- album art ---------------------------------------------------------------------------
const art = { key: null, img: null, scaled: null, scaledFor: '', shadow: null, shadowFor: '' };

function loadArt(handle) {
	const key = handle ? TF.artKey.EvalWithMetadb(handle) : null;
	if (key === art.key) return;
	art.key = key;
	art.img = art.scaled = null;
	art.scaledFor = '';
	if (!handle) return;
	utils.GetAlbumArtAsyncV2(window.ID, handle, 0)
		.then((result) => {
			if (art.key !== key) return;
			art.img = result && result.image ? result.image : null;
			window.Repaint();
		})
		.catch(() => {});
}

function artFit(box) {
	if (!art.img) return null;
	const r = Math.min(box.w / art.img.Width, box.h / art.img.Height);
	const w = Math.round(art.img.Width * r), h = Math.round(art.img.Height * r);
	return { x: box.x + Math.round((box.w - w) / 2), y: box.y + Math.round((box.h - h) / 2), w, h };
}

function scaledArt(fit) {
	const tag = `${fit.w}x${fit.h}`;
	if (art.scaledFor !== tag) {
		art.scaled = art.img.Resize(fit.w, fit.h, 7);
		art.scaledFor = tag;
	}
	return art.scaled;
}

// The art scaled to fill box, centre-cropped to its aspect (CSS object-fit: cover).
function coverArt(box) {
	const tag = `cover:${box.w}x${box.h}`;
	if (art.scaledFor !== tag) {
		const iw = art.img.Width, ih = art.img.Height;
		const k = Math.min(iw / box.w, ih / box.h);
		const sw = Math.round(box.w * k), sh = Math.round(box.h * k);
		const crop = art.img.Clone(Math.floor((iw - sw) / 2), Math.floor((ih - sh) / 2), sw, sh);
		art.scaled = crop.Resize(box.w, box.h, 7);
		art.scaledFor = tag;
	}
	return art.scaled;
}

function artShadow(w, h) {
	const tag = `${w}x${h}`;
	if (art.shadowFor !== tag) {
		const r = px(28);
		const img = gdi.CreateImage(w + r * 2, h + r * 2);
		const g = img.GetGraphics();
		g.FillSolidRect(r, r, w, h, 0xff000000);
		img.ReleaseGraphics(g);
		img.StackBlur(r);
		art.shadow = { img, r };
		art.shadowFor = tag;
	}
	return art.shadow;
}

// ---- layout ------------------------------------------------------------------------------
function drawerWidth(name) {
	const d = DRAWERS[name];
	return Math.min(px(d.width), Math.floor(state.w * (d.side === 'left' ? 0.42 : 0.5)));
}

function layout() {
	if (state.mini) {
		layoutMini();
		return;
	}
	const { w, h } = state;
	const chromeH = px(80);
	const libW = state.library ? drawerWidth('library') : 0;
	const rightW = state.view ? drawerWidth(state.view) : 0;
	const x0 = libW, x1 = w - rightW, regionW = Math.max(0, x1 - x0);

	// stack below the art: title, artist, album, seek, times, controls
	const below = px(40) + px(44) + px(6) + px(26) + px(4) + px(22) + px(36) + px(2) + px(8) + px(20) + px(10) + px(56);
	const availH = h - chromeH - px(24) - below - px(40);
	const A = Math.max(px(120), Math.min(px(560), regionW - px(112), availH));
	const colW = Math.max(A, Math.min(regionW - px(64), px(400)));
	const colX = x0 + Math.round((regionW - colW) / 2);
	const stackH = A + below;
	const y0 = chromeH + Math.max(0, Math.round((h - chromeH - px(40) - stackH) / 2));

	const r = (x, y, ww, hh) => ({ x, y, w: ww, h: hh });
	L = { chromeH, libW, rightW, colX, colW };
	L.art = r(colX + Math.round((colW - A) / 2), y0, A, A);
	L.title = r(colX, L.art.y + A + px(40), colW, px(44));
	L.artist = r(colX, L.title.y + px(44) + px(6), colW, px(26));
	L.album = r(colX, L.artist.y + px(26) + px(4), colW, px(22));
	L.info = r(colX, L.art.y, colW, L.album.y + L.album.h - L.art.y);
	const seekY = L.album.y + px(22) + px(36);
	L.seekBar = r(colX, seekY, colW, px(2));
	L.seek = r(colX, seekY - px(9), colW, px(20));
	L.times = r(colX, seekY + px(10), colW, px(20));
	L.timeL = L.timeR = L.times;
	L.seekArea = r(colX - px(8), seekY - px(10), colW + px(16), px(42));

	const cy = L.times.y + px(20) + px(10);
	const b = (x, size) => r(x, cy + Math.round((px(56) - size) / 2), size, size);
	const btn = px(44), big = px(56), gap = px(16);
	const centreW = btn * 2 + big + gap * 2;
	const cx = colX + Math.round((colW - centreW) / 2);
	L.prev = b(cx, btn);
	L.play = b(cx + btn + gap, big);
	L.next = b(cx + btn + gap + big + gap, btn);
	L.shuffle = b(colX - px(12), btn);
	L.repeat = b(colX - px(12) + btn, btn);
	L.mini = b(colX - px(12) + btn * 2, btn);
	L.volBar = r(colX + colW - px(72), cy + px(28) - px(8), px(72), px(16));
	L.volIcon = b(L.volBar.x - px(4) - btn, btn);

	// chrome
	L.menu = r(px(20), px(24), btn, btn);
	L.libToggle = r(L.menu.x + btn + px(8), px(24), px(80), btn); // width fixed up in paint
	L.libClose = state.library ? r(libW - px(68), px(24), btn, btn) : null;
	L.viewClose = state.view ? r(w - px(20) - btn, px(24), btn, btn) : null;
	L.tabs = []; // computed in paint (needs text widths)

	L.drawers = {
		library: r(0, chromeH, libW || drawerWidth('library'), Math.max(0, h - chromeH)),
		right: r(w - (rightW || px(680)), chromeH, rightW || px(680), Math.max(0, h - chromeH)),
	};
}

const measureImg = gdi.CreateImage(1, 1);
function textWidth(str, f) {
	const g = measureImg.GetGraphics();
	const tw = g.CalcTextWidth(str, f);
	measureImg.ReleaseGraphics(g);
	return Math.ceil(tw);
}

function layoutMini() {
	const { w, h } = state;
	const S = SIZES.mini;
	const r = (x, y, ww, hh) => ({ x, y, w: ww, h: hh });
	const colX = h + px(MINI.padX), colW = Math.max(0, w - colX - px(MINI.padX));

	// rows: title 18, artist 15, album 14, gap 6, seek 12, controls 30
	const rowH = px(12), ctlH = px(30);
	const stackH = px(18) + px(15) + px(14) + px(6) + rowH + ctlH;
	L = { colX, colW, tabs: [] };
	L.art = r(0, 0, h, h);
	L.info = r(0, 0, w, h);
	L.title = r(colX, Math.round((h - stackH) / 2), colW, px(18));
	L.artist = r(colX, L.title.y + px(18), colW, px(15));
	L.album = r(colX, L.artist.y + px(15), colW, px(14));

	// Times flank the seek line. Their slots fit the track length, so the line stays put as they tick.
	const seekY = L.album.y + px(14) + px(6);
	const zeros = Plinth.formatTime(fb.IsPlaying ? fb.PlaybackLength : 0).replace(/\d/g, '0');
	const f = font('regular', S.time);
	const slotL = textWidth(zeros, f), slotR = textWidth(`\u2212${zeros}`, f);
	L.timeL = r(colX, seekY, slotL, rowH);
	L.timeR = r(colX + colW - slotR, seekY, slotR, rowH);
	const barX = colX + slotL + px(10);
	L.seekBar = r(barX, seekY + Math.round(rowH / 2) - px(1), Math.max(0, L.timeR.x - px(10) - barX), px(2));
	L.seek = r(barX - px(4), seekY - px(3), L.seekBar.w + px(8), rowH + px(6));
	L.seekArea = r(colX - px(2), seekY - px(6), colW + px(4), rowH + px(12));

	// controls: shuffle, repeat, miniplayer | prev, play, next | volume
	const cy = seekY + rowH;
	const b = (x, size) => r(x, cy + Math.round((ctlH - size) / 2), size, size);
	const btn = px(28), big = px(30), gap = px(2);
	const nudge = Math.round((btn - px(S.side)) / 2); // first glyph lines up with the text edge
	L.shuffle = b(colX - nudge, btn);
	L.repeat = b(colX - nudge + btn, btn);
	L.mini = b(colX - nudge + btn * 2, btn);
	const cx = colX + Math.round((colW - (btn * 2 + big + gap * 2)) / 2);
	L.prev = b(cx, btn);
	L.play = b(cx + btn + gap, big);
	L.next = b(cx + btn + gap + big + gap, btn);
	L.volBar = r(colX + colW - px(44), cy + Math.round(ctlH / 2) - px(8), px(44), px(16));
	L.volIcon = b(L.volBar.x - px(5) - px(S.side) - nudge, btn);
}

// ---- child panels ------------------------------------------------------------------------
const panelCache = {};
function panel(name) {
	if (!panelCache[name]) {
		try { panelCache[name] = window.GetPanel(DRAWERS[name].caption) || null; } catch (e) { panelCache[name] = null; }
	}
	return panelCache[name];
}

function applyPanels() {
	for (const name of Object.keys(DRAWERS)) {
		const p = panel(name);
		if (!p) continue;
		const show = !state.mini && (name === 'library' ? state.library : state.view === name);
		if (show) {
			const rc = name === 'library' ? L.drawers.library : L.drawers.right;
			p.Move(rc.x, rc.y, rc.w, rc.h);
		}
		if (p.Hidden === show) p.Show(show);
	}
}

function setView(view) {
	state.view = view;
	window.SetProperty('Plinth.View', view);
	layout();
	applyPanels();
	window.Repaint();
}

function toggleLibrary() {
	state.library = !state.library;
	window.SetProperty('Plinth.Library', state.library);
	layout();
	applyPanels();
	window.Repaint();
}

// ---- volume / order helpers --------------------------------------------------------------
const volToPos = (db) => (db <= -100 ? 0 : Math.pow(10, db / 50));
const posToVol = (p) => (p <= 0.01 ? -100 : 50 * Math.log10(p));
const isShuffle = () => [3, 4, 5, 6].includes(plman.PlaybackOrder);

// ---- painting ----------------------------------------------------------------------------
const sizes = () => (state.mini ? SIZES.mini : SIZES.full);

function brighter(colour) {
	return colour === C.t3 ? C.t2 : colour === C.t2 ? C.t1 : colour;
}

function button(gr, id, name, size, colour) {
	const rc = L[id];
	drawGlyph(gr, name, size, state.hover === id ? brighter(colour) : colour, rc.x, rc.y, rc.w, rc.h);
}

function paintDrawerFrames(gr) {
	const shadow = withAlpha(C.shadow, 0.28), clear = withAlpha(C.shadow, 0);
	if (state.library) {
		gr.FillSolidRect(0, 0, L.libW, state.h, C.g2);
		gr.FillGradRect(L.libW, 0, px(48), state.h, 0, shadow, clear);
	}
	if (state.view) {
		const x = state.w - L.rightW;
		gr.FillSolidRect(x, 0, L.rightW, state.h, C.g2);
		gr.FillGradRect(x - px(48), 0, px(48), state.h, 0, clear, shadow);
	}
}

function paintArt(gr) {
	const box = L.art;
	const fit = artFit(box);
	if (!fit) {
		gr.FillSolidRect(box.x, box.y, box.w, box.h, C.g3);
		drawGlyph(gr, 'music', sizes().noArt, C.t3, box.x, box.y, box.w, box.h);
		return;
	}
	if (state.mini) { // flush to the window edges, no shadow
		const img = coverArt(box);
		gr.DrawImage(img, box.x, box.y, box.w, box.h, 0, 0, img.Width, img.Height);
		return;
	}
	const sh = artShadow(fit.w, fit.h);
	gr.DrawImage(sh.img, fit.x - sh.r, fit.y - sh.r + px(18), sh.img.Width, sh.img.Height, 0, 0, sh.img.Width, sh.img.Height, 0, 82);
	const img = scaledArt(fit);
	gr.DrawImage(img, fit.x, fit.y, fit.w, fit.h, 0, 0, img.Width, img.Height);
}

function paintInfo(gr) {
	const S = sizes();
	if (!info.handle) {
		text(gr, 'Nothing playing', font('light', S.empty), C.t3, L.title.x, L.title.y, L.title.w, L.title.h, S.align);
		return;
	}
	let titleFont;
	for (const size of S.title) {
		titleFont = font('light', size);
		if (gr.CalcTextWidth(info.title, titleFont) <= L.title.w) break;
	}
	text(gr, info.title, titleFont, C.t1, L.title.x, L.title.y, L.title.w, L.title.h, S.align);
	text(gr, info.artist, font('regular', S.artist), C.t2, L.artist.x, L.artist.y, L.artist.w, L.artist.h, S.align);
	text(gr, info.album, font('regular', S.album), C.t3, L.album.x, L.album.y, L.album.w, L.album.h, S.align);
}

function paintSeek(gr) {
	const S = sizes();
	const bar = L.seekBar;
	const len = fb.PlaybackLength;
	const t = state.seek !== null ? state.seek * len : fb.PlaybackTime;
	const frac = len > 0 ? clamp(t / len, 0, 1) : 0;
	gr.FillSolidRect(bar.x, bar.y, bar.w, bar.h, C.g5);
	if (fb.IsPlaying) gr.FillSolidRect(bar.x, bar.y, Math.round(bar.w * frac), bar.h, C.t2);
	if (fb.IsPlaying && len > 0 && (state.hover === 'seek' || state.seek !== null)) {
		const k = px(S.knob);
		gr.SetSmoothingMode(4);
		gr.FillEllipse(bar.x + Math.round(bar.w * frac) - k / 2, bar.y + bar.h / 2 - k / 2, k, k, C.t1);
		gr.SetSmoothingMode(0);
	}
	const f = font('regular', S.time);
	if (fb.IsPlaying) {
		text(gr, Plinth.formatTime(t), f, C.t3, L.timeL.x, L.timeL.y, L.timeL.w, L.timeL.h, DT.LEFT);
		if (len > 0) text(gr, `\u2212${Plinth.formatTime(len - t)}`, f, C.t3, L.timeR.x, L.timeR.y, L.timeR.w, L.timeR.h, DT.RIGHT);
	}
}

function paintControls(gr) {
	const S = sizes();
	const order = plman.PlaybackOrder;
	button(gr, 'shuffle', 'shuffle', S.side, isShuffle() ? C.t1 : C.t3);
	button(gr, 'repeat', order === 2 ? 'repeatOne' : 'repeat', S.side, order === 1 || order === 2 ? C.t1 : C.t3);
	button(gr, 'mini', 'pip', S.side, state.mini ? C.t1 : C.t3);
	button(gr, 'prev', 'prev', S.skip, C.t2);
	button(gr, 'play', fb.IsPlaying && !fb.IsPaused ? 'pause' : 'play', S.play, C.t1);
	button(gr, 'next', 'next', S.skip, C.t2);

	const vol = fb.Volume;
	const name = vol <= -100 ? 'volumeMute' : vol < -12 ? 'volume' : vol < -4 ? 'volumeLow' : 'volumeHigh';
	button(gr, 'volIcon', name, S.side, C.t3);
	const vb = L.volBar, y = vb.y + Math.round(vb.h / 2) - 1;
	const pos = volToPos(vol);
	const active = state.hover === 'volBar' || state.hover === 'volIcon' || state.volDrag;
	gr.FillSolidRect(vb.x, y, vb.w, px(2), C.g5);
	gr.FillSolidRect(vb.x, y, Math.round(vb.w * pos), px(2), active ? C.t2 : C.t3);
}

function paintChrome(gr) {
	button(gr, 'menu', 'menu', 22, C.t3);

	const f = font('regular', 17);
	const lib = L.libToggle;
	lib.w = Math.ceil(gr.CalcTextWidth('Library', f)) + px(8);
	const libColour = state.library ? C.t1 : state.hover === 'libToggle' ? C.t2 : C.t3;
	text(gr, 'Library', f, libColour, lib.x + px(4), lib.y, lib.w, lib.h);
	if (L.libClose) button(gr, 'libClose', 'close', 19, C.t3);

	let right = L.viewClose ? L.viewClose.x - px(16) : state.w - px(32);
	L.tabs = [];
	for (const view of RIGHT_VIEWS.slice().reverse()) {
		const label = DRAWERS[view].label;
		const tw = Math.ceil(gr.CalcTextWidth(label, f)) + px(8);
		const rc = { x: right - tw, y: px(24), w: tw, h: px(44), view };
		L.tabs.push(rc);
		const colour = state.view === view ? C.t1 : state.hover === `tab:${view}` ? C.t2 : C.t3;
		text(gr, label, f, colour, rc.x + px(4), rc.y, rc.w, rc.h);
		right = rc.x - px(20);
	}
	if (L.viewClose) button(gr, 'viewClose', 'close', 19, C.t3);
}

function paint(gr) {
	gr.FillSolidRect(0, 0, state.w, state.h, C.g1);
	if (!state.mini) paintDrawerFrames(gr);
	paintArt(gr);
	paintInfo(gr);
	paintSeek(gr);
	paintControls(gr);
	if (!state.mini) paintChrome(gr);
}

// ---- miniplayer window -------------------------------------------------------------------
// JSplitter's fb.Window turns the main window borderless and locks it to the mini size;
// fb.AlwaysOnTop pins it. The full window's rect and pin state are kept in panel properties.
const FRAME = { Default: 0, NoBorder: 2 }; // JSplitter's FrameStyle flags, documented but not predefined
const readNumbers = (name) => String(window.GetProperty(name, '')).split(',').map(Number).filter(Number.isFinite);

function lockWindowSize(w, h) { // no arguments unlocks
	const win = fb.Window;
	if (w) {
		win.MinWidth = win.MaxWidth = w;
		win.MinHeight = win.MaxHeight = h;
	}
	win.MinSize = !!w;
	win.MaxSize = !!w;
}

// Size the borderless window so this panel gets exactly MINI. Any menu bar, toolbars or status bar
// Columns UI shows sit outside the panel, and toolbars wrap at this width, so measure after a first move.
function fitMiniWindow(x, y) {
	const win = fb.Window;
	lockWindowSize();
	win.Move(x, y, px(MINI.w), px(MINI.h));
	const w = px(MINI.w) + win.Width - window.Width, h = px(MINI.h) + win.Height - window.Height;
	if (w !== win.Width || h !== win.Height) win.Move(x, y, w, h);
	lockWindowSize(w, h);
}

function setMini(on) {
	state.mini = on;
	window.SetProperty('Plinth.Mini', on);
	state.hover = state.pressed = state.seek = null;
	state.volDrag = false;
	layout();
	applyPanels();
	window.Repaint();
}

function toggleMini() {
	const win = fb.Window;
	if (!state.mini) {
		window.SetProperty('Plinth.FullRect', [win.X, win.Y, win.Width, win.Height].join(','));
		window.SetProperty('Plinth.FullOnTop', fb.AlwaysOnTop);
		const pos = readNumbers('Plinth.MiniPos'); // where the miniplayer was last left
		const [x, y] = pos.length === 2 ? pos : [win.X, win.Y];
		setMini(true);
		win.FrameStyle = FRAME.NoBorder;
		fitMiniWindow(x, y);
		fb.AlwaysOnTop = true;
	} else {
		window.SetProperty('Plinth.MiniPos', [win.X, win.Y].join(','));
		const full = readNumbers('Plinth.FullRect');
		setMini(false);
		lockWindowSize();
		win.FrameStyle = FRAME.Default;
		if (full.length === 4 && full[2] > 0 && full[3] > 0) win.Move(full[0], full[1], full[2], full[3]);
		else win.Move(win.X, win.Y, px(1280), px(860));
		fb.AlwaysOnTop = window.GetProperty('Plinth.FullOnTop', false);
	}
}

// ---- interaction -------------------------------------------------------------------------
const CLICKABLE = ['menu', 'libToggle', 'libClose', 'viewClose', 'shuffle', 'repeat', 'mini', 'prev', 'play', 'next', 'volIcon', 'volBar', 'seek'];

function hitTest(x, y) {
	for (const id of CLICKABLE) {
		if (id === 'seek' && !(fb.IsPlaying && fb.PlaybackLength > 0)) continue;
		if (inRect(x, y, L[id])) return id;
	}
	for (const tab of L.tabs || []) if (inRect(x, y, tab)) return `tab:${tab.view}`;
	if (info.handle && inRect(x, y, L.info)) return 'info';
	return null;
}

function seekFraction(x) {
	return clamp((x - L.seekBar.x) / L.seekBar.w, 0, 1);
}

function setVolumeFromX(x) {
	fb.Volume = posToVol(clamp((x - L.volBar.x) / L.volBar.w, 0, 1));
}

function activate(id, x, y) {
	if (id === 'menu') showMainMenu(L.menu.x, L.menu.y + L.menu.h);
	else if (id === 'libToggle' || id === 'libClose') toggleLibrary();
	else if (id === 'viewClose') setView('');
	else if (id.startsWith('tab:')) {
		const view = id.slice(4);
		setView(state.view === view ? '' : view);
	} else if (id === 'shuffle') plman.PlaybackOrder = isShuffle() ? 0 : 4;
	else if (id === 'repeat') {
		const order = plman.PlaybackOrder;
		plman.PlaybackOrder = order === 1 ? 2 : order === 2 ? 0 : 1;
	} else if (id === 'mini') toggleMini();
	else if (id === 'prev') fb.Prev();
	else if (id === 'play') fb.PlayOrPause();
	else if (id === 'next') fb.Next();
	else if (id === 'volIcon') fb.VolumeMute();
}

function showMainMenu(x, y) {
	const menu = window.CreatePopupMenu();
	const groups = ['File', 'Edit', 'View', 'Playback', 'Library', 'Help'];
	const managers = groups.map((name, i) => {
		const sub = window.CreatePopupMenu();
		const mm = fb.CreateMainMenuManager();
		mm.Init(name);
		mm.BuildMenu(sub, (i + 1) * 1000, 1000);
		sub.AppendTo(menu, 0, name);
		return mm;
	});
	menu.AppendMenuSeparator();
	menu.AppendMenuItem(0, 1, 'Reload theme');
	const id = menu.TrackPopupMenu(x, y);
	if (id === 1) window.Reload();
	else if (id >= 1000) {
		const i = Math.floor(id / 1000) - 1;
		managers[i].ExecuteByID(id - (i + 1) * 1000);
	}
}

function showTrackMenu(x, y) {
	const menu = window.CreatePopupMenu();
	const cm = fb.CreateContextMenuManager();
	if (info.playing) cm.InitNowPlaying();
	else cm.InitContext(new FbMetadbHandleList(info.handle));
	cm.BuildMenu(menu, 1);
	const id = menu.TrackPopupMenu(x, y);
	if (id > 0) cm.ExecuteByID(id - 1);
}

function setHover(id) {
	window.SetCursor(id && id !== 'info' ? Plinth.IDC.HAND : Plinth.IDC.ARROW);
	if (state.hover === id) return;
	state.hover = id;
	window.Repaint();
}

function on_mouse_move(x, y) {
	if (state.seek !== null) {
		state.seek = seekFraction(x);
		window.RepaintRect(L.seekArea.x, L.seekArea.y, L.seekArea.w, L.seekArea.h);
		return;
	}
	if (state.volDrag) {
		setVolumeFromX(x);
		return;
	}
	setHover(hitTest(x, y));
}

function on_mouse_lbtn_down(x, y) {
	const id = hitTest(x, y);
	if (state.mini && (id === null || id === 'info')) { // the borderless miniplayer drags by its art and text
		fb.Window.MoveStart();
		return;
	}
	state.pressed = id;
	if (id === 'seek') {
		state.seek = seekFraction(x);
		window.Repaint();
	} else if (id === 'volBar') {
		state.volDrag = true;
		setVolumeFromX(x);
	}
}

function on_mouse_lbtn_dblclk(x, y) {
	on_mouse_lbtn_down(x, y);
}

function on_mouse_lbtn_up(x, y) {
	if (state.seek !== null) {
		if (fb.IsPlaying && fb.PlaybackLength > 0) fb.PlaybackTime = state.seek * fb.PlaybackLength;
		state.seek = null;
		window.Repaint();
	} else if (state.volDrag) {
		state.volDrag = false;
		window.Repaint();
	} else if (state.pressed && state.pressed !== 'info' && state.pressed === hitTest(x, y)) {
		activate(state.pressed, x, y);
	}
	state.pressed = null;
}

function on_mouse_rbtn_up(x, y) {
	if (info.handle && inRect(x, y, L.info)) {
		showTrackMenu(x, y);
		return true;
	}
	return false;
}

function on_mouse_wheel(step) {
	if (state.hover === 'volBar' || state.hover === 'volIcon') {
		if (step > 0) fb.VolumeUp();
		else fb.VolumeDown();
	}
}

function on_mouse_leave() {
	setHover(null);
}

// ---- callbacks ---------------------------------------------------------------------------
function on_size(w, h) {
	state.w = w;
	state.h = h;
	if (w <= 0 || h <= 0) return;
	layout();
	applyPanels();
}

function on_paint(gr) {
	if (state.w > 0 && state.h > 0) paint(gr);
}

function on_playback_new_track() { refreshInfo(); }
function on_playback_dynamic_info_track() { refreshInfo(); }
function on_playback_stop(reason) { if (reason !== 2) refreshInfo(); }
function on_playback_pause() { window.Repaint(); }
function on_playback_seek() { window.RepaintRect(L.seekArea.x, L.seekArea.y, L.seekArea.w, L.seekArea.h); }
function on_playback_time() {
	if (state.seek === null) window.RepaintRect(L.seekArea.x, L.seekArea.y, L.seekArea.w, L.seekArea.h);
}
function on_playback_order_changed() { window.Repaint(); }
function on_volume_change() { window.Repaint(); }
function on_item_focus_change() { if (!fb.IsPlaying) refreshInfo(); }
function on_playlist_switch() { if (!fb.IsPlaying) refreshInfo(); }
function on_metadb_changed(handles) {
	if (info.handle && handles.Find(info.handle) >= 0) refreshInfo();
}

// ---- debug (isolated test harness only) --------------------------------------------------
function debugSnapshot(name) {
	const img = gdi.CreateImage(state.w, state.h);
	const g = img.GetGraphics();
	paint(g);
	img.ReleaseGraphics(g);
	img.SaveAs(`${Plinth.debugDir}/plinth_${name}.png`);
}

function debugRun() {
	const report = [`size ${state.w}x${state.h} scale ${Plinth.scale}`, `fonts ${JSON.stringify(Plinth.family)}`];
	for (const name of Object.keys(DRAWERS)) report.push(`panel ${name}: ${panel(name) ? 'found' : 'MISSING'}`);
	report.push(`info ${JSON.stringify({ title: info.title, artist: info.artist, album: info.album, playing: info.playing, art: !!art.img })}`);
	const scenes = [['closed', false, ''], ['library', true, ''], ['playlist', false, 'playlist'], ['lyrics', false, 'lyrics'], ['about', false, 'about'], ['library_lyrics', true, 'lyrics']];
	for (const [name, lib, view] of scenes) {
		state.library = lib;
		state.view = view;
		layout();
		debugSnapshot(name);
		report.push(`scene ${name}: art ${JSON.stringify(L.art)} libW ${L.libW} rightW ${L.rightW}`);
	}
	try {
		const menu = window.CreatePopupMenu();
		['File', 'Edit', 'View', 'Playback', 'Library', 'Help'].forEach((name, i) => {
			const sub = window.CreatePopupMenu();
			const mm = fb.CreateMainMenuManager();
			mm.Init(name);
			mm.BuildMenu(sub, (i + 1) * 1000, 1000);
			sub.AppendTo(menu, 0, name);
		});
		const cm = fb.CreateContextMenuManager();
		cm.InitNowPlaying();
		cm.BuildMenu(window.CreatePopupMenu(), 1);
		report.push('menus: ok');
	} catch (e) {
		report.push(`menus: ERROR ${e.message}`);
	}
	state.library = window.GetProperty('Plinth.Library', false);
	state.view = window.GetProperty('Plinth.View', '');
	layout();
	applyPanels();
	window.Repaint();

	// Miniplayer round trip, holding the other mode for a few seconds so the native window can be inspected.
	const win = fb.Window;
	const describe = () => report.push(`${state.mini ? 'mini' : 'full'}: window ${win.X},${win.Y} ${win.Width}x${win.Height} panel ${window.Width}x${window.Height} frame ${win.FrameStyle} onTop ${fb.AlwaysOnTop}`);
	describe();
	try {
		toggleMini();
	} catch (e) {
		report.push(`toggle: ERROR ${e.message}`);
		Plinth.log('plinth_report.txt', report);
		return;
	}
	describe();
	window.SetTimeout(() => {
		if (state.mini) report.push(`mini layout: ${JSON.stringify({ title: L.title, album: L.album, seekBar: L.seekBar, timeL: L.timeL, timeR: L.timeR, mini: L.mini, play: L.play, volBar: L.volBar })}`);
		debugSnapshot(state.mini ? 'mini' : 'full');
		Plinth.log('plinth_report.txt', report);
		window.SetTimeout(() => {
			toggleMini();
			describe();
			Plinth.log('plinth_report.txt', report);
		}, 8000);
	}, 1000);
}

if (Plinth.debugDir) fb.Volume = -100; // test harness: never make sound
if (state.mini) { // reloaded or restarted in mini mode: the window keeps its place, but not its frame or limits
	fb.Window.FrameStyle = FRAME.NoBorder;
	window.SetTimeout(() => fitMiniWindow(fb.Window.X, fb.Window.Y), 0);
}
refreshInfo();
if (Plinth.debugDir) window.SetTimeout(debugRun, 2500);
