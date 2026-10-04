'use strict';
// Plinth — playlist drawer (Spider Monkey Panel).
// Shows the active playlist grouped by album: artist, album and year once per group, then
// numbered tracks. Built like plinth.js: lib/common.js is inlined, or included in --dev builds.

window.DefineScript('Plinth Playlist', { author: 'Plinth', features: { drag_n_drop: true, grab_focus: true } });
include(`${PLINTH_DIR}lib/common.js`);

const { palette: C, px, font, text, drawGlyph, DT, clamp, inRect, VK } = Plinth;

const PAD_L = px(48), PAD_R = px(56), PAD_T = px(24), PAD_B = px(24);
const LIST_TOP = px(100);
const ROW = px(34), HEAD = px(50), GAP = px(40);
const SEP = '\u0001';
const TF_ROW = fb.TitleFormat([
	'$if2(%album artist%,%artist%)',
	'[%album%]',
	'[$left(%date%,4)]',
	'$if($greater(%totaldiscs%,1),%discnumber%.,)[$num(%tracknumber%,1)]',
	'$if2(%title%,%filename%)',
	'[%length%]',
	'[%artist%]',
].join(SEP));

const S = {
	w: 0, h: 0,
	pl: -1,
	name: '',
	meta: '',
	count: 0,
	rows: [],       // { type: 'head' | 'gap' | 'track', y, h, idx?, g? }
	rowOfItem: [],
	info: [],       // per playlist item: { no, title, time }
	total: 0,
	scroll: 0,
	target: 0,
	hoverRow: -1,
	anchor: -1,
	pending: null,  // deferred single-select on a selected row (allows dragging a multi-selection)
	dragFrom: null, // mouse-down point that may become a drag
	dragging: false,
	dropAt: -1,     // insertion index while dragging over the list
	sbDrag: null,
	dirty: true,
	followed: false,
};
let anim = null;
let headerHit = null;

window.DlgCode = 0x0004; // DLGC_WANTALLKEYS: arrows, enter, delete reach on_key_down

// ---- model -------------------------------------------------------------------------------
function rebuild() {
	S.dirty = false;
	S.pl = plman.ActivePlaylist;
	S.rows = [];
	S.info = [];
	S.rowOfItem = [];
	S.total = 0;
	S.count = 0;
	S.name = S.pl >= 0 ? plman.GetPlaylistName(S.pl) : 'No playlist';
	S.meta = '';
	if (S.pl < 0) return;

	const items = plman.GetPlaylistItems(S.pl);
	const n = items.Count;
	S.count = n;
	const lines = n ? TF_ROW.EvalWithMetadbs(items) : [];
	let y = 0, key = null, group = null;
	for (let i = 0; i < n; i++) {
		const f = lines[i].split(SEP);
		const k = `${f[0]}\u0002${f[1]}`;
		if (k !== key) {
			key = k;
			if (group) {
				S.rows.push({ type: 'gap', y, h: GAP });
				y += GAP;
			}
			group = { artist: f[0], album: f[1], year: f[2], first: i, last: i, y };
			S.rows.push({ type: 'head', y, h: HEAD, g: group });
			y += HEAD;
		}
		group.last = i;
		const artist = f[6] && f[6] !== f[0] ? f[6] : '';
		S.info.push({ no: f[3], title: artist ? `${f[4]} \u00b7 ${artist}` : f[4], time: f[5] });
		S.rowOfItem[i] = S.rows.length;
		S.rows.push({ type: 'track', y, h: ROW, idx: i, g: group });
		y += ROW;
	}
	S.total = y;
	if (n) {
		const noun = n === 1 ? 'track' : 'tracks';
		S.meta = `${n} ${noun} \u00b7 ${Plinth.formatLength(items.CalcTotalDuration())}`;
	}
	S.scroll = S.target = clamp(S.scroll, 0, maxScroll());
}

const viewH = () => Math.max(0, S.h - LIST_TOP - PAD_B);
const maxScroll = () => Math.max(0, S.total - viewH());
const listX0 = () => PAD_L;
const listX1 = () => S.w - PAD_R;

function rowIndexAt(y) {
	const cy = y - LIST_TOP + S.scroll;
	if (y < LIST_TOP || cy < 0 || cy >= S.total) return -1;
	let lo = 0, hi = S.rows.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (S.rows[mid].y <= cy) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

// Insertion index for a drop at panel y.
function dropIndexAt(y) {
	const ri = rowIndexAt(y);
	if (ri < 0) return y < LIST_TOP ? 0 : S.count;
	const row = S.rows[ri];
	if (row.type === 'track') {
		const mid = LIST_TOP + row.y - S.scroll + row.h / 2;
		return y < mid ? row.idx : row.idx + 1;
	}
	if (row.type === 'head') return row.g.first;
	const next = S.rows[ri + 1];
	return next ? next.g.first : S.count;
}

function dropLineY(index) {
	if (S.count === 0) return LIST_TOP;
	if (index >= S.count) {
		const last = S.rows[S.rowOfItem[S.count - 1]];
		return LIST_TOP + last.y + last.h - S.scroll;
	}
	const row = S.rows[S.rowOfItem[index]];
	return LIST_TOP + row.y - S.scroll;
}

// ---- scrolling ---------------------------------------------------------------------------
function scrollTo(target, instant) {
	S.target = clamp(Math.round(target), 0, maxScroll());
	if (instant) {
		S.scroll = S.target;
		window.Repaint();
		return;
	}
	if (anim) return;
	anim = setInterval(() => {
		const d = S.target - S.scroll;
		if (Math.abs(d) < 1) {
			S.scroll = S.target;
			clearInterval(anim);
			anim = null;
		} else {
			S.scroll += d * 0.35;
		}
		window.Repaint();
	}, 15);
}

function ensureVisible(idx, centre) {
	if (S.dirty) rebuild();
	if (idx < 0 || idx >= S.count) return;
	const row = S.rows[S.rowOfItem[idx]];
	const top = row.g.first === idx ? row.g.y : row.y; // keep the group heading with its first track
	const bottom = row.y + row.h;
	if (centre) scrollTo(top - viewH() / 3, true);
	else if (top < S.scroll) scrollTo(top);
	else if (bottom > S.scroll + viewH()) scrollTo(bottom - viewH());
}

function follow() {
	const loc = plman.GetPlayingItemLocation();
	if (loc.IsValid && loc.PlaylistIndex === S.pl) ensureVisible(loc.PlaylistItemIndex, true);
	else ensureVisible(plman.GetPlaylistFocusItemIndex(S.pl), true);
}

// ---- selection ---------------------------------------------------------------------------
function range(a, b) {
	const out = [];
	for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
	return out;
}

function selectOnly(indices) {
	plman.ClearPlaylistSelection(S.pl);
	if (indices.length) plman.SetPlaylistSelection(S.pl, indices, true);
}

function setFocus(idx) {
	plman.SetPlaylistFocusItem(S.pl, idx);
	if (!utils.IsKeyPressed(VK.SHIFT)) S.anchor = idx;
}

function selectedIndices() {
	const out = [];
	for (let i = 0; i < S.count; i++) if (plman.IsPlaylistItemSelected(S.pl, i)) out.push(i);
	return out;
}

// ---- painting ----------------------------------------------------------------------------
function paintHeader(gr) {
	gr.FillSolidRect(0, 0, S.w, LIST_TOP, C.g2);
	const nameFont = font('light', 22);
	const x1 = listX1();
	const metaW = S.meta ? Math.ceil(gr.CalcTextWidth(S.meta, font('regular', 14))) : 0;
	const maxName = Math.max(px(40), x1 - PAD_L - metaW - px(56));
	const nameW = Math.min(maxName, Math.ceil(gr.CalcTextWidth(S.name, nameFont)));
	text(gr, S.name, nameFont, C.t1, PAD_L, PAD_T, nameW + px(2), px(44));
	drawGlyph(gr, 'chevronDown', 16, C.t3, PAD_L + nameW + px(6), PAD_T, px(24), px(44));
	headerHit = { x: PAD_L - px(6), y: PAD_T, w: nameW + px(40), h: px(44) };
	if (S.meta) text(gr, S.meta, font('regular', 14), C.t3, x1 - metaW, PAD_T, metaW, px(44), DT.RIGHT);
}

function paintHead(gr, row, y) {
	const g = row.g, x0 = listX0(), x1 = listX1();
	const f1 = font('regular', 18), f2 = font('light', 18), f3 = font('regular', 14);
	const yearW = g.year ? Math.ceil(gr.CalcTextWidth(g.year, f3)) + px(16) : 0;
	const artistW = Math.min(Math.ceil(gr.CalcTextWidth(g.artist, f1)), Math.round((x1 - x0 - yearW) * 0.6));
	text(gr, g.artist, f1, C.t1, x0, y, artistW + px(2), px(30));
	if (g.album) {
		const ax = x0 + artistW + px(14);
		text(gr, g.album, f2, C.t2, ax, y, Math.max(0, x1 - yearW - ax), px(30));
	}
	if (g.year) text(gr, g.year, f3, C.t3, x1 - yearW, y, yearW, px(30), DT.RIGHT);
	gr.FillSolidRect(x0, y + px(42), x1 - x0, 1, C.g4);
}

function paintTrack(gr, row, y, playing) {
	const i = row.idx, x0 = listX0(), x1 = listX1();
	const info = S.info[i];
	const selected = plman.IsPlaylistItemSelected(S.pl, i);
	const bgX = x0 - px(16), bgW = x1 - x0 + px(24);
	if (selected) gr.FillSolidRect(bgX, y, bgW, row.h, C.g3);
	else if (S.hoverRow >= 0 && S.rows[S.hoverRow] === row) gr.FillSolidRect(bgX, y, bgW, row.h, C.hover);

	const isPlaying = playing === i;
	if (isPlaying) drawGlyph(gr, 'playing', 15, fb.IsPaused ? C.t3 : C.t1, x0, y, px(30), row.h);
	else text(gr, info.no, font('regular', 14), C.t3, x0, y, px(30), row.h, DT.RIGHT);
	text(gr, info.title, font('regular', 16), isPlaying ? C.t1 : C.t2, x0 + px(48), y, x1 - x0 - px(48) - px(64), row.h);
	text(gr, info.time, font('regular', 14), C.t3, x1 - px(64), y, px(64), row.h, DT.RIGHT);
}

function paintScrollbar(gr) {
	const vh = viewH();
	if (S.total <= vh || vh <= 0) return;
	const active = S.sbDrag || S.hoverRow === -2;
	const th = Math.max(px(32), Math.round(vh * vh / S.total));
	const ty = LIST_TOP + Math.round((vh - th) * (S.scroll / maxScroll()));
	const w = active ? px(5) : px(3);
	gr.FillSolidRect(S.w - px(12) - w, ty, w, th, active ? C.t3 : C.g4);
}

function paintEmpty(gr) {
	text(gr, S.pl < 0 ? 'No playlist' : 'This playlist is empty', font('regular', 16), C.t3, PAD_L, LIST_TOP, listX1() - PAD_L, px(30));
	text(gr, 'Drop files here, or send albums from the library.', font('regular', 14), C.t3, PAD_L, LIST_TOP + px(30), listX1() - PAD_L, px(24));
}

function paint(gr) {
	gr.FillSolidRect(0, 0, S.w, S.h, C.g2);
	if (S.dirty) rebuild();
	if (!S.count) paintEmpty(gr);

	const loc = plman.GetPlayingItemLocation();
	const playing = loc.IsValid && loc.PlaylistIndex === S.pl ? loc.PlaylistItemIndex : -1;
	const bottom = S.h - PAD_B;
	for (let ri = Math.max(0, rowIndexAt(LIST_TOP)); ri < S.rows.length; ri++) {
		const row = S.rows[ri];
		const y = LIST_TOP + row.y - Math.round(S.scroll);
		if (y >= bottom) break;
		if (y + row.h <= LIST_TOP) continue;
		if (row.type === 'head') paintHead(gr, row, y);
		else if (row.type === 'track') paintTrack(gr, row, y, playing);
	}
	if (S.dropAt >= 0) gr.FillSolidRect(listX0() - px(16), dropLineY(S.dropAt) - 1, listX1() - listX0() + px(24), px(2), C.t3);

	// mask rows that scrolled under the header or past the bottom margin
	paintHeader(gr);
	gr.FillSolidRect(0, bottom, S.w, S.h - bottom, C.g2);
	paintScrollbar(gr);
}

// ---- menus -------------------------------------------------------------------------------
function playlistMenu(x, y) {
	const MF_STRING = 0, MF_GRAYED = 1;
	const menu = window.CreatePopupMenu();
	const count = plman.PlaylistCount;
	for (let i = 0; i < count; i++) menu.AppendMenuItem(MF_STRING, 100 + i, plman.GetPlaylistName(i).replace(/&/g, '&&'));
	if (count && S.pl >= 0) menu.CheckMenuRadioItem(100, 100 + count - 1, 100 + S.pl);
	if (count) menu.AppendMenuSeparator();
	menu.AppendMenuItem(MF_STRING, 1, 'New playlist');
	menu.AppendMenuItem(S.pl >= 0 ? MF_STRING : MF_GRAYED, 2, 'Rename\u2026');
	menu.AppendMenuItem(S.pl >= 0 ? MF_STRING : MF_GRAYED, 3, 'Delete');
	const id = menu.TrackPopupMenu(x, y);
	if (id >= 100) plman.ActivePlaylist = id - 100;
	else if (id === 1) plman.ActivePlaylist = plman.CreatePlaylist(count, 'New playlist');
	else if (id === 2) {
		try {
			const name = utils.InputBox(window.ID, 'Playlist name', 'Rename playlist', plman.GetPlaylistName(S.pl), true);
			if (name) plman.RenamePlaylist(S.pl, name);
		} catch (e) { /* cancelled */ }
	} else if (id === 3) plman.RemovePlaylistSwitch(S.pl);
}

function contextMenu(x, y) {
	const menu = window.CreatePopupMenu();
	const cm = fb.CreateContextMenuManager();
	const hasSelection = plman.GetPlaylistSelectedItems(S.pl).Count > 0;
	if (hasSelection) {
		cm.InitContextPlaylist();
		cm.BuildMenu(menu, 1);
	}
	const id = menu.TrackPopupMenu(x, y);
	if (id > 0) cm.ExecuteByID(id - 1);
}

// ---- mouse -------------------------------------------------------------------------------
const overScrollbar = (x) => S.total > viewH() && x >= S.w - px(22);

function setHoverRow(ri) {
	if (S.hoverRow === ri) return;
	S.hoverRow = ri;
	window.Repaint();
}

function on_mouse_move(x, y, mask) {
	if (S.sbDrag) {
		const vh = viewH(), th = Math.max(px(32), Math.round(vh * vh / S.total));
		const frac = (y - S.sbDrag.offset - LIST_TOP) / Math.max(1, vh - th);
		scrollTo(frac * maxScroll(), true);
		return;
	}
	if (S.dragFrom && !S.dragging && (Math.abs(x - S.dragFrom.x) > px(6) || Math.abs(y - S.dragFrom.y) > px(6))) {
		startDrag();
		return;
	}
	window.SetCursor(inRect(x, y, headerHit) ? Plinth.IDC.HAND : Plinth.IDC.ARROW);
	setHoverRow(overScrollbar(x) ? -2 : rowIndexAt(y));
}

function on_mouse_leave() {
	setHoverRow(-1);
}

function on_mouse_lbtn_down(x, y, mask) {
	if (S.dirty) rebuild();
	S.pending = null;
	S.dragFrom = null;
	if (inRect(x, y, headerHit)) {
		playlistMenu(headerHit.x, headerHit.y + headerHit.h);
		return;
	}
	if (overScrollbar(x) && y >= LIST_TOP) {
		const vh = viewH(), th = Math.max(px(32), Math.round(vh * vh / S.total));
		const ty = LIST_TOP + Math.round((vh - th) * (S.scroll / maxScroll()));
		S.sbDrag = { offset: y >= ty && y < ty + th ? y - ty : th / 2 };
		on_mouse_move(x, y, mask);
		return;
	}
	const ri = rowIndexAt(y);
	const ctrl = utils.IsKeyPressed(VK.CONTROL), shift = utils.IsKeyPressed(VK.SHIFT);
	if (ri < 0) {
		if (!ctrl && !shift) plman.ClearPlaylistSelection(S.pl);
		return;
	}
	const row = S.rows[ri];
	if (row.type === 'head') {
		const items = range(row.g.first, row.g.last);
		if (ctrl) plman.SetPlaylistSelection(S.pl, items, true);
		else selectOnly(items);
		setFocus(row.g.first);
		S.dragFrom = { x, y };
		return;
	}
	if (row.type !== 'track') return;
	const i = row.idx;
	if (shift && S.anchor >= 0) {
		if (ctrl) plman.SetPlaylistSelection(S.pl, range(S.anchor, i), true);
		else selectOnly(range(S.anchor, i));
		plman.SetPlaylistFocusItem(S.pl, i);
	} else if (ctrl) {
		plman.SetPlaylistSelectionSingle(S.pl, i, !plman.IsPlaylistItemSelected(S.pl, i));
		setFocus(i);
	} else if (plman.IsPlaylistItemSelected(S.pl, i)) {
		S.pending = i; // decide on mouse-up, so a multi-selection can still be dragged
		setFocus(i);
	} else {
		selectOnly([i]);
		setFocus(i);
	}
	if (plman.IsPlaylistItemSelected(S.pl, i)) S.dragFrom = { x, y };
}

function on_mouse_lbtn_up(x, y) {
	if (S.sbDrag) {
		S.sbDrag = null;
		window.Repaint();
	}
	if (S.pending !== null) selectOnly([S.pending]);
	S.pending = null;
	S.dragFrom = null;
}

function on_mouse_lbtn_dblclk(x, y) {
	const ri = rowIndexAt(y);
	if (ri < 0 || overScrollbar(x)) return;
	const row = S.rows[ri];
	if (row.type === 'track') plman.ExecutePlaylistDefaultAction(S.pl, row.idx);
	else if (row.type === 'head') plman.ExecutePlaylistDefaultAction(S.pl, row.g.first);
}

function on_mouse_rbtn_up(x, y) {
	const ri = rowIndexAt(y);
	if (ri >= 0) {
		const row = S.rows[ri];
		if (row.type === 'track' && !plman.IsPlaylistItemSelected(S.pl, row.idx)) {
			selectOnly([row.idx]);
			setFocus(row.idx);
		} else if (row.type === 'head') {
			selectOnly(range(row.g.first, row.g.last));
			setFocus(row.g.first);
		}
	}
	contextMenu(x, y);
	return true;
}

function on_mouse_wheel(step) {
	scrollTo(S.target - step * ROW * 3);
}

// ---- drag and drop -----------------------------------------------------------------------
function startDrag() {
	S.dragFrom = null;
	S.pending = null;
	const items = plman.GetPlaylistSelectedItems(S.pl);
	if (!items.Count) return;
	S.dragging = true;
	try {
		fb.DoDragDrop(window.ID, items, 1 | 2 | 4); // copy | move | link
	} finally {
		S.dragging = false;
		S.dropAt = -1;
		window.Repaint();
	}
}

function on_drag_enter(action, x, y) { on_drag_over(action, x, y); }

function on_drag_over(action, x, y) {
	if (S.pl < 0 || plman.IsPlaylistLocked(S.pl)) {
		action.Effect = 0;
		return;
	}
	S.dropAt = dropIndexAt(y);
	action.Effect = S.dragging ? 2 : 1;
	if (y < LIST_TOP + px(24)) scrollTo(S.target - ROW);
	else if (y > S.h - PAD_B - px(24)) scrollTo(S.target + ROW);
	window.Repaint();
}

function on_drag_leave() {
	S.dropAt = -1;
	window.Repaint();
}

function on_drag_drop(action, x, y) {
	const at = dropIndexAt(y);
	S.dropAt = -1;
	if (S.pl < 0 || plman.IsPlaylistLocked(S.pl)) {
		action.Effect = 0;
	} else if (S.dragging) {
		const sel = selectedIndices();
		const first = sel[0], last = sel[sel.length - 1];
		const delta = at <= first ? at - first : at > last + 1 ? at - last - 1 : 0;
		if (delta) {
			plman.UndoBackup(S.pl);
			plman.MovePlaylistSelection(S.pl, delta);
		}
		action.Effect = 0; // handled here; don't let foobar2000 insert copies
	} else {
		action.Playlist = S.pl;
		action.Base = at;
		action.ToSelect = true;
		action.Effect = 1;
	}
	window.Repaint();
}

// ---- keyboard ----------------------------------------------------------------------------
function on_key_down(vk) {
	if (S.pl < 0) return;
	if (S.dirty) rebuild();
	const ctrl = utils.IsKeyPressed(VK.CONTROL), shift = utils.IsKeyPressed(VK.SHIFT);
	const focus = plman.GetPlaylistFocusItemIndex(S.pl);
	const page = Math.max(1, Math.floor(viewH() / ROW) - 2);
	let to = null;
	switch (vk) {
		case VK.UP: to = focus - 1; break;
		case VK.DOWN: to = focus + 1; break;
		case VK.PRIOR: to = focus - page; break;
		case VK.NEXT: to = focus + page; break;
		case VK.HOME: to = 0; break;
		case VK.END: to = S.count - 1; break;
		case VK.RETURN:
			if (focus >= 0) plman.ExecutePlaylistDefaultAction(S.pl, focus);
			return;
		case VK.DELETE:
			if (!plman.IsPlaylistLocked(S.pl)) {
				plman.UndoBackup(S.pl);
				plman.RemovePlaylistSelection(S.pl);
			}
			return;
		case VK.A:
			if (ctrl) plman.SetPlaylistSelection(S.pl, range(0, S.count - 1), true);
			return;
		default:
			return;
	}
	if (!S.count) return;
	to = clamp(to, 0, S.count - 1);
	if (shift) {
		if (S.anchor < 0) S.anchor = Math.max(0, focus);
		selectOnly(range(S.anchor, to));
		plman.SetPlaylistFocusItem(S.pl, to);
	} else {
		selectOnly([to]);
		setFocus(to);
	}
	ensureVisible(to);
}

// ---- callbacks ---------------------------------------------------------------------------
function invalidate() {
	S.dirty = true;
	window.Repaint();
}

function on_size(w, h) {
	S.w = w;
	S.h = h;
	if (w > 0 && h > 0 && !S.followed) {
		S.followed = true;
		rebuild();
		follow();
	}
}

function on_paint(gr) {
	if (S.w > 0 && S.h > 0) paint(gr);
}

function on_playlist_switch() {
	S.scroll = S.target = 0;
	S.anchor = -1;
	rebuild();
	follow();
}
function on_playlists_changed() { invalidate(); }
function on_playlist_items_added(pl) { if (pl === S.pl) invalidate(); }
function on_playlist_items_removed(pl) { if (pl === S.pl) invalidate(); }
function on_playlist_items_reordered(pl) { if (pl === S.pl) invalidate(); }
function on_playlist_items_selection_change() { window.Repaint(); }
function on_item_focus_change(pl) { if (pl === S.pl) window.Repaint(); }
function on_playlist_item_ensure_visible(pl, idx) { if (pl === S.pl) ensureVisible(idx); }
function on_metadb_changed() { invalidate(); }
function on_playback_new_track() {
	const loc = plman.GetPlayingItemLocation();
	if (loc.IsValid && loc.PlaylistIndex === S.pl) ensureVisible(loc.PlaylistItemIndex);
	window.Repaint();
}
function on_playback_stop() { window.Repaint(); }
function on_playback_pause() { window.Repaint(); }

// ---- debug (isolated test harness only) --------------------------------------------------
if (Plinth.debugDir) {
	setTimeout(() => {
		const img = gdi.CreateImage(S.w, S.h);
		const g = img.GetGraphics();
		paint(g);
		img.ReleaseGraphics(g);
		img.SaveAs(`${Plinth.debugDir}/playlist.png`);
		const report = [`size ${S.w}x${S.h}`, `playlist ${S.pl} '${S.name}' ${S.meta}`, `rows ${S.rows.length} total ${S.total} scroll ${S.scroll}`];
		try {
			const cm = fb.CreateContextMenuManager();
			cm.InitContextPlaylist();
			cm.BuildMenu(window.CreatePopupMenu(), 1);
			report.push('context menu: ok');
		} catch (e) {
			report.push(`context menu: ERROR ${e.message}`);
		}
		Plinth.log('playlist_report.txt', report);
	}, 3000);
}
