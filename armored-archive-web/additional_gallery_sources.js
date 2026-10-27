/* Narrowly curated gap repairs. Related variants are explicitly labelled. */
window.ADDITIONAL_GALLERY_SOURCES = (() => {
  const make = (title, url, page, artist, lic, category, identification, match = true, sourceName = 'Wikimedia Commons', licenseUrl = '') => ({
    title, thumb: '/api/image?url='+encodeURIComponent(url), full: '/api/image?url='+encodeURIComponent(url), page, artist, lic, licenseUrl, category, identification, match,
    kind: 'photo', verified: true, sourceName,
    sourceKind: sourceName.includes('forum') ? 'forum' : sourceName === 'Wikimedia Commons' ? 'photo-repository' : 'photographer',
    matchLabel: match ? (category === 'survivor' ? 'CURATED SURVIVING EXAMPLE' : 'CURATED REAL VEHICLE') : 'RELATED CONFIGURATION — SEE CAPTION'
  });
  const vjtf = [
    make('Puma VJTF/S1 — front, Klietz 2025', 'https://upload.wikimedia.org/wikipedia/commons/8/8d/Puma_IFV_VJTF_front_at_Klietz_2025.JPG',
      'https://commons.wikimedia.org/wiki/File:Puma_IFV_VJTF_front_at_Klietz_2025.JPG', 'Boevaya mashina', 'CC BY-SA 3.0 DE', 'display',
      'Puma VJTF/S1 on static display at Klietz, July 2025. The photographer identifies Spike-LR and MUSS equipment.', true, 'Wikimedia Commons', 'https://creativecommons.org/licenses/by-sa/3.0/de/'),
    make('Puma VJTF — turret, Klietz 2025', 'https://upload.wikimedia.org/wikipedia/commons/a/af/Puma_IFV_VJTF_turret_at_Klietz_2025.JPG',
      'https://commons.wikimedia.org/wiki/File:Puma_IFV_VJTF_turret_at_Klietz_2025.JPG', 'Boevaya mashina', 'CC BY-SA 3.0 DE', 'display',
      'Turret detail of the real Puma VJTF displayed at Klietz in July 2025; not a game render.', true, 'Wikimedia Commons', 'https://creativecommons.org/licenses/by-sa/3.0/de/')
  ];
  const early = make('Puma — open day, 2015', 'https://upload.wikimedia.org/wikipedia/commons/4/45/IFV_Puma_2015_%2819727694195%29.jpg',
    'https://commons.wikimedia.org/wiki/File:IFV_Puma_2015_(19727694195).jpg', 'Ralf Schulte / Katzennase', 'CC BY-SA 2.0', 'display',
    'German Army Puma at an open day in 2015. Photograph predates VJTF upgrades; equipment state may differ from later game configurations.', true, 'Wikimedia Commons', 'https://creativecommons.org/licenses/by-sa/2.0/');
  const hsPage = 'https://www.ulrichwrede.de/rundgang-um-fahrzeuge/sch%C3%BCtzenpanzer/spz-lang-hs-30/';
  const hs = [
    make('HS 30 family — preserved indoor example', 'https://www.ulrichwrede.de/s/cc_images/cache_2484203241.JPG?t=1573159340', hsPage, 'Ulrich Wrede', 'Copyright Ulrich Wrede; see source', 'survivor',
      'Preserved HS 30 family vehicle in the source walkaround. This image does not establish the selected SPz 12-3 LGS recoilless-gun fit.', false, 'Ulrich Wrede — vehicle walkaround'),
    make('HS 30 — preserved outdoor example', 'https://www.ulrichwrede.de/s/cc_images/cache_2484203279.JPG?t=1573159886', hsPage, 'Ulrich Wrede', 'Copyright Ulrich Wrede; see source', 'survivor',
      'Museum/display HS 30 with 20 mm turret. Related chassis only; the selected LGS version carries additional recoilless armament.', false, 'Ulrich Wrede — vehicle walkaround')
  ];
  const stuh = [
    make('Sturmhaubitze 42 — Sinsheim museum', 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Sturmhaubitze-42.jpg',
      'https://commons.wikimedia.org/wiki/File:Sturmhaubitze-42.jpg', 'Christian Kath / Helicop', 'CC BY-SA 3.0', 'survivor',
      'Preserved StuH 42 at Technik Museum Sinsheim, May 2006. Earlier hull configuration; related to, not an exact match for, the selected Ausf. G.', false, 'Wikimedia Commons', 'https://creativecommons.org/licenses/by-sa/3.0/'),
    make('Sturmhaubitze — Saumur museum', 'https://www.posix.com/Bulge/images/Saumur32.jpg',
      'https://www.posix.com/Bulge/index.html', 'Hal Jespersen', 'Copyright Hal Jespersen; see source', 'survivor',
      'Saumur museum Sturmhaubitze, captioned Sd.Kfz. 142/2 by the photographer. Exact production batch and fittings are not independently established.', false, 'Hal Jespersen — museum visit')
  ];
  const porsche = make('VK 45.01(P) — early turret historical photograph',
    'https://forum-en-cdn.warthunder.com/original/4X/3/8/8/388003ae3db52d3a6ffe4a0012ace6ed7f85e98c.jpeg',
    'https://forum.warthunder.com/t/vk-45-01-p-turm-1-8-prototype-prototiger/256399',
    'Historical photograph; shared by KewlPangolin', 'Original photographer / rights not specified; see forum sources', 'period',
    'Real Porsche Tiger prototype with the earlier low-roof turret. Related prototype only: not the later turret or command-tank configuration represented by the selected vehicle.', false, 'War Thunder forum — historical photograph');
  return {
    'puma:germ_schutzenpanzer_puma': [early, ...vjtf.map(p => ({...p, match: false, matchLabel: 'RELATED LATER VJTF CONFIGURATION', identification: p.identification + ' Later VJTF fit differs from the base Puma.'}))],
    'puma:germ_schutzenpanzer_puma_vjtf': vjtf,
    'hs30:germ_spz_12_3': hs,
    'stug:germ_stuh_iii_ausf_g': stuh,
    'proto_ww2_tanks:germ_pzkpfw_vi_tiger_p': [porsche],
    'proto_ww2_tanks:germ_panzerbefelhswagen_vi_p': [{...porsche, identification: porsche.identification + ' This is not an authenticated photograph of the operational command tank.'}]
  };
})();
