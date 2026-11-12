# ADR 0004 : journal d'audit chaîné (SQLite)

Statut : **proposé**

## Contexte

Le produit manipule des données personnelles : chaque lecture ou export d'un élément sauvegardé
doit laisser une trace infalsifiable (`docs/vision.md`, RGPD). L'ADR 0001 impose SQLite pour le
MVP derrière un port de `packages/core`, avec PostgreSQL ensuite.

## Décision

- Le port `AuditLog` (`packages/core/src/audit.ts`) expose `record`, `list` (filtres `from`, `to`,
  `actor`, `action`, pagination) et `verify`. Il ne contient aucune syntaxe de moteur.
- L'adaptateur `SqliteAuditLog` (`apps/server/src/sqlite`) stocke la table `audit_log` dans une
  base **distincte**, `audit.sqlite` (dans `BACKUP365_DATA_DIR`) : l'index de recherche se
  reconstruit, pas le journal. Droits 0700/0600 comme l'index.
- **Ajout seul** : des triggers refusent tout `UPDATE` et `DELETE`.
- **Chaînage** : chaque entrée porte `previous_hash` (l'empreinte de la précédente, 64 zéros pour
  la première) et `hash` = SHA-256 de `auditHashInput(previousHash, entrée)`, texte canonique défini
  dans le cœur pour que tous les adaptateurs produisent les mêmes empreintes. L'ajout se fait en
  `BEGIN IMMEDIATE` : lecture du dernier maillon et écriture sont atomiques. Le dernier maillon
  est relu en base à chaque ajout, jamais gardé en mémoire : deux connexions sur le même fichier
  écrivent une seule chaîne (testé ; l'attente du verrou entre deux processus ne l'est pas).
- **Vérification** : `verify()` relit la chaîne et signale la première entrée dont le rang, le
  chaînage ou l'empreinte est incorrect. Commande : `pnpm --filter @backup365/server audit:verify`
  (après `build`) ; code de sortie 0 chaîne intacte, 1 altérée, 2 journal illisible.
- **Événements** (vocabulaire fermé) : `list.view`, `item.open`, `item.export`, `access.denied`.
  Un événement porte horodatage, acteur, ressource, cible opaque, nombre d'éléments, motif. Jamais
  de terme recherché ni de contenu.
- **Fail-closed** : les routes qui renvoient des éléments sauvegardés consignent avant de répondre ;
  si la consignation échoue, rien n'est renvoyé ; sans journal, elles répondent 503.
- `GET /api/audit` (lecture seule) et l'écran `#/audit` consultent le journal.
- Tests de contrat (`auditLogContract`, `@backup365/core/testing`) rejouables sur PostgreSQL ; le
  banc fournit `alterActor` et `deleteEntry` pour simuler l'attaque sur le stockage.
- Aucune dépendance ajoutée (`node:crypto`, `node:sqlite`).

## Limites connues

- Qui peut écrire dans la base peut **recalculer toute la chaîne** : la chaîne détecte une
  altération ou une suppression au milieu, pas une réécriture complète ni la troncature de la
  fin. Pour s'en prémunir : sauvegarder ou publier régulièrement la dernière empreinte hors de la
  machine (à planifier).
- Pas d'authentification (ADR 0002) : l'acteur vaut `anonymous` (`actorOf`, un seul point à
  changer) et `GET /api/audit` est ouvert comme le reste de l'API.
- `item.export` fait partie du vocabulaire mais **rien ne l'émet** : aucune route d'export
  n'existe, et le port `BackupCatalog` ne lit que des métadonnées (ADR 0002), pas le contenu d'un
  élément. L'événement sera émis par la route d'export, qui demande d'abord un port de lecture
  de contenu. `item.open` est émis par `GET /api/snapshots/:id` (fiche d'un instantané), seule
  ouverture existante ; la fiche d'un mail attendra le même port de lecture.
- **Écart avec l'ADR 0002** (accepté) : il dit que les lectures de métadonnées du catalogue « ne
  passent pas par le journal d'audit ». Ici, elles sont consignées (`list.view`, `item.open`) et
  répondent 503 sans journal, parce que l'issue #5 demande les événements « consultation d'une
  liste » et « ouverture d'une fiche » et que le catalogue porte les seules listes et fiches
  existantes avec la recherche. Si cet ADR est accepté, il remplace l'ADR 0002 sur ce point ;
  s'il est refusé sur ce point, retirer la consignation de `catalog-routes.ts`.
- `GET /api/audit` n'est pas elle-même consignée : le journal n'est pas un élément sauvegardé,
  mais il contient des identifiants de boîte. Choix de l'auteur, à confirmer.
- `access.denied` est émis quand le catalogue ou l'index est indisponible ou qu'un instantané est
  introuvable ; le refus d'authentification viendra avec l'authentification.
- Pas de rétention ni de purge : le journal grossit (rétention RGPD à décider séparément).
