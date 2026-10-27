---
id: UC-RUL-03
titre: "Écrire un évaluateur d'expression (JDM)"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "NodeEvaluatorRegistry, ZenExpressionEvaluator, cache de compilation"
---

# UC-RUL-03 — Écrire un évaluateur d'expression (JDM)

## Questions auxquelles répond ce cas d'usage
1. Quelle syntaxe d'expression est acceptée dans un modèle de décision ?
2. Comment ajouter un évaluateur pour un besoin particulier ?
3. Les expressions sont-elles compilées, ou interprétées à chaque appel ?
4. Comment une expression accède-t-elle aux champs du contexte ?
5. Quels risques de sécurité porte l'évaluation d'une expression fournie par un tiers ?
6. Dans les moteurs Python, faut-il évaluer des expressions de configuration ?

## Mots-clés
expression, évaluateur, `NodeEvaluatorRegistry`, `ZenExpressionEvaluator`, syntaxe,
compilation, cache, contexte, champs, `$.`, opérateurs, `in`, `not`, sécurité,
`eval` interdit, injection, hors périmètre

## Ce que c'est, et quand s'en servir
Les nœuds d'un modèle contiennent des expressions : comparaisons, opérateurs logiques,
appartenance à une liste, accès aux champs du contexte. Un registre d'évaluateurs décide qui sait
évaluer quoi, ce qui permet d'ajouter une syntaxe ou un domaine de fonctions.

Les expressions sont compilées puis mises en cache : une décision appelée des milliers de fois ne
recompile pas.

## Ce que le socle fait · ce qu'il interdit
Java : l'évaluateur traduit une syntaxe lisible vers son moteur d'expression, avec un cache de
compilation, et le registre permet d'en brancher d'autres.

Moteurs Python : **hors périmètre**, et il y a une raison de ne pas improviser. Évaluer une
expression fournie de l'extérieur avec les fonctions d'évaluation du langage revient à **exécuter du
code arbitraire** : lecture de fichiers, appels système, exfiltration. Si un besoin d'expression
configurable apparaît, il se traite par une grammaire fermée (un jeu d'opérateurs implémenté
explicitement), jamais par l'évaluation du langage hôte.

## Exemples
### Socle Java — la syntaxe d'expression
```
amount > 10000 and country == 'FR'
country in [FR, DE, IT]
not active
$.customer.score >= 700
```

### Moteurs Python — une grammaire fermée, pas une évaluation
```python
OPERATEURS = {">=": operator.ge, ">": operator.gt, "==": operator.eq, "<=": operator.le}

def evaluer(*, champ: str, operateur: str, valeur: Decimal, contexte: dict) -> bool:
    """Évaluer une condition déclarée en configuration, sans exécuter de code."""
    fonction = OPERATEURS.get(operateur)
    if fonction is None:
        raise PricingRuleViolation("UNKNOWN_OPERATOR", f"Opérateur {operateur} non reconnu")
    return fonction(contexte[champ], valeur)
```

### Ce qu'il ne faut jamais écrire
```python
if eval(condition, {}, contexte):      # exécution de code arbitraire
    ...
```

## Pièges courants
- **Évaluer du langage hôte** : exécution de code arbitraire, quelle que soit la prudence affichée.
- **Pas de cache** sur une expression évaluée en boucle : coût de compilation à chaque appel.
- **Une syntaxe maison non documentée** : personne ne sait ce qui est accepté.
- **Des expressions sans tests** : une décision critique dont le comportement n'est vérifié par
  rien.

## Cas d'usage voisins
- UC-RUL-02 — choisir le type de nœud adapté
- UC-RUL-09 — exécuter un script dynamique
- UC-RUL-07 — compiler du code à la volée
- UC-DOM-04 — porter les règles de gestion dans un service
