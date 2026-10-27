---
id: UC-DEV-08
titre: "Emporter le framework et sa doc hors du dépôt"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: hors
  socle-py: hors
  socle-py-django: ok
contrat: "5.9"
mecanismes: "packaging/build.sh, archive versionnée, SOCLE_SRC, roue"
---

# UC-DEV-08 — Emporter le framework et sa doc hors du dépôt

## Questions auxquelles répond ce cas d'usage
1. Comment démarrer une application Socle sur une machine qui n'a pas le dépôt ?
2. Que contient l'archive, et combien pèse-t-elle ?
3. Comment le projet généré sait-il où réinstaller le framework ensuite ?
4. Où l'archive est-elle déposée, et peut-on choisir le dossier ?
5. Faut-il un accès réseau chez le destinataire ?
6. Comment vérifier qu'une archive fonctionne avant de l'envoyer ?
7. Comment produire l'archive d'une nouvelle version ?

## Mots-clés
archive, starter pack, `packaging/build.sh`, roue, `.whl`, `SOCLE_SRC`,
`creer-application.sh`, documentation embarquée, PDF de conventions,
exemplaire déroulé, hors du dépôt, dossier de sortie, réseau

## Ce que c'est, et quand s'en servir
Le framework n'étant publié sur aucun index, une archive autonome permet de démarrer une application
**hors du dépôt** : la roue (qui embarque le gabarit du starter pack), un script de génération,
l'ensemble de la documentation utile au développeur, et un exemplaire déjà déroulé qu'on peut lire
sans rien installer.

## Ce que le socle fait · ce qu'il interdit
Le script de construction ne touche pas au dépôt : il travaille dans un dossier temporaire et dépose
seulement l'archive finale dans le dossier de sortie. Le dépôt de sources n'est pas un entrepôt de
livrables.

Point de conception à connaître : le projet généré doit savoir **d'où réinstaller le framework**
pour son environnement, sa roue vendue à l'image Docker et sa CI. La variable dédiée le dit, et le
fichier de commandes du projet généré la garde. Déplacer la roue sans corriger cette variable casse
les commandes du projet.

La construction de l'archive **déroule l'exemplaire avec la roue elle-même** : si la roue ne sait pas
générer un projet hors du dépôt, l'archive ne se construit pas. C'est la vérification intégrée.

## Exemples
### Produire l'archive
```bash
packaging/build.sh                      # → ~/Downloads/socle-py-django-starterpack-0.1.0.zip
packaging/build.sh /Volumes/cle         # → ce dossier (ou OUT=…)
```

### Chez le destinataire
```bash
unzip socle-py-django-starterpack-0.1.0.zip
cd socle-py-django-starterpack-0.1.0
./creer-application.sh mon-app          # → mon-app/, avec .venv et dépôt Git
cd mon-app && make check
```

### Sans le script
```bash
python3.12 -m venv .outillage
.outillage/bin/pip install socle_py_django-0.1.0-py3-none-any.whl
SOCLE_SRC="$PWD/socle_py_django-0.1.0-py3-none-any.whl" \
  .outillage/bin/socle-py-django new mon-app --dir ~/projets
```

### Ce que contient l'archive
```
LISEZ-MOI.md  creer-application.sh  socle_py_django-<version>-py3-none-any.whl
exemple-genere/mon-app/        un projet déroulé, à lire
docs/institutional/            les fiches de référence, avec leur index
docs/agent-guide/  docs/templates/  docs/use-cases/  docs/conventions/   (PDF du commanditaire)
```

## Pièges courants
- **Déplacer la roue** sans corriger la variable dans le fichier de commandes du projet : plus
  d'installation possible.
- **Croire l'archive totalement hors réseau** : le framework vient de la roue, mais ses dépendances
  s'installent depuis le réseau.
- **Déposer l'archive dans le dépôt** : ce n'est pas un entrepôt de livrables.
- **Envoyer une archive sans l'avoir dépliée** une fois : la construction vérifie la génération, pas
  votre envoi.

## Cas d'usage voisins
- UC-DEV-01 — créer un projet neuf
- UC-DEV-02 — obtenir un squelette complet en couches
- UC-DEV-06 — construire et lancer la pile Docker
- UC-CFG-01 — configurer par fichier
