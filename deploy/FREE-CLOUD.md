# Free cloud demo for the CEO (then upgrade later)

Two ways, from quickest to most proper. Use **test data only** (fake names, no real passports) until you move to a paid plan.

## Quick demo from your own computer (5 minutes, nothing to buy)

Good for showing the CEO today. The link works only while your computer and the server window stay on, and the link changes every time.

1. Start the system as you did before (`start.bat`, or the `$env:ADMIN_PASSWORD=...; node server.js` line).
2. Open a second terminal and install the tool once: `winget install --id Cloudflare.cloudflared`  (then close and reopen the terminal).
3. Run: `cloudflared tunnel --url http://localhost:3000`
4. It prints an address ending in `trycloudflare.com`. Open it on any phone, and add `/admin` for the staff page.
5. Stop with Ctrl+C. The address stops working.

Cloudflare says these quick tunnels are for testing, have no uptime guarantee, and need no account. Anyone who has the address can open the site, so share it only with the CEO.

## Always-on free server on Google Cloud (about 20 minutes)

Google's "Always Free" tier includes one small virtual computer (e2-micro) in an Oregon, Iowa or South Carolina region, with a 30 GB standard disk and 1 GB of outbound data a month. A Google billing account is required, which means adding a payment card. Stay inside those limits and it costs nothing. Set a budget alert (Billing > Budgets & alerts) at 1 dollar so you are warned about any charge.

### Step 1: put the project on GitHub
Follow `DEPLOY.md` (the "One-time setup" part). The repository must be **public**. It holds code only. Client data never goes to GitHub.
Also add this `deploy` folder to the project, then Commit and Push.
The file `.github/workflows/pages.yml` is only for the free GitHub Pages option. If you will not use Pages, delete that file so GitHub does not show a red failed run.

### Step 2: create the virtual computer
1. Go to console.cloud.google.com, sign in, create a project (name it `rsa-gulf`) and set up billing when asked.
2. Open **Compute Engine > VM instances > Create instance**.
3. Settings:
   - **Region:** `us-central1` (Iowa), `us-west1` or `us-east1`. Only these are free.
   - **Machine type:** `e2-micro`.
   - **Boot disk > Change:** Ubuntu 24.04 LTS (or 22.04), disk type **Standard persistent disk**, size **30 GB**. A different disk type is not free.
   - **Firewall:** tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
4. Click **Create** and wait for the green tick.

### Step 3: install the system
1. In the VM list click **SSH** next to your machine. A terminal opens in the browser.
2. Paste these two lines, replacing `YOUR-USER` with your GitHub name:
   ```
   curl -fsSL https://raw.githubusercontent.com/YOUR-USER/rsa-gulf/main/deploy/gcp-setup.sh -o setup.sh
   sudo REPO_URL=https://github.com/YOUR-USER/rsa-gulf.git bash setup.sh
   ```
3. When asked, type the staff password (8+ characters, no spaces or quotes).
4. At the end it prints your addresses, like `https://34-123-45-67.sslip.io` and `/admin`. The free `sslip.io` name gives you HTTPS without buying a domain. Wait a minute for the certificate, then open it.

### Step 4: check it
Open the website, send a test application with a photo, sign in at `/admin`, see it, then delete the test record.

### Updating after you change something in VS Code
Push to GitHub as usual. Then open the VM's SSH window and run:
```
sudo bash /opt/rsa-gulf/deploy/update.sh
```
Reload the live site with Ctrl+F5.

### Good to know
- Data is saved on the VM disk in `/var/lib/rsa-gulf`. A copy is made nightly into `/var/backups/rsa-gulf` (same disk, so also download a backup from the `/admin` page now and then).
- Your own domain later: point an A record to the VM's external IP, then run `sudo DOMAIN=yourdomain.com REPO_URL=... bash setup.sh` again. Keep the same address if you want it stable: in Google Cloud, VPC network > IP addresses, reserve the external address (a reserved address attached to a running VM is free).
- The free tier is for a demo. For real applicants, use a paid plan with proper backups.

Sources: Google Cloud "Free cloud features" documentation (Compute Engine Always Free limits); Cloudflare documentation, "Quick Tunnels".
