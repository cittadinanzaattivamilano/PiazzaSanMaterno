// Costruisce dist/index.html: legge le firme da Tally, calcola totali, Municipi e commenti
// e li inserisce nel template. Nessun nome o dato personale finisce nella pagina.
import fs from "node:fs";

const FORM_ID = "5XXDl6";
// Firme arrivate dopo questa data usano il modulo nuovo (Municipio, senza CAP).
// Quelle precedenti sono in data/legacy.json.
const CUTOFF = Date.parse("2026-10-30T13:32:00Z");
const MAX_COMMENT = 1200;

const key = process.env.TALLY_API_KEY || "";
const exclude = (process.env.EXCLUDE_NAMES || "")
  .split(",").map((n) => norm(n)).filter(Boolean);
const legacy = JSON.parse(fs.readFileSync("data/legacy.json", "utf8"));

function norm(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

async function fetchAll() {
  const subs = [];
  let questions = [];
  for (let page = 1; page < 200; page++) {
    const res = await fetch(`https://api.tally.so/forms/${FORM_ID}/submissions?page=${page}&limit=100&filter=completed`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Tally API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (page === 1) questions = data.questions || [];
    subs.push(...(data.submissions || []));
    if (!data.hasMore) break;
  }
  return { subs, questions };
}

// Mappa id opzione -> testo, cercando in tutta la struttura delle domande
function optionMap(questions) {
  const map = new Map();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o.id === "string" && (o.text || o.label || o.name) && typeof (o.text || o.label || o.name) === "string") {
      map.set(o.id, o.text || o.label || o.name);
    }
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

function build({ subs, questions }) {
  const map = optionMap(questions);
  const qs = questions.map((q) => ({ id: q.id, label: norm(q.title || q.label || "") }));
  const find = (re) => qs.find((q) => re.test(q.label))?.id;
  const qName = find(/chiami/), qMun = find(/municipio/), qWhy = find(/sostieni/);
  // il consenso alla pubblicazione e' la casella sotto "Il tuo commento"
  const qPub = qs.find((q) => q.label === "il tuo commento")?.id;

  const seen = new Set(exclude);
  const mun = { ...legacy.municipi };
  let total = legacy.total;
  const comments = [];

  const fresh = subs
    .map((s) => ({ s, t: Date.parse(s.submittedAt || s.createdAt || 0) }))
    .filter((x) => x.t > CUTOFF)
    .sort((a, b) => a.t - b.t); // dal piu' vecchio: vale la prima firma di ogni persona

  for (const { s } of fresh) {
    const byQ = new Map((s.responses || []).map((r) => [r.questionId, r.answer]));
    const name = norm(answerStrings(byQ.get(qName), map).join(" "));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    total += 1;

    const m = answerStrings(byQ.get(qMun), map).find((x) => /^Municipio [1-9]$|^Fuori Milano$/.test(x));
    if (m) mun[m] = (mun[m] || 0) + 1;

    const why = answerStrings(byQ.get(qWhy), map).join(" ").replace(/\s+/g, " ").trim();
    const ok = answerStrings(byQ.get(qPub), map).length > 0;
    if (why && ok) comments.push({ m: m || null, ok: true, t: why.slice(0, MAX_COMMENT) });
  }

  const fmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
  return `var UPDATED = ${JSON.stringify(fmt.format(new Date()))};
var TOTAL = ${total};
var MUNICIPI = ${JSON.stringify(mun)};
var COMMENTS = ${JSON.stringify([...comments.reverse(), ...legacy.comments])};`;
}

let block;
if (!key) {
  console.warn("TALLY_API_KEY assente: pubblico solo i dati iniziali.");
  block = build({ subs: [], questions: [] });
} else {
  block = build(await fetchAll());
}
// evita che un commento chiuda lo script
block = block.split("</").join("<\\/").split(String.fromCharCode(0x2028)).join(" ").split(String.fromCharCode(0x2029)).join(" ");

fs.mkdirSync("dist", { recursive: true });
for (const [src, out] of [["index.template.html", "dist/index.html"]]) {
  const tpl = fs.readFileSync(src, "utf8");
  if (!tpl.includes("/*@@DATA@@*/")) throw new Error("Segnaposto dati mancante nel template " + src);
  fs.writeFileSync(out, tpl.replace("/*@@DATA@@*/", () => block));
}
console.log("Pagina costruita.");
