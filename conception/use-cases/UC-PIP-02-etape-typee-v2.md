---
id: UC-PIP-02
titre: "Déclarer une étape typée (pipeline V2)"
theme: "UC-PIP · Pipelines"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "PipelineBuilderV2, concurrency, queueSize, timeout, maxRetries, optional"
---

# UC-PIP-02 — Déclarer une étape typée (pipeline V2)

## Questions auxquelles répond ce cas d'usage
1. Comment déclarer une étape de traitement avec son type d'entrée et de sortie ?
2. Quels réglages porte une étape : parallélisme, file, délai, reprises ?
3. Que signifie une étape facultative, et quand l'utiliser ?
4. Comment dimensionner la file d'entrée d'une étape ?
5. Que se passe-t-il quand une étape est plus lente que la précédente ?
6. Dans les moteurs Python, comment obtenir ces garanties sans le moteur ?

## Mots-clés
pipeline V2, étape, typée, `PipelineBuilderV2`, `concurrency`, `queueSize`,
`timeout`, `maxRetries`, `backoff`, `optional`, contre-pression, file,
parallélisme, hors périmètre, bus

## Ce que c'est, et quand s'en servir
Une étape typée : elle déclare ce qu'elle consomme, ce qu'elle produit, et comment elle se comporte
— combien d'items en parallèle, quelle taille de file d'entrée, quel délai par item, combien de
reprises, et si une erreur doit arrêter la chaîne ou être seulement journalisée.

C'est le modèle à privilégier côté Java pour tout traitement en chaîne : les contrats entre étapes
sont explicites, et le comportement en charge est réglé plutôt que subi.

## Ce que le socle fait · ce qu'il interdit
Java : le constructeur de pipeline expose ces réglages avec des défauts raisonnables ; la file
d'entrée crée une **contre-pression** naturelle quand une étape est plus lente que la précédente.

Moteurs Python : **hors périmètre**. L'équivalent s'obtient par le bus fiable : chaque étape est un
worker consommateur d'un sujet, avec son groupe. On y retrouve la livraison garantie, la relivraison
et la file d'échec (UC-BUS-06) ; ce qu'on n'a pas, c'est le réglage fin du parallélisme et de la
contre-pression — donc il faut surveiller la taille des files pour voir venir l'embouteillage.

## Exemples
### Socle Java
```java
pipeline.stage("transform", TransformInput.class, TransformOutput.class, this::transform)
        .concurrency(4)
        .queueSize(512)
        .timeout(Duration.ofSeconds(30))
        .maxRetries(2)
        .backoff(Duration.ofMillis(200), 2.0);
```

### Étape facultative
```java
pipeline.stage("enrich", …).optional();      // une erreur est journalisée, la chaîne continue
```

### Moteurs Python — une étape = un worker consommateur
```python
TOPIC_IN, TOPIC_OUT, GROUP = "etl/extracted", "etl/transformed", "transform_worker"

def initialize(self) -> None:
    self._sub = self._kv_bus.subscribe(TOPIC_IN, GROUP, self._handle)

def _handle(self, message: dict) -> None:
    sortie = self._transform(message)            # une exception = relivraison, puis file d'échec
    self._kv_bus.publish(TOPIC_OUT, sortie)

def get_stats(self) -> dict:
    return {"dlq_size": self._kv_bus.dlq_sizes().get(f"{TOPIC_IN}/{GROUP}", 0)}
```

## Pièges courants
- **Un parallélisme élevé sur une étape qui écrit en base** : on déplace la contention dans la base.
- **Une file trop grande** : elle masque un déséquilibre, et la mémoire grossit.
- **Une étape facultative pour une étape importante** : les erreurs sont silencieuses.
- **Aucune surveillance des files** (en Python surtout) : l'embouteillage ne se voit qu'en retard.
- **Des types d'entrée et de sortie flous** : le contrat entre étapes se perd.

## Cas d'usage voisins
- UC-PIP-03 — orchestrer un pipeline V2
- UC-PIP-04 — motifs de pipeline courants
- UC-BUS-05 — publication fiable avec groupes
- UC-BUS-06 — file des messages en échec
