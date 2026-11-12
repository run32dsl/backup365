# backup365

[![CI](https://github.com/run32dsl/backup365/actions/workflows/ci.yml/badge.svg)](https://github.com/run32dsl/backup365/actions/workflows/ci.yml)

**Sauvegarde Microsoft 365 auto-hébergée, pour garder la maîtrise de vos données.** Les
sauvegardes restent sur le stockage que vous choisissez : un serveur local, un NAS ou un S3 que
vous contrôlez. Console open source construite sur le moteur
[Atlas](https://github.com/wisecom-oy/atlas) (Apache-2.0, Wisecom Oy).

> **Développé avec l'IA.** J'utilise des agents IA (Claude Code) pour accélérer le
> développement : ils écrivent une grande partie du code, je fixe la vision, je relis et
> j'accepte chaque livraison. Détails plus bas.

> **État** : en développement, MVP visé le 10 décembre 2026. Rien ici n'est prêt pour la
> production. Voir [docs/vision.md](docs/vision.md).

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
« Atlas » et « Wisecom » sont des marques de Wisecom Oy ; ce projet n'est ni affilié à
Wisecom, ni soutenu par Wisecom.

## Développé avec l'IA

J'utilise l'IA pour accélérer le développement, et je l'assume :

- des agents IA (Claude Code) écrivent une grande partie du code, des tests et de la
  documentation, chacun dans un conteneur isolé ;
- chaque changement passe par une PR, une relecture automatique, la CI et les critères
  d'acceptation de son issue ; je fixe la vision et je tranche les décisions produit ;
- les agents ne voient **jamais** de données réelles : ils travaillent sur un tenant de test
  synthétique, et le produit lui-même n'envoie rien à un modèle d'IA.

Règles des agents : [CLAUDE.md](CLAUDE.md).

## Licence

Apache-2.0, voir [LICENSE](LICENSE).
