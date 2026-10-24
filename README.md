# MAHDI TELECOM WORKSHOP — setup and administration guide

Workshop management app for phones and tablets: case files, reception ⇄ workshop custody tracking, warranty, cash payments, clients, inventory, swap with the factory, receipts and tickets, and a customer tracking page.

It is a static web app hosted on **GitHub Pages**, with **Google sign-in** and the **Firestore** database on **Firebase** (free Spark plan). There is no server to run.

## Who can enter (private by design)
- **Only people approved by the admin can enter.** Anyone else who signs in sees "Access denied" and never receives any data. There are no guests or visitors.
- Two layers protect it: the app checks your approval before it loads, and the Firestore rules on Firebase refuse every read and write from an account that is not approved.
- The website address itself is public (GitHub Pages). Only the data is private.
- The one public page is `track.html`: a customer who holds a tracking code or phone number sees the status of that phone only (no names, no IMEI).
- Removing or suspending a user takes effect immediately, even if they have the app open.

## Files
- `index.html` page and styling · `app.js` application logic
- `firebase-adapter.js` Google sign-in, access gate, database connection
- `firebase-config.js` YOUR settings (the only file you edit once)
- `firestore.rules` server-side security (paste into Firebase)
- `track.html` customer tracking page
- `DATABASE.md` data structure · `UPDATING.md` how to ship updates · `PRINTING.md` receipts and labels · `CHANGELOG.md`

## Part 1 — Firebase (once, about 10 minutes)
1. https://console.firebase.google.com → Add project (analytics not needed).
2. Build → Authentication → Get started → Sign-in method → **Google** → Enable → Save.
3. Authentication → Settings → Authorized domains → add `YOUR-GITHUB-USERNAME.github.io`.
4. Build → Firestore Database → Create database → **Production mode** → choose the region closest to you.
5. Firestore → Rules tab → paste all of `firestore.rules` → replace `owner@example.com` with **your Google email** → Publish.
6. Project settings (gear) → Your apps → Web `</>` → register → copy the `firebaseConfig` values into `firebase-config.js`.
7. In `firebase-config.js` set `OWNER_EMAILS` to the same email as in the rules.

> Every time you paste a new `firestore.rules`, put your owner email back in it (the file ships with `owner@example.com`). If you forget, you lose admin access until you fix it.

## Part 2 — GitHub (once, about 5 minutes)
1. github.com → New repository → name it `mahdi-telecom-workshop` → Public → Create. (GitHub Pages on a private repository needs a paid plan. The code is public, the data is not.)
   Already running under another repository name? Keep it. Renaming changes the site address and breaks QR codes already printed.
2. Upload the files: Add file → Upload files → drag ALL files from this folder → Commit.
   (Command line: `git init && git add . && git commit -m "MAHDI TELECOM WORKSHOP" && git branch -M main && git remote add origin https://github.com/USER/REPO.git && git push -u origin main`)
3. Settings → Pages → Source: **Deploy from a branch** → Branch `main`, folder `/ (root)` → Save.
4. After about a minute the app is live at `https://USER.github.io/REPO/`.

## Part 3 — First use and user management
1. Open the link, tap **Sign in with Google** with the owner email. You are Admin.
2. Open **Users** (top bar, admin only). It is a full user manager:
   - **Add user:** type the person's Google email, a name, and a role. Only people listed here can enter.
   - **Edit:** change a user's name or role.
   - **Suspend / Activate:** block someone without deleting them, then restore their previous role.
   - **Remove:** delete the user. Access ends immediately.
   - **Search:** find users by name, email or role.
   - You cannot edit, suspend or remove your own account, so you can never lock yourself out.
3. Tell each person to sign in with exactly the Google email you added.
4. Old `guest` entries from earlier versions have no access. Edit them to give a real role, or remove them.

## Roles
| Role | Can do |
|---|---|
| Admin | Everything: users, settings, deleting, audit log |
| Manager | Dashboard, archive, payments, inventory, swap, clients, cases |
| Reception team | Creates cases, custody handovers, returns, clients, receipts |
| Repair technician | Repairs, warranty changes, parts, swap, quotes |
| Cashier | Payments and financial dashboard |
| Suspended | No access |

## Updating
See `UPDATING.md`: replace `app.js` (and the other changed files) on GitHub. Your settings stay in `firebase-config.js`, and your data stays in Firebase.

## Troubleshooting
- **"Access denied" for the owner:** `OWNER_EMAILS` and the owner email in the published rules must both match your Google email.
- **Sign-in popup does nothing:** add your `github.io` address to Authentication → Authorized domains.
- **Camera / scanner:** needs HTTPS (GitHub Pages provides it) and internet for the barcode library.
- **Free limits (Spark):** 50k reads and 20k writes per day, 1 GiB. Photos are compressed and stored inside each case (limit 1 MiB per case).
- **Backups:** Firestore console → Import/Export (pay-as-you-go plan required).
