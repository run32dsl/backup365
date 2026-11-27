# ADR 0024 : restaurer un mail vers la boîte d'un autre compte

Statut : **proposé** (issue #546)

## Contexte

Cas courant : un salarié est parti et son responsable a besoin de ses mails. La restauration d'un
mail (ADR 0012) ne visait que la boîte d'origine. Le SDK 7.2.0 (ADR 0019) accepte
`targetMailbox` dans `outlook.restore` : le message est recréé dans la boîte d'un autre compte,
dans un dossier nommé, sans toucher à l'existant. Le PM a redécoupé l'issue : ce premier pas ne
couvre qu'**un mail** ; OneDrive et l'export d'un dossier viendront dans des issues de suite.

## Décision

- **Même route, un champ de plus.** `POST /api/mails/:mailboxId/:messageId/restore` accepte
  `targetMailbox` (identifiant d'une boîte du catalogue). Sans ce champ, rien ne change.
- **Administrateurs seulement.** Un opérateur qui envoie `targetMailbox` reçoit 403
  `admin_required` (« Action réservée aux administrateurs. »), le refus est consigné
  (`access.denied`), rien n'est lancé. Dans l'interface, il ne voit pas le choix « La boîte d'un autre compte ».
- **Destination vérifiée par le serveur** : différente de la source (400 `target_same`), présente
  dans le catalogue (400 `target_unknown`, 503 `catalog_unavailable` s'il ne répond pas). Les noms
  affichés viennent du catalogue, jamais du client. Le catalogue liste les boîtes sauvegardées :
  c'est la preuve, sans Graph, que le compte a une boîte.
- **Dossier** : nouveau dossier `Restauré par backup365 jj/mm/aaaa` (date UTC du lancement) dans
  la boîte de destination, le même nom que pour la boîte d'origine (ADR 0012, issue #574), jamais
  d'écrasement. Pas de choix du dossier. La boîte source reste lisible au journal d'audit.
- **Audit** (qui, quoi, vers qui, motif, résultat), ressource `mail.restore`, cible
  `boîte source/message` comme ADR 0012 :
  - `restore.request` : motif `from=<source>;to=<destination>;reason=<motif>` ;
  - `restore.result` : `outcome=…;duration_ms=…;from=…;to=…;reason=<motif>`, `count` 1 ou 0.
    Le motif saisi reste le dernier champ. Le journal affiche « Restauration vers un autre compte ·
    de {source} vers {destination} » ; l'élément (objet du mail) est dans la colonne Cible, lu dans
    l'index comme pour toute restauration, jamais écrit dans le journal.
- **Interface** : la fenêtre « Restaurer » de la fiche propose, à un administrateur, « La boîte
  d'origine » (fenêtre de l'ADR 0012, inchangée) ou « La boîte d'un autre compte » (issue #626 :
  le même terme que la fiche, dont la rubrique s'intitule alors « Restaurer ») : trois étapes
  (`Steps` : Destination, Motif, Confirmation), puis le résultat. Même boîte « Restaurer ce mail »
  pour les deux rôles (issue #574) : même liste libellée (« Mail », « Boîte d'origine », « Boîte
  de destination », « Dossier d'origine », « Restauré dans le dossier ») à chaque étape et au
  résultat, bloc « Ce qui va se passer » au récapitulatif, « Annuler », « Précédent » et l'action
  principale sur une ligne, bouton court « Restaurer vers ce compte », bandeau « Mail restauré en
  … » au résultat. La recherche filtre la liste des
  boîtes (`GET /api/mailboxes`, déjà ouverte aux sessions) par nom ou adresse, sans casse ni
  accents ; le compte source y apparaît désactivé. Le code est dans `apps/web/src/transfer/`.
- Une restauration à la fois par mail, toutes destinations confondues (même clé que l'ADR 0012).

## Conséquences

- Le bouton de retour garde le libellé commun « Précédent » (ADR 0016), au lieu de « Retour » de
  la maquette.
- Le catalogue réel ne donne pas de nom d'affichage : les écrans montrent l'adresse des comptes.
- Dans la boîte de destination, le dossier ne nomme pas la source : un même nom de dossier pour
  les deux rôles (issue #574) a été préféré ; la source est dans le journal d'audit. Les mails
  restaurés le même jour depuis plusieurs boîtes arrivent donc dans le même dossier daté.
- Les issues de suite (fichier OneDrive, export d'un dossier) réutiliseront `transfer/`.

## Non vérifié

`outlook.restore` avec `targetMailbox` n'a jamais été appelé contre un vrai tenant (comme l'ADR
0012). **Essai réel à faire par l'agent tenant, sur un tenant de TEST uniquement** : restaurer un
mail vers un second compte de test, vérifier le dossier créé chez lui, l'absence de modification
du reste et les deux lignes d'audit.
