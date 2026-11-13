# ADR 0004 : journal d'audit chaîné (SQLite)

Statut : **accepté** le 2026-11-12 par le Product Manager (issue #23)

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

## Ancrage externe

Statut : **proposé** (issue #21, décisions du PO du 2026-11-13).

- Le serveur écrit une ancre `{seq, headHash, at, mac}` (une ligne JSON) dans
  `audit-anchors.jsonl`, fichier ouvert en **ajout seul**, situé dans `BACKUP365_AUDIT_ANCHOR_DIR`.
  Ce dossier doit être distinct de `BACKUP365_DATA_DIR` et destiné à un autre stockage (partage NAS
  à instantanés immuables, par exemple). L'ancre ne contient ni contenu de mail ni motif d'export.
- Écriture au démarrage, toutes les `BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN` minutes (60 par défaut,
  entier de 1 à 1440) **seulement si la tête a changé**, et à l'arrêt propre.
- Signature : HMAC-SHA256 de `seq`, `headHash` et `at` avec une clé dérivée par HKDF-SHA256
  (`node:crypto`) de `BACKUP365_ENCRYPTION_PASSPHRASE`, contexte `backup365-audit-anchor`. Aucun
  nouveau secret. Qui n'a pas la phrase ne peut pas forger d'ancre ; changer la phrase invalide
  les ancres existantes (à noter lors d'une rotation).
- `audit-verify` contrôle aussi les ancres : signature valide ; `seq` de chaque ancre ≤ dernier
  `seq` local (sinon **troncature**) ; empreinte locale au `seq` ancré = `headHash` (sinon
  **réécriture**). Écart : message explicite et code de sortie 1. Un fichier d'ancres absent ou
  illisible alors que le dossier est configuré est aussi un écart.
- Dossier absent, égal à `BACKUP365_DATA_DIR` ou contenu dedans (ou phrase de chiffrement absente) :
  avertissement au démarrage et `GET /api/status` expose « ancrage du journal : non configuré » avec
  la raison ; le démarrage n'est pas refusé (démo).
- Limites : une ancre protège jusqu'à la dernière écrite ; les entrées ajoutées depuis (au plus
  l'intervalle) peuvent être tronquées sans détection. Qui contrôle aussi le stockage des ancres et
  la phrase peut tout refaire : d'où le stockage distinct et immuable. `GET /api/status` n'est
  servi qu'avec le catalogue configuré.
- Hors périmètre : ancrage S3 Object Lock (client S3 direct, donc nouvelle dépendance soumise au
  PM), issue séparée.

## Limites connues

- Qui peut écrire dans la base peut **recalculer toute la chaîne** : la chaîne détecte une
  altération ou une suppression au milieu, pas une réécriture complète ni la troncature de la
  fin. Parade : ancrer régulièrement la dernière empreinte hors de la base (section « Ancrage
  externe »). **Obligatoire avant toute mise en production** (décision du PM du 2026-11-12), #21.
- Pas d'authentification (ADR 0002) : l'acteur vaut `anonymous` (`actorOf`, un seul point à
  changer) et `GET /api/audit` est ouvert comme le reste de l'API.
- `item.export` fait partie du vocabulaire mais **rien ne l'émet** : aucune route d'export
  n'existe, et le port `BackupCatalog` ne lit que des métadonnées (ADR 0002), pas le contenu d'un
  élément. L'événement sera émis par la route d'export, qui demande d'abord un port de lecture
  de contenu. `item.open` est émis par `GET /api/snapshots/:id` (fiche d'un instantané), seule
  ouverture existante ; la fiche d'un mail attendra le même port de lecture.
  _Note (ADR 0005, 2026-11-12) : cette limite est levée, `item.export` est désormais émis par
  `POST /api/mails/:mailboxId/:messageId/export`, et `item.open` par la fiche d'un mail._
- **Cohérence avec l'ADR 0002** (accepté) : les lectures de métadonnées du catalogue (`GET
/api/mailboxes` et `GET /api/mailboxes/:id/snapshots`) ne passent pas par le journal d'audit et
  ne dépendent pas de lui (décision du PO) : elles répondent sans journal et ne consignent ni
  `list.view` ni `access.denied`. Sont consignés : l'ouverture d'un instantané (`item.open`,
  `GET /api/snapshots/:id`, 503 sans journal), la recherche (`list.view`) et les échecs d'accès à
  ces deux routes.
- `GET /api/audit` n'est pas elle-même consignée : le journal n'est pas un élément sauvegardé,
  mais il contient des identifiants de boîte. Confirmé par le PM le 2026-11-12 (issue #23), valable
  jusqu'à l'authentification ; la consignation de cette lecture est suivie dans #22.
- `access.denied` est émis quand le catalogue ou l'index est indisponible ou qu'un instantané est
  introuvable, sur l'ouverture d'un instantané et sur la recherche ; le refus d'authentification
  viendra avec l'authentification.
- Pas de rétention ni de purge : le journal grossit (rétention RGPD à décider séparément).
