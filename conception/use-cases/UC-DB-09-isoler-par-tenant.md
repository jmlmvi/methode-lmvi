---
id: UC-DB-09
titre: "Isoler les données métier par tenant"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "x_partition, scope_queryset, tenant_partition, TenantContext, RG-27"
---

# UC-DB-09 — Isoler les données métier par tenant

## Questions auxquelles répond ce cas d'usage
1. Comment faire en sorte qu'un client ne voie jamais les données d'un autre ?
2. Pourquoi les tables métier portent-elles un préfixe et une colonne de partition ?
3. D'où vient le tenant d'une requête — le client peut-il le choisir ?
4. Comment écrire une lecture qui soit étanche sans y penser à chaque fois ?
5. Et une écriture : qui pose la valeur de partition ?
6. Comment prouver l'étanchéité autrement qu'en relisant le code ?
7. Faut-il une base par client, ou une colonne suffit-elle ?

## Mots-clés
multi-tenant, tenant, partition, `x_partition`, préfixe `x_`, isolation, étanchéité,
`scope_queryset`, `tenant_partition`, `TenantContext`, `from_action_context`, SaaS,
RG-27, MultiTenantCore, fuite de données, test d'étanchéité

## Ce que c'est, et quand s'en servir
Le modèle d'isolation du Socle : **une base, des tables partagées, une colonne de partition**. Les
tables métier sont préfixées pour être reconnaissables, et portent la colonne qui identifie le
tenant propriétaire de chaque ligne.

Toute application qui sert plusieurs clients en a besoin dès la première table. Ce n'est pas un
raffinement à ajouter plus tard : rattraper l'isolation sur un modèle existant est un chantier de
migration et de relecture complète.

## Ce que le socle fait · ce qu'il interdit
Le socle fournit le tenant dans le contexte d'appel (il vient de l'identité, UC-SEC-05), et deux
outils : l'un **restreint une lecture** à la partition de l'appelant, l'autre **rend la valeur de
partition** à poser sur une écriture. Le refus en l'absence de tenant est intégré (UC-DB-10).

Ce qu'il n'autorise pas : lire une table partitionnée sans passer par la restriction, ou créer une
ligne sans partition. Le modèle ne pose pas la valeur tout seul — elle est passée à la fabrique,
explicitement, pour qu'on la voie à la relecture.

## Exemples
### Le modèle (couche données)
```python
class Order(models.Model):
    x_id = models.BigAutoField(primary_key=True)
    x_partition = models.CharField(max_length=30)          # le tenant propriétaire
    reference = models.CharField(max_length=40)

    class Meta:
        db_table = "x_orders"                              # préfixe x_ : table partitionnée
        constraints = [models.UniqueConstraint(fields=["x_partition", "reference"],
                                               name="uq_orders_reference")]
```

### La lecture (sélecteur)
```python
class OrderSelector:
    @staticmethod
    def get_by_reference(*, tenant_context, reference: str) -> models.Order:
        # La restriction est appliquée ici : impossible de lire hors de sa partition.
        return tenant.scope_queryset(tenant_context, models.Order.objects).get(reference=reference)
```

### L'écriture (mutateur)
```python
class OrderMutator:
    @staticmethod
    def create(*, tenant_context, reference: str, amount_cents: int) -> models.Order:
        partition = tenant.tenant_partition(tenant_context, models.Order)
        return models.Order.new(partition=partition, reference=reference,
                                amount_cents=amount_cents)
```

### Socle Java — en SQL
```java
techDb.insertTenant(tenant, "x_orders", Map.of("reference", reference));
List<Map<String, Object>> rows = techDb.queryTenant(tenant, "SELECT * FROM x_orders");
```

### Prouver l'étanchéité
```python
assert (await ex.execute("orders_worker", "list_orders", {}, ctx("acme"))).data["count"] == 2
assert (await ex.execute("orders_worker", "list_orders", {}, ctx("globex"))).data["count"] == 0
```

## Pièges courants
- **Oublier la colonne sur une nouvelle table** : la fuite est silencieuse jusqu'au jour où deux
  clients existent.
- **Filtrer le tenant à la main** dans chaque requête : un oubli suffit. Passer par l'outil.
- **Unicité sans la partition** : deux clients ne peuvent plus utiliser la même référence —
  l'unicité se déclare toujours avec la partition.
- **Faire confiance à un tenant fourni par le client** : il vient de l'identité, jamais du corps de
  la requête (UC-SEC-06).
- **Tester avec un seul tenant** : l'étanchéité ne se voit qu'avec deux.

## Cas d'usage voisins
- UC-DB-10 — refuser un accès sans tenant
- UC-SEC-05 — transmettre scopes et tenant
- UC-SEC-06 — proxy de confiance pour l'en-tête de tenant
- UC-DOM-01 — modéliser une entité métier avec l'ORM
