# ADR 0023 : rapports par mail par Microsoft Graph `sendMail`

Statut : **proposé** (issue #278)

## Contexte

Le PM veut un rapport régulier sur les sauvegardes et une alerte immédiate en cas d'échec. Décision
du PM délégué (25/11) : envoi par Microsoft Graph `sendMail`, sans nouvelle dépendance, avec la
permission `Mail.Send` documentée dans l'installation ; désactivé tant qu'elle manque. Rapport
quotidien ou hebdomadaire, alerte d'échec, destinataires réglés par un administrateur ; seulement
des compteurs, des durées et l'état des plans. Le SDK d'Atlas n'expose pas de client Graph
public, et la console n'appelait jusqu'ici jamais Graph directement (ADR 0002).

## Décision

- **Envoi** : `GraphMailer` (`apps/server/src/graph-mailer.ts`) obtient un jeton par le flux
  « client credentials » avec l'application de la sauvegarde (`BACKUP365_TENANT_ID`,
  `BACKUP365_M365_CLIENT_ID`, `BACKUP365_M365_CLIENT_SECRET`), puis appelle
  `POST /v1.0/users/<boîte>/sendMail` (texte brut, sans copie dans les éléments envoyés). Le
  `fetch` natif de Node suffit : aucune dépendance.
- **Boîte d'envoi** : `BACKUP365_REPORT_SENDER`. Sans elle, ou sans identifiants, l'envoi est
  « non configuré ». La permission est limitée à cette boîte par une stratégie d'accès
  d'application (guide d'installation).
- **Vérification** : la console lit le rôle `Mail.Send` dans la charge utile du jeton, sans en
  vérifier la signature (simple diagnostic : le jeton vient directement de Microsoft). Le
  résultat est gardé en mémoire et relu par « Vérifier à nouveau » ou après un refus.
- **Port `Mailer`** : le service des rapports ne connaît que `status()` et `send()`. Un serveur
  SMTP distinct (commentaire du PM du 2026-11-24) pourra le remplacer sans toucher au reste.
- **Réglages** : `reports.sqlite` (dossier de données, fichier 0600), une ligne : destinataires
  (20 au plus), fréquence, alerte, curseurs d'envoi et dernier envoi. Au premier enregistrement,
  rien n'est rattrapé : ni rapport échu, ni alerte d'un échec antérieur.
- **Planification** : un passage par minute. Rapport à 07:00 UTC, chaque jour ou le lundi
  (heure non réglable). Alerte groupée pour les exécutions en échec ou interrompues terminées
  depuis la dernière signalée (curseur sur l'heure de fin, pas sur l'identifiant donné au
  début). Un rapport ou une alerte refusé est retenté 15 minutes plus tard ; le curseur
  n'avance qu'après un envoi réussi.
- **Essai** : vers les adresses saisies, un toutes les 30 secondes au plus. Son résultat
  s'affiche sur place et ne remplace pas le « dernier envoi ».
- **Effacement** : vider la liste des destinataires reste possible sans permission `Mail.Send`.
- **Contenu** : nombre de plans à jour, en retard, en échec ; exécutions et échecs de la période ;
  volume et durée ; une ligne par plan (nom et état). Jamais un élément (boîte, compte, site), un
  nom de fichier, un objet de mail ni un code d'erreur.
- **Traçabilité** : actions d'audit `settings.update` et `report.test`, avec le nombre de
  destinataires, jamais les adresses. Un envoi en échec est inscrit comme « dernier envoi »,
  affiché dans Réglages et sur l'accueil, et journalisé avec son code seul.

## Conséquences

- L'application de la sauvegarde reçoit une permission d'écriture de plus (`Mail.Send`), qui
  reste facultative : sans elle, la sauvegarde fonctionne et les rapports sont désactivés.
- Les adresses des destinataires sont des données personnelles : elles restent dans le dossier
  de données et ne sortent que vers Microsoft 365, comme destinataires du rapport.
- Tant que Microsoft refuse, un essai part toutes les 15 minutes et chaque refus est journalisé
  avec son code : l'échec reste visible jusqu'au premier envoi réussi.
- Le volume du rapport est la taille de la dernière sauvegarde réussie de chaque élément sur la
  période, pas la somme des exécutions.
