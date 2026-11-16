# ADR 0008 : comptes locaux et sessions

Statut : **proposé** (issue #22, décisions du PO du 2026-11-14)

## Contexte

Jusqu'ici la console n'avait aucune authentification (ADR 0002, 0007) : tout accès au port lisait
les sauvegardes, et le journal d'audit (ADR 0004) consignait `anonymous`. Priorité 1 du PM : pouvoir
s'authentifier simplement. Le SSO Microsoft (OIDC Entra ID) viendra dans une issue séparée.

## Décision

- **Comptes** dans une base distincte, `accounts.sqlite` (dans `BACKUP365_DATA_DIR`, droits
  0700/0600, migrations versionnées comme les autres bases). Un compte : nom (unique sans tenir
  compte de la casse), rôle, empreinte du mot de passe, désactivé, « mot de passe à changer ».
- **Mots de passe** : `scrypt` de `node:crypto` (N = 2^16, r = 8, p = 1), sel aléatoire de 16 octets par
  compte, comparaison en temps constant, calcul asynchrone (la boucle d'événements n'est pas
  bloquée). L'empreinte `scrypt$N$r$p$sel$clé` porte ses paramètres : le coût pourra monter sans
  casser les comptes existants ; à la lecture ils sont bornés (une empreinte altérée ne peut pas
  réclamer une mémoire démesurée). 12 à 256 caractères. Aucune dépendance ajoutée.
- **Rôles** : `admin` (comptes, plans, restaurations) et `operator` (consultation, export,
  restauration avec motif). Seule la gestion des comptes est aujourd'hui réservée à
  l'administrateur ; les plans le sont depuis l'ADR 0009, la restauration d'un mail est ouverte
  aux deux rôles (ADR 0012).
- **Premier administrateur** : `POST /api/auth/setup`, publique, ne réussit que si aucun compte
  n'existe (une seule instruction SQL `INSERT … WHERE NOT EXISTS`, donc sans course) ; 409
  ensuite. `GET /api/auth/setup-status` indique si l'écran de création doit s'afficher. Aucun mot
  de passe par défaut ni variable d'environnement. La fenêtre d'exposition (avant ce premier
  appel) est documentée dans `docs/installation.md`.
- **Session** : jeton aléatoire de 256 bits dans le cookie `b365_session` (`HttpOnly`,
  `SameSite=Strict`, `Secure` si la requête arrive en HTTPS). Les sessions vivent en mémoire,
  indexées par le SHA-256 du jeton ; expiration après 8 h sans requête ; un redémarrage
  déconnecte tout le monde (choix le plus simple, acceptable pour une console d'administration).
  Rôle, activation et « mot de passe à changer » sont relus en base à chaque requête : désactiver
  un compte ou changer son rôle agit tout de suite. Réinitialiser un mot de passe ferme les
  sessions du compte.
- **CSRF** : chaque session porte un jeton distinct, rendu à la connexion et par `/api/auth/me`,
  exigé dans l'en-tête `x-csrf-token` pour toute méthode autre que `GET`, `HEAD`, `OPTIONS`
  (donc aussi `PATCH`), comparé en temps constant ; sinon 403. `SameSite=Strict` est la première
  défense, le jeton la seconde.
- **Garde** : un hook `onRequest` protège **toute** route dont le chemin commence par `/api`,
  y compris les routes inconnues et les chemins encodés (`/%61pi/…`) : 401 sans session. Seules
  `/api/health`, `/api/auth/login`, `/api/auth/setup` et `/api/auth/setup-status` sont publiques.
  Sans base des comptes (illisible), toute l'API hors santé répond 503 : jamais d'accès ouvert.
  Les pages de l'interface restent servies sans session ; elles ne contiennent aucune donnée.
- **Anti-force brute** : après 5 échecs consécutifs, temporisation de 30 s qui double à chaque
  échec suivant (15 min au plus), suivie **par compte** (nom en minuscules, existant ou non) et
  **par adresse IP**, réponse 429 avec `Retry-After`. Les compteurs sont en mémoire, oubliés
  après une heure sans échec, et bornés en taille. Le succès remet à zéro le compteur du compte,
  pas celui de l'IP. Un compte inconnu coûte autant de calcul qu'un compte connu, et la réponse
  est la même (401) pour mot de passe faux, compte inconnu ou compte désactivé.
- **Essais simultanés** : `scrypt` est asynchrone ; un essai en vol compte déjà dans le seuil, de
  sorte que 20 requêtes parallèles sur un compte n'en laissent passer que 5 (testé). Un second
  essai lancé pendant qu'un premier est en vol pour le même compte est refusé (429 « occupé »)
  sans poser de verrou : deux onglets qui valident en même temps peuvent donc en voir un refusé.
  C'est voulu, pour empêcher de contourner le seuil par le parallélisme.
- **Adresse IP** : `req.ip` du socket. Derrière un proxy, `BACKUP365_TRUST_PROXY` liste ses
  adresses IP ou CIDR : `X-Forwarded-For` et `-Proto` ne sont crus que s'ils viennent d'elles, et
  le client retenu est la première adresse non fiable de la chaîne. Défaut : aucun proxy. `true`
  et un nombre de sauts sont refusés (Fastify 5 ne vérifie alors pas le pair direct).
- **Audit** : nouvelles actions `auth.login`, `auth.login_failed`, `auth.logout`,
  `account.create`, `account.update` (vocabulaire de l'ADR 0004 étendu). L'acteur réel remplace
  `anonymous` dans toutes les entrées. Un échec de connexion consigne le nom saisi **seulement
  s'il désigne un compte** (sinon `anonymous`) : un mot de passe tapé dans le champ du nom ne
  doit pas finir au journal. Jamais de mot de passe. La connexion et la création du premier
  compte sont fail-closed comme les routes de données : sans journal, 503 et pas de session ;
  échecs et déconnexions sont consignés sans bloquer la réponse. La lecture du journal
  (`GET /api/audit`) est elle-même consignée (`list.view`, ressource `audit`), reprise de la
  décision du 2026-11-12.
- **Dernier administrateur** : le magasin refuse (409 `last_admin`), dans une transaction
  `BEGIN IMMEDIATE`, de désactiver ou rétrograder le dernier administrateur actif.
- **Réinitialisation par un administrateur** (issue #56) : `POST /api/accounts/:id/reset-password`
  prend un `reason` obligatoire (200 caractères au plus) et **aucun mot de passe**. Le serveur
  génère un mot de passe temporaire (16 caractères d'un alphabet sans ambiguïté, `randomInt`, soit
  environ 92 bits), le rend une seule fois dans la réponse (`Cache-Control: no-store`) et impose le
  changement à la connexion suivante. L'audit consigne `password_reset: <motif>`, jamais le mot de
  passe. Remplace l'ancienne route où l'administrateur choisissait le mot de passe.
- **Comptes créés par l'API** : mot de passe temporaire fixé par l'administrateur, à changer à la
  première connexion (comme après une réinitialisation) ; tant que ce n'est pas fait, seules
  `/api/auth/me`, `/logout` et `/password` répondent (403 `password_change_required` ailleurs).
- **Compte de test et dépannage** : commande locale
  `node apps/server/dist/admin.js create-admin --username <nom> --password-stdin` (mot de passe sur
  l'entrée standard, jamais en argument). Elle refuse un nom pris, journalise (acteur `cli`),
  et n'a aucune route HTTP équivalente ni variable d'environnement.

## Conséquences

- Toute l'interface passe par l'écran de connexion ; un 401 renvoie à cet écran.
- `accounts.sqlite` est à sauvegarder avec `audit.sqlite` (`docs/installation.md`). Sans elle,
  l'écran de premier démarrage réapparaît : à surveiller dans la procédure de restauration.
- Les sessions en mémoire interdisent plusieurs instances derrière un répartiteur ; la console
  est mono-processus (ADR 0007).
- La console parle HTTP : sans proxy HTTPS, le mot de passe circule en clair. Documenté ; le
  guide Synology reste « réseau local uniquement ».
- Pas de double authentification, de politique d'expiration de mot de passe ni de verrouillage
  définitif : hors périmètre, à décider avec le SSO Entra.
- Le verrou par compte permet à qui atteint le port de bloquer un compte, `admin` compris, pendant
  15 minutes au plus. Derrière un proxy non déclaré, une adresse partagée verrouille tout le monde.
- Le journal d'audit ne se purge pas : le passage en verrou n'est consigné qu'une fois par série
  de refus, les refus « occupé » jamais, pour qu'un client non authentifié ne le fasse pas grossir
  sans limite. Le changement de son propre mot de passe (`/api/auth/password`) compte ses échecs
  dans la même temporisation que la connexion (clé du compte) et les consigne avec la même borne.
- Pour les routes de gestion des comptes, l'événement d'audit est écrit **après** la
  modification : si l'écriture échoue, la réponse est 500 mais le changement est appliqué sans
  trace. Seules la connexion et le premier démarrage refusent sans journal avant d'ouvrir une
  session. À durcir (événement « tentative » avant) si le PM l'exige.
- Le CSRF couvre aussi `PATCH` (le PO citait `POST`/`PUT`/`DELETE`) : plus strict, sans risque.
- Le rôle `operator` peut lire le journal d'audit (consultation) : à restreindre si le PM le
  décide.
