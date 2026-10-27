---
id: UC-INT-01
titre: "Consommer un sujet Kafka"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "EventDrivenKafkaWorker, poll avec délai, offsets, groupe"
---

# UC-INT-01 — Consommer un sujet Kafka

## Questions auxquelles répond ce cas d'usage
1. Comment consommer un flux Kafka depuis une application Socle ?
2. Qui gère les offsets et le groupe de consommateurs ?
3. Pourquoi faut-il interroger avec un délai borné plutôt qu'attendre indéfiniment ?
4. Comment l'arrêt de l'instance s'articule avec une consommation en cours ?
5. Dans les moteurs Python, Kafka est-il supporté ?
6. Quelle alternative quand Kafka n'est pas dans le périmètre ?

## Mots-clés
Kafka, consommateur, `EventDrivenKafkaWorker`, `poll`, délai borné, offsets,
groupe de consommateurs, commit, arrêt propre, flux externe, hors périmètre,
bus interne, passerelle, pont

## Ce que c'est, et quand s'en servir
Brancher un worker sur un sujet Kafka pour traiter les messages au fil de l'eau. Le Socle Java
fournit un modèle de worker événementiel adapté : interrogation avec délai borné, traitement message
par message, et arrêt propre.

Le délai borné n'est pas un détail : une attente infinie empêche l'arrêt de reprendre la main, donc
le drain et le déploiement.

## Ce que le socle fait · ce qu'il interdit
Java : le modèle encadre la boucle de consommation et le cycle de vie ; les offsets et le groupe
restent la responsabilité du client Kafka configuré.

Moteurs Python : **hors périmètre déclaré**. Rien n'interdit d'utiliser une bibliothèque cliente,
mais rien n'est fourni ni testé : la boucle, le cycle de vie, la santé et la gestion des offsets
sont entièrement à votre charge — avec l'interdiction habituelle de boucler ou de dormir dans un
worker (UC-WRK-01).

Le montage le plus sûr, quand Kafka est imposé mais hors périmètre : un **pont** minimal — un
service qui consomme Kafka et appelle une action du Socle, ou qui publie sur le bus interne. L'un
des deux côtés reste simple et testable.

## Exemples
### Socle Java
```java
@Override protected ConsumerRecords<String, String> pollEvent() {
    return consumer.poll(Duration.ofMillis(500));     // délai borné : l'arrêt reste possible
}
@Override protected void processEvent(ConsumerRecords<String, String> records) { … }
```

### Moteurs Python — le pont par une action
```bash
# Le consommateur Kafka (hors Socle) appelle une action du Socle, qui reste dans le contrat.
POST /admin/workers/orders_worker/actions/receive_order_event
```

### Si vous consommez malgré tout depuis un worker Python
```python
def do_work(self) -> None:          # synchrone : exécuté hors de la boucle d'événements
    # Interrogation BORNÉE, un lot par cycle : pas de boucle infinie dans le worker.
    for message in self._consumer.poll(timeout_ms=500).values():
        self._traiter(message)
```

## Pièges courants
- **Une boucle de consommation dans le worker** : interdit, et l'arrêt ne reprend plus la main.
- **Attente infinie** : le drain ne se termine jamais.
- **Valider les offsets avant le traitement** : les messages en vol sont perdus à l'incident.
- **Ignorer l'idempotence** : Kafka relivre, comme le bus interne (UC-BUS-07).
- **Compter sur un support du socle** : il n'y en a pas dans les moteurs Python.

## Cas d'usage voisins
- UC-WRK-09 — worker événementiel
- UC-BUS-05 — publication fiable avec groupes
- UC-BUS-07 — rendre un consommateur idempotent
- UC-WRK-01 — planifier par intervalle
