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

/**
 * Une page hors catalogue, servie sur une adresse fixe et fabriquée à la main.
 * Comme la 404, elle ne passe pas par site.pages : elle n'entre donc ni dans la
 * navigation, ni dans le pied automatique, ni dans le sitemap. Elle reprend le
 * gabarit complet pour garder tout le SEO de base (canonical, Open Graph,
 * données structurées) et le même habillage que le reste du site.
 *
 * L'indexation se règle par « noindex ». On loge la balise robots dans
 * l'emplacement {{hreflang}} du gabarit, qui vit dans le <head> et reste vide
 * pour ces pages sans traductions.
 */
function pageSpeciale({ slug, meta, corps, noindex }) {
  const langue = localesPresentes.find((l) => l.code === site.localeRacine);
  const remplacements = {
    lang: langue.hreflang,
    titre: echappe(meta.titre),
    description: echappe(meta.description),
    canonical: `${site.domaine}/${slug}/`,
    domaine: site.domaine,
    ogLocale: langue.ogLocale,
    hreflang: noindex ? '<meta name="robots" content="noindex">' : '',
    jsonld: jsonld(slug, langue, meta),
    classeMain: '',
    entete: entete(slug, langue, meta),
    corps: liensInternes(corps.trim(), langue),
    pied: pied(slug, langue),
  };
  let html = gabarit;
  for (const [cle, valeur] of Object.entries(remplacements)) {
    html = html.replaceAll(`{{${cle}}}`, valeur);
  }
  const restants = html.match(/\{\{[a-zA-Z][a-zA-Z0-9:_-]*\}\}/g);
  if (restants) throw new Error(`Marqueurs non remplacés dans « ${slug} » : ${[...new Set(restants)].join(', ')}`);
  const propre = sansCadratin(html.replace(/\n{3,}/g, '\n\n'), slug);
  const dest = join(SORTIE, slug);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'index.html'), propre);
  console.log(`  ${('/' + slug + '/').padEnd(28)} ${String(propre.length).padStart(6)} o${noindex ? '  (noindex)' : ''}`);
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
  .copie-etat { font-weight: 700; color: #2b7a4b; }
  .lien-navigateur { display: inline-block; margin-top: .3rem; }
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
  <p class="date">Installe l'app pour tes 5 € de remise. Ton code est déjà prêt, rien à retenir.</p>
</header>
<section class="centre">
  <div class="badges">
    ${badgeIos}
    ${badgePlay}
  </div>
  <p class="date" id="note-app">Ton code <span class="code-parrainage" id="valeur-code">ton code</span> <span id="etat-copie"></span></p>
  <p class="date">Sur ordinateur ou tablette ? <a class="bouton-connexion lien-navigateur" id="lien-web" href="${site.app.web}">Ouvre EducooO dans ton navigateur</a>. Ton code s'applique tout seul.</p>
</section>
</div>
</main>
<script>
  (function () {
    var code = window.__codeParrainage;
    var el = document.getElementById('valeur-code');
    if (el && code) el.textContent = code;
    // Le lien navigateur porte le code en paramètre : l'app web le capte et le
    // rattache tout seul, zéro saisie. C'est le chemin sans friction sur desktop.
    var lienWeb = document.getElementById('lien-web');
    if (lienWeb && code) {
      lienWeb.href = ${JSON.stringify(site.app.web)} + '/?parrain=' + encodeURIComponent(code);
    }
    // On copie le code dans le presse-papiers : sur l'app installée (où vit le
    // paiement, donc la récompense de la marraine), l'inscription propose de le
    // coller, une friction en moins que la recopie à la main. Best-effort : si
    // le navigateur refuse, le code reste affiché juste au-dessus.
    var etat = document.getElementById('etat-copie');
    if (code && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        if (etat) { etat.textContent = 'est copié, colle-le à l\\'inscription.'; etat.className = 'copie-etat'; }
      }).catch(function () {
        if (etat) etat.textContent = ': saisis-le à l\\'inscription.';
      });
    } else if (etat) {
      etat.textContent = ': saisis-le à l\\'inscription.';
    }
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

// /manolo : dossier de présentation pour l'administration, dans le cadre d'une
// demande de labellisation Manolo. Page hors catalogue et NON indexée : on
// n'expose pas une pièce administrative aux moteurs de recherche. Accessible
// seulement par l'adresse directe educooo.com/manolo. Rien n'y est affirmé qui
// ne soit vrai aujourd'hui : le statut est « candidat », jamais « labellisé ».
pageSpeciale({
  slug: 'manolo',
  noindex: true,
  meta: {
    titre: 'EducooO · Dossier Manolo',
    description: "Dossier de présentation d'EducooO pour l'administration, dans le cadre d'une demande de labellisation Manolo. Ancrage FWB, RGPD, égalité, pérennité.",
    h1: 'Dossier de labellisation Manolo',
    chapeau: "À l'intention de l'administration de la Fédération Wallonie-Bruxelles.",
  },
  corps: `<section>
<p><strong>EducooO</strong> est une plateforme pédagogique en ligne, disponible sur iOS, sur Android et dans le navigateur, éditée par Goood Studio SRL. Elle s'adresse aux enseignant·es de l'enseignement fondamental de la Fédération Wallonie-Bruxelles, tous réseaux confondus : Wallonie-Bruxelles Enseignement, l'officiel subventionné, le libre confessionnel et le libre non confessionnel.</p>
<p class="appui">Ce document présente EducooO à l'administration dans le cadre d'une demande de labellisation Manolo. Il en reprend les critères de la Charte de labellisation (arrêté du 2 mai 2019), point par point, sur un ton volontairement factuel.</p>
</section>

<div class="titre-section">
  <h2>Ce que fait l'outil</h2>
  <p>Trois usages pour l'enseignant·e, un seul fil : rendre le temps que la paperasse prend.</p>
</div>

<div class="trio">
  <div class="carte">
    <div class="tuile t-bleu" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 8h18"/><path d="M4 6h16v14H4Z"/></svg>
    </div>
    <h3>Préparer la classe</h3>
    <p>Un semainier construit les activités de la semaine et propose des leçons rattachées aux compétences qu'il reste à travailler.</p>
  </div>
  <div class="carte">
    <div class="tuile t-sarcelle" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>
    </div>
    <h3>Consigner des observations</h3>
    <p>L'enseignant·e dicte ou saisit une observation de classe en quelques secondes, sans quitter ses élèves des yeux.</p>
  </div>
  <div class="carte">
    <div class="tuile t-vert" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>
    </div>
    <h3>Suivre les acquis</h3>
    <p>Chaque observation est rattachée aux attendus du référentiel. Le bilan des acquis des élèves se construit au fil de l'année.</p>
  </div>
</div>

<div class="titre-section">
  <h2>Ancrage dans les référentiels de la Fédération</h2>
  <p>Le critère central de la Charte, et le cœur de la conception de l'outil.</p>
</div>

<section class="phare">
  <p class="phare-titre">Construit sur les référentiels et les socles de compétences de la FWB</p>
  <p>Les référentiels et les socles de compétences de la Fédération Wallonie-Bruxelles sont pré-chargés dans l'application, avec leurs milliers d'attendus. L'enseignant·e n'encode rien : il ou elle décrit une activité, et l'outil propose les attendus officiels qu'elle travaille, en citant les mots qui justifient chaque proposition.</p>
  <p>Le rattachement reste une proposition. L'enseignant·e valide, corrige ou refuse. Rien n'est décidé sans lui ou elle, et quand l'outil ne sait pas rattacher, il le dit au lieu d'inventer.</p>
</section>

<div class="titre-section">
  <h2>Protection des données des élèves</h2>
  <p>Une application qui touche à des observations sur des enfants a une dette de clarté.</p>
</div>

<section>
<ul class="liste-nue">
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg><span>Traitement conforme au RGPD, base de données hébergée dans l'Union européenne.</span></li>
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg><span>Minimisation des données : le nom complet d'un élève n'est jamais enregistré, le prénom et deux lettres du nom suffisent.</span></li>
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg><span>Masquage des prénoms au moment du traitement automatique, pour que le contenu ne circule pas en clair.</span></li>
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg><span>Aucune publicité, aucun suivi inter-applications, aucun contenu d'élève utilisé pour entraîner un modèle.</span></li>
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg><span>Ni la direction ni les parents n'accèdent aux observations d'un·e enseignant·e. Export et suppression du compte à tout moment.</span></li>
</ul>
<p class="appui">Le fonctionnement réel est décrit prestataire par prestataire dans la <a href="{{lien:confidentialite}}">politique de confidentialité</a>. Un accord de sous-traitance écrit est fourni au pouvoir organisateur sur simple demande.</p>
</section>

<div class="titre-section">
  <h2>Égalité, non-discrimination et genre</h2>
  <p>Ce que la Charte demande sur le fond des contenus et de la langue.</p>
</div>

<div class="trio">
  <div class="carte">
    <div class="tuile t-corail" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M9.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13A4 4 0 0 1 16 11"/></svg>
    </div>
    <h3>Écriture inclusive</h3>
    <p>L'interface et les contenus sont rédigés en écriture inclusive au point médian. Le féminin employé comme générique est écarté par construction.</p>
  </div>
  <div class="carte">
    <div class="tuile t-jaune" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><path d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>
    </div>
    <h3>Accessibilité</h3>
    <p>Contrastes soignés, structure lisible, saisie possible à la voix comme au clavier : l'outil s'adapte aux façons de travailler, pas l'inverse.</p>
  </div>
  <div class="carte">
    <div class="tuile t-violet" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
    </div>
    <h3>Contenus non discriminants</h3>
    <p>Les contenus générés se tiennent au terrain pédagogique et aux compétences. L'outil ne trie pas les élèves et ne produit rien de discriminant.</p>
  </div>
</div>

<div class="titre-section">
  <h2>Pérennité</h2>
  <p>Un service qui tient une année scolaire, et les suivantes.</p>
</div>

<section>
<ul class="liste-nue">
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Édité par une société établie, Goood Studio SRL, à Namur, en Belgique.</span></li>
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Produit en production, publié sur l'App Store et sur Google Play, et accessible dans le navigateur.</span></li>
  <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Modèle par abonnement, sans publicité ni revente de données, aligné sur la durée du service.</span></li>
</ul>
</section>

<div class="titre-section">
  <h2>Statut de la demande</h2>
  <p>Dit clairement, pour ne rien laisser croire de plus que ce qui est vrai.</p>
</div>

<section class="phare">
  <p class="phare-titre">Candidat à la labellisation Manolo</p>
  <p>EducooO n'est pas labellisé à ce jour, et n'est pas agréé. Le présent dossier accompagne une demande de labellisation en cours d'instruction. Nous nous tenons à la disposition de l'administration pour tout complément, toute démonstration et toute vérification.</p>
</section>

<section>
<h2>Contact</h2>
<p>Pour instruire ce dossier ou demander une démonstration : <a href="mailto:info@educooo.com">info@educooo.com</a>. Une vraie personne de l'équipe qui construit l'application vous répond.</p>
</section>

<div class="bandeau">
  <img src="/assets/img/nuage-salut.webp" alt="" width="300" height="300" loading="lazy">
  <h2>Voir l'outil en conditions réelles</h2>
  <p>La page publique présente EducooO tel que les enseignant·es l'utilisent au quotidien.</p>
  <div class="badges centre-badges badges-bandeau">
    <a class="bouton" href="{{lien:accueil}}">Découvrir EducooO</a>
  </div>
</div>`,
});

// /gratuit : page publique qui explique, honnêtement, les deux façons d'obtenir
// EducooO sans le payer de sa poche. Elle peut être indexée. Elle n'entre pas
// dans le catalogue site.pages pour ne pas apparaître dans la navigation ni dans
// le pied : c'est une page d'appel, pas une page de structure.
pageSpeciale({
  slug: 'gratuit',
  noindex: false,
  meta: {
    titre: 'EducooO gratuit · Deux façons de ne rien payer',
    description: "Deux chemins honnêtes pour obtenir EducooO sans que ça te coûte : le budget numérique Manolo de ton école, ou le parrainage de six collègues.",
    h1: 'Obtiens EducooO gratuitement',
    chapeau: 'Deux chemins honnêtes pour que ton année ne te coûte rien.',
  },
  corps: `<section>
<p>EducooO coûte 59,99 € par an, tout compris. Il y a deux façons parfaitement honnêtes de ne pas le payer de ta poche. Aucune des deux n'est un tour de passe-passe : voici exactement comment elles marchent, et où elles en sont.</p>
</section>

<div class="titre-section">
  <h2>Deux chemins</h2>
  <p>L'un passe par ton école, l'autre par tes collègues. Tu peux tenter les deux.</p>
</div>

<div class="duo-cartes">
<section class="phare">
  <p class="sur-titre">Chemin 1</p>
  <p class="phare-titre">Par le budget Manolo de ton école</p>
  <p>Manolo est le budget numérique de la Fédération Wallonie-Bruxelles. C'est une dotation versée aux <strong>écoles</strong>, pas directement aux enseignant·es. C'est donc l'école qui décide de ce qu'elle finance avec, et un abonnement comme EducooO peut être pris en charge sur ce budget.</p>
  <p><strong>Le geste concret :</strong> en parler à ta direction, et lui proposer d'inscrire EducooO dans les dépenses numériques de l'établissement. C'est elle qui tient les cordons de la bourse Manolo.</p>
  <p class="appui">En toute transparence : <strong>EducooO est en cours de validation pour la labellisation Manolo</strong>. Nous ne pouvons donc pas affirmer aujourd'hui que l'abonnement est déjà remboursable au titre du label. La prise en charge par l'école sur son budget reste possible, la labellisation est une démarche en cours.</p>
</section>

<section class="phare">
  <p class="sur-titre">Chemin 2</p>
  <p class="phare-titre">En parrainant six collègues</p>
  <p>EducooO a un parrainage. Chaque collègue qui s'abonne grâce à ton code te rapporte <strong>10 €</strong>. Fais le calcul : <strong>six collègues abonné·es, c'est environ 60 €</strong>, soit ton année remboursée.</p>
  <p>Et tu n'es pas la seule personne à y gagner : la collègue que tu parraines démarre avec une remise de bienvenue. Tout le monde avance.</p>
  <p class="appui">Le versement de la manne du parrainage se met en place en ce moment. Le principe est acté et le compteur tourne : garde tes filleul·es sous la main, tout est prêt côté app.</p>
</section>
</div>

<div class="bandeau" id="telecharger">
  <img src="/assets/img/nuage-celebration.webp" alt="" width="300" height="300" loading="lazy">
  <h2>Commence par installer l'app</h2>
  <p>Le premier mois est offert, sans carte bancaire. Tu verras si ça te fait gagner du temps avant même de parler budget ou parrainage.</p>
  <div class="badges centre-badges badges-bandeau">
    <a class="badge" href="{{app:ios}}"><img src="/assets/img/badge-app-store.svg" alt="Télécharger dans l'App Store" width="127" height="40" loading="lazy"></a>
    <a class="badge badge-play" href="{{app:android}}"><img src="/assets/img/badge-google-play.png" alt="Disponible sur Google Play" width="135" height="52" loading="lazy"></a>
  </div>
  <span class="mention">Sur ordinateur ou tablette ? Tu peux aussi <a href="{{app:web}}">te connecter directement dans ton navigateur</a>.</span>
</div>`,
});

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
