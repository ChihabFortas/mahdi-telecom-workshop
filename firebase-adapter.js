// Connects the app to Firebase (Google sign-in + Firestore) and enforces the approved-members gate:
// nobody gets the dashboard, or any data, unless an admin has added their Google email.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, OWNER_EMAILS } from "./firebase-config.js";
import { DATABASE_ID } from "./firebase-db.js";

const $ = s => document.querySelector(s);
$("#ver").textContent = "MAHDI TELECOM WORKSHOP · v" + ((document.querySelector('meta[name="app-version"]') || {}).content || "");
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), experimentalForceLongPolling: true }, DATABASE_ID);
const owners = OWNER_EMAILS.map(e => e.toLowerCase());
const OK_ROLES = ["admin", "reception", "technician", "manager", "cashier"];   // anything else = no access
let started = false;

function show(which) {
  for (const id of ["chk", "login", "denied"]) $("#" + id).style.display = id === which ? (id === "chk" ? "flex" : "block") : "none";
}

const BASE = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_CONFIG.projectId + "/databases/" + DATABASE_ID + "/documents";
async function rest(method, path, body, qs) {
  const u = auth.currentUser;
  if (!u) throw { code: "unauthenticated" };
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const tok = await u.getIdToken(i > 0);
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000);
      const res = await fetch(BASE + (path[0] === ":" ? "" : "/") + path + (qs ? "?" + qs : ""), {
        method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      clearTimeout(t);
      if (res.ok) return res.status === 204 ? {} : await res.json();
      if (res.status === 403 || res.status === 401) {
        const j = await res.json().catch(() => ({}));
        throw { status: res.status, code: "permission-denied (" + ((j.error && j.error.message) || res.status) + "): publish firestore.rules in the database named '" + DATABASE_ID + "' with YOUR email as owner" };
      }
      if (res.status === 404) throw { status: 404, code: "not-found" };
      last = { code: "HTTP " + res.status };
    } catch (e) {
      if (e.status) throw e;
      last = { code: e.name === "AbortError" ? "timeout" : "network: " + (e.message || e) };
    }
  }
  throw last;
}
const enc = o => ({ fields: Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { stringValue: String(v) }])) });
const dec = d => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, v.stringValue ?? v.integerValue ?? v.booleanValue ?? ""]));

function build(email) {
  const q = r => ({
    orderBy: (f, d) => q(query(r, orderBy(f, d || "asc"))),
    limit: n => q(query(r, limit(n))),
    onSnapshot: (ok, er) => onSnapshot(r, ok, er)
  });
  // Roles are read/written over plain HTTPS with the signed-in user's token (rules still apply).
  // Unlike SDK writes, a failure here is reported immediately instead of being queued silently on this device.
  const rolesQ = {
    onSnapshot: (ok, er) => {
      let stop = false;
      const emit = docs => ok({ docs: docs.map(d => ({ id: d.id, data: () => d.data })) });
      const load = async () => {
        if (stop) return;
        try {
          const j = await rest("POST", ":runQuery", { structuredQuery: { from: [{ collectionId: "roles" }], limit: 300 } });
          emit((Array.isArray(j) ? j : []).filter(x => x.document).map(x => ({ id: decodeURIComponent(x.document.name.split("/").pop()), data: dec(x.document) })));
        } catch (e) {
          if (e.status === 403 || e.status === 401) {          // not an admin: read only your own role
            if (owners.includes(email)) $("#ver").textContent += "  ·  Users list refused: " + e.code;
            try { emit([{ id: email, data: dec(await rest("GET", "roles/" + encodeURIComponent(email))) }]); }
            catch (e2) { if (e2.status === 404) emit([{ id: email, data: { role: "none" } }]); else if (er) er(e2); }
          } else if (er) er(e);
        }
      };
      load();
      const timer = setInterval(load, 20000);
      window.addEventListener("roles-refresh", load);
      return () => { stop = true; clearInterval(timer); window.removeEventListener("roles-refresh", load); };
    }
  };
  const doc_ = p => {
    const r0 = doc(fs, p);
    if (!p.startsWith("roles/")) return { set: o => setDoc(r0, o), update: o => updateDoc(r0, o), delete: () => deleteDoc(r0) };
    const path = "roles/" + encodeURIComponent(p.slice(6)), done = x => { window.dispatchEvent(new Event("roles-refresh")); return x; };
    return {
      set: o => rest("PATCH", path, enc(o)).then(done),
      update: o => rest("PATCH", path, enc(o), Object.keys(o).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&") + "&currentDocument.exists=true").then(done),
      delete: () => rest("DELETE", path).then(done)
    };
  };
  const db = {
    collection: p => (p === "roles" ? rolesQ : q(collection(fs, p))),
    doc: doc_
  };
  const user = { id: async () => email, isOwner: async () => owners.includes(email) };
  return { db, user };
}

// Is this Google account on the approved list? (owners in firebase-config.js always are)
async function approved(u) {
  const email = (u.email || "").toLowerCase();
  if (!u.emailVerified || !email) return { ok: false, err: "Google reports this email as not verified (" + email + "). Use a Google account whose email is verified." };
  if (owners.includes(email)) return { ok: true };
  // Plain HTTPS check of roles/<email> with the user's own token (rules still apply). Independent of the Firestore SDK connection.
  const url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_CONFIG.projectId + "/databases/" + DATABASE_ID + "/documents/roles/" + encodeURIComponent(email);
  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const tok = await u.getIdToken(i > 0);
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 12000);
      const res = await fetch(url, { headers: { Authorization: "Bearer " + tok }, signal: ac.signal });
      clearTimeout(t);
      if (res.status === 404) return { ok: false, err: "No entry found for " + email + " in the Users list. Ask the administrator to add exactly this email." };
      if (res.status === 403 || res.status === 401) return { ok: false, err: "Database refused the read (HTTP " + res.status + "): publish the latest firestore.rules in Firebase, with the owner email replaced." };
      if (!res.ok) { last = "HTTP " + res.status; continue; }
      const j = await res.json(), role = j.fields && j.fields.role && j.fields.role.stringValue;
      return OK_ROLES.includes(role) ? { ok: true } : { ok: false, err: "Role '" + role + "' has no access." };
    } catch (e) { last = e.name === "AbortError" ? "timeout" : (e.message || String(e)); }
    await new Promise(r => setTimeout(r, 1000));
  }
  return { ok: false, err: "Cannot reach the database (" + last + "). This network may block firestore.googleapis.com: try another network or phone data.", net: true };
}

function start(u) {
  const email = (u.email || "").toLowerCase();
  const api = build(email);
  window.claude = { use: async n => (n === "db" ? api.db : api.user) };
  show(null);
  document.body.classList.add("ok");
  if (started) return;
  started = true;
  // If an admin removes or suspends this account while it is open, send it back to the gate immediately.
  if (!owners.includes(email)) {
    setInterval(async () => {
      const r2 = await approved(auth.currentUser);
      if (!r2.ok && !r2.net) location.reload();
    }, 30000);
  }
  const s = document.createElement("script");
  s.src = "app.js?t=" + Math.floor(Date.now() / 6e5); // picks up updates within ~10 minutes
  s.onload = () => {
    const b = document.createElement("button");
    b.textContent = "Sign out";
    b.onclick = async () => { await signOut(auth); location.reload(); };
    const top = document.querySelector(".w>.top");
    top.insertBefore(b, $("#lang"));
  };
  document.body.appendChild(s);
}

$("#gbtn").onclick = async () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, p); }
  catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") signInWithRedirect(auth, p);
    else $("#lerr").textContent = e.code || String(e);
  }
};
$("#dout").onclick = async () => { await signOut(auth); location.reload(); };

onAuthStateChanged(auth, async u => {
  if (!u) { document.body.classList.remove("ok"); show("login"); return; }
  show("chk");
  const r = await approved(u);
  if (!r.ok) { $("#dmail").textContent = u.email || ""; $("#derr").textContent = r.err || ""; show("denied"); return; }
  start(u);
});
