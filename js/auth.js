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
      <img class="login-logo" src="icons/logo.png" alt="Skullcrusher">
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
      <img class="login-logo" src="icons/logo.png" alt="Skullcrusher">
      <h1 class="login-title" style="color:var(--red);">Accès refusé</h1>
      <p class="muted" style="margin-bottom:28px;">${user.email} n'est pas autorisé sur cette app.</p>
      <button class="btn btn-secondary" id="signout-unauthorized">Se déconnecter</button>
    </div>
  `;
  container.querySelector("#signout-unauthorized").onclick = () => signOutUser();
}

export { signOutUser };
