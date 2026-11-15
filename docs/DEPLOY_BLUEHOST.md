# Deploying on Bluehost

## Which Bluehost plan works

The system has two always-on parts, the web app (Node.js) and the job worker that sends reminders every hour, plus a PostgreSQL database.

| Bluehost plan | Works? | Why |
|---|---|---|
| Shared / WordPress / "Cloud" hosting | **No** | No always-running Node.js processes, no PostgreSQL, no root access. The reminder worker cannot run, so the system would silently stop sending reminders. |
| **VPS** (2 GB RAM or more) | **Yes** | Root access. Choose **Ubuntu 22.04 or 24.04, without cPanel** when you build it. |
| **Dedicated server** | **Yes** | Same as VPS. |

You can keep the website itself on shared hosting and run only the system on a VPS under a subdomain such as `pms.tabconsultantsllc.com`.

## Data location

Bluehost's servers are in the United States. Before real client data goes in, confirm with the partners that hosting UAE client records in the US is acceptable. If it is not, the same scripts run unchanged on a UAE-region server (Azure UAE North, AWS me-central-1).

## Steps (VPS, Ubuntu, no cPanel)

1. **DNS**: in Bluehost → Domains → DNS, add an **A record** `pms` pointing to the VPS IP address. Wait until `ping pms.tabconsultantsllc.com` answers with that IP.
2. **Log in** to the VPS over SSH as root (Bluehost → VPS → Server Information shows the IP and root password).
3. **Get the code**:
   ```bash
   apt-get update -y && apt-get install -y git
   git clone https://github.com/moeedmangla-ops/tab-pms /opt/tab-pms
   ```
   The repository is private: GitHub asks for your username and a personal access token (GitHub → Settings → Developer settings → Fine-grained tokens, read-only access to `tab-pms`).
4. **Install everything** (about 10 minutes):
   ```bash
   bash /opt/tab-pms/deploy/setup-vps.sh pms.tabconsultantsllc.com you@tabconsultantsllc.com
   ```
   It installs PostgreSQL, Node.js, nginx, a free TLS certificate and PM2, builds the app, starts the web app and worker, sets nightly database backups, and prints the administrator password **once**. Write it down.
5. Open `https://pms.tabconsultantsllc.com`, sign in, set up two-factor, and follow the go-live checklist in the operating guide.

For a **demo copy** with the 20 sample clients and demo users instead, run step 4 with `SEED_DEMO=true` in front, on a separate subdomain such as `demo-pms`. Never load real client data into the demo copy.

## Updating to a new version

```bash
sudo -u tabpms bash /opt/tab-pms/deploy/update.sh
```
Takes a database backup, pulls from GitHub, applies migrations, rebuilds and restarts.

## Everyday commands

| Task | Command |
|---|---|
| Are both processes running? | `sudo -u tabpms pm2 status` |
| Logs | `sudo -u tabpms pm2 logs` |
| Restart after editing `.env` | `sudo -u tabpms pm2 restart all` |
| Health | `curl https://pms.tabconsultantsllc.com/api/health` |
| Backups | `/var/backups/tab-pms/` (nightly, 30 days). Copy them off the server weekly. |
