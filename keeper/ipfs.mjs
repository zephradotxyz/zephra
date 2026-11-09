// IPFS for token metadata: logos + metadata JSON are pinned server-side, so the pinning key
// never reaches the browser. The launchpad stores only `ipfs://<metadata CID>` on-chain.
//
// Env:
//   IPFS_PROVIDER  pinata | local        (local = dev only: files kept in DATA_DIR, served by /ipfs/:cid)
//   PINATA_JWT     Pinata API JWT (scope: pinFileToIPFS, pinJSONToIPFS)
//   IPFS_GATEWAY   gateway used to fetch pinned content, default https://ipfs.io/ipfs/
//   DATA_DIR       where local files and the gateway cache live, default ./data
//   CORS_ORIGIN    allowed browser origin for uploads, default *
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PROVIDER = (process.env.IPFS_PROVIDER || "local").toLowerCase();
const JWT = process.env.PINATA_JWT || "";
const GATEWAY = (process.env.IPFS_GATEWAY || "https://ipfs.io/ipfs/").replace(/\/?$/, "/");
const DATA = path.resolve(process.env.DATA_DIR || new URL("./data", import.meta.url).pathname);
const STORE = path.join(DATA, "ipfs");
fs.mkdirSync(STORE, { recursive: true });

export const MAX_IMAGE = 1024 * 1024; // 1 MB decoded
export const MAX_BODY = 2 * 1024 * 1024;
const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", json: "application/json" };

// --- content sniffing: only images and JSON are ever stored or served (no SVG/HTML → no XSS)
export function sniff(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  if (buf.length > 6 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString())) return "gif";
  const head = buf.subarray(0, 64).toString().trimStart();
  if (head.startsWith("{")) { try { JSON.parse(buf.toString()); return "json"; } catch { /* not json */ } }
  return null;
}

// --- CIDv1 (raw codec, sha2-256), base32 — used by the local provider
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function cidRaw(buf) {
  const digest = crypto.createHash("sha256").update(buf).digest();
  return "b" + base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]));
}
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;
export const isCid = (s) => CID_RE.test(s);

// --- pinning
async function pinPinata(buf, kind, name) {
  if (!JWT) throw httpError(503, "IPFS is not configured on the server (PINATA_JWT missing)");
  let r;
  if (kind === "json") {
    r = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { authorization: `Bearer ${JWT}`, "content-type": "application/json" },
      body: JSON.stringify({ pinataContent: JSON.parse(buf.toString()), pinataMetadata: { name }, pinataOptions: { cidVersion: 1 } }),
    });
  } else {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: MIME[kind] }), name);
    fd.append("pinataMetadata", JSON.stringify({ name }));
    fd.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: { authorization: `Bearer ${JWT}` }, body: fd });
  }
  if (!r.ok) throw httpError(502, `Pinata ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  cachePut(j.IpfsHash, buf);
  return j.IpfsHash;
}
function pinLocal(buf) {
  const cid = cidRaw(buf);
  cachePut(cid, buf);
  return cid;
}
export async function pin(buf, name) {
  const kind = sniff(buf);
  if (!kind) throw httpError(415, "Only PNG, JPEG, WebP, GIF or JSON can be stored");
  if (kind !== "json" && buf.length > MAX_IMAGE) throw httpError(413, "Image is larger than 1 MB");
  return PROVIDER === "pinata" ? pinPinata(buf, kind, name) : pinLocal(buf);
}

// --- read path: local store / disk cache first, then the gateway
function cachePut(cid, buf) { try { fs.writeFileSync(path.join(STORE, cid), buf); } catch { /* cache is best-effort */ } }
export async function fetchCid(cid) {
  const file = path.join(STORE, cid);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (PROVIDER === "local") throw httpError(404, "not found");
  const r = await fetch(GATEWAY + cid, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw httpError(r.status === 404 ? 404 : 502, `gateway ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BODY) throw httpError(413, "too large");
  cachePut(cid, buf);
  return buf;
}

// --- launch bundle: logo + metadata JSON → ipfs://<metadata CID>
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const url = (s) => { const v = clean(s, 200); return /^https:\/\/[^\s<>"']+$/i.test(v) ? v : ""; };
export async function pinLaunch(body) {
  const name = clean(body.name, 32), symbol = clean(body.symbol, 10).toUpperCase();
  if (!name || !symbol) throw httpError(400, "name and symbol are required");
  let image = "";
  if (body.image) {
    const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image));
    if (!m) throw httpError(400, "image must be a PNG, JPEG, WebP or GIF data URI");
    const buf = Buffer.from(m[2], "base64");
    image = "ipfs://" + (await pin(buf, `${symbol}-logo`));
  }
  const meta = {
    name, symbol,
    description: clean(body.description, 500),
    image,
    external_url: url(body.website),
    links: { website: url(body.website), x: url(body.x), telegram: url(body.telegram) },
    platform: "zephra.xyz",
    version: 1,
  };
  const metaCid = await pin(Buffer.from(JSON.stringify(meta)), `${symbol}-metadata.json`);
  return { metadataURI: `ipfs://${metaCid}`, imageURI: image, metadata: meta };
}

// --- tiny per-IP rate limit for uploads
const hits = new Map();
export function rateLimited(ip, limit = 30, windowMs = 3_600_000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(ip, arr);
  return arr.length > limit;
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
export const contentType = (buf) => MIME[sniff(buf)] || null;
export const ipfsInfo = () => ({ provider: PROVIDER, configured: PROVIDER === "local" || !!JWT, gateway: GATEWAY });
