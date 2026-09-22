# Fonte — installation

## 1. Créer le projet Firebase (5 min)

1. Va sur https://console.firebase.google.com et crée un nouveau projet (ex: `fonte-app`). Désactive Google Analytics, tu n'en as pas besoin.
2. Une fois le projet créé : icône **</>** ("Ajouter une application Web") → donne-lui un nom (ex: "Fonte") → **pas besoin** de Firebase Hosting, tu vas utiliser GitHub Pages.
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

1. Crée un nouveau dépôt GitHub (ex: `fonte`), public ou privé (GitHub Pages fonctionne dans les deux cas si tu as un compte payant ; sinon il faut un dépôt public).
2. Pousse tout le contenu de ce dossier (`index.html`, `manifest.json`, `service-worker.js`, `css/`, `js/`, `icons/`) à la racine du dépôt.
3. Paramètres du dépôt → **Pages** → Source : branche `main`, dossier `/ (root)`.
4. Attends 1-2 minutes, ton app sera disponible à `https://<ton-user>.github.io/fonte/`.

## 3. Installer sur ton iPhone

1. Ouvre l'URL GitHub Pages dans **Safari** (obligatoire, pas Chrome).
2. Bouton **Partager** (carré avec flèche vers le haut) → **Sur l'écran d'accueil**.
3. L'icône Fonte apparaît sur ton écran d'accueil et s'ouvre en plein écran, sans barre Safari.

## 4. Premier import de ton historique Hevy

1. Ouvre l'app (une fois installée ou juste dans Safari), va dans **Réglages**.
2. Sélectionne ton fichier CSV d'export Hevy.
3. L'import tourne : chaque série est vérifiée individuellement avant écriture pour éviter les doublons, donc avec ~2,5 ans d'historique (~10 800 lignes) ça peut prendre plusieurs minutes — laisse l'app ouverte et l'écran allumé pendant l'import.
4. Un résumé s'affiche à la fin (séances créées, séries importées, doublons ignorés).
5. Tu peux réimporter le même fichier ou un export plus récent à tout moment : tout ce qui existe déjà est automatiquement ignoré, rien n'est jamais dupliqué.

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

- Pas d'authentification : toute personne avec le lien peut lire/écrire (voir note sur les règles ci-dessus).
- Pas de vidéos d'exercices, pas de calcul RPE avancé (RPE est stocké mais pas exploité dans les graphes).
- Le minuteur de repos ne sonne pas en arrière-plan si l'app est totalement fermée (limite iOS pour les PWA) — garde l'app ouverte pendant la séance.
- Si tu veux qu'on ajoute l'authentification, des routines partagées entre plusieurs séances types, ou l'export vers Apple Santé, dis-le et on itère.
