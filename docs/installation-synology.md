# Installer une démo sur un NAS Synology

> **⚠️ Réseau local uniquement.** La console n'a pas d'authentification (issue #22) : toute
> personne qui l'atteint lit les sauvegardes. Tant que #22 n'est pas livré :
>
> - ne **pas** rediriger de port sur la box (ni NAT, ni UPnP) ;
> - ne **pas** la placer derrière un proxy inverse public (ni celui de DSM, ni un domaine public) ;
> - ne publier le port que sur l'adresse LAN du NAS, jamais sur `0.0.0.0`.

Ce guide vise DSM 7 avec Container Manager. Hors périmètre : paquet `.spk`, HTTPS.

## Ce que fait la démo

La démo **lit** des sauvegardes Atlas déjà présentes sur un stockage S3 accessible depuis le NAS.
Elle ne lance **aucune** sauvegarde : Atlas doit en avoir déjà fait. Sans bucket, la console
répond `no_backup_found` (voir [installation.md](installation.md)).

## Prérequis

- DSM 7 avec Container Manager, NAS `x86_64` (l'image est publiée en `linux/amd64`).
- Un accès SSH au NAS (une commande : droits du dossier de données).
- L'endpoint S3, les clés d'accès et la phrase de chiffrement Atlas.
- Une adresse IP fixe du NAS sur le réseau local (ici `192.168.1.10`, à remplacer).

## Pas à pas

1. **Dossier partagé.** Dans File Station, créer `docker/backup365/data` (volume `/volume1`).
   Copier dans `docker/backup365` les fichiers `compose.yaml` et `.env.example` de
   [`deploy/synology/`](../deploy/synology/).
2. **Droits.** La console tourne en uid 1000 et doit pouvoir écrire dans `data` :
   `sudo chown 1000:1000 /volume1/docker/backup365/data` (en SSH).
   Créer de même le dossier des ancres du journal d'audit sur **un autre volume ou partage**
   (`/volume2/backup365-anchors`, à activer en instantanés immuables si DSM le permet) et lui
   donner le même propriétaire : `sudo chown 1000:1000 /volume2/backup365-anchors`.
   Il se renseigne dans `BACKUP365_ANCHOR_PATH` du `.env` (étape 3) : le projet refuse de
   démarrer sans lui. Un dossier sur le même volume que les données protège peu.
3. **Fichier `.env`.** Renommer `.env.example` en `.env` et renseigner :
   - `BACKUP365_BIND_ADDRESS` : l'adresse LAN du NAS (`192.168.1.10`) ;
   - `BACKUP365_IMAGE_DIGEST` : le digest de l'image, relevé à l'étape 4 ;
   - `BACKUP365_TENANT_ID` ;
   - `BACKUP365_S3_ENDPOINT` (`http://192.168.1.20:9000` par exemple),
     `BACKUP365_S3_ACCESS_KEY_ID` et `BACKUP365_S3_SECRET_ACCESS_KEY` ;
   - `BACKUP365_ENCRYPTION_PASSPHRASE` : la phrase Atlas, conservée aussi hors ligne.

   Le `.env` contient des secrets : il n'est pas versionné et seul son propriétaire doit le lire
   (`chmod 600`). Ne jamais le copier dans le dépôt ni dans un ticket.

4. **Digest de l'image.** Relever le digest de l'image voulue, soit sur la page du paquet
   `backup365` de ghcr.io, soit avec
   `docker buildx imagetools inspect ghcr.io/run32dsl/backup365:develop`, puis le coller dans
   `BACKUP365_IMAGE_DIGEST` du `.env` (`sha256:` suivi de 64 caractères hexadécimaux).
   Sans lui, le projet refuse de démarrer avec un message explicite.
   Si le paquet GHCR est privé : `docker login ghcr.io` avec un jeton `read:packages`.
5. **Projet.** Container Manager › Projet › Créer : nom `backup365`, chemin
   `/volume1/docker/backup365`, source « utiliser le `compose.yaml` existant ». Ne pas activer
   le portail web (proxy inverse DSM). Valider : le projet démarre.
6. **Vérification.** Depuis un poste du réseau local :

   ```sh
   curl http://192.168.1.10:3000/api/health   # réponse HTTP 200
   ```

   Puis ouvrir `http://192.168.1.10:3000`. Si le projet redémarre en boucle, lire son journal
   (Container Manager › Projet › Journal) : droits de `data`, `.env` incomplet.

## Vérifier que rien n'est exposé

Le port ne doit répondre que sur l'adresse LAN. Depuis le NAS, `ss -ltn | grep 3000` doit montrer
`192.168.1.10:3000`, pas `0.0.0.0:3000`. Vérifier aussi que la box n'a aucune redirection de port
vers le NAS.

## Mise à jour

Relever le nouveau digest (étape 4), le remplacer dans `BACKUP365_IMAGE_DIGEST` du `.env`, puis Container Manager › Projet ›
Action › Construire (ou arrêter puis démarrer le projet). Les données (`data`) sont conservées.
