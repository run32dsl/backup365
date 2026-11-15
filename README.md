# backup365

[![CI](https://github.com/run32dsl/backup365/actions/workflows/ci.yml/badge.svg)](https://github.com/run32dsl/backup365/actions/workflows/ci.yml)

**Sauvegarde Microsoft 365 auto-hébergée, souveraine, conçue pour le RGPD.** Les sauvegardes
restent sur le stockage que vous choisissez : un serveur local, un NAS ou un S3 que vous
contrôlez. Console open source construite sur le moteur
[Atlas](https://github.com/wisecom-oy/atlas) (Apache-2.0, Wisecom Oy).

## Statut : MVP, ne pas utiliser en production

Développement en cours, MVP visé le 10 décembre 2026. Rien ici n'est prêt pour la production :
voir [docs/vision.md](docs/vision.md) et le dossier de validation
[docs/mise-en-production.md](docs/mise-en-production.md).

> **Développé avec l'IA.** Des agents IA (Claude Code) écrivent une grande partie du code ; je
> fixe la vision, je relis et j'accepte chaque livraison. Détails plus bas.

## Aperçu

<!-- Emplacements prévus (voir docs/images/README.md). Décommenter quand les images, faites
avec des données synthétiques, existent dans docs/images/ :

![Capture d'écran de la console backup365 : tableau de bord de l'état des sauvegardes et recherche de mails](docs/images/capture-console.png)

![Démonstration animée : recherche d'un mail puis export en EML depuis une sauvegarde](docs/images/demo-export.gif)
-->

Capture d'écran et GIF de démonstration : à venir.

## Fonctions

Disponibles :

- consultation des boîtes aux lettres et de leurs instantanés de sauvegarde ;
- recherche de mails (texte, expéditeur, date) et export en EML ;
- tableau de bord de l'état de la dernière sauvegarde par charge ;
- journal d'audit chaîné de chaque consultation et export ;
- installation avec compose.

À venir : restauration granulaire (un mail, un fichier, un dossier), contacts, OneDrive,
SharePoint, Teams, agenda, planification, alertes, rétention et effacement RGPD. Priorités :
[docs/vision.md](docs/vision.md).

## Démarrage rapide

```sh
cp .env.example .env     # renseigner le tenant et l'URL du stockage S3
# créer le dossier secrets/ (3 fichiers), voir docs/installation.md
docker compose up -d --build
```

La console répond sur <http://127.0.0.1:3000>. Prérequis, secrets et MinIO pour les essais : [docs/installation.md](docs/installation.md). Démo sur un NAS Synology (réseau local uniquement) : [docs/installation-synology.md](docs/installation-synology.md).

Sans construire : l'image publiée (`linux/amd64`) se tire avec
`docker pull ghcr.io/run32dsl/backup365:develop` (dernière fusion), `:sha-<court>` (une fusion
précise) ou `:<version>` (tag `v<version>`). Un paquet GHCR est privé à sa création : le
mainteneur doit le passer en public (Paramètres du paquet, Visibilité) pour un `docker pull`
sans identifiants ; sinon, `docker login ghcr.io` avec un jeton `read:packages`.

## Pourquoi

Une organisation devrait pouvoir sauvegarder ses données Microsoft 365 chez elle, sur son
propre stockage, sans dépendre d'un service tiers pour les conserver ni pour les restaurer.
backup365 vise cette souveraineté : sauvegarde locale, chiffrée et immuable, code ouvert,
aucune télémétrie, et des outils pour démontrer la conformité au RGPD.

Atlas sauvegarde Exchange, OneDrive, SharePoint et Teams vers un stockage S3 chiffré, mais il
s'utilise en ligne de commande. backup365 ajoute ce qu'il faut pour qu'une équipe IT l'exploite
au quotidien :

- **catalogue et recherche** dans les sauvegardes ;
- **export** d'un élément et, à terme, **restauration granulaire** (un mail, un fichier, un dossier) ;
- **planification, supervision et alertes** ;
- **RGPD** : journal d'audit des accès, rétention par charge, effacement, registre ;
- **mode lecture seule** pour les tenants où la restauration n'est pas autorisée.

## Relation avec Atlas

backup365 **n'est pas un fork** d'Atlas : il utilise son SDK publié (`@wisecom/atlas-sdk`) à
une version figée. Les corrections et évolutions du moteur sont proposées à Wisecom, en amont.
Crédits : le moteur de sauvegarde est le travail de Wisecom Oy
([wisecom-oy/atlas](https://github.com/wisecom-oy/atlas), Apache-2.0). « Atlas » et « Wisecom »
sont des marques de Wisecom Oy ; ce projet n'est ni affilié à Wisecom, ni soutenu par Wisecom.

## Développé avec l'IA

J'utilise l'IA pour accélérer le développement, et je l'assume :

- des agents IA (Claude Code) écrivent une grande partie du code, des tests et de la
  documentation, chacun dans un conteneur isolé ;
- chaque changement passe par une PR, une relecture automatique, la CI et les critères
  d'acceptation de son issue ; je fixe la vision et je tranche les décisions produit ;
- les agents ne voient **jamais** de données réelles : ils travaillent sur un tenant de test
  synthétique, et le produit lui-même n'envoie rien à un modèle d'IA.

Règles des agents : [CLAUDE.md](CLAUDE.md). Contribuer : [CONTRIBUTING.md](CONTRIBUTING.md).
Signaler une faille : [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0, voir [LICENSE](LICENSE).
