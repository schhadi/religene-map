/* ============================================================
   basemap.json — one-off data prep for the poster
   ------------------------------------------------------------
   Cuts a regional base map out of Natural Earth's country outlines: 1:50m
   detail across the Atlantic, Europe and the Middle East (where the story is),
   1:110m for the far background, clipped to the poster window and rounded to
   ~1 km so the file stays small enough to sit in the repo.

   Only needed if the poster window moves — the result is committed:
     npm install world-atlas topojson-client && node build-basemap.mjs
   ============================================================ */
import fs from 'fs';
import {feature} from 'topojson-client';

const W=-126, E=106, S=14, N=78;                 // poster window (a little wider than the frame)
const CORE=[-92, 12, 74, 76];                    // 1:50m inside this box, 1:110m outside

/* Sutherland–Hodgman: clip one ring against the window, one edge at a time */
const inside={w:p=>p[0]>=W, e:p=>p[0]<=E, s:p=>p[1]>=S, n:p=>p[1]<=N};
const cross={
  w:(a,b)=>[W, a[1]+(b[1]-a[1])*(W-a[0])/(b[0]-a[0])],
  e:(a,b)=>[E, a[1]+(b[1]-a[1])*(E-a[0])/(b[0]-a[0])],
  s:(a,b)=>[a[0]+(b[0]-a[0])*(S-a[1])/(b[1]-a[1]), S],
  n:(a,b)=>[a[0]+(b[0]-a[0])*(N-a[1])/(b[1]-a[1]), N]};
function clipRing(ring){
  let out=ring;
  for(const side of ['w','e','s','n']){
    const inp=out; out=[];
    for(let i=0;i<inp.length;i++){
      const a=inp[i], b=inp[(i+1)%inp.length];
      const ai=inside[side](a), bi=inside[side](b);
      if(ai) out.push(a);
      if(ai!==bi) out.push(cross[side](a,b));
    }
    if(!out.length) return null;
  }
  return out;
}
const round=p=>[Math.round(p[0]*100)/100, Math.round(p[1]*100)/100];
function tidy(ring){                              // round, then drop points rounding made equal
  const o=[];
  for(const p of ring.map(round)){
    const l=o[o.length-1];
    if(!l || l[0]!==p[0] || l[1]!==p[1]) o.push(p);
  }
  if(o.length<4) return null;
  o[o.length-1]=o[0];
  return o;
}
function clipGeom(g){
  const parts = g.type==='Polygon' ? [g.coordinates] : g.coordinates;
  const kept=[];
  for(const poly of parts){
    const rings=[];
    for(const ring of poly){ const c=clipRing(ring), r=c&&tidy(c); if(r) rings.push(r); }
    if(rings.length) kept.push(rings);
  }
  if(!kept.length) return null;
  return kept.length===1 ? {type:'Polygon',coordinates:kept[0]} : {type:'MultiPolygon',coordinates:kept};
}
function bbox(g){
  let x0=180,y0=90,x1=-180,y1=-90;
  const walk=c=>{ if(typeof c[0]==='number'){ x0=Math.min(x0,c[0]); x1=Math.max(x1,c[0]); y0=Math.min(y0,c[1]); y1=Math.max(y1,c[1]); } else c.forEach(walk); };
  walk(g.coordinates); return [x0,y0,x1,y1];
}

const load=f=>{ const t=JSON.parse(fs.readFileSync(f,'utf8')); return feature(t,t.objects.countries).features; };
const fine   = load('node_modules/world-atlas/countries-50m.json');
const coarse = new Map(load('node_modules/world-atlas/countries-110m.json').map(f=>[f.properties.name,f]));

const features=[];
for(const f of fine){
  const b=bbox(f.geometry);
  const inCore = b[2]>=CORE[0] && b[0]<=CORE[2] && b[3]>=CORE[1] && b[1]<=CORE[3];
  const g = clipGeom((inCore ? f : coarse.get(f.properties.name) || f).geometry);
  if(g) features.push({type:'Feature',properties:{name:f.properties.name},geometry:g});
}
fs.writeFileSync('basemap.json', JSON.stringify({type:'FeatureCollection',features}));
let pts=0; const walk=c=>{ if(typeof c[0]==='number') pts++; else c.forEach(walk); };
features.forEach(f=>walk(f.geometry.coordinates));
console.log('countries', features.length, '· points', pts, '·', fs.statSync('basemap.json').size, 'bytes');
