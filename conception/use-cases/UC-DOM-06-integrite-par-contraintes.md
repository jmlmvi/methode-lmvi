---
id: UC-DOM-06
titre: "Porter l'intégrité par des contraintes en base"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: na
  socle-py: na
  socle-py-django: ok
contrat: "5.9"
mecanismes: "UniqueConstraint, CheckConstraint, IntegrityError, conversion en refus"
---

# UC-DOM-06 — Porter l'intégrité par des contraintes en base

## Questions auxquelles répond ce cas d'usage
1. Faut-il vérifier l'unicité en relisant la base, ou laisser la base refuser ?
2. Pourquoi ma vérification « cette référence existe-t-elle déjà ? » laisse-t-elle passer des
   doublons ?
3. Comment transformer une erreur d'intégrité en refus métier lisible ?
4. Où déclare-t-on une contrainte, et comment l'ajouter sur une table existante ?
5. Peut-on remplacer une contrainte par un validateur de champ ?
6. Comment nommer une contrainte, et pourquoi le nom compte-t-il ?
7. L'unicité doit-elle inclure le tenant ?

## Mots-clés
intégrité, contrainte, `UniqueConstraint`, `CheckConstraint`, `IntegrityError`,
doublon, concurrence, condition de course, relecture, validateur de champ,
nom de contrainte, migration, conversion en refus, `DUPLICATE_REFERENCE`

## Ce que c'est, et quand s'en servir
L'intégrité des données se déclare **dans la base**, pas dans le code d'enregistrement. Deux
raisons : la base est la seule à voir toutes les écritures concurrentes, et elle reste vraie même
quand on charge des données par un autre chemin.

La technique de relecture — « je vérifie que ça n'existe pas, puis j'insère » — est fausse sous
concurrence : deux requêtes simultanées passent toutes les deux la vérification. C'est un défaut
classique, qui ne se manifeste qu'en charge.

## Ce que le socle fait · ce qu'il interdit
Le socle applique vos contraintes par les migrations. La convention du commanditaire est explicite :
l'intégrité passe par des contraintes en base, pas par du code dans l'enregistrement ni par des
validateurs de champ.

La bonne chaîne est donc : la contrainte garantit, le service **convertit** l'erreur d'intégrité en
refus métier nommé. L'appelant reçoit un code compréhensible, et la garantie reste réelle.

## Exemples
### Déclarer
```python
class Meta:
    db_table = "x_orders"
    constraints = [
        # L'unicité inclut la partition : deux tenants peuvent utiliser la même référence.
        models.UniqueConstraint(fields=["x_partition", "reference"], name="uq_orders_reference"),
        models.CheckConstraint(condition=models.Q(amount_cents__gt=0),
                              name="ck_orders_amount_positive"),
    ]
```

### Convertir, dans le service
```python
try:
    order = mutators.OrderMutator.create(tenant_context=ctx, reference=reference, ...)
except db.IntegrityError as exc:
    # La base a tranché ; le service explique, avec le code de la règle.
    raise OrderRuleViolation("DUPLICATE_REFERENCE", f"Référence {reference} déjà utilisée") from exc
```

### Ce que l'appelant reçoit
```json
{"success": false, "error": "Référence C-1 déjà utilisée", "errorType": "DUPLICATE_REFERENCE"}
```

### Ajouter une contrainte sur une table qui vit déjà
```python
# Corriger les données d'abord, poser la contrainte ensuite : sinon la migration échoue.
operations = [migrations.RunPython(corriger_les_doublons),
              migrations.AddConstraint("order", models.UniqueConstraint(...))]
```

## Pièges courants
- **Relire avant d'insérer** : faux sous concurrence, et plus lent.
- **Laisser remonter l'erreur d'intégrité brute** : l'appelant reçoit une panne au lieu d'un refus
  métier.
- **Unicité sans la partition** : on empêche deux clients d'utiliser la même référence.
- **Contrainte sans nom explicite** : les journaux et les migrations deviennent illisibles.
- **Un validateur de champ à la place d'une contrainte** : il ne protège que le chemin applicatif,
  pas les imports ni les scripts.

## Cas d'usage voisins
- UC-DOM-01 — modéliser une entité métier avec l'ORM
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-DB-03 — migrations tracées
- UC-BUS-07 — rendre un consommateur idempotent
