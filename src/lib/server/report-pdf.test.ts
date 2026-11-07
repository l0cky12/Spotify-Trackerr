import { test, expect } from 'vitest';
import { renderReportPdf, pdfText } from './report-pdf.js';
import type { Report } from './report.js';
import type { TopRow } from './stats.js';

const row = (name: string, plays: number, artist: string | null = null): TopRow => ({ id: plays, name, artist, artist_id: null, image: null, plays, ms: plays * 200_000, first: 0, last: 0 });
const same = { diff: 0, pct: 0 };
const report = (plays: number, names: string[]): Report => ({
	period: { id: '2025-10', label: 'Oct 2025', y: 2025, m: 9, prev: { id: '2025-09', label: 'Sep 2025' } },
	who: 'Søren',
	generatedOn: 'Nov 7, 2026',
	totals: { plays, ms: plays * 200_000, artists: names.length, tracks: names.length, newArtists: names.length },
	delta: { plays: same, ms: same, artists: same, tracks: same, newArtists: { diff: names.length, pct: null } },
	tracks: names.map((n, i) => row(`${n} song`, 10 - i, n)),
	albums: names.map((n, i) => row(`${n} album`, 10 - i, n)),
	artists: names.map((n, i) => row(n, 10 - i)),
	genres: [{ name: 'j-pop', plays, ms: 0 }],
	newArtists: names.map((n, i) => row(n, 10 - i)),
	busiest: plays ? { label: 'Oct 14, 2025', plays: 5, ms: 1_000_000, tracks: [row('東京', 3, '坂本龍一')] } : null,
	series: { labels: ['Oct 1', 'Oct 2'], cur: [plays, 0], prev: [1, 2] },
	weekdays: [plays, 0, 0, 0, 0, 0, 0],
	hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? plays : 0))
});
const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';

test('names keep what Helvetica can draw and mark what it cannot', () => {
	expect(pdfText('Sigur Rós')).toBe('Sigur Rós');
	expect(pdfText('Dvořák')).toBe('Dvorák');
	expect(pdfText('Łódź')).toBe('Lódz');
	expect(pdfText('Beyoncé 🐝')).toBe('Beyoncé');
	expect(pdfText('坂本龍一')).toBe('?');
	expect(pdfText('坂本龍一 & Alva Noto')).toBe('? & Alva Noto');
	expect(pdfText('🎧')).toBe('?');
});

test('a report with names in any script renders as a PDF', async () => {
	const pdf = await renderReportPdf(report(42, ['坂本龍一', 'Sigur Rós', 'Ночной Трамвай', 'Dvořák 🎻', 'Łąka', 'Ἀθῆναι', 'Café Tacvba']), 'auto');
	expect(isPdf(pdf)).toBe(true);
});

test('a period without plays renders a one-page PDF', async () => {
	const pdf = await renderReportPdf(report(0, []), 'hours');
	expect(isPdf(pdf)).toBe(true);
	expect(new TextDecoder('latin1').decode(pdf).match(/\/Type \/Page\b/g)).toHaveLength(1);
});
