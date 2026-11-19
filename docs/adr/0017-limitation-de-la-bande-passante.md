# ADR 0017 : limiter la bande passante des sauvegardes

Statut : **proposé** (issue #277)

## Contexte

Une PME ou une collectivité ne doit pas saturer sa connexion pendant la journée, surtout depuis un
NAS. L'issue demande de vérifier si le SDK d'Atlas, dans sa version épinglée (6.2.0), permet de
limiter le débit ou la concurrence, puis d'en tirer les conséquences.

## Vérification dans le SDK 6.2.0

Lecture de `dist/index.d.mts` et de `README.md` du paquet :

- `AtlasInstanceConfig` ne porte aucun réglage de débit ni de concurrence : identifiants, phrase
  secrète, paramètres du stockage S3 (`s3*`), `logger`, `onStorageRequest` (observateur, lecture seule) et
  `throttleCoordinator`.
- `throttleCoordinator` ne coordonne que les temps d'attente imposés par Microsoft Graph après un
  HTTP 429 (`wait` / `raise`). Il ne plafonne ni des octets par seconde ni un nombre de requêtes.
- Les options de sauvegarde (`OutlookBackupOptions`, `OneDriveSdkBackupOptions`,
  `SharePointSdkBackupOptions`) n'ont ni débit ni parallélisme (seulement des filtres : pages,
  dossiers, sous-sites, etc.) ; `SdkOperationOptions` n'ajoute que `onProgress` et `signal`. Ce
  `signal` permet d'interrompre une opération : il rendrait faisable de la stopper à l'entrée dans
  les heures ouvrées.
- `GRAPH_SERVICE_LIMITS` publie les plafonds de Microsoft (dont `max_concurrent_requests` pour
  Outlook) : ce sont des constantes informatives, pas un réglage.
- Le README demande de ne pas lancer deux opérations sur une même boîte, un même propriétaire
  OneDrive ou un même site, et de passer un `throttleCoordinator` si plusieurs processus se
  partagent un tenant. Le planificateur passe les éléments l'un après l'autre à chaque passage, et
  la base interdit deux exécutions simultanées sur un élément (ADR 0009) ; mais un lancement
  manuel s'exécutait en arrière-plan, en parallèle d'un passage : la concurrence n'était donc pas
  bornée par tenant. C'est un écart à part, résolu par #300 (voir la décision ci-dessous).

Conclusion : **le SDK ne permet pas de limiter le débit** ni la concurrence.

## Décision

- Aucun réglage « débit maximal en Mbit/s » n'est ajouté : il ne pourrait pas être appliqué, et
  afficher un réglage sans effet serait trompeur (comme la conservation, ADR 0009).
- Pas de limiteur de débit contourné autour du SDK : le principe 5 de la vision est de contribuer
  à Atlas. Une demande amont est rédigée dans `docs/upstream/limite-de-debit.md`, **non publiée** :
  le Product Manager décide de la publier.
- Repli « planifier hors heures ouvrées » : le Product Owner retient l'option 2 (2026-11-19) comme
  comportement par défaut prudent et réversible. Seuls les plans dont le RPO est de 24 h ou plus
  sont planifiés par défaut dans une fenêtre de nuit. Les plans à RPO plus court gardent leur
  rythme (RPO/2, ADR 0009), sans restriction. Le lancement manuel reste toujours possible. Aucun
  nouveau réglage, aucun objectif dégradé. Implémentation : #298.
- Fenêtre de nuit (#298) : **22 h – 6 h, heure locale du fuseau du serveur**, fixe. Un plan à
  RPO de 24 h ou plus a **deux passages par nuit** : le premier à 22 h plus un décalage propre au
  plan (0 à 3 h, dérivé de son identifiant comme en ADR 0009), le second 4 h plus tard, qui
  ne reprend que les éléments sans réussite depuis le premier (un élément réussi n'est pas
  sauvegardé deux fois). Hors fenêtre, un plan de nuit ne démarre rien : un plan créé de jour attend
  la nuit. Le plus long écart entre deux passages est ainsi de 21 h, y
  compris aux nuits de changement d'heure (l'écart entre deux nuits se mesure en temps réel, de
  23 à 25 h) : le RPO de 24 h est tenu. Les passages manqués ne sont pas rattrapés en journée.
  Seul le RPO de 24 h existe aujourd'hui (4, 12, 24 h) ; tout RPO plus long suivrait la même
  règle. La fiche du plan affiche « Sauvegarde planifiée la nuit (22 h – 6 h) » ; le lancement
  manuel reste possible à toute heure.
- Concurrence (#300) : **une seule sauvegarde à la fois par tenant**, manuelle ou planifiée. La
  console ne sert qu'un tenant : le planificateur tient une file unique en mémoire, et chaque
  exécution attend la fin de la précédente. Un lancement manuel demandé pendant une sauvegarde est
  mis en file : rien n'est ouvert en base avant son tour, donc il n'est ni un échec, ni une
  exécution « en cours », et l'état « en retard » du tableau de bord ne change pas. `POST
/api/plans/:id/run` répond `202 { started: 0, skipped: 0, queued: true }` et la liste des plans
  porte `queued` ; l'écran affiche « En attente de la sauvegarde en cours ». La file est en
  mémoire : un redémarrage la perd (le lancement est à refaire, rien n'est faussé).
- En attendant, la limitation de débit relève du réseau de l'utilisateur (QoS du routeur ou du
  NAS).

## Options reportées au Product Manager

Reportées dans #299, avec la question de faire entrer cette fonctionnalité dans le MVP :

1. Restreindre globalement les sauvegardes aux heures non ouvrées : cela obligerait à choisir
   entre la bande passante et le RPO, ce qui engage la promesse « objectifs » du produit.
2. Attendre la contribution amont et ne rien faire d'ici là.

La publication de la demande amont l'est aussi (#299).

## Conséquences

- Aucune dépendance ni code nouveau ; aucune valeur par défaut à fixer tant que la limite n'existe
  pas.
- Si Atlas accepte la demande amont, un nouvel ADR définira les réglages (heures ouvrées, débit en
  Mbit/s, valeurs par défaut prudentes) après la montée de version du SDK.
