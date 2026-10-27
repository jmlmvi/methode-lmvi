---
id: UC-ACT-08
titre: "Invoquer une action en asynchrone et suivre le job"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "POST …/actions/{action}/async, GET /admin/jobs/{job_id}, ExecutionMode.ASYNC"
---

# UC-ACT-08 — Invoquer une action en asynchrone et suivre le job

## Questions auxquelles répond ce cas d'usage
1. Comment lancer un traitement long sans faire attendre l'appelant ?
2. Que reçoit-on immédiatement, et comment savoir ensuite que c'est terminé ?
3. Combien de temps le résultat d'un job reste-t-il consultable ?
4. Faut-il déclarer l'action asynchrone, ou l'appelant choisit-il le mode ?
5. Que se passe-t-il si l'instance s'arrête pendant l'exécution du job ?
6. Comment un agent IA suit-il un job qu'il a lancé ?
7. Comment signaler la progression d'un traitement long ?

## Mots-clés
asynchrone, `async`, job, identifiant de job, `job_id`, `/admin/jobs/`, suivi, `ExecutionMode`,
`ASYNC`, traitement long, export, recalcul, statut, `PENDING`, `RUNNING`, `DONE`, `FAILED`,
sondage, polling, résultat différé

## Ce que c'est, et quand s'en servir
Le même appel, mais qui rend tout de suite un **identifiant de job** : l'exécution continue en
arrière-plan, et on consulte l'état plus tard. C'est la réponse aux traitements qui durent — export
complet, réindexation, recalcul de masse.

Deux chemins : déclarer l'action en mode asynchrone (tout appel est alors différé), ou garder
l'action synchrone et laisser l'appelant demander l'asynchrone sur l'URL dédiée.

## Ce que le socle fait · ce qu'il interdit
Le socle crée le job, rend son identifiant, exécute l'action hors du cycle de la requête, conserve
l'état et le résultat, et les sert sur la route de suivi. L'audit enregistre l'invocation comme
pour un appel synchrone.

Ce qu'il ne fait pas : garantir la survie d'un job à l'arrêt de l'instance. Un job n'est pas une
file persistante : si le traitement doit absolument aboutir, il faut qu'il soit rejouable, ou passer
par la publication fiable (UC-BUS-05). Le résultat n'est pas conservé indéfiniment.

## Exemples
### Lancer et suivre
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{}' \
  localhost:8080/admin/workers/export_worker/actions/export_all/async
# {"success":true,"data":{"job_id":"8f3c…","status":"PENDING"},"error":""}

curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/jobs/8f3c…
# {"success":true,"data":{"job_id":"8f3c…","status":"DONE","result":{"rows":10432}},"error":""}
```

### Déclarer l'action asynchrone
```python
@action("export_all", description="Exporte tout le référentiel", mode=ExecutionMode.ASYNC,
        required_scope="exports.write")
def export_all(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    rows = self.techdb.run(lambda: selectors.OrderSelector.get_all())
    return ActionResult.ok({"rows": len(rows)})
```

### Publier la progression
```python
# Le job rend un résultat à la fin ; pour la progression, écrire dans le bus et la lire par action.
self._kv_bus.set("export_worker:progress", {"done": done, "total": total}, ttl_seconds=3600)
```

## Pièges courants
- **Sonder trop souvent** la route de suivi : inutile et coûteux. Un intervalle raisonnable, avec
  arrêt au bout d'un temps borné.
- **Perdre l'identifiant** : sans lui, plus aucun moyen de retrouver le résultat.
- **Croire le job durable** : un redémarrage le perd. Pour du garanti, c'est le bus fiable.
- **Mettre en asynchrone une action rapide** : on complique l'appelant pour rien.
- **Oublier que les erreurs arrivent dans le statut**, pas dans la réponse initiale : l'appel de
  lancement réussit même si le traitement échouera.

## Cas d'usage voisins
- UC-ACT-07 — invoquer une action en REST
- UC-ACT-03 — imposer un délai maximal
- UC-BUS-05 — publication fiable avec groupes
- UC-ACT-13 — consommer les actions depuis un agent IA
