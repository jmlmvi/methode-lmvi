---
id: UC-DEV-01
titre: "Créer un projet neuf"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "socle-py-django new, archétype Maven, manifest.json, J2"
---

# UC-DEV-01 — Créer un projet neuf

## Questions auxquelles répond ce cas d'usage
1. Par quelle commande démarre-t-on une nouvelle application Socle ?
2. Quelles contraintes porte l'identifiant du projet ?
3. Que contient le projet à sa création, et qu'est-ce qui est déjà configuré ?
4. L'environnement virtuel et le dépôt Git sont-ils créés automatiquement ?
5. Que se passe-t-il si le dossier existe déjà ?
6. Comment créer un projet hors du dépôt du framework ?
7. Faut-il recopier un projet existant à la place ?

## Mots-clés
créer un projet, `socle-py-django new`, générateur, archétype Maven, identifiant,
`--dir`, `--no-venv`, `--no-git`, `.venv`, dépôt Git, `manifest.json`,
`SOCLE_SRC`, copier-coller, J2

## Ce que c'est, et quand s'en servir
Une commande qui pose un projet complet et cohérent : sources, configuration, manifeste de
déploiement, tests, outillage. C'est le point d'entrée de tout nouveau développement — et la
réponse à la tentation de recopier un projet voisin, qui traîne toujours des réglages d'un autre
contexte.

## Ce que le socle fait · ce qu'il interdit
`socle-py-django new <app-id>` écrit les fichiers, **crée l'environnement virtuel** (framework et
application installés) et **initialise le dépôt Git** avec le chemin des hooks, donc le hook de
pré-commit est actif immédiatement. Les options permettent de s'en passer.

L'identifiant est contraint (minuscules, chiffres, tirets, de 2 à 41 caractères) et le paquet Python
en découle. Un dossier existant est **refusé** : le générateur n'écrase jamais.

Il a besoin de savoir d'où réinstaller le framework, qui n'est publié sur aucun index : la variable
d'environnement dédiée, sinon les sources locales (UC-DEV-08).

## Exemples
### Créer
```bash
socle-py-django new mon-app                      # ici, avec .venv et dépôt Git
socle-py-django new mon-app --dir ~/projets      # ailleurs
socle-py-django new mon-app --no-venv --no-git   # fichiers seulement
```

### Ce que la commande répond
```
Projet mon-app créé dans /Users/…/mon-app (39 fichiers).

Prochaines étapes :
  cd /Users/…/mon-app
  make check     # revue des conventions + tests
  make run       # http://localhost:8080
```

### Les refus
```bash
socle-py-django new Mon_App     # Identifiant invalide « Mon_App » : minuscules, chiffres et tirets.
socle-py-django new mon-app     # Le dossier …/mon-app existe déjà.
```

### Socle Java
```bash
mvn archetype:generate -DarchetypeGroupId=eu.lmvi -DarchetypeArtifactId=socle-app-archetype
```

## Pièges courants
- **Recopier un projet existant** : on hérite de ses réglages, de ses secrets et de ses dettes.
- **Un identifiant avec une majuscule ou un souligné** : refusé, et pour une raison — le paquet
  Python en dérive.
- **Oublier que le dépôt Git est initialisé** : le premier commit passe par le hook, et c'est voulu.
- **Générer sans savoir d'où vient le framework** : l'environnement n'est pas créé, et le message
  le dit.

## Cas d'usage voisins
- UC-DEV-02 — obtenir un squelette complet en couches
- UC-DEV-08 — emporter le framework et sa doc hors du dépôt
- UC-INT-08 — déployer via le manifeste du Hub
- UC-DEV-03 — partir du bon modèle de worker
