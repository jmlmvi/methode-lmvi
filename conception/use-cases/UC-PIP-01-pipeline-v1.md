---
id: UC-PIP-01
titre: "Chaîner des étapes en pipeline (V1, déprécié)"
theme: "UC-PIP · Pipelines"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "PipelineEngine, machine à états, IDLE RUNNING DRAINING"
---

# UC-PIP-01 — Chaîner des étapes en pipeline (V1, déprécié)

## Questions auxquelles répond ce cas d'usage
1. Qu'est-ce que le moteur de pipeline de première génération, et pourquoi est-il déprécié ?
2. Faut-il encore l'utiliser pour un nouveau développement ?
3. Comment un pipeline existant se comporte-t-il à l'arrêt de l'instance ?
4. Que devient un pipeline en cours quand l'instance draine ?
5. Dans les moteurs Python, existe-t-il un équivalent ?
6. Comment migrer un traitement de première génération ?

## Mots-clés
pipeline V1, déprécié, `PipelineEngine`, machine à états, `IDLE`, `RUNNING`,
`DRAINING`, `SHUTDOWN`, `ERROR`, migration, V2, chaînage d'étapes,
hors périmètre, legacy

## Ce que c'est, et quand s'en servir
La première génération de moteur de pipeline du Socle Java : un moteur à états qui conduit des
pipelines d'étapes, avec initialisation, exécution et drain.

Pour un développement nouveau, la réponse est simple : **non**. Il est déprécié au profit de la
deuxième génération (UC-PIP-02), typée et plus explicite. La fiche existe parce que des traitements
l'utilisent encore, et qu'il faut savoir comment ils se comportent.

## Ce que le socle fait · ce qu'il interdit
Java : le moteur gère les transitions d'états et attend la fin des pipelines actifs avant l'arrêt —
ce qui compte au moment d'un déploiement : un pipeline en cours retarde l'arrêt jusqu'à sa fin ou
jusqu'au délai de grâce.

Moteurs Python : **hors périmètre**. Un enchaînement d'étapes s'y exprime par des workers reliés par
le bus (UC-BUS-05) : chaque étape consomme un sujet et publie le suivant. C'est moins outillé, mais
c'est explicite, supervisable et déjà disponible.

## Exemples
### Ce qu'il faut savoir d'un pipeline existant
```
IDLE → STARTING → IDLE → RUNNING → DRAINING → SHUTDOWN
```
Pendant le drain, aucun nouveau pipeline ne démarre ; les pipelines actifs finissent.

### Moteurs Python — un enchaînement par le bus
```python
# Étape 1 : extraction
self._kv_bus.publish("etl/extracted", {"batch_id": batch_id, "rows": len(rows)})

# Étape 2 : un autre worker, abonné à ce sujet
def initialize(self) -> None:
    self._sub = self._kv_bus.subscribe("etl/extracted", "transform_worker", self._transform)

def _transform(self, message: dict) -> None:
    ...
    self._kv_bus.publish("etl/transformed", {"batch_id": message["batch_id"]})
```

## Pièges courants
- **Démarrer un nouveau traitement en V1** : on construit sur du déprécié.
- **Oublier l'effet du drain** : un pipeline long retarde chaque déploiement.
- **Migrer sans revoir le découpage** : la deuxième génération attend des étapes typées, ce qui est
  l'occasion de clarifier les contrats entre étapes.

## Cas d'usage voisins
- UC-PIP-02 — déclarer une étape typée (V2)
- UC-PIP-03 — orchestrer un pipeline V2
- UC-BUS-05 — publication fiable avec groupes
- UC-SUP-06 — drainer puis arrêter proprement
