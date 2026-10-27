---
id: UC-RUL-05
titre: "Exécuter un moteur de règles métier"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "RuleDefinition, Easy Rules, skip_on_first_applied, priorités"
---

# UC-RUL-05 — Exécuter un moteur de règles métier

## Questions auxquelles répond ce cas d'usage
1. Quelle différence entre un moteur de règles et un graphe de décision ?
2. Comment déclarer une règle : condition, action, priorité ?
3. Que se passe-t-il quand plusieurs règles s'appliquent — accumulation ou première servie ?
4. Comment ordonner des règles qui se recouvrent ?
5. Comment tester un jeu de règles qui grandit ?
6. Dans les moteurs Python, comment organiser beaucoup de règles sans moteur ?

## Mots-clés
moteur de règles, `RuleDefinition`, Easy Rules, condition, action, priorité,
`skip_on_first_applied`, `skip_on_first_failed`, accumulation, première règle,
jeu de règles, conflit, test, hors périmètre, service de domaine

## Ce que c'est, et quand s'en servir
Un moteur de règles évalue un **ensemble** de règles indépendantes contre un même fait : chacune a
sa condition, son action et sa priorité. Deux modes de résolution : accumuler tout ce qui
s'applique (toutes les remises applicables), ou s'arrêter à la première (priorité stricte).

C'est utile quand les règles sont nombreuses, ajoutées souvent, et écrites par plusieurs personnes.
Pour un domaine avec sept règles stables, le service de domaine (UC-DOM-04) reste plus clair : les
règles y sont nommées, testées une par une, et elles portent leur code de refus.

## Ce que le socle fait · ce qu'il interdit
Java : les règles sont déclarées en configuration, évaluées par le moteur avec la politique choisie,
et leur déclenchement est traçable (UC-RUL-06).

Moteurs Python : **hors périmètre**. Ce qu'on fait à la place, et qui tient très bien : un service
par domaine, une méthode par règle nommée, un code de refus par règle, et un test par règle. La
discipline du starter pack — sept règles nommées, chacune avec son code et son test — est
exactement ce modèle, sans moteur.

Le piège de fond, dans les deux approches, est le **recouvrement** : deux règles qui s'appliquent au
même cas et se contredisent. Un moteur le rend possible sans le signaler ; une liste de règles
nommées et ordonnées le rend visible.

## Exemples
### Socle Java — une règle déclarée
```yaml
rules:
  - name: remise-grand-compte
    priority: 10
    condition: "customer.segment == 'KEY_ACCOUNT' and amount > 10000"
    action: "discount = 0.05"
  skip_on_first_applied: true      # priorité stricte : une seule remise
```

### Moteurs Python — des règles nommées dans un service
```python
class OrderService:
    @staticmethod
    def create_order(*, tenant_context, request, limits) -> OrderView:
        # Chaque règle : un nom, un code, un test. L'ordre est explicite et relisible.
        if not request.reference.strip():
            raise OrderRuleViolation("REFERENCE_EMPTY", "La référence est obligatoire")
        if request.amount_cents <= 0:
            raise OrderRuleViolation("AMOUNT_NOT_POSITIVE", "Le montant doit être positif")
        if request.amount_cents > limits.max_amount_cents:
            raise OrderRuleViolation("AMOUNT_ABOVE_LIMIT", "Montant au-dessus du plafond")
        ...
```

### Un test par règle
```python
@pytest.mark.parametrize("montant,regle", [(0, "AMOUNT_NOT_POSITIVE"),
                                           (999_999, "AMOUNT_ABOVE_LIMIT")])
def test_chaque_regle_refuse_son_cas(db, montant, regle):
    with pytest.raises(services.OrderRuleViolation) as refus:
        services.OrderService.create_order(...)
    assert refus.value.rule == regle
```

## Pièges courants
- **Des règles qui se recouvrent** sans ordre explicite : le résultat dépend de l'implémentation.
- **Changer la politique de résolution** sur un jeu existant : des cas basculent silencieusement.
- **Aucun code de refus** : l'appelant reçoit un message, pas une information exploitable.
- **Un moteur pour cinq règles** : coût d'outillage sans bénéfice.
- **Des règles non testées une par une** : on découvre les conflits en production.

## Cas d'usage voisins
- UC-RUL-01 — modéliser une décision en graphe
- UC-RUL-06 — tracer les règles déclenchées
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-ACT-12 — distinguer un refus métier d'une panne
