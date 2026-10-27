---
id: UC-RUL-02
titre: "Choisir le type de nœud adapté (JDM)"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "InputNode, ExpressionNode, DecisionNode, DecisionTableNode, SwitchNode"
---

# UC-RUL-02 — Choisir le type de nœud adapté (JDM)

## Questions auxquelles répond ce cas d'usage
1. Quels types de nœuds existent, et lequel choisir pour quel besoin ?
2. Comment exprimer une table de décision à plusieurs colonnes de conditions ?
3. Que se passe-t-il quand plusieurs règles d'une table correspondent ?
4. Comment écrire un branchement selon une valeur ?
5. Comment représenter un cas « toutes les autres valeurs » ?
6. Dans les moteurs Python, comment exprimer ces structures sans le moteur ?

## Mots-clés
nœud, `InputNode`, `OutputNode`, `ExpressionNode`, `FunctionNode`, `DecisionNode`,
`DecisionTableNode`, `SwitchNode`, table de décision, politique `FIRST`, `COLLECT`,
joker, wildcard, branchement, entrée, sortie, hors périmètre

## Ce que c'est, et quand s'en servir
Les briques d'un modèle de décision : les entrées et les sorties, une expression calculée, une
fonction, une décision simple, une **table** de décision à plusieurs conditions, un branchement.

La table est la brique la plus utile en pratique : des lignes de conditions, des colonnes de
sorties, et une politique qui dit quoi faire quand plusieurs lignes correspondent — prendre la
première, ou collecter toutes les réponses.

## Ce que le socle fait · ce qu'il interdit
Java : chaque type de nœud a son évaluateur, et la politique de résolution d'une table est
explicite. Le joker en cellule permet d'écrire le cas « peu importe », ce qui rend une table lisible.

Moteurs Python : **hors périmètre**. L'équivalent raisonnable d'une table de décision est une
**donnée de configuration** (une liste de paliers, une correspondance) appliquée par un service
testé : on garde la lisibilité de la table sans écrire un moteur.

Un point d'attention valable dans les deux cas : une table sans ligne par défaut laisse des cas non
couverts. Le comportement en l'absence de correspondance doit être écrit, pas découvert.

## Exemples
### Socle Java — une table de décision
```json
{
  "type": "decisionTable",
  "hitPolicy": "FIRST",
  "inputs": ["country", "amount"],
  "outputs": ["rate"],
  "rules": [
    {"country": "FR", "amount": "> 10000", "rate": 0.05},
    {"country": "FR", "amount": "-",       "rate": 0.02},
    {"country": "-",  "amount": "-",       "rate": 0.00}
  ]
}
```

### Moteurs Python — la table comme donnée, la règle comme code
```yaml
app:
  pricing:
    tiers:
      - {country: FR, from_cents: 10000, rate: "0.05"}
      - {country: FR, from_cents: 0,     rate: "0.02"}
      - {country: "*", from_cents: 0,    rate: "0.00"}   # le cas par défaut est ÉCRIT
```
```python
for tier in grid.tiers:                       # ordre explicite = politique « première ligne »
    if tier.matches(country=request.country, amount_cents=request.amount_cents):
        return tier.rate
raise PricingRuleViolation("NO_TIER", "Aucun palier applicable")   # jamais de silence
```

## Pièges courants
- **Pas de ligne par défaut** : un cas non couvert produit un comportement non spécifié.
- **Une table qui grossit sans fin** : au-delà de quelques dizaines de lignes, elle devient
  illisible ; il faut découper.
- **Changer la politique de résolution** sans relire les lignes : le résultat change pour des cas
  qu'on croyait stables.
- **Mettre du calcul complexe dans une cellule** : la table devient du code déguisé.

## Cas d'usage voisins
- UC-RUL-01 — modéliser une décision en graphe
- UC-RUL-03 — écrire un évaluateur d'expression
- UC-RUL-05 — exécuter un moteur de règles métier
- UC-CFG-04 — lire une clé typée
