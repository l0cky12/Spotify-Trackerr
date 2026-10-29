import { all } from '#lib/server/db.js';
import { scopeOf } from '#lib/server/view.js';
import { userClause } from '#lib/server/stats.js';

// Suggestions for the History search box: every word has to appear somewhere in the name or its artist,
// limited to things played in the current range, most played first.
export function GET(event) {
	const words = (event.url.searchParams.get('q') ?? '').replace(/[%_]/g, '').split(/\s+/).filter(Boolean).slice(0, 6);
	if (!words.length) return Response.json({ tracks: [], artists: [], albums: [] });
	const { scope } = scopeOf(event, 'all');
	const find = (col: 'track_id' | 'album_id' | 'artist_id', select: string, from: string, text: string) =>
		all(
			`SELECT * FROM (SELECT ${select}, (SELECT COUNT(*) FROM plays p WHERE ${userClause(scope.ids)} AND p.${col} = x.id AND p.played_at >= ? AND p.played_at < ?) plays
			 FROM ${from} WHERE ${words.map(() => `${text} LIKE ?`).join(' AND ')}) WHERE plays > 0 ORDER BY plays DESC LIMIT 5`,
			scope.since,
			scope.until,
			...words.map((w) => `%${w}%`)
		);
	return Response.json({
		tracks: find(
			'track_id',
			'x.id, x.name, a.name sub, COALESCE(x.image_override, x.image, al.image_override, al.image) image',
			'tracks x JOIN artists a ON a.id = x.artist_id LEFT JOIN albums al ON al.id = x.album_id',
			"(x.name || ' ' || a.name)"
		),
		artists: find('artist_id', 'x.id, x.name, NULL sub, COALESCE(x.image_override, x.image) image', 'artists x', 'x.name'),
		albums: find(
			'album_id',
			'x.id, x.name, a.name sub, COALESCE(x.image_override, x.image) image',
			'albums x JOIN artists a ON a.id = x.artist_id',
			"(x.name || ' ' || a.name)"
		)
	});
}
