---
id: UC-DB-10
titre: "Refuser un accès sans tenant à une table partitionnée"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "MissingTenant, MISSING_TENANT, is_partitioned_table, RG-27"
---

# UC-DB-10 — Refuser un accès sans tenant à une table partitionnée

## Questions auxquelles répond ce cas d'usage
1. Que se passe-t-il si une action multi-tenant est appelée sans identité ?
2. Pourquoi refuser, plutôt que de ne rien renvoyer ?
3. Comment ce refus remonte-t-il à l'appelant REST ou MCP ?
4. Mon appel local échoue avec un refus de tenant : qu'est-ce qui manque ?
5. Une tâche planifiée n'a pas d'appelant : comment accède-t-elle aux données d'un tenant ?
6. Peut-on désactiver ce contrôle pour un script d'administration ?
7. Comment tester ce comportement dans ma suite de tests ?

## Mots-clés
`MissingTenant`, `MISSING_TENANT`, refus, sans tenant, table partitionnée, `is_partitioned_table`,
étanchéité, RG-27, échec explicite, 401, identité absente, tâche planifiée, batch,
administration, test de refus

## Ce que c'est, et quand s'en servir
Le garde-fou du modèle multi-tenant : toucher une table partitionnée sans savoir pour quel tenant
est **refusé**. Pas « zéro ligne », pas « toutes les lignes » : un refus, avec un code.

C'est la bonne conception. Renvoyer zéro ligne masquerait un défaut d'identité — l'appelant croirait
à une absence de données. Renvoyer toutes les lignes serait une fuite. Le refus est le seul
comportement qui dit la vérité.

## Ce que le socle fait · ce qu'il interdit
Le socle reconnaît une table partitionnée à son nom, et lève un refus dédié quand le contexte de
tenant est absent. La couche interface le traduit en refus typé, que l'appelant reçoit avec un code
stable.

Il n'y a pas de mode « sans tenant » pour les tables partitionnées : un traitement qui doit
travailler pour plusieurs clients boucle **explicitement** sur les tenants concernés, en construisant
un contexte pour chacun. C'est plus verbeux, et c'est voulu — un traitement transverse doit se lire
comme tel.

## Exemples
### Le refus, dans l'action
```python
try:
    book = self.techdb.run(lambda: services.OrderService.list_orders(tenant_context=ctx))
except tenant.MissingTenant as exc:
    return ActionResult.failure(str(exc), "MISSING_TENANT")
```

### Ce que voit l'appelant
```json
{"success": false, "data": {},
 "error": "Refusing tenant-less access to partitioned table 'x_orders' — provide a TenantContext",
 "errorType": "MISSING_TENANT"}
```

### Un traitement planifié, pour plusieurs tenants
```python
def do_work(self) -> None:
    # Pas de contexte d'appel ici : on boucle explicitement, tenant par tenant.
    for partition in self.techdb.run(selectors.TenantSelector.get_active_partitions):
        ctx = tenant.TenantContext(tenant_id=partition)
        self.techdb.run(lambda: services.OrderService.close_day(tenant_context=ctx, ...))
```

### Le tester
```python
refus = await ex.execute("orders_worker", "list_orders", {}, ActionContext("t", CallerType.REST))
assert not refus.success and refus.error_type == "MISSING_TENANT"
```

## Pièges courants
- **Attraper le refus et renvoyer une liste vide** : on transforme un défaut de sécurité en silence.
- **Fabriquer un tenant par défaut** (`"default"`, `"system"`) pour « débloquer » : toutes les
  données finissent dans la même partition, et l'isolation est perdue.
- **Croire le refus dû à un bogue** quand on essaie en local : il manque le proxy de confiance et
  l'en-tête de tenant (UC-SEC-06).
- **Oublier le cas du worker planifié** : il n'a pas d'appelant, donc pas de tenant implicite.

## Cas d'usage voisins
- UC-DB-09 — isoler les données métier par tenant
- UC-SEC-06 — proxy de confiance pour l'en-tête de tenant
- UC-ACT-12 — distinguer un refus métier d'une panne
- UC-SEC-05 — transmettre scopes et tenant
