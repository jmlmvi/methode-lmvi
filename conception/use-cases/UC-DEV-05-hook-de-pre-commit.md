---
id: UC-DEV-05
titre: "Bloquer un commit non conforme"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: hors
  socle-py: hors
  socle-py-django: ok
contrat: "5.9"
mecanismes: ".githooks/pre-commit, core.hooksPath, --no-verify"
---

# UC-DEV-05 — Bloquer un commit non conforme

## Questions auxquelles répond ce cas d'usage
1. Comment empêcher qu'un code non conforme entre dans le dépôt ?
2. Où vit le hook, et comment est-il activé ?
3. Que fait-il exactement, et combien de temps prend-il ?
4. Comment le contourner quand c'est légitime ?
5. Le hook suffit-il, ou faut-il aussi la CI ?
6. Comment l'activer sur un dépôt existant ?

## Mots-clés
hook, pré-commit, `.githooks/pre-commit`, `core.hooksPath`, blocage,
revue, tests, `--no-verify`, contournement, CI, activation,
dépôt existant, poste local, rapidité

## Ce que c'est, et quand s'en servir
Un hook de pré-commit qui joue la revue des conventions et les tests **avant** d'accepter un
commit. Il est livré dans le projet généré et **activé** par le générateur : le chemin des hooks est
configuré au moment de l'initialisation du dépôt.

L'intérêt par rapport à la seule CI est le moment : on apprend la violation en trente secondes, sur
son poste, pas dix minutes plus tard dans un pipeline.

## Ce que le socle fait · ce qu'il interdit
Le hook est versionné **dans le dépôt du projet** (et non dans le dossier interne de Git), donc il
suit le projet et profite à toute l'équipe. Le générateur pose le droit d'exécution — y compris
quand le fichier a voyagé dans une archive, où le bit peut se perdre.

Le contournement existe et c'est voulu : on peut commiter sans le hook. Mais la CI, elle, ne se
contourne pas (UC-DEV-07). Le hook est un confort rapide ; le filet de sécurité est en CI.

Un hook doit rester **rapide** : s'il prend plusieurs minutes, il sera contourné systématiquement, et
ne servira plus à rien.

## Exemples
### Ce que fait le hook
```bash
#!/usr/bin/env bash
set -e
.venv/bin/socle-py-django review src     # conventions : sortie 1 à la première violation
.venv/bin/pytest -q                      # tests
```

### L'activation, faite par le générateur
```bash
git config core.hooksPath .githooks
```

### Contourner, quand c'est justifié
```bash
git commit --no-verify -m "wip: brouillon partagé pour relecture"
```

### L'activer sur un dépôt existant
```bash
cp -R chemin/du/projet/genere/.githooks .
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
```

## Pièges courants
- **Un hook lent** : il sera contourné, donc inutile.
- **Un hook non exécutable** : Git l'ignore en silence (d'où le droit posé à la génération).
- **Croire le hook suffisant** : il est local et contournable ; la CI est le vrai filet.
- **Mettre le hook dans le dossier interne de Git** : il ne suit pas le dépôt, donc personne d'autre
  ne l'a.

## Cas d'usage voisins
- UC-DEV-04 — contrôler son code contre les conventions
- UC-DEV-07 — mettre en place la CI
- UC-DEV-01 — créer un projet neuf
- UC-CTR-04 — faire échouer la CI sur une régression
