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
  `BEGIN IMMEDIATE` : lecture du dernier maillon et écriture sont atomiques.
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
- `item.export` fait partie du vocabulaire mais aucune route d'export n'existe encore. `item.open`
  est émis par `GET /api/snapshots/:id` (fiche d'un instantané), seule ouverture existante ; la
  fiche d'un mail attendra l'adaptateur de lecture.
- `access.denied` est émis quand le catalogue ou l'index est indisponible ou qu'un instantané est
  introuvable ; le refus d'authentification viendra avec l'authentification.
- Pas de rétention ni de purge : le journal grossit (rétention RGPD à décider séparément).
