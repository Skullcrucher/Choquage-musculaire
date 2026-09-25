# Skullcrusher — installation

## 1. Créer le projet Firebase (5 min)

1. Va sur https://console.firebase.google.com et crée un nouveau projet (ex: `skullcrusher-app`). Désactive Google Analytics, tu n'en as pas besoin.
2. Une fois le projet créé : icône **</>** ("Ajouter une application Web") → donne-lui un nom (ex: "Skullcrusher") → **pas besoin** de Firebase Hosting, tu vas utiliser GitHub Pages.
3. Firebase t'affiche un objet `firebaseConfig` — copie-le et colle-le dans `js/firebase-config.js`, à la place des valeurs `COLLE_TA_CLE_ICI` etc.
4. Dans le menu de gauche : **Firestore Database** → **Créer une base de données** → mode **Production** → région `europe-west1` (ou `eur3`) pour rester en Europe.
5. Une fois créée, onglet **Règles**, remplace le contenu par :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

   ⚠️ Ces règles ouvrent la base à quiconque connaît l'URL de ton app. Comme ce n'est qu'un log de musculation perso et que l'URL GitHub Pages ne sera pas indexée nulle part, c'est un compromis raisonnable. Si tu veux verrouiller ça plus tard, on peut ajouter l'authentification Firebase (Google Sign-In par ex.) en une vingtaine de minutes de travail.
6. **Publier** les règles.

## 2. Déployer sur GitHub Pages

1. Crée un nouveau dépôt GitHub (ex: `skullcrusher`), public ou privé (GitHub Pages fonctionne dans les deux cas si tu as un compte payant ; sinon il faut un dépôt public).
2. Pousse tout le contenu de ce dossier (`index.html`, `manifest.json`, `service-worker.js`, `css/`, `js/`, `icons/`) à la racine du dépôt.
3. Paramètres du dépôt → **Pages** → Source : branche `main`, dossier `/ (root)`.
4. Attends 1-2 minutes, ton app sera disponible à `https://<ton-user>.github.io/skullcrusher/`.

## 3. Installer sur ton iPhone

1. Ouvre l'URL GitHub Pages dans **Safari** (obligatoire, pas Chrome).
2. Bouton **Partager** (carré avec flèche vers le haut) → **Sur l'écran d'accueil**.
3. L'icône Skullcrusher apparaît sur ton écran d'accueil et s'ouvre en plein écran, sans barre Safari.

## 4. Premier import de ton historique Hevy

1. Ouvre l'app (une fois installée ou juste dans Safari), va dans **Réglages**.
2. Sélectionne ton fichier CSV d'export Hevy.
3. L'import tourne : les séries déjà présentes sont détectées et le reste est écrit par lots de ~450, donc même ~2,5 ans d'historique (~10 800 lignes) passent en moins d'une minute — laisse quand même l'app ouverte pendant l'import.
4. Un résumé s'affiche à la fin (séances créées, séries importées, doublons ignorés).
5. Tu peux réimporter le même fichier ou un export plus récent à tout moment : tout ce qui existe déjà est automatiquement ignoré, rien n'est jamais dupliqué.
6. Les séances importées sont **privées**. Pour en montrer une sur le feed : Historique → ouvre la séance → **Partager sur le feed**. À la fin d'une séance enregistrée dans l'app, on te propose directement de la partager.

Formats d'export Hevy reconnus : app en français ou en anglais (« 24 sept. 2026 à 12:27 », « 9 sept. 2026, 12:15 », « 24 Sep 2026, 12:27 », « Sep 24, 2026, 12:27 PM »), poids en kg ou en lbs (converti en kg).

## Ouverture à d'autres utilisateurs

Tout compte créé depuis l'écran de connexion a accès à l'app. `firestore.rules` garantit que :
- chacun ne lit, ne modifie et ne supprime que **ses** séances et séries ;
- une séance n'est visible des autres que si son propriétaire l'a partagée sur le feed ;
- les autres ne peuvent que poser/retirer leur réaction 🤘 sur une séance partagée ;
- les routines sont personnelles, avec trois niveaux de partage : 🔒 privée, 👥 amis (choisis un par un) ou 🌍 publique ;
- les routines partagées apparaissent dans Historique → Routines → **Découvrir** : recherche texte, filtres (source amis/communauté, muscles, exercice, niveau, objectif, durée), tri par popularité, votes 👍 (un par personne, pas pour ses propres routines) et bouton « Ajouter à ma bibliothèque » (copie privée) ;
- les amis se gèrent dans Feed → **Amis** : recherche par pseudo, demande, acceptation. Un utilisateur sans pseudo (Réglages → Compte) ne peut pas être trouvé ;
- la bibliothèque d'exercices est commune : tout le monde peut y ajouter un exercice, mais seul son créateur (ou l'administrateur, `bouvet.clement@gmail.com`) peut le modifier ou le supprimer. Les exercices créés avant ce verrouillage ne sont modifiables que par l'administrateur.

L'email administrateur est écrit à deux endroits qui doivent rester identiques : `isAdmin()` dans `firestore.rules` et `ADMIN_EMAIL` dans `js/db.js`. Au premier chargement de l'app par l'administrateur, les routines créées avant qu'elles deviennent personnelles lui sont automatiquement rattachées.

⚠️ Après avoir récupéré ces fichiers, **redéploie les règles et les index** (section 5) : le feed a besoin du nouvel index `shared + start_time`, et tant que les anciennes règles sont en place, seul l'email de la liste blanche peut écrire. Tes séances existantes deviennent privées : repartage celles que tu veux voir dans le feed.

## 5. Automatiser les index et règles Firestore (recommandé)

Plutôt que de créer les index à la main en cliquant sur les liens que Firestore
affiche dans la console au fil des erreurs, tu peux les définir une fois dans
`firestore.indexes.json` (déjà fait dans ce dépôt) et les déployer via la CLI
Firebase. Ça vaut aussi pour les règles (`firestore.rules`).

1. Installe la CLI (une fois) :
   ```
   npm install -g firebase-tools
   ```
2. Connecte-toi :
   ```
   firebase login
   ```
3. Depuis le dossier du projet (celui qui contient `firebase.json`) :
   ```
   firebase deploy --only firestore:indexes,firestore:rules --project app-muscu-fee2e
   ```

Ça pousse `firestore.indexes.json` et `firestore.rules` en une commande — plus besoin
de passer par l'interface web. La construction d'un nouvel index prend toujours
le même temps côté Firestore (quelques minutes selon le volume de données), mais
tu n'as plus à cliquer nulle part ni à attendre qu'une erreur te donne le lien.

Si tu ajoutes plus tard une nouvelle requête qui a besoin d'un index, Firestore
te redonnera un lien dans la console du navigateur comme avant — mais tu peux
aussi juste ajouter l'entrée correspondante à la main dans `firestore.indexes.json`
et redéployer, plutôt que de cliquer le lien.

## Limites connues (v1)

- Le minuteur de repos par défaut d'un exercice n'est modifiable que par son créateur ; chacun peut régler le sien par exercice dans ses routines.
- Pas de vidéos d'exercices, pas de calcul RPE avancé (RPE est stocké mais pas exploité dans les graphes).
- Le minuteur de repos a besoin du serveur de notifications (`push-worker/`, gratuit) pour prévenir à l'heure quand on est sur une autre app ou écran verrouillé : voir `push-worker/README.md`. Sans lui, la notification n'arrive qu'au retour dans l'app.
- Si tu veux qu'on ajoute l'authentification, des routines partagées entre plusieurs séances types, ou l'export vers Apple Santé, dis-le et on itère.

## Connexion Spotify (facultatif)

Sans connexion, tout ce qui touche à la musique fonctionne déjà avec des liens Spotify (profil,
playlists de routine et de séance, son du record, mur musical, défis). La connexion ajoute deux
choses : le morceau en cours est proposé comme « son du record », et les morceaux écoutés pendant la
séance peuvent être joints à la séance (bande-son).

Deux façons de se connecter, au choix de chaque utilisateur (Réglages → 🎧 Spotify) :

- **Sa propre app Spotify (recommandé, sans rien à gérer pour l'administrateur)** : chacun crée
  gratuitement une app sur https://developer.spotify.com/dashboard (compte Spotify **Premium** requis
  par Spotify pour les apps en mode développement), colle l'adresse de redirection affichée dans
  Réglages, coche **Web API**, puis saisit son **Client ID** dans Réglages. Le pas-à-pas est affiché
  dans l'app.
- **L'app Spotify partagée** (`SPOTIFY_CLIENT_ID` dans `js/spotify-config.js`) : en mode
  développement, Spotify la limite à **5 comptes** ajoutés à la main par son propriétaire
  (onglet **User Management**), et le propriétaire doit avoir Spotify Premium. Laisser vide pour que
  chacun utilise sa propre app.

Adresse de redirection à déclarer dans l'app Spotify : `https://skullcrucher.github.io/Choquage-musculaire/`
(exactement, avec le `/` final).

Sur iPhone, lancer la connexion depuis **Safari** (pas depuis l'icône de l'écran d'accueil) : la
connexion est enregistrée dans le compte (`user_private/{uid}`, lisible par son seul propriétaire) et
marche ensuite aussi dans l'app installée.

### Conformité Spotify

- Logo Spotify affiché à côté de tout contenu issu de la connexion Spotify ; titres affichés par le
  lecteur officiel de Spotify.
- Seuls les liens des morceaux sont enregistrés (10 par séance maximum) ; aucune statistique ni
  classement n'est tiré des écoutes, rien n'est transmis à des tiers.
- Information avant connexion et politique de confidentialité (`privacy.html`).
- La déconnexion efface le jeton et toutes les données venues de Spotify dans les séances.
