// Produce only the browser files needed by the public, backend-free edition.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const scripts = new Set([
  'combat_data.js', 'clean_cards.js', 'combat_engine.js', 'collection_scope.js',
  'expanded_catalog.js', 'vehicle_catalog.js', 'vehicle_media.js',
  'vehicle_history.js', 'ammo_details.js',
]);
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"?]+)[^"]*"><\/script>/g, (tag, file) => {
  if (file === 'real_photos.js') return '<script src="pages.js"></script>';
  return scripts.has(file) ? tag : '';
});
// Keep the original local edition intact; this marker exists only in the build.
html = html.replace('<html lang="en">', '<html lang="en" data-edition="pages">');
html = html.replace('</head>', '<link rel="stylesheet" href="pages.css">\n</head>');
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const file of [...scripts, 'pages.js', 'pages.css', 'fluent.css', 'pa.css',
  'display_hdr.css', 'grunder.svg', 'gallery_library.json']) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
fs.cpSync(path.join(root, 'shell_icons'), path.join(out, 'shell_icons'), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Built GitHub Pages site in armored-archive-web/dist');
