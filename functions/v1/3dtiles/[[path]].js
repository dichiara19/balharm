// Cloudflare Pages Function — Google Photorealistic 3D Tiles proxy.
//
// Mounted at /v1/3dtiles/* — the same path Google's root.json embeds in its
// child URIs. Cesium fetches the root from this same endpoint, then naturally
// resolves all child tiles against the page origin onto our function. No
// redirects or URL rewriting needed.
//
// The Google API key is read from env.GOOGLE_3DTILES_KEY (configured in
// Cloudflare Pages → Settings → Environment variables) so it is never
// shipped in client JS. The CDN cache stores tiles for 24h: subsequent
// visitors are served from the edge without invoking this function.

const UPSTREAM_BASE = "https://tile.googleapis.com/v1/3dtiles";
const TILE_CACHE_TTL_S = 86400; // 24h
const ROOT_CACHE_TTL_S = 60;    // root.json refreshes the session token

export async function onRequest({ request, env, params }) {
  const apiKey = env.GOOGLE_3DTILES_KEY;
  if (!apiKey) {
    return new Response("GOOGLE_3DTILES_KEY env var not configured on this Pages project", { status: 500 });
  }

  const subPath = Array.isArray(params.path) ? params.path.join("/") : (params.path || "root.json");
  const upstream = new URL(`${UPSTREAM_BASE}/${subPath}`);

  // Forward incoming query parameters (session token included after first call),
  // then add our key.
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

    response = new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: upstreamRes.headers,
    });
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    const isRoot = subPath === "" || subPath === "root.json" || subPath.endsWith("/root.json");
    response.headers.set(
      "Cache-Control",
      isRoot ? `public, max-age=${ROOT_CACHE_TTL_S}` : `public, max-age=${TILE_CACHE_TTL_S}, immutable`
    );
    response.headers.delete("set-cookie");

    if (response.ok) {
      response = response.clone();
      try { await cache.put(cacheKey, response.clone()); } catch (e) {}
    }
  }

  return response;
}
