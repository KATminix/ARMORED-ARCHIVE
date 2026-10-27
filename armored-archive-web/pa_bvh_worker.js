/* BVH builder for the path tracer (runs in a worker so the page never freezes).
   Input: triangle corner positions (Float32Array, 9 floats per triangle).
   Build: binned SAH (16 bins per axis) into a binary BVH, then collapsed into a 4-wide BVH whose
   four child boxes are stored together, so one node fetch tests four boxes (fewer, wider steps).
   Node layout (BVH4, 128 bytes = 8 x vec4):
     for child k: lo[k] = (minx,miny,minz, link), hi[k] = (maxx,maxy,maxz, count)
     link = child node index (count==0) or first triangle (count>0); count==0xFFFFFFFF marks an empty slot.
   Output: nodes (ArrayBuffer of vec4 rows), order (triangle permutation). */
'use strict';
const BINS = 16, LEAF = 4, EMPTY = 0xFFFFFFFF;
self.onmessage = e => {
  const {id, tris} = e.data, t0 = performance.now();
  const n = tris.length / 9, cen = new Float32Array(n * 3), bmn = new Float32Array(n * 3), bmx = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const a = tris[i * 9 + k], b = tris[i * 9 + 3 + k], c = tris[i * 9 + 6 + k];
    const mn = Math.min(a, b, c), mx = Math.max(a, b, c); bmn[i * 3 + k] = mn; bmx[i * 3 + k] = mx; cen[i * 3 + k] = (mn + mx) * 0.5;
  }
  const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
  // binary nodes: [minx,miny,minz,maxx,maxy,maxz], left, right, first, count
  const B = {box: [], left: [], right: [], first: [], count: []};
  const area = (b) => { const x = b[3] - b[0], y = b[4] - b[1], z = b[5] - b[2]; return x < 0 ? 0 : 2 * (x * y + y * z + z * x); };
  function bounds(s, e) { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) { const t = order[i] * 3; for (let k = 0; k < 3; k++) { if (bmn[t + k] < b[k]) b[k] = bmn[t + k]; if (bmx[t + k] > b[3 + k]) b[3 + k] = bmx[t + k]; } } return b; }
  const binCnt = new Int32Array(BINS), binBox = new Float64Array(BINS * 6), rA = new Float64Array(BINS), rC = new Int32Array(BINS);
  function node(s, e) {
    const id = B.box.length, box = bounds(s, e); B.box.push(box); B.left.push(-1); B.right.push(-1); B.first.push(s); B.count.push(e - s);
    const cnt = e - s; if (cnt <= LEAF) return id;
    let cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) { const t = order[i] * 3; for (let k = 0; k < 3; k++) { const c = cen[t + k]; if (c < cmn[k]) cmn[k] = c; if (c > cmx[k]) cmx[k] = c; } }
    let best = Infinity, bAxis = -1, bSplit = 0;
    for (let ax = 0; ax < 3; ax++) {
      const ext = cmx[ax] - cmn[ax]; if (ext <= 1e-9) continue; const sc = BINS / ext;
      binCnt.fill(0); for (let b = 0; b < BINS; b++) { binBox[b * 6] = binBox[b * 6 + 1] = binBox[b * 6 + 2] = Infinity; binBox[b * 6 + 3] = binBox[b * 6 + 4] = binBox[b * 6 + 5] = -Infinity; }
      for (let i = s; i < e; i++) { const t = order[i] * 3; let b = Math.min(BINS - 1, ((cen[t + ax] - cmn[ax]) * sc) | 0); binCnt[b]++;
        const o = b * 6; for (let k = 0; k < 3; k++) { if (bmn[t + k] < binBox[o + k]) binBox[o + k] = bmn[t + k]; if (bmx[t + k] > binBox[o + 3 + k]) binBox[o + 3 + k] = bmx[t + k]; } }
      // sweep from the right, then evaluate from the left
      let acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], c = 0;
      for (let b = BINS - 1; b > 0; b--) { c += binCnt[b]; const o = b * 6; for (let k = 0; k < 3; k++) { acc[k] = Math.min(acc[k], binBox[o + k]); acc[3 + k] = Math.max(acc[3 + k], binBox[o + 3 + k]); } rA[b] = area(acc); rC[b] = c; }
      acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; c = 0;
      for (let b = 0; b < BINS - 1; b++) { c += binCnt[b]; const o = b * 6; for (let k = 0; k < 3; k++) { acc[k] = Math.min(acc[k], binBox[o + k]); acc[3 + k] = Math.max(acc[3 + k], binBox[o + 3 + k]); }
        if (!c || !rC[b + 1]) continue; const cost = area(acc) * c + rA[b + 1] * rC[b + 1]; if (cost < best) { best = cost; bAxis = ax; bSplit = b + 1; } }
    }
    const leafCost = area(box) * cnt; let mid;
    if (bAxis < 0 || best >= leafCost && cnt <= 16) { if (bAxis < 0 && cnt > LEAF) mid = (s + e) >> 1; else return id; }
    else { const ext = cmx[bAxis] - cmn[bAxis], sc = BINS / ext; let i = s, j = e - 1;
      while (i <= j) { const b = Math.min(BINS - 1, ((cen[order[i] * 3 + bAxis] - cmn[bAxis]) * sc) | 0); if (b < bSplit) i++; else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; } }
      mid = i; if (mid === s || mid === e) mid = (s + e) >> 1; }
    B.count[id] = 0; const l = node(s, mid), r = node(mid, e); B.left[id] = l; B.right[id] = r; return id;
  }
  node(0, n);
  // collapse binary → 4-wide: each wide node takes up to 4 descendants, opening the largest internal child first
  const wide = [], queue = [0], wideOf = new Map(); wideOf.set(0, 0); wide.push(null);
  while (queue.length) {
    const bi = queue.shift(), wi = wideOf.get(bi); let kids = B.count[bi] > 0 ? [bi] : [B.left[bi], B.right[bi]];
    while (kids.length < 4) { let k = -1, ba = -1; kids.forEach((c, i) => { if (B.count[c] === 0) { const a = area(B.box[c]); if (a > ba) { ba = a; k = i; } } }); if (k < 0) break; const c = kids[k]; kids.splice(k, 1, B.left[c], B.right[c]); }
    const slots = kids.map(c => { if (B.count[c] > 0) return {c, leaf: true}; const w = wide.length; wide.push(null); wideOf.set(c, w); queue.push(c); return {c, leaf: false, w}; });
    wide[wi] = slots;
  }
  const out = new Float32Array(wide.length * 32), u = new Uint32Array(out.buffer);
  wide.forEach((slots, wi) => { for (let k = 0; k < 4; k++) { const o = wi * 32 + k * 8, sl = slots[k];
    if (!sl) { out[o] = out[o + 1] = out[o + 2] = 1e30; out[o + 4] = out[o + 5] = out[o + 6] = -1e30; u[o + 3] = 0; u[o + 7] = EMPTY; continue; }
    const b = B.box[sl.c]; out[o] = b[0]; out[o + 1] = b[1]; out[o + 2] = b[2]; out[o + 4] = b[3]; out[o + 5] = b[4]; out[o + 6] = b[5];
    if (sl.leaf) { u[o + 3] = B.first[sl.c]; u[o + 7] = B.count[sl.c]; } else { u[o + 3] = sl.w; u[o + 7] = 0; } } });
  // a lone leaf root still works: wide[0] holds it as a single leaf slot
  self.postMessage({id, nodes: out.buffer, order: order.buffer, stats: {tris: n, binary: B.box.length, wide: wide.length, ms: Math.round(performance.now() - t0)}}, [out.buffer, order.buffer]);
};
