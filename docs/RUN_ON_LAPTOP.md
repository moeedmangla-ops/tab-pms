# Running on a laptop

**Easiest way (Windows):** follow `docs/laptop-guide.html`. After installing Node.js, PostgreSQL and Git and cloning the repo, double-click the files in the `windows` folder:

| File | What it does |
|---|---|
| `setup.bat` | One-time: creates the database, writes `.env`, installs, builds (asks demo or clean) |
| `start.bat` / `stop.bat` | Start or stop the web app and the reminder worker |
| `autostart.bat` | Start at Windows sign-in, back up daily at 13:00 to OneDrive, no sleep on mains power |
| `backup.bat` / `restore.bat` | Back up now / restore from a OneDrive backup |
| `update.bat` | Back up, pull the latest version from GitHub, rebuild |

The manual steps below do the same by hand.

Good for a demo, a trial with a few colleagues, or a first week of testing. Not suitable as the firm's live system (see the end of this page).

## Install once (Windows; Mac notes in brackets)

1. **Node.js 22 LTS**: https://nodejs.org (download the LTS installer). [Mac: same.]
2. **PostgreSQL 16**: https://www.postgresql.org/download/windows/ (the EDB installer). Keep port 5432 and remember the password you set for the `postgres` user. [Mac: Postgres.app from https://postgresapp.com.]
3. **Git**: https://git-scm.com/download/win. [Mac: run `git --version` and accept the install prompt.]

## Create the database

Open **SQL Shell (psql)** from the Start menu, press Enter through the prompts, type the postgres password, then:
```sql
CREATE USER tab WITH PASSWORD 'tab' CREATEDB;
CREATE DATABASE tab_pms OWNER tab;
\q
```

## Get the app and set it up

In **PowerShell** (Mac: Terminal):
```powershell
git clone https://github.com/moeedmangla-ops/tab-pms
cd tab-pms
copy .env.example .env          # Mac: cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Open `.env` in Notepad and set:
```
DATABASE_URL="postgresql://tab:tab@localhost:5432/tab_pms?schema=public"
SESSION_SECRET="<paste the long code the last command printed>"
APP_URL="http://localhost:3000"
MAIL_TRANSPORT="console"
COOKIE_SECURE="false"
```
Then:
```powershell
npm ci
npx prisma migrate deploy
npm run db:seed
npm run build
npm start
```
Open **http://localhost:3000** and sign in as `mp@tabconsultants.test`, password `TabDemo!2026`.

For reminders and nightly deadline generation, open a **second** PowerShell window in the same folder and run `npm run worker`. Leave both windows open.

## Next time

Open two PowerShell windows in the `tab-pms` folder: `npm start` in one, `npm run worker` in the other.

## Letting colleagues in the office use it

They must be on the same office network. Find the laptop's address with `ipconfig` (the "IPv4 Address", e.g. 192.168.1.25) and give them `http://192.168.1.25:3000`. Windows asks once whether to allow Node.js through the firewall: choose **Private networks**. `COOKIE_SECURE="false"` must be set for this to work over plain http.

## Why a laptop is not the live system

- When the laptop sleeps, shuts down or leaves the office, **reminders stop and nobody can open the system**. That brings back the missed-deadline problem the system exists to prevent.
- Client data sits on one laptop: one theft, failure or spill loses it. Back it up at least daily (`pg_dump`) to OneDrive or SharePoint.
- No HTTPS, so do not open the port to the internet.

For live use, the options are a Bluehost **VPS** (`docs/DEPLOY_BLUEHOST.md`) or a small server in a UAE region.
