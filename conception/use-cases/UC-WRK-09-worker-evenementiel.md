---
id: UC-WRK-09
titre: "Worker événementiel — consommer un flux en continu"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "AbstractEventDrivenWorker, take, poll, reliable_consumer_worker"
---

# UC-WRK-09 — Worker événementiel : consommer un flux en continu

## Questions auxquelles répond ce cas d'usage
1. Comment traiter des messages dès qu'ils arrivent, sans attendre la prochaine échéance ?
2. Mon worker doit lire une file externe en permanence : ai-je le droit de boucler ?
3. Quelle différence entre une attente bloquante sur le bus interne et une interrogation d'un
   système tiers avec délai ?
4. Que devient un message en cours de traitement quand l'instance s'arrête ?
5. Comment éviter de perdre des messages quand mon traitement échoue ?
6. En Python, ce modèle existe-t-il déjà, et sinon que faire en attendant ?
7. Comment mesurer le retard accumulé par mon consommateur ?

## Mots-clés
événementiel, event-driven, flux, consommation continue, `take`, `poll`, attente bloquante,
`AbstractEventDrivenWorker`, `EventDrivenKvBusWorker`, `reliable_consumer_worker.py`,
consommateur, groupe de consommateurs, retard, lag, accusé de réception

## Ce que c'est, et quand s'en servir
Un worker qui ne travaille pas à l'heure mais **à l'arrivée** : il prend les messages au fil de
l'eau. Deux formes selon la source — attente bloquante sur le bus interne de l'instance, ou
interrogation d'une source externe avec un délai borné.

C'est le bon modèle quand la latence compte (traiter en moins d'une seconde) et quand le volume est
irrégulier. Si quelques secondes de retard sont acceptables, un worker planifié qui vide une file à
chaque cycle est plus simple et plus facile à superviser.

## Ce que le socle fait · ce qu'il interdit
Dans le Socle Java, une classe de base tient la boucle de consommation, les points d'accroche du
cycle de vie et l'arrêt propre : le développeur n'écrit que le traitement d'un message. C'est
précisément **pour cela** que la boucle manuelle est interdite — celle de la classe de base sait
s'arrêter au drain, compter, et ne pas perdre le message en cours.

Dans les moteurs Python, cette classe de base est l'une des US de la phase **P-4**. En attendant,
on ne la réécrit pas à la main : on utilise le modèle de consommateur fiable
(`reliable_consumer_worker.py`), qui s'abonne au bus en groupe à l'initialisation et traite les
messages par rappel, avec relivraison et file d'échec (UC-BUS-05, UC-BUS-06).

## Exemples
### Socle Java
```java
@Component
public class OrderEventWorker extends AbstractEventDrivenWorker {
    @Override protected void onInitialize() {
        eventQueue = new LinkedBlockingQueue<>(1000);
        kvBus.sub("orders/created", payload -> eventQueue.offer((Map<String, Object>) payload));
    }
    // Appelé en boucle par la classe de base : take() bloque jusqu'à l'arrivée d'un événement.
    @Override protected Map<String, Object> pollEvent() throws InterruptedException {
        return eventQueue.take();
    }
    @Override protected void processEvent(Map<String, Object> event) { /* UN événement */ }
}
```
Pour une source externe (Kafka, NATS), l'interrogation se fait avec un délai borné, jamais en
attente infinie : l'arrêt doit pouvoir reprendre la main.

### socle-py-django et socle-py — en attendant P-4
```python
class OrderEventWorker(Worker, ActionProvider):
    schedule = PASSIVE                      # piloté par les messages, pas par l'horloge

    def initialize(self) -> None:
        # Abonnement fiable, en groupe : au moins une fois, relivraison et file d'échec.
        self._subscription = self._kv_bus.subscribe("orders/created", "order_event_worker",
                                                    self._handle)

    def _handle(self, message: dict) -> None:
        ...                                 # traitement d'UN message ; une exception = relivraison

    def stop(self) -> None:
        self._subscription.close()
```

## Pièges courants
- **Écrire sa propre boucle** avec attente active : le worker ne s'arrête plus proprement, échappe
  au drain et fausse les statistiques. C'est refusé par la revue de code en Python.
- **Attendre sans délai sur une source externe** : l'arrêt de l'instance reste bloqué sur l'appel.
- **Traiter plusieurs messages dans un seul rappel** sans accusé intermédiaire : un échec en fin de
  lot fait tout rejouer.
- **Oublier l'idempotence** : la relivraison est normale, donc le doublon est normal (UC-BUS-07).

## Cas d'usage voisins
- UC-BUS-05 — publication fiable avec groupes
- UC-BUS-06 — file des messages en échec
- UC-BUS-07 — rendre un consommateur idempotent
- UC-INT-01 — consommer un sujet Kafka
