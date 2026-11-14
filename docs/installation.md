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
```

Droits des secrets. Phrase de chiffrement : console seule (uid 1000, utilisateur `node` du
conteneur). Secrets du stockage : lus aussi par MinIO (uid 65532), donc lisibles par tous ; le
dossier en 700 les protège sur l'hôte. Régler les droits (`chmod`) **avant** de changer le
propriétaire (`chown`).

**Docker** (démon en root) :

```sh
chmod 400 secrets/encryption_passphrase
chmod 444 secrets/s3_access_key_id secrets/s3_secret_access_key
sudo chown 1000:1000 secrets/encryption_passphrase
```

**Podman sans root** : l'uid 1000 du conteneur n'est pas l'uid 1000 de l'hôte, et `sudo chown`
donnerait le fichier à un autre utilisateur. `podman unshare` entre dans l'espace de noms
utilisateur de Podman :

```sh
chmod 400 secrets/encryption_passphrase
chmod 444 secrets/s3_access_key_id secrets/s3_secret_access_key
podman unshare chown 1000:1000 secrets/encryption_passphrase
```

**SELinux** (Fedora, RHEL) : s'il est en mode `Enforcing` (`getenforce`), il refuse aux
conteneurs la lecture des fichiers secrets, et la console comme MinIO redémarrent en boucle
(`…_FILE illisible`, `Invalid credentials`). Étiqueter le dossier :
`chcon -R -t container_file_t secrets` (à refaire si le dossier est recréé ou restauré). Après
`podman unshare chown`, le fichier appartient à un autre uid côté hôte : le relire demande
`podman unshare cat`.

Puis :

```sh
docker compose up -d --build    # console seule
docker compose --profile minio up -d --build   # console + MinIO local
```

Avec Podman, remplacer `docker compose` par `podman compose`.

Avec MinIO : l'image est épinglée par digest dans `compose.yaml` (MinIO de Chainguard, la même
que celle des tests de bout en bout d'Atlas). Mettre `BACKUP365_S3_ENDPOINT=http://minio:9000`.
**Ne pas créer le bucket à la main** : Atlas crée `atlas-<tenant>` à la première sauvegarde,
avec Object Lock et versioning (un bucket créé par `mc mb` sans `--with-lock` ne peut plus être
rendu immuable). MinIO exige 3 caractères au moins pour l'identifiant et 8 pour le mot de
passe ; les deux premiers secrets sont alors l'identifiant et le mot de passe racine de MinIO.

## Variables d'environnement

| Variable                                                                                          | Rôle                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `BACKUP365_TENANT_ID`, `BACKUP365_S3_ENDPOINT`                                                    | tenant et URL du stockage S3 (obligatoires)                                               |
| `BACKUP365_S3_REGION`                                                                             | région S3 (`eu-west-3`)                                                                   |
| `BACKUP365_S3_ACCESS_KEY_ID`, `BACKUP365_S3_SECRET_ACCESS_KEY`, `BACKUP365_ENCRYPTION_PASSPHRASE` | secrets, **fournis par fichier** : variante `…_FILE`                                      |
| `BACKUP365_STATUS_MAX_AGE_HOURS`, `BACKUP365_STATUS_WORKLOADS`                                    | tableau de bord : seuil d'alerte (26 h), charges                                          |
| `BACKUP365_CATALOG_CACHE_MINUTES`                                                                 | cache du recensement des sites SharePoint (60 min)                                        |
| `BACKUP365_INDEX_INTERVAL_MINUTES`                                                                | intervalle d'indexation de la recherche (60 min)                                          |
| `BACKUP365_AUDIT_ANCHOR_DIR`, `BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN`                               | ancres du journal d'audit : dossier (`/anchors` dans `compose.yaml`), intervalle (60 min) |
| `BACKUP365_TRUST_PROXY`                                                                           | adresse(s) du proxy inverse HTTPS devant la console (`false` par défaut, voir ci-dessous) |
| `BACKUP365_PORT`, `LOG_LEVEL`                                                                     | port publié sur 127.0.0.1 (3000), journal (`info`)                                        |
| `BACKUP365_DATA_DIR`, `BACKUP365_WEB_DIR`                                                         | fixés par l'image (`/data`, `/app/web`)                                                   |

Un secret se donne soit en variable, soit par `<NOM>_FILE` (chemin d'un fichier monté), jamais les
deux. `compose.yaml` utilise les fichiers de `./secrets/` montés dans `/run/secrets/`.

## Premier accès

Ouvrir <http://127.0.0.1:3000>. `GET /api/health` doit répondre `ok`. Tant qu'aucune
sauvegarde n'a créé le bucket, le catalogue répond 503 avec le code `no_backup_found`, et
l'interface affiche « Aucune sauvegarde trouvée : lancez une première sauvegarde Atlas » ;
`/api/health` reste 200.

### Premier démarrage : créer l'administrateur

Au premier accès, tant qu'aucun compte n'existe, la console affiche l'écran **« Créer le compte
administrateur »** : choisir un nom d'utilisateur (3 à 64 caractères : lettres, chiffres,
`. _ @ -`) et un mot de passe de 12 caractères au minimum. Il n'y a ni mot de passe par défaut,
ni variable d'environnement pour en donner un. Le compte créé est administrateur et connecté
aussitôt ; l'écran n'est plus jamais proposé (la route répond 409 dès qu'un compte existe).

Faire cette étape **avant** d'ouvrir la console à d'autres personnes : tant qu'elle n'est pas
faite, la première personne qui atteint le port crée l'administrateur. Le port n'est publié que
sur 127.0.0.1 par défaut.

Ensuite, toute l'API sauf `/api/health` exige une session. Deux rôles : **administrateur**
(comptes ; plans et restaurations viendront avec leurs écrans) et **opérateur** (consultation, export, restauration avec
motif). L'administrateur crée, désactive et change le rôle des comptes dans l'écran « Comptes »
(`#/accounts`) ; il ne peut pas désactiver ni rétrograder le dernier administrateur actif. Un mot
de passe provisoire (création ou réinitialisation) est à changer à la connexion suivante.

La session tient dans un cookie `b365_session` (`HttpOnly`, `SameSite=Strict`, et `Secure` quand
la requête arrive en HTTPS) et expire après 8 heures sans activité ; un redémarrage de la console
déconnecte tout le monde. Après 5 échecs de connexion, une temporisation croissante (30 s, puis le
double à chaque échec, 15 min au plus) s'applique par compte et par adresse IP.

**Accès distant.** La console ne parle qu'en HTTP : le mot de passe circule en clair sans HTTPS.
Pour un accès autre que local, placer devant elle un proxy inverse HTTPS que vous maîtrisez, et
fixer `BACKUP365_TRUST_PROXY` à l'adresse IP (ou plage CIDR, séparées par des virgules) **de ce
proxy tel que la console le voit** (par exemple la passerelle du réseau Docker, `172.18.0.1`) pour
que `X-Forwarded-Proto` (cookie `Secure`) et `X-Forwarded-For` (anti-force brute par adresse) soient
crus. Ces en-têtes ne le sont que s'ils viennent de cette adresse, et l'adresse cliente retenue est
la première non fiable de la chaîne : un client ne peut pas choisir la sienne. `true` et un nombre
de sauts sont refusés. **Sans cette variable derrière un proxy**, tous les clients partagent
l'adresse du proxy : cinq échecs de n'importe qui temporisent alors tout le monde (le verrou par
compte reste exact).

Limite connue : le verrou par compte permet à qui atteint le port de bloquer un compte
(15 minutes au plus) en multipliant les échecs. C'est le prix d'une protection sans liste d'adresses ;
la parade est de ne pas exposer le port.

**Perte du mot de passe administrateur.** Créer un autre administrateur en ligne de commande
(ci-dessous), puis réinitialiser l'ancien depuis l'écran « Comptes ».

### Créer un compte en ligne de commande (tests de bout en bout, dépannage)

Commande locale, sans route HTTP, qui lit `BACKUP365_DATA_DIR` et le mot de passe **sur
l'entrée standard** (jamais en argument) :

```sh
printf '%s' "$MOT_DE_PASSE" | docker compose exec -T console \
  node dist/admin.js create-admin --username e2e-admin --password-stdin
```

Hors conteneur : `node apps/server/dist/admin.js create-admin --username <nom> --password-stdin`
(après `pnpm run build`). Code de sortie 0 : compte créé (administrateur, sans changement de mot
de passe imposé) ; 1 : nom déjà pris (casse ignorée), nom ou mot de passe refusé ; 2 : usage ou
base illisible ; 3 : compte créé mais événement d'audit non écrit. La création est consignée
(acteur `cli`). Le test de bout en bout de l'hôte (`e2e-produit`) l'appelle avec un nom propre au
test, puis se connecte par `POST /api/auth/login` (`{"username","password"}` → cookie
`b365_session` et `{"csrfToken","user"}`) et joint `x-csrf-token` à ses requêtes `POST`, `PUT`
et `DELETE`. Il n'existe aucune variable d'environnement ni route HTTP ouverte pour créer un
compte de test.

## Sauvegarde de la base SQLite

Le volume `console-data` (`/data`) contient `audit.sqlite` (journal d'audit, **à sauvegarder**),
`accounts.sqlite` (comptes locaux et empreintes de mots de passe, **à sauvegarder** : sans elle,
l'écran de premier démarrage réapparaît) et `search.sqlite` (index de recherche, reconstructible).
Copie à chaud, cohérente, du journal (même commande pour `accounts.sqlite`) :

```sh
docker compose exec console rm -f /data/audit.backup.sqlite
docker compose exec console node -e "new (require('node:sqlite').DatabaseSync)('/data/audit.sqlite').exec('VACUUM INTO \'/data/audit.backup.sqlite\'')"
docker compose cp console:/data/audit.backup.sqlite ./audit.backup.sqlite
docker compose exec console rm /data/audit.backup.sqlite
```

Conserver la copie ailleurs que sur la machine, avec les mêmes droits d'accès que les
sauvegardes (elle contient des données personnelles). Intégrité du journal :
`docker compose exec console node dist/audit-verify.js`.

## Ancrage du journal d'audit

Sans copie de sa tête hors de la base, la chaîne du journal ne détecte ni la troncature de fin ni
une réécriture complète (ADR 0004). La console écrit donc une ancre signée (`{seq, headHash, at}`)
dans `audit-anchors.jsonl`, en ajout seul, toutes les `BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN`
minutes si la tête a changé, et à l'arrêt propre. Le volume `console-anchors` (`/anchors`) doit
être **distinct** de `console-data` et, en production, résider sur un autre stockage : remplacer
le volume nommé par un montage vers un partage à instantanés immuables. Sinon l'ancre protège
moins qu'elle ne le laisse croire. Sans `BACKUP365_AUDIT_ANCHOR_DIR`, ou s'il est égal à
`BACKUP365_DATA_DIR` ou contenu dedans, le démarrage journalise un avertissement et
`GET /api/status` indique « ancrage du journal : non configuré ». `audit-verify` contrôle alors
aussi les ancres (code 1 en cas d'écart).
