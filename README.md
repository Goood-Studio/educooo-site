# educooo.com

Le site public d'EducooO : accueil et les pages que l'App Store et Google Play
exigent avant d'accepter une soumission.

## Pourquoi c'est fait comme ça

Ces pages sont vérifiées par des examinateurs Apple et Google. Elles doivent
donc s'afficher **même si tout le reste tombe** : aucun JavaScript, aucune
requête vers un autre domaine, les polices embarquées dans le dépôt.

Le contenu est du HTML lisible dans `content/`. Le générateur reprend la main
sur tout ce qui est répétitif et facile à rater : `canonical`, `hreflang`,
JSON-LD, navigation, pied de page, `sitemap.xml`, `robots.txt`, `llms.txt`.
Une page ne peut pas partir en ligne sans son SEO.

## Structure

```
content/site.json          configuration : langues, slugs, éditeur, offre
content/fr/meta.json       titre, description, h1 et chapeau de chaque page
content/fr/*.html          le corps de chaque page, en HTML
layouts/base.html          le gabarit unique
public/                    ce qui est copié tel quel (polices, images, icônes)
style.css                  la charte v9
scripts/build.mjs          le générateur
dist/                      la sortie, jamais commitée
```

## Construire

```bash
node scripts/build.mjs
python3 -m http.server 8181 --directory dist
```

Aucune dépendance : Node 20 et la bibliothèque standard suffisent.

## Ajouter une langue

1. Créer `content/nl/` avec `meta.json` et un fichier par page.
2. C'est tout. Les slugs, la navigation et les libellés du pied de page sont
   déjà déclarés dans `content/site.json`.

Le générateur ne produit **que** les langues dont le dossier existe : une
langue déclarée mais pas traduite n'est jamais indexée à vide. Le français est
servi depuis la racine pour que les URL déjà déclarées aux stores restent
valables ; les autres langues vivent sous `/nl` et `/en`.

## Écrire du contenu

Les liens internes s'écrivent `href="{{lien:confidentialite}}"`, jamais
`href="/confidentialite/"` : le générateur choisit le slug de la langue en
cours. Un lien vers une page inconnue fait échouer la construction.

## Déploiement

Poussée sur `main` → GitHub Actions génère, vérifie que les pages exigées par
les stores existent, et déploie sur GitHub Pages. Le `CNAME` est produit par le
générateur depuis `content/site.json`.

## Règles de rédaction

Tutoiement. Écriture inclusive. Aucun tiret cadratin : le générateur refuse
de construire une page qui en contient un, titres compris. Aucun émoji. Une seule
blague par page, et jamais sur une suppression ni sur un élève. La marque
s'écrit **EducooO**.
