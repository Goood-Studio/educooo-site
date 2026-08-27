/**
 * Générateur du site educooo.com.
 *
 * Principe : le contenu est du HTML lisible dans content/<langue>/, le gabarit
 * reprend la main sur tout ce qui est répétitif et facile à rater — canonical,
 * hreflang, JSON-LD, navigation, pied de page, sitemap. Une page ne peut donc
 * pas partir en ligne sans son SEO.
 *
 * La langue racine (fr) est servie depuis / pour que les URL déjà déclarées aux
 * stores restent valables. Les autres langues vivent sous /nl et /en, et ne sont
 * générées que si leur dossier de contenu existe : pas de page vide indexée.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, 'dist');

const site = JSON.parse(readFileSync(join(RACINE, 'content/site.json'), 'utf8'));
const gabarit = readFileSync(join(RACINE, 'layouts/base.html'), 'utf8');

const echappe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Les locales réellement traduites, c'est-à-dire celles qui ont un dossier.
 * Une locale est le triplet pays + langue + juridiction, et non une langue :
 * « fr » ne suffit pas, parce que le français de Belgique et celui de France
 * ne partagent pas le référentiel. La variable « langue » plus bas porte donc
 * une locale complète. Voir la page Notion « Architecture de contenu ».
 */
const localesPresentes = Object.entries(site.locales)
  .filter(([slug]) => existsSync(join(RACINE, 'content', slug, 'meta.json')))
  .map(([code, conf]) => ({ code, ...conf }));

if (!localesPresentes.some((l) => l.code === site.localeRacine)) {
  throw new Error(`La locale racine « ${site.localeRacine} » n'a pas de contenu.`);
}

for (const l of localesPresentes) {
  for (const cle of ['pays', 'langue', 'juridiction', 'hreflang', 'ogLocale', 'juridictionNom']) {
    if (!l[cle]) throw new Error(`La locale « ${l.code} » n'a pas de « ${cle} ».`);
  }
  const attendu = `${l.pays}-${l.langue}-${l.juridiction}`.toLowerCase();
  if (l.code !== attendu) {
    throw new Error(`La locale « ${l.code} » devrait s'appeler « ${attendu} » : le slug est pays-langue-juridiction.`);
  }
}

/** Chemin public d'une page dans une langue, toujours avec un / final. */
function chemin(langue, page) {
  const slug = langue.slugs[page];
  if (page === 'accueil') return `${langue.prefixe}/`;
  return `${langue.prefixe}/${slug}/`;
}

function balisesHreflang(page, courante) {
  // Une page n'a d'alternate que dans les locales qui la déclarent vraiment.
  // La presse existe d'abord en français seulement : pointer un hreflang vers un
  // /be-nl-fwb/presse/ inexistant serait une promesse de traduction non tenue.
  const alternates = localesPresentes.filter(
    (l) => l.juridiction === courante.juridiction && page in l.slugs);
  if (alternates.length < 2) return '';
  const lignes = alternates.map((l) =>
    `<link rel="alternate" hreflang="${l.hreflang}" href="${site.domaine}${chemin(l, page)}">`);
  const defaut = alternates.find((l) => l.defaut) ?? alternates[0];
  lignes.push(`<link rel="alternate" hreflang="x-default" href="${site.domaine}${chemin(defaut, page)}">`);
  return lignes.join('\n');
}

/** Données structurées. L'éditeur partout, l'application sur l'accueil. */
function jsonld(page, langue, meta) {
  const e = site.editeur;
  const organisation = {
    '@type': 'Organization',
    name: e.denomination,
    url: site.domaine,
    email: e.email,
    telephone: e.telephone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: e.rue,
      postalCode: e.codePostal,
      addressLocality: e.ville,
      addressCountry: e.pays,
    },
  };

  const blocs = [organisation];

  if (page === 'accueil') {
    blocs.push({
      '@type': 'SoftwareApplication',
      name: site.nom,
      applicationCategory: site.app.categorie,
      operatingSystem: site.app.plateformes.join(', '),
      inLanguage: langue.hreflang,
      description: meta.description,
      publisher: { '@type': 'Organization', name: e.denomination },
      installUrl: site.app.ios,
      sameAs: [site.app.ios, site.app.android],
      offers: {
        '@type': 'Offer',
        price: site.app.prix,
        priceCurrency: site.app.devise,
        category: 'subscription',
      },
    });
    blocs.push({
      '@type': 'WebSite',
      name: site.nom,
      url: site.domaine + chemin(langue, 'accueil'),
      inLanguage: langue.hreflang,
      publisher: { '@type': 'Organization', name: e.denomination },
    });
  }

  const graphe = { '@context': 'https://schema.org', '@graph': blocs };
  return `<script type="application/ld+json">${JSON.stringify(graphe)}</script>`;
}

function entete(page, langue, meta) {
  const accueil = chemin(langue, 'accueil');
  if (page === 'accueil') {
    // Les liens vers les pages légales sont sortis de la barre : ils vivent dans
    // le pied. Une barre qui doit convertir garde l'action principale sous la
    // main pendant tout le défilement, et rien qui fasse quitter la page.
    if (!langue.barre?.liens?.length || !langue.barre.cta) {
      throw new Error(`« barre » manquante ou incomplète pour la langue ${langue.code}.`);
    }
    const liens = langue.barre.liens
      .map((l) => `    <a href="${l.ancre}">${echappe(l.libelle)}</a>`)
      .join('\n');
    // Le menu se replie derrière un bouton sur téléphone. La bascule est une
    // case à cocher masquée plutôt qu'un <details> : le comportement est
    // déterministe dans tous les navigateurs, et le site reste sans JavaScript.
    return `<div class="barre">
  <a class="marque" href="${accueil}" aria-label="${echappe(langue.retourAccueil)}">
    <img class="signature" src="/assets/img/signature.svg" alt="EducooO" width="150" height="34">
  </a>
  <input class="bascule-menu" type="checkbox" id="bascule-menu" aria-label="${echappe(langue.barre.menu ?? 'Menu')}">
  <label class="burger" for="bascule-menu" aria-hidden="true"><span></span><span></span><span></span></label>
  <nav>
${liens}
  </nav>
  <div class="barre-actions">${site.app.web && langue.barre.connexion ? `
    <a class="bouton-connexion" href="${site.app.web}">${echappe(langue.barre.connexion)}</a>` : ''}
    <a class="bouton-barre" href="#telecharger">${echappe(langue.barre.cta)}</a>
  </div>
</div>`;
  }
  const chapeau = meta.chapeau ? `\n  <p class="date">${meta.chapeau}</p>` : '';
  return `<header>
  <a class="marque" href="${accueil}">Educoo<span>O</span></a>
  <h1>${meta.h1}</h1>${chapeau}
</header>`;
}

function pied(page, langue) {
  // Les ancres du pied n'existent que sur l'accueil : ailleurs, elles pointeraient
  // vers des sections absentes de la page. Elles ont été sorties de la barre du
  // haut le 20/08/2026 pour n'y garder que ce qui fait avancer la décision.
  const ancres = page === 'accueil'
    ? (langue.piedAncres ?? []).map((a) => `<a href="${a.ancre}">${echappe(a.libelle)}</a>`)
    : [];
  const liens = [
    ...ancres,
    ...Object.entries(langue.pied)
      .filter(([p]) => !(page === 'accueil' && p === 'accueil'))
      .map(([p, libelle]) => `<a href="${chemin(langue, p)}">${echappe(libelle)}</a>`),
  ].join('\n    ');

  // Même juridiction seulement : proposer une autre juridiction ferait croire à
  // une traduction alors que ce serait un autre référentiel.
  const autres = localesPresentes.filter(
    (l) => l.code !== langue.code && l.juridiction === langue.juridiction && page in l.slugs);
  const bascule = autres.length
    ? `\n  <p class="langues">${echappe(langue.autresLangues)} : ` +
      autres.map((l) => `<a href="${chemin(l, page)}" hreflang="${l.hreflang}">${echappe(l.libelle)}</a>`).join(' · ') +
      '</p>'
    : '';

  const e = site.editeur;
  const classe = page === 'accueil' ? ' class="pied-large"' : '';
  const bloc = page === 'accueil'
    ? `  <nav>\n    ${liens}\n  </nav>`
    : `  <p>${liens.split('\n    ').join(' · ')}</p>`;

  // L'identité complète de l'éditeur est obligatoire, mais elle est déjà sur les
  // mentions légales et sur le support. Sur l'accueil elle ne fait que refroidir
  // la page : on n'y laisse que la signature.
  // La signature nomme la juridiction par substitution, jamais en dur : une
  // locale ne peut donc pas revendiquer le référentiel d'une autre.
  const signature = langue.signature.replace('{{juridiction}}', langue.juridictionNom);
  if (signature.includes('{{')) {
    throw new Error(`Signature de « ${langue.code} » : substitution non résolue.`);
  }
  const identite = page === 'accueil'
    ? `  <p>${echappe(signature)}</p>`
    : `  <p>${e.denomination}, ${e.rue}, ${e.codePostal} ${e.ville}, ${e.paysNom}<br>\n  <a href="mailto:${e.email}">${e.email}</a></p>`;

  // Accès web en bas de page : une école qui découvre le site sur ordinateur
  // peut se connecter directement, sans passer par un store. Bouton discret,
  // au-dessus des liens du pied.
  const connexionBloc = site.app.web && langue.barre?.connexion
    ? `  <p class="pied-connexion"><a class="bouton-connexion" href="${site.app.web}">${echappe(langue.barre.connexion)}</a></p>\n`
    : '';

  return `<footer${classe}>
${connexionBloc}${bloc}
${identite}${bascule}
</footer>`;
}

/**
 * Résout les liens internes du contenu. Écrire href="/confidentialite/" en dur
 * marcherait en français et renverrait une lectrice néerlandophone sur une page
 * française : le contenu écrit donc {{lien:confidentialite}} et le générateur
 * choisit le slug de la langue en cours.
 */
function liensInternes(html, langue) {
  // Les URL des stores et de l'app web ne s'écrivent pas en dur dans le contenu :
  // elles vivent dans site.json, à un seul endroit, parce qu'elles changeront.
  const avecStores = html.replace(/\{\{app:(ios|android|web)\}\}/g, (_, plateforme) => {
    const url = site.app[plateforme];
    if (!url) throw new Error(`Lien de téléchargement manquant dans site.json : app.${plateforme}`);
    return url;
  });
  return avecStores.replace(/\{\{lien:([a-z-]+)\}\}/g, (_, page) => {
    if (!langue.slugs[page]) {
      if (page !== 'accueil') throw new Error(`Lien interne vers une page inconnue : ${page}`);
    }
    return chemin(langue, page);
  });
}

// Règle d'écriture du studio : aucun tiret cadratin dans le texte visible. Le
// défaut ne se voit pas à la relecture et atterrit dans l'onglet du navigateur
// et dans les résultats de recherche, donc c'est la construction qui le refuse.
// Six titres sont passés à travers avant que ce contrôle existe.
function sansCadratin(html, ou) {
  if (html.includes('\u2014')) {
    const ligne = html.split('\n').find((l) => l.includes('\u2014')).trim();
    throw new Error(`Tiret cadratin dans « ${ou} » : ${ligne}`);
  }
  return html;
}

// Le studio écrit en inclusif. Le féminin employé comme générique se rattrape
// mal à la relecture, parce qu'il est correct grammaticalement : « tu es
// prévenue » ne saute pas aux yeux. La construction le refuse donc.
//
// Le contrôle ne porte que sur les pages de type « document » et qu'en français,
// et c'est délibéré. L'accueil raconte une rencontre avec une enseignante
// réelle : le féminin y est juste, et un contrôle aveugle crierait sur une
// phrase correcte. Une page juridique, elle, ne s'adresse jamais qu'à un lectorat
// générique, donc toute marque de féminin y est une faute d'inclusivité.
//
// La liste est volontairement courte. « professionnelle » en est absent exprès :
// c'est aussi un adjectif qui s'accorde légitimement (« sa pratique
// professionnelle »), et un contrôle qui crie pour rien est un contrôle qu'on
// finit par désactiver. Même raison pour « inscrite » (« la date inscrite »).
const FEMININ_GENERIQUE = ['enseignante', 'enseignantes', 'prévenue', 'utilisatrice', 'utilisatrices', 'consommatrice'];

function sansFemininGenerique(html, ou) {
  for (const forme of FEMININ_GENERIQUE) {
    const motif = new RegExp(`[^\\p{L}·]${forme}[^\\p{L}·]`, 'iu');
    const trouve = html.match(motif);
    if (trouve) {
      const ligne = html.split('\n').find((l) => motif.test(l)).trim();
      throw new Error(`Féminin employé comme générique dans « ${ou} » : « ${forme} ». Écris la forme inclusive. Ligne : ${ligne}`);
    }
  }
  return html;
}

function rendu(page, langue, metas) {
  const meta = metas[page];
  if (!meta) throw new Error(`Métadonnées manquantes pour « ${page} » en ${langue.code}.`);

  // Un oubli de titre ou de description fait échouer la construction plutôt que
  // de partir en ligne : une balise vide ne se voit pas à l'œil nu.
  for (const champ of ['titre', 'description']) {
    if (!meta[champ]?.trim()) {
      throw new Error(`« ${champ} » vide pour la page « ${page} » en ${langue.code}.`);
    }
  }
  if (meta.description.length > 165) {
    throw new Error(`Description trop longue (${meta.description.length} car.) pour « ${page} » en ${langue.code}, Google la coupe vers 160.`);
  }
  if (meta.gabarit !== 'accueil' && !meta.h1?.trim()) {
    throw new Error(`« h1 » vide pour la page « ${page} » en ${langue.code}.`);
  }
  const fichier = join(RACINE, 'content', langue.code, `${page}.html`);
  if (!existsSync(fichier)) throw new Error(`Contenu manquant : ${fichier}`);

  const remplacements = {
    lang: langue.hreflang,
    titre: echappe(meta.titre),
    description: echappe(meta.description),
    canonical: site.domaine + chemin(langue, page),
    domaine: site.domaine,
    ogLocale: langue.ogLocale,
    hreflang: balisesHreflang(page, langue),
    jsonld: jsonld(page, langue, meta),
    classeMain: meta.gabarit === 'accueil' ? 'large' : '',
    entete: entete(page, langue, meta),
    corps: liensInternes(readFileSync(fichier, 'utf8').trim(), langue),
    pied: pied(page, langue),
  };

  let html = gabarit;
  for (const [cle, valeur] of Object.entries(remplacements)) {
    html = html.replaceAll(`{{${cle}}}`, valeur);
  }
  const restants = html.match(/\{\{[a-zA-Z][a-zA-Z0-9:_-]*\}\}/g);
  if (restants) throw new Error(`Marqueurs non remplacés : ${[...new Set(restants)].join(', ')}`);
  const propre = sansCadratin(html.replace(/\n{3,}/g, '\n\n'), `${page} en ${langue.code}`);
  if (meta.gabarit === 'document' && langue.langue === 'fr') {
    return sansFemininGenerique(propre, `${page} en ${langue.code}`);
  }
  return propre;
}

// ── Génération ─────────────────────────────────────────────────────────────

rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });
cpSync(join(RACINE, 'public'), SORTIE, { recursive: true });
cpSync(join(RACINE, 'style.css'), join(SORTIE, 'style.css'));

const urls = [];

for (const langue of localesPresentes) {
  const metas = JSON.parse(readFileSync(join(RACINE, 'content', langue.code, 'meta.json'), 'utf8'));
  for (const page of site.pages) {
    // Une page ne se génère que pour les locales qui la déclarent. La presse est
    // en français d'abord : son absence de slug en néerlandais la saute proprement
    // au lieu de faire échouer la construction sur un contenu manquant.
    if (!(page in langue.slugs)) continue;
    const html = rendu(page, langue, metas);
    const dest = join(SORTIE, chemin(langue, page));
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'index.html'), html);
    urls.push({ url: site.domaine + chemin(langue, page), page, langue });
    console.log(`  ${chemin(langue, page).padEnd(28)} ${String(html.length).padStart(6)} o`);
  }
}

// 404 : servie par GitHub Pages sur toute adresse inconnue, donc toujours en
// langue racine et jamais indexée. Elle porte AUSSI le funnel de parrainage :
// les liens `educooo.com/r/CODE` n'existent pas comme fichiers, donc GitHub Pages
// sert cette page pour eux. Un script détecte le préfixe /r/, compte le clic via
// l'edge function (le web anonyme ne peut pas écrire dans referral_events), montre
// le code à saisir à l'inscription, et propose les deux stores. On ne redirige
// pas d'office : sans deep link différé, l'attribution tient à ce que la personne
// VOIE son code avant d'aller sur le store.
{
  const racine = localesPresentes.find((l) => l.code === site.localeRacine);
  const metas = JSON.parse(readFileSync(join(RACINE, 'content', racine.code, 'meta.json'), 'utf8'));
  const liens = Object.entries(racine.pied)
    .map(([p, libelle]) => `    <li><a href="${chemin(racine, p)}">${libelle}</a></li>`).join('\n');
  const parr = site.parrainage ?? {};
  if (!parr.fonctionClic) throw new Error('site.json : parrainage.fonctionClic manquant (URL de l\'edge function de comptage des clics).');
  const badgeIos = `<a class="badge" href="${site.app.ios}"><img src="/assets/img/badge-app-store.svg" alt="Télécharger dans l'App Store" width="127" height="40"></a>`;
  const badgePlay = `<a class="badge badge-play" href="${site.app.android}"><img src="/assets/img/badge-google-play.png" alt="Disponible sur Google Play" width="135" height="52"></a>`;
  writeFileSync(join(SORTIE, '404.html'), sansCadratin(`<!doctype html>
<html lang="${racine.hreflang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page introuvable · EducooO</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/img/favicon.ico" sizes="any">
<link rel="stylesheet" href="/style.css">
<style>
  #parrainage { display: none; }
  html.est-parrainage #introuvable { display: none; }
  html.est-parrainage #parrainage { display: block; }
  .code-parrainage { display: inline-block; font-weight: 800; letter-spacing: .12em;
    font-size: 1.6rem; padding: .5rem 1rem; border-radius: 14px;
    background: #D5CFF3; color: #2b2350; margin: .4rem 0 1rem; }
  #parrainage .badges { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-top: .5rem; }
  #parrainage.plateforme-ios .badge-play, #parrainage.plateforme-android .badge:not(.badge-play) { order: 2; }
</style>
<script>
  (function () {
    var chemin = location.pathname || '';
    if (chemin.indexOf('/r/') !== 0) return;
    document.documentElement.className += ' est-parrainage';
    var brut = '';
    try { brut = decodeURIComponent(chemin.slice(3)).split('/')[0].trim().toUpperCase(); } catch (e) {}
    var code = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4,12}$/.test(brut) ? brut : '';
    window.__codeParrainage = code;
    if (code) {
      try {
        fetch(${JSON.stringify(parr.fonctionClic)}, {
          method: 'POST', keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: code })
        }).catch(function () {});
      } catch (e) {}
    }
    var ua = navigator.userAgent || '';
    window.__plateforme = /android/i.test(ua) ? 'android'
      : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'autre';
  })();
</script>
</head>
<body>
<main>
<div id="introuvable">
<header>
  <a class="marque" href="/">Educoo<span>O</span></a>
  <h1>Cette page n'existe pas</h1>
  <p class="date">Ça arrive. Rien de cassé.</p>
</header>
<section class="centre">
  <img src="/assets/img/nuage-salut.webp" alt="" width="360" height="360" loading="lazy">
  <ul class="liste-plate">
${liens}
  </ul>
</section>
</div>
<div id="parrainage">
<header>
  <a class="marque" href="/">Educoo<span>O</span></a>
  <h1>Une collègue t'offre EducooO</h1>
  <p class="date">Installe l'app et saisis ton code à l'inscription pour tes 5 € de remise.</p>
</header>
<section class="centre">
  <p>Ton code de parrainage</p>
  <p><span class="code-parrainage" id="valeur-code">ton code</span></p>
  <div class="badges">
    ${badgeIos}
    ${badgePlay}
  </div>
  <p class="date">Note ton code : tu le saisiras à la création de ton compte, dans l'app.</p>
</section>
</div>
</main>
<script>
  (function () {
    var code = window.__codeParrainage;
    var el = document.getElementById('valeur-code');
    if (el && code) el.textContent = code;
    var bloc = document.getElementById('parrainage');
    if (bloc && window.__plateforme && window.__plateforme !== 'autre') {
      bloc.className = 'plateforme-' + window.__plateforme;
    }
  })();
</script>
</body>
</html>
`, '404.html'));
  void metas;
}

// sitemap.xml : toutes les locales, avec leurs alternates. Même règle que les
// balises du <head> : une page n'a d'alternates que dans sa propre juridiction.
const entrees = urls.map(({ url, page, langue }) => {
  const memeJuridiction = localesPresentes.filter(
    (l) => l.juridiction === langue.juridiction && page in l.slugs);
  const alt = memeJuridiction.length > 1
    ? memeJuridiction.map((l) =>
        `\n    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${site.domaine}${chemin(l, page)}"/>`).join('')
    : '';
  const priorite = page === 'accueil' ? '1.0' : (page === 'mentions-legales' ? '0.3' : '0.7');
  return `  <url>\n    <loc>${url}</loc>${alt}\n    <priority>${priorite}</priority>\n  </url>`;
}).join('\n');

writeFileSync(join(SORTIE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entrees}
</urlset>
`);

writeFileSync(join(SORTIE, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${site.domaine}/sitemap.xml\n`);

// llms.txt : ce qu'un assistant doit savoir s'il résume EducooO. Même logique
// que sur vroooz.com.
const racineL = localesPresentes.find((l) => l.code === site.localeRacine);
writeFileSync(join(SORTIE, 'llms.txt'), `# ${site.nom}

> Application mobile pour enseignantes du fondamental. Elle capte une observation
> de classe à la voix, la rattache aux attendus du référentiel officiel, et
> construit le bilan au fil de l'année.

Éditée par ${site.editeur.denomination}, ${site.editeur.ville}, ${site.editeur.paysNom}.
Abonnement ${site.app.prix} ${site.app.devise} par an, un mois offert, sans publicité.

## Pages
${site.pages.filter((p) => p !== 'accueil').map((p) =>
  `- [${racineL.pied[p]}](${site.domaine}${chemin(racineL, p)})`).join('\n')}

## Ce qu'il faut savoir avant de résumer
- L'utilisatrice est une adulte professionnelle. L'application n'est pas destinée aux enfants.
- Le nom complet d'un élève n'est jamais enregistré : le prénom et deux lettres du nom.
- Aucune publicité, aucun suivi inter-applications, aucun contenu d'élève pour entraîner un modèle.
- Ni la direction ni les parents n'ont accès aux observations d'une enseignante.
- La base de données est hébergée dans l'Union européenne.
`);

writeFileSync(join(SORTIE, 'CNAME'), site.domaine.replace(/^https?:\/\//, '') + '\n');

console.log(`\n${urls.length} pages, ${localesPresentes.length} locale(s) : ${localesPresentes.map((l) => l.code).join(', ')}`);
console.log(`Langues déclarées mais pas encore traduites : ${
  Object.keys(site.locales).filter((c) => !localesPresentes.some((l) => l.code === c)).join(', ') || 'aucune'}`);
console.log(`Sortie : ${SORTIE}`);
void readdirSync;
