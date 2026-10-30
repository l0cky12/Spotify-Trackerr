import { userFromApiToken } from '#lib/server/auth.js';
import { handleMcp } from '#lib/server/mcp.js';

// The MCP server for AI assistants (see mcp.ts). Signs in with an access key from Settings → AI assistant, sent as
// "Authorization: Bearer <key>", or as ?key=<key> for apps that only take an address.
export async function POST({ request, url }) {
	const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
	const user = userFromApiToken(bearer ?? url.searchParams.get('key'));
	if (!user) return new Response('Make an access key in Settings → AI assistant.', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
	}
	const reply = handleMcp(user, body);
	return reply ? Response.json(reply) : new Response(null, { status: 202 });
}

// No server-to-client stream and no sessions to end.
export const GET = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
export const DELETE = GET;
