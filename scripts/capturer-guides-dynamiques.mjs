// ============================================================================
// Captures des 3 écrans « dynamiques » manquants pour les Guides EducooO.
//
// Ces écrans vivent derrière des routes à identifiant (/lecon/[id],
// /ranger/[id], /activite/cloturer/[id]) : on ne peut pas les atteindre par un
// simple deep-link stable, il faut NAVIGUER dans l'app comme un·e enseignant·e.
//
// - cloturer-seance    : l'étape « Comment évalues-tu ? » (modalité) de la
//                        clôture d'une séance — état d'ENTRÉE, étape 1 sur 2,
//                        AVANT tout constat. On ouvre une leçon passée déjà
//                        planifiée (bouton « Clôturer » disponible) et on
//                        screenshote l'écran de modalité. On ne clique JAMAIS
//                        « Suivant ».
// - generer-lecon-ia   : l'écran de génération d'une leçon depuis une
//                        compétence — les deux choix « Guide-moi » / « J'ai
//                        mon idée ». On ne lance AUCUNE génération.
// - ranger-rattachement: l'écran /ranger/[id] avec les attendus proposés par
//                        l'IA (« Ce que je crois reconnaître ») + la citation
//                        (« Ce que tu as noté »). On ne coche/valide RIEN.
//
// RÈGLE ABSOLUE : on NE crée, NE soumet, NE clôture, NE range, NE supprime
// AUCUNE donnée. On s'arrête sur l'état d'entrée de chaque écran.
//
// Sortie : public/assets/img/guides/<slug>/01-*.png  (mobile 440x924, dsf 2).
// Idempotent, relançable, filtrable :
//     node scripts/capturer-guides-dynamiques.mjs
//     node scripts/capturer-guides-dynamiques.mjs ranger-rattachement
//
// Playwright + session.json vivent dans le dossier outillage (scratchpad),
// surchargeables par CAPTURE_TOOLS_DIR / CAPTURE_SESSION.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const APP = 'https://app.educooo.com';
const RACINE = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT = path.join(RACINE, 'public', 'assets', 'img', 'guides');

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

async function fermerOverlays(page) {
  const labels = [/^Passer$/, /J['’]ai compris/i, /^Compris$/i, /Plus tard/i, /Terminer/i];
  for (let pass = 0; pass < 3; pass++) {
    let ferme = false;
    for (const label of labels) {
      try {
        const b = page.getByText(label).first();
        if (await b.isVisible({ timeout: 700 })) {
          await b.click({ timeout: 1500, force: true });
          await wait(page, 400);
          ferme = true;
        }
      } catch {}
    }
    if (!ferme) break;
  }
}

async function shot(page, slug, name) {
  const dir = path.join(OUT, slug);
  fs.mkdirSync(dir, { recursive: true });
  await wait(page, 700);
  await page.screenshot({ path: path.join(dir, name) });
  console.log('   capturé:', slug + '/' + name);
}

// --- Configuration des guides ------------------------------------------------
const GUIDES = [
  {
    slug: 'cloturer-seance',
    async run(page, s) {
      // On ouvre une séance PASSÉE (bouton « Clôturer » disponible) : la leçon
      // « Résoudre des problèmes de fractions » est planifiée demain, donc pas
      // encore clôturable. On recule dans le journal jusqu'à trouver une leçon
      // clôturable, puis on ouvre l'étape modalité (état d'entrée).
      await page.goto(APP + '/journal', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      let ouvert = false;
      for (let sem = 0; sem < 5 && !ouvert; sem++) {
        try { await page.getByRole('button', { name: 'Semaine précédente' }).click({ force: true, timeout: 4000 }); } catch {}
        await wait(page, 1500);
        await fermerOverlays(page);
        // Une carte de leçon passée « À faire » expose un bouton « Clôturer ».
        const clot = page.getByRole('button', { name: /^Cl[oô]turer$/ });
        if (await clot.count()) {
          await clot.first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await wait(page, 400);
          await clot.first().click({ force: true, timeout: 5000 });
          await wait(page, 3000);
          await fermerOverlays(page);
          if (/\/activite\/cloturer\//.test(page.url())) ouvert = true;
        }
      }
      if (!ouvert) {
        // Repli : deep-link connu vers l'étape de clôture (leçon de test passée).
        await page.goto(APP + '/activite/cloturer/34da3cf0-ff22-49cc-9584-cdf33b28bfdf', { waitUntil: 'domcontentloaded' });
        await wait(page, 3500);
        await fermerOverlays(page);
      }
      // On doit voir l'étape « Comment évalues-tu ? » (Étape 1 sur 2).
      await page.getByText(/Comment évalues-tu/i).first().waitFor({ timeout: 8000 });
      await s('01-comment-tu-evalues.png');
    },
  },
  {
    slug: 'generer-lecon-ia',
    async run(page, s) {
      await page.goto(APP + '/competences', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      // Déplier un domaine puis toucher une compétence -> écran /lecon/[id].
      await page.getByText(/Français - Langage oral/).first().click({ force: true, timeout: 6000 });
      await wait(page, 1300);
      await page.getByText(/^Restituer la chronologie d'un récit écouté$/).first().click({ force: true, timeout: 6000 });
      await wait(page, 2500);
      await fermerOverlays(page);
      // Écran des deux choix : « Guide-moi » / « J'ai mon idée ». On ne génère rien.
      await page.getByText(/^Guide-moi$/).first().waitFor({ timeout: 8000 });
      await s('01-guide-moi-mon-idee.png');
    },
  },
  {
    slug: 'ranger-rattachement',
    async run(page, s) {
      await page.goto(APP + '/ranger', { waitUntil: 'domcontentloaded' }); await wait(page, 3000);
      await fermerOverlays(page);
      // Ouvrir une note en attente. On vise une note dont l'IA propose des
      // attendus clairs (découpage -> motricité fine / formation technique).
      const cible = page.getByText(/A découpé le long du trait/).first();
      if (await cible.count()) {
        await cible.click({ force: true, timeout: 6000 });
      } else {
        // Repli : n'importe quelle note « Pas encore rattaché ».
        await page.getByText(/Pas encore rattaché/i).first().click({ force: true, timeout: 6000 });
      }
      await wait(page, 2000);
      await fermerOverlays(page);
      // Laisser l'IA proposer ses attendus (« Ce que je crois reconnaître »).
      try { await page.getByText(/Ce que je crois reconnaître/i).first().waitFor({ timeout: 12000 }); }
      catch { console.log('   (attendus IA non détectés, capture de l’état courant)'); }
      await wait(page, 800);
      await s('01-attendus-proposes.png');
    },
  },
];

// --- Main --------------------------------------------------------------------
const filtre = process.argv.slice(2);
const aFaire = filtre.length ? GUIDES.filter((g) => filtre.includes(g.slug)) : GUIDES;
if (!aFaire.length) { console.error('Aucun guide correspondant au filtre.'); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctxOpts = { storageState: SESSION, viewport: { width: 440, height: 924 }, deviceScaleFactor: 2 };

const ok = [];
const ko = [];
for (const g of aFaire) {
  console.log(`\n=> ${g.slug}`);
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const s = (name) => shot(page, g.slug, name);
  try {
    await g.run(page, s);
    ok.push(g.slug);
  } catch (e) {
    console.log('   KO:', e.message);
    ko.push(g.slug);
  } finally {
    await context.close();
  }
}
await browser.close();

console.log(`\nTerminé. OK: ${ok.length} (${ok.join(', ')})`);
if (ko.length) console.log(`KO: ${ko.length} (${ko.join(', ')})`);
process.exit(0);
