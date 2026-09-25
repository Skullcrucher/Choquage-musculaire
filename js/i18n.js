// ============================================================
// LANGUES — français (référence), anglais, créole mauricien, polonais
//
// Le texte français sert de clé : t("Séance terminée") renvoie la
// traduction de la langue choisie, ou le français s'il en manque une.
// Paramètres : t("{n} séries", { n: 3 }). Une traduction peut être une
// fonction (params) => texte, pour les pluriels (le polonais en a trois).
// Vérification : node tools/check-i18n.mjs liste les textes non traduits.
// ============================================================
import en from "./i18n/en.js";
import mfe from "./i18n/mfe.js";
import pl from "./i18n/pl.js";

export const LANGS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "mfe", label: "Kreol morisien" },
  { code: "pl", label: "Polski" }
];
const DICTS = { en, mfe, pl };
const LOCALES = { fr: "fr-FR", en: "en-GB", mfe: "fr-MU", pl: "pl-PL" };
const LS_LANG = "skullcrusher_lang";

function detect() {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (saved && (saved === "fr" || DICTS[saved])) return saved;
  } catch (_) {}
  const nav = (navigator.language || "fr").toLowerCase();
  if (nav.startsWith("pl")) return "pl";
  if (nav.startsWith("mfe")) return "mfe";
  if (nav.startsWith("en")) return "en";
  return "fr";
}

let lang = detect();
document.documentElement.lang = lang;

export function getLang() {
  return lang;
}

// Locale pour les dates et nombres (Intl ne connaît pas le créole : on
// utilise le français de Maurice).
export function locale() {
  return LOCALES[lang] || "fr-FR";
}

export function t(fr, params) {
  let out = lang === "fr" ? fr : DICTS[lang]?.[fr];
  if (typeof out === "function") out = out(params || {});
  if (out == null || out === "") out = fr;
  if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return out;
}

// Pluriel simple : t(n > 1 ? plural : singular). Pour le polonais, la
// traduction de la forme plurielle peut être une fonction qui reçoit n.
export function tn(n, singular, plural, params = {}) {
  return t(Math.abs(n) > 1 ? plural : singular, { n, ...params });
}

// Règle des pluriels polonais : 1 / 2-4 (sauf 12-14) / 5+.
export function plForm(n, one, few, many) {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 12 || a % 100 > 14)) return few;
  return many;
}

export function setLang(code) {
  try { localStorage.setItem(LS_LANG, code); } catch (_) {}
  location.reload();
}

// Textes du HTML statique (barre d'onglets...) : attribut data-i18n="texte français".
export function translateStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
}
