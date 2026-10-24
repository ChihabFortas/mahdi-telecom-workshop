// Finds the Firestore database name. Normally "(default)", but some projects name it "default".
// Optional override: add  export const FIRESTORE_DATABASE = "your-name";  to firebase-config.js
import * as CFG from "./firebase-config.js";
const { FIREBASE_CONFIG } = CFG;

async function exists(id) {   // false only when Google says this database does not exist
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
    const r = await fetch("https://firestore.googleapis.com/v1/projects/" + FIREBASE_CONFIG.projectId + "/databases/" + id + "/documents/track/_probe", { signal: ac.signal });
    clearTimeout(t);
    if (r.status === 404) {
      const j = await r.json().catch(() => ({}));
      return !/does not exist/i.test((j.error && j.error.message) || "");
    }
    return true;
  } catch (e) { return true; }
}

let id = CFG.FIRESTORE_DATABASE;
if (!id) id = (await exists("(default)")) ? "(default)" : ((await exists("default")) ? "default" : "(default)");
export const DATABASE_ID = id;
