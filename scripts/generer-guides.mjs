// ============================================================================
// Générateur des Guides EducooO : Notion (source) -> section /guides/ du site.
//
// - Lit la base "Guides Educooo — CMS" via l'API Notion (NOTION_TOKEN).
// - Ne prend que les guides en état "À publier" ou "Publié".
// - Écrit des pages autonomes dans public/guides/<slug>/index.html
//   (public/ est copié tel quel par scripts/build.mjs -> aucun couplage).
// - Écrit l'index cherchable public/guides/index.html + public/guides/index.json.
// - Les captures vivent dans public/assets/img/guides/<slug>/NN.png (générées
//   par scripts/capturer-guides.mjs). Absentes -> placeholder "capture à venir".
// - AUTOMATE D'ÉTAT : un guide "À publier" est publié puis repassé "Publié"
//   dans Notion (sauf en DRY_RUN).
//
// Portable et headless : tourne sur le Mac OU sur le VPS (cron), il suffit de
// NOTION_TOKEN dans l'environnement. Règles d'écriture du site respectées
// (pas de tiret cadratin).
//
// Usage : DRY_RUN=1 node scripts/generer-guides.mjs   (dry-run : ne modifie pas Notion)
//         node scripts/generer-guides.mjs             (publie + repasse en Publié)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = '16b3c4d9780d4e18a6feba25e598e66e';
const TOKEN = process.env.NOTION_TOKEN;
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const RACINE = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT_GUIDES = path.join(RACINE, 'public', 'guides');
const OUT_CAPT = path.join(RACINE, 'public', 'assets', 'img', 'guides');
const BASE = 'https://educooo.com';

if (!TOKEN) { console.error('NOTION_TOKEN manquant.'); process.exit(2); }

const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sansCadratin = (s) => (s || '').replace(/—/g, ' ');

async function notion(url, opts = {}) {
  const r = await fetch('https://api.notion.com/v1' + url, { headers: H, ...opts });
  if (!r.ok) throw new Error(`Notion ${opts.method || 'GET'} ${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

// --- Lecture des guides ------------------------------------------------------
async function lireGuides() {
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    const data = await notion(`/databases/${DB}/query`, { method: 'POST', body: JSON.stringify(body) });
    out.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}
const txt = (p) => (p?.rich_text || p?.title || []).map((t) => t.plain_text).join('');
const sel = (p) => p?.select?.name || '';

async function lireBlocs(pageId) {
  const out = [];
  let cursor;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const data = await notion(`/blocks/${pageId}/children${q}`);
    out.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

// --- Rich text Notion -> HTML ------------------------------------------------
function rt(arr) {
  return (arr || []).map((t) => {
    let s = esc(t.plain_text);
    const a = t.annotations || {};
    if (a.code) s = `<code>${s}</code>`;
    if (a.bold) s = `<strong>${s}</strong>`;
    if (a.italic) s = `<em>${s}</em>`;
    if (t.href) s = `<a href="${esc(t.href)}">${s}</a>`;
    return s;
  }).join('');
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

// Convertit les blocs d'un guide en HTML de section, en injectant les captures.
function blocsVersHtml(blocs, captures) {
  const html = [];
  let bullets = [];
  let capIdx = 0;
  const flushBullets = () => {
    if (bullets.length) { html.push(`<section><ul class="liste-nue">${bullets.join('')}</ul></section>`); bullets = []; }
  };
  for (const b of blocs) {
    const type = b.type;
    if (type === 'bulleted_list_item') { bullets.push(`<li>${CHECK_SVG}<span>${rt(b.bulleted_list_item.rich_text)}</span></li>`); continue; }
    flushBullets();
    if (type === 'heading_2') {
      html.push(`<div class="titre-section"><h2>${rt(b.heading_2.rich_text)}</h2></div>`);
    } else if (type === 'heading_3') {
      html.push(`<div class="titre-section"><h2>${rt(b.heading_3.rich_text)}</h2></div>`);
    } else if (type === 'quote') {
      const q = txt(b.quote).trim();
      if (/^Gabarit du guide/i.test(q)) continue; // note interne, jamais publiée
      html.push(`<section><p class="appui">${rt(b.quote.rich_text)}</p></section>`);
    } else if (type === 'paragraph') {
      const arr = b.paragraph.rich_text;
      const plain = txt(b.paragraph).trim();
      if (!plain) continue;
      // Marqueur de capture : paragraphe commençant par l'emoji appareil photo.
      if (plain.startsWith('📸')) {
        const legende = plain.replace(/^📸\s*/, '').replace(/^\*|\*$/g, '');
        const cap = captures[capIdx++];
        if (cap) {
          const cls = cap.large ? '' : ' class="tel"';
          html.push(`<figure class="capture"><img${cls} src="${cap.src}" alt="${esc(legende)}"><figcaption>Prise automatiquement dans l'app, toujours à jour.</figcaption></figure>`);
        } else {
          html.push(`<figure class="capture"><div class="cadre"><span><span class="pastille">Capture à venir</span>${esc(legende)}</span></div></figure>`);
        }
        continue;
      }
      // Étape numérotée : "**1. Titre**" (1er fragment gras commençant par un chiffre).
      const first = arr[0];
      const m = plain.match(/^(\d+)\.\s+(.+)$/);
      if (first && first.annotations && first.annotations.bold && m) {
        html.push(`<div class="etape"><span class="num">${m[1]}</span><h2>${esc(m[2].replace(/\*+/g, ''))}</h2></div>`);
        continue;
      }
      html.push(`<section><p>${rt(arr)}</p></section>`);
    }
  }
  flushBullets();
  return html.join('\n');
}

// --- Gabarits HTML -----------------------------------------------------------
function tete(titre, description, canonical) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titre)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(titre)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${BASE}/assets/img/og.png">
<meta name="theme-color" content="#F1F0F6">
<link rel="icon" href="/assets/img/favicon.ico" sizes="any">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/guides/guides.css">
</head>
<body>
<main class="document">`;
}
const PIED = `</main>
</body>
</html>`;

function pageGuide(g) {
  const titre = `${g.titreHowTo} · Guides EducooO`;
  const canonical = `${BASE}/guides/${g.slug}/`;
  const bandeau = `
<div class="bandeau">
  <img src="/assets/img/nuage-salut.webp" alt="" width="300" height="300" loading="lazy">
  <h2>Une question sur EducooO&nbsp;?</h2>
  <p>Le plus simple est un court échange. On te montre en vrai et on répond à tes questions. Sans engagement.</p>
  <div class="badges centre-badges badges-bandeau">
    <a class="bouton" href="https://wa.me/32473122452">Nous écrire sur WhatsApp</a>
  </div>
  <span class="mention">Ou par email&nbsp;: <a href="mailto:info@educooo.com">info@educooo.com</a>. Une vraie personne te répond.</span>
</div>`;
  return sansCadratin(`${tete(titre, g.accroche || g.titreHowTo, canonical)}
<header>
  <a class="marque" href="/">Educoo<span>O</span></a>
  <h1>${esc(g.titreHowTo)}</h1>
  ${g.accroche ? `<p class="date">${esc(g.accroche)}</p>` : ''}
</header>
<p class="fil"><a href="/guides/">Guides</a>${g.public && g.public !== 'Les deux' ? ` · ${esc(g.public)}` : ''}</p>
${g.corps}
${bandeau}
${PIED}`);
}

function pageIndex(guides) {
  const data = guides.map((g) => ({ slug: g.slug, titre: g.titreHowTo, accroche: g.accroche, public: g.public, mots: g.mots }));
  const titre = 'Guides EducooO · Trouve comment faire';
  return sansCadratin(`${tete(titre, 'Tous les guides EducooO. Cherche en deux mots comment faire ce que tu veux.', BASE + '/guides/')}
<header>
  <a class="marque" href="/">Educoo<span>O</span></a>
  <h1>Guides</h1>
  <p class="date">Trouve en deux mots comment faire ce que tu cherches.</p>
</header>
<div class="recherche">
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
  <input id="q" type="search" autocomplete="off" placeholder="Cherche : séquence, clôture, absence, photo, référentiel…" aria-label="Rechercher un guide">
</div>
<p class="compte" id="compte"></p>
<div class="g-liste" id="liste"></div>
<p class="vide" id="vide" hidden>Aucun guide ne correspond. Essaie un autre mot, ou écris-nous : info@educooo.com.</p>
<script>
const GUIDES = ${JSON.stringify(data)};
const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"");
const liste=document.getElementById("liste"),compte=document.getElementById("compte"),vide=document.getElementById("vide"),q=document.getElementById("q");
const tagClass=p=>p==="Maternelle"?"mat":p==="Primaire"?"pri":"";
function surligne(t,m){let o=t;for(const w of m){if(w.length<2)continue;o=o.replace(new RegExp("("+w.replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&")+")","gi"),"<mark>$1</mark>");}return o;}
function rendre(){
  const brut=q.value.trim();
  const termes=norm(brut).split(/\\s+/).filter(Boolean);
  const res=GUIDES.filter(g=>{const foin=norm([g.titre,g.accroche,g.mots,g.public].join(" "));return termes.every(t=>foin.includes(t));});
  liste.innerHTML=res.map(g=>'<a class="g-carte" href="/guides/'+g.slug+'/"><h3>'+surligne(g.titre,termes)+'</h3><p>'+surligne(g.accroche||"",termes)+'</p><span class="g-tag '+tagClass(g.public)+'">'+g.public+'</span></a>').join("");
  compte.textContent=brut?res.length+" guide"+(res.length>1?"s":"")+" pour « "+brut+" »":GUIDES.length+" guides";
  vide.hidden=res.length>0;
}
q.addEventListener("input",rendre);rendre();
</script>
${PIED}`);
}

const GUIDES_CSS = `.fil{font-size:14px;color:var(--encre-douce);margin:0 0 8px}.fil a{color:var(--encre-douce)}
.etape{display:flex;align-items:center;gap:12px;margin:40px 0 4px}.etape .num{flex:0 0 auto;width:34px;height:34px;border-radius:50%;background:var(--miel);color:#fff;font-weight:800;display:grid;place-items:center;font-size:17px}.etape h2{margin:0;font-size:22px}
figure.capture{margin:16px 0 8px}figure.capture img{display:block;border:1px solid var(--bord);border-radius:20px;width:100%}figure.capture img.tel{max-width:340px;margin:0 auto}
figure.capture .cadre{border:1px solid var(--bord);border-radius:20px;background:#F7F6FB;aspect-ratio:16/10;display:grid;place-items:center;text-align:center;color:var(--encre-douce);padding:24px}figure.capture .cadre span{display:block;font-size:14px;max-width:320px}figure.capture .cadre .pastille{display:inline-block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;background:var(--miel);color:#fff;border-radius:999px;padding:3px 10px;margin-bottom:10px}
figure.capture figcaption{font-size:13px;color:var(--encre-douce);margin-top:8px}
.recherche{position:relative;margin:8px 0 6px}.recherche input{width:100%;box-sizing:border-box;font:inherit;font-size:17px;padding:16px 16px 16px 46px;border:1px solid var(--bord);border-radius:16px;background:#fff;color:var(--encre)}.recherche input:focus{outline:none;border-color:var(--miel);box-shadow:0 0 0 3px rgba(245,166,35,.15)}.recherche svg{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:20px;height:20px;stroke:var(--encre-douce);fill:none;stroke-width:2}
.compte{font-size:14px;color:var(--encre-douce);margin:4px 2px 20px}.g-liste{display:grid;gap:14px}.g-carte{display:block;text-decoration:none;color:inherit;border:1px solid var(--bord);border-radius:18px;background:#fff;padding:18px 20px;transition:border-color .15s,transform .15s}.g-carte:hover{border-color:var(--miel);transform:translateY(-1px)}.g-carte h3{margin:0 0 4px;font-size:18px}.g-carte p{margin:0;color:var(--encre-douce);font-size:15px}
.g-tag{display:inline-block;font-size:12px;letter-spacing:.03em;border-radius:999px;padding:2px 9px;margin-top:10px;background:#EEF;color:#556}.g-tag.mat{background:#E7F5EC;color:#2E7D4F}.g-tag.pri{background:#E7EEFB;color:#2F5AA8}.vide{color:var(--encre-douce);padding:24px 2px}mark{background:#FDECC8;color:inherit;border-radius:3px;padding:0 1px}`;

// Repère les captures présentes pour un slug (NN-*.png triés). La grille (04*) large.
function capturesDe(slug) {
  const dir = path.join(OUT_CAPT, slug);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort()
    .map((f) => ({ src: `/assets/img/guides/${slug}/${f}`, large: /grille|semaine|04/i.test(f) }));
}

async function flipPublie(pageId) {
  await notion(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties: { 'État': { select: { name: 'Publié' } } } }) });
}

// --- Main --------------------------------------------------------------------
const rows = await lireGuides();
const retenus = rows.filter((r) => ['À publier', 'Publié'].includes(sel(r.properties['État'])));
console.log(`${rows.length} lignes, ${retenus.length} à générer (À publier + Publié). DRY_RUN=${DRY}`);

fs.mkdirSync(OUT_GUIDES, { recursive: true });
fs.writeFileSync(path.join(OUT_GUIDES, 'guides.css'), GUIDES_CSS);

const publies = [];
const aPublier = [];
for (const r of retenus) {
  const p = r.properties;
  const slug = txt(p['Slug']) || r.id;
  const g = {
    id: r.id, slug,
    titreHowTo: txt(p['Titre How-To']) || txt(p['Problème (titre)']),
    accroche: txt(p['Accroche']),
    public: sel(p['Public']) || 'Les deux',
    mots: txt(p['Mots-clés']),
    ordre: p['Ordre']?.number ?? 999,
    etat: sel(p['État']),
  };
  const blocs = await lireBlocs(r.id);
  g.corps = blocsVersHtml(blocs, capturesDe(slug));
  fs.mkdirSync(path.join(OUT_GUIDES, slug), { recursive: true });
  fs.writeFileSync(path.join(OUT_GUIDES, slug, 'index.html'), pageGuide(g));
  publies.push(g);
  if (g.etat === 'À publier') aPublier.push(g);
  console.log(`  généré /guides/${slug}/  (${g.etat})`);
}

publies.sort((a, b) => a.ordre - b.ordre);
fs.writeFileSync(path.join(OUT_GUIDES, 'index.html'), pageIndex(publies));
fs.writeFileSync(path.join(OUT_GUIDES, 'index.json'), JSON.stringify(publies.map((g) => ({ slug: g.slug, titre: g.titreHowTo, accroche: g.accroche, public: g.public, mots: g.mots })), null, 0));
console.log(`index + ${publies.length} pages écrits dans public/guides/`);

if (aPublier.length) {
  if (DRY) {
    console.log(`DRY_RUN : ${aPublier.length} guide(s) resteraient "À publier" -> "Publié" : ${aPublier.map((g) => g.slug).join(', ')}`);
  } else {
    for (const g of aPublier) { await flipPublie(g.id); console.log(`  Notion: ${g.slug} -> Publié`); }
  }
}
console.log('OK.');
