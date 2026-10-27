---
id: UC-BUS-06
titre: "File des messages en échec — inspecter, rejouer, purger"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "peek_dlq, dlq_sizes, DLQ Manager"
---

# UC-BUS-06 — File des messages en échec : inspecter, rejouer, purger

## Questions auxquelles répond ce cas d'usage
1. Où vont les messages que mon consommateur n'arrive jamais à traiter ?
2. Comment regarder ce qu'il y a dans la file d'échec sans tout rejouer ?
3. Un message empoisonné peut-il bloquer le traitement de tous les suivants ?
4. Comment savoir, en exploitation, qu'une file se remplit ?
5. Comment rejouer les messages après avoir corrigé le défaut ?
6. Faut-il purger une file d'échec, et qu'est-ce qu'on perd en le faisant ?
7. Combien d'échecs faut-il avant qu'un message y soit versé ?

## Mots-clés
file d'échec, DLQ, dead letter queue, message empoisonné, poison message, `peek_dlq`,
`dlq_sizes`, rejouer, replay, purger, inspecter, `DLQ Manager`, tentatives, échec répété,
supervision du flux, alerte

## Ce que c'est, et quand s'en servir
Le réceptacle des messages qu'on n'a pas réussi à traiter après plusieurs tentatives. Sa raison
d'être est de **protéger le flux** : sans elle, un seul message mal formé bloquerait indéfiniment la
file derrière lui.

On s'en sert dans trois moments : surveiller sa taille en continu (c'est le signal qu'il y a un
problème), inspecter son contenu pour comprendre, et rejouer après correction.

## Ce que le socle fait · ce qu'il interdit
Le socle compte les tentatives par message, le verse dans la file d'échec du couple sujet/groupe
quand le compte est atteint, et laisse passer la suite. Il expose la taille des files et permet de
regarder leur contenu sans le consommer.

Le socle ne rejoue pas tout seul, et ne purge pas tout seul : ce sont des décisions d'exploitation.
Dans le Socle Java, un worker intégré les outille (UC-OPS-03) ; dans les moteurs Python, c'est une
action du worker consommateur, ou l'US de la phase P-4.

## Exemples
### socle-py-django et socle-py
```python
@action(description="Inspecter la file d'échec", read_only=True)
def peek_dlq(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    messages = self._kv_bus.peek_dlq(TOPIC, GROUP, limit=20)   # lecture : ne consomme rien
    return ActionResult.ok({"count": len(messages), "messages": messages})

def get_stats(self) -> dict:
    # La taille de la file d'échec appartient aux statistiques : c'est le signal d'alerte.
    return {"processed": self._processed, "dlq_size": self._kv_bus.dlq_sizes().get(f"{TOPIC}/{GROUP}", 0)}
```

### Socle Java
```java
Map<String, Long> tailles = kvBus.getDlqSizes();          // par sujet/groupe
// Le DLQ Manager (worker intégré) expose l'inspection, le rejeu et la purge en actions.
```

### Surveiller
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers | jq '.invoice_worker.stats'
# { "processed": 1041, "dlq_size": 3 }   ← 3 messages à regarder
```

## Pièges courants
- **Ne jamais la regarder** : une file d'échec qui grossit sans témoin, c'est une perte de données
  silencieuse. Publier sa taille, et l'alerter.
- **Rejouer sans avoir corrigé** : les messages repartent en échec, les compteurs s'affolent.
- **Purger pour faire disparaître le symptôme** : on jette des événements métier. Inspecter, puis
  décider, et consigner la décision.
- **Confondre taille de file d'attente et file d'échec** : la première est un retard, la seconde un
  défaut.
- **Y verser des erreurs attendues** (données invalides connues) : ce sont des refus métier à
  traiter dans le consommateur, pas des échecs techniques.

## Cas d'usage voisins
- UC-BUS-05 — publication fiable avec groupes
- UC-BUS-07 — rendre un consommateur idempotent
- UC-OPS-03 — gérer les files d'échec (worker intégré)
- UC-SUP-11 — agréger et expédier un rapport d'erreurs
