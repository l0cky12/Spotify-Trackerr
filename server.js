// Production entry. Accepts only the addresses in ALLOWED_HOSTS and tells SvelteKit which one
// (scheme included) each request came in on, so sign-in redirects and CSRF checks use the right origin
// whether the request arrived through Tailscale, Cloudflare Tunnel or 127.0.0.1.
import http from 'node:http';
import { handler } from './build/handler.js';

const allowed = new Map(
	(process.env.ALLOWED_HOSTS ?? 'http://127.0.0.1:3000')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean)
		.map((o) => {
			const u = new URL(o);
			return [u.host, u.protocol.slice(0, -1)];
		})
);

const port = Number(process.env.PORT ?? 3000);
http
	.createServer((req, res) => {
		const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
		const proto = allowed.get(host);
		if (!proto) {
			res.writeHead(421, { 'Content-Type': 'text/plain' });
			return res.end(`${host} isn't in ALLOWED_HOSTS.`);
		}
		req.headers['x-forwarded-host'] = host;
		req.headers['x-forwarded-proto'] = proto;
		handler(req, res);
	})
	.listen(port, () => console.log(`Spotify Trackerr listening on :${port} for ${[...allowed.keys()].join(', ')}`));
