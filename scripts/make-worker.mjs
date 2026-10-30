// Genera worker/worker.js inserendo i dati iniziali (data/legacy.json) nel modello worker/worker.template.js
import fs from "node:fs";
const legacy = fs.readFileSync("data/legacy.json", "utf8");
const tpl = fs.readFileSync("worker/worker.template.js", "utf8");
fs.writeFileSync("worker/worker.js", tpl.replace("/*@@LEGACY@@*/null", () => JSON.stringify(JSON.parse(legacy))));
console.log("worker/worker.js generato.");
