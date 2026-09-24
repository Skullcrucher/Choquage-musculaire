// ============================================================
// SERVEUR PUSH DU MINUTEUR DE REPOS — Cloudflare Worker
//
// Sur iPhone, iOS gèle le code d'une app web dès qu'on passe à une autre
// app : le minuteur ne peut donc pas prévenir lui-même la fin du repos.
// L'app confie l'échéance à ce serveur, qui envoie une notification push
// (standard Web Push) à la seconde près, même app fermée.
//
//   GET  /vapid-public-key          -> clé publique à donner à pushManager.subscribe
//   POST /schedule {subscription, delayMs, title, body}
//   POST /cancel   {endpoint}
//
// Un Durable Object "RestTimer" par abonnement (appareil) garde l'échéance
// et utilise une alarme pour se réveiller au bon moment. Un Durable Object
// dédié ("__vapid__") génère une fois pour toutes la paire de clés VAPID
// qui signe les envois : aucune clé à créer ni à stocker à la main.
// ============================================================

const MAX_DELAY_MS = 30 * 60 * 1000;
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/
];

// ---------- utilitaires base64url ----------
function b64u(bytes) {
  let s = "";
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const enc = new TextEncoder();

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const list = String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  const allowed = list.includes("*") || list.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin || "*" : list[0] || "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

export function isAllowedEndpoint(endpoint, env) {
  try {
    const u = new URL(endpoint);
    if (env.ALLOW_ANY_PUSH_ENDPOINT === "1") return true; // tests locaux uniquement
    return u.protocol === "https:" && PUSH_HOSTS.some(re => re.test(u.hostname));
  } catch (_) {
    return false;
  }
}

async function timerStub(env, endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return env.TIMERS.get(env.TIMERS.idFromName(b64u(hash)));
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/vapid-public-key") {
        const keys = await env.TIMERS.get(env.TIMERS.idFromName("__vapid__")).fetch("https://do/keys");
        const { publicKey } = await keys.json();
        return json({ publicKey }, 200, cors);
      }

      if (request.method === "POST" && (url.pathname === "/schedule" || url.pathname === "/cancel")) {
        const body = await request.json();
        const endpoint = url.pathname === "/schedule" ? body?.subscription?.endpoint : body?.endpoint;
        if (!endpoint || !isAllowedEndpoint(endpoint, env)) return json({ error: "endpoint invalide" }, 400, cors);
        if (url.pathname === "/schedule") {
          const sub = body.subscription;
          if (!sub?.keys?.p256dh || !sub?.keys?.auth) return json({ error: "abonnement invalide" }, 400, cors);
          const delayMs = Number(body.delayMs);
          if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) return json({ error: "délai invalide" }, 400, cors);
        }
        const stub = await timerStub(env, endpoint);
        const res = await stub.fetch("https://do" + url.pathname, { method: "POST", body: JSON.stringify(body) });
        return json(await res.json(), res.status, cors);
      }

      return json({ error: "introuvable" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: "erreur serveur" }, 500, cors);
    }
  }
};

// ============================================================
// Durable Object : un minuteur par appareil (+ le coffre des clés VAPID)
// ============================================================
export class RestTimer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/keys") return Response.json(await this.getOrCreateKeys());

    const body = await request.json();
    if (path === "/schedule") {
      const text = (v, max) => String(v || "").slice(0, max);
      await this.state.storage.put("job", {
        subscription: body.subscription,
        title: text(body.title, 80) || "Repos terminé 🤘",
        body: text(body.body, 200) || "C'est reparti pour la série suivante."
      });
      const fireAt = Date.now() + Number(body.delayMs);
      await this.state.storage.setAlarm(fireAt);
      return Response.json({ ok: true, fireAt });
    }
    if (path === "/cancel") {
      await this.state.storage.deleteAlarm();
      await this.state.storage.delete("job");
      return Response.json({ ok: true });
    }
    return Response.json({ error: "introuvable" }, { status: 404 });
  }

  async alarm() {
    const job = await this.state.storage.get("job");
    if (!job) return;
    await this.state.storage.delete("job");
    const keysRes = await this.env.TIMERS.get(this.env.TIMERS.idFromName("__vapid__")).fetch("https://do/keys");
    const keys = await keysRes.json();
    const res = await sendWebPush(job.subscription, JSON.stringify({ title: job.title, body: job.body }), keys, this.env.VAPID_SUBJECT);
    if (!res.ok) console.warn("Envoi push refusé", res.status, await res.text().catch(() => ""));
  }

  // Paire de clés VAPID (ECDSA P-256), générée au premier appel puis conservée.
  async getOrCreateKeys() {
    let keys = await this.state.storage.get("vapid");
    if (!keys) {
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      keys = {
        publicKey: b64u(await crypto.subtle.exportKey("raw", pair.publicKey)),
        privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey)
      };
      await this.state.storage.put("vapid", keys);
    }
    return keys;
  }
}

// ============================================================
// Web Push : signature VAPID (RFC 8292) + chiffrement aes128gcm (RFC 8291)
// ============================================================
async function vapidAuthorization(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const privateKey = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

export async function encryptPayload(subscription, plaintext) {
  const uaPublic = unb64u(subscription.keys.p256dh);
  const authSecret = unb64u(subscription.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 = dernier enregistrement
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = new Uint8Array([0, 0, 16, 0]); // taille d'enregistrement 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export async function sendWebPush(subscription, payload, keys, subject) {
  const body = await encryptPayload(subscription, payload);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": await vapidAuthorization(subscription.endpoint, keys, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "120",
      "Urgency": "high"
    },
    body
  });
}
