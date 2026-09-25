# Serveur de notifications du minuteur

Sur iPhone, une app web est gelée dès qu'on passe à une autre app (Spotify…) :
elle ne peut pas sonner elle-même à la fin du repos. Ce petit serveur
(Cloudflare Workers, **gratuit, sans carte bancaire**) reçoit l'échéance du
repos et envoie une vraie notification push à la seconde près, même app
fermée ou écran verrouillé.

Il génère lui-même ses clés de signature : rien à créer à la main à part le
compte Cloudflare.

## Mise en place (une seule fois, ~15 min)

1. **Compte Cloudflare** : crée un compte gratuit sur https://dash.cloudflare.com/sign-up.
2. **Sous-domaine workers.dev** : dans le menu *Compute (Workers)* → *Workers & Pages*,
   ouvre la page une première fois ; si Cloudflare te demande de choisir un
   sous-domaine `*.workers.dev`, choisis-en un (ex. `clement`).
3. **Identifiant de compte** : sur cette même page, copie l'*Account ID*
   (colonne de droite, ou dans l'URL : `dash.cloudflare.com/<ACCOUNT_ID>/...`).
4. **Jeton d'API** : icône de profil → *My Profile* → *API Tokens* → *Create Token*
   → modèle **Edit Cloudflare Workers** → *Use template* → choisis ton compte dans
   *Account Resources* → *Continue to summary* → *Create Token*. Copie le jeton
   (il ne sera plus affiché).
5. **Secrets GitHub** : dans le dépôt GitHub → *Settings* → *Secrets and variables*
   → *Actions* → *New repository secret*, crée :
   - `CLOUDFLARE_API_TOKEN` = le jeton de l'étape 4
   - `CLOUDFLARE_ACCOUNT_ID` = l'identifiant de l'étape 3
6. **Déploiement** : onglet *Actions* du dépôt → *Déployer le serveur push* →
   *Run workflow*. À la fin (1-2 min), ouvre le job : la dernière ligne donne
   l'adresse du serveur, du type `https://skullcrusher-timer.clement.workers.dev`.
7. **Brancher l'app** : sur GitHub, modifie `js/timer-sync-config.js` et colle cette
   adresse entre les guillemets de `PUSH_SERVER_URL`, puis *Commit changes*.
   Vérifie en ouvrant `<adresse>/vapid-public-key` dans un navigateur : tu dois
   voir `{"publicKey":"..."}`.
8. **Sur l'iPhone** (iOS 16.4 minimum) : ouvre l'app **depuis l'icône de l'écran
   d'accueil** (le push ne marche pas dans un onglet Safari), mets-la à jour
   (Réglages → À propos → *Forcer la mise à jour*, version 37 ou plus), puis
   Réglages → *Notifications de fin de repos* → accepte l'autorisation. Appuie sur
   **Tester** et passe sur Spotify : la notification arrive 10 s plus tard.

Chaque utilisateur de l'app active simplement l'interrupteur de son côté ; il
n'a rien d'autre à faire.

## Bon à savoir
- Le mode *Concentration / Ne pas déranger* de l'iPhone peut masquer les
  notifications : autorise l'app dans le mode utilisé à la salle.
- L'offre gratuite de Cloudflare (100 000 requêtes/jour) couvre très largement
  l'usage : environ 2 requêtes par série.
- Si le site change d'adresse, ajoute-la à `ALLOWED_ORIGIN` dans `wrangler.toml` (liste séparée par des virgules).

## Fonctionnement
- `GET /vapid-public-key` : clé publique utilisée par l'app pour s'abonner.
- `POST /schedule {subscription, delayMs, title, body}` : programme (ou reprogramme)
  la notification de l'appareil ; un seul minuteur par appareil.
- `POST /cancel {endpoint}` : annule (repos passé, séance terminée).
- Un Durable Object par appareil garde l'échéance et se réveille par alarme ;
  l'envoi respecte les standards Web Push (signature VAPID, chiffrement aes128gcm).
