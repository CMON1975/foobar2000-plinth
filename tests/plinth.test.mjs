import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlinth, FRAME, textWidth } from './foobar.mjs';

const TRACK = { title: 'Strobe', artist: 'deadmau5', album: 'For Lack of a Better Name · 2009', length: 637 };
// Too long for the bar, which then stays at its widest, 560.
const LONG = { ...TRACK, title: 'Some Chords (Dillon Francis Remix) [Extended Club Mix] featuring Somebody Else Entirely' };

const panelSize = (env) => [env.panel.Width, env.panel.Height];
const lockedAt = (env) => {
	const { win } = env;
	return win.MinSize && win.MaxSize && win.MinWidth === win.Width && win.MaxWidth === win.Width
		&& win.MinHeight === win.Height && win.MaxHeight === win.Height;
};

test('the miniplayer button in the full window opens the 459x139 mini, captionless, locked and on top', () => {
	const env = loadPlinth({ track: TRACK });
	env.click('mini');
	assert.equal(env.state.mini, true);
	assert.deepEqual(panelSize(env), [459, 139]);
	assert.equal(env.win.FrameStyle, FRAME.NoCaption);
	assert.equal(env.win.thick, false, 'the resizable frame is dropped');
	assert.deepEqual([env.win.X, env.win.Y], [100, 80], 'opens where the window was');
	assert.ok(lockedAt(env), 'size locked');
	assert.equal(env.fb.AlwaysOnTop, true);
});

// ---- the bar: one row, a third press of the miniplayer button -------------------------------
const toBar = (env) => {
	env.click('mini');
	env.click('mini');
	return env;
};
const titleText = (log, match) => log.find((d) => d.op === 'text' && match(d.str));

test('the miniplayer button in the mini turns the window into the bar, 560x32 at most, captionless, locked and on top', () => {
	const env = toBar(loadPlinth({ track: LONG }));
	assert.deepEqual(panelSize(env), [560, 32]);
	assert.equal(env.win.FrameStyle, FRAME.NoCaption);
	assert.equal(env.win.thick, false, 'no resizable frame');
	assert.ok(lockedAt(env), 'size locked');
	assert.equal(env.fb.AlwaysOnTop, true);
});

test('the miniplayer button in the bar restores the full window: place, size, frame and on-top setting', () => {
	const env = toBar(loadPlinth({ track: TRACK, onTop: false }));
	env.click('mini');
	assert.equal(env.state.mini, false);
	assert.deepEqual([env.win.X, env.win.Y, env.win.Width, env.win.Height], [100, 80, 1280, 860]);
	assert.equal(env.win.FrameStyle, FRAME.Default);
	assert.equal(env.win.thick, true, 'resizable frame back');
	assert.equal(env.win.MinSize || env.win.MaxSize, false, 'size unlocked');
	assert.equal(env.fb.AlwaysOnTop, false);
});

test('the bar is one row: shuffle, repeat, miniplayer, back, play, forward, volume icon and line, title, star', () => {
	const env = toBar(loadPlinth({ track: TRACK }));
	const log = env.paint();
	const { L } = env;
	const title = titleText(log, (s) => s === TRACK.title);
	assert.ok(title, 'title drawn');
	const row = ['shuffle', 'repeat', 'mini', 'prev', 'play', 'next', 'volIcon', 'volBar'].map((id) => ({ id, ...L[id] }));
	row.push({ ...title, id: 'title' }, { ...L.fav, id: 'fav' });
	for (const r of row) {
		assert.ok(r.x >= 0 && r.x + r.w <= env.panel.Width, `${r.id} inside the bar's width`);
		assert.ok(r.y >= 0 && r.y + r.h <= env.panel.Height, `${r.id} inside the bar's height`);
	}
	for (let i = 1; i < row.length; i++) assert.ok(row[i - 1].x + row[i - 1].w <= row[i].x, `${row[i - 1].id} before ${row[i].id}`);
});

test('a title too long for the bar keeps it at 560, cut with "..." and the star following it inside the edge', () => {
	const env = toBar(loadPlinth({ track: LONG }));
	assert.equal(env.panel.Width, 560);
	const title = titleText(env.paint(), (s) => s.endsWith('...'));
	assert.ok(title, 'title cut');
	assert.ok(LONG.title.startsWith(title.str.slice(0, -3)), 'cut from the end');
	const fav = env.L.fav;
	assert.equal(fav.x, title.x + title.w, 'star right after the text');
	assert.ok(fav.x + fav.w <= env.panel.Width, 'star inside the bar');
	assert.ok(env.panel.Width - (fav.x + fav.w) < 30, 'title runs up to the right edge');
});

test('the bar draws no art, artist, album, seek line or times, and playback ticks need none of them', () => {
	const env = toBar(loadPlinth({ track: TRACK }));
	env.fb.PlaybackTime = 75;
	const log = env.paint();
	const texts = log.filter((d) => d.op === 'text').map((d) => d.str);
	assert.ok(!texts.includes(TRACK.artist), 'no artist');
	assert.ok(!texts.includes(TRACK.album), 'no album');
	assert.ok(!texts.some((s) => /^−?\d+:\d\d$/.test(s)), 'no times');
	assert.ok(!texts.includes(String.fromCharCode(0xe122)) && !log.some((d) => d.op === 'image'), 'no art');
	assert.ok(log.filter((d) => d.op === 'rect' && d.h === 2).every((d) => d.x === env.L.volBar.x), 'no seek line');
	env.call('on_playback_time', 76);
	env.call('on_playback_seek', 80);
});

test('in the bar the title and the gaps drag the window, the title opens the track menu, and nothing seeks', () => {
	const env = toBar(loadPlinth({ track: TRACK }));
	env.paint();
	const { L, win } = env;
	const mid = Math.floor(env.panel.Height / 2);
	const press = (x, y) => {
		env.call('on_mouse_lbtn_down', x, y);
		env.call('on_mouse_lbtn_up', x, y);
	};
	press(L.title.x + 4, mid);
	assert.equal(win.moveStarts, 1, 'the title drags');
	const gapL = L.mini.x + L.mini.w, gapR = L.prev.x;
	assert.ok(gapR > gapL, 'a gap between the groups');
	press(Math.floor((gapL + gapR) / 2), mid);
	assert.equal(win.moveStarts, 2, 'the gap drags');
	assert.equal(env.call('on_mouse_rbtn_up', L.title.x + 4, mid), true, 'the title opens the track menu');
	for (let y = 0; y < env.panel.Height; y++) {
		for (let x = 0; x < env.panel.Width; x++) assert.notEqual(env.call('hitTest', x, y), 'seek');
	}
});

test('the bar and the mini each reopen where they were left, and the bar starts where the mini was', () => {
	const env = loadPlinth({ track: TRACK });
	const at = () => [env.win.X, env.win.Y];
	const drag = (x, y) => env.win.Move(x, y, env.win.Width, env.win.Height);
	env.click('mini');
	drag(300, 200);
	env.click('mini');
	assert.deepEqual(at(), [300, 200], 'the bar opens on the mini');
	drag(500, 40);
	env.click('mini'); // full
	env.click('mini');
	assert.deepEqual(at(), [300, 200], 'the mini is back in its place');
	env.click('mini');
	assert.deepEqual(at(), [500, 40], 'the bar is back in its place');
});

test('foobar2000 reopens as the bar when it closed as the bar', () => {
	const first = toBar(loadPlinth({ track: LONG }));
	const { X: x, Y: y, Width: w, Height: h } = first.win;
	const env = loadPlinth({ track: LONG, props: { ...first.props }, rect: { x, y, w, h } });
	assert.deepEqual(panelSize(env), [560, 32]);
	assert.equal(env.win.FrameStyle, FRAME.NoCaption);
	assert.ok(lockedAt(env), 'size locked');
});

test('with Columns UI toolbars showing that are taller than the bar, the bar still gets a 560x32 panel', () => {
	const env = toBar(loadPlinth({ track: LONG, chrome: 58 }));
	assert.deepEqual(panelSize(env), [560, 32]);
	assert.ok(lockedAt(env), 'size locked');
});

test('the miniplayer button pressed again before the mini has dropped its frame still ends as a 560x32 bar', () => {
	const env = loadPlinth({ track: LONG });
	env.click('mini', 100); // the frame goes 300 ms after the mini opens
	env.click('mini');
	assert.deepEqual(panelSize(env), [560, 32]);
	assert.equal(env.win.thick, false, 'no resizable frame');
	assert.ok(lockedAt(env), 'size locked');
});

// ---- the bar's width follows the title ----------------------------------------------------
const STAR = String.fromCharCode(0xe176);
// The right edge of the star's ink: the glyph is centred in its button.
const starInkRight = (log) => {
	const s = log.find((d) => d.op === 'text' && d.str === STAR);
	return s.x + (s.w + s.size) / 2;
};

test('with a short title the bar ends 12 px after the star, as it starts 12 px before the shuffle glyph', () => {
	const env = toBar(loadPlinth({ track: TRACK }));
	const log = env.paint();
	assert.ok(titleText(log, (s) => s === TRACK.title), 'title whole');
	assert.equal(env.panel.Width - starInkRight(log), 12);
	assert.equal(env.panel.Height, 32);
	assert.ok(lockedAt(env), 'size locked');
});

test('a new track refits the bar to its title, keeping the left edge', () => {
	const env = toBar(loadPlinth({ track: TRACK }));
	const [x, y, w] = [env.win.X, env.win.Y, env.panel.Width];
	env.play({ ...TRACK, title: 'Strobe (Extended Mix)' });
	const log = env.paint();
	assert.ok(env.panel.Width > w, 'wider for the longer title');
	assert.equal(env.panel.Width - starInkRight(log), 12);
	assert.deepEqual([env.win.X, env.win.Y, env.panel.Height], [x, y, 32]);
	assert.ok(lockedAt(env), 'size locked');
});

test('"Nothing playing" sizes the bar like a title: the text, then 12 px', () => {
	const env = toBar(loadPlinth());
	const text = titleText(env.paint(), (s) => s === 'Nothing playing');
	assert.ok(text, 'drawn');
	assert.equal(env.panel.Width - (env.L.title.x + Math.ceil(textWidth(text.str, text.size))), 12);
});

test('the mini and the full window keep their size when the track changes', () => {
	const env = loadPlinth({ track: TRACK });
	const full = panelSize(env);
	env.play(LONG);
	assert.deepEqual(panelSize(env), full, 'full window');
	env.click('mini');
	env.play(TRACK);
	assert.deepEqual(panelSize(env), [459, 139], 'mini');
});
