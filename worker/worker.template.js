// Cloudflare Worker: legge le firme da Tally e restituisce SOLO totale, conteggi per Municipio
// e commenti con consenso alla pubblicazione. Nessun nome esce da qui.
// Segreti da impostare nel pannello Cloudflare: TALLY_API_KEY (obbligatorio), EXCLUDE_NAMES (facoltativo).

const FORM_ID = "5XXDl6";
const CUTOFF = Date.parse("2026-10-30T13:32:00Z"); // prima: dati in LEGACY (modulo vecchio, con CAP)
const MAX_COMMENT = 1200;
const CACHE_SECONDS = 30;
const ALLOWED_ORIGIN = "https://cittadinanzaattivamilano.github.io";
const LEGACY = /*@@LEGACY@@*/null;

// Commenti arrivati quando la casella del permesso era in fondo al modulo (fino al 31/10 ore 18:35):
// verificati a mano, senza dati personali, pubblicati per scelta degli organizzatori. Chi vuole puo' chiederne la rimozione per email.
const PUBLISH_IDS = new Set(["5XaYWxd", "X567dAe", "Nq2x0bb", "zE8Aerq", "Nq2veNN", "WJaXkqN", "1WQz57l", "o98YzWe", "4alR1o5", "GeOaJQj", "VpWXJ6M", "4alR4Md", "Nq29KNO", "kb8QMb1", "la89dgo", "je8Y1bQ"]);

function norm(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

async function fetchAll(key) {
  const subs = [];
  let questions = [];
  for (let page = 1; page < 50; page++) {
    const res = await fetch(`https://api.tally.so/forms/${FORM_ID}/submissions?page=${page}&limit=100&filter=completed`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error("tally " + res.status);
    const data = await res.json();
    if (page === 1) questions = data.questions || [];
    subs.push(...(data.submissions || []));
    if (!data.hasMore) break;
  }
  return { subs, questions };
}

function optionMap(questions) {
  const map = new Map();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    const t = o.text || o.label || o.name;
    if (typeof o.id === "string" && typeof t === "string") map.set(o.id, t);
    Object.values(o).forEach(walk);
  };
  walk(questions);
  return map;
}

function answerStrings(answer, map) {
  const out = [];
  const add = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(add);
    if (typeof v === "object") return add(v.text || v.label || v.name || v.value);
    const t = String(v);
    out.push(map.get(t) || t);
  };
  add(answer);
  return out.filter((s) => s.trim() !== "");
}

function compute({ subs, questions }, exclude) {
  const map = optionMap(questions);
  const qs = questions.map((q) => ({ id: q.id, label: norm(q.title || q.label || "") }));
  const find = (re) => qs.find((q) => re.test(q.label))?.id;
  const qName = find(/chiami/), qMun = find(/municipio/), qWhy = find(/sostieni/);
  const qPub = qs.find((q) => q.label === "il tuo commento")?.id;

  const seen = new Set(exclude);
  const mun = { ...LEGACY.municipi };
  let total = LEGACY.total;
  const comments = [];

  const fresh = subs
    .map((s) => ({ s, t: Date.parse(s.submittedAt || s.createdAt || 0) }))
    .filter((x) => x.t > CUTOFF)
    .sort((a, b) => a.t - b.t);

  for (const { s } of fresh) {
    const byQ = new Map((s.responses || []).map((r) => [r.questionId, r.answer]));
    const name = norm(answerStrings(byQ.get(qName), map).join(" "));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    total += 1;
    const m = answerStrings(byQ.get(qMun), map).find((x) => /^Municipio [1-9]$|^Fuori Milano$/.test(x));
    if (m) mun[m] = (mun[m] || 0) + 1;
    const why = answerStrings(byQ.get(qWhy), map).join(" ").replace(/\s+/g, " ").trim();
    const ok = answerStrings(byQ.get(qPub), map).length > 0 || PUBLISH_IDS.has(s.id);
    if (why && ok) comments.push({ m: m || null, ok: true, t: why.slice(0, MAX_COMMENT) });
  }

  const fmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
  return {
    updated: fmt.format(new Date()),
    total,
    municipi: mun,
    comments: [...comments.reverse(), ...LEGACY.comments],
  };
}

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET" } });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/", { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), ...cors } });

    try {
      if (!env.TALLY_API_KEY) throw new Error("missing key");
      const exclude = (env.EXCLUDE_NAMES || "").split(",").map(norm).filter(Boolean);
      const body = JSON.stringify(compute(await fetchAll(env.TALLY_API_KEY), exclude));
      const res = new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return new Response(body, { headers: { ...Object.fromEntries(res.headers), ...cors } });
    } catch (e) {
      return new Response(JSON.stringify({ error: "unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
      });
    }
  },
};
