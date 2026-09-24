// ============================================================
// AUTHENTIFICATION — écran de connexion Google, avant tout accès à l'app
// ============================================================
import { auth, onAuthChange, signInWithGoogle, consumeRedirectResult, signOutUser } from "./db.js";

// Miroir de la liste blanche de firestore.rules — uniquement pour afficher
// un message clair côté app. La vraie protection reste dans les règles
// Firestore : même sans ce garde-fou côté client, un compte non autorisé
// ne pourrait rien lire ni écrire.
const ALLOWED_EMAILS = ["bouvet.clement@gmail.com"];

let resolveReady;
export const authReady = new Promise((res) => { resolveReady = res; });

let currentUser = null;
export function getUser() { return currentUser; }
export function isAuthorized(user) { return !!user && ALLOWED_EMAILS.includes(user.email); }

export function initAuth(onChange) {
  // Récupère le résultat d'une redirection de connexion en cours (retour de Google)
  consumeRedirectResult();

  let first = true;
  onAuthChange((user) => {
    currentUser = user;
    if (first) { first = false; resolveReady(); }
    onChange(user);
  });
}

export function renderLoginGate(container) {
  container.innerHTML = `
    <div class="login-gate">
      <svg class="login-logo" viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 8 C 24 8 14 28 14 44 C 14 56 18 64 24 70 L 26 84 C 26 90 30 93 35 93 L 35 82 L 39 93 L 44.5 93 L 44.5 82 L 50 93 L 55.5 93 L 55.5 82 L 61 93 L 65 93 L 65 82 L 74 70 C 80 64 86 56 86 44 C 86 28 76 8 50 8 Z" fill="currentColor"/>
        <g stroke="#101014" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <path d="M45 12 L49 19 L43.5 25 L51 31 L46.5 37"/>
        </g>
        <circle cx="45" cy="12.5" r="3" fill="#101014"/>
        <path d="M27 40 L44 38 L45.5 48 L36 59 L25 54 Z" fill="#101014"/>
        <path d="M73 40 L56 38 L54.5 48 L64 59 L75 54 Z" fill="#101014"/>
        <path d="M50 52 L43 66 L50 70 L57 66 Z" fill="#101014"/>
        <g stroke="#101014" stroke-width="1.8">
          <line x1="39" y1="81" x2="39" y2="92"/>
          <line x1="44.5" y1="81" x2="44.5" y2="92"/>
          <line x1="50" y1="81" x2="50" y2="92"/>
          <line x1="55.5" y1="81" x2="55.5" y2="92"/>
          <line x1="61" y1="81" x2="61" y2="92"/>
        </g>
      </svg>
      <h1 class="login-title">Fonte</h1>
      <p class="muted" style="margin-bottom:28px;">Connecte-toi pour accéder à tes séances.</p>
      <button class="btn btn-primary" id="google-signin">
        <svg width="18" height="18" viewBox="0 0 18 18" style="margin-right:6px;"><path fill="#fff" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/><path fill="#fff" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 009 18z"/><path fill="#fff" d="M3.95 10.7A5.4 5.4 0 013.68 9c0-.59.1-1.17.27-1.7V4.97H.95A9 9 0 000 9c0 1.45.35 2.83.95 4.03l3-2.33z"/><path fill="#fff" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>
        Continuer avec Google
      </button>
      <p class="muted" style="margin-top:18px; font-size:12px;">Tes séances restent privées. La bibliothèque d'exercices et les routines sont partagées entre utilisateurs.</p>
    </div>
  `;
  container.querySelector("#google-signin").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Connexion…";
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error("[Fonte] Erreur connexion", err);
      btn.disabled = false;
      btn.textContent = "Continuer avec Google";
    }
  };
}

export function renderUnauthorizedGate(container, user) {
  container.innerHTML = `
    <div class="login-gate">
      <svg class="login-logo" viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 8 C 24 8 14 28 14 44 C 14 56 18 64 24 70 L 26 84 C 26 90 30 93 35 93 L 35 82 L 39 93 L 44.5 93 L 44.5 82 L 50 93 L 55.5 93 L 55.5 82 L 61 93 L 65 93 L 65 82 L 74 70 C 80 64 86 56 86 44 C 86 28 76 8 50 8 Z" fill="var(--red)"/>
        <g stroke="#101014" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <path d="M45 12 L49 19 L43.5 25 L51 31 L46.5 37"/>
        </g>
        <circle cx="45" cy="12.5" r="3" fill="#101014"/>
        <path d="M27 40 L44 38 L45.5 48 L36 59 L25 54 Z" fill="#101014"/>
        <path d="M73 40 L56 38 L54.5 48 L64 59 L75 54 Z" fill="#101014"/>
        <path d="M50 52 L43 66 L50 70 L57 66 Z" fill="#101014"/>
        <g stroke="#101014" stroke-width="1.8">
          <line x1="39" y1="81" x2="39" y2="92"/>
          <line x1="44.5" y1="81" x2="44.5" y2="92"/>
          <line x1="50" y1="81" x2="50" y2="92"/>
          <line x1="55.5" y1="81" x2="55.5" y2="92"/>
          <line x1="61" y1="81" x2="61" y2="92"/>
        </g>
      </svg>
      <h1 class="login-title" style="color:var(--red);">Accès refusé</h1>
      <p class="muted" style="margin-bottom:28px;">${user.email} n'est pas autorisé sur cette app.</p>
      <button class="btn btn-secondary" id="signout-unauthorized">Se déconnecter</button>
    </div>
  `;
  container.querySelector("#signout-unauthorized").onclick = () => signOutUser();
}

export { signOutUser };
