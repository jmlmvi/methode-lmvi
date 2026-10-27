---
id: UC-DEV-04
titre: "Contrôler son code contre les conventions"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: hors
  socle-py: hors
  socle-py-django: ok
contrat: "5.9"
mecanismes: "socle-py-django review, 16 règles, couche déduite du chemin, sortie 1"
---

# UC-DEV-04 — Contrôler son code contre les conventions

## Questions auxquelles répond ce cas d'usage
1. Comment vérifier que mon code respecte les conventions, sans relecture humaine ?
2. Quelles règles sont contrôlées, et où sont-elles écrites ?
3. Comment le contrôle sait-il à quelle couche appartient un fichier ?
4. Que renvoie la commande, et comment l'utiliser dans un hook ou en CI ?
5. Qu'est-ce qui n'est PAS contrôlé, et qu'il faut donc relire ?
6. Comment ajouter une règle ?
7. Le framework passe-t-il son propre contrôle ?

## Mots-clés
revue de code, `socle-py-django review`, 16 règles, `--rules`, conventions,
couche déduite du chemin, `ast`, sortie 1, hook, CI, exemple fautif,
C01 à C16, non contrôlé, ajouter une règle

## Ce que c'est, et quand s'en servir
Une convention que personne ne vérifie n'est pas une convention, c'est un souhait. La commande de
revue contrôle **16 règles** sur les sources : couches respectées, horloge et configuration hors du
domaine, accès à l'ORM cantonné, pas de concurrence à la main dans un worker, abonnements au bus à
l'initialisation, accès asynchrone correct à la base, délai sur les appels HTTP, un fichier une
classe, nommage des champs de date.

Elle sort en erreur à la première violation, donc elle s'utilise en hook de pré-commit et en CI.

## Ce que le socle fait · ce qu'il interdit
Le contrôle est statique (analyse syntaxique) et **déduit la couche du chemin** du fichier :
renommer un dossier de couche fait perdre les règles correspondantes (UC-DOM-02).

Le point qui donne confiance : **chaque règle a son exemple fautif** dans la suite de tests du
framework, et un test vérifie que toute règle déclarée possède cet exemple. Une règle muette
rassurerait à tort ; ici c'est mécaniquement impossible.

Ce qui n'est pas contrôlé — et qui reste à la relecture : la pertinence d'un nom, la justesse d'une
règle de gestion, la qualité d'un test, la cohérence d'un modèle. Le contrôle attrape les fautes de
structure, pas les erreurs de conception.

## Exemples
### Lancer
```bash
socle-py-django review src       # 16 règles ; sortie 1 à la première violation
socle-py-django review --rules   # la liste, avec la raison de chacune
make review                      # la cible du projet généré
```

### Ce que ça donne
```
revue des conventions — 20 fichier(s), 16 règles

0 violation — conforme.
```
```
src/mon_app/services/order_service.py:42  C03
appel à l'horloge dans la couche domaine : l'heure est fournie par l'interface

1 violation(s) : C03 × 1
```

### Le framework passe son propre contrôle
```bash
cd socle-py-django && .venv/bin/socle-py-django review src
# src/socle/techdb/models/log_buffer.py:15  C10
# log_timestamp est un DateTimeField : suffixe _at attendu
```
Une seule remarque, laissée visible : le nom reproduit une colonne du Socle Java, et le renommer
toucherait le contrat. C'est un arbitrage, pas un oubli.

## Pièges courants
- **Renommer un dossier de couche** : les règles cessent de s'appliquer, sans un mot.
- **Contourner une règle** plutôt que de corriger : la règle existe pour une raison écrite.
- **Croire le contrôle suffisant** : il ne juge pas la conception.
- **Ajouter une règle sans exemple fautif** : la suite de tests du framework échoue, et c'est voulu.

## Cas d'usage voisins
- UC-DEV-05 — bloquer un commit non conforme
- UC-DOM-02 — séparer les couches
- UC-DEV-07 — mettre en place la CI
- UC-RES-05 — imposer un délai à tout appel sortant
