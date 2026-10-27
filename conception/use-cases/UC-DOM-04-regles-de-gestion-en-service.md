---
id: UC-DOM-04
titre: "Porter les règles de gestion dans un service"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "services/, exception dédiée, code de règle, arguments nommés"
---

# UC-DOM-04 — Porter les règles de gestion dans un service

## Questions auxquelles répond ce cas d'usage
1. Où écrit-on « le montant ne peut pas dépasser le plafond du client » ?
2. Comment un service signale-t-il un refus, puisqu'il ne connaît pas REST ni MCP ?
3. Comment tester une règle sans démarrer l'application ?
4. Le service doit-il revérifier ce que l'action a déjà validé ?
5. Qui ouvre la transaction, et jusqu'où va-t-elle ?
6. Un service peut-il appeler un autre service ?
7. Comment éviter que la même règle existe en deux endroits ?

## Mots-clés
service, domaine, règle de gestion, logique métier, `services/`, exception dédiée,
code de règle, `OrderRuleViolation`, refus typé, arguments nommés, testable, sans serveur,
sans horloge, transaction, orchestration, sélecteur, mutateur

## Ce que c'est, et quand s'en servir
Le service **est** le métier : il décide. Il orchestre les lectures et les écritures, applique les
règles, et lève une exception dédiée quand une règle est violée — avec le code de la règle, qui
remontera tel quel à l'appelant (UC-ACT-12).

C'est le seul endroit où les règles vivent. Dupliquées dans une action, elles divergent ; placées
dans un modèle, elles deviennent intestables ; mises dans un sélecteur, elles disparaissent de la
vue.

## Ce que le socle fait · ce qu'il interdit
Le socle ne connaît pas vos services : il appelle votre interface, qui les appelle. En revanche la
revue de code protège leur pureté : pas d'accès à l'horloge, pas de lecture de configuration, pas
d'import de la couche interface.

Les signatures sont **à arguments nommés** : un service appelé depuis l'interface ne doit pas
pouvoir se tromper d'ordre de paramètres. Et le service ne fait pas une confiance aveugle à
l'interface : il normalise et vérifie ce dont il dépend, pour rester correct quand on l'appelle
depuis un test, un autre worker ou un script.

## Exemples
### Le service décide, et nomme ses refus
```python
class OrderRuleViolation(Exception):
    """Règle de gestion violée — le code remonte en errorType."""
    def __init__(self, rule: str, message: str):
        super().__init__(message)
        self.rule = rule


class OrderService:
    @staticmethod
    def create_order(*, tenant_context, request: OrderRequest, limits: OrderLimits) -> OrderView:
        reference = request.reference.strip()
        if not reference:                                   # le domaine vérifie lui-même
            raise OrderRuleViolation("REFERENCE_EMPTY", "La référence est obligatoire")
        if request.amount_cents <= 0:
            raise OrderRuleViolation("AMOUNT_NOT_POSITIVE", "Le montant doit être positif")
        if request.amount_cents > limits.max_amount_cents:
            raise OrderRuleViolation("AMOUNT_ABOVE_LIMIT",
                                     f"Montant {request.amount_cents} au-dessus du plafond "
                                     f"{limits.max_amount_cents}")
        try:
            order = mutators.OrderMutator.create(tenant_context=tenant_context,
                                                 reference=reference,
                                                 amount_cents=request.amount_cents)
        except db.IntegrityError as exc:                    # la base garantit, le service explique
            raise OrderRuleViolation("DUPLICATE_REFERENCE",
                                     f"Référence {reference} déjà utilisée") from exc
        return OrderView(id=order.x_id, reference=order.reference, status=order.status,
                         amount_cents=order.amount_cents, confirmed_at=None)
```

### Le tester, sans serveur ni horloge
```python
def test_le_montant_au_dessus_du_plafond_est_refuse(db):
    with pytest.raises(services.OrderRuleViolation) as refus:
        services.OrderService.create_order(tenant_context=ctx,
                                           request=exchanges.OrderRequest("C-1", 999_999),
                                           limits=exchanges.OrderLimits(100_000, 500_000))
    assert refus.value.rule == "AMOUNT_ABOVE_LIMIT"
```

### Socle Java
Même principe : le service porte la règle et lève une exception métier ; la vue ou le worker la
traduit.

## Pièges courants
- **Lire l'horloge ou la configuration** dans le service : la règle devient intestable et dépend de
  l'environnement. On les reçoit en paramètre (UC-DOM-05).
- **Rendre un modèle** : on couple l'interface à la base (UC-DOM-03).
- **Vérifier par relecture ce que la base garantit** (« la référence existe-t-elle déjà ? ») : sous
  concurrence, c'est faux. On laisse la contrainte parler et on convertit son refus.
- **Un code de règle instable** ou absent : l'appelant ne peut rien en faire.
- **Un service qui fait tout** : plusieurs domaines mélangés, et plus personne n'ose y toucher.

## Cas d'usage voisins
- UC-DOM-03 — échanges immuables
- UC-DOM-05 — fournir l'heure et la configuration au domaine
- UC-ACT-12 — distinguer un refus métier d'une panne
- UC-DOM-06 — porter l'intégrité par des contraintes en base
