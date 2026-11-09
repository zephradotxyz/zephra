// Local failover RPC proxy: sends each JSON-RPC request to several public Elysium endpoints
// at once and returns the first valid answer. Retries until one answers.
// Usage: node scripts/rpc-proxy.js   (listens on 127.0.0.1:8599)
const http = require("http");
const UP = (process.env.UPSTREAMS || "https://node.eleos.fun,https://rpc-live.elysp.com,https://rpc.elyscan.live,https://obol-rpc.fly.dev").split(",");
const TRY_MS = 12000, ROUNDS = 6;

async function one(url, body) {
  try { return await one0(url, body); } catch (e) { console.log(new Date().toISOString().slice(11,19), url.slice(8,24), JSON.parse(body).method, String(e.message).slice(0,100)); throw e; }
}
async function one0(url, body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), body.includes("sendRawTransaction") ? 60000 : TRY_MS);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ac.signal });
    const txt = await r.text();
    const j = JSON.parse(txt);
    const items = Array.isArray(j) ? j : [j];
    // upstream-overload errors count as failures so another endpoint gets a turn
    if (items.some((x) => x.error && /unavailable|relays eleos|caught up|insufficient funds|rate|limit|timeout|busy|internal/i.test(x.error.message || ""))) throw new Error("upstream error: " + JSON.stringify(items.find((x) => x.error).error).slice(0,120));
    return txt;
  } finally { clearTimeout(t); }
}

async function forward(body) {
  for (let i = 0; i < ROUNDS; i++) {
    try { return await Promise.any(UP.map((u) => one(u, body))); } catch { await new Promise((r) => setTimeout(r, 1000 * (i + 1))); }
  }
  throw new Error("all upstreams failed");
}

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const out = await forward(Buffer.concat(chunks).toString());
      res.setHeader("content-type", "application/json");
      res.end(out);
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: e.message } }));
    }
  });
}).listen(8599, "127.0.0.1", () => console.log("rpc proxy on :8599 ->", UP.join(", ")));
