// Geometry engine: text -> letter outlines -> backing / connector / pegs -> closed triangle meshes.
// All coordinates are millimetres in the 3MF build-plate frame of the original
// "מסד הארץ" model, so the stand (base, arm, connector) lines up exactly.
import * as THREE from 'three';

const CL = window.ClipperLib;
const SC = 1000; // Clipper works in integers -> micrometres

export const K = {
  bossBottom: 0, slotTop: 6.3, plateBottom: 8, plateTop: 14, letterTop: 18,
  pegH: 2.6, pegTipChamfer: 0.3, holeClear: 0.15, holeDepth: 3.0, holeChamfer: 0.3, wall: 0.8,
  baselineY: 201.5, centerX: 128, refHeight: 25.6, defaultGap: 2.5,
  bossRect: [116, 216.5, 140, 231.9], slotRect: [121.8, 221.3, 134.2, 227.7],
  plate: 256,
};

// ---------------------------------------------------------------- polygon helpers
export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const orient = (r, ccw) => ((ringArea(r) > 0) === ccw ? r : r.slice().reverse());
const normPiece = (p) => ({ outer: orient(p.outer, true), holes: p.holes.map((h) => orient(h, false)) });
const toC = (r) => r.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));
const fromC = (c) => c.map((p) => [p.X / SC, p.Y / SC]);
const piecesToPaths = (ps) => ps.flatMap((p) => [toC(p.outer), ...p.holes.map(toC)]);

function treeToPieces(tree) {
  const out = [];
  const walk = (node) => {
    for (const o of node.Childs()) {
      const piece = { outer: fromC(o.Contour()), holes: [] };
      for (const h of o.Childs()) { piece.holes.push(fromC(h.Contour())); walk(h); }
      out.push(piece);
    }
  };
  walk(tree);
  return out
    .map((p) => ({ outer: p.outer, holes: p.holes.filter((h) => Math.abs(ringArea(h)) > 0.01) }))
    .filter((p) => Math.abs(ringArea(p.outer)) > 0.05 && p.outer.length >= 3)
    .map(normPiece);
}
function clip(subj, clipPaths, type) {
  const c = new CL.Clipper();
  c.AddPaths(subj, CL.PolyType.ptSubject, true);
  if (clipPaths && clipPaths.length) c.AddPaths(clipPaths, CL.PolyType.ptClip, true);
  const t = new CL.PolyTree();
  c.Execute(type, t, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return treeToPieces(t);
}
export const unionRings = (rings) => clip(rings.map(toC), null, CL.ClipType.ctUnion);
export const unionPieces = (...lists) => clip(piecesToPaths(lists.flat()), null, CL.ClipType.ctUnion);
export const intersectPieces = (a, b) => clip(piecesToPaths(a), piecesToPaths(b), CL.ClipType.ctIntersection);
export const fillHoles = (ps) => unionPieces(ps.map((p) => ({ outer: p.outer, holes: [] })));
export function offsetPieces(ps, d) {
  const co = new CL.ClipperOffset(2, 0.02 * SC);
  co.AddPaths(piecesToPaths(ps), CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
  const t = new CL.PolyTree();
  co.Execute(t, d * SC);
  return treeToPieces(t);
}
export const rectPiece = (x0, y0, x1, y1) => ({ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] });
export function circleRing(cx, cy, r, n = 40, ccw = true) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return ccw ? pts : pts.reverse();
}
export function piecesBounds(ps) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of ps) for (const [x, y] of p.outer) {
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x; if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
  }
  return b;
}
const mapPieces = (ps, f) => ps.map((p) => ({ outer: p.outer.map(f), holes: p.holes.map((h) => h.map(f)) }));
function pointInRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export const pointInPiece = (x, y, p) => pointInRing(x, y, p.outer) && !p.holes.some((h) => pointInRing(x, y, h));
function distToRing(x, y, r) {
  let best = Infinity;
  for (let i = 0, n = r.length; i < n; i++) {
    const [ax, ay] = r[i], [bx, by] = r[(i + 1) % n];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x, ey = ay + t * dy - y, d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ---------------------------------------------------------------- glyphs & layout
function flattenCommands(cmds, scale) {
  const rings = []; let cur = null, px = 0, py = 0;
  const seg = (len) => Math.max(2, Math.min(24, Math.ceil((len * scale) / 0.35)));
  for (const c of cmds) {
    if (c.type === 'M') { if (cur && cur.length > 2) rings.push(cur); cur = [[c.x * scale, c.y * scale]]; }
    else if (c.type === 'L') cur.push([c.x * scale, c.y * scale]);
    else if (c.type === 'Q') {
      const n = seg(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x - c.x1, c.y - c.y1));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([(u * u * px + 2 * u * t * c.x1 + t * t * c.x) * scale, (u * u * py + 2 * u * t * c.y1 + t * t * c.y) * scale]);
      }
    } else if (c.type === 'C') {
      const n = seg(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([
          (u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x) * scale,
          (u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y) * scale,
        ]);
      }
    } else if (c.type === 'Z') { if (cur && cur.length > 2) rings.push(cur); cur = null; }
    if (c.x !== undefined) { px = c.x; py = c.y; }
  }
  if (cur && cur.length > 2) rings.push(cur);
  // drop duplicated closing point
  return rings.map((r) => { const a = r[0], b = r[r.length - 1]; return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6 ? r.slice(0, -1) : r; });
}

export function fontRefUnits(font) {
  for (const ch of ['ד', 'ר', 'H']) {
    const g = font.charToGlyph(ch);
    if (g && g.index) { const bb = g.getBoundingBox(); if (bb.y2 > 0) return bb.y2; }
  }
  return font.unitsPerEm * 0.7;
}
function fontGlyph(fonts, ch, height) {
  for (const f of fonts) {
    if (!f) continue;
    const g = f.font.charToGlyph(ch);
    if (!g || !g.index) continue;
    const rings = flattenCommands(g.path.commands, height / f.ref);
    if (!rings.length) return null;
    return unionRings(rings);
  }
  return null;
}

const ORIG_SEQ = ['מ', 'ס', 'ד', 'ה', 'א', 'ר', 'ץ'];
let ORIG_GAPS = null;
function origGaps(glyphs) {
  if (ORIG_GAPS) return ORIG_GAPS;
  ORIG_GAPS = {};
  for (let i = 0; i + 1 < ORIG_SEQ.length; i++) {
    const a = glyphs[ORIG_SEQ[i]], b = glyphs[ORIG_SEQ[i + 1]];
    ORIG_GAPS[ORIG_SEQ[i] + ORIG_SEQ[i + 1]] = a.origX - (b.origX + b.width);
  }
  return ORIG_GAPS;
}

const isLTR = (c) => /[A-Za-z0-9À-ɏ]/.test(c);
// Right-to-left placement order with simple handling of embedded LTR runs (latin / digits)
function placementOrder(text) {
  const items = []; let li = 0;
  for (const c of [...text]) items.push({ c, li: /\s/.test(c) ? -1 : li++ });
  const out = []; let run = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const ltrSpace = /\s/.test(it.c) && run.length && items[i + 1] && isLTR(items[i + 1].c);
    if (isLTR(it.c) || ltrSpace) run.push(it);
    else { if (run.length) { out.push(...run.reverse()); run = []; } out.push(it); }
  }
  if (run.length) out.push(...run.reverse());
  return out;
}

/**
 * Lay out text right-to-left.
 * src: { original: {glyphs}, fonts: [{font, ref}] }  (original may be null)
 * Returns { letters: [{char, li, pieces}], missing: [] }
 */
export function layoutText(text, src, P) {
  const letters = [], missing = [];
  const order = placementOrder(text);
  const gaps = src.original ? origGaps(src.original.glyphs) : {};
  let cursor = 0, pendingSpace = 0, prev = null;
  for (const it of order) {
    if (it.li < 0) { pendingSpace += P.wordSpace; continue; }
    let pieces = null, fromOriginal = false;
    if (src.original && src.original.glyphs[it.c]) {
      const s = P.height / K.refHeight;
      pieces = src.original.glyphs[it.c].shape.map((p) => normPiece(mapPieces([p], ([x, y]) => [x * s, y * s])[0]));
      fromOriginal = true;
    } else {
      pieces = fontGlyph(src.fonts, it.c, P.height);
    }
    if (!pieces || !pieces.length) { missing.push(it.c); continue; }
    const b = piecesBounds(pieces);
    const w = b.maxX - b.minX;
    let gap = 0;
    if (prev) {
      const key = prev.c + it.c;
      gap = (prev.orig && fromOriginal && gaps[key] !== undefined ? gaps[key] - K.defaultGap : 0) + P.spacing + pendingSpace;
    }
    const right = cursor - gap, left = right - w;
    letters.push({ char: it.c, li: it.li, pieces: mapPieces(pieces, ([x, y]) => [x - b.minX + left, y]) });
    cursor = left; pendingSpace = 0; prev = { c: it.c, orig: fromOriginal };
  }
  if (letters.length) {
    const all = piecesBounds(letters.flatMap((l) => l.pieces));
    const dx = K.centerX + P.offsetX - (all.minX + all.maxX) / 2, dy = K.baselineY + P.offsetY;
    for (const l of letters) l.pieces = mapPieces(l.pieces, ([x, y]) => [x + dx, y + dy]);
  }
  letters.sort((a, b) => a.li - b.li);
  return { letters, missing };
}

// ---------------------------------------------------------------- backing + connector
export function buildBacking(letters, P, notes) {
  if (!letters.length) return { backing: [], boss: [] };
  const allLetters = letters.flatMap((l) => l.pieces);
  let b = fillHoles(offsetPieces(unionPieces(allLetters), P.border));
  const [sx0, sy0, sx1, sy1] = K.slotRect, g = 2.0;
  b = unionPieces(b, [rectPiece(sx0 - g, sy0 - g, sx1 + g, sy1 + g)]);
  if (b.length > 1) {
    const lb = piecesBounds(allLetters), base = K.baselineY + P.offsetY;
    const bar = rectPiece(lb.minX, base + 0.25 * P.height, lb.maxX, base + 0.72 * P.height);
    b = fillHoles(unionPieces(b, [bar]));
    notes.push({ level: 'info', text: 'Some letters were too far apart for the background to touch, so a bridge was added to keep it in one piece.' });
  }
  if (b.length > 1) notes.push({ level: 'warn', text: 'The background is in several separate pieces – the text may be too far from the stand connector. Move the text back toward the centre.' });
  // connector block under the plate: the stand's original block, clipped to the background
  // (inset 0.2 mm so it never shares an edge with the plate outline -> clean manifold shells)
  const boss = intersectPieces(offsetPieces(b, -0.2), [rectPiece(...K.bossRect)]);
  return { backing: b, boss };
}

// ---------------------------------------------------------------- pegs
export function pegsForPiece(piece) {
  const b = piecesBounds([piece]);
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  const step = Math.max(0.2, Math.sqrt(area / 9000));
  const pts = [];
  for (let x = b.minX + step / 2; x < b.maxX; x += step)
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      if (!pointInPiece(x, y, piece)) continue;
      let d = distToRing(x, y, piece.outer);
      for (const h of piece.holes) d = Math.min(d, distToRing(x, y, h));
      pts.push([x, y, d]);
    }
  // try roomy 2.5 mm pegs first, then thinner walls, then 2.0 mm pegs
  const tiers = [{ d: 2.5, wall: 1.2 }, { d: 2.5, wall: K.wall }, { d: 2.0, wall: K.wall }];
  let single = null;
  for (const t of tiers) {
    const rH = t.d / 2 + K.holeClear, need = rH + t.wall;
    let cand = pts.filter((p) => p[2] >= need);
    if (!cand.length) continue;
    if (!single) { const top = cand.reduce((a, p) => (p[2] > a[2] ? p : a)); single = { d: t.d, pegs: [{ x: top[0], y: top[1], d: t.d }] }; }
    if (cand.length > 900) { const k = Math.ceil(cand.length / 900); cand = cand.filter((_, i) => i % k === 0); }
    let best = null, bd = -1;
    for (let i = 0; i < cand.length; i++)
      for (let j = i + 1; j < cand.length; j++) {
        const d = (cand[i][0] - cand[j][0]) ** 2 + (cand[i][1] - cand[j][1]) ** 2;
        if (d > bd) { bd = d; best = [cand[i], cand[j]]; }
      }
    if (best && Math.sqrt(bd) >= 2 * rH + 2) return { d: t.d, pegs: best.map((p) => ({ x: p[0], y: p[1], d: t.d })) };
  }
  return single || { d: 0, pegs: [] };
}

// ---------------------------------------------------------------- mesh building
export class MeshB {
  constructor() { this.v = []; this.f = []; }
  ring(r, z) { const s = this.v.length; for (const [x, y] of r) this.v.push([x, y, z]); return r.map((_, i) => s + i); }
  wall(a, b) {
    const n = a.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.f.push([a[i], a[j], b[j]], [a[i], b[j], b[i]]); }
  }
  cap(outer, holes, up) {
    const V = this.v, vec = (i) => new THREE.Vector2(V[i][0], V[i][1]);
    const tris = THREE.ShapeUtils.triangulateShape(outer.map(vec), holes.map((h) => h.map(vec)));
    const all = outer.concat(...holes);
    for (const t of tris) {
      let [a, b, c] = t.map((k) => all[k]);
      const sa = (V[b][0] - V[a][0]) * (V[c][1] - V[a][1]) - (V[c][0] - V[a][0]) * (V[b][1] - V[a][1]);
      if (sa > 0 !== up) [b, c] = [c, b];
      this.f.push([a, b, c]);
    }
  }
  // prism between z0..z1 for each piece, with optional blind holes opening on the bottom face
  solid(pieces, z0, z1, blind = []) {
    for (const p of pieces) {
      const mine = blind.filter((bl) => pointInPiece(bl.cx, bl.cy, p));
      const oLo = this.ring(p.outer, z0), oHi = this.ring(p.outer, z1);
      const hLo = p.holes.map((h) => this.ring(h, z0)), hHi = p.holes.map((h) => this.ring(h, z1));
      this.wall(oLo, oHi); hLo.forEach((h, i) => this.wall(h, hHi[i]));
      const bl = mine.map((m) => m.levels.map((L) => this.ring(L.ring, L.z)));
      for (const lv of bl) { for (let i = 0; i + 1 < lv.length; i++) this.wall(lv[i], lv[i + 1]); this.cap(lv[lv.length - 1], [], false); }
      this.cap(oLo, [...hLo, ...bl.map((l) => l[0])], false);
      this.cap(oHi, hHi, true);
    }
    return this;
  }
  // convex stack of rings (all CCW), capped at both ends
  stack(levels) {
    const ids = levels.map((L) => this.ring(L.ring, L.z));
    for (let i = 0; i + 1 < ids.length; i++) this.wall(ids[i], ids[i + 1]);
    this.cap(ids[0], [], false); this.cap(ids[ids.length - 1], [], true);
    return this;
  }
  append(m) { const s = this.v.length; this.v.push(...m.v); for (const t of m.f) this.f.push([t[0] + s, t[1] + s, t[2] + s]); return this; }
  transformed(fn) { const m = new MeshB(); m.v = this.v.map(fn); m.f = this.f.map((t) => t.slice()); return m; }
  bounds() {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const v of this.v) for (let k = 0; k < 3; k++) { if (v[k] < b.min[k]) b.min[k] = v[k]; if (v[k] > b.max[k]) b.max[k] = v[k]; }
    return b;
  }
  static from(o) { const m = new MeshB(); m.v = o.v.map((p) => p.slice()); m.f = o.f.map((t) => t.slice()); return m; }
}

export function letterMesh(pieces, pegs) {
  const blind = pegs.map((p) => {
    const rH = p.d / 2 + K.holeClear;
    return {
      cx: p.x, cy: p.y,
      levels: [
        { ring: circleRing(p.x, p.y, rH + K.holeChamfer, 40, false), z: K.plateTop },
        { ring: circleRing(p.x, p.y, rH, 40, false), z: K.plateTop + K.holeChamfer },
        { ring: circleRing(p.x, p.y, rH, 40, false), z: K.plateTop + K.holeDepth },
      ],
    };
  });
  return new MeshB().solid(pieces, K.plateTop, K.letterTop, blind);
}
export function backingMesh(backing, boss) {
  const m = new MeshB().solid(backing, K.plateBottom, K.plateTop);
  const [x0, y0, x1, y1] = K.slotRect;
  const slot = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]; // clockwise
  m.solid(boss, K.bossBottom, K.plateBottom, [{ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, levels: [{ ring: slot, z: K.bossBottom }, { ring: slot, z: K.slotTop }] }]);
  return m;
}
export function pegsMesh(pegs) {
  const m = new MeshB();
  for (const p of pegs) {
    const r = p.d / 2;
    m.stack([
      { ring: circleRing(p.x, p.y, r, 32), z: K.plateTop },
      { ring: circleRing(p.x, p.y, r, 32), z: K.plateTop + K.pegH - K.pegTipChamfer },
      { ring: circleRing(p.x, p.y, r - K.pegTipChamfer, 32), z: K.plateTop + K.pegH },
    ]);
  }
  return m;
}
// Separate letters print face-up: just drop the mounted letter onto the bed. The peg holes open
// onto the bed and their 3 mm ceilings are short bridges, so no supports are needed.
export const dropForPrint = (m) => m.transformed(([x, y, z]) => [x, y, z - K.plateTop]);

// Simple shelf packing of separate parts into free areas of the build plate.
export function packParts(meshes) {
  const regions = [{ x0: 188, y0: 8, x1: 250, y1: 182 }, { x0: 8, y0: 80, x1: 146, y1: 182 }];
  const out = []; let ri = 0, cx = regions[0].x0, cy = regions[0].y0, rowH = 0, overflow = false;
  for (const m of meshes) {
    const b = m.bounds(), w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], gap = 4;
    for (;;) {
      const R = regions[ri];
      if (!R) { overflow = true; break; }
      if (cx + w > R.x1) { cx = R.x0; cy += rowH + gap; rowH = 0; }
      if (cy + h > R.y1) { ri++; if (regions[ri]) { cx = regions[ri].x0; cy = regions[ri].y0; rowH = 0; } continue; }
      break;
    }
    const dx = cx - b.min[0], dy = cy - b.min[1];
    out.push(m.transformed(([x, y, z]) => [x + dx, y + dy, z]));
    cx += w + gap; rowH = Math.max(rowH, h);
  }
  return { meshes: out, overflow };
}

// Count edges not shared by exactly two faces (0 = closed, printable shell).
export function openEdges(m) {
  const key = (a, b) => { const p = m.v[a], q = m.v[b]; const s = (v) => v.map((x) => x.toFixed(4)).join(','); const A = s(p), B = s(q); return A < B ? A + '|' + B : B + '|' + A; };
  const c = new Map();
  for (const [a, b, d] of m.f) for (const [u, v] of [[a, b], [b, d], [d, a]]) { const k = key(u, v); c.set(k, (c.get(k) || 0) + 1); }
  let bad = 0; for (const n of c.values()) if (n !== 2) bad++;
  return bad;
}
