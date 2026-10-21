/* Where the stock music library is served from.
 *
 * It lives in `shared` rather than in `@maleo/stock` — which owns the rest of
 * the music library — because the WEB app needs it too, and the web app must not
 * depend on `stock` (a server package). `stock` re-exports it, so there is still
 * one spelling of the host and the dependency runs shared -> stock, never the
 * other way.
 *
 * The reason the web needs it at all: the bucket sends no CORS header, so audio
 * from here can be played but not DECODED, and the timeline has to rewrite such
 * a url to a same-origin passthrough before drawing a waveform. */
/** Placeholder only; deployments should set STOCK_MUSIC_HOST or STOCK_MUSIC_BASE_URL. */
export const MUSIC_PUBLIC_HOST = "https://media.example.com";
