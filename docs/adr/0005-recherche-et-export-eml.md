# ADR 0005 : recherche et export EML journalisé

Statut : **accepté** le 2026-11-12 par le Product Manager (issue #28) ; proposé à l'issue #6

## Contexte

La vision (MVP, point 2) demande de chercher un mail et de l'exporter en EML. L'ADR 0003 fournit
l'index (métadonnées), l'ADR 0004 le journal d'audit ; ce dernier note que `item.export` n'est
émis par rien faute de port de lecture de contenu, et que la fiche d'un mail attend ce port.

## Décision

- Le port `MailContentReader` (`packages/core`) lit le contenu d'un mail ; l'adaptateur
  `AtlasSdkMailContentReader` s'appuie sur `outlook.readMessage(snapshotId, messageRef)` du SDK
  (lecture sans Graph comme les autres, ADR 0002). Les erreurs du SDK deviennent
  `MailContentUnavailableError` : la réponse est 503 sans détail. Aucune dépendance ajoutée.
- `messageRef` reçoit le `messageId` de l'index, et l'instantané est celui où l'index a vu le mail
  pour la première fois.
- `SearchIndex.getMail(mailboxId, messageId)` donne la fiche (métadonnées seulement).
- `GET /api/mails/:mailboxId/:messageId` : fiche, consignée `item.open` (ressource `mail`, cible
  `boîte/message`).
- `POST /api/mails/:mailboxId/:messageId/export`, corps `{ "reason": "…" }` : le **motif est
  obligatoire** (3 à 120 caractères après suppression des espaces de bord, sans caractère de
  contrôle), sinon 400 sans lecture ni consignation. L'événement `item.export` (qui : `actor`,
  quoi : `target`, quand : `at`, motif : `reason`) est inscrit **avant** l'envoi du fichier ;
  s'il échoue, rien n'est renvoyé. Sans journal : 503. Échecs (mail inconnu, contenu absent ou
  illisible, format non pris en charge) : `access.denied`.
- **EML** : un message `mime` (format actuel du SDK) est restitué octet pour octet, type
  `message/rfc822`, nom de fichier fixe `message.eml` (aucune donnée personnelle dans le nom). Un
  message de l'ancien format (JSON Graph) est reconstruit : en-têtes principaux (De, À, Cc, Objet,
  Date, Message-ID, valeurs sans saut de ligne, mots encodés RFC 2047) et corps encodé en base 64.
  Ses pièces jointes ne sont pas incluses (le contenu n'est pas lu) : l'en-tête de réponse
  `X-Backup365-Omitted-Attachments` donne leur nombre et le fichier porte
  `X-Backup365-Reconstructed: graph-json`.
- **Décision du PM (2026-11-12)** : le motif reste un texte libre, **limité** à 120 caractères
  (le journal le conserve, lui, sans limite, en ajout seul). Le formulaire guide vers un
  **numéro de ticket de l'outil de ticketing interne** : libellé « Motif de l'export »,
  exemple `Ticket INC-12345`, et consigne « Indiquez de préférence le numéro du ticket interne.
  N'y saisissez pas de donnée personnelle (nom, adresse, contenu du mail). »
- Interface : écrans `#/search` (champ libre, boîte, plage de dates, résultats paginés) et
  `#/mail/<boîte>/<message>` (fiche, motif, bouton « Exporter en EML »).

## Limites connues

- Le motif est du texte libre conservé tel quel dans un journal qu'on ne peut pas purger : la
  consigne de ne pas y mettre de donnée personnelle est affichée, non vérifiée. La durée de
  conservation du journal est **à fixer dans le registre RGPD**.
- Rien ne remplit l'index en production (ADR 0003) : tant que l'indexation n'est pas branchée,
  la recherche ne renvoie rien.
- Routes non authentifiées (`anonymous`, ADR 0002).
- Pas de téléchargement en lot, pas de lecture du corps dans l'interface.
- Le contenu est lu en mémoire (un mail à la fois).

## Non vérifié

Lecture réelle contre un stockage S3 : les tests utilisent un faux du SDK. La documentation du
SDK ne définit pas `messageRef` ; la correspondance avec le `messageId` de l'index est une
hypothèse à confirmer dès que l'indexation réelle existe.
