---
id: UC-ACT-03
titre: "Imposer un délai maximal d'exécution à une action"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "timeout_ms, délai type, invocation asynchrone"
---

# UC-ACT-03 — Imposer un délai maximal d'exécution à une action

## Questions auxquelles répond ce cas d'usage
1. Comment empêcher une action lente de tenir un client en attente indéfiniment ?
2. Quel délai s'applique si je n'en déclare aucun ?
3. Que reçoit l'appelant quand le délai est dépassé — une erreur, un identifiant de suivi ?
4. Mon traitement dure deux minutes : faut-il augmenter le délai ou changer de mode ?
5. Le délai de l'action protège-t-il aussi l'appel que je fais à un tiers ?
6. Un agent IA voit-il ce délai avant d'appeler ?

## Mots-clés
délai, timeout, `timeout_ms`, durée maximale, action lente, long traitement, dépassement,
abandon, mode asynchrone, job, latence, délai par défaut, 504, interruption, appel tiers

## Ce que c'est, et quand s'en servir
Une borne de temps déclarée sur l'action : au-delà, l'exécution est abandonnée et l'appelant reçoit
une réponse d'échec plutôt que de rester pendu. C'est une protection pour l'appelant comme pour
l'instance — une action sans borne monopolise une ressource.

Si le traitement est **intrinsèquement** long (export, recalcul massif), le bon réflexe n'est pas
d'allonger le délai : c'est de passer en invocation asynchrone (UC-ACT-08), qui rend un identifiant
de suivi tout de suite.

## Ce que le socle fait · ce qu'il interdit
Le socle applique le délai déclaré, ou le délai par défaut du contrat, interrompt l'exécution,
journalise le dépassement et rend un échec explicite. Le délai figure dans la description publiée
de l'action, donc un client comme un agent peut s'y préparer.

Le délai de l'action ne remplace pas le délai de vos appels sortants : interrompre l'action ne
libère pas une connexion bloquée. Chaque appel HTTP sortant porte son propre délai (UC-RES-05).

## Exemples
### socle-py-django et socle-py
```python
@action("rebuild_index", description="Reconstruit l'index de recherche", timeout_ms=30_000)
def rebuild_index(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...

# Traitement vraiment long : mode asynchrone plutôt qu'un délai démesuré.
@action("export_all", description="Exporte tout le référentiel", mode=ExecutionMode.ASYNC)
def export_all(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...
```

### Socle Java
```java
@McpAction(name = "rebuild_index", timeoutMs = 30_000)
public ActionResult rebuildIndex(ActionContext context) { … }
```

### Le voir publié
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/actions | jq '.[] | {name, timeout_ms}'
```

## Pièges courants
- **Allonger le délai au lieu de changer de mode** : on déplace le problème chez l'appelant, et on
  garde une connexion ouverte pendant des minutes.
- **Croire que le dépassement annule tout** : le travail déjà fait reste fait. Pour qu'un abandon
  soit propre, l'opération doit être transactionnelle ou rejouable.
- **Un délai plus court que l'appel tiers qu'elle contient** : l'action échoue toujours sans qu'on
  comprenne pourquoi.
- **Aucun délai sur une action qui appelle le réseau** : c'est la panne qui bloque l'instance.

## Cas d'usage voisins
- UC-ACT-08 — invoquer une action en asynchrone
- UC-RES-05 — imposer un délai à tout appel sortant
- UC-ACT-10 — publier la spécification des actions
- UC-WRK-11 — travail bloquant ou asynchrone
