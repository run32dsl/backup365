# Brouillon de demande amont : limite de débit et de concurrence

Destination : dépôt d'Atlas (`wisecom-oy/atlas`). **Non publié** : à publier par le Product Manager.

## Titre

SDK : permettre de plafonner le débit et la concurrence d'une opération

## Contexte

Nous intégrons `@wisecom/atlas-sdk` 7.2.0 dans une console web de sauvegarde pour petites
organisations, souvent exécutée sur un NAS derrière une connexion limitée. Elles ne veulent pas
saturer leur lien en journée. Dans 7.2.0 (vérifié, ADR 0019), `AtlasInstanceConfig` et les
options de sauvegarde (`outlook.backup`, `onedrive.backup`, `sharepoint.backup`) n'offrent ni
plafond de débit ni de parallélisme ; `throttleCoordinator` ne gère que les attentes après un
HTTP 429, et `teamsPacingShare` comme `concurrency` ne règlent que le rythme des appels Graph
de Teams.

## Demande

1. Un plafond de débit en octets par seconde, sur le téléchargement depuis Graph et sur l'envoi
   vers le stockage, au niveau de l'instance (`AtlasInstanceConfig`) et, si possible, par
   opération.
2. Un plafond de concurrence (requêtes ou fichiers simultanés) du même niveau.
3. Idéalement, un plafond modifiable en cours d'opération (par exemple une fonction `() => number`
   relue régulièrement), pour appliquer un débit différent selon l'heure sans interrompre la
   sauvegarde.

## Comportement attendu

Sans réglage, comportement actuel inchangé. Avec un plafond, l'opération ralentit sans échouer ni
produire de 429 supplémentaires ; la progression (`onProgress`) reste exacte.

## Alternative étudiée

Un limiteur placé autour du SDK ne voit pas les requêtes Graph ni les écritures S3. Côté hôte, il
ne reste qu'un proxy devant `s3Endpoint` ou une régulation du réseau (QoS), qui ne distingue pas
les sauvegardes du reste du trafic et ne couvre pas les téléchargements depuis Graph.
