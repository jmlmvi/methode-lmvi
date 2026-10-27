---
id: UC-OPS-04
titre: "Limiter une ressource par sémaphores nommés"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "SemaphoreManager, acquisition, état, mutex légère"
---

# UC-OPS-04 — Limiter une ressource par sémaphores nommés

## Questions auxquelles répond ce cas d'usage
1. Comment limiter à N le nombre de traitements simultanés sur une ressource ?
2. Quelle différence avec un limiteur de débit ?
3. Comment faire une exclusion mutuelle légère entre deux traitements ?
4. Que se passe-t-il si un détenteur meurt sans libérer ?
5. Ces sémaphores fonctionnent-ils entre plusieurs instances ?
6. Dans les moteurs Python, par quoi les remplacer ?

## Mots-clés
sémaphore, `SemaphoreManager`, concurrence, limite, N simultanés, acquisition,
libération, mutex, exclusion mutuelle, ressource partagée, fuite de permis,
expiration, limiteur de débit, hors périmètre

## Ce que c'est, et quand s'en servir
Un compteur de permis nommé : on en prend un avant d'utiliser une ressource, on le rend après. Il
sert à **borner la concurrence** — trois imports simultanés au maximum, un seul recalcul à la fois —
là où un limiteur de débit borne un **rythme** (UC-RES-03). Les deux se complètent.

## Ce que le socle fait · ce qu'il interdit
Java : un gestionnaire crée des sémaphores à l'exécution, gère l'acquisition avec délai, la
libération et la lecture d'état ; il sert aussi de mutex légère.

Moteurs Python : **hors périmètre déclaré**. L'équivalent le plus proche et le plus sûr est la
base : une contrainte d'unicité ou une ligne d'état qui matérialise le droit d'exécuter
(UC-DOM-06). L'écriture atomique dans le bus (UC-BUS-02) convient à l'intérieur d'une seule
instance, mais pas entre instances — et c'est une limite à connaître avant de s'y fier.

Dans tous les cas, deux règles : libérer dans un bloc garanti, et borner la durée de détention,
sinon un détenteur disparu bloque tout le monde.

## Exemples
### Socle Java
```java
if (semaphoreManager.tryAcquire("import", Duration.ofSeconds(5))) {
    try { importer(); } finally { semaphoreManager.release("import"); }   // libération garantie
}
```

### Moteurs Python — verrou local à l'instance
```python
if not self._kv_bus.set_if_not_exists("import:lock", self.name, ttl_seconds=600):
    return                                  # un autre traitement est en cours
try:
    self._import()
finally:
    self._kv_bus.delete("import:lock")      # libération garantie
```

### Moteurs Python — verrou réellement partagé
```python
try:
    mutators.JobMutator.claim(partition=partition, job_key="import")   # contrainte d'unicité
except db.IntegrityError:
    return                                   # une autre instance l'a pris
```

## Pièges courants
- **Oublier de libérer** en cas d'exception : utiliser un bloc garanti, toujours.
- **Pas d'expiration** : un détenteur mort bloque la ressource indéfiniment.
- **Croire un verrou en mémoire partagé entre instances** : il ne l'est pas.
- **Confondre sémaphore et limiteur de débit** : l'un borne la simultanéité, l'autre le rythme.
- **Un délai d'acquisition infini** : on remplace la limite par une file d'attente invisible.

## Cas d'usage voisins
- UC-RES-03 — limiter le débit
- UC-BUS-02 — opérations atomiques
- UC-DOM-06 — porter l'intégrité par des contraintes en base
- UC-BUS-08 — changer d'implémentation de bus
