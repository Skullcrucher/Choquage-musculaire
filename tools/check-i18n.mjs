// Vérifie les traductions : node tools/check-i18n.mjs [--scan]
//  - liste les textes t("...") / tn(n, "...", "...") absents d'un dictionnaire ;
//  - --scan : repère les textes français probablement non passés par t().
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const jsDir = path.join(root, "js");
const files = fs.readdirSync(jsDir).filter(f => f.endsWith(".js") && f !== "exercise-guides.js" && f !== "i18n.js");
const keys = new Map();
const strRe = /"((?:[^"\\]|\\.)*)"/g;
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.set(JSON.parse(`"${m[1]}"`), f);
  for (const m of src.matchAll(/\btn\([^"]*?,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)) {
    keys.set(JSON.parse(`"${m[1]}"`), f); keys.set(JSON.parse(`"${m[2]}"`), f);
  }
  // Tableaux de libellés à traduire à l'affichage : // i18n-keys: "a", "b"
  for (const m of src.matchAll(/\/\/ i18n-keys:(.*)/g)) for (const s of m[1].matchAll(strRe)) keys.set(JSON.parse(`"${s[1]}"`), f);
}
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.set(m[1], "index.html");

let missingTotal = 0;
for (const lang of ["en", "mfe", "pl"]) {
  const dict = (await import(pathToFileURL(path.join(jsDir, "i18n", `${lang}.js`)).href)).default;
  const missing = [...keys.keys()].filter(k => dict[k] == null || dict[k] === "");
  const extra = Object.keys(dict).filter(k => !keys.has(k));
  missingTotal += missing.length;
  console.log(`${lang}: ${keys.size - missing.length}/${keys.size} traduits` + (extra.length ? ` (${extra.length} entrée(s) inutilisée(s))` : ""));
  if (missing.length) console.log("  manquants :\n" + missing.map(k => `    ${JSON.stringify(k)}  [${keys.get(k)}]`).join("\n"));
  if (extra.length && process.argv.includes("--extra")) console.log("  inutilisées :\n" + extra.map(k => "    " + JSON.stringify(k)).join("\n"));
}

if (process.argv.includes("--scan")) {
  const fr = /[éèêàùçôîœ]|\b(le|la|les|des|une?|pour|avec|dans|pas|ton|ta|tes|Séance|série)\b/i;
  let n = 0;
  for (const f of files) {
    fs.readFileSync(path.join(jsDir, f), "utf8").split("\n").forEach((line, i) => {
      const l = line.trim();
      if (!l || l.startsWith("//") || l.startsWith("*") || /console\.|i18n-keys|import |\bt\(|\btn\(/.test(l)) return;
      const texts = [...l.matchAll(/>([^<>${}]*[A-Za-zÀ-ÿ][^<>${}]*)</g)].map(m => m[1].trim())
        .concat([...l.matchAll(/(?:textContent|placeholder|title|label|toast\(|confirm\(|Error\()\s*[=:(]?\s*"([^"]+)"/g)].map(m => m[1]));
      const bad = texts.filter(s => s && fr.test(s));
      if (bad.length) { n++; console.log(`${f}:${i + 1}: ${bad.join(" | ").slice(0, 140)}`); }
    });
  }
  console.log(`--scan : ${n} ligne(s) suspecte(s)`);
}
process.exit(missingTotal ? 1 : 0);
