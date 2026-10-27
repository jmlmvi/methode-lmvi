---
id: UC-DOM-01
titre: "Modéliser une entité métier avec l'ORM Django"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: na
  socle-py: na
  socle-py-django: ok
contrat: "5.9"
mecanismes: "models/, un modèle par fichier, fabrique new(), TextChoices, Meta"
---

# UC-DOM-01 — Modéliser une entité métier avec l'ORM Django

## Questions auxquelles répond ce cas d'usage
1. Où placer mes modèles, et combien par fichier ?
2. Comment nommer la table, et pourquoi le préfixe compte-t-il ?
3. Comment crée-t-on une instance, si le constructeur et l'enregistrement sont interdits ailleurs ?
4. Quelles règles de nommage s'appliquent aux champs de date et aux méthodes ?
5. Pourquoi ne pas déclarer un tri par défaut sur le modèle ?
6. Un champ à valeurs fermées : énumération, contrainte, ou simple chaîne ?
7. Qu'est-ce qui n'a RIEN à faire dans un modèle ?

## Mots-clés
modèle, ORM Django, `models/`, un fichier une classe, `db_table`, préfixe `x_`,
fabrique, `Model.new`, `set_…`, `get_…`, `TextChoices`, majuscules, `_at`, `_date`,
pas de `Meta.ordering`, `x_created_at`, audit, couche données, `__str__`

## Ce que c'est, et quand s'en servir
La couche la plus basse : les champs, la table, les contraintes, et rien d'autre. Un modèle par
fichier, dans le paquet des modèles, réexporté par le paquet pour que l'ORM le découvre.

Les conventions du commanditaire sont précises ici, et elles ont toutes la même intention : qu'on
puisse lire un modèle sans se demander ce qu'il fait d'autre. Pas de règle de gestion, pas d'appel
réseau, pas de requête dans une propriété.

## Ce que le socle fait · ce qu'il interdit
Le socle configure l'ORM, applique les migrations et fournit l'accès hors de la boucle
d'événements. Les conventions, elles, sont vérifiées par la revue de code (UC-DEV-04) : nommage des
champs de date, absence de tri par défaut, écriture réservée aux couches d'accès, une classe par
fichier.

Les interdits les plus structurants : **jamais** de constructeur de modèle, d'enregistrement ni de
création directe hors du modèle — on passe par une fabrique nommée, qui prend ses arguments par
nom ; les mises à jour de masse vont dans un jeu de requêtes dédié (UC-DOM-07) ; l'intégrité est
portée par des contraintes en base (UC-DOM-06), pas par du code d'enregistrement.

## Exemples
### Le modèle
```python
# src/mon_app/orders/models/order.py — un seul modèle dans ce fichier
class Order(models.Model):
    x_id = models.BigAutoField(primary_key=True)
    x_partition = models.CharField(max_length=30)
    # Champ d'audit : jamais utilisé par la logique applicative.
    x_created_at = models.DateTimeField(db_default=functions.Now(), db_column="x_datecreated")
    reference = models.CharField(max_length=40)
    status = models.CharField(max_length=10, choices=OrderStatus.choices, default=OrderStatus.DRAFT)
    amount_cents = models.PositiveIntegerField()
    confirmed_at = models.DateTimeField(null=True)      # DateTimeField → suffixe _at

    objects = models.Manager.from_queryset(OrderQuerySet)()

    class Meta:
        db_table = "x_orders"
        # Pas de ``ordering`` : chaque lecture trie explicitement, départagée par la clé.
        constraints = [
            models.UniqueConstraint(fields=["x_partition", "reference"], name="uq_orders_reference"),
            models.CheckConstraint(condition=models.Q(amount_cents__gt=0),
                                   name="ck_orders_amount_positive"),
        ]

    def __str__(self) -> str:
        return f"#{self.x_id} order {self.x_partition}/{self.reference} {self.status}"

    @classmethod
    def new(cls, *, partition: str, reference: str, amount_cents: int) -> "Order":
        """Créer une commande au brouillon — seule porte de création."""
        return cls.objects.create(x_partition=partition, reference=reference,
                                  amount_cents=amount_cents)

    def set_confirmed(self, *, confirmed_at) -> None:
        self.status = OrderStatus.CONFIRMED
        self.confirmed_at = confirmed_at
        self.save(update_fields=["status", "confirmed_at"])
```

### Les valeurs fermées
```python
# src/mon_app/orders/models/order_status.py
class OrderStatus(models.TextChoices):
    DRAFT = "DRAFT", "Brouillon"          # valeurs stockées EN MAJUSCULES
    CONFIRMED = "CONFIRMED", "Confirmée"
    CANCELLED = "CANCELLED", "Annulée"
```

### Le paquet réexporte
```python
# src/mon_app/orders/models/__init__.py
from .order import Order
from .order_queryset import OrderQuerySet
from .order_status import OrderStatus
```

## Pièges courants
- **Oublier la réexportation** : l'ORM ne voit pas le modèle, et la migration n'est pas générée.
- **Un tri par défaut** : il s'applique à des requêtes qui ne le veulent pas, et masque l'absence
  de tri explicite.
- **Un champ de date mal suffixé** : la revue le refuse, et le code devient ambigu à la lecture.
- **De la règle de gestion dans le modèle** : elle finit dupliquée, et intestable sans base.
- **Une requête dans une propriété** : la lecture d'un attribut déclenche du SQL, et les boucles
  deviennent catastrophiques.

## Cas d'usage voisins
- UC-DOM-02 — séparer les couches
- UC-DOM-06 — porter l'intégrité par des contraintes en base
- UC-DOM-07 — écritures de masse dans un jeu de requêtes dédié
- UC-DB-09 — isoler les données métier par tenant
