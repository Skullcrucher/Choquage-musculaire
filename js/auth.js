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
      <svg class="login-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 12 C 27 12 17 30 17 46 C 17 58 22 65 28 70 L 30 82 C 30 86 33 88 37 88 L 37 78 L 41 88 L 46 88 L 46 78 L 50 88 L 54 88 L 54 78 L 59 88 L 63 88 L 63 78 L 63 88 C 67 88 70 86 70 82 L 72 70 C 78 65 83 58 83 46 C 83 30 73 12 50 12 Z" fill="currentColor"/>
        <ellipse cx="36" cy="44" rx="9.5" ry="12" fill="#101014"/>
        <ellipse cx="64" cy="44" rx="9.5" ry="12" fill="#101014"/>
        <path d="M50 52 L44 64 L56 64 Z" fill="#101014"/>
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
      <svg class="login-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 12 C 27 12 17 30 17 46 C 17 58 22 65 28 70 L 30 82 C 30 86 33 88 37 88 L 37 78 L 41 88 L 46 88 L 46 78 L 50 88 L 54 88 L 54 78 L 59 88 L 63 88 L 63 78 L 63 88 C 67 88 70 86 70 82 L 72 70 C 78 65 83 58 83 46 C 83 30 73 12 50 12 Z" fill="var(--red)"/>
        <ellipse cx="36" cy="44" rx="9.5" ry="12" fill="#101014"/>
        <ellipse cx="64" cy="44" rx="9.5" ry="12" fill="#101014"/>
        <path d="M50 52 L44 64 L56 64 Z" fill="#101014"/>
      </svg>
      <h1 class="login-title" style="color:var(--red);">Accès refusé</h1>
      <p class="muted" style="margin-bottom:28px;">${user.email} n'est pas autorisé sur cette app.</p>
      <button class="btn btn-secondary" id="signout-unauthorized">Se déconnecter</button>
    </div>
  `;
  container.querySelector("#signout-unauthorized").onclick = () => signOutUser();
}

export { signOutUser };
