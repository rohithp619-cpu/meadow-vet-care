// Meadow Vet Care — static file server + streaming chat endpoint.
// Serves the marketing site and /chat SPA, and proxies POST /api/chat to
// Google's Gemini API (streaming). Zero dependencies.
//
//   npm run dev   → http://localhost:4173
//
// Requires GEMINI_API_KEY (see .env.example). Model is configurable via
// GEMINI_MODEL (default: gemini-3-flash-preview).

import { createServer } from "node:http";
import { readFile, readFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

// ---- minimal .env loader (no override of real env) --------------------------
function loadEnv() {
  try {
    const text = readFileSync(join(ROOT, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trimStart().startsWith("#")) continue;
      let [, k, v] = m;
      v = v.replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* no .env — fine */ }
}
loadEnv();

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

// ---- system prompt, built from the live services sheet + site content ------
function formatCatalogue(services) {
  const byCategory = new Map();
  for (const s of services) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category).push(s);
  }
  const lines = [];
  for (const category of [...byCategory.keys()].sort()) {
    lines.push(`\n## ${category}`);
    for (const s of byCategory.get(category)) {
      const price = s.priceEur != null ? `€${s.priceEur}` : "price on request";
      const duration = s.durationMin ? `${s.durationMin} min` : "duration varies";
      const access = s.requiresAppointment
        ? `${s.slotsThisWeek} slot${s.slotsThisWeek === 1 ? "" : "s"} left this week`
        : "walk-in, no appointment needed";
      const offer = s.specialOffer ? `, offer: ${s.specialOffer}` : "";
      lines.push(`- ${s.name} — ${s.species}: ${price}, ${duration}, ${s.availability}, ${access}${offer}`);
    }
  }
  return lines.join("\n");
}

function buildSystemPrompt() {
  let services = [];
  let content = {};
  try { services = JSON.parse(readFileSync(join(ROOT, "services.json"), "utf8")); } catch {}
  try { content = JSON.parse(readFileSync(join(ROOT, "content.json"), "utf8")); } catch {}

  const v = content.visit || {};
  const hours = (v.hours || []).map((h) => `${h.days}: ${h.time}`).join("; ");
  const addr = v.address ? `${v.address.line1}, ${v.address.line2}` : "12 Meadow Lane, Dublin, Ireland";
  const phone = v.phone?.label || "+353 1 000 0000";
  const email = (v.email?.href || "mailto:hello@meadowvet.ie").replace("mailto:", "");
  const speciesList = [...new Set(services.map((s) => s.species))];

  return `You are Meadow, the friendly AI assistant for Meadow Vet Care, a modern Irish veterinary clinic.

ABOUT THE CLINIC
- We treat: ${speciesList.join(", ") || "dogs, cats, rabbits, small mammals and birds"}.
- Address: ${addr}
- Phone: ${phone}
- Email: ${email}
- Opening hours: ${hours || "Mon–Fri 8am–8pm; Sat 9am–5pm; Sun emergencies only"}.

OUR SERVICES — live data (${services.length} entries)
This is our current catalogue. Read each line as: service name — species: price, appointment length, days available, how many appointment slots are left THIS WEEK (or "walk-in"), and any current offer.
${formatCatalogue(services)}

HOW TO USE THE CATALOGUE
- Answer questions about what we offer, prices, appointment length, which days a service runs, live slots left this week, and current special offers — using ONLY the data above.
- Match the pet the person mentions: a dog owner only wants the "Dog" rows. The same service is often priced differently per species, so always use the row for their animal.
- If we don't list a service for their pet, say we don't currently offer it for that animal and suggest they call.
- Prices are in euro and are guideline prices — always say the final price is confirmed at booking.
- If a service shows 0 slots left this week, tell them it's fully booked this week and offer to help them call for the next available time.
- Mention a relevant special offer when one applies. NEVER invent services, prices, slot numbers or offers that aren't in the data.

YOUR JOB
- Help visitors understand our services, pick the right appointment, and book.
- Give calm, general pet-care information for the animals we treat.

TONE
- Warm, plain English, a little Irish charm. Unhurried and reassuring. Keep answers concise.
- Use light Markdown (short lists, bold) when it helps readability.

HARD RULES
- Never diagnose a condition or prescribe/recommend specific medication or dosages.
- For anything urgent or worrying (trouble breathing, collapse, not eating, suspected poisoning, injury, a pet in distress), tell the person to call the clinic now on ${phone} — do not attempt to assess it yourself.
- If asked something not covered by the data above (a specific vet's availability, anything not listed), say so and point them to call or email.`;
}

// ---- static file serving ----------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function sendFile(res, filePath) {
  readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

function serveStatic(req, res, pathname) {
  // Clean routes for the two HTML apps.
  if (pathname === "/" || pathname === "/index.html") return sendFile(res, join(ROOT, "index.html"));
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return sendFile(res, join(ROOT, "chat.html"));
  if (pathname === "/services") return sendFile(res, join(ROOT, "services.html"));

  // Otherwise map to a real file, guarding against path traversal.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
  // Never expose server internals or secrets.
  if (/(^|[/\\])(\.env|server\.mjs|node_modules)([/\\]|$)/.test(safe)) { res.writeHead(404); res.end("Not found"); return; }
  sendFile(res, filePath);
}

// ---- chat endpoint ----------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function handleChat(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "The server has no GEMINI_API_KEY. Add one to .env (see .env.example) and restart." }));
    return;
  }

  let messages;
  try {
    ({ messages } = JSON.parse(await readBody(req)));
    if (!Array.isArray(messages)) throw new Error("messages must be an array");
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad request: " + e.message }));
    return;
  }

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: messages
      .filter((m) => m && typeof m.content === "string")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:streamGenerateContent?alt=sse`;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(body)
    });
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Could not reach Gemini: " + e.message }));
    return;
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    let msg = `Gemini error (${upstream.status})`;
    try { msg = JSON.parse(detail)?.error?.message || msg; } catch {}
    res.writeHead(upstream.status === 429 ? 429 : 502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
    return;
  }

  // Relay the model's text to the client as a plain UTF-8 stream.
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const parts = json.candidates?.[0]?.content?.parts || [];
          for (const p of parts) if (p.text) res.write(p.text);
        } catch { /* skip partial/non-JSON lines */ }
      }
    }
  } catch { /* client disconnected or stream broke — just end */ }
  res.end();
}

// ---- server -----------------------------------------------------------------
createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === "/api/chat") {
    if (req.method !== "POST") { res.writeHead(405); res.end("Method not allowed"); return; }
    handleChat(req, res).catch((e) => {
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
      else res.end();
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end("Method not allowed"); return; }
  serveStatic(req, res, pathname);
}).listen(PORT, () => {
  console.log(`Meadow Vet Care running at http://localhost:${PORT}`);
  console.log(GEMINI_KEY ? `Chat model: ${GEMINI_MODEL}` : "⚠  No GEMINI_API_KEY set — chat will return an error until you add one to .env");
});
