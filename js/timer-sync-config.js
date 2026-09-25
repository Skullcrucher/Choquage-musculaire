// Adresse du serveur de notifications push du minuteur (Cloudflare Worker,
// dossier push-worker/). À renseigner une fois le serveur déployé, par ex. :
//   export const PUSH_SERVER_URL = "https://skullcrusher-timer.ton-sous-domaine.workers.dev";
// Laisser vide désactive le push : la notification de fin de repos ne
// s'affiche alors que si l'app est au premier plan.
export const PUSH_SERVER_URL = "https://skullcrusher-timer.skullcrusher-timer.workers.dev";
