---
id: UC-BUS-02
titre: "Opérations atomiques (incrément, compare-and-set)"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "incr, compare_and_set, set_if_not_exists"
---

# UC-BUS-02 — Opérations atomiques (incrément, compare-and-set)

## Questions auxquelles répond ce cas d'usage
1. Comment compter des événements sans perdre d'incréments quand ça arrive en parallèle ?
2. Deux workers risquent de traiter la même chose : comment en élire un seul ?
3. Qu'est-ce qu'un compare-and-set, et quand en a-t-on vraiment besoin ?
4. Comment poser un verrou léger avec expiration automatique ?
5. Pourquoi lire-puis-écrire est-il faux, alors que ça marche en test ?
6. Ces garanties tiennent-elles entre plusieurs instances de l'application ?
7. Que renvoient ces opérations quand la clé n'existe pas encore ?

## Mots-clés
atomique, atomicité, `incr`, incrément, compteur, `compare_and_set`, `compareAndSet`,
`set_if_not_exists`, `setIfNotExists`, verrou, verrou léger, lock, élection, exclusion mutuelle,
concurrence, course, race condition, perte de mise à jour

## Ce que c'est, et quand s'en servir
Trois opérations qui s'exécutent d'un bloc : incrémenter, remplacer une valeur **si** elle vaut
encore ce qu'on croit, écrire **seulement si** la clé est libre. Ce sont elles qui permettent de
compter juste et de coordonner deux workers sans se raconter d'histoires.

Les usages typiques : un compteur d'événements, un garde qui n'autorise qu'un seul traitement à la
fois, l'élection du worker qui fera la tâche quand plusieurs pourraient la faire.

## Ce que le socle fait · ce qu'il interdit
Le socle garantit l'atomicité **au sein de l'instance** : les opérations ne s'entrelacent pas. Les
trois moteurs exposent les mêmes primitives, avec les mêmes noms au style près.

Ce qui n'est pas garanti : la coordination entre plusieurs instances derrière la Gateway, puisque
le bus en mémoire est local. Pour un verrou réellement partagé, il faut une ressource partagée —
une contrainte d'unicité en base (UC-DOM-06), ou une implémentation distribuée du bus (UC-BUS-08,
hors périmètre Python).

## Exemples
### socle-py-django et socle-py
```python
total = self._kv_bus.incr("collect_worker:events")          # renvoie la valeur après incrément
self._kv_bus.incr("collect_worker:bytes", delta=len(payload))

# Verrou léger : un seul passe, et il se libère tout seul si le worker meurt.
if not self._kv_bus.set_if_not_exists("collect_worker:lock", self.name, ttl_seconds=60):
    return                                                  # un autre traite déjà

# Transition d'état sûre : n'écrase pas une valeur qu'un autre aurait changée entre-temps.
if self._kv_bus.compare_and_set("collect_worker:state", "IDLE", "RUNNING"):
    ...
```

### Socle Java
```java
long total = kvBus.incr("collect_worker:events");
boolean pris = kvBus.setIfNotExists("collect_worker:lock", getName());
boolean bascule = kvBus.compareAndSet("collect_worker:state", "IDLE", "RUNNING");
```

## Pièges courants
- **Lire, calculer, écrire** : sous charge, deux cycles lisent la même valeur et l'un des deux
  incréments disparaît. C'est le défaut que ces opérations existent pour éviter.
- **Verrou sans expiration** : un worker qui meurt en le tenant bloque le traitement pour toujours.
- **Croire à un verrou distribué** : le bus est local à l'instance.
- **Utiliser un compteur comme horloge** (« au centième cycle, il est midi ») : lire l'heure.
- **Oublier de tester le retour** de l'écriture conditionnelle : le code croit avoir pris le verrou.

## Cas d'usage voisins
- UC-BUS-01 — clé/valeur avec expiration
- UC-BUS-07 — rendre un consommateur idempotent
- UC-DOM-06 — porter l'intégrité par des contraintes en base
- UC-BUS-08 — changer d'implémentation de bus
