# עומסי חשמל — Electric Load Planner

Field tool for splitting generator load (32A / 63A distribution box, 3 phases)
across equipment without tripping a breaker. Installable as a PWA — works
offline once loaded, so a weak signal on-site doesn't matter.

## Run locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Deploy to GitHub Pages

1. Push this project to a new GitHub repo.
2. In the repo, go to **Settings → Pages**, and under **Build and deployment**
   set **Source** to **GitHub Actions**. (One-time setup.)
3. Push to `main` — the included workflow (`.github/workflows/deploy.yml`)
   builds the app and publishes it automatically. Check the **Actions** tab
   for progress; the live URL appears there and under Settings → Pages once
   it finishes (usually `https://<your-username>.github.io/<repo-name>/`).

Every future push to `main` redeploys automatically — no manual build step.

## Install as an app (PWA)

Once it's live on GitHub Pages:

- **Android / Chrome / Edge:** open the site → menu → "Install app" / "Add to
  Home screen".
- **iPhone / Safari:** open the site → Share button → "Add to Home Screen".

It'll then open full-screen like a native app, with an icon on the home
screen, and keeps working without a data connection after the first load.

## Editing

- `src/App.jsx` — the whole app (UI + load-calculation logic).
- Preset equipment list (with wattages) lives near the top of that file in
  `PRESET_CATEGORIES` — edit names/watts/icons there.
- `tailwind.config.js` — the `cable` colors (brown/orange/black/red) match
  real cable colors; adjust if your hardware differs.
