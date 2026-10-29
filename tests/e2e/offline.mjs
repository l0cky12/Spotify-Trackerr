// Background artwork lookups must not call real music services during browser tests.
globalThis.fetch = async () => new Response('Offline test service', { status: 503 });
