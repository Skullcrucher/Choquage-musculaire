// ============================================================
// AUTHENTIFICATION — écran de connexion email/mot de passe, avant tout accès
// ============================================================
import { auth, onAuthChange, signInWithPassword, createAccountWithPassword, resetPassword, signOutUser } from "./db.js";

let resolveReady;
export const authReady = new Promise((res) => { resolveReady = res; });

let currentUser = null;
export function getUser() { return currentUser; }
// L'app est ouverte à tout compte connecté : la confidentialité des séances
// est assurée par les règles Firestore (chacun ne lit que les siennes, plus
// celles partagées sur le feed).
export function isAuthorized(user) { return !!user; }

export function initAuth(onChange) {
  let first = true;
  onAuthChange((user) => {
    currentUser = user;
    if (first) { first = false; resolveReady(); }
    onChange(user);
  });
}

const AUTH_ERROR_FR = {
  "auth/invalid-email": "Adresse email invalide.",
  "auth/user-not-found": "Aucun compte avec cet email — utilise \"Créer un compte\" la première fois.",
  "auth/wrong-password": "Mot de passe incorrect.",
  "auth/invalid-credential": "Email ou mot de passe incorrect.",
  "auth/email-already-in-use": "Un compte existe déjà avec cet email — utilise \"Se connecter\" à la place.",
  "auth/weak-password": "Le mot de passe doit faire au moins 6 caractères.",
  "auth/too-many-requests": "Trop de tentatives — réessaie dans quelques minutes."
};

function friendlyAuthError(err) {
  return AUTH_ERROR_FR[err.code] || err.message || "Erreur de connexion.";
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
      <h1 class="login-title">Skullcrusher</h1>
      <p class="muted" style="margin-bottom:24px;">Connecte-toi pour accéder à tes séances.</p>
      <input id="login-email" type="email" autocomplete="email" placeholder="Email" style="margin-bottom:10px;">
      <input id="login-password" type="password" autocomplete="current-password" placeholder="Mot de passe" style="margin-bottom:14px;">
      <div class="btn-row">
        <button class="btn btn-secondary" id="signup-btn">Créer un compte</button>
        <button class="btn btn-primary" id="signin-btn">Se connecter</button>
      </div>
      <p class="muted" id="login-error" style="margin-top:12px; color:var(--red);"></p>
      <button class="props-btn-invisible" id="forgot-btn" style="background:none; border:none; color:var(--steel); font-size:13px; margin-top:6px; cursor:pointer;">Mot de passe oublié ?</button>
      <p class="muted" style="margin-top:18px; font-size:12px;">Tes séances restent privées, sauf celles que tu partages sur le feed. La bibliothèque d'exercices est commune à tous ; tes routines sont personnelles.</p>
    </div>
  `;

  const emailEl = container.querySelector("#login-email");
  const passEl = container.querySelector("#login-password");
  const errorEl = container.querySelector("#login-error");
  const signinBtn = container.querySelector("#signin-btn");
  const signupBtn = container.querySelector("#signup-btn");
  const forgotBtn = container.querySelector("#forgot-btn");

  forgotBtn.onclick = async () => {
    const email = emailEl.value.trim();
    if (!email) { errorEl.style.color = "var(--red)"; errorEl.textContent = "Tape ton email dans le champ ci-dessus d'abord."; return; }
    forgotBtn.disabled = true;
    try {
      await resetPassword(email);
      errorEl.style.color = "var(--green)";
      errorEl.textContent = "Email de réinitialisation envoyé — vérifie ta boîte mail.";
    } catch (err) {
      console.error("[Skullcrusher] Erreur reset password", err);
      errorEl.style.color = "var(--red)";
      errorEl.textContent = friendlyAuthError(err);
    }
    forgotBtn.disabled = false;
  };

  async function run(action, btn, busyLabel, idleLabel) {
    const email = emailEl.value.trim();
    const password = passEl.value;
    errorEl.style.color = "var(--red)";
    errorEl.textContent = "";
    if (!email || !password) { errorEl.textContent = "Renseigne un email et un mot de passe."; return; }
    signinBtn.disabled = true;
    signupBtn.disabled = true;
    btn.textContent = busyLabel;
    try {
      await action(email, password);
    } catch (err) {
      console.error("[Skullcrusher] Erreur auth", err);
      errorEl.textContent = friendlyAuthError(err);
    }
    signinBtn.disabled = false;
    signupBtn.disabled = false;
    btn.textContent = idleLabel;
  }

  signinBtn.onclick = () => run(signInWithPassword, signinBtn, "Connexion…", "Se connecter");
  signupBtn.onclick = () => run(createAccountWithPassword, signupBtn, "Création…", "Créer un compte");
  passEl.addEventListener("keydown", (e) => { if (e.key === "Enter") signinBtn.click(); });
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
