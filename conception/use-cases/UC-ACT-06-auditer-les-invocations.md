---
id: UC-ACT-06
titre: "Auditer les invocations sans secret en clair"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "audit d'action, sensitive, masquage, techdb_worker_actions, RG-13"
---

# UC-ACT-06 — Auditer les invocations sans secret en clair

## Questions auxquelles répond ce cas d'usage
1. Comment savoir qui a appelé quelle action, quand, et avec quel résultat ?
2. Où est stockée cette trace, et combien de temps la garde-t-on ?
3. Comment éviter qu'un mot de passe passé en paramètre finisse en clair dans l'audit ?
4. Un paramètre non sensible est-il masqué par excès de prudence, et peut-on l'exempter ?
5. L'audit enregistre-t-il aussi les appels qui échouent ou qui sont refusés ?
6. Comment relire l'audit en exploitation, et par quel moyen l'exposer à un agent ?
7. Que contient l'audit quand l'appel vient de MCP plutôt que de REST ?

## Mots-clés
audit, trace, journal d'invocation, `sensitive`, masquage, masqué, secret, `techdb_worker_actions`,
RG-13, appelant, `caller_id`, `CallerType`, REST, MCP, résultat, durée, rétention,
exemption, non sensible

## Ce que c'est, et quand s'en servir
Chaque invocation laisse une trace en base technique : l'action, le worker, l'appelant, le moment,
la durée, le succès ou l'échec, et les paramètres — **avec les valeurs sensibles masquées**. C'est
ce qui permet de répondre à « qui a fait ça ? » sans fouiller les journaux de l'application.

On s'appuie dessus pour l'exploitation (comprendre un incident), pour la conformité (prouver qui a
déclenché quoi), et pour l'observation d'usage (quelles actions servent vraiment).

## Ce que le socle fait · ce qu'il interdit
Le socle écrit la trace lui-même, pour **tous** les appels — réussis, échoués, refusés — et masque
les valeurs selon deux sources : les paramètres déclarés sensibles, et une liste de mots-clés qui
attrape les noms évocateurs (`password`, `token`, `secret`…). Le masquage par mot-clé est
volontairement large ; il est apparu qu'il pouvait masquer des valeurs utiles, d'où une possibilité
d'exemption explicite, la déclaration `sensitive` restant prioritaire.

Ce que le socle ne fait pas : deviner qu'une valeur métier est confidentielle. Un numéro de carte
passé dans un paramètre nommé `reference` finira en clair — c'est au développeur de le déclarer.

## Exemples
### socle-py-django et socle-py
```python
@action("connect_provider", description="Enregistre un accès fournisseur")
@param("client_id", required=True)
@param("client_secret", required=True, sensitive=True)    # masqué dans l'audit et les traces
def connect_provider(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...
```
```yaml
socle:
  worker-actions:
    audit-non-sensitive-keys: ${AUDIT_NON_SENSITIVE_KEYS:secret_id}   # exemption explicite
```

### Socle Java
```java
@McpParam(name = "client_secret", required = true, sensitive = true) String clientSecret
```

### Relire l'audit
```sql
SELECT X_ID, WORKER_NAME, ACTION_NAME, CALLER_ID, SUCCESS, DURATION_MS
FROM TECHDB_WORKER_ACTIONS ORDER BY X_ID DESC LIMIT 20;
```

## Pièges courants
- **Passer un secret dans un paramètre non déclaré sensible** : il part en clair dans l'audit, et
  l'audit est conservé.
- **Journaliser soi-même les paramètres** dans un message de journal : le masquage de l'audit ne
  protège pas vos propres traces.
- **Croire que l'audit remplace la supervision** : il raconte les invocations, pas la santé.
- **Oublier la rétention** : la table grossit. La purge est un cas d'usage à part entière
  (UC-DB-06).
- **Exempter trop largement** du masquage pour « voir enfin les valeurs » : on crée une fuite
  durable pour un confort de débogage.

## Cas d'usage voisins
- UC-ACT-04 — exiger un scope
- UC-DB-06 — purger selon une rétention
- UC-SEC-05 — transmettre scopes et tenant
- UC-SUP-10 — journaliser avec un contexte de corrélation
