// Stand-ins for the foobar2000 / JSplitter globals the Plinth scripts use, enough to load
// scripts/plinth.js in Node and drive it: a main window with a frame and size limits, panel
// properties, timers on a fake clock, and a graphics object that records what gets drawn.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const THEME = fileURLToPath(new URL('../scripts/', import.meta.url)).replace(/\\/g, '/');

export const FRAME = { Default: 0, NoCaption: 1 };
const BORDER = 8, CAPTION = 31; // the resizable frame's thickness, and the caption above it

// Text is half its font size wide per character, so widths are easy to work out in a test.
export const textWidth = (str, size) => Array.from(str).length * size * 0.5;

function graphics(log) {
	return {
		GdiDrawText: (str, f, colour, x, y, w, h) => log.push({ op: 'text', str, size: f.Size, colour, x, y, w, h }),
		CalcTextWidth: (str, f) => textWidth(str, f.Size),
		CalcTextHeight: (str, f) => f.Size * 1.25,
		FillSolidRect: (x, y, w, h, colour) => log.push({ op: 'rect', x, y, w, h, colour }),
		FillGradRect: (x, y, w, h) => log.push({ op: 'grad', x, y, w, h }),
		FillEllipse: (x, y, w, h) => log.push({ op: 'ellipse', x, y, w, h }),
		FillPolygon: () => log.push({ op: 'polygon' }),
		DrawImage: (img, x, y, w, h) => log.push({ op: 'image', x, y, w, h }),
		SetSmoothingMode() {},
	};
}

function image(w, h) {
	return {
		Width: w, Height: h,
		GetGraphics: () => graphics([]), ReleaseGraphics() {},
		Resize: (rw, rh) => image(rw, rh), Clone: (x, y, cw, ch) => image(cw, ch),
		StackBlur() {}, SaveAs() {},
	};
}

function fakeClock() {
	const timers = new Map();
	let now = 0, next = 1;
	return {
		now: () => now,
		add(fn, ms, repeat) {
			const id = next++;
			timers.set(id, { fn, at: now + ms, every: Math.max(1, ms), repeat });
			return id;
		},
		clear(id) { timers.delete(id); },
		// Runs every timer due in the next ms milliseconds, in order.
		advance(ms) {
			const end = now + ms;
			for (;;) {
				let id = null, due = null;
				for (const [k, t] of timers) if (t.at <= end && (!due || t.at < due.at)) [id, due] = [k, t];
				if (!due) break;
				now = due.at;
				if (due.repeat) due.at += due.every;
				else timers.delete(id);
				due.fn();
			}
			now = end;
		},
	};
}

// track: { title, artist, album, length } plays from the start; null leaves foobar2000 stopped and empty.
// powershell: whether the hidden PowerShell that drops the strip's resizable frame can run.
// chrome: the height of Columns UI's menu bar, toolbars and status bar, which sit outside the panel.
export function loadPlinth({ props = {}, track = null, powershell = true, rect = { x: 100, y: 80, w: 1280, h: 860 }, onTop = false, chrome = 0 } = {}) {
	const clock = fakeClock();
	let ctx = null;

	const win = {
		X: rect.x, Y: rect.y, Width: rect.w, Height: rect.h,
		MinWidth: 0, MaxWidth: 0, MinHeight: 0, MaxHeight: 0, MinSize: false, MaxSize: false,
		IsMaximized: false, thick: true, frame: FRAME.Default, moveStarts: 0,
		get FrameStyle() { return this.frame; },
		set FrameStyle(v) {
			this.frame = v;
			if (v === FRAME.Default) this.thick = true; // JSplitter restores the style it saved, frame included
			resize();
		},
		Move(x, y, w, h) {
			if (this.MinSize) [w, h] = [Math.max(w, this.MinWidth), Math.max(h, this.MinHeight)];
			if (this.MaxSize) [w, h] = [Math.min(w, this.MaxWidth), Math.min(h, this.MaxHeight)];
			this.place(x, y, w, h);
		},
		place(x, y, w, h) {
			Object.assign(this, { X: x, Y: y, Width: w, Height: h });
			resize();
		},
		MoveStart() { this.moveStarts++; },
		Restore() { this.IsMaximized = false; },
		Maximize() { this.IsMaximized = true; },
	};
	const border = () => (win.thick ? BORDER : 0);
	const caption = () => (win.frame === FRAME.Default ? CAPTION : 0);

	const panel = {
		ID: 7, DPI: 96, Width: 0, Height: 0,
		GetProperty(name, def) {
			if (name in props) return props[name];
			if (def === undefined) return null;
			props[name] = def;
			return def;
		},
		SetProperty(name, v) { props[name] = v; },
		Repaint() {}, RepaintRect() {}, SetCursor() {},
		SetTimeout: (fn, ms) => clock.add(fn, ms, false),
		SetInterval: (fn, ms) => clock.add(fn, ms, true),
		ClearTimeout: (id) => clock.clear(id),
		ClearInterval: (id) => clock.clear(id),
		GetPanel: () => null,
		Reload() {},
	};

	// The panel fills the window inside its frame and Columns UI's bars, never below 0, and hears about it at once.
	function resize() {
		panel.Width = Math.max(0, win.Width - border() * 2);
		panel.Height = Math.max(0, win.Height - caption() - border() * 2 - chrome);
		if (ctx && typeof ctx.on_size === 'function') ctx.on_size(panel.Width, panel.Height);
	}

	// What the hidden PowerShell does a moment after it starts: clear the resizable frame of a captionless
	// window and fit the window to its old client area, as far as the size limits allow.
	function dropFrame() {
		if (win.frame !== FRAME.NoCaption || !win.thick) return;
		const b = border();
		win.thick = false;
		win.Move(win.X + b, win.Y + b, win.Width - b * 2, win.Height - b * 2);
	}
	const runs = [];
	const utils = {
		CheckFont: () => true,
		GetAlbumArtAsyncV2: () => Promise.resolve(null),
		Run(cmd, args) {
			runs.push(args);
			if (!powershell) return { OK: false };
			clock.add(dropFrame, 300, false);
			return { OK: true };
		},
		WriteTextFile() {},
	};

	const handleOf = (t) => (t ? { track: t, Compare(h) { return h === this; } } : null);
	let handle = handleOf(track); // the playing track's; env.play changes it
	const field = (fmt) => {
		const t = handle && handle.track;
		if (!t) return '';
		if (fmt.includes('$directory_path')) return `dir|${t.album}`;
		if (fmt.includes('%title%')) return t.title;
		if (fmt.includes('%artist%')) return t.artist;
		if (fmt.includes('%album%')) return t.album;
		return '';
	};
	const menu = () => ({ AppendTo() {}, AppendMenuItem() {}, AppendMenuSeparator() {}, TrackPopupMenu: () => 0 });
	panel.CreatePopupMenu = menu;
	const fb = {
		Window: win, AlwaysOnTop: onTop,
		IsPlaying: !!track, IsPaused: false, PlaybackLength: track ? track.length : 0, PlaybackTime: 0, Volume: -10,
		GetNowPlaying: () => handle, GetFocusItem: () => handle,
		TitleFormat: (fmt) => ({ Eval: () => field(fmt), EvalWithMetadb: () => field(fmt) }),
		Prev() {}, Next() {}, PlayOrPause() {}, VolumeMute() {}, VolumeUp() {}, VolumeDown() {},
		CreateMainMenuManager: () => ({ Init() {}, BuildMenu() {}, ExecuteByID() {} }),
		CreateContextMenuManager: () => ({ InitNowPlaying() {}, InitContext() {}, BuildMenu() {}, ExecuteByID() {} }),
	};
	const plman = {
		PlaybackOrder: 0, PlaylistCount: 0,
		FindPlaylist: () => -1,
		GetPlaylistItems: () => ({ Count: 0, Find: () => -1 }),
	};
	class FbMetadbHandleList {
		constructor(h) { this.items = h ? [h] : []; }
		get Count() { return this.items.length; }
		Find(h) { return this.items.indexOf(h); }
	}
	const gdi = { Font: (name, size, style) => ({ Name: name, Size: size, Style: style }), CreateImage: image };
	const include = (path) => vm.runInContext(readFileSync(path, 'utf8'), ctx, { filename: path });

	ctx = vm.createContext({ window: panel, fb, gdi, utils, plman, FbMetadbHandleList, include, PLINTH_DIR: THEME, console, __now: clock.now });
	vm.runInContext('Date.now = () => __now();', ctx);
	resize();
	include(`${THEME}plinth.js`);
	ctx.on_size(panel.Width, panel.Height); // JSplitter sizes the panel once its script has loaded

	const js = (expr) => vm.runInContext(expr, ctx);
	const env = {
		win, panel, props, fb, runs, clock, js,
		get state() { return js('state'); },
		get L() { return js('L'); },
		call: (name, ...args) => ctx[name](...args),
		// Paints the panel and returns what was drawn.
		paint() {
			const log = [];
			ctx.on_paint(graphics(log));
			return log;
		},
		// Presses and releases the left button at (x, y), then lets timers due in the next settle ms run.
		clickAt(x, y, settle = 1000) {
			ctx.on_mouse_move(x, y);
			ctx.on_mouse_lbtn_down(x, y);
			ctx.on_mouse_lbtn_up(x, y);
			clock.advance(settle);
		},
		// Clicks the middle of a laid-out control, painting first so controls placed in paint exist.
		click(id, settle) {
			env.paint();
			const r = js('L')[id];
			if (!r) throw new Error(`no ${id} in the layout`);
			env.clickAt(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), settle);
		},
		// Starts playing t from the top, as foobar2000 reports a new track.
		play(t) {
			handle = handleOf(t);
			Object.assign(fb, { IsPlaying: true, PlaybackLength: t.length, PlaybackTime: 0 });
			ctx.on_playback_new_track(handle);
			clock.advance(1000);
		},
	};
	clock.advance(1000);
	return env;
}
