// Tamponne la version de l'app dans index.html : carte d'import (import map)
// qui ajoute ?v=VERSION à chaque module JS, et ?v= sur app.js.
// Chaque mise à jour charge ainsi TOUS les modules dans la même version,
// même si le cache HTTP du navigateur ou le CDN de GitHub Pages (10 min par
// fichier) ont encore d'anciens exemplaires : sans ça, un module récent
// pouvait importer un module ancien (« does not provide an export named… »).
// Usage : node tools/stamp-version.mjs   (après avoir changé APP_VERSION)
import fs from "fs";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const version = fs.readFileSync(path.join(root, "js/utils.js"), "utf8").match(/APP_VERSION = "(\d+)"/)[1];
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
if (!sw.includes(`skullcrusher-cache-v${version}"`)) {
  console.error(`service-worker.js n'est pas en v${version} (CACHE_NAME) : mets-le à jour.`);
  process.exit(1);
}
const modules = [
  ...fs.readdirSync(path.join(root, "js")).filter(f => f.endsWith(".js")).map(f => `js/${f}`),
  ...fs.readdirSync(path.join(root, "js/i18n")).filter(f => f.endsWith(".js")).map(f => `js/i18n/${f}`)
].sort();
const map = { imports: Object.fromEntries(modules.map(m => [`./${m}`, `./${m}?v=${version}`])) };
const block = `<!-- version:start (généré par tools/stamp-version.mjs) -->
<script type="importmap">
${JSON.stringify(map, null, 1)}
</script>
<script type="module" src="js/app.js?v=${version}"></script>
<!-- version:end -->`;
const indexPath = path.join(root, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
if (html.includes("<!-- version:start")) html = html.replace(/<!-- version:start[\s\S]*?<!-- version:end -->/, block);
else if (html.includes('<script type="module" src="js/app.js"></script>')) html = html.replace('<script type="module" src="js/app.js"></script>', block);
else { console.error("Emplacement du script app.js introuvable dans index.html"); process.exit(1); }
fs.writeFileSync(indexPath, html);
console.log(`index.html : v${version}, ${modules.length} modules versionnés.`);
