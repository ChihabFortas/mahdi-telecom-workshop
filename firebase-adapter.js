// Connects the app to Firebase (Google sign-in + Firestore) and enforces the approved-members gate:
// nobody gets the dashboard, or any data, unless an admin has added their Google email.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, OWNER_EMAILS } from "./firebase-config.js";

const $ = s => document.querySelector(s);
$("#ver").textContent = "MAHDI TELECOM WORKSHOP · v" + ((document.querySelector('meta[name="app-version"]') || {}).content || "");
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), experimentalForceLongPolling: true });
const owners = OWNER_EMAILS.map(e => e.toLowerCase());
const OK_ROLES = ["admin", "reception", "technician", "manager", "cashier"];   // anything else = no access
let started = false;

function show(which) {
  for (const id of ["chk", "login", "denied"]) $("#" + id).style.display = id === which ? (id === "chk" ? "flex" : "block") : "none";
}

function build(email) {
  const q = r => ({
    orderBy: (f, d) => q(query(r, orderBy(f, d || "asc"))),
    limit: n => q(query(r, limit(n))),
    onSnapshot: (ok, er) => onSnapshot(r, ok, er)
  });
  // Only admins may list all roles; everyone else just reads their own role document.
  const rolesQ = {
    onSnapshot: (ok, er) => {
      let u2 = null;
      const u1 = onSnapshot(collection(fs, "roles"), ok, e => {
        if (e.code === "permission-denied") {
          u2 = onSnapshot(doc(fs, "roles", email),
            d => ok({ docs: [{ id: email, data: () => (d.exists() ? d.data() : { role: "none" }) }] }), er);
        } else if (er) er(e);
      });
      return () => { u1(); if (u2) u2(); };
    }
  };
  const db = {
    collection: p => (p === "roles" ? rolesQ : q(collection(fs, p))),
    doc: p => { const r = doc(fs, p); return { set: o => setDoc(r, o), update: o => updateDoc(r, o), delete: () => deleteDoc(r) }; }
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
  const url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_CONFIG.projectId + "/databases/(default)/documents/roles/" + encodeURIComponent(email);
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
  return { ok: false, err: "Cannot reach the database (" + last + "). This network may block firestore.googleapis.com: try another network or phone data." };
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
    onSnapshot(doc(fs, "roles", email), d => {
      if (d.metadata.fromCache && !d.exists()) return;
      if (!d.exists() || !OK_ROLES.includes(d.data().role)) location.reload();
    }, () => {});
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
