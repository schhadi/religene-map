/* ============================================================
   RELI-GENE — static poster builder
   ------------------------------------------------------------
   Renders the interactive map (../index.html) as a flat picture you can drop
   into Prezi, PowerPoint, Keynote or a PDF — anywhere an iframe can't go.

     npm install            (once — d3-geo, topojson-client, playwright)
     npm run build          (writes poster.html / slide.html + the PNGs)

   All data is read straight out of ../index.html, so editing PLACES / GROUPS
   there and re-running this keeps the picture in step with the live map.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {geoMercator, geoPath} from 'd3-geo';
import {chromium} from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ============================================================
   1 · READ THE LIVE MAP'S DATA
   ============================================================ */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* brand palette straight from the :root block */
const CSSVARS = Object.fromEntries(
  [...html.match(/:root\{[\s\S]*?\n  \}/)[0].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(m => [m[1], m[2].trim()])
);
const C = k => CSSVARS['--' + k];

/* the three data blocks — GROUPS calls getCss() for its colours, so stub it */
function evalBlock(name, open, close){
  const start = html.indexOf(`const ${name} = ${open}`);
  const end   = html.indexOf(`\n${close};`, start);
  const src   = html.slice(start + `const ${name} = `.length, end + 1 + close.length);
  return new Function('getCss', `return ${src}`)(C_fromVar);
}
const C_fromVar = v => CSSVARS[v.trim()] || '#000';
const PLACES    = evalBlock('PLACES',    '{', '}');
const GROUPS    = evalBlock('GROUPS',    '[', ']');
const COUNTRIES = JSON.parse(html.match(/const COUNTRIES = (\{[\s\S]*?\});\n/)[1]);
const SITE_KEYS = new Function(`return ${html.match(/const SITE_KEYS = (\[[^\]]*\])/)[1]}`)();
const SITE_COLORS = {jerusalem: C('c-jerusalem'), uae: C('c-emirati')};

const BASEMAP = JSON.parse(fs.readFileSync(path.join(HERE, 'basemap.json'), 'utf8'));
const FONTS   = fs.readFileSync(path.join(HERE, 'fonts.css'), 'utf8');

/* ============================================================
   2 · GEOMETRY — same curves as the live map, same Mercator
   ============================================================ */
/* verbatim from index.html: quadratic Bézier bent in lat/lng space */
function curve(a, b, bend = 0.20, steps = 96){
  const [y1,x1]=a, [y2,x2]=b, mx=(y1+y2)/2, my=(x1+x2)/2, dx=y2-y1, dy=x2-x1;
  const cy = mx - dy*bend, cx = my + dx*bend, pts=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps, u=1-t;
    pts.push([u*u*y1 + 2*u*t*cy + t*t*y2, u*u*x1 + 2*u*t*cx + t*t*x2]);
  }
  return pts;                                  // [[lat,lng], …]
}
const lnglat = pts => pts.map(([la,ln]) => [ln,la]);

/* every edge, in draw order: kinship under migration so arrows stay legible */
const EDGES = [];
for(const g of GROUPS)
  for(const [from,to] of g.edges)
    EDGES.push({g, from, to, pts: curve(PLACES[from].ll, PLACES[to].ll)});
EDGES.sort((a,b) => (a.g.directed?1:0) - (b.g.directed?1:0));

/* what the view has to contain — mirrors HOME_BOUNDS in index.html, which
   leaves the USA outline out of the fit so Europe isn't squeezed to a sliver */
function fitTarget(){
  const geoms = [];
  for(const k in PLACES) geoms.push({type:'Point', coordinates:[PLACES[k].ll[1], PLACES[k].ll[0]]});
  for(const e of EDGES)  geoms.push({type:'LineString', coordinates:lnglat(e.pts)});
  for(const k in COUNTRIES) if(k !== 'newyork') geoms.push(COUNTRIES[k]);
  return {type:'GeometryCollection', geometries: geoms};
}

/* ============================================================
   3 · LAYOUT
   ============================================================ */
const LAYOUTS = {
  /* the "everything" picture: map + every hover note spelled out as a card */
  poster: {W:1920, H:1080, header:92, band:270, pad:[26,26,18,26], detail:true,
           legend:'card', file:'religene-map-poster'},
  /* clean version to talk over: big map, legend along the foot, no paragraphs */
  slide:  {W:1920, H:1080, header:92, band:116, pad:[26,44,20,44], detail:false,
           legend:'bar', file:'religene-map-slide'},
};

/* at poster size a few labels would otherwise sit on their own arcs */
const LABEL_NUDGE = {
  poster: {germany:[12,-30], sweden:[6,-10], london:[-8,-32], newyork:[2,-30],
           jerusalem:[0,16], syria:[42,-24], iraq:[30,-6], uae:[0,16]},
  slide:  {germany:[12,-30], sweden:[6,-10], london:[-8,-32], newyork:[2,-30],
           jerusalem:[0,16], syria:[42,-24], iraq:[30,-6], uae:[0,16]},
};

function build(kind){
  const L = LAYOUTS[kind];
  const mapH = L.H - L.header - L.band;
  const [pt,pr,pb,pl] = L.pad;
  const proj = geoMercator().fitExtent(
    [[pl, L.header + pt], [L.W - pr, L.header + mapH - pb]], fitTarget());
  const p    = geoPath(proj);
  const xy   = ([la,ln]) => proj([ln,la]);

  /* ---------- basemap + outlines ---------- */
  let svg = '';
  svg += `<rect x="0" y="${L.header}" width="${L.W}" height="${mapH}" fill="var(--sea)"/>`;
  svg += `<g class="land">` + BASEMAP.features.map(f =>
            `<path d="${p(f)}"/>`).join('') + `</g>`;

  const outline = (k, color, isSite) => COUNTRIES[k]
    ? `<path class="outline" d="${p({type:'Feature',geometry:COUNTRIES[k]})}" `+
      `fill="${color}" fill-opacity="${isSite?0.10:0.15}" stroke="${color}"/>`
    : '';
  svg += SITE_KEYS.map(k => outline(k, SITE_COLORS[k] || C('c-site'), true)).join('');
  svg += GROUPS.filter(g => g.origin).map(g => outline(g.origin, g.raw, false)).join('');

  /* ---------- flow lines ---------- */
  const line = pts => 'M' + pts.map(ll => xy(ll).map(v => v.toFixed(1)).join(',')).join('L');
  /* triangular head, matching L.Symbol.arrowHead (60° included angle). `pull` walks
     the tip back along the line so heads arriving at the same city don't stack up. */
  function head(pts, atEnd, size, pull = 0){
    const P   = pts.map(xy);
    const seq = atEnd ? P.slice().reverse() : P;             // walk inwards from this end
    let d = 0, i = 0;
    while(i < seq.length - 1 && d < pull){
      d += Math.hypot(seq[i+1][0] - seq[i][0], seq[i+1][1] - seq[i][1]); i++;
    }
    const tip = seq[i], from = seq[Math.min(seq.length - 1, i + 5)];
    const dx = from[0] - tip[0], dy = from[1] - tip[1];
    const len = Math.hypot(dx, dy) || 1, ux = dx/len, uy = dy/len, t = Math.tan(Math.PI/6) * size;
    return `${tip[0].toFixed(1)},${tip[1].toFixed(1)} `+
           `${(tip[0]+ux*size-uy*t).toFixed(1)},${(tip[1]+uy*size+ux*t).toFixed(1)} `+
           `${(tip[0]+ux*size+uy*t).toFixed(1)},${(tip[1]+uy*size-ux*t).toFixed(1)}`;
  }
  const arrived = {};                       // heads already landed at a place → stagger the next
  const pullFor = k => 15 * (arrived[k] = (arrived[k] || 0) + 1) - 15;

  for(const e of EDGES){
    const d = line(e.pts);
    svg += `<path d="${d}" fill="none" stroke="${e.g.raw}" stroke-opacity=".18" stroke-width="9"/>`;
    svg += e.g.directed
      ? `<path d="${d}" fill="none" stroke="${e.g.raw}" stroke-width="3.4" stroke-linecap="round"/>`
      : `<path d="${d}" fill="none" stroke="${e.g.raw}" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="0.1 11"/>`;
    if(e.g.directed)
      svg += `<polygon points="${head(e.pts,true,17,pullFor(e.to))}" fill="${e.g.raw}"/>`;
    else for(const [end,place] of [[true,e.to],[false,e.from]])
      svg += `<polygon points="${head(e.pts,end,11,pullFor(place))}" fill="${e.g.raw}" fill-opacity=".9"/>`;
  }

  /* ---------- place labels (same offsets as the live divIcons) ---------- */
  const ORIGIN_COLOR = Object.fromEntries(GROUPS.filter(g => g.origin).map(g => [g.origin, g.raw]));
  const labels = Object.entries(PLACES).map(([k,pl]) => {
    const [x,y] = xy(pl.ll);
    const a = pl.lbl || [-8,8];                       // Leaflet iconAnchor
    const n = LABEL_NUDGE[kind][k] || [0,0];
    const col = ORIGIN_COLOR[k] || SITE_COLORS[k] || C('c-site');
    const cls = `site-label${pl.side==='left' ? ' lbl-left' : ''}`;
    return `<div class="${cls}" style="left:${(x-a[0]+n[0]).toFixed(1)}px;top:${(y-a[1]+n[1]).toFixed(1)}px;--c:${col}">${pl.name}</div>`;
  }).join('');

  /* ---------- legend ---------- */
  const swatch = g => g.directed
    ? `<span class="sw"><i style="background:${g.raw}"></i><b style="border-left-color:${g.raw}"></b></span>`
    : `<span class="sw"><i class="dot" style="--c:${g.raw}"></i></span>`;
  const legendRows = GROUPS.map(g =>
    `<div class="lrow">${swatch(g)}<span class="ltxt"><b>${g.label}</b>`+
    `<small>${g.directed ? 'Migration flow · direction of movement' : 'Kinship network · ties run both ways'}</small></span></div>`).join('');
  const sitesRow =
    `<div class="lrow"><span class="sw"><i class="area" style="--c:${C('c-site')}"></i></span>
       <span class="ltxt"><b>Field sites</b><small>${L.legend==='bar' ? 'Country outlines' : 'Country outlines · Jerusalem · Germany · Sweden · UAE · London · New York'}</small></span></div>`;
  const legend = L.legend === 'card'
    ? `<div class="legend"><h4>Layers</h4>${sitesRow}${legendRows}</div>`
    : `<div class="legend bar"><h4>Layers</h4>${sitesRow}${legendRows}
         <span class="credit">Base map: Natural Earth<br>Interactive map: effortless-moonbeam-1e400a.netlify.app</span></div>`;

  /* ---------- detail cards (what hovering the live map reveals) ---------- */
  const card = (kicker, color, title, text, pairs) =>
    `<div class="card" style="border-left-color:${color}"><span class="tk" style="color:${color}">${kicker}</span>`+
    `<div class="ttl">${title}</div><p class="tx">${text}</p>`+
    (pairs ? `<p class="pairs" style="color:${color}">${pairs}</p>` : '') + `</div>`;
  const cards = L.detail ? [
    ...SITE_KEYS.map(k => card('Field site', SITE_COLORS[k] || C('c-site'), PLACES[k].name, PLACES[k].note)),
    ...GROUPS.filter(g => g.origin).map(g =>
        card('Origin of displacement', g.raw, PLACES[g.origin].name, PLACES[g.origin].note)),
    ...GROUPS.map(g => card(g.directed ? 'Migration flow' : 'Kinship network', g.raw, g.label, g.desc,
        g.edges.map(([f,t]) => `${PLACES[f].name} ${g.directed?'&rarr;':'&harr;'} ${PLACES[t].name}`).join(' · '))),
  ].join('') : '';

  const detail = L.detail ? `<div class="band"><div class="cards">${cards}
      <div class="card note"><span class="tk">How to read the map</span>
        <div class="ttl">Lines &amp; outlines</div>
        <p class="tx">Coloured outlines are field-site countries; tinted fills mark origins of
        displacement. Solid lines with an arrowhead are migration flows, pointing the way people
        moved. Dotted lines are kinship ties, running both ways.</p>
        <p class="pairs credit">Base map: Natural Earth · Interactive map: effortless-moonbeam-1e400a.netlify.app</p></div>
    </div></div>` : '';

  /* ---------- page ---------- */
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>RELI-GENE — Transnational Field Sites &amp; Kinship Networks</title>
<style>
${FONTS}
:root{
  --brand:${C('brand')}; --ink:${C('ink')}; --muted:${C('muted')}; --paper:${C('paper')};
  --line:${C('line')}; --tan:${C('tan')};
  --sea:#e7edf0; --land:#f4f1ea; --border:#dcd5c7;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${L.W}px;height:${L.H}px;position:relative;overflow:hidden;background:var(--paper);
     font-family:"Inter",system-ui,Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
svg{position:absolute;inset:0;width:${L.W}px;height:${L.H}px}
.land path{fill:var(--land);stroke:var(--border);stroke-width:.7;stroke-linejoin:round}
.outline{stroke-width:1.7;stroke-opacity:.92;stroke-linejoin:round}

/* ---------- header ---------- */
header{position:absolute;left:0;top:0;width:${L.W}px;height:${L.header}px;z-index:5;
  display:flex;align-items:center;gap:26px;padding:0 40px;background:var(--paper);
  border-bottom:1px solid var(--line)}
.name{font-family:"Cardo",Georgia,serif;font-weight:700;font-size:40px;line-height:1;letter-spacing:.01em;margin:0}
.name .reli{color:var(--brand)}
.rule{width:1px;height:44px;background:var(--line)}
.title{font-family:"Cardo",Georgia,serif;font-size:27px;font-weight:700;line-height:1.12;margin:0}
.sub{font-size:13px;color:var(--muted);margin:3px 0 0;letter-spacing:.005em}
.site{margin-left:auto;text-align:right;font-size:12px;color:var(--muted);line-height:1.5}
.site b{display:block;font-size:13px;color:var(--ink);letter-spacing:.02em}

/* ---------- map furniture ---------- */
.site-label{position:absolute;z-index:4;background:rgba(249,249,249,.90);border:1px solid var(--line);
  border-radius:6px;padding:2px 9px 2px 11px;font:600 15px "Inter";white-space:nowrap;color:var(--ink);
  box-shadow:0 1px 4px rgba(0,0,0,.10),inset 3px 0 0 var(--c,transparent)}
.lbl-left{transform:translateX(calc(-100% - 16px))}

.legend{position:absolute;z-index:6;background:rgba(249,249,249,.95);border:1px solid var(--line);
  border-radius:12px;padding:15px 18px 13px;box-shadow:0 3px 16px rgba(0,0,0,.10);
  width:356px;left:30px;top:${L.header+18}px}
.legend h4{margin:0 0 9px;font-size:11px;text-transform:uppercase;letter-spacing:.11em;color:var(--muted);font-weight:700}
.lrow{display:flex;align-items:flex-start;gap:11px;margin:8px 0}
.sw{flex:0 0 30px;height:15px;position:relative;display:block;margin-top:1px}
.sw i{position:absolute;left:0;top:6px;width:22px;height:3.4px;border-radius:2px}
.sw b{position:absolute;left:21px;top:2.4px;width:0;height:0;border-top:5.5px solid transparent;
  border-bottom:5.5px solid transparent;border-left:9px solid}
.sw i.dot{background:none;border-top:4px dotted var(--c);top:5px;width:30px}
.sw i.area{background:color-mix(in srgb,var(--c) 14%,transparent);border:1.6px solid var(--c);
  border-radius:3px;width:26px;height:15px;top:0}
.ltxt{font-size:14px;line-height:1.25}
.ltxt b{font-weight:600}
.ltxt small{display:block;font-size:11.5px;color:var(--muted);margin-top:1px;line-height:1.3}

/* legend as a full-width strip along the foot of the clean slide */
.legend.bar{left:0;right:0;top:auto;bottom:0;width:${L.W}px;border:0;border-top:1px solid var(--line);
  border-radius:0;box-shadow:none;background:var(--paper);height:${L.band}px;
  display:flex;align-items:center;gap:26px;padding:0 40px}
.legend.bar h4{position:absolute;left:40px;top:14px;margin:0}
.legend.bar .lrow{flex:1 1 0;margin:14px 0 0;min-width:0}
.legend.bar .ltxt{font-size:13.5px}
.legend.bar .ltxt small{font-size:11px}
.legend.bar .credit{flex:0 0 auto;align-self:flex-end;margin-bottom:16px;font-size:10.5px;
  color:var(--muted);line-height:1.5;text-align:right}

/* ---------- detail band ---------- */
.band{position:absolute;left:0;bottom:0;width:${L.W}px;height:${L.band}px;z-index:6;
  background:var(--paper);border-top:1px solid var(--line);padding:15px 26px 13px}
.cards{display:grid;grid-template-rows:repeat(2,1fr);grid-auto-flow:column;grid-auto-columns:1fr;gap:10px 15px;height:100%}
.card{border-left:2px solid var(--line);padding:0 8px 0 10px;overflow:hidden}
.card .tk{font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;font-weight:700}
.card .ttl{font-family:"Cardo",Georgia,serif;font-size:16px;font-weight:700;line-height:1.08;margin:1px 0 3px}
.card .tx{font-size:var(--tx,11px);line-height:1.34;color:#333;margin:0}
.card .pairs{font-size:calc(var(--tx,11px) - .6px);font-weight:600;line-height:1.34;margin:3px 0 0}
.card .credit{color:var(--muted);font-weight:400}
</style></head>
<body>
<svg viewBox="0 0 ${L.W} ${L.H}">${svg}</svg>
<header>
  <p class="name"><span class="reli">RELI</span>-GENE</p>
  <div class="rule"></div>
  <div>
    <p class="title">Transnational Field Sites &amp; Kinship Networks</p>
    <p class="sub">Religion, genetics and reproduction across six field sites — and the migration and kinship ties that connect them</p>
  </div>
  <div class="site"><b>religene.eu</b>Interactive version:<br>effortless-moonbeam-1e400a.netlify.app</div>
</header>
${labels}
${legend}
${detail}
<script>
/* shrink the card text a notch at a time until every card fits its row */
(function(){
  const cards=[...document.querySelectorAll('.card')];
  if(!cards.length) return;
  const clipped=()=>cards.some(c=>c.scrollHeight>c.clientHeight+1);
  for(let size=11; clipped() && size>8.4; size-=0.25)
    document.documentElement.style.setProperty('--tx',(size-0.25)+'px');
})();
</script>
</body></html>`;
}

/* ============================================================
   4 · WRITE HTML, THEN SHOOT IT
   ============================================================ */
const SCALE = Number(process.env.SCALE || 2.5);          // 1920×1080 → 4800×2700

/* normally `npx playwright install` has put a browser where Playwright expects it;
   CHROMIUM_PATH lets a pre-installed Chromium be used instead */
async function launch(){
  const exe = process.env.CHROMIUM_PATH;
  try { return await chromium.launch(exe ? {executablePath: exe} : {}); }
  catch(err){
    for(const candidate of ['/opt/pw-browsers/chromium','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'])
      if(fs.existsSync(candidate)) return chromium.launch({executablePath: candidate});
    throw err;
  }
}
const browser = await launch();
for(const kind of Object.keys(LAYOUTS)){
  const L = LAYOUTS[kind];
  const htmlPath = path.join(HERE, `${L.file}.html`);
  fs.writeFileSync(htmlPath, build(kind));
  const page = await browser.newPage({
    viewport:{width:L.W, height:L.H}, deviceScaleFactor: SCALE});
  await page.goto('file://' + htmlPath, {waitUntil:'load'});
  await page.evaluate(() => document.fonts.ready);
  const png = path.join(HERE, `${L.file}.png`);
  await page.screenshot({path: png});
  const pdf = path.join(HERE, `${L.file}.pdf`);
  await page.pdf({path: pdf, printBackground: true,
                  width: `${L.W}px`, height: `${L.H}px`, pageRanges: '1'});
  await page.close();
  console.log(`${path.basename(png)}  ${L.W*SCALE}×${L.H*SCALE}  ${(fs.statSync(png).size/1e6).toFixed(2)} MB`+
              `   ·   ${path.basename(pdf)}  ${(fs.statSync(pdf).size/1e6).toFixed(2)} MB`);
}
await browser.close();
