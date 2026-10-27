---
id: UC-CTR-04
titre: "Faire échouer la CI sur une régression de contrat"
theme: "UC-CTR · Contrats et conformité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "intégration continue, conformité en CI, H4"
---

# UC-CTR-04 — Faire échouer la CI sur une régression de contrat

## Questions auxquelles répond ce cas d'usage
1. Comment empêcher une divergence de contrat d'arriver en production ?
2. Que doit exécuter la CI, et dans quel ordre ?
3. Comment démarrer les applications de conformité dans un environnement d'intégration ?
4. Faut-il jouer la suite à chaque fusion, ou seulement avant livraison ?
5. Que faire d'un test de conformité qui échoue de façon intermittente ?
6. Comment la CI d'une application métier diffère-t-elle de celle du framework ?

## Mots-clés
intégration continue, CI, échec, régression de contrat, suite de conformité,
fusion, livraison, applications de conformité, instabilité, test intermittent,
quarantaine, revue, pipeline, H4

## Ce que c'est, et quand s'en servir
La conformité n'a de valeur que si elle **bloque**. Jouée à la main, elle est oubliée le jour où
l'on est pressé — c'est-à-dire le jour où elle servirait. En CI, une divergence ne peut pas être
fusionnée.

Pour le framework : tests unitaires, puis suite de conformité croisée. Pour une application métier :
revue des conventions, tests, et construction de l'image.

## Ce que le socle fait · ce qu'il interdit
Le chantier exige la conformité en intégration continue : c'est une des US, pas une bonne pratique
optionnelle.

Ce qu'il faut éviter absolument : **désactiver** un test de conformité qui échoue. Un test de
conformité rouge signifie soit une divergence réelle (à corriger), soit un contrat à faire évoluer
(donc une décision à prendre, UC-CTR-05). Le mettre en commentaire fait disparaître l'information et
transforme la suite en décoration.

Un test **intermittent** est un cas particulier : il faut le traiter comme un défaut en soi (souvent
une dépendance au temps ou à l'ordre), pas l'ignorer.

## Exemples
### CI du framework
```yaml
- run: .venv/bin/pytest -q                                   # unitaires
- run: python contracts/conformance/identity/idp.py serve &  # fournisseur d'identité
- run: contracts/conformance/apps/python-django/run.sh &     # application de conformité
- run: cd contracts/conformance && pytest -q                 # la suite : 72 tests
```

### CI d'une application métier (ce que le projet généré livre)
```yaml
- run: make review        # conventions : sortie 1 à la première violation
- run: make test
- run: make vendor && docker build -t mon-app:${{ github.sha }} .
```

### Avant de livrer, en local
```bash
.venv/bin/pytest -q && contracts/conformance/gate.sh P-2
```

## Pièges courants
- **Désactiver un test rouge** : on supprime l'information, pas le problème.
- **Jouer la conformité seulement avant livraison** : la divergence a eu le temps de s'installer.
- **Oublier le fournisseur d'identité dans la CI** : échecs en bloc, et conclusion erronée.
- **Ne pas nettoyer les processus** entre deux exécutions : ports occupés, échecs aléatoires.
- **Tolérer un test intermittent** : il finit par masquer un vrai défaut.

## Cas d'usage voisins
- UC-CTR-02 — jouer la suite de conformité croisée
- UC-DEV-07 — mettre en place la CI
- UC-DEV-04 — contrôler son code contre les conventions
- UC-CTR-05 — faire évoluer un contrat dans les trois moteurs
