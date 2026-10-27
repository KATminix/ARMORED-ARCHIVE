/* Prototype documents are not photographs of completed production vehicles. */
window.PROTOTYPE_GALLERY_SOURCES = (() => {
  const make = (title, image, page, category, documentKind, artist, identification, references = []) => ({
    title, thumb: '/api/image?url='+encodeURIComponent(image), full: '/api/image?url='+encodeURIComponent(image), page, kind: 'photo', category, documentKind,
    artist, lic: 'Historical document / reproduction; rights as stated by linked source',
    sourceName: page.includes('warthunder.com') ? 'War Thunder forum — prototype documentation' : page.includes('tapatalk.com') ? 'Missing-Lynx — historical reference photographs' : 'Tank Encyclopedia — document reproduction',
    sourceKind: 'document', verified: true, match: false,
    matchLabel: category === 'mockup' ? 'HISTORICAL WOODEN MOCKUP' : documentKind === 'modern-technical-reconstruction' ? 'MODERN TECHNICAL RECONSTRUCTION' : 'HISTORICAL PLAN / DOCUMENT',
    identification, references
  });
  const coelianPage = 'https://www.tapatalk.com/groups/missinglynx/german-flakpanzer-v-coelian-wooden-mock-up-t342154.html';
  const coelianRefs = [
    {label: 'Missing-Lynx — original reference views, not the later scale-model build', url: coelianPage},
    {label: 'Jentz & Doyle, Panzer Tracts 20-2 (2002), pp. 100–103 — cited mockup documentation', url: 'https://en.wikipedia.org/wiki/Flakpanzer_Coelian#References'}
  ];
  const pantherPage = 'https://forum.warthunder.com/t/panther-ii-king-panther-schmale-blendenausfuhrung/209046';
  const porschePage = 'https://forum.warthunder.com/t/vk-45-01-p-turm-1-8-prototype-prototiger/256399';
  return {
    'proto_ww2_aa:germ_flakpanzer_v_coelian': [
      make('Flakpanzer 341 / Coelian — wooden turret mockup, view 1',
        'https://attachment.tapatalk-cdn.com/45243/202512/2615436_9c7638585497c5d3f3e6f86816cdb92d.jpg',
        coelianPage, 'mockup', 'period-mockup-photograph', 'Historical photographer uncredited; reference scan shared by takamatsu',
        'Historical photograph of a full-size wooden anti-aircraft turret mockup on a real Panther chassis. This is evidence of a mockup, not a completed armed Flakpanzer or an exact physical counterpart of the game vehicle.', coelianRefs),
      make('Flakpanzer 341 / Coelian — wooden turret mockup, view 2',
        'https://attachment.tapatalk-cdn.com/45243/202512/2615436_6f0318177121bf193153fb1d0036ca72.jpg',
        coelianPage, 'mockup', 'period-mockup-photograph', 'Historical photographer uncredited; reference scan shared by takamatsu',
        'Another period view of the Coelian wooden mockup. Later design drawings and modern model kits can include features absent from this demonstrator.', coelianRefs)
    ],
    'proto_ww2_tanks:germ_pzkpfw_e_100': [
      make('E 100 — British hull armour plan',
        'https://tanks-encyclopedia.com/wp-content/uploads/imported/e100-entwicklung-100/qRfkUWN.png',
        'https://tanks-encyclopedia.com/e100-entwicklung-100/', 'blueprint', 'historical-plan-reproduction',
        'British technical drawing; reproduced by Andrew Hills / Tank Encyclopedia',
        'Source identifies this as a British plan of the E 100 hull armour. It documents the hull, not proof of a finished turreted E 100. The repository does not provide a unique archival catalogue number for this sheet.',
        [{label: 'E 100 document reproduction and source bibliography', url: 'https://tanks-encyclopedia.com/e100-entwicklung-100/'}])
    ],
    'proto_ww2_tanks:germ_panther_ii': [
      make('Panther II — proposed narrow-mantlet turret, front elevation',
        'https://forum-en-cdn.warthunder.com/original/3X/a/d/ad3b621308a7de42ec5dd0aedffd5b901145eaae.png',
        pantherPage, 'blueprint', 'modern-technical-reconstruction',
        'Panzer Tracts / Hilary Louis Doyle; reproduced in forum discussion',
        'Modern published technical reconstruction of the historical Panther II proposal, credited to Panzer Tracts (2006). Not an original wartime blueprint and not the game’s composite 8.8 cm Panther II configuration.',
        [{label: 'Panzer Tracts 5-4: Panther Ausf. F and Panther II — source identified by forum', url: pantherPage}])
    ],
    'proto_ww2_tanks:germ_pzkpfw_vi_tiger_p': [
      make('VK 45.01(P) — early turret technical side elevation',
        'https://forum-en-cdn.warthunder.com/original/4X/9/9/0/990e1907240313068dafcbae350e343ea6e6940d.jpeg',
        porschePage, 'blueprint', 'modern-technical-reconstruction',
        'Hilary Louis Doyle (1998), reproduced in forum discussion',
        'Doyle technical drawing of VK 45.01(P) with early low-roof turret. Modern reconstruction, not an original factory blueprint; this turret differs from the selected later-turret game configuration.',
        [{label: 'Forum bibliography — Jentz & Doyle, Panzerkampfwagen VI P and Germany’s Tiger Tanks', url: porschePage}])
    ]
  };
})();
