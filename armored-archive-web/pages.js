/* GitHub Pages edition: no API calls, image proxy, game files or server state. */
const combatEscape = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const combatLink = (url, label) => /^https?:\/\//.test(url || '')
  ? `<a href="${combatEscape(url)}" target="_blank" rel="noopener noreferrer">${combatEscape(label)}</a>`
  : combatEscape(label);
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const webURL = value => {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; }
    catch { return null; }
  };
  function sourceURL(photo) {
    for (const value of [photo.upstream, photo.original, photo.full, photo.thumb]) {
      if (!value) continue;
      const proxy = new URL(value, location.origin);
      const source = webURL(proxy.pathname === '/api/image' ? proxy.searchParams.get('url') : value);
      if (source) return source;
    }
    return null;
  }
  function link(parent, href, label) {
    const url = webURL(href); if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.textContent = label; a.target = '_blank'; a.rel = 'noopener noreferrer';
    parent.append(a, ' ');
  }
  let library;
  const loadLibrary = () => library ||= fetch(new URL('gallery_library.json', document.baseURI))
    .then(r => { if (!r.ok) throw Error('Gallery unavailable'); return r.json(); })
    .catch(error => { library = null; throw error; });

  initMedia = async function () {
    const key = family + ':' + current().id, revision = ++mediaRevision;
    curKey = key; clearMedia();
    $('mediaLinks').textContent = '';
    $('mediaNote').textContent = 'Loading source photographs…';
    try {
      const entry = (await loadLibrary()).vehicles[key] || { photos: [], links: [] };
      if (revision !== mediaRevision) return;
      items = entry.photos.map(p => ({ ...p, thumb: sourceURL(p), full: sourceURL(p) }))
        .filter(p => p.thumb);
      for (const item of entry.links || []) link($('mediaLinks'), item.url, item.label);
      // Source links remain usable even when an image host blocks embedding.
      for (const p of entry.photos) link($('mediaLinks'), p.page, p.title || 'Photograph source');
      drawThumbs();
      if (items.length) show(0);
      $('mediaNote').textContent = items.length
        ? 'Photographs load from their original hosts. If an image is unavailable, open its source link. Captions identify related configurations.'
        : 'No externally hosted photograph is available for this configuration. See the vehicle sources for reference.';
    } catch {
      if (revision === mediaRevision) $('mediaNote').textContent = 'The gallery could not be loaded. Reload the page to try again.';
    }
  };
  setSrc = function (element, urls, art) {
    element.classList.toggle('art', art);
    element.onerror = () => { element.hidden = true; element.removeAttribute('src'); };
    element.src = urls[0];
  };

  // Keep the sourced ammunition tables without the absent armour-model data.
  renderAmmo = function () {
    const profile = COMBAT_DATA.profiles[family + ':' + variant];
    const unit = profile && COMBAT_DATA.units[profile.unit];
    $('ammoTitle').textContent = 'Ammunition & penetration';
    $('selectedAmmoDetails').textContent = '';
    $('ammoTable').innerHTML = (unit?.ammo || []).map((a, i) => {
      const payload = ammoPayload(a);
      return `<tr><td><button class="btn" data-pages-ammo="${i}">${escape(a.name)}</button></td><td>${escape(a.type)}</td>` +
        a.pen.map(n => `<td>${escape(n ?? '—')}</td>`).join('') +
        `<td>${escape(payload.composition)}</td><td>${escape(payload.mass)}</td><td>${escape(payload.tnt)}</td></tr>`;
    }).join('') || '<tr><td colspan="11">No verified ammunition table is supplied for this configuration.</td></tr>';
    $('ammoNote').textContent = `Published game statistics at 0° in mm; not historical firing-trial measurements. ${profile?.note || ''}`;
    if (unit) link($('ammoNote'), unit.source, unit.name + ' · War Thunder Wiki');
    document.querySelectorAll('[data-pages-ammo]').forEach(button => {
      button.onclick = () => {
        const ammo = { ...unit.ammo[+button.dataset.pagesAmmo] };
        if (ammo.icon?.startsWith('/shell_icons/')) ammo.icon = new URL(ammo.icon.slice(1), document.baseURI).href;
        $('selectedAmmoDetails').innerHTML = ammoDetails(ammo, unit);
      };
    });
  };
  // There is no simulation without the excluded collision and projectile data.
  renderArmor = function () {};
  renderShells = function () {};
  $('animationAmmo').closest('section').classList.add('pages-unavailable');
  const notice = document.createElement('section');
  notice.id = 'pa3d'; notice.className = 'card pad';
  const heading = document.createElement('h2'); heading.textContent = 'Protection analysis';
  const explanation = document.createElement('p');
  explanation.textContent = '3D protection analysis and ammunition animations are unavailable in this public edition because their game-derived models and video files are not included. Vehicle history, source photographs and ammunition tables remain available.';
  notice.append(heading, explanation); $('opponentPick').after(notice);
})();
