---
id: UC-DEV-07
titre: "Mettre en place la CI"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "workflow CI, revue, tests, image, sources du framework"
---

# UC-DEV-07 — Mettre en place la CI

## Questions auxquelles répond ce cas d'usage
1. Que doit exécuter la CI d'une application Socle, et dans quel ordre ?
2. Comment la CI installe-t-elle le framework, qui n'est sur aucun index ?
3. Faut-il construire l'image à chaque fusion ?
4. Comment éviter de mettre un secret dans le fichier de CI ?
5. Le projet généré livre-t-il déjà un workflow ?
6. Comment la CI du framework diffère-t-elle de celle d'une application ?

## Mots-clés
CI, intégration continue, workflow, revue, tests, image, secret,
`SOCLE_INDEX_URL`, `SOCLE_GIT_URL`, `vendor/*.whl`, trois sources,
fusion, livraison, projet généré, conformité

## Ce que c'est, et quand s'en servir
Le pipeline qui empêche de livrer du code non conforme ou cassé : revue des conventions, tests,
puis construction de l'image. Le projet généré livre un workflow prêt à l'emploi.

La question propre à ce framework est son **installation** en CI, puisqu'il n'est publié sur aucun
index public. Le workflow livré documente trois sources possibles : la roue déposée dans le projet,
un index privé désigné par un secret, ou le dépôt désigné par une variable.

## Ce que le socle fait · ce qu'il interdit
Le projet généré pose le fichier de workflow, avec les trois sources commentées : on choisit celle
qui correspond à son organisation.

Côté secrets : un fichier de CI ne contient **jamais** de valeur, seulement des références au
gestionnaire de secrets de la plateforme d'intégration. Un secret écrit dans un fichier versionné
est compromis, même dans un dépôt privé.

Et l'ordre compte : la revue d'abord (elle coûte une seconde et attrape les fautes de structure),
puis les tests, puis l'image.

## Exemples
### Le workflow livré
```yaml
jobs:
  check:
    steps:
      - uses: actions/checkout@v4
      - run: make venv
      - run: make review        # conventions
      - run: make test
      - run: make vendor && docker build -t mon-app:${{ github.sha }} .
```

### Les trois sources du framework, documentées dans le workflow
```yaml
# 1. roue déposée dans le projet
- run: pip install vendor/*.whl
# 2. index privé (secret de la plateforme d'intégration)
- run: pip install --index-url ${{ secrets.SOCLE_INDEX_URL }} socle-py-django
# 3. dépôt (variable de la plateforme)
- run: pip install "git+${{ vars.SOCLE_GIT_URL }}"
```

### CI du framework — en plus, la conformité
```yaml
- run: .venv/bin/pytest -q
- run: python contracts/conformance/identity/idp.py serve &
- run: contracts/conformance/apps/python-django/run.sh &
- run: cd contracts/conformance && pytest -q
```

## Pièges courants
- **Un secret en clair** dans le fichier de workflow : compromis dès le premier commit.
- **Tests avant revue** : on attend trois minutes pour apprendre une faute de structure.
- **Construire l'image sans la roue** : échec en fin de pipeline, après tout le reste.
- **Une CI qui n'échoue jamais** : des étapes tolérantes aux erreurs ne protègent de rien.
- **Oublier la conformité** quand on touche au framework (UC-CTR-04).

## Cas d'usage voisins
- UC-DEV-04 — contrôler son code contre les conventions
- UC-DEV-06 — construire et lancer la pile Docker
- UC-CTR-04 — faire échouer la CI sur une régression
- UC-DEV-05 — bloquer un commit non conforme
