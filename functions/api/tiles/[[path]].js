// Cloudflare Pages Function — Google Photorealistic 3D Tiles proxy.
//
// Routes:
//   /api/tiles/root.json       → https://tile.googleapis.com/v1/3dtiles/root.json
//   /api/tiles/<sub-path>      → forwarded as-is (recursive tile fetches)
//
// The caller's query string is preserved (Cesium passes a session token after
// the first response). The Google API key is read from the worker environment
// (set in Cloudflare dashboard → Pages project → Settings → Environment
// variables → GOOGLE_3DTILES_KEY) so it is never shipped in client JS.
//
// Cloudflare's edge cache stores each response for 24 hours: after a tile is
// fetched once, every subsequent visitor gets it without invoking the function
// (no quota consumption). Tiles are immutable for the same session token so
// `immutable` is safe.

const UPSTREAM_BASE = "https://tile.googleapis.com/v1/3dtiles";
const TILE_CACHE_TTL_S = 86400; // 24h
const ROOT_CACHE_TTL_S = 60;    // root.json refreshes the session token

export async function onRequest({ request, env, params }) {
  const apiKey = env.GOOGLE_3DTILES_KEY;
  if (!apiKey) {
    return new Response("GOOGLE_3DTILES_KEY env var not configured on this Pages project", { status: 500 });
  }

  let subPath = Array.isArray(params.path) ? params.path.join("/") : (params.path || "root.json");
  // Google's root.json hands back absolute paths beginning with /v1/3dtiles/*.
  // The _redirects file maps those onto this function, so we may receive a
  // sub-path that already starts with "v1/3dtiles/" — strip it before forwarding.
  if (subPath.startsWith("v1/3dtiles/")) {
    subPath = subPath.slice("v1/3dtiles/".length);
  }
  const upstream = new URL(`${UPSTREAM_BASE}/${subPath}`);

  // Forward incoming query parameters (session token included), then add our key.
  const incoming = new URL(request.url);
  for (const [k, v] of incoming.searchParams) upstream.searchParams.set(k, v);
  upstream.searchParams.set("key", apiKey);

  // Use Cloudflare's edge cache.
  const cacheKey = new Request(upstream.toString(), { method: "GET" });
  const cache = caches.default;
  let response = await cache.match(cacheKey);

  if (!response) {
    const upstreamRes = await fetch(upstream.toString(), {
      method: request.method,
      headers: { "User-Agent": "Bal'harm/1.0 (Cloudflare Pages Function)" },
    });

    // Build a fresh response so we can rewrite headers (CORS, cache).
    response = new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: upstreamRes.headers,
    });
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    const isRoot = subPath.endsWith("root.json") || subPath === "";
    response.headers.set(
      "Cache-Control",
      isRoot ? `public, max-age=${ROOT_CACHE_TTL_S}` : `public, max-age=${TILE_CACHE_TTL_S}, immutable`
    );
    // Strip the Google session cookie if present.
    response.headers.delete("set-cookie");

    if (response.ok) {
      // Fire-and-forget cache put (don't block the response).
      response = response.clone();
      try { await cache.put(cacheKey, response.clone()); } catch (e) {}
    }
  }

  return response;
}
