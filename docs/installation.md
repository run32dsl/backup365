# Installation avec compose

Une machine, une commande. Pour le dossier de validation avant des données réelles, voir
[mise-en-production.md](mise-en-production.md).

## Prérequis

- Docker avec le plugin Compose, ou Podman avec `podman compose`.
- Un stockage S3 (celui de l'organisation) **ou** le profil `minio` de ce dépôt, pour les essais.
- Un tenant Microsoft 365 et la phrase de chiffrement Atlas (14 octets au moins, conservée hors
  ligne : sa perte rend les sauvegardes illisibles).

## Lancement

```sh
cp .env.example .env            # renseigner BACKUP365_TENANT_ID et BACKUP365_S3_ENDPOINT
mkdir -m 700 secrets            # un fichier par secret, sans fin de ligne utile
for s in s3_access_key_id s3_secret_access_key encryption_passphrase; do
  read -rsp "$s : " v && printf '%s' "$v" > "secrets/$s" && echo   # hors historique du shell
done
# Phrase de chiffrement : console seule (uid 1000, utilisateur node). Secrets du stockage :
# lus aussi par MinIO (uid 65532), donc lisibles par tous ; le dossier en 700 les protège sur l'hôte.
sudo chown 1000:1000 secrets/encryption_passphrase && chmod 400 secrets/encryption_passphrase
chmod 444 secrets/s3_access_key_id secrets/s3_secret_access_key
docker compose up -d --build    # console seule
docker compose --profile minio up -d --build   # console + MinIO local
```

Avec MinIO : l'image est épinglée par digest dans `compose.yaml` (MinIO de Chainguard, la même
que celle des tests de bout en bout d'Atlas). Mettre `BACKUP365_S3_ENDPOINT=http://minio:9000`.
**Ne pas créer le bucket à la main** : Atlas crée `atlas-<tenant>` à la première sauvegarde,
avec Object Lock et versioning (un bucket créé par `mc mb` sans `--with-lock` ne peut plus être
rendu immuable). MinIO exige 3 caractères au moins pour l'identifiant et 8 pour le mot de
passe ; les deux premiers secrets sont alors l'identifiant et le mot de passe racine de MinIO.

## Variables d'environnement

| Variable                                                                                          | Rôle                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `BACKUP365_TENANT_ID`, `BACKUP365_S3_ENDPOINT`                                                    | tenant et URL du stockage S3 (obligatoires)          |
| `BACKUP365_S3_REGION`                                                                             | région S3 (`eu-west-3`)                              |
| `BACKUP365_S3_ACCESS_KEY_ID`, `BACKUP365_S3_SECRET_ACCESS_KEY`, `BACKUP365_ENCRYPTION_PASSPHRASE` | secrets, **fournis par fichier** : variante `…_FILE` |
| `BACKUP365_STATUS_MAX_AGE_HOURS`, `BACKUP365_STATUS_WORKLOADS`                                    | tableau de bord : seuil d'alerte (26 h), charges     |
| `BACKUP365_CATALOG_CACHE_MINUTES`                                                                 | cache du recensement des sites SharePoint (60 min)   |
| `BACKUP365_INDEX_INTERVAL_MINUTES`                                                                | intervalle d'indexation de la recherche (60 min)     |
| `BACKUP365_PORT`, `LOG_LEVEL`                                                                     | port publié sur 127.0.0.1 (3000), journal (`info`)   |
| `BACKUP365_DATA_DIR`, `BACKUP365_WEB_DIR`                                                         | fixés par l'image (`/data`, `/app/web`)              |

Un secret se donne soit en variable, soit par `<NOM>_FILE` (chemin d'un fichier monté), jamais les
deux. `compose.yaml` utilise les fichiers de `./secrets/` montés dans `/run/secrets/`.

## Premier accès

Ouvrir <http://127.0.0.1:3000>. `GET /api/health` doit répondre `ok`. **La console n'a pas
d'authentification** : le port n'est publié que sur la machine elle-même. Pour un accès distant,
passer par un tunnel SSH ou un proxy inverse qui authentifie.

## Sauvegarde de la base SQLite

Le volume `console-data` (`/data`) contient `audit.sqlite` (journal d'audit, **à sauvegarder**) et
`search.sqlite` (index de recherche, reconstructible). Copie à chaud, cohérente :

```sh
docker compose exec console rm -f /data/audit.backup.sqlite
docker compose exec console node -e "new (require('node:sqlite').DatabaseSync)('/data/audit.sqlite').exec('VACUUM INTO \'/data/audit.backup.sqlite\'')"
docker compose cp console:/data/audit.backup.sqlite ./audit.backup.sqlite
docker compose exec console rm /data/audit.backup.sqlite
```

Conserver la copie ailleurs que sur la machine, avec les mêmes droits d'accès que les
sauvegardes (elle contient des données personnelles). Intégrité du journal :
`docker compose exec console node dist/audit-verify.js`.
