---
id: UC-DOM-03
titre: "Faire franchir la frontière par des échanges immuables"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: na
  socle-py: na
  socle-py-django: ok
contrat: "5.9"
mecanismes: "exchanges/, dataclass frozen, as_json, pas de dépendance Django"
---

# UC-DOM-03 — Faire franchir la frontière par des échanges immuables

## Questions auxquelles répond ce cas d'usage
1. Qu'est-ce qu'un échange, et pourquoi ne pas passer directement un modèle ?
2. Que contient le dossier des échanges, et qu'est-ce qui n'y a pas le droit d'entrer ?
3. Comment un service peut-il être testable sans base, grâce aux échanges ?
4. Qui transforme un échange en JSON — le service ou l'interface ?
5. Pourquoi des objets gelés plutôt que des dictionnaires ?
6. Comment passer la configuration et l'heure au domaine par un échange ?
7. Faut-il un échange pour chaque appel, même trivial ?

## Mots-clés
échange, `exchanges/`, `@dataclass(frozen=True)`, immuable, gelé, frontière,
interface ↔ domaine, entrée, sortie, `as_json`, pas de dépendance Django,
découplage, testable sans base, DTO, vue de sortie, `OrderRequest`, `OrderView`

## Ce que c'est, et quand s'en servir
Les échanges sont les objets qui **traversent la frontière** entre l'interface et le domaine : ce
que l'appelant demande, ce que l'interface impose au domaine, ce que le domaine rend. Ils sont
immuables et ne dépendent de rien — ni des modèles, ni de l'ORM.

C'est une convention locale du squelette, pas des documents du commanditaire, et elle a deux effets
immédiats : un service se teste sans base et sans serveur, et l'interface n'a jamais besoin de
connaître un modèle.

Quatre rôles typiques : une demande en entrée, des limites ou paramètres fournis par l'interface,
une vue d'un objet en sortie, un agrégat de sortie.

## Ce que le socle fait · ce qu'il interdit
Rien dans le socle ne l'impose : c'est la revue de code qui tient la règle, et le projet généré qui
en donne l'exemple. Le contrôle vérifie notamment que la couche des échanges **n'importe pas
Django** — une dépendance là, et la promesse de testabilité est perdue.

Interdits : un échange mutable (on ne sait plus qui l'a modifié), un échange qui contient un
modèle (le couplage revient par la fenêtre), une sérialisation faite dans le service (la forme de
sortie appartient à l'interface, via la méthode de l'échange).

## Exemples
### Entrée
```python
# src/mon_app/orders/exchanges/order_request.py
@dataclass(frozen=True)
class OrderRequest:
    reference: str
    amount_cents: int
```

### Ce que l'interface fournit au domaine
```python
# src/mon_app/orders/exchanges/order_limits.py
@dataclass(frozen=True)
class OrderLimits:
    max_amount_cents: int
    max_outstanding_cents: int
```

### Sortie, et sa forme JSON
```python
# src/mon_app/orders/exchanges/order_view.py
@dataclass(frozen=True)
class OrderView:
    id: int
    reference: str
    status: str
    amount_cents: int
    confirmed_at: datetime | None

    def as_json(self) -> dict[str, Any]:
        # Les valeurs nulles de premier niveau sont retirées par le contrat : un champ absent
        # n'est pas un champ à null.
        return {"id": self.id, "reference": self.reference, "status": self.status,
                "amount_cents": self.amount_cents,
                "confirmed_at": self.confirmed_at.isoformat() if self.confirmed_at else None}
```

### Le service ne voit que des échanges
```python
def create_order(*, tenant_context, request: OrderRequest, limits: OrderLimits) -> OrderView:
    ...
```
```python
# et le test n'a besoin de rien d'autre
view = OrderService.create_order(tenant_context=ctx, request=OrderRequest("C-1", 1200),
                                 limits=OrderLimits(100_000, 500_000))
```

## Pièges courants
- **Rendre un modèle depuis un service** : l'interface se met à lire des attributs d'ORM, et la
  couche d'accès fuit vers le haut.
- **Un dictionnaire au lieu d'un échange** : plus de type, plus de champ documenté, et des fautes
  de frappe silencieuses.
- **Un échange mutable** : deux appels, deux états, et un bogue impossible à situer.
- **Importer Django dans un échange** : le contrôle le refuse, et pour une bonne raison.
- **Multiplier les échanges pour un paramètre unique** : un entier reste un entier.

## Cas d'usage voisins
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-DOM-05 — fournir l'heure et la configuration au domaine
- UC-DOM-02 — séparer les couches
- UC-ACT-01 — déclarer une action
