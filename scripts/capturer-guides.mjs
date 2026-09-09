// ============================================================================
// Captures automatiques des écrans pour les Guides EducooO.
//
// - Ouvre l'app web (app.educooo.com) avec une SESSION déjà authentifiée
//   (compte de test). On ne lit/écrit JAMAIS le jeton, on réutilise le
//   storageState tel quel.
// - Pour chaque guide : navigation (deep-link ou onglet du bas), fermeture des
//   overlays (tour d'accueil « Passer », coach marks « J'ai compris »), puis
//   1 à 2 captures PNG propres.
// - Sortie : public/assets/img/guides/<slug>/NN-nom.png
//     • mobile (par défaut) : viewport 440x924, deviceScaleFactor 2.
//     • large (grille/semaine) : viewport 1180x820 ; le nom contient « grille »
//       ou « 04 » pour que le générateur (generer-guides.mjs) la rende pleine
//       largeur.
//
// RÈGLE ABSOLUE : on NE crée et NE soumet AUCUNE donnée. On navigue, on remplit
// éventuellement un champ texte pour illustrer, mais on ne clique jamais
// Créer / Enregistrer / Clôturer / Envoyer / Supprimer.
//
// Idempotent : relançable, écrase les PNG. On peut filtrer par slug :
//     node scripts/capturer-guides.mjs                 (tous)
//     node scripts/capturer-guides.mjs pilotage parrainage   (ces slugs)
//
// Playwright et session.json vivent dans le dossier outillage (scratchpad).
// Surchargables par les variables d'env CAPTURE_TOOLS_DIR / CAPTURE_SESSION.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const APP = 'https://app.educooo.com';
const RACINE = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT = path.join(RACINE, 'public', 'assets', 'img', 'guides');

// Outillage (playwright + session authentifiée). Constantes surchargables.
const TOOLS_DIR = process.env.CAPTURE_TOOLS_DIR ||
  '/private/tmp/claude-501/-Users-valentinlejeune-Goood-Studio/d88d1e53-3055-4412-bc20-8472e5d7e2f6/scratchpad/capture';
const SESSION = process.env.CAPTURE_SESSION || path.join(TOOLS_DIR, 'session.json');

if (!fs.existsSync(SESSION)) {
  console.error(`session.json introuvable : ${SESSION}`);
  process.exit(2);
}
const require = createRequire(TOOLS_DIR + '/');
const { chromium } = require('playwright');

// --- Helpers -----------------------------------------------------------------
const wait = (page, ms) => page.waitForTimeout(ms);

// Ferme le tour d'accueil (« Passer ») puis les coach marks (« J'ai compris »),
// en clics force + try/catch. On repasse plusieurs fois car ils s'enchaînent.
async function fermerOverlays(page) {
  // NB : l'app utilise l'apostrophe typographique (’) — on matche les deux.
  const labels = [/^Passer$/, /J['’]ai compris/i, /^Compris$/i, /Plus tard/i, /Terminer/i];
  for (let pass = 0; pass < 3; pass++) {
    let ferme = false;
    for (const label of labels) {
      try {
        const b = page.getByText(label).first();
        if (await b.isVisible({ timeout: 800 })) {
          await b.click({ timeout: 1500, force: true });
          await wait(page, 400);
          ferme = true;
        }
      } catch {}
    }
    if (!ferme) break;
  }
}

async function tab(page, rx) {
  try { await page.getByText(rx).first().click({ timeout: 8000, force: true }); }
  catch { try { await page.getByRole('tab', { name: rx }).first().click({ timeout: 4000, force: true }); } catch {} }
  await wait(page, 1800);
  await fermerOverlays(page);
  // Certains coach marks s'affichent après la transition d'onglet : on repasse.
  await wait(page, 900);
  await fermerOverlays(page);
}

async function click(page, rx) {
  try { await page.getByText(rx).first().click({ timeout: 7000, force: true }); await wait(page, 1000); }
  catch (e) { console.log('   (click optionnel KO:', String(rx), ')'); }
}

async function scrollTo(page, rx) {
  try { await page.getByText(rx).first().scrollIntoViewIfNeeded({ timeout: 4000 }); await wait(page, 500); } catch {}
}

async function shot(page, slug, name) {
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });
  await wait(page, 700);
  await page.screenshot({ path: path.join(dir, name) });
  console.log('   capturé:', slug + '/' + name);
}

// --- Configuration des guides ------------------------------------------------
// viewport: 'mobile' (défaut) | 'large'. run(page, s) où s = (name)=>shot(...).
const GUIDES = [
  {
    slug: 'capter-observation',
    async run(page, s) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await tab(page, /^Observations$/);
      await s('01-ecran-capter.png');
    },
  },
  {
    slug: 'dictee-vocale',
    async run(page, s) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await tab(page, /^Observations$/);
      await s('01-bouton-micro.png');
    },
  },
  {
    slug: 'rituel-soir',
    async run(page, s) {
      await page.goto(APP + '/soir', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-rituel-soir.png');
    },
  },
  {
    slug: 'reprendre-lecon',
    async run(page, s) {
      // Écran d'entrée /activite/nouvelle : le choix (Créer / Reprendre).
      await page.goto(APP + '/activite/nouvelle', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-choix-creer-reprendre.png');
    },
  },
  {
    slug: 'creer-lecon',
    async run(page, s) {
      await page.goto(APP + '/activite/nouvelle', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await click(page, /Créer une nouvelle le/i);
      await scrollTo(page, /Qu.est-ce que tu vas faire/i);
      await s('01-formulaire-creation.png');
      // Illustration : on remplit l'objectif (aucune validation).
      try { await page.getByPlaceholder(/Observer les feuilles/).first().fill('Résoudre des problèmes de fractions', { timeout: 5000 }); } catch {}
      await wait(page, 800);
      await s('02-objectif-rempli.png');
    },
  },
  {
    slug: 'importer-preparation',
    async run(page, s) {
      await page.goto(APP + '/activite/nouvelle', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await click(page, /Créer une nouvelle le/i);
      await scrollTo(page, /Intégrer une préparation/i);
      await s('01-integrer-preparation.png');
    },
  },
  {
    slug: 'planifier-semaine',
    viewport: 'large',
    async run(page, s) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await tab(page, /^Leçons$/);
      await click(page, /^Semaine$/);
      await fermerOverlays(page);
      await s('01-grille-semaine.png');
    },
  },
  {
    slug: 'export-pdf-semaine',
    viewport: 'large',
    async run(page, s) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await tab(page, /^Leçons$/);
      await click(page, /^Semaine$/);
      await fermerOverlays(page);
      await s('01-grille-export-pdf.png');
    },
  },
  {
    slug: 'multi-classes',
    async run(page, s) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await tab(page, /^Leçons$/);
      await s('01-selecteur-classe.png');
    },
  },
  {
    slug: 'semaine-type',
    async run(page, s) {
      await page.goto(APP + '/vous/semaine', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-semainier-type.png');
    },
  },
  {
    slug: 'programme-filtres',
    async run(page, s) {
      await page.goto(APP + '/competences', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-programme-filtres.png');
    },
  },
  {
    slug: 'choisir-referentiels',
    async run(page, s) {
      await page.goto(APP + '/vous/referentiels', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-choisir-referentiels.png');
    },
  },
  {
    slug: 'absence-replanifier',
    async run(page, s) {
      await page.goto(APP + '/absence', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-absence-replanifier.png');
    },
  },
  {
    slug: 'collegues-partage',
    async run(page, s) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await tab(page, /^Groupes$/);
      await s('01-groupes.png');
    },
  },
  {
    slug: 'parrainage',
    async run(page, s) {
      await page.goto(APP + '/parrainage', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-parrainage.png');
    },
  },
  {
    slug: 'abonnement',
    async run(page, s) {
      await page.goto(APP + '/abonnement', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-abonnement.png');
    },
  },
  {
    slug: 'donnees-confiance',
    async run(page, s) {
      await page.goto(APP + '/vous/donnees', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-donnees-confiance.png');
    },
  },
  {
    slug: 'pilotage',
    async run(page, s) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await tab(page, /^Compétences$/);
      await s('01-pilotage.png');
    },
  },
  // --- Entrées « au mieux » (routes dynamiques) ------------------------------
  {
    slug: 'fiche-eleve',
    async run(page, s) {
      // Point d'entrée réaliste : la liste des élèves (« Ma classe »),
      // accessible en deep-link ou via l'icône élèves de Pilotage.
      await page.goto(APP + '/classe', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      await s('01-liste-eleves.png');
    },
  },
];

// --- Main --------------------------------------------------------------------
const filtre = process.argv.slice(2);
const aFaire = filtre.length ? GUIDES.filter((g) => filtre.includes(g.slug)) : GUIDES;
if (!aFaire.length) { console.error('Aucun guide correspondant au filtre.'); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctxOpts = {
  mobile: { storageState: SESSION, viewport: { width: 440, height: 924 }, deviceScaleFactor: 2 },
  large: { storageState: SESSION, viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 },
};

const ok = [];
const ko = [];
for (const g of aFaire) {
  const kind = g.viewport === 'large' ? 'large' : 'mobile';
  console.log(`\n=> ${g.slug} (${kind})`);
  const context = await browser.newContext(ctxOpts[kind]);
  const page = await context.newPage();
  const s = (name) => shot(page, g.slug, name);
  try {
    await g.run(page, s);
    ok.push(g.slug);
  } catch (e) {
    console.log('   KO:', e.message);
    (g.optionnel ? ko : ko).push(g.slug);
  } finally {
    await context.close();
  }
}
await browser.close();

console.log(`\nTerminé. OK: ${ok.length} (${ok.join(', ')})`);
if (ko.length) console.log(`KO: ${ko.length} (${ko.join(', ')})`);
process.exit(0);
