import PDFDocument from 'pdfkit';
import type { Report } from './report.js';
import type { Change, TopRow } from './stats.js';
import { formatListened, type TimeUnit } from '../time.js';

type Doc = PDFKit.PDFDocument;

const W = 595.28;
const H = 841.89;
const M = 44;
const CW = W - 2 * M;
const BOTTOM = H - M - 16;

const INK = '#17151c';
const INK_2 = '#4f4b57';
const MUTED = '#86818f';
const RULE = '#e4e1e8';
const PANEL = '#f5f4f7';
const ACCENT = '#2a78d6';
const GHOST = '#d9d6de';
const OTHER = '#c4c0ca';
const UP = '#0b7a0b';
const DOWN = '#c0392b';
// The app's categorical hues, stepped for a white page, in their validated order.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

// The PDF uses Helvetica, which only draws Windows-1252 (WinAnsi). The app's own font is a variable
// font that pdfkit can't embed, and the slim Docker image has no system fonts to fall back on.
const WIN_ANSI_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const drawable = (c: string) => {
	const n = c.codePointAt(0)!;
	return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || WIN_ANSI_HIGH.includes(c);
};
// Characters NFKD leaves as they are, spelled the closest way WinAnsi can.
const PLAIN: Record<string, string> = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ħ: 'H', ħ: 'h', ı: 'i', Ŧ: 'T', ŧ: 't', Ŋ: 'N', ŋ: 'n', ẞ: 'SS', ſ: 's', '‐': '-', '‑': '-', '−': '-' };

/**
 * Text as Helvetica can draw it: accented Latin letters it lacks lose their accents ('Dvořák' -> 'Dvorák'),
 * each run of letters from other scripts becomes one '?', and emoji and symbols are dropped.
 */
export function pdfText(s: string) {
	let out = '';
	let unknownRun = false;
	for (const c of s.normalize('NFC')) {
		const plain = drawable(c) ? c : (PLAIN[c] ?? c.normalize('NFKD').replace(/\p{M}/gu, ''));
		if (plain && [...plain].every(drawable)) {
			out += plain;
			unknownRun = false;
		} else if (/[\p{L}\p{N}]/u.test(c)) {
			if (!unknownRun) out += '?';
			unknownRun = true;
		}
	}
	return out.replace(/\s+/g, ' ').trim() || '?';
}

const fmt = (n: number) => n.toLocaleString('en-US');
const share = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`);

// ---- Drawing primitives --------------------------------------------------------------------

type Style = { size: number; bold?: boolean; color?: string };

function setStyle(doc: Doc, style: Style) {
	doc.font(style.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(style.size).fillColor(style.color ?? INK);
}

/** One line of text, cut with an ellipsis to fit `w`. */
function text(doc: Doc, s: string, x: number, y: number, w: number, style: Style, align: 'left' | 'right' | 'center' = 'left') {
	setStyle(doc, style);
	let line = pdfText(s);
	if (doc.widthOfString(line) > w) {
		while (line.length > 1 && doc.widthOfString(`${line}…`) > w) line = line.slice(0, -1);
		line = `${line.trimEnd()}…`;
	}
	const room = w - doc.widthOfString(line);
	doc.text(line, x + (align === 'right' ? room : align === 'center' ? room / 2 : 0), y, { lineBreak: false });
}

/** A bar standing on its baseline at `base`, with a rounded top. */
function bar(doc: Doc, x: number, base: number, w: number, h: number, color: string) {
	if (h <= 0) return;
	const r = Math.min(2, w / 2, h);
	doc.moveTo(x, base)
		.lineTo(x, base - h + r)
		.quadraticCurveTo(x, base - h, x + r, base - h)
		.lineTo(x + w - r, base - h)
		.quadraticCurveTo(x + w, base - h, x + w, base - h + r)
		.lineTo(x + w, base)
		.closePath()
		.fill(color);
}

function swatch(doc: Doc, x: number, y: number, color: string) {
	doc.roundedRect(x, y, 7, 7, 1.5).fill(color);
}

function changeLabel(c: Change) {
	if (c.pct === null) return { label: c.diff ? 'new' : 'no change', color: INK_2 };
	return { label: `${c.pct > 0 ? '+' : ''}${c.pct}%`, color: c.pct > 0 ? UP : c.pct < 0 ? DOWN : INK_2 };
}

/** A headline number with its change from the previous period. */
function statTile(doc: Doc, x: number, y: number, w: number, tile: { label: string; value: string; change: Change; prev: string }) {
	doc.roundedRect(x, y, w, 62, 6).fill(PANEL);
	text(doc, tile.label, x + 10, y + 9, w - 20, { size: 8, color: MUTED });
	text(doc, tile.value, x + 10, y + 21, w - 20, { size: 17, bold: true });
	const change = changeLabel(tile.change);
	setStyle(doc, { size: 7.5, bold: true });
	const cw = doc.widthOfString(change.label);
	text(doc, change.label, x + 10, y + 45, w - 20, { size: 7.5, bold: true, color: change.color });
	text(doc, `vs ${tile.prev}`, x + 13 + cw, y + 45, w - 23 - cw, { size: 7.5, color: MUTED });
}

function niceStep(max: number) {
	const raw = max / 4;
	const mag = 10 ** Math.floor(Math.log10(raw));
	return Math.max(1, [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw)!);
}

/** Vertical bars over labelled columns, with an optional earlier series drawn wider and paler behind. */
function columns(doc: Doc, x: number, y: number, w: number, h: number, chart: { labels: string[]; values: number[]; ghost?: number[] | null }) {
	const { labels, values, ghost } = chart;
	const max = Math.max(1, ...values, ...(ghost ?? []));
	const step = niceStep(max);
	const top = Math.ceil(max / step) * step;
	setStyle(doc, { size: 7 });
	const axisW = doc.widthOfString(fmt(top)) + 8;
	const px = x + axisW;
	const pw = w - axisW;
	const base = y + h;
	for (let v = 0; v <= top; v += step) {
		const ly = base - (v / top) * h;
		doc.moveTo(px, ly).lineTo(px + pw, ly).lineWidth(0.5).strokeColor(v ? RULE : MUTED).stroke();
		text(doc, fmt(v), x, ly - 3.5, axisW - 4, { size: 7, color: MUTED }, 'right');
	}
	const slot = pw / values.length;
	values.forEach((v, i) => {
		if (ghost) bar(doc, px + i * slot + slot * 0.1, base, slot * 0.8, (ghost[i] / top) * h, GHOST);
		const bw = slot * (ghost ? 0.5 : 0.7);
		bar(doc, px + i * slot + (slot - bw) / 2, base, bw, (v / top) * h, ACCENT);
	});
	setStyle(doc, { size: 7 });
	const labelW = Math.max(...labels.map((l) => doc.widthOfString(l))) + 8;
	const every = Math.ceil(labels.length / Math.max(1, Math.floor(pw / labelW)));
	labels.forEach((l, i) => {
		if (i % every === 0) text(doc, l, px + i * slot + slot / 2 - labelW / 2, base + 5, labelW, { size: 7, color: MUTED }, 'center');
	});
}

type Slice = { label: string; value: number; color: string };

/** A ring of slices, clockwise from twelve o'clock, with a caption in the hole. */
function donut(doc: Doc, cx: number, cy: number, r: number, slices: Slice[], center: [string, string]) {
	const total = slices.reduce((a, s) => a + s.value, 0);
	const inner = r * 0.62;
	let a0 = -Math.PI / 2;
	for (const s of slices) {
		const a1 = a0 + (s.value / total) * Math.PI * 2;
		const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 120));
		const ring = (rad: number, from: number, to: number) =>
			Array.from({ length: steps + 1 }, (_, i) => {
				const a = from + ((to - from) * i) / steps;
				return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)] as [number, number];
			});
		doc.polygon(...ring(r, a0, a1), ...ring(inner, a1, a0))
			.lineWidth(1.5)
			.lineJoin('round')
			.fillAndStroke(s.color, '#ffffff');
		a0 = a1;
	}
	text(doc, center[0], cx - inner, cy - 11, inner * 2, { size: 13, bold: true }, 'center');
	text(doc, center[1], cx - inner, cy + 4, inner * 2, { size: 7, color: MUTED }, 'center');
}

/** Swatch, label and value rows naming a donut's slices. */
function legend(doc: Doc, x: number, y: number, w: number, slices: Slice[], total: number) {
	slices.forEach((s, i) => {
		const ry = y + i * 14;
		swatch(doc, x, ry + 1, s.color);
		text(doc, s.label, x + 12, ry, w - 60, { size: 8, color: INK_2 });
		text(doc, share(s.value, total), x + w - 44, ry, 44, { size: 8, bold: true }, 'right');
	});
	return slices.length * 14;
}

/** Horizontal bars, one row per item, longest first in whatever order they're given. */
function barList(doc: Doc, x: number, y: number, w: number, rows: { label: string; value: number; note: string }[], rowH = 16) {
	const max = Math.max(1, ...rows.map((r) => r.value));
	const labelW = Math.min(110, w * 0.38);
	const noteW = 54;
	const track = w - labelW - noteW - 8;
	rows.forEach((r, i) => {
		const ry = y + i * rowH;
		text(doc, r.label, x, ry + 2, labelW - 6, { size: 8, color: INK_2 });
		doc.roundedRect(x + labelW, ry + 3, track, rowH - 7, 2).fill(PANEL);
		if (r.value) doc.roundedRect(x + labelW, ry + 3, Math.max(2, (r.value / max) * track), rowH - 7, 2).fill(ACCENT);
		text(doc, r.note, x + w - noteW, ry + 2, noteW, { size: 8 }, 'right');
	});
	return rows.length * rowH;
}

/** A ranked top list: rank (with its slice colour when it has one), name over artist, plays, time listened. */
function topTable(doc: Doc, x: number, y: number, w: number, rows: TopRow[], unit: TimeUnit, colors: string[] = []) {
	const sub = rows.some((r) => r.artist);
	const rowH = sub ? 23 : 17;
	const playsW = 42;
	const timeW = 52;
	const nameX = x + 20;
	const nameW = w - 20 - playsW - timeW - 6;
	text(doc, 'Plays', x + w - timeW - playsW, y, playsW, { size: 7, color: MUTED }, 'right');
	text(doc, 'Time', x + w - timeW, y, timeW, { size: 7, color: MUTED }, 'right');
	doc.moveTo(x, y + 12).lineTo(x + w, y + 12).lineWidth(0.5).strokeColor(RULE).stroke();
	rows.forEach((r, i) => {
		const ry = y + 17 + i * rowH;
		if (colors[i]) swatch(doc, x, ry + 1.5, colors[i]);
		text(doc, String(i + 1), colors[i] ? x + 9 : x, ry, 11, { size: 8, color: MUTED });
		text(doc, r.name, nameX, ry, nameW, { size: 8.5, bold: true });
		if (r.artist) text(doc, r.artist, nameX, ry + 10.5, nameW, { size: 7.5, color: MUTED });
		text(doc, fmt(r.plays), x + w - timeW - playsW, ry, playsW, { size: 8.5 }, 'right');
		text(doc, formatListened(r.ms, unit), x + w - timeW, ry, timeW, { size: 8.5, color: INK_2 }, 'right');
	});
	return 17 + rows.length * rowH;
}

// ---- The report ----------------------------------------------------------------------------

export async function renderReportPdf(report: Report, unit: TimeUnit): Promise<Buffer> {
	const title = `${report.period.label} listening report`;
	const who = report.who === 'Everyone' ? 'Everyone on this server' : report.who;
	const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: pdfText(title), Author: pdfText(who), Creator: 'Spotify Trackerr' } });
	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const ended = new Promise((resolve) => doc.on('end', resolve));
	const listened = (ms: number) => formatListened(ms, unit);
	const { totals, delta, period } = report;

	let y = M;
	const newPage = () => {
		doc.addPage();
		y = M;
	};
	const heading = (label: string, sub = '') => {
		text(doc, label, M, y, CW, { size: 13, bold: true });
		if (sub) {
			setStyle(doc, { size: 13, bold: true });
			const lw = doc.widthOfString(pdfText(label));
			text(doc, sub, M + lw + 8, y + 4, CW - lw - 8, { size: 8.5, color: MUTED });
		}
		y += 24;
	};

	doc.rect(0, 0, W, 5).fill(ACCENT);
	text(doc, title, M, y, CW, { size: 24, bold: true });
	y += 32;
	text(doc, `${who} · compared with ${period.prev.label} · generated ${report.generatedOn}`, M, y, CW, { size: 9, color: MUTED });
	y += 30;

	if (!totals.plays) {
		text(doc, `No plays in ${period.label}.`, M, y, CW, { size: 12, color: INK_2 });
	} else {
		const tiles = [
			{ label: 'Plays', value: fmt(totals.plays), change: delta.plays },
			{ label: 'Time listened', value: listened(totals.ms), change: delta.ms },
			{ label: 'Songs', value: fmt(totals.tracks), change: delta.tracks },
			{ label: 'Artists', value: fmt(totals.artists), change: delta.artists },
			{ label: 'New artists', value: fmt(totals.newArtists), change: delta.newArtists }
		];
		const tileW = (CW - 8 * (tiles.length - 1)) / tiles.length;
		tiles.forEach((t, i) => statTile(doc, M + i * (tileW + 8), y, tileW, { ...t, prev: period.prev.label }));
		y += 76;

		if (report.busiest) {
			const b = report.busiest;
			doc.roundedRect(M, y, CW, 76, 6).fill(PANEL);
			text(doc, 'Busiest day', M + 14, y + 12, 160, { size: 8, color: MUTED });
			text(doc, b.label, M + 14, y + 25, 160, { size: 16, bold: true });
			text(doc, `${fmt(b.plays)} plays · ${listened(b.ms)}`, M + 14, y + 47, 160, { size: 9, color: INK_2 });
			const lx = M + 190;
			const lw = CW - 190 - 14;
			text(doc, 'Most played that day', lx, y + 12, lw, { size: 8, color: MUTED });
			b.tracks.forEach((t, i) => {
				const ry = y + 26 + i * 14;
				text(doc, `${i + 1}`, lx, ry, 10, { size: 8.5, color: MUTED });
				text(doc, `${t.name}  ·  ${t.artist}`, lx + 12, ry, lw - 60, { size: 8.5 });
				text(doc, `${fmt(t.plays)} plays`, lx + lw - 46, ry, 46, { size: 8.5, color: INK_2 }, 'right');
			});
			y += 92;
		}

		heading(`Plays over ${period.label}`);
		swatch(doc, M + CW - 190, y - 20, ACCENT);
		text(doc, period.label, M + CW - 179, y - 21, 80, { size: 8, color: INK_2 });
		swatch(doc, M + CW - 92, y - 20, GHOST);
		text(doc, period.prev.label, M + CW - 81, y - 21, 81, { size: 8, color: INK_2 });
		columns(doc, M, y, CW, 130, { labels: report.series.labels, values: report.series.cur, ghost: report.series.prev });
		y += 156;

		heading('When you listen', 'plays by day of the week and hour of the day');
		const half = (CW - 28) / 2;
		barList(
			doc,
			M,
			y,
			half,
			report.weekdays.map((v, i) => ({ label: WEEKDAYS[i], value: v, note: `${fmt(v)} plays` }))
		);
		columns(doc, M + half + 28, y, half, 96, { labels: HOURS, values: report.hours });
		y += 136;

		if (report.genres.length) {
			heading('Top genres', 'an artist can have several genres, so these overlap');
			y += barList(
				doc,
				M,
				y,
				CW,
				report.genres.map((g) => ({ label: g.name, value: g.plays, note: `${fmt(g.plays)} plays` })),
				14
			);
		}

		newPage();
		heading('Top artists', `share of ${fmt(totals.plays)} plays`);
		const top6 = report.artists.slice(0, SERIES.length);
		const rest = totals.plays - top6.reduce((a, r) => a + r.plays, 0);
		const slices: Slice[] = [...top6.map((r, i) => ({ label: r.name, value: r.plays, color: SERIES[i] })), ...(rest > 0 ? [{ label: 'Every other artist', value: rest, color: OTHER }] : [])];
		const tableW = CW * 0.6;
		const tableH = topTable(doc, M, y, tableW, report.artists, unit, SERIES);
		const r = 62;
		const cx = M + tableW + (CW - tableW) / 2 + 6;
		donut(doc, cx, y + r + 6, r, slices, [share(totals.plays - rest, totals.plays), `top ${top6.length} artists`]);
		const legendH = legend(doc, M + tableW + 24, y + 2 * r + 24, CW - tableW - 24, slices, totals.plays);
		y += Math.max(tableH, 2 * r + 24 + legendH) + 22;

		const colW = (CW - 24) / 2;
		text(doc, 'Top songs', M, y, colW, { size: 13, bold: true });
		text(doc, 'Top albums', M + colW + 24, y, colW, { size: 13, bold: true });
		y += 24;
		y += Math.max(topTable(doc, M, y, colW, report.tracks, unit), topTable(doc, M + colW + 24, y, colW, report.albums, unit)) + 22;

		newPage();
		heading('New to you', `artists first played in ${period.label}`);
		if (!report.newArtists.length) {
			text(doc, `No new artists in ${period.label}.`, M, y, CW, { size: 10, color: INK_2 });
		} else {
			const freshPlays = report.newArtists.reduce((a, r) => a + r.plays, 0);
			text(doc, fmt(totals.newArtists), M, y, 160, { size: 34, bold: true });
			text(doc, totals.newArtists === 1 ? 'new artist' : 'new artists', M, y + 38, 160, { size: 10, color: INK_2 });
			text(doc, `${fmt(freshPlays)} plays, ${listened(report.newArtists.reduce((a, r) => a + r.ms, 0))}`, M, y + 54, 160, { size: 8.5, color: MUTED });
			const mix: Slice[] = [
				{ label: 'Artists new to you', value: freshPlays, color: ACCENT },
				{ label: 'Artists you already knew', value: totals.plays - freshPlays, color: OTHER }
			];
			donut(doc, M + 230, y + 42, 42, mix, [share(freshPlays, totals.plays), 'of plays']);
			legend(doc, M + 292, y + 28, 170, mix, totals.plays);
			y += 104;
			newArtistColumns(doc, report.newArtists, y, period.label);
		}
	}

	const pages = doc.bufferedPageRange();
	for (let i = 0; i < pages.count; i++) {
		doc.switchToPage(pages.start + i);
		doc.moveTo(M, H - 34).lineTo(W - M, H - 34).lineWidth(0.5).strokeColor(RULE).stroke();
		text(doc, `Spotify Trackerr · ${who} · ${title}`, M, H - 27, CW - 70, { size: 7.5, color: MUTED });
		text(doc, `Page ${i + 1} of ${pages.count}`, W - M - 70, H - 27, 70, { size: 7.5, color: MUTED }, 'right');
	}
	doc.end();
	await ended;
	return Buffer.concat(chunks);
}

/** Every new artist in three columns, top to bottom then across, onto as many pages as it takes. */
function newArtistColumns(doc: Doc, rows: TopRow[], y: number, label: string) {
	const gap = 18;
	const colW = (CW - gap * 2) / 3;
	const rowH = 14;
	for (let i = 0; i < rows.length; ) {
		if (BOTTOM - y - 16 < rowH * 3) {
			doc.addPage();
			y = M;
			text(doc, `New to you in ${label}, continued`, M, y, CW, { size: 11, bold: true });
			y += 22;
		}
		const perCol = Math.min(Math.floor((BOTTOM - y - 16) / rowH), Math.ceil((rows.length - i) / 3));
		const pageRows = rows.slice(i, i + perCol * 3);
		for (let c = 0; c * perCol < pageRows.length; c++) {
			const x = M + c * (colW + gap);
			text(doc, 'Plays', x + colW - 40, y, 40, { size: 7, color: MUTED }, 'right');
			doc.moveTo(x, y + 11).lineTo(x + colW, y + 11).lineWidth(0.5).strokeColor(RULE).stroke();
		}
		pageRows.forEach((r, k) => {
			const x = M + Math.floor(k / perCol) * (colW + gap);
			const ry = y + 16 + (k % perCol) * rowH;
			text(doc, String(i + k + 1), x, ry, 18, { size: 7.5, color: MUTED });
			text(doc, r.name, x + 20, ry, colW - 64, { size: 8.5 });
			text(doc, fmt(r.plays), x + colW - 40, ry, 40, { size: 8.5, color: INK_2 }, 'right');
		});
		i += pageRows.length;
		y = BOTTOM;
	}
}
