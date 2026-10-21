// Прокси Vercel-функции: /api/*, /img/* -> origin (y2be.duckdns.org)
// с заголовком X-Origin-Secret. Клиент видит только этот домен;
// 3xx от origin не транслируем (redirect: manual -> станет 502 у fetch,
// точнее отдадим ошибку сами). Статусы/заголовки — канонический Node.
const ALLOWED_PREFIXES = ["/api/", "/img/"];

export default async function handler(req, res) {
  const fail = (code, msg) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ detail: msg }));
  };

  const ORIGIN = process.env.ORIGIN_URL;
  const SECRET = process.env.ORIGIN_SECRET;

  if (!ORIGIN || !SECRET) return fail(500, "proxy not configured");

  const url = new URL(req.url, "http://x");
  const allowed = ALLOWED_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (!allowed) return fail(404, "not found");
  const target = ORIGIN + url.pathname + url.search;

  const headers = {
    "X-Origin-Secret": SECRET,
    "Accept": req.headers.accept || "*/*",
    "User-Agent": req.headers["user-agent"] || "proxy",
  };
  if (req.headers.range) headers.Range = req.headers.range;
  const ct = req.headers["content-type"];
  if (ct) headers["Content-Type"] = ct;

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
    for (const h of ["content-type", "content-length", "content-range",
                     "accept-ranges", "etag", "cache-control", "last-modified"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.statusCode = upstream.status;
    if (req.method === "HEAD") return res.end();
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return fail(502, "origin unreachable");
  }
}
