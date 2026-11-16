// 3MF + STL writers. Parts: [{name, mesh: MeshB, color: '#rrggbb', colorName, group: 'logo'|null}]
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function meshXML(m) {
  const out = ['<mesh><vertices>'];
  for (const [x, y, z] of m.v) out.push(`<vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}"/>`);
  out.push('</vertices><triangles>');
  for (const [a, b, c] of m.f) out.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  out.push('</triangles></mesh>');
  return out.join('\n');
}

export function build3MFModel(parts, title) {
  const mats = [];
  const matIndex = (p) => {
    const key = p.color.toLowerCase();
    let i = mats.findIndex((m) => m.color === key);
    if (i < 0) { mats.push({ color: key, name: p.colorName || key }); i = mats.length - 1; }
    return i;
  };
  let id = 2;
  const objs = [], logoComps = [], build = [];
  for (const p of parts) {
    const oid = id++;
    objs.push(`<object id="${oid}" name="${esc(p.name)}" type="model" pid="1" pindex="${matIndex(p)}">${meshXML(p.mesh)}</object>`);
    if (p.group === 'logo') logoComps.push(oid); else build.push(oid);
  }
  if (logoComps.length) {
    const lid = id++;
    objs.push(`<object id="${lid}" name="Logo (background + letters)" type="model"><components>${logoComps.map((c) => `<component objectid="${c}"/>`).join('')}</components></object>`);
    build.unshift(lid);
  }
  const base = mats.map((m) => `<base name="${esc(m.name)}" displaycolor="${m.color.toUpperCase()}FF"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">NVP Logo Maker</metadata>
<resources>
<basematerials id="1">
${base}
</basematerials>
${objs.join('\n')}
</resources><build>
${build.map((b) => `<item objectid="${b}"/>`).join('\n')}
</build></model>`;
}

export async function make3MF(parts, title) {
  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', build3MFModel(parts, title));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'model/3mf' });
}

function stlBinary(m) {
  const buf = new ArrayBuffer(84 + m.f.length * 50), dv = new DataView(buf);
  dv.setUint32(80, m.f.length, true);
  let o = 84;
  for (const [a, b, c] of m.f) {
    const A = m.v[a], B = m.v[b], C = m.v[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    for (const x of [nx / l, ny / l, nz / l, ...A, ...B, ...C]) { dv.setFloat32(o, x, true); o += 4; }
    o += 2;
  }
  return buf;
}
export async function makeSTLZip(parts) {
  const zip = new window.JSZip(), used = new Set();
  for (const p of parts) {
    let n = `${p.name} - ${p.colorName || p.color}`.replace(/[\\/:*?"<>|]/g, '_');
    while (used.has(n)) n += '_';
    used.add(n);
    zip.file(n + '.stl', stlBinary(p.mesh));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
