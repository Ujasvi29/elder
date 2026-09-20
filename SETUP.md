# Setup Guide

This guide walks a teammate through setting up ElderCare on a fresh Windows machine, from an empty computer to a working app on their phone. It assumes you have never set up a development environment before, so every command is spelled out.

**This is a mobile app, not a website.** ElderCare is built with Expo and React Native. It does not run in a browser as a normal website would — there is no `index.html` and no Vite. The app runs on a phone, inside an app called **Expo Go**. During development your laptop runs two programs (the backend server and the Expo bundler) and your phone connects to your laptop over Wi-Fi to load and run the app.

---

## 1. Prerequisites

Install these before touching the repository. Install them in this order.

### 1.1 Git

Download and install from [git-scm.com/download/win](https://git-scm.com/download/win). Accept the default options during installation.

Confirm it worked by opening a terminal (search for "PowerShell" in the Start menu) and running:

```powershell
git --version
```

You should see something like `git version 2.44.0`.

### 1.2 Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org). Run the installer and accept the defaults (this also installs `npm`, which you'll need).

Confirm it worked in a terminal:

```powershell
node --version
npm --version
```

Both should print a version number.

### 1.3 VS Code

Download and install from [code.visualstudio.com](https://code.visualstudio.com). This is the editor we use to write and read code. Any editor works, but the rest of the team uses VS Code, so it's easiest to have the same tooling.

### 1.4 PostgreSQL 18

This is the database. Download the installer from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) (it links to the EnterpriseDB installer — use that one). Pick **version 18**.

During installation:

- It will ask you to set a password for the `postgres` superuser. **Write this password down somewhere you won't lose it.** You will need it for the rest of this guide and every time you touch the database.
- When it asks which components to install, leave everything checked (PostgreSQL Server, pgAdmin 4, Command Line Tools, Stack Builder).
- Leave the port at the default, `5432`.
- At the end it offers to launch Stack Builder — you can close that, we don't need it.

Don't try to confirm this worked yet — there's a PATH step first, covered in section 3.

### 1.5 Expo Go (on your phone)

On your phone, install the **Expo Go** app from the Play Store (Android) or the App Store (iOS).

This project targets **Expo SDK 54**. Make sure the Expo Go app you install is a recent one from the store — Expo Go always tracks one specific SDK version, and if it's badly out of date it won't be able to open this project. (More on this in Troubleshooting if it doesn't work.)

---

## 2. Clone the repo and make your branch

Open a terminal and navigate to wherever you keep code, e.g.:

```powershell
cd C:\Users\<your-username>\Documents
```

Clone the repository:

```powershell
git clone https://github.com/sreenidhi2545/elder-care.git
```

Move into the project folder — **this is important, and it's the single most common mistake, so read it twice.** Every command in this guide is meant to be run from either `elder-care\backend` or `elder-care\frontend`, never from `elder-care` itself and never from anywhere else. If a command fails with something like "no such file" or "package.json not found," the first thing to check is whether you're in the right folder.

```powershell
cd elder-care
```

Create your own feature branch off `main`. Replace `your-name` and `what-you're-building` with something real, e.g. `feature/priya-emergency-sos`:

```powershell
git checkout main
git pull
git checkout -b feature/your-name-what-youre-building
```

Do your work on this branch, not on `main`. When it's ready, you'll open a Pull Request into `main`.

---

## 3. Finish setting up PostgreSQL

### 3.1 Add `psql` to PATH

`psql` is the command-line tool for talking to PostgreSQL. The installer usually does *not* put it on your PATH automatically, which means typing `psql` in a terminal gives you `'psql' is not recognized as an internal or external command`.

To fix it:

1. Find where PostgreSQL was installed — usually `C:\Program Files\PostgreSQL\18\bin`.
2. Press the Windows key, search for "Environment Variables", and open **"Edit the system environment variables"**.
3. Click **Environment Variables...**.
4. Under **System variables** (bottom half), find the variable named `Path`, select it, and click **Edit...**.
5. Click **New** and paste in `C:\Program Files\PostgreSQL\18\bin`.
6. Click OK on all three windows to save.

### 3.2 Open a new terminal

**This step is easy to skip and it will bite you if you do.** Windows only reads PATH changes when a terminal starts — a terminal that was already open when you edited PATH will not see the change, no matter how long you wait or how many times you retype the command.

Close every terminal window you have open (including any inside VS Code) and open a fresh one.

Confirm `psql` is now recognized:

```powershell
psql --version
```

You should see something like `psql (PostgreSQL) 18.4`. If you still get "not recognized," double check the folder path from 3.1 actually exists and matches your PostgreSQL version.

---

## 4. Create the database and load the schema

### 4.1 Create the `eldercare` database

From any terminal (now that `psql` is on PATH), run:

```powershell
psql -U postgres -c "CREATE DATABASE eldercare;"
```

It will prompt for the `postgres` password you set during installation in step 1.4. Type it and press Enter (it won't show characters as you type — that's normal for password prompts).

### 4.2 Run the schema

Move into the backend folder and run the schema file against the new database:

```powershell
cd backend
psql -U postgres -d eldercare -v ON_ERROR_STOP=1 -f shared/db/schema.sql
```

`ON_ERROR_STOP=1` means the script stops immediately if anything goes wrong, instead of plowing ahead and leaving you with a half-built database. If it finishes without printing an error, it worked.

### 4.3 Confirm all 21 tables exist

Connect to the database interactively:

```powershell
psql -U postgres -d eldercare
```

Once you see the `eldercare=#` prompt, list the tables:

```
\dt
```

Count the rows in the output — you should see **21 tables**. Then exit:

```
\q
```

If you see a different number, the schema didn't fully apply — go back to 4.2 and check for an error message you might have missed.

---

## 5. Set up your `.env` file

The backend reads its configuration — database connection, secret keys, port — from a file called `.env`, which is never committed to the repository. Instead, the repo has `.env.example`, a template with fake values, which you copy and fill in yourself.

From the repo root:

```powershell
copy .env.example .env
```

Open the new `.env` file in VS Code and fill in real values. Here's what each one means:

| Variable | What it is | What to put |
|---|---|---|
| `DATABASE_URL` | The connection string the backend uses to reach PostgreSQL | `postgresql://postgres:YOUR_PASSWORD@localhost:5432/eldercare` — replace `YOUR_PASSWORD` with the `postgres` password from step 1.4 |
| `JWT_SECRET` | The secret key used to sign login tokens. Anyone who has this can forge a valid login for any account | A random string of 32+ characters. Generate one by running `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and pasting the output |
| `PORT` | The port the backend listens on | `5000` (leave as-is unless something else on your machine is using that port) |
| `ACCESS_TOKEN_TTL` | How long a login session's access token lasts | Optional, leave commented out to use the default (`15m`) |
| `REFRESH_TOKEN_TTL_DAYS` | How long you stay signed in before needing to log in again | Optional, leave commented out to use the default (`30`) |
| `DEFAULT_CALLING_CODE` / `DEFAULT_NATIONAL_DIGITS` | What country code to assume for a phone number typed without one | Optional, leave commented out — defaults to India (`91`, 10 digits) |

**This file must never be committed.** It's already listed in `.gitignore` so `git status` shouldn't ever show it — but if you ever see `.env` show up as a change ready to be committed, stop and figure out why before running `git add`. A committed `.env` means your database password and signing key are in the repository's history forever, even if you delete the file in a later commit.

---

## 6. Install dependencies

Two separate Node projects — backend and frontend — each need their own `npm install`.

```powershell
cd backend
npm install
```

```powershell
cd ..\frontend
npm install
```

This downloads all the packages each project depends on into a `node_modules` folder. It can take a few minutes, especially the frontend. `npm install` is safe to re-run any time; if something feels broken later, re-running it is a reasonable first thing to try.

---

## 7. Seed test users

The app has four roles — elderly, family, caregiver, admin — and each one lands on a different home screen after logging in. To test that without registering real accounts by hand, there's a script that creates one account per role.

From `backend/`, run (pick any password of your own, at least 8 characters — everyone on the team typically uses the same one so it's easy to share test credentials verbally):

```powershell
node scripts/seed-test-users.js YourTestPassword123
```

This creates four accounts, all sharing the password you typed:

| Phone | Role | What it's for |
|---|---|---|
| `9000000001` | elderly | Confirms you land on the elderly home screen |
| `9000000002` | family | Confirms you land on the family home screen |
| `9000000003` | caregiver | Confirms you land on the caregiver home screen |
| `9000000004` | admin | Confirms you land on the admin home screen; the only role that can list all users |

You can re-run this script any time — it updates the existing four accounts (including resetting the password) rather than failing or creating duplicates.

---

## 8. Run the backend and the app

You need **two terminals open at the same time** for this — one for the backend, one for Expo. Both need to be new terminals opened after the PATH change in section 3, if you haven't already opened one since then.

### 8.1 Start the backend

Terminal 1:

```powershell
cd backend
npm start
```

Leave this running. You should see it log that it's listening, and it should log a successful database connection (it checks the database before it will start at all).

### 8.2 Start Expo

Terminal 2:

```powershell
cd frontend
npm start
```

This starts the Expo bundler and prints a QR code in the terminal.

### 8.3 Scan the QR code

Make sure your phone is on the **same Wi-Fi network** as your laptop — this is essential, not optional (see Troubleshooting if it's not working).

Open the Expo Go app on your phone and scan the QR code shown in the terminal (Android: use the "Scan QR code" option inside Expo Go; iPhone: you can usually scan it with the regular Camera app, which will offer to open it in Expo Go).

The app will bundle and load onto your phone. This takes a little while the first time.

---

## 9. Verify it's actually working

Work through these in order — each one confirms the previous step actually succeeded.

1. **Health check.** With the backend running, open `http://localhost:5000/health` in a browser on your laptop, or run:
   ```powershell
   curl http://localhost:5000/health
   ```
   You should get back `"status": "ok"` and `"db": { "connected": true, ... }`. If `connected` is `false`, your backend can't reach PostgreSQL — check `DATABASE_URL` in `.env`.

2. **Log in from the phone.** On the app's login screen, sign in using one of the seeded phone numbers (e.g. `9000000001`) and the password you passed to the seed script.

3. **Land on a role screen.** After logging in, you should land on the home screen matching that account's role — the elderly test account should land on the elderly home screen, and so on. Try logging out and back in with a different seeded number (e.g. `9000000003` for caregiver) and confirm you land somewhere different.

If all three of those work, your environment is fully set up.

---

## 10. Building a preview APK for a phone (optional)

Everything above (`npx expo start` + Expo Go) is enough for day-to-day development. This section is only for producing an installable `.apk` via `eas build --profile preview` — e.g. to test on a device without Expo Go, or to hand a build to someone else.

**`EXPO_PUBLIC_API_URL` must be set as an EAS environment variable before you build.** A preview build has no Metro attached at runtime to auto-detect a host from (unlike Expo Go/dev-client) and a cloud `eas build` cannot see your local `frontend/.env` (it's gitignored on purpose — an IP address is specific to your machine and network, and committing one breaks the build for every teammate the moment their router hands out a different address, or the moment yours does). Set it once per environment instead:

```powershell
eas env:create --scope project --name EXPO_PUBLIC_API_URL --environment preview --value "http://<your-laptop-ip>:5000" --visibility plaintext --non-interactive
```

Find `<your-laptop-ip>` with `ipconfig` — look for "IPv4 Address" under your Wi-Fi adapter, same as section on troubleshooting above. Re-run this command (it overwrites the existing value) any time that IP changes — a new network, a router reassignment, a different laptop.

Then build as usual:

```powershell
eas build --profile preview --platform android --non-interactive
```

**If `EXPO_PUBLIC_API_URL` isn't set for the environment you're building, the build fails immediately** — `frontend/app.config.js` checks for it before anything is bundled, with an error naming exactly what's missing. This is deliberate: an earlier version of this project let a preview build silently succeed with no backend address baked in at all, producing an APK that looked fine but could never reach a server from any network. See `BUILD_LOG.md`'s 2026-08-26 entry for the full story — the fast, loud failure here exists specifically so that can't happen again unnoticed.

**⚠️ `frontend/app.config.js` currently also enables `usesCleartextTraffic` via the `expo-build-properties` plugin — temporary, local-dev-only, and it must not reach a production build.** Without it, Android blocks every plain `http://` request an app makes by default (any `targetSdkVersion` 28+, which includes this project) — even once `EXPO_PUBLIC_API_URL` resolves correctly, the app still can't reach a backend at a bare `http://<ip>:5000` address without this. It exists only because a preview build during development talks to a LAN IP over plain HTTP. **Before any production build:** either replace it with a `network_security_config.xml` scoped to private/local IP ranges only, or drop it entirely once the backend is reachable over `https://`. Don't carry this into a production build by habit — see `BUILD_LOG.md`'s 2026-08-26 entries for why this exists at all, and for why it has to go through `expo-build-properties` specifically rather than a bare `android.usesCleartextTraffic` key (that key alone does nothing — checked the hard way, twice).

---

## Troubleshooting

These are the specific problems the team actually hit while setting this project up (recorded in `BUILD_LOG.md`), in the order you're likely to hit them.

### `psql` is not recognized as an internal or external command

You ran `psql` before adding it to PATH, or before opening a new terminal after adding it. Go back to section 3.1 and double-check the PATH entry points at the real install folder (check `C:\Program Files\PostgreSQL\18\bin` actually exists), then **close every terminal window and open a brand new one**. See the next item too — this is the single most common trip-up.

### PATH change doesn't seem to take effect

Editing the PATH in Windows's environment variables settings does not affect terminals that are already open — including terminals inside VS Code, and including a terminal you've had open "for a while" and swear you didn't touch. Windows only reads PATH when a new process starts. Fully close all terminal windows (and if you're using the terminal built into VS Code, close and reopen VS Code itself) and try again in a fresh one.

### Forgot the `postgres` password

If you didn't write it down during installation and can't recall it, the practical fix is to reinstall PostgreSQL and set a password you'll remember this time — uninstall it via "Add or remove programs," delete the leftover data folder if the uninstaller doesn't (usually `C:\Program Files\PostgreSQL\18\data`), and reinstall following section 1.4 again. There isn't a simpler recovery on a local dev machine, and since this is a fresh setup there's no real data at stake yet.

### Expo Go says the project uses an unsupported SDK version, or won't open the app at all

This project targets **Expo SDK 54**, because the Expo Go app distributed through the Play Store and App Store only supports SDK 54 — newer SDKs need a custom development build, which this project intentionally avoids for now so everyone can run it with a plain phone. If Expo Go on your phone is old enough to still be on an earlier SDK, or was somehow pinned to a newer one, update the Expo Go app itself from your phone's app store to the current release and try scanning the QR code again. You should not need to change any project files — `frontend/package.json` already pins `expo` to `~54.0.0`.

### Phone can't reach the laptop / app loads then can't talk to the backend

This is almost always one of:

- **Different Wi-Fi networks.** The phone and the laptop must be on the same network. This especially trips people up on networks that isolate devices from each other (common on office or public Wi-Fi, and on some "Guest" networks) — try a home network or a personal hotspot if you're stuck on one of those.
- **Windows Firewall blocking the connection.** The first time you run `npm start` in `frontend/`, Windows may pop up a firewall prompt asking whether to allow Node.js to communicate on private networks — click **Allow**. If you missed that prompt, open Windows Defender Firewall settings, find Node.js in "Allow an app through firewall," and make sure Private networks is checked.
- **The backend isn't actually running.** Check terminal 1 — if `npm start` in `backend/` crashed or isn't showing a listening message, the phone has nothing to reach. Fix that first and confirm with the `/health` check in section 9 before worrying about networking.

**This section is about the Expo Go / dev-client flow (section 8.2/8.3) only.** There, the app figures out your laptop's address automatically — it reuses the same address Expo uses to send the phone its code, via `src/shared/config.js` — so you shouldn't need to type an IP address anywhere. If it's still not resolving, you can force it for your machine only: copy `frontend/.env.example` to `frontend/.env` and set `EXPO_PUBLIC_API_URL=http://<your-laptop-ip>:5000` (find your IP with `ipconfig` — look for "IPv4 Address" under your Wi-Fi adapter). That file is gitignored — it never leaves your machine, so it can't break anyone else's setup or go stale in the repo.

**Building an installable APK (a preview or production build via `eas build`) is a different mechanism — see section 10 below.** Those builds have no Metro to auto-detect from and no `.env` file available to a cloud build worker, so `EXPO_PUBLIC_API_URL` must be set as an EAS environment variable before building, or the build refuses to run rather than silently producing an app that can never reach a server. This is a lesson learned the hard way — see `BUILD_LOG.md`'s 2026-08-26 entry.

### "It says package.json not found" / commands failing for no obvious reason

This almost always means you're running a command from the wrong folder. This repo has two separate Node projects, `backend/` and `frontend/`, each with its own `package.json` and its own `node_modules`. Commands like `npm install` and `npm start` need to be run from inside the correct one of those two folders — never from the repo root (`elder-care/`) and never from one when you meant the other. If something fails mysteriously, run:

```powershell
pwd
```

to see exactly where you are, and check it matches what the step you're on expects (usually `...\elder-care\backend` or `...\elder-care\frontend`).

---

## Where things live, briefly

- `backend/` — the Express API server. Runs on your laptop, listens on port 5000.
- `frontend/` — the Expo/React Native app. Also runs on your laptop (as a bundler), but the actual app UI runs on your phone via Expo Go.
- `backend/shared/db/schema.sql` — the full database schema (21 tables).
- `.env.example` — the template for your own `.env`. See `API.md` for full endpoint documentation, `SCHEMA_DESIGN.md` for the reasoning behind the database design, and `BUILD_LOG.md` for a full history of what's been built and why.
