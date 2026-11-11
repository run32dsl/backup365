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

| Priorité | Charge |
|---|---|
| 1 | Mails |
| 2 | Contacts |
| 3 | OneDrive |
| 4 | SharePoint (bibliothèques de documents) |
| 5 | Canaux Teams |
| 6 | Agenda |
| plus tard | Chats Teams (opt-in), Entra ID |

## MVP (10 décembre 2026)

Une console web, sur une seule machine, qui :
1. liste les tenants, les charges et les instantanés de sauvegarde (via le SDK d'Atlas) ;
2. permet de **chercher un mail** par expéditeur, objet ou date et de l'**exporter en EML** ;
3. affiche l'état de la dernière sauvegarde par charge (succès, avertissements, âge) ;
4. journalise chaque consultation et export dans un journal d'audit ;
5. s'installe avec un `compose.yaml` et une documentation d'une page.

Hors MVP : restauration vers le tenant, authentification Entra, multi-tenant, rétention.

## Rôles

| Rôle | Qui | Responsabilité |
|---|---|---|
| Product Manager | humain | vision, priorités, acceptation des livraisons, promotion vers `main` |
| Product Owner | Claude (session de pilotage) | backlog, issues avec critères d'acceptation, orchestration, bilan hebdomadaire |
| Développement | agents Claude (conteneurs) | code, tests, documentation, PR vers `develop` |
| Second avis | Gemini (Antigravity) | recherche, contre-revue, documentation Microsoft |

## Mesures de l'expérience « autonomie »

Délai issue → PR, part des PR fusionnées sans retouche humaine, régressions détectées en
`develop` avant `main`, quota consommé par fonctionnalité livrée.
