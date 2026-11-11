# Mise en production : dossier de validation

Ce document sert à obtenir l'**accord écrit** de l'organisation propriétaire du tenant
Microsoft 365 avant toute sauvegarde de données réelles. Il est à compléter avec elle (DSI,
RSSI, DPO) et à conserver.

## 1. Cadre et responsabilités

| Point                      | À renseigner                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Responsable de traitement  | l'organisation propriétaire du tenant                                                            |
| Opérateur de la sauvegarde | personne ou équipe, interne ou prestataire (contrat de sous-traitance, art. 28 RGPD, si externe) |
| Finalité                   | continuité d'activité et restauration de données supprimées ou corrompues                        |
| Base légale                | intérêt légitime / obligation de sécurité (art. 32) ; à valider par le DPO                       |
| Registre des traitements   | entrée créée ou mise à jour                                                                      |
| AIPD                       | nécessaire si sauvegarde des boîtes de tous les salariés : à décider avec le DPO                 |

## 2. Périmètre

Charges sauvegardées (mails, contacts, OneDrive, SharePoint, canaux Teams, agenda), comptes
inclus ou exclus (ex. boîtes de la direction, des représentants du personnel), durée de
conservation par charge, et ce qui est **exclu** (chats Teams, Entra ID, si c'est le cas).

## 3. Accès à Microsoft Graph

- Application Entra dédiée, **un seul tenant**, consentement par un administrateur.
- **Mode lecture seule visé** : permissions `*.Read*` uniquement. Limite actuelle d'Atlas : la
  sauvegarde des mails demande `Mail.ReadWrite` (documentation d'Atlas) ; à lever avant la
  production ou à accepter explicitement ici.
- Restauration vers le tenant : **désactivée** par défaut ; restauration par export (EML,
  fichiers) remis à la personne concernée ou à l'IT.
- Option recommandée : limiter l'accès Exchange de l'application à un groupe de boîtes
  (Application RBAC d'Exchange Online).
- Authentification par certificat (clé privée non exportable) plutôt que par secret ;
  rotation documentée.

## 4. Infrastructure

- Machine approuvée par l'organisation (pas un poste personnel), à jour, durcie, journalisée.
- Stockage S3 de l'organisation, **immuable** (Object Lock), dans l'UE ; copie secondaire.
- Chiffrement Atlas (AES-256-GCM, clé par tenant) ; **phrase de chiffrement** conservée hors
  ligne par deux personnes (perte = sauvegardes illisibles).
- Version d'Atlas et de backup365 **figée et relue** ; aucune version de développement.
- Aucun outil d'IA, aucun service tiers n'accède aux données, aux journaux ni aux identifiants.

## 5. Accès et traçabilité

Qui peut consulter ou exporter quoi (rôles), validation à deux personnes pour une boîte qui
n'est pas la sienne, journal d'audit conservé et revu, information des salariés.

## 6. Droits des personnes et effacement

Procédure pour l'accès (art. 15), l'effacement (art. 17 : la donnée effacée reste dans les
sauvegardes immuables jusqu'à expiration de la rétention ; le préciser dans l'information
des personnes), la portabilité (art. 20).

## 7. Tests et réversibilité

Restauration testée chaque mois et tracée ; procédure de désinstallation (suppression de
l'application Entra, des identifiants, purge du stockage à l'issue de la rétention).

## 8. Validation

| Rôle | Nom | Date | Accord |
| ---- | --- | ---- | ------ |
| DSI  |     |      |        |
| RSSI |     |      |        |
| DPO  |     |      |        |
