import type { Row } from './db.js';
import { top } from './stats.js';
import { parseRange, RANGES } from '../time.js';
import { artistByName, homeOf, saveShows, setHome, today, unwatch, upcomingShows, watch, watchesOf, type ShowInput } from './shows.js';

// A Model Context Protocol server, so an AI assistant can keep an eye out for shows by the artists a person watches.
// Stateless Streamable HTTP: each POST to /mcp carries one JSON-RPC message (or a batch) and gets a JSON answer.
// The person is whoever owns the access key; every tool works on their own watchlist, home and plays only.

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Spotify Trackerr keeps the artists this person wants to see live (their watchlist) and where they live.
To check for shows: call get_show_watchlist, search the web for each watched artist's upcoming concerts within the
person's travel distance of home, then call save_shows with every one you find. save_shows tells you which shows
are new; tell the person about the new ones (artist, date, venue, city, ticket link) and don't repeat ones already known.
Only save shows you found on a real listing (the artist's site, the venue, a ticket seller); never guess dates.`;

type Tool = {
	name: string;
	title: string;
	description: string;
	inputSchema: object;
	annotations?: object;
	run: (user: Row, args: any) => unknown;
};

const str = (description: string) => ({ type: 'string', description });

const TOOLS: Tool[] = [
	{
		name: 'get_show_watchlist',
		title: 'Get watched artists and home',
		description:
			"The person's watched artists (most played first, with genres), their home location and how many miles they'll travel, today's date in their time zone, and the upcoming shows already saved. Start here when checking for concerts near them.",
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true },
		run: (user) => {
			const home = homeOf(user.id);
			return {
				today: today(user.timezone),
				home: home.location ? { location: home.location, travel_miles: home.miles } : null,
				...(home.location ? {} : { note: "No home location is set yet. Ask the person where they live and call set_home, or ask them to set it on the app's Shows page." }),
				watched_artists: watchesOf(user.id).map((w) => ({ name: w.name, plays: w.plays, genres: w.genres })),
				known_upcoming_shows: upcomingShows(user.id, user.timezone).map(({ artist, date, venue, city, url }) => ({ artist, date, venue, city, url }))
			};
		}
	},
	{
		name: 'save_shows',
		title: 'Save shows found',
		description:
			'Saves upcoming shows found for watched artists so the person sees them on the Shows page. Returns which were new (tell the person about these), which were already saved, and which were rejected and why. A show is the same show when the artist, date and city match.',
		inputSchema: {
			type: 'object',
			properties: {
				shows: {
					type: 'array',
					maxItems: 100,
					items: {
						type: 'object',
						properties: {
							artist: str('Artist name, as on the watchlist.'),
							date: str("Show date, YYYY-MM-DD, in the venue's local time."),
							venue: str('Venue name.'),
							city: str('City, with state or country, e.g. "Austin, TX".'),
							url: str('Link to the listing or tickets (https://).'),
							note: str('Optional short note: festival name, support acts, on-sale date, distance from home.')
						},
						required: ['artist', 'date', 'venue', 'city']
					}
				}
			},
			required: ['shows']
		},
		run: (user, args) => {
			if (!Array.isArray(args?.shows)) throw new ToolError('shows must be a list.');
			const r = saveShows(user.id, user.timezone, (args.shows as ShowInput[]).slice(0, 100));
			return { new: r.saved.map(({ id, ...s }) => s), already_known: r.known, rejected: r.rejected };
		}
	},
	{
		name: 'watch_artist',
		title: 'Watch an artist',
		description: "Adds an artist to the person's watchlist so you look for their shows. Works for artists they haven't played here yet.",
		inputSchema: { type: 'object', properties: { artist: str('Artist name.') }, required: ['artist'] },
		run: (user, args) => {
			const a = artistByName(String(args?.artist ?? ''), true);
			if (!a) throw new ToolError('Give an artist name.');
			watch(user.id, a.id);
			return { watching: a.name };
		}
	},
	{
		name: 'unwatch_artist',
		title: 'Stop watching an artist',
		description: "Removes an artist from the person's watchlist. Shows already saved for them stay until they pass.",
		inputSchema: { type: 'object', properties: { artist: str('Artist name.') }, required: ['artist'] },
		annotations: { destructiveHint: true, idempotentHint: true },
		run: (user, args) => {
			const a = artistByName(String(args?.artist ?? ''), false);
			if (!a || !unwatch(user.id, a.id)) throw new ToolError(`${args?.artist} isn't on the watchlist.`);
			return { stopped_watching: a.name };
		}
	},
	{
		name: 'set_home',
		title: 'Set home location',
		description: 'Sets where the person lives and how far they will travel for a show. Shows within that distance of home count as near them.',
		inputSchema: {
			type: 'object',
			properties: { location: str('City and state or country, e.g. "New Orleans, LA".'), travel_miles: { type: 'number', minimum: 1, maximum: 3000, description: 'How many miles they will travel (default 100).' } },
			required: ['location']
		},
		annotations: { idempotentHint: true },
		run: (user, args) => {
			const location = String(args?.location ?? '').trim();
			if (!location) throw new ToolError('Give a location.');
			setHome(user.id, location, args?.travel_miles === undefined ? undefined : Number(args.travel_miles));
			const home = homeOf(user.id);
			return { location: home.location, travel_miles: home.miles };
		}
	},
	{
		name: 'top_artists',
		title: 'Top artists',
		description: "The person's most played artists from their Spotify history, with whether each is already watched. Useful for suggesting artists to watch.",
		inputSchema: {
			type: 'object',
			properties: {
				range: { type: 'string', enum: RANGES.map((r) => r.id), description: 'How far back to look (default 365d).' },
				limit: { type: 'number', minimum: 1, maximum: 100, description: 'How many artists (default 25).' }
			}
		},
		annotations: { readOnlyHint: true },
		run: (user, args) => {
			const range = parseRange(typeof args?.range === 'string' ? args.range : null, '365d');
			const until = Math.floor(Date.now() / 1000) + 1;
			const limit = Math.min(Math.max(Math.trunc(Number(args?.limit) || 25), 1), 100);
			const watched = new Set(watchesOf(user.id).map((w) => w.id));
			return top('artist', { ids: [user.id], since: range.secs ? until - range.secs : 0, until, rankBy: 'plays', tz: user.timezone }, limit).map((a) => ({
				name: a.name,
				plays: a.plays,
				watched: watched.has(a.id)
			}));
		}
	}
];

/** A tool failure to show the assistant (as an error result), rather than a protocol error. */
class ToolError extends Error {}

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

const ok = (id: Message['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: Message['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function answer(user: Row, m: Message) {
	if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return err(m?.id, -32600, 'Invalid request');
	switch (m.method) {
		case 'initialize': {
			const asked = m.params?.protocolVersion;
			return ok(m.id, {
				protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
				capabilities: { tools: {} },
				serverInfo: { name: 'spotify-trackerr', title: 'Spotify Trackerr', version: '1.0.0' },
				instructions: INSTRUCTIONS
			});
		}
		case 'ping':
			return ok(m.id, {});
		case 'tools/list':
			return ok(m.id, { tools: TOOLS.map(({ run, ...t }) => t) });
		case 'tools/call': {
			const tool = TOOLS.find((t) => t.name === m.params?.name);
			if (!tool) return err(m.id, -32602, `Unknown tool: ${m.params?.name}`);
			try {
				const result = tool.run(user, m.params?.arguments ?? {});
				return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
			} catch (e) {
				if (!(e instanceof ToolError)) console.error(`mcp ${tool.name} failed:`, e);
				return ok(m.id, { content: [{ type: 'text', text: e instanceof ToolError ? e.message : 'Something went wrong on the server.' }], isError: true });
			}
		}
		default:
			return err(m.id, -32601, `Method not found: ${m.method}`);
	}
}

/**
 * Answers a POSTed MCP message or batch for a signed-in person. Notifications and responses get no answer
 * (null), which the route turns into 202 Accepted.
 */
export function handleMcp(user: Row, body: unknown) {
	const one = (m: Message) => {
		if (m && typeof m === 'object' && !Array.isArray(m)) {
			// A response to a request we never send, or a notification such as notifications/initialized.
			if (!('method' in m) && ('result' in m || 'error' in m)) return null;
			if (typeof m.method === 'string' && !('id' in m)) return null;
		}
		return answer(user, m);
	};
	if (!Array.isArray(body)) return one(body as Message);
	const out = body.map(one).filter(Boolean);
	return out.length ? out : null;
}
