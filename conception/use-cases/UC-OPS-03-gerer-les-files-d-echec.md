---
id: UC-OPS-03
titre: "Gérer les files d'échec (worker intégré)"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "DLQ Manager, push, poll, replayAll, purge"
---

# UC-OPS-03 — Gérer les files d'échec (worker intégré)

## Questions auxquelles répond ce cas d'usage
1. Qui outille l'inspection et le rejeu des messages en échec ?
2. Quelles opérations sont disponibles : voir, rejouer, vider ?
3. Le rejeu remet-il les messages dans l'ordre d'origine ?
4. Comment éviter de rejouer en boucle un message qui échouera encore ?
5. Comment surveiller la taille des files sans y penser chaque matin ?
6. Dans les moteurs Python, comment faire aujourd'hui ?
7. Qui a le droit de purger, et faut-il une trace ?

## Mots-clés
DLQ Manager, file d'échec, `push`, `poll`, `replayAll`, `purge`, rejeu, FIFO,
inspection, vidage, surveillance, alerte, scope, audit, worker intégré, P-4

## Ce que c'est, et quand s'en servir
Le pendant outillé de la file d'échec (UC-BUS-06) : un composant dédié qui sait empiler, dépiler
dans l'ordre, rejouer l'ensemble et purger. C'est ce qu'on utilise après un incident, quand il faut
reprendre proprement des centaines de messages.

La discipline d'exploitation compte plus que l'outil : **corriger d'abord, rejouer ensuite**, et
garder la trace de ce qu'on a rejoué ou jeté.

## Ce que le socle fait · ce qu'il interdit
Java : le composant expose les quatre opérations, en préservant l'ordre d'arrivée. Moteurs Python :
les primitives existent dans le bus (consultation, tailles) ; l'outillage de rejeu et de purge
relève de la phase **P-4**.

Ce qu'il ne faut pas faire : rejouer sans limite ni compteur. Un rejeu massif sur une cause non
corrigée remplit la file à nouveau, en pire — et souvent noie les journaux au passage.

## Exemples
### Socle Java
```java
dlqManager.push(topic, group, message);        // mise en file d'échec
Object m = dlqManager.poll(topic, group);      // dépile dans l'ordre d'arrivée
int rejoues = dlqManager.replayAll(topic, group);
int jetes = dlqManager.purge(topic, group);    // sans rejeu : décision à tracer
```

### Moteurs Python — inspecter et surveiller aujourd'hui
```python
@action("peek_dlq", description="Inspecte la file d'échec", read_only=True)
def peek_dlq(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    return ActionResult.ok({"messages": self._kv_bus.peek_dlq(TOPIC, GROUP, limit=20)})

def get_stats(self) -> dict:
    return {"dlq_size": self._kv_bus.dlq_sizes().get(f"{TOPIC}/{GROUP}", 0)}
```

### Surveiller plutôt que vérifier à la main
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers \
  | jq '[.workers[].stats.dlq_size // 0] | add'
```

## Pièges courants
- **Rejouer avant d'avoir corrigé** : la file se remplit à nouveau, et les compteurs explosent.
- **Purger pour faire disparaître l'alerte** : on jette des événements métier sans trace.
- **Rejouer sans idempotence côté consommateur** : doublons garantis (UC-BUS-07).
- **Aucune alerte sur la taille** : la file grossit en silence.
- **Purge sans scope ni audit** : personne ne sait qui a jeté quoi.

## Cas d'usage voisins
- UC-BUS-06 — file des messages en échec
- UC-BUS-05 — publication fiable avec groupes
- UC-BUS-07 — rendre un consommateur idempotent
- UC-OPS-01 — piloter le système par commandes
