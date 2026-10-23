# RSA & Gulf Consultant: website + database server

One small program that serves your website, receives the apply form (with document photos), and keeps everything in an **SQLite database** on your own server. Staff manage applicants on a password-protected page: `/admin`.

No other software or packages are needed. You only need **Node.js 22.13 or newer** (Node 24 is fine). Download it free from nodejs.org.

## 1. Try it on your computer (2 minutes)

```
cd rsa-gulf-server
ADMIN_PASSWORD="choose-a-long-password" node server.js        (Mac / Linux)
set ADMIN_PASSWORD=choose-a-long-password && node server.js    (Windows, Command Prompt)
```

- Website: http://localhost:3000
- Staff page: http://localhost:3000/admin
- Check everything works: `node test.js`

## 2. Put it on the internet

You need a small Linux server (a VPS, about 1 GB memory is plenty) and your domain name pointed at it. The site must use **HTTPS**, because passports and CNICs are sent through it.

1. Install Node.js 22.13+ and Caddy (Caddy gets the HTTPS certificate for you).
2. Copy this folder to the server, for example `/opt/rsa-gulf-server`.
3. Create the file `/etc/rsa-gulf.env`:
   ```
   ADMIN_PASSWORD=your-long-password
   PORT=3000
   HOST=127.0.0.1
   TRUST_PROXY=1
   DATA_DIR=/var/lib/rsa-gulf
   ```
4. Run it all the time with systemd. Create `/etc/systemd/system/rsa-gulf.service`:
   ```
   [Unit]
   Description=RSA Gulf website
   After=network.target
   [Service]
   WorkingDirectory=/opt/rsa-gulf-server
   EnvironmentFile=/etc/rsa-gulf.env
   ExecStart=/usr/bin/node server.js
   Restart=always
   User=www-data
   [Install]
   WantedBy=multi-user.target
   ```
   Then: `mkdir -p /var/lib/rsa-gulf && chown www-data /var/lib/rsa-gulf && systemctl enable --now rsa-gulf`
5. Caddy: put this in `/etc/caddy/Caddyfile`, replacing the domain, then `systemctl reload caddy`:
   ```
   yourdomain.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

Hosting services such as Render or Railway also work, but you must attach a **persistent disk** and set `DATA_DIR` to it. Without one, the database is erased on every restart.

## 3. Daily use (staff)

Open `https://yourdomain.com/admin` and sign in. Each applicant shows name, city, address, WhatsApp, passport number, reference number (RSA-2026-0001) and the document photos. Staff can change the status, set a follow-up date, write notes, attach more files, open WhatsApp or call, and delete a person with all their files. Every change is written to a history list.

Buttons at the top: **Add applicant** (for walk-ins and phone calls), **Export CSV** (opens in Excel), **Backup database**.

## 4. Where the data lives

Everything is in the `DATA_DIR` folder (default `./data`):

| Item | What it is |
|---|---|
| `rsa.db` | The SQLite database: tables `applications`, `files`, `history` |
| `uploads/` | The document photos and PDFs, under random file names |
| `.secret` | Signs the staff login cookie. Keep it private |

You can open `rsa.db` any time with the free "DB Browser for SQLite" program, or the `sqlite3` command, and run normal SQL, for example `SELECT ref, name, city FROM applications WHERE status = 'new';`

## 5. Backups (important)

A server disk can fail. Run `node backup.js` to copy the database and all documents into `backups/DATE/`. Then copy that folder to another computer or cloud drive. To run it every night at 2 AM on Linux, add this line with `crontab -e`:

```
0 2 * * * cd /opt/rsa-gulf-server && DATA_DIR=/var/lib/rsa-gulf node backup.js
```

To restore, stop the server, put `rsa.db` and `uploads/` back into the data folder, and start it again.

## 6. Security and privacy notes

- Anyone can submit the form, but only a person with the password can read anything. Documents are never reachable by a public link.
- Change the password by editing `ADMIN_PASSWORD` and restarting. After 8 wrong tries from one address, further tries are blocked for 15 minutes.
- Accept only JPG, PNG, WEBP and PDF files (checked by file content, not name). Photos are shrunk on the phone before sending, so uploads stay small even on a weak connection.
- The server does not store clients' IP addresses.
- You hold sensitive personal data (passport, CNIC). Keep the server updated, limit who knows the password, and delete records when they are no longer needed (the admin page has a delete button that also removes the files). Ask a lawyer what rules apply to your business.

## 7. Changing the website

The site is the single file `public/index.html`. When this server runs, the apply form sends straight to the database. If the same page is opened anywhere else, it still works and falls back to a WhatsApp message.
