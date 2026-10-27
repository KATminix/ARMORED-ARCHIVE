# Armored Archive — web edition

A browser-based archive of German armoured vehicles (WW2 to modern): vehicle cards with manufacturer and history,
a sourced photo gallery with honest labelling (photo / related vehicle / drawing / reconstruction), tank-role notes,
era flags, and a 3D protection-analysis viewer with a WebGPU path tracer.

This public edition is a lightweight static build. Game-derived files (datamined armour models, vehicle artwork,
game geometry and the local image cache) are **not included** for licensing reasons, so those panels show reduced data.
Photos are linked from their original sources with credit.

For GitHub Pages, run `npm run build:pages` and `npm run test:pages`. The deployable
site is written to `dist/`. See the repository-root README for deployment instructions.

The full lab version uses `node server.js` and http://localhost:8787; its optional
native display helper, game data and upstream test suite are not included in this public upload.
