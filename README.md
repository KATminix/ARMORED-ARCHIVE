# Armored Archive

Browser-based vehicle history, source photographs and ammunition reference tables.

## Deploy to GitHub Pages

1. Open **Settings → Pages** in this repository and select **GitHub Actions** as the build source.
2. Push to `main`, or open **Actions → Deploy GitHub Pages → Run workflow**.
3. Open the URL reported by the deployment. For this repository the default address is
   **https://katminix.github.io/ARMORED-ARCHIVE/**.

The workflow builds and checks the public site, uploads only `armored-archive-web/dist`,
and deploys it to the `github-pages` environment. Pull requests run the build checks without publishing.
No hosting service, API keys or npm dependencies are required.

## Build the public edition

Use Node.js 22 or newer:

```sh
cd armored-archive-web
npm run build:pages
npm run test:pages
```

Serve `dist/` with any static HTTP server to preview it. Assets and gallery JSON resolve
relative to the page, so repository subpaths and custom domains both work.

GitHub Pages cannot run the Node backend. The public build reads its curated gallery JSON
directly and embeds photographs from their original hosts, retaining source links and attribution.
Some hosts may block embedding or remove photographs; their source links remain available.
Game-derived artwork, collision models and animation videos are excluded from the repository.
The public edition therefore explains that 3D protection analysis and animations are unavailable.
Theme preferences remain in the visitor's browser. Server caches, local game files and runtime
data are never included in the deployment artifact.

The original local edition remains in `armored-archive-web/index.html`; the Pages build does not overwrite it.
