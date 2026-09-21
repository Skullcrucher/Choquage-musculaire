// ============================================================
// CONFIGURATION FIREBASE — à remplir avec TES identifiants
// ============================================================
// 1. Va sur https://console.firebase.google.com
// 2. Crée un nouveau projet (ex: "fonte-app")
// 3. Ajoute une "Web app" (icône </>) dans les paramètres du projet
// 4. Copie l'objet firebaseConfig qu'on te donne et colle-le ci-dessous
// 5. Dans la console Firebase, active Firestore Database (mode production,
//    région europe-west par exemple)
// 6. Dans Firestore > Règles, colle temporairement (usage perso uniquement,
//    pas de compte utilisateur) :
//
//    rules_version = '2';
//    service cloud.firestore {
//      match /databases/{database}/documents {
//        match /{document=**} {
//          allow read, write: if true;
//        }
//      }
//    }
//
//    (Ce n'est pas sécurisé pour une app publique, mais comme l'URL n'est
//    connue que de toi et que les données sont juste tes séances de sport,
//    c'est un compromis raisonnable pour un usage perso. Si tu veux plus
//    de sécurité plus tard, on peut ajouter l'authentification Firebase.)

export const firebaseConfig = {
  apiKey: "COLLE_TA_CLE_ICI",
  authDomain: "TON-PROJET.firebaseapp.com",
  projectId: "TON-PROJET",
  storageBucket: "TON-PROJET.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxx"
};
