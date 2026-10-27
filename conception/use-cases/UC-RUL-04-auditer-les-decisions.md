---
id: UC-RUL-04
titre: "Auditer et mettre en cache les décisions"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "JdmAuditService, table jdm_audit, cache de modèles"
---

# UC-RUL-04 — Auditer et mettre en cache les décisions

## Questions auxquelles répond ce cas d'usage
1. Comment prouver, six mois après, quelle décision a été appliquée à un dossier ?
2. Qu'est-ce qui est enregistré : les entrées, le modèle, la version, le résultat ?
3. Où ces traces sont-elles stockées, et combien de temps ?
4. Comment éviter de recharger un modèle à chaque évaluation ?
5. Comment le cache se rafraîchit-il quand le modèle change ?
6. Dans les moteurs Python, comment tracer une décision prise par un service ?

## Mots-clés
audit de décision, `JdmAuditService`, `jdm_audit`, traçabilité, preuve, conformité,
entrées, sorties, version du modèle, cache, invalidation, rechargement,
rétention, volumétrie, données personnelles, hors périmètre

## Ce que c'est, et quand s'en servir
Deux sujets qui vont ensemble. L'**audit** : garder la trace de chaque décision — ce qui entrait, quel
modèle dans quelle version, ce qui en est sorti — pour pouvoir l'expliquer plus tard. Le **cache** :
ne pas relire et recompiler le modèle à chaque appel.

L'audit n'est pas un luxe quand la décision a des conséquences : refus de dossier, tarif appliqué,
score attribué. « Pourquoi ce client a-t-il eu ce tarif en mars ? » est une question qui arrive
toujours.

## Ce que le socle fait · ce qu'il interdit
Java : un service d'audit écrit les décisions dans une table dédiée de la base technique, avec de
quoi les requêter, et le dépôt de modèles détecte les modifications pour invalider le cache.

Moteurs Python : **hors périmètre** pour le moteur, mais le besoin de traçabilité reste entier. Un
service de domaine qui prend une décision importante doit écrire sa trace lui-même — entrées
normalisées, version de la grille appliquée, résultat — par un événement (UC-DB-05) ou une table
métier.

Deux précautions : une trace de décision contient souvent des **données personnelles** (elle sert à
expliquer une décision sur une personne), donc elle relève d'une rétention et d'une protection
explicites ; et la volumétrie grossit vite, donc la purge se prévoit dès le départ (UC-DB-06).

## Exemples
### Socle Java — requêter l'audit
```sql
SELECT X_ID, MODEL_NAME, MODEL_VERSION, CAST(INPUTS AS VARCHAR(2048)) AS INPUTS,
       CAST(OUTPUTS AS VARCHAR(2048)) AS OUTPUTS
FROM JDM_AUDIT WHERE MODEL_NAME = 'tarification-v3' ORDER BY X_ID DESC LIMIT 20;
```

### Moteurs Python — tracer une décision de service
```python
# Dans le service : la décision, sa version de grille, ses entrées normalisées.
decision = PricingDecision(rate=rate, grid_version=grid.version,
                           amount_cents=request.amount_cents, country=request.country)
mutators.PricingDecisionMutator.record(tenant_context=tenant_context, decision=decision)
```

### Le cache, et son invalidation
```python
# Une grille lue une fois au démarrage se recharge par une action explicite, pas par magie.
@action("reload_pricing_grid", description="Recharge la grille de remise",
        required_scope="pricing.admin")
def reload_pricing_grid(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    self._grid = self._load_grid()
    return ActionResult.ok({"version": self._grid.version})
```

## Pièges courants
- **Tracer sans la version** de la grille ou du modèle : la trace n'explique rien, puisque la règle
  a changé depuis.
- **Un cache sans invalidation** : le modèle est modifié, l'instance applique l'ancien.
- **Aucune rétention** : la table d'audit devient la plus volumineuse de la base.
- **Oublier la nature des données** : une trace de décision est souvent une donnée personnelle.
- **Tracer le résultat seulement** : sans les entrées, impossible de rejouer.

## Cas d'usage voisins
- UC-RUL-01 — modéliser une décision en graphe
- UC-RUL-06 — tracer les règles déclenchées
- UC-DB-06 — purger selon une rétention
- UC-DB-05 — lire les événements récents
