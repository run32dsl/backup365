# ADR 0015 : connexion avec un compte Microsoft (OIDC Entra ID)

Statut : **proposé** (issue #54, décision du PM du 2026-11-14 : `node:crypto`, sans dépendance)

## Contexte

Les comptes locaux (ADR 0008) restent le secours. Le PM veut aussi que les agents de l'organisation
se connectent avec leur compte Microsoft, sans mot de passe de plus à gérer. Le tenant est connu
(un seul) et les droits se donnent par groupe Entra. Aucune dépendance n'est admise : le code
d'autorisation, PKCE et la vérification RS256 se font avec `node:crypto` et le `fetch` de Node.

## Décision

- **Flux** : code d'autorisation + PKCE (S256), `response_mode=query`, portée `openid profile`.
  `GET /api/auth/oidc/login` crée `state`, `nonce` et le vérificateur PKCE (aléatoires, 256 bits
  ou plus, **en mémoire**, 10 min, 1000 au plus, usage unique), et redirige vers Entra.
  `GET /api/auth/oidc/callback` échange le code (avec le secret de l'application), vérifie le
  jeton d'identité, ouvre la session de l'ADR 0008 et redirige vers `/`. Toute erreur redirige vers
  `/?oidc_error=<code>` ; l'interface lit le code, l'affiche et le retire de l'adresse.
- **Liaison au navigateur** : le `state` est aussi posé dans le cookie `b365_oidc` (`HttpOnly`,
  `SameSite=Lax` car le retour est une navigation depuis un autre site, `Secure` en HTTPS, limité à
  `/api/auth/oidc`). Un retour dont le cookie diffère du `state` est refusé **avant tout appel
  réseau** et sans consommer l'état (contre la connexion forcée par un lien forgé).
- **Jeton** : `alg` imposé à `RS256` (ni `none`, ni HS256), `kid` cherché dans le JWKS du tenant
  (`/discovery/v2.0/keys`, en cache 1 h, relu au plus une fois par minute pour un `kid` inconnu :
  un jeton forgé ne fait pas appeler Microsoft à chaque requête), clé RSA de 2048 bits au moins,
  signature `RSA-SHA256`. Contrôlés : `iss` = `https://login.microsoftonline.com/<tenant>/v2.0`
  exactement, `aud` = identifiant de l'application, `exp` (tolérance de 60 s), `nbf`, `nonce`.
  Pas de découverte `.well-known` : les adresses sont dérivées du tenant, donc fixes et non
  modifiables par une réponse réseau. Réponses lues à 1 Mo au plus, délai de 10 s.
- **Rôle par groupe** : `BACKUP365_OIDC_ADMIN_GROUPS` et `BACKUP365_OIDC_OPERATOR_GROUPS` listent
  des identifiants d'objet de groupes Entra (GUID) ; la revendication `groups` du jeton est
  comparée. Le rôle le plus fort l'emporte. **Aucun groupe reconnu : connexion refusée**, sans
  rôle par défaut. Au moins une liste est exigée. Si l'utilisateur appartient à plus de
  200 groupes, Entra remplace `groups` par un renvoi (« overage ») : la console ne le suit pas
  (ce serait un appel Graph de plus) ; la connexion est alors refusée. Parade documentée :
  n'émettre que les groupes affectés à l'application.
- **Comptes** : à la première connexion un compte est créé dans `accounts.sqlite` (migration 2 :
  colonne `oidc_subject`, identifiant d'objet `oid` du jeton, sinon `sub`), sans mot de passe
  (empreinte vide : aucun mot de passe ne correspond, et la réponse de `/api/auth/login` reste la
  même 401 qu'un compte inconnu). Le nom est `preferred_username` (UPN). Le rôle est **relu des
  groupes à chaque connexion**. Conséquences :
  - un nom déjà pris par un compte **local** est refusé (`account_conflict`), jamais fusionné :
    un compte local ne peut pas être repris par un nom venu d'Entra ;
  - un compte désactivé par un administrateur reste refusé ; l'administrateur peut le désactiver
    (les sessions se ferment) mais **ne peut ni changer son rôle ni lui réinitialiser un mot de
    passe** (409 `managed_by_oidc`) : le rôle vient d'Entra, et un mot de passe local serait une
    seconde porte ;
  - un utilisateur dont le groupe est retiré perd ses sessions ouvertes à sa connexion refusée, pas
    avant : sa session d'une durée de 8 h au plus ne s'interrompt pas d'elle-même. La parade
    immédiate est de désactiver le compte ;
  - le dernier administrateur actif garde son rôle même si ses groupes disent autre chose (l'ADR
    0008 interdit une console sans administrateur) ;
  - un retrait du compte Entra n'est pas vu avant sa prochaine connexion (pas de
    rafraîchissement : la session locale de l'ADR 0008 ne dépend pas de Microsoft).
- **Désactivée par défaut** : sans variable `BACKUP365_OIDC_*`, `/api/auth/oidc/status` répond
  `{ enabled: false }`, les deux autres routes 404 et le bouton n'apparaît pas. Une configuration
  partielle (ou une adresse de retour qui n'est pas `https://…/api/auth/oidc/callback`, `http`
  seulement pour `localhost`) arrête le démarrage, en nommant les variables.
  `BACKUP365_OIDC_CLIENT_SECRET` accepte la variante `_FILE`. Le secret n'est ni journalisé, ni
  renvoyé, ni stocké.
- **Audit** : succès `auth.login` (raison `oidc`). Refus d'une **identité vérifiée** (signature
  comprise) : `auth.login_failed` de raison `oidc_no_group`, `oidc_disabled` ou
  `oidc_account_conflict`, acteur = nom Entra vérifié. Les échecs sans identité vérifiée (état
  inconnu, code refusé, jeton invalide) ne sont pas consignés (journal d'avertissement
  seulement) : le journal ne se purge pas et ces appels sont publics. Comme la connexion locale,
  l'ouverture de session est fail-closed : sans journal, pas de session.
- **Mode démo** : un fournisseur simulé en mémoire (`oidc-simulated.ts`, clé RSA générée au
  lancement) remplace Entra ; son « écran Microsoft » est la route de démonstration
  `/api/auth/oidc/demo-authorize`, qui n'existe qu'en démo. Il sert aussi aux tests, qui
  n'appellent aucun réseau.

## Conséquences

- Premier flux qui sort de la console : la console doit être joignable par le navigateur à
  l'adresse de retour déclarée (HTTPS derrière un proxy, `BACKUP365_TRUST_PROXY`).
- `GET /api/auth/oidc/callback` appelle Microsoft (échange du code, JWKS) pour des requêtes
  publiques : seules celles dont l'état et le cookie concordent y parviennent, et la table des
  états est bornée. Pas de temporisation propre aux échecs (hors périmètre).
- `GET /api/auth/oidc/login` est public : au-delà de 1000 connexions en attente, les plus anciennes
  sont évincées (un flot d'appels peut donc interrompre des connexions en cours, sans rien
  ouvrir). Le nom Entra n'est pas mis à jour s'il change, et l'acteur d'un refus nominatif est un
  `preferred_username` que l'utilisateur peut parfois modifier lui-même : l'identifiant d'objet
  fait foi pour le compte, pas le nom.
- Les sessions restent en mémoire (ADR 0008) : le SSO ne les change pas.
- SAML : hors périmètre, à décider plus tard.
- Pas de déconnexion unique (single logout) : se déconnecter de la console ne ferme pas la session
  Microsoft du navigateur.
- À valider par le PM sur le tenant de test (inscription : `docs/installation.md`) : aucune
  vérification n'a été faite contre un vrai Entra ID, seulement contre le fournisseur simulé.
