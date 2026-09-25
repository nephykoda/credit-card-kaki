#!/usr/bin/env node
// sgcards — Singapore credit card T&C archive & search (zero-dep, node 18+)
// Commands: list | fetch | check | grep | diff | add | ids
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(ROOT, "catalog");
const DATA = path.join(ROOT, "data");
const DOCS = path.join(DATA, "docs");
const MANIFEST = path.join(DATA, "manifest.json");
const UA = "Mozilla/5.0 (compatible; sgcards/0.1; +https://github.com/sgcards/sgcards)";

// ---------- catalog ----------
function loadCatalog() {
  const docs = [];
  for (const f of fs.readdirSync(CATALOG).filter((f) => f.endsWith(".json")).sort()) {
    const c = JSON.parse(fs.readFileSync(path.join(CATALOG, f), "utf8"));
    for (const d of c.issuerDocs || [])
      docs.push({ docId: `${c.issuer}/issuer/${d.type}`, issuer: c.issuer, card: null, type: d.type, label: d.label, url: d.url });
    for (const card of c.cards || [])
      for (const d of card.docs || [])
        docs.push({ docId: `${c.issuer}/card/${card.id}/${d.type}`, issuer: c.issuer, card: card.id, type: d.type, label: d.label, url: d.url, cardName: card.name });
  }
  return docs;
}

// ---------- manifest ----------
function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; }
}
function saveManifest(m) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
}

// ---------- http ----------
function curlDownload(url, headers) {
  const hf = path.join(os.tmpdir(), "sgcards-h-" + Date.now());
  const bf = hf + "-body";
  const args = ["-sSL", "--max-time", "60", "-D", hf, "-o", bf, "-A", UA];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push(url);
  const r = spawnSync("curl", args, { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(hf)) return null;
  const head = fs.readFileSync(hf, "utf8");
  fs.unlinkSync(hf);
  const h = (name) => (head.match(new RegExp(`^${name}: (.*)$`, "mi")) || [])[1]?.trim() || null;
  const buf = fs.existsSync(bf) ? fs.readFileSync(bf) : Buffer.alloc(0);
  fs.unlinkSync(bf);
  const statuses = [...head.matchAll(/^HTTP\/\S+ (\d+)/gm)].map((m) => parseInt(m[1], 10));
  const status = statuses.length ? statuses[statuses.length - 1] : buf.length ? 200 : 0;
  return {
    status,
    buf,
    etag: h("ETag") || h("Etag"),
    httpDate: h("Last-Modified") || new Date().toUTCString(),
    contentType: (h("Content-Type") || "").split(";")[0].trim().toLowerCase(),
    finalUrl: url,
  };
}

async function download(url, conditional, entry) {
  const headers = { "User-Agent": UA };
  if (conditional && entry?.current) {
    if (entry.current.etag) headers["If-None-Match"] = entry.current.etag;
    if (entry.current.fetchedHttpDate) headers["If-Modified-Since"] = entry.current.fetchedHttpDate;
  }
  let r;
  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    if (res.status === 304) return { status: 304 };
    r = {
      status: res.status,
      buf: Buffer.from(await res.arrayBuffer()),
      etag: res.headers.get("etag") || null,
      httpDate: res.headers.get("last-modified") || new Date().toUTCString(),
      contentType: (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
      finalUrl: res.url,
    };
  } catch {}
  // Some bank CDNs (e.g. UOB) 500 or drop node-fetch: retry via curl
  if (!r || r.status >= 500 || r.status === 0) {
    try { const c = curlDownload(url, headers); if (c && c.status < 500) r = c; } catch {}
  }
  return r;
}

// ---------- extraction ----------
function extFor(contentType, buf) {
  if (contentType.includes("pdf") || (buf.length > 4 && buf.slice(0, 4).toString() === "%PDF")) return "pdf";
  if (contentType.includes("html") || /<html|<!doctype/i.test(buf.slice(0, 400).toString())) return "html";
  return "txt";
}

function pdfToText(file) {
  const r = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0 && r.stdout.trim()) return r.stdout;
  return null;
}

function htmlToText(buf) {
  return buf
    .toString("utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim() + "\n";
}

async function exaExtract(url) {
  // Best-effort fallback when pdftotext is unavailable: Exa MCP extracts PDF text server-side (free, keyless).
  const MCP = "https://mcp.exa.ai/mcp";
  const call = async (body, sid) => {
    const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
    if (sid) headers["mcp-session-id"] = sid;
    const res = await fetch(MCP, { method: "POST", headers, body: JSON.stringify(body) });
    const sid2 = res.headers.get("mcp-session-id") || sid;
    const text = await res.text();
    let json = null;
    for (const line of text.split("\n")) if (line.startsWith("data: ")) { try { json = JSON.parse(line.slice(6)); } catch {} }
    if (!json && text.trim().startsWith("{")) json = JSON.parse(text);
    return { json, sid: sid2 };
  };
  try {
    const init = await call({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sgcards", version: "0.1" } } });
    await call({ jsonrpc: "2.0", method: "notifications/initialized" }, init.sid);
    const r = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_fetch_exa", arguments: { urls: [url], maxCharacters: 200000 } } }, init.sid);
    const out = (r.json?.result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return out.trim() ? out : null;
  } catch { return null; }
}

// ---------- sync ----------
async function syncDoc(doc, m, mode, out) {
  const entry = m[doc.docId];
  if (mode === "fetch" && entry?.current) return; // fetch = bootstrap missing docs only
  const conditional = mode === "check";
  let r;
  try { r = await download(doc.url, conditional, entry); }
  catch { r = null; }
  if (r?.status === 304) { out.push(`${doc.docId}: up-to-date`); return; }
  if (!r || r.status !== 200) {
    // Last resort when the issuer's CDN blocks direct download (e.g. Maybank/Akamai):
    // archive Exa's server-side extraction as a text-only version (hashable, diffable).
    const text = await exaExtract(doc.url);
    if (!text) { out.push(`${doc.docId}: ${r ? `HTTP ${r.status}` : "UNREACHABLE"} <- ${doc.url}`); return; }
    r = { status: 200, buf: Buffer.from(text), etag: null, httpDate: new Date().toUTCString(), contentType: "text/plain", finalUrl: doc.url, viaExa: true };
    out.push(`${doc.docId}: NOTE direct download blocked; archived Exa-extracted text (no original PDF)`);
  }

  await archiveVersion(doc, m, r, entry, out);
}

// Stamp bytes (from network, Exa, or a local import) into the versioned archive.
async function archiveVersion(doc, m, r, entry, out) {
  const ext = extFor(r.contentType, r.buf);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + new Date().toISOString().slice(11, 16).replace(":", "");
  const tmpBase = path.join(DOCS, doc.docId, `${stamp}-pending`);
  fs.mkdirSync(path.dirname(tmpBase), { recursive: true });
  fs.writeFileSync(tmpBase + "." + ext, r.buf);

  let text = null, how = null;
  if (ext === "pdf") { text = pdfToText(tmpBase + ".pdf"); how = text ? "pdftotext" : null; }
  else if (ext === "html") { text = htmlToText(r.buf); how = "html-strip"; }
  else { text = r.buf.toString("utf8"); how = r.viaExa ? "exa-fetch" : "raw"; }
  if (!text && ext === "pdf" && !r.viaImport) { text = await exaExtract(doc.url); how = text ? "exa" : null; }

  // Hash basis: raw bytes for PDFs (static files); extracted text otherwise —
  // dynamic HTML (nonces, timestamps) must not create phantom versions.
  const hash = createHash("sha256").update(ext === "pdf" ? r.buf : Buffer.from(text ?? r.buf)).digest("hex");
  const e = entry || (m[doc.docId] = { label: doc.label, url: doc.url, versions: [] });
  if (e.current?.hash === hash) {
    fs.rmSync(tmpBase + "." + ext, { force: true });
    e.current.etag = r.etag; e.current.fetchedHttpDate = r.httpDate;
    out.push(`${doc.docId}: unchanged`);
    return;
  }
  const base = path.join(DOCS, doc.docId, `${stamp}-${hash.slice(0, 8)}`);
  fs.renameSync(tmpBase + "." + ext, base + "." + ext);
  if (text) fs.writeFileSync(base + ".txt", text);

  const v = { hash, date: new Date().toISOString(), file: path.relative(ROOT, base + "." + ext), txt: text ? path.relative(ROOT, base + ".txt") : null, extract: how, url: doc.url, etag: r.etag, fetchedHttpDate: r.httpDate, finalUrl: r.finalUrl };
  e.url = doc.url; e.label = doc.label;
  e.versions.push(v); e.current = v;
  out.push(`${doc.docId}: ${entry ? "UPDATED (new version)" : "new"}${r.viaImport ? " (imported)" : ""} [${(r.buf.length / 1024).toFixed(0)}KB ${ext}${how ? ", txt via " + how : ", NO TEXT"}]`);
}

async function cmdImport(docs, m, docId, file) {
  if (!docId || !file) { console.error("usage: sgcards.mjs import <docId> <file>"); process.exit(2); }
  const doc = docs.find((d) => d.docId === docId);
  if (!doc) { console.error(`unknown docId '${docId}' — add it to the catalog first (see 'ids')`); process.exit(1); }
  if (!fs.existsSync(file)) { console.error(`file not found: ${file}`); process.exit(1); }
  const buf = fs.readFileSync(file);
  const sniff = buf.slice(0, 400).toString("latin1");
  const contentType = sniff.startsWith("%PDF") ? "application/pdf" : /<html|<!doctype/i.test(sniff) ? "text/html" : "text/plain";
  const out = [];
  await archiveVersion(doc, m, { status: 200, buf, contentType, etag: null, httpDate: new Date().toUTCString(), finalUrl: path.resolve(file), viaImport: true }, m[docId], out);
  saveManifest(m);
  out.forEach((l) => console.log(l));
}

// ---------- commands ----------
function filterDocs(docs, opt) {
  return docs.filter((d) => (!opt.issuer || d.issuer === opt.issuer) && (!opt.card || d.card === opt.card));
}

function cmdList(docs, m) {
  for (const issuer of [...new Set(docs.map((d) => d.issuer))]) {
    const ids = docs.filter((d) => d.issuer === issuer);
    const v = ids.filter((d) => m[d.docId]?.current).length;
    console.log(`${issuer} (${v}/${ids.length} docs local)`);
    for (const d of ids) {
      const cur = m[d.docId]?.current;
      console.log(`  ${d.docId}${cur ? `  [v${m[d.docId].versions.length}, ${cur.date.slice(0, 10)}]` : "  [not fetched]"}`);
    }
  }
}

function cmdGrep(docs, m, pattern, opt) {
  const re = new RegExp(pattern, "i");
  let hits = 0;
  for (const d of filterDocs(docs, opt)) {
    const e = m[d.docId];
    if (!e) continue;
    const files = opt.all ? e.versions.map((v) => v.txt) : [e.current?.txt];
    for (const rel of files.filter(Boolean)) {
      const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (re.test(line)) {
          hits++;
          console.log(`${rel}:${i + 1}: ${line.trim().slice(0, 300)}`);
        }
      });
    }
  }
  if (!hits) console.log(`no matches for /${pattern}/i`);
}

function cmdDiff(docs, m, docId) {
  const e = m[docId];
  if (!e || e.versions.length < 2) { console.error(`need >=2 versions of ${docId} (have ${e?.versions.length || 0})`); process.exit(1); }
  const [oldV, newV] = e.versions.slice(-2);
  if (!oldV.txt || !newV.txt) { console.error("one or both versions have no extracted text"); process.exit(1); }
  const r = spawnSync("diff", ["-u", path.join(ROOT, oldV.txt), path.join(ROOT, newV.txt)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  console.log(`diff ${oldV.date.slice(0, 10)} -> ${newV.date.slice(0, 10)} (${docId})`);
  console.log(r.stdout || "(no textual differences)");
}

async function cmdAdd(args) {
  const [issuer, scope, cardId, type, label, url] = args;
  if (!issuer || !["issuer", "card"].includes(scope) || (scope === "card" && !cardId) || !type || !label || !url) {
    console.error('usage: sgcards.mjs add <issuer> issuer - <type> "<label>" <url>\n       sgcards.mjs add <issuer> card <cardId> "<cardName>|-" <type> "<label>" <url>');
    console.error('   e.g. sgcards.mjs add dbs card dbs-altitude "DBS Altitude Card|-|rewards-tnc" ...');
    process.exit(2);
  }
  const file = path.join(CATALOG, `${issuer}.json`);
  const c = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { issuer, displayName: issuer, issuerDocs: [], cards: [] };
  const doc = { type, label, url };
  if (scope === "issuer") c.issuerDocs.push(doc);
  else {
    let card = c.cards.find((x) => x.id === cardId);
    if (!card) {
      const name = label.split("|")[1] || cardId;
      card = { id: cardId, name, docs: [] };
      c.cards.push(card);
    }
    card.docs.push(doc);
  }
  fs.mkdirSync(CATALOG, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
  console.log(`added ${doc.type} -> ${file}`);
}

// ---------- main ----------
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = { issuer: null, card: null, all: false };
  const flag = (name) => { const i = rest.indexOf(name); if (i === -1) return null; const v = rest[i + 1]; rest.splice(i, 2); return v; };
  opt.issuer = flag("--issuer"); opt.card = flag("--card");
  if (rest.includes("--all")) { opt.all = true; rest.splice(rest.indexOf("--all"), 1); }

  const docs = loadCatalog();
  const m = loadManifest();

  switch (cmd) {
    case "list": cmdList(docs, m); break;
    case "ids": docs.forEach((d) => console.log(d.docId)); break;
    case "fetch":
    case "check": {
      const targets = filterDocs(docs, opt);
      const out = [];
      for (const d of targets) {
        await syncDoc(d, m, cmd, out);
        await new Promise((r) => setTimeout(r, 150)); // be polite
      }
      saveManifest(m);
      out.forEach((l) => console.log(l));
      const bad = out.filter((l) => /HTTP|ERROR/.test(l));
      console.log(`\n${cmd} done: ${targets.length} docs, ${out.filter((l) => /updated|new/.test(l)).length} new versions${bad.length ? ", PROBLEMS:\n" + bad.join("\n") : ""}`);
      break;
    }
    case "grep": {
      const pattern = rest.join(" ").trim();
      if (!pattern) { console.error("usage: sgcards.mjs grep <pattern> [--issuer X] [--card Y] [--all]"); process.exit(2); }
      cmdGrep(docs, m, pattern, opt);
      break;
    }
    case "diff": cmdDiff(docs, m, rest[0]); break;
    case "import": await cmdImport(docs, m, rest[0], rest[1]); break;
    case "add": await cmdAdd(rest); break;
    default:
      console.error("sgcards — SG credit card T&C archive\nusage: sgcards.mjs <list|ids|fetch|check|grep|diff|import|add> [...]");
      console.error("  list / ids                     show catalog & local status / docIds\n  fetch [--issuer --card]        download docs not yet on disk (bootstrap)\n  check [--issuer --card]        conditional revalidation; versions changed docs\n  grep <re> [--issuer --card --all]  search extracted text (current versions, or --all)\n  diff <docId>                   diff latest two versions of a doc\n  import <docId> <file>          archive a locally saved copy (e.g. via your harness's browser)\n  add ...                        append a doc to the catalog");
      process.exit(2);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
