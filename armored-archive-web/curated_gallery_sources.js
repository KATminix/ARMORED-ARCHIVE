/* Curated identities take precedence over keyword discovery. Load after the catalog and photo index. */
window.CURATED_GALLERY_SOURCES = (() => {
  const result = {};
  const pool = Object.values(window.REAL_PHOTO_INDEX || {}).flat().filter(p => p && typeof p === 'object');
  const entry = key => result[key] ||= {photos: [], links: [], survivorStatus: 'not-established', note: ''};
  const link = (key, label, url) => entry(key).links.push({label, url});
  function add(key, p, category, identification, exact = true) {
    if (!p) return;
    const e = entry(key);
    e.photos.push({...p, kind: 'photo', sourceName: 'Wikimedia Commons', sourceKind: 'photo-repository', category, verified: true, match: exact,
      matchLabel: exact ? (category === 'survivor' ? 'CURATED SURVIVING EXAMPLE' : 'CURATED PERIOD / SERVICE PHOTOGRAPH') : 'RELATED PRESERVED CONFIGURATION',
      identification: identification || p.identification,
      verificationBasis: 'Curated source description and collection identification; not automated image recognition.'});
    if (category === 'survivor' && exact) e.survivorStatus = 'documented';
  }
  const pick = (key, title, note, exact = true) => add(key, pool.find(p => p.title === title), 'survivor', note, exact);
  for (const [family, group] of Object.entries(window.ARMORED_POST_TIGER_CATALOG || {})) {
    if (family === 'flakpanzer') continue;
    for (const v of group.variants) for (const p of v.photos || []) {
      const key = family + ':' + v.id;
      const category = /^(jagdtiger:|sturmtiger:production|raketenjagdpanzer:rakjpz)/.test(key) || key === 'leopard1:a5' ? 'survivor' : key === 'leopard1:a0' ? 'period' : 'service';
      add(key, p, category, p.identification);
    }
  }
  for (const key of ['jagdtiger:porsche', 'jagdtiger:henschel']) link(key, 'The Tank Museum — surviving Jagdtigers', 'https://tankmuseum.org/tank-nuts/tank-collection/jagdtiger/');
  for (const key of ['sturmtiger:production', 'raketenjagdpanzer:rakjpz1', 'raketenjagdpanzer:rakjpz2', 'leopard1:a5']) link(key, 'Deutsches Panzermuseum — collection inventory', 'https://daspanzermuseum.de/grossexponate/');
  pick('sturmtiger:production', 'Sturmtiger frontal', 'Preserved production Sturmtiger at Deutsches Panzermuseum Munster; source identifies the museum and vehicle.');
  pick('sturmtiger:production', 'Sturmtiger - Panzermuseum Munster-20240529 (1)', 'Preserved production Sturmtiger at Munster, photographed in 2024.');
  pick('raketenjagdpanzer:rakjpz1', 'Raketenjagdpanzer 1 (24383501837)', 'Raketenjagdpanzer 1, Deutsches Panzermuseum Munster; photograph description and museum category agree.');
  pick('raketenjagdpanzer:jaguar1', 'L04 676 Jagdpanzer Jaguar 1', 'Preserved HOT-equipped Jaguar 1 at the Bundeswehr Military History Museum, Dresden, 2024; exact subvariant not established.', false);
  pick('raketenjagdpanzer:jaguar1', 'Jagdpanzer Jaguar 1 A3', 'Munster museum Jaguar 1 A3: later thermal-sight configuration, not an exact early Jaguar 1 / RakJPz 2 HOT match.', false);
  link('raketenjagdpanzer:jaguar1', 'TankPorn — Dresden Jaguar museum photographs', 'https://www.reddit.com/r/TankPorn/comments/1es53cl/');
  link('raketenjagdpanzer:jaguar1', 'Deutsches Panzermuseum — Jaguar collection move', 'https://daspanzermuseum.de/panzerausflug/');
  pick('leopard1:a1', 'File:Brasschaat Leopard A1.jpg', 'Belgian-service Leopard 1 preserved at Brasschaat; source categorises it as 1A1, but national fittings differ from the selected German vehicle.', false);
  pick('leopard1:a1', 'File:Leopard-1-latrun-1.jpg', 'Preserved Leopard 1 at Yad la-Shiryon; source categorises it as 1A1. National fittings and armour package may differ.', false);
  link('leopard1:a0', 'The Tank Museum — Leopard variants and preserved prototype', 'https://tankmuseum.org/tank-nuts/tank-collection/leopard-1-main-battle-tank/');
  entry('leopard1:a0').note = 'Bovington’s 1963 prototype, Australian AS1 and Canadian C1 are not the original German production configuration.';
  link('leopard1:a0', 'TankPorn — Leopard 1 museum photographs', 'https://www.reddit.com/r/TankPorn/comments/zr3eeh/');
  link('marder:a3', 'The Tank Museum — preserved Marder 1A3', 'https://tankmuseum.org/tank-nuts/tank-collection/marder-1a3/');
  entry('marder:a3').survivorStatus = 'documented';
  entry('marder:a3').note = 'Bovington confirms a preserved 1A3 donated in 2022; the bundled photograph is a service photograph, not the museum specimen.';
  link('marder:a3', 'Toadman’s Tank Pictures — Marder 1A3 walkaround', 'https://www.toadmanstankpictures.com/marder1a3.htm');
  const selections = [
    ['iv:iv70v', 'Jagdpanzer IV CWM 1', 'Preserved Panzer IV/70(V), Canadian War Museum, Ottawa.'],
    ['iv:iv70v', 'Jagdpanzer IV CWM 2', 'Second view of the preserved Panzer IV/70(V), Canadian War Museum.'],
    ['panzer3:germ_pzkpfw_iii_ausf_m', 'SdKz141-1-1', 'Preserved Panzer III Ausf. M, Deutsches Panzermuseum Munster.'],
    ['panzer3:germ_pzkpfw_iii_ausf_f', 'PzKpfwIIIF.Saumur.000a1y8q', 'Preserved Panzer III Ausf. F, Musée des Blindés, chassis 61192.'],
    ['ferdinand:germ_panzerjager_tiger_p_elefant', 'Elefant USAOM-01', 'Surviving Elefant photographed at the US Army Ordnance Museum in 2009; location describes the photograph date.'],
    ['proto_ww2_td:germ_pzsflk40_sturer_emil', 'German heavy SP gun on VK3001(H) chassis', 'Preserved Sturer Emil prototype at Kubinka; museum photograph, not a model.'],
    ['proto_cold_mbt:germ_kpz_70', 'Kampfpanzer 70 (DPM)', 'Surviving German KPz-70 prototype at Deutsches Panzermuseum Munster, 2023.'],
    ['tiger:h1', 'Tiger I 2 Bovington', 'Tiger 131, the preserved early Tiger I at Bovington. Restoration details are not a factory-new configuration.'],
    ['tiger2:h', 'Tiger II mg 7800', 'Preserved production-turret Tiger II at Musée des Blindés, Saumur.'],
    ['tiger2:h', 'Bovington Tiger II grey bg', 'Preserved Tiger II 104 at Bovington; production turret.']
  ];
  for (const [key, title, note] of selections) pick(key, title, note);
  pick('artillery:germ_sturmpanzer_iv_brummbar', 'Sturmpanzer.Saumur.0008gkp7', 'Preserved Sturmpanzer IV at Musée des Blindés, Saumur; production batch unconfirmed.', false);
  pick('panther:a', 'Panzerkampfwagen V Seitenansicht', 'Preserved Panther Ausf. A converted to a command tank, Munster. Related configuration; radio fittings differ.', false);
  pick('jagdpanzer:germ_jgdpz_iv_l48', 'SdKfz162', 'Munster’s preserved Jagdpanzer IV 0-series vehicle, not an exact production L/48 configuration.', false);
  const key = 'proto_cold_light:germ_begleitpanzer_57';
  const image = 'https://forum-en-cdn.warthunder.com/original/4X/f/b/e/fbe84df2864c14c031ba53331331fad38469db63.png';
  entry(key).photos.push({title: 'Begleitpanzer 57 — firing trials, 1977', thumb: '/api/image?url='+encodeURIComponent(image), full: '/api/image?url='+encodeURIComponent(image),
    page: 'https://forum.warthunder.com/t/ru-362-oerlikon-gdd-a-oerlikons-begleitpanzer/276409',
    artist: 'Historical photographer uncredited; shared by AspectOfTheRAGE', lic: 'Rights not specified by forum poster; see source',
    kind: 'photo', category: 'period', sourceName: 'War Thunder forum — historical photograph', sourceKind: 'forum', verified: true, match: true,
    matchLabel: 'HISTORICAL PROTOTYPE PHOTOGRAPH', identification: 'Source caption identifies Begleitpanzer 57 during first firing tests in 1977. Trial configuration; not a claim that the game configuration survives today.'});
  link(key, 'War Thunder forum — historical prototype photograph', entry(key).photos[0].page);
  entry(key).note = 'No surviving example established by reviewed sources; historical trial photograph provided. Forum discussion is community evidence, not manufacturer certification.';
  for (const e of Object.values(result)) e.photos.sort((a,b) => (a.category === 'survivor' ? 0 : 1) - (b.category === 'survivor' ? 0 : 1));
  return result;
})();
