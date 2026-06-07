# RELI-GENE — Transnational Field Sites & Kinship Networks

An interactive [Leaflet](https://leafletjs.com) map of the RELI-GENE project's field sites and
transnational diaspora/kinship networks. Everything lives in one file: **`index.html`**
(no build step, no API key, no account).

- **Field sites:** Jerusalem · Germany · Sweden · UAE · London · New York — shown as **country outlines**
- **Migration flows (arrowheads):** Palestinian, Iraqi & Syrian diaspora → Germany & Sweden
- **Kinship networks (dotted, bidirectional):** Jerusalem · London · New York · and UAE · UK
- **Hover** any country or flow line to read its details (no clicking, no sidebar).

---

## Edit the data

Open `index.html` and edit the two blocks near the top of the `<script>` — nothing else needs touching.

- **`PLACES`** — add or move a location. Each entry is `key: { ll:[lat,lng], name, type, note }`.
  `ll` anchors the place label and its flow lines; the `note` is what shows when you hover the place.
- **`GROUPS`** — add or change a flow. Each entry lists its `edges` (`[fromKey, toKey]` pairs),
  a `raw` colour, and `directed: true` (migration, gets an arrowhead) or `false` (kinship, dotted both ways).
- **`COUNTRIES`** — the embedded country-outline shapes (Natural Earth, simplified; `jerusalem` is
  Israel + Palestine merged into one outline). A new `PLACES` key with no matching `COUNTRIES` entry
  still works — it just draws a label and flow lines, with no outline.

Example — change Germany's anchor city to Berlin→Cologne, or add a new flow:
```js
// in PLACES
cologne: { ll:[50.9375, 6.9603], name:'Cologne', type:'Field site', note:'…' },
// in GROUPS
{ key:'new', label:'My flow', raw:'#d8613c', directed:true, origin:'iraq',
  edges:[['iraq','cologne']], desc:'…' },
```

---

## Embed it in the religene.eu website

Essenially, use the URL to iframe the map onto the website 


```html
<iframe src="https://effortless-moonbeam-1e400a.netlify.app/" width="100%" height="640" style="border:0;border-radius:8px"
        title="RELI-GENE transnational map" loading="lazy"></iframe>
```

Adjust `height` to taste. That's it — the live, clickable map appears inside the page.

---

## Put it in Microsoft PowerPoint

**Live & interactive (recommended):** with the page hosted (see above):
**Insert → Get Add-ins → search "Web Viewer" → Insert →** paste your URL.
The animated, clickable map runs right inside the slide.
