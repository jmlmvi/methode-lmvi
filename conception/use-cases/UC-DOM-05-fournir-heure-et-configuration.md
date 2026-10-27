---
id: UC-DOM-05
titre: "Fournir l'heure et la configuration au domaine"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "horloge dans l'interface, confirmed_at=, OrderLimits, C03, C05"
---

# UC-DOM-05 — Fournir l'heure et la configuration au domaine

## Questions auxquelles répond ce cas d'usage
1. Pourquoi un service n'a-t-il pas le droit de lire l'heure courante ?
2. Comment tester une règle qui dépend d'une date d'échéance ?
3. Qui lit la configuration, et à quel moment ?
4. Comment passer un plafond configurable à une règle sans que le service connaisse la configuration ?
5. Faut-il relire la configuration à chaque appel ?
6. Comment la revue de code repère-t-elle une horloge mal placée ?
7. Que faire quand plusieurs horodatages sont nécessaires dans le même appel ?

## Mots-clés
horloge, `datetime.now`, `timezone.now`, heure courante, injection de l'heure, `confirmed_at=`,
`generated_at=`, configuration, `SocleConfig`, lue une fois, plafond, limites,
testable, déterminisme, C03, C05, revue de code

## Ce que c'est, et quand s'en servir
Deux dépendances à l'environnement que le domaine ne doit pas aller chercher : **l'heure** et la
**configuration**. C'est la couche interface qui les lit et les passe en paramètre.

La raison est la testabilité, et elle se vérifie tout de suite : une règle qui lit l'horloge
demande de manipuler le temps pour être testée ; la même règle qui reçoit un horodatage se teste
avec une valeur choisie. Idem pour un plafond : reçu en paramètre, il se teste à toutes les
valeurs intéressantes.

## Ce que le socle fait · ce qu'il interdit
La revue de code refuse un appel à l'horloge et une lecture de configuration dans les couches du
domaine (règles C03 et C05). C'est l'un des contrôles les plus utiles du lot, parce que ces deux
dépendances se glissent naturellement là où elles ne devraient pas.

La configuration se lit **une fois**, au démarrage du worker, et se range dans un échange
(UC-DOM-03). La relire à chaque appel coûte, et surtout fait dépendre une règle d'un état qui peut
changer entre deux appels.

## Exemples
### L'interface lit, le domaine reçoit
```python
class OrdersWorker(Worker, ActionProvider):
    def __init__(self, techdb: TechDb, config: SocleConfig):
        self.techdb = techdb
        # Configuration lue UNE fois, rangée dans un échange immuable.
        self.limits = exchanges.OrderLimits(
            max_amount_cents=config.raw.as_int("app.orders.max-amount-cents", 100_000),
            max_outstanding_cents=config.raw.as_int("app.orders.max-outstanding-cents", 500_000))

    @action("confirm_order", description="Confirme une commande du tenant")
    @param("reference", required=True, min_length=1, max_length=40)
    def confirm_order(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
        # L'heure est lue ICI, dans l'interface, et passée au domaine.
        confirmed_at = datetime.now(timezone.utc)
        view = self.techdb.run(lambda: services.OrderService.confirm_order(
            tenant_context=ctx, reference=params["reference"],
            limits=self.limits, confirmed_at=confirmed_at))
        return ActionResult.ok(view.as_json())
```

### Le service ne connaît ni l'heure ni la configuration
```python
@staticmethod
def confirm_order(*, tenant_context, reference: str, limits: OrderLimits, confirmed_at) -> OrderView:
    ...
    order.set_confirmed(confirmed_at=confirmed_at)
```

### Ce que ça donne en test
```python
instant = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)      # heure choisie
view = services.OrderService.confirm_order(tenant_context=ctx, reference="C-1",
                                           limits=limites, confirmed_at=instant)
assert view.confirmed_at == instant
```

### Socle Java
Même règle : l'horloge et la configuration sont lues par la vue ou le worker, puis passées au
service (`nowMs=`, `generatedAt=`).

## Pièges courants
- **Un appel à l'horloge « juste pour journaliser »** dans un service : la revue le refuse, et la
  frontière s'effrite.
- **Relire la configuration à chaque appel** : une règle dont le plafond change en cours de route.
- **Passer l'horloge comme fonction** plutôt qu'une valeur : on réintroduit l'indéterminisme.
- **Plusieurs horodatages pris à des instants différents** dans un même appel : les données
  racontent une histoire incohérente. Lire une fois, passer la même valeur.
- **Une valeur par défaut dans le service** pour la configuration : le défaut doit être visible là
  où la configuration est lue.

## Cas d'usage voisins
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-DOM-03 — échanges immuables
- UC-CFG-04 — lire une clé de configuration typée
- UC-DEV-04 — contrôler son code contre les conventions
