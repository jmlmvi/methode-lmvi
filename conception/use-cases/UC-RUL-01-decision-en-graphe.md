---
id: UC-RUL-01
titre: "Modéliser une décision en graphe (JDM)"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "JdmEngine, JdmExecutor, JdmRepository, modèle JSON"
---

# UC-RUL-01 — Modéliser une décision en graphe (JDM)

## Questions auxquelles répond ce cas d'usage
1. Comment exprimer une décision métier complexe sans la coder en dur ?
2. Qu'est-ce qu'un modèle de décision, et sous quelle forme est-il stocké ?
3. Qui peut modifier une décision — un développeur, ou un responsable métier ?
4. Comment une décision est-elle exécutée, et avec quelles entrées ?
5. Peut-on changer une décision sans redéployer l'application ?
6. Dans les moteurs Python, ce moteur existe-t-il ?
7. Par quoi remplacer un graphe de décision quand il n'est pas disponible ?

## Mots-clés
JDM, modèle de décision, graphe, nœuds, `JdmEngine`, `JdmExecutor`, `JdmRepository`,
JSON, contexte, résultat, décision métier, sans redéploiement, table de décision,
hors périmètre, service de domaine

## Ce que c'est, et quand s'en servir
Un modèle de décision décrit, sous forme de graphe de nœuds, comment on passe d'entrées à des
sorties : conditions, expressions, tables de décision, branchements. Le modèle est une donnée
(du JSON), pas du code — donc il se modifie sans livraison, et il se relit par un non-développeur.

C'est pertinent quand la décision est **volumineuse et changeante** : tarification, éligibilité,
scoring, routage. Pour trois conditions stables, un service de domaine est plus simple et plus
sûr (UC-DOM-04).

## Ce que le socle fait · ce qu'il interdit
Java : le moteur charge les modèles depuis un dépôt, les exécute avec un contexte, rend un résultat
structuré, et trace les décisions (UC-RUL-04).

Moteurs Python : **hors périmètre déclaré**. La réponse n'est pas d'écrire un mini-moteur maison —
c'est la pire des solutions, puisqu'on hérite de la complexité sans l'outillage ni l'audit. Deux
options honnêtes : porter la décision dans un service de domaine (quelques règles nommées, testées,
avec leurs codes de refus), ou appeler le backend Java qui porte le moteur, en appel protégé
(UC-WRK-10).

## Exemples
### Socle Java — exécuter une décision
```java
JdmContext context = JdmContext.of(Map.of("amount", 12000, "country", "FR"));
JdmResult result = jdmExecutor.execute("tarification-v3", context);
BigDecimal remise = result.get("remise", BigDecimal.class);
```

### Moteurs Python — la même décision, dans un service
```python
class PricingService:
    @staticmethod
    def discount(*, request: PricingRequest, grid: DiscountGrid) -> Decimal:
        """Appliquer la grille de remise ; la grille vient de la configuration, pas du code."""
        for palier in grid.tiers:                 # la grille est une donnée, les règles du code
            if request.amount_cents >= palier.from_cents:
                return palier.rate
        return Decimal("0")
```

## Pièges courants
- **Écrire un moteur de décision maison** en Python : complexité du moteur, sans son audit ni son
  cache.
- **Mettre du graphe là où trois `if` suffisent** : on paie l'outillage pour rien.
- **Un modèle sans version** : impossible de savoir quelle décision a été appliquée hier.
- **Confondre donnée et règle** : une grille de valeurs est une donnée (configurable) ; la façon de
  l'appliquer est une règle (du code, testé).

## Cas d'usage voisins
- UC-RUL-02 — choisir le type de nœud adapté
- UC-RUL-04 — auditer et mettre en cache les décisions
- UC-RUL-05 — exécuter un moteur de règles métier
- UC-DOM-04 — porter les règles de gestion dans un service
