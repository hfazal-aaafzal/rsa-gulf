# From VS Code to GitHub to a live website

There are **two ways** to publish this project. Pick one.

| | A. Free website (GitHub Pages) | B. Full system (server + database) |
|---|---|---|
| Cost | Free | Paid hosting (a few dollars a month) |
| Apply form | Opens a WhatsApp message | Saves into the SQLite database, with document photos |
| Staff page `/admin` | No | Yes |
| Good for | Starting now, showing the agency | Real applicants and permanent records |

You can start with A today and move to B later. Both use the same files.

> **Never put client data on GitHub.** The file `.gitignore` already keeps the `data` folder (database, passports, CNICs) out of Git. Do not remove it. The repository for option A must be **public**, so only put the website code in it, never passwords or documents.

---

## One-time setup

1. Install **Git for Windows** from git-scm.com (accept the defaults) and restart VS Code.
2. Make a free account at github.com.
3. In VS Code: **File > Open Folder** and choose this project folder.
4. Click the **Source Control** icon on the left (a branch symbol), then **Initialize Repository**.
5. Type a message such as `First version` in the box and click **Commit**. If VS Code asks to stage changes, click **Yes**.
6. Click **Publish Branch**, sign in to GitHub when asked, and choose **Publish to GitHub public repository**. Name it `rsa-gulf`.

The same thing with commands (Terminal > New Terminal in VS Code), after creating an empty repository on github.com:

```
git init
git add .
git commit -m "First version"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/rsa-gulf.git
git push -u origin main
```

---

## Option A: free website on GitHub Pages

1. On github.com open your repository, then **Settings > Pages**. Under **Source** choose **GitHub Actions**.
2. Open the **Actions** tab. The run "Publish website to GitHub Pages" starts by itself after each push. Wait for the green tick (about one minute). If it did not start, click it and press **Run workflow**.
3. Your site is at `https://YOUR-USERNAME.github.io/rsa-gulf/`.

### Your own domain

GitHub does not sell domains. A free `yourname.github.io` address is the only free one. A real domain (like `rsagulf.com`) costs roughly the price of a lunch per year from a registrar such as Namecheap, GoDaddy or Cloudflare. Pakistani `.pk` names are sold through PKNIC resellers.

1. Buy the domain.
2. At the registrar's DNS page add **four A records** for `@` pointing to:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   and one **CNAME** record for `www` pointing to `YOUR-USERNAME.github.io` (without `/rsa-gulf`).
3. In GitHub: **Settings > Pages > Custom domain**, type the domain, **Save**.
4. When the **Enforce HTTPS** box becomes available (it can take up to 24 hours), tick it.

Source: GitHub's documentation, "Managing a custom domain for your GitHub Pages site".

---

## Option B: the full system with a database

The server keeps data in a file on disk, so the host must give it a **permanent disk**. Free hosting plans do not: for example Render's free web services lose their files on every restart or sleep, and Render says not to use them for production. So this option needs a small paid plan.

**Render (easiest, deploys from GitHub):**
1. Make an account at render.com and connect your GitHub.
2. **New > Blueprint**, choose the `rsa-gulf` repository. Render reads `render.yaml`.
3. It asks for `ADMIN_PASSWORD`: type a long password. Click **Apply**.
4. When it finishes, open the address Render shows. Add `/admin` for the staff page.
5. For your domain: Render > your service > **Settings > Custom Domains**, and follow what it shows.

I have not run this file on Render myself. If the Blueprint reports an error, send me the message.

**Any other host that runs Docker** (a VPS, Fly.io, Railway): use the included `Dockerfile` and attach a volume at `/data`.

**Your own server (VPS):** follow `README.md`.

Do not keep both A and B on the same domain. When B is running, switch off A (Settings > Pages > Unpublish).

---

## Every day: change, push, check

1. Edit a file in VS Code (the website is `public/index.html`). Save.
2. Try it first on your computer: double-click `start.bat`, open http://localhost:3000.
3. **Source Control**, type what you changed, click **Commit**, then **Sync Changes** (or **Push**).
4. Wait for the green tick: GitHub **Actions** tab (option A), or the Render dashboard (option B).
5. Open the live site in a **private window** and press **Ctrl + F5** so the old page is not shown from memory.
6. Checklist:
   - The page opens on your phone and on a computer.
   - Option A: fill the form, and WhatsApp opens with the message.
   - Option B: send a test application with a photo, see it at `/admin`, then delete the test record.

If a change is wrong: in VS Code open **Source Control**, find the previous commit in the history, and **Revert** it, then push again. Git keeps every older version.
