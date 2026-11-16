# Vision produit

## Pour qui

Les équipes IT de petites et moyennes organisations européennes qui veulent sauvegarder leur
tenant Microsoft 365 **chez elles** (NAS, S3 souverain), sans abonnement par utilisateur, avec
des garanties RGPD démontrables.

## Problème

Microsoft ne garantit pas la restauration fine des données des utilisateurs. Les offres
commerciales sont payantes par utilisateur, souvent hébergées hors UE. Atlas, le moteur libre le
plus solide, n'a pas d'interface d'exploitation.

## Principes (non négociables)

1. **Données de l'organisation chez l'organisation.** Aucune donnée sauvegardée ne quitte le
   stockage choisi ; aucune télémétrie.
2. **Aucune IA sur des données réelles.** Le produit n'envoie rien à un LLM. Le développement
   assisté par IA se fait sur un tenant de test synthétique.
3. **Moindre privilège.** Mode lecture seule possible (sauvegarde sans aucun droit d'écriture
   dans le tenant) ; restauration désactivable.
4. **Traçabilité.** Toute consultation ou restauration d'une donnée personnelle est journalisée
   (qui, quoi, quand, pourquoi).
5. **Moteur en amont.** On contribue à Atlas plutôt que de le contourner.

## Périmètre par priorité

| Priorité  | Charge                                  |
| --------- | --------------------------------------- |
| 1         | Mails                                   |
| 2         | Contacts                                |
| 3         | OneDrive                                |
| 4         | SharePoint (bibliothèques de documents) |
| 5         | Canaux Teams                            |
| 6         | Agenda                                  |
| plus tard | Chats Teams (opt-in), annuaire Entra ID |

## MVP (10 décembre 2026)

Périmètre revu par le Product Manager le 14 novembre 2026. Une console web, sur une seule
machine. Par priorité :

1. **Comptes locaux et rôles** (livré).
2. **Plans de protection par objectifs** : RPO, RTO et conservation justifiée au regard du RGPD,
   avec sauvegarde planifiée.
3. **Restauration** d'un mail, puis d'un fichier OneDrive, puis d'un site SharePoint.
4. **Connexion par compte Microsoft** (OIDC Entra ID, livrée, à valider sur le tenant de test).

Déjà livré : catalogue des tenants, charges et instantanés (via le SDK d'Atlas), recherche de
mails et export EML journalisé, tableau de bord de l'état des sauvegardes, journal d'audit
chaîné, installation avec un `compose.yaml`.

Approche « objectifs » : l'utilisateur fixe ses objectifs et la configuration technique en
découle. Interface légère, valeurs par défaut sûres, pas de forêt de réglages.

Hors MVP : multi-tenant, SAML, chats Teams, sauvegarde d'Entra ID (l'annuaire, à ne pas
confondre avec la connexion de la priorité 4).

La restauration respecte le principe 3 : elle est désactivable et le mode lecture seule reste
possible.

## Organisation

Deux voies de développement en parallèle ; chaque PR passe une revue automatique qui s'appuie
sur des captures d'écran en mode démo.

## Rôles

| Rôle            | Qui                          | Responsabilité                                                                 |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Product Manager | humain                       | vision, priorités, acceptation des livraisons, promotion vers `main`           |
| Product Owner   | Claude (session de pilotage) | backlog, issues avec critères d'acceptation, orchestration, bilan hebdomadaire |
| Développement   | agents Claude (conteneurs)   | code, tests, documentation, PR vers `develop`                                  |
| Second avis     | Gemini (Antigravity)         | recherche, contre-revue, documentation Microsoft                               |

## Mesures de l'expérience « autonomie »

Délai issue → PR, part des PR fusionnées sans retouche humaine, régressions détectées en
`develop` avant `main`, quota consommé par fonctionnalité livrée.
