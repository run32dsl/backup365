# Contribuer à backup365

Les règles du projet (branches, fusion, sécurité, RGPD) sont dans [CLAUDE.md](CLAUDE.md) et
priment sur ce document. Décisions d'architecture : [docs/adr/](docs/adr/).

## Contribuer depuis un fork

1. Forker le dépôt, créer une branche `feat/<n>-<sujet>` ou `fix/<n>-<sujet>` depuis `develop`.
2. Ouvrir une PR vers `develop`, avec le modèle de description du dépôt.
3. Une PR externe n'est **jamais fusionnée automatiquement** : c'est une règle de l'orchestrateur,
   qui exclut les PR dont la branche source n'est pas dans ce dépôt ; le mainteneur la relit et la
   fusionne, même si la CI est verte.

### Signature DCO

Chaque commit porte une ligne `Signed-off-by: Nom <courriel>` (`git commit -s`). Elle atteste que
vous avez le droit de proposer ce code, aux conditions du
[Developer Certificate of Origin 1.1](https://developercertificate.org/). Le job `dco` de la CI
(`.github/workflows/dco.yml`, script `.github/scripts/check-dco.sh`) refuse la PR depuis un fork
si un commit n'est pas signé. Pour corriger : `git rebase --signoff origin/develop`, puis
`git push --force-with-lease` sur votre fork.

### Données

Uniquement des données fictives (domaine `exemple.fr`) ou un tenant de test : jamais de donnée
réelle, de secret ni de donnée personnelle dans le code, les tests, les captures, les issues ou
les PR.

## Code écrit avec l'IA

L'usage de l'IA est autorisé, y compris pour les contributions externes. Mentionnez-le dans la
PR (case du modèle). L'auteur humain reste responsable de ce qu'il propose : il relit, comprend et
signe le code. [CLAUDE.md](CLAUDE.md) s'applique aussi aux sessions Claude des contributeurs.

Une partie du code, des tests et de la documentation est écrite par des agents IA (Claude
Code). Chaque PR est relue automatiquement, passe la CI et les critères d'acceptation de son
issue, puis est validée par le mainteneur. Les contributions humaines suivent le même circuit.
Les agents ne voient jamais de données réelles.

## Référent sécurité

Le référent sécurité (`MoonEyes`, rôle Triage, sans droit d'écriture) contribue à titre
personnel. Il :

- relit le modèle de menaces et le met à jour par PR quand l'architecture change ;
- relit les PR étiquetées `sécurité` et celles qui touchent `SECURITY.md`, `docs/adr/`, `deploy/`,
  `apps/server/src/auth*`, `apps/server/src/oidc*` ou `.github/` ;
- relit les ADR de sécurité avant leur acceptation par le Product Manager ;
- aide à traiter les signalements privés de [SECURITY.md](SECURITY.md).

Son avis est consultatif : seul le mainteneur fusionne. `.github/CODEOWNERS` ne le liste pas, car
GitHub ignore un code owner sans droit d'écriture. Aucun workflow ne demande sa revue : le jeton
d'un workflow `pull_request` est en lecture seule sur une PR de fork, et `pull_request_target`
est écarté par prudence. L'orchestrateur l'ajoute donc comme relecteur de chaque PR concernée.

## Prérequis

Node 22 et pnpm via corepack (`corepack enable`). Uniquement pnpm, jamais npm ni yarn.

## Commandes

```sh
pnpm install
pnpm run build         # compile core, server et web
pnpm run typecheck     # TypeScript strict, sans émission
pnpm run lint          # ESLint
pnpm run format:check  # Prettier (`pnpm run format` pour corriger)
pnpm run test          # Vitest, sans accès réseau, puis test du contrôle DCO (bash et git)
```

Ces cinq commandes doivent passer avant toute PR ; le job `ci` de GitHub Actions
(`.github/workflows/ci.yml`) les rejoue sur chaque PR vers `develop` et `main`. Les actions y
sont épinglées par SHA : pour les mettre à jour, changer le SHA et le commentaire de version
ensemble. En développement : `pnpm --filter
@backup365/server start` après un build (port 3000, variables `PORT`, `HOST`, `LOG_LEVEL`, `BACKUP365_DATA_DIR` pour le dossier des bases (`search.sqlite`, reconstructible, et `audit.sqlite`, journal d'audit à conserver), `./data` par défaut ; catalogue : `BACKUP365_TENANT_ID`, `BACKUP365_S3_ENDPOINT`,
`BACKUP365_S3_ACCESS_KEY_ID`, `BACKUP365_S3_SECRET_ACCESS_KEY`, `BACKUP365_ENCRYPTION_PASSPHRASE`,
`BACKUP365_S3_REGION` facultative, voir l'ADR 0002 ; chaque secret accepte une variante `_FILE`,
voir [docs/installation.md](docs/installation.md) ; `BACKUP365_WEB_DIR` fait servir l'interface
construite par le serveur, voir l'ADR 0007) et
`pnpm --filter @backup365/web dev` (proxy `/api` vers le serveur).

## Mode démo, captures et tests de navigateur

`BACKUP365_DEMO=1` lance la console sans S3 ni Microsoft 365, sur un faux catalogue entièrement
fictif (domaine `exemple.fr`, voir `apps/server/src/demo.ts`) et un bandeau « Mode démo : données
fictives » sur tous les écrans. Comptes : `admin-demo` / `demonstration-admin` et `operateur-demo` /
`demonstration-operateur`. Le serveur refuse de démarrer si une configuration de stockage réelle est
présente ; utiliser un `BACKUP365_DATA_DIR` jetable.

- `pnpm run captures` construit, lance le mode démo sur un port libre et écrit
  `captures/<écran>-1280.png` et `-390.png` (dossier ignoré par git). Regarder les images avant
  d'ouvrir la PR. La CI lance la même commande : un écran qui ne se capture plus la fait échouer.
  `pnpm run captures --lang=en-US` (ou la variable `BACKUP365_LANG=en-US`) les
  prend avec un navigateur en anglais : le rendu doit rester identique, ce que vérifie
  `e2e/langue.spec.ts` pour les filtres de date. Un Chromium installé avec la seule langue `en-US`
  (conteneurs des agents) affiche ses champs natifs en anglais quelle que soit l'option : ne pas
  utiliser de champ `date` ou `datetime-local`, mais un champ texte au format `jj/mm/aaaa`.
- **Ajouter un écran** : une entrée dans `e2e/screens.mjs` (`name`, `hash`, `role`, `prepare`
  éventuel pour les gestes préalables).
- `pnpm run test:e2e` joue les tests Playwright (`e2e/*.spec.ts`) en mode démo. Installer le
  navigateur une fois avec `pnpm exec playwright install chromium`, ou pointer
  `BACKUP365_CHROMIUM` vers un exécutable Chromium existant.

## Durées de la CI

Le job `ci` porte `timeout-minutes: 15` (`.github/workflows/ci.yml`) ; `pnpm run captures` en est
une étape, et sa durée croît avec le nombre d'écrans. Le suivi se fait sans réseau côté
développement :

- `pnpm run captures` termine par une ligne de relevé, qui commence par
  `captures : durée <n> s pour <m> images` et rappelle le seuil. C'est la durée de toute la
  commande : construction comprise sur un poste ou sur l'hôte, sans construction dans la CI
  (`BACKUP365_SKIP_BUILD`). Dans la CI, la même ligne est écrite dans le résumé du run. Au-delà de
  5 min, la commande ajoute un avertissement, sans échouer ;
- la reprise de cette ligne dans `.review/verifs-<PR>.txt` à chaque revue relève de l'outillage de
  l'hôte (suivi dans #249). Ce sera la durée mesurée sur l'hôte, distincte de celle de l'étape
  `captures` du job `ci` ;
- le bilan hebdomadaire du Product Owner reprend la durée médiane et la durée maximale du job `ci`
  sur `develop` pour la semaine écoulée (lues dans l'interface Actions), et la plus longue durée de
  `captures` relevée dans les résumés de run et les fichiers `verifs` de la semaine ;
- seuils d'alerte, tous deux sous le timeout de 15 min : 10 min pour le job `ci`, 5 min pour
  `captures`. Au-delà, le Product Owner ouvre une issue pendant le bilan (mise en place suivie
  dans #250) : rien dans le dépôt ne l'ouvre à sa place. Cas limite accepté : un dépassement du
  job `ci` en milieu de semaine n'est vu qu'au bilan suivant.

## Version affichée

Le pied de page de la console affiche la version du serveur (`/api/health`).

- Le produit reste en 0.x, avec un incrément mineur à chaque promotion `develop` → `main`.
- Le passage en 1.0.0 est décidé par le Product Manager (décision du 2026-11-18) : seulement quand
  le MVP est jugé satisfaisant et validé par lui. Ni la promotion du MVP, ni un jalon technique
  (par exemple la validation de la connexion Microsoft) ne suffisent à eux seuls.

## Conventions

- Une issue = une branche `feat/<n>-<sujet>` ou `fix/<n>-<sujet>`, une PR vers `develop`.
- Messages de commit en anglais, format conventionnel (`feat:`, `fix:`, `docs:`…).
- Tests dans le même commit que le code ; pas d'appel réseau dans les tests unitaires.
- Le domaine et les ports vivent dans `packages/core` ; `apps/*` ne contiennent que des adaptateurs.
- Aucun secret, donnée de tenant ou donnée personnelle dans le dépôt, les logs ou les tests.
