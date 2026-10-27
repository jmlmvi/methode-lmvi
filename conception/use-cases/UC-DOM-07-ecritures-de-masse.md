---
id: UC-DOM-07
titre: "Écritures de masse dans un QuerySet dédié"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: na
  socle-py: na
  socle-py-django: ok
contrat: "5.9"
mecanismes: "Manager.from_queryset, update, bulk_create, QuerySet personnalisé"
---

# UC-DOM-07 — Écritures de masse dans un QuerySet dédié

## Questions auxquelles répond ce cas d'usage
1. Comment mettre à jour mille lignes sans les charger une par une ?
2. Où écrit-on une mise à jour de masse, puisque c'est interdit ailleurs ?
3. Comment attacher un jeu de requêtes personnalisé à un modèle ?
4. Une mise à jour de masse déclenche-t-elle les traitements du modèle ?
5. Comment garder l'isolation par tenant sur une écriture de masse ?
6. Quand faut-il préférer une boucle explicite malgré le coût ?

## Mots-clés
écriture de masse, `update`, `bulk_create`, `bulk_update`, upsert, QuerySet personnalisé,
`Manager.from_queryset`, performance, N+1, pas de signal, pas de `save`, isolation tenant,
`scope_queryset`, lot, batch

## Ce que c'est, et quand s'en servir
Les mises à jour et suppressions qui portent sur plusieurs lignes vivent dans un **jeu de requêtes
personnalisé**, attaché au modèle. On y nomme l'opération métier (« annuler les brouillons »),
plutôt que de laisser l'appelant composer une requête de masse n'importe où.

L'intérêt est double : une seule requête SQL au lieu de mille, et un endroit unique où lire ce que
l'application sait modifier en masse.

## Ce que le socle fait · ce qu'il interdit
La convention réserve l'accès à l'ORM aux couches d'accès aux données, et les écritures de masse à
ce jeu de requêtes ; la revue de code le vérifie. Un mutateur peut l'appeler, un service non — il
passe par le mutateur.

À savoir, parce que c'est une source de surprise : une mise à jour de masse **ne passe pas** par
les méthodes du modèle. Ni enregistrement, ni signal, ni logique d'instance. Ce qui doit arriver à
chaque ligne doit donc être inclus dans la requête elle-même.

## Exemples
### Le jeu de requêtes
```python
# src/mon_app/orders/models/order_queryset.py
class OrderQuerySet(models.QuerySet):
    def set_cancelled(self, *, cancelled_at) -> int:
        """Annuler les brouillons du jeu courant, en une requête."""
        return self.filter(status=OrderStatus.DRAFT).update(status=OrderStatus.CANCELLED,
                                                            cancelled_at=cancelled_at)
```

### L'attacher au modèle
```python
class Order(models.Model):
    objects = models.Manager.from_queryset(OrderQuerySet)()
```

### L'appeler, en restant isolé par tenant
```python
# src/mon_app/orders/mutators/order_mutator.py
@staticmethod
def cancel_drafts(*, tenant_context, cancelled_at) -> int:
    # La restriction par tenant s'applique AVANT l'écriture de masse.
    return tenant.scope_queryset(tenant_context, models.Order.objects).set_cancelled(
        cancelled_at=cancelled_at)
```

## Pièges courants
- **Une boucle qui enregistre ligne par ligne** : mille requêtes au lieu d'une, et un temps de
  réponse qui explose.
- **Oublier la restriction par tenant** : une écriture de masse qui traverse les partitions est la
  pire des fuites.
- **Attendre les effets du modèle** : une mise à jour de masse ne les déclenche pas.
- **Composer la requête de masse dans un service** : la couche d'accès perd son rôle, et la revue
  le refuse.
- **Pas de limite de lot** sur une très grosse table : la transaction s'étire et verrouille.

## Cas d'usage voisins
- UC-DOM-01 — modéliser une entité métier avec l'ORM
- UC-DOM-02 — séparer les couches
- UC-DB-09 — isoler les données métier par tenant
- UC-DB-06 — purger selon une rétention
