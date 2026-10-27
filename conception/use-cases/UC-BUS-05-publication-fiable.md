---
id: UC-BUS-05
titre: "Publication fiable — groupe de consommateurs, au moins une fois"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "publish, subscribe, groupe de consommateurs, relivraison, RG-08"
---

# UC-BUS-05 — Publication fiable : groupe de consommateurs, au moins une fois

## Questions auxquelles répond ce cas d'usage
1. Comment garantir qu'un message publié sera bien traité, même si le consommateur échoue ?
2. Mes messages disparaissent au redémarrage d'un worker : comment l'éviter ?
3. Deux workers consomment le même sujet et traitent chaque message deux fois : comment n'en faire
   traiter qu'un seul exemplaire ?
4. Quelle est la différence exacte entre la publication simple et la publication fiable ?
5. Combien de fois un message est-il réessayé avant d'être écarté ?
6. Ai-je besoin de Kafka pour obtenir une livraison au moins une fois ?
7. Qu'est-ce qu'un groupe de consommateurs, et comment le nomme-t-on ?
8. Le même code fonctionne-t-il dans les trois moteurs ?

## Mots-clés
publication fiable, au moins une fois, at-least-once, groupe de consommateurs, consumer group,
`publish`, `subscribe`, accusé de réception, ack, relivraison, redelivery, tentatives,
file d'échec, DLQ, RG-08, idempotence, `reliable_consumer_worker.py`,
`EventDrivenKvBusWorker.java`

## Ce que c'est, et quand s'en servir
La livraison garantie **au moins une fois** à **un seul** membre d'un groupe. Le message est
conservé jusqu'à son traitement ; si le gestionnaire lève une exception, il est relivré ; après une
série d'échecs, il part dans la file d'échec (UC-BUS-06) au lieu de bloquer le flux.

On la choisit dès qu'un message perdu a un coût : une commande à facturer, un courriel à envoyer,
un calcul à déclencher. La publication simple (UC-BUS-03) reste préférable pour une notification
dont la perte est sans conséquence.

Le groupe est la clé du partage : tous les abonnés du même nom de groupe se répartissent les
messages ; deux groupes différents reçoivent chacun tous les messages. Nommer le groupe d'après le
worker consommateur rend la lecture évidente en exploitation.

## Ce que le socle fait · ce qu'il interdit
Le socle conserve le message, le remet à un membre du groupe, compte les tentatives, relivre après
échec et verse dans la file d'échec au-delà. Il expose la taille des files, ce qui donne la seule
mesure utile : le flux passe-t-il, ou s'accumule-t-il quelque part.

Il ne fait pas de déduplication : « au moins une fois » signifie qu'un doublon est **normal**, pas
exceptionnel. Le consommateur doit être idempotent (UC-BUS-07) — c'est sa responsabilité, pas celle
du bus. Et l'abonnement se déclare à l'initialisation (UC-BUS-04), avec fermeture à l'arrêt.

## Exemples
### socle-py-django et socle-py
```python
TOPIC, GROUP = "orders/created", "invoice_worker"

class InvoiceWorker(Worker, ActionProvider):
    schedule = PASSIVE

    def initialize(self) -> None:
        self._subscription = self._kv_bus.subscribe(TOPIC, GROUP, self._handle)

    def _handle(self, message: dict) -> None:
        # Une exception ici = le message sera relivré, puis versé dans la file d'échec.
        self._invoice(message["order_id"], message["amount"])

    def stop(self) -> None:
        self._subscription.close()

    def get_stats(self) -> dict:
        return {"processed": self._processed, "dlq_size": self._kv_bus.dlq_sizes().get(f"{TOPIC}/{GROUP}", 0)}
```
Côté producteur, la publication fiable rend un identifiant de message :
```python
message_id = self._kv_bus.publish(TOPIC, {"order_id": 42, "amount": 12000})
```

### Socle Java
```java
kvBus.publish("orders/created", Map.of("order_id", 42, "amount", 12000));
KvSubscription sub = kvBus.subscribe("orders/created", "invoice_worker", this::handle);
```

### Vérifier le comportement, en test
```python
for payload in [{"order_id": 1}, {"order_id": 2}, {"order_id": "bad"}]:
    kv.publish(TOPIC, payload)
await eventually(lambda: kv.dlq_sizes().get(f"{TOPIC}/{GROUP}") == 1)   # le mauvais finit en DLQ
```

## Pièges courants
- **Confondre `pub` et `publish`** : le premier diffuse sans garantie, le second livre de façon
  fiable. Les noms se ressemblent, les comportements non.
- **Deux groupes au lieu d'un** (noms différents dans deux instances du même worker) : chaque
  groupe reçoit tout, donc le message est traité deux fois.
- **Un gestionnaire non idempotent** : la relivraison fabrique des doublons métier.
- **Avaler l'exception dans le gestionnaire** : le bus croit le message traité, et le message est
  perdu pour de bon. Laisser l'exception remonter.
- **Ne pas surveiller la file d'échec** : elle se remplit en silence. La publier dans les
  statistiques du worker.

## Cas d'usage voisins
- UC-BUS-03 — publier un événement (sans garantie)
- UC-BUS-06 — file des messages en échec
- UC-BUS-07 — rendre un consommateur idempotent
- UC-WRK-09 — worker événementiel
