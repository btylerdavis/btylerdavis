# Run the Sleeptopia demo on your laptop

Everything below happens in a "terminal" — a window where you type commands and press Enter.

- **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
- **Windows:** open the Start menu, type `PowerShell`, press Enter.

Type (or paste) each command on its own line and press Enter. Wait for it to finish before the next one.

## 1. One-time install: git and Node

You need two free tools: **git** (downloads the code) and **Node.js 20 or newer** (runs the app).

**Mac**
1. In Terminal, type `git --version`. If a pop-up offers to install "command line developer tools", click Install — that gives you git. If it prints a version number, you already have it.
2. Install Node: download the **LTS** installer from <https://nodejs.org/en/download> and run it like any other app. (If you already use Homebrew, `brew install node@20 && brew link --overwrite node@20` works too — if you don't know what Homebrew is, use the installer.)

**Windows**
1. Install git: download and run the installer from <https://git-scm.com/download/win>. The default options are all fine — just keep clicking Next.
2. Install Node: download the **LTS** Windows installer from <https://nodejs.org/en/download> and run it.
3. Close PowerShell and open a fresh one so it notices the new tools.

**Check it worked** — both of these should print version numbers, and the Node one should start with v20 or higher:

    git --version
    node -v

## 2. Get the code (one-time)

    git clone https://github.com/btylerdavis/btylerdavis.git sleeptopia-demo
    cd sleeptopia-demo

That downloads the project into a folder called `sleeptopia-demo` and steps inside it. The demo branch is the repo's default, so you're already on the right version — no extra steps.

## 3. First-time setup (one-time, ~3 minutes total)

Move into the app folder:

    cd app

Create the app's local settings file (it just tells the app where its database lives):

- Mac: `cp .env.example .env`
- Windows: `copy .env.example .env`

Install the app's dependencies (takes 1–3 minutes; lots of text scrolling by is normal):

    npm install

Create the empty database (a few seconds; look for "Your database is now in sync"):

    npx prisma db push

Fill it with the demo's 2,000 synthetic participants (~80 seconds):

    npm run seed

When the seed finishes, check the last few lines for the **Marcus Reed** line. It should say:

    Marcus Reed: d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17 (cpap_mattress, AHI 24, supine 41)

Marcus is the demo's main character — if that line is there, your data is perfect.

## 4. Run it

First time (and after any code update), build the app, then start it:

    npm run build
    npm run start

Leave that window open — it IS the server. Open your web browser and go to:

**http://localhost:3000**

You should see "Better Sleep Starts with Data." — you're live.

- **Every later time:** open a terminal, `cd sleeptopia-demo/app`, then just `npm run start`. Your data is saved on your laptop between runs.
- **To stop the app:** click the terminal window and press `Ctrl + C`.
- **To reset after a demo run:** run `npm run seed` again (with the app stopped). It wipes and regenerates the exact same pristine data.

## 5. If something goes wrong

**"Port 3000 is already in use"** — something else (probably an old copy of this app) is using the address. Free it, then start again:

- Mac: `lsof -ti :3000 | xargs kill -9`
- Windows (PowerShell): `Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process -Force`

**No "Marcus Reed:" line after seeding** — the seed didn't finish. Run `npm run seed` again and let it run to the end (~80 seconds).

**Errors during install or start** — check your Node version with `node -v`. It must be v20 or higher; if not, install the LTS from nodejs.org (step 1) and open a fresh terminal.

**Pages load but charts look blank** — do a hard refresh in the browser: `Cmd + Shift + R` (Mac) or `Ctrl + Shift + R` (Windows).

**Totally stuck?** Close the terminal, open a fresh one, and repeat step 4. The data is safe on disk.

## 6. Demo day?

Open **DEMO-SCRIPT.md** next — it walks the whole pitch, screen by screen.
