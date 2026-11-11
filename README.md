# backup365

**Console open source et auto-hébergée de sauvegarde Microsoft 365**, construite sur le moteur
[Atlas](https://github.com/wisecom-oy/atlas) (Apache-2.0, Wisecom Oy).

Atlas sauvegarde Exchange, OneDrive, SharePoint et Teams vers un stockage S3 que vous
contrôlez, chiffré et immuable, mais il s'utilise en ligne de commande. backup365 ajoute ce qu'il
faut pour qu'une équipe IT l'exploite au quotidien :

- **catalogue et recherche** dans les sauvegardes ;
- **restauration granulaire** (un mail, un fichier, un dossier) ou export ;
- **planification, supervision et alertes** ;
- **conformité RGPD** : journal d'audit des accès, rétention par charge, effacement, registre ;
- **mode lecture seule** pour les tenants où la restauration n'est pas autorisée.

> État : projet en démarrage (MVP visé le 10 décembre 2026). Rien ici n'est prêt pour la
> production. Voir [docs/vision.md](docs/vision.md).

## Relation avec Atlas

backup365 **n'est pas un fork** d'Atlas : il utilise son SDK publié (`@wisecom/atlas-sdk`) à
une version figée. Les corrections et évolutions du moteur sont proposées à Wisecom, en amont.
« Atlas » et « Wisecom » sont des marques de Wisecom Oy ; ce projet n'est ni affilié à
Wisecom, ni soutenu par Wisecom.

## Comment ce projet est développé

Le code est écrit en grande partie par des agents IA (Claude Code), sous la direction d'un
humain qui fixe la vision et accepte les livraisons. Règles : [CLAUDE.md](CLAUDE.md).
Les agents ne voient **jamais** de données réelles : ils travaillent sur un tenant de test
synthétique.

## Licence

Apache-2.0, voir [LICENSE](LICENSE).
