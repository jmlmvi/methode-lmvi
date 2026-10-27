---
id: UC-BUS-08
titre: "Changer d'implémentation de bus (mémoire vers Redis)"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "KvBus interface, implémentation Redis, kv.implementation"
---

# UC-BUS-08 — Changer d'implémentation de bus (mémoire vers Redis)

## Questions auxquelles répond ce cas d'usage
1. Puis-je partager le bus entre plusieurs instances de mon application ?
2. Comment passer du bus en mémoire à Redis sans réécrire mes workers ?
3. Qu'est-ce qui change dans le comportement quand le bus devient distribué ?
4. Mon code Python peut-il déjà compter sur un bus partagé ?
5. Si le bus distribué n'existe pas dans mon moteur, comment coordonner deux instances ?
6. Comment savoir quelle implémentation tourne réellement ?

## Mots-clés
implémentation de bus, interchangeable, Redis, bus distribué, partagé entre instances,
`getImplementationType`, en mémoire, in-memory, horizontal, mise à l'échelle, hors périmètre,
interface `KvBus`, verrou distribué, coordination

## Ce que c'est, et quand s'en servir
Les workers ne parlent qu'à une **interface** de bus : l'implémentation est un choix de
configuration. Dans le Socle Java, l'implémentation en mémoire peut être remplacée par une
implémentation Redis, ce qui rend le bus commun à plusieurs instances — et permet alors la
coordination et le partage de charge entre instances.

Le besoin apparaît dès qu'on passe à plusieurs instances derrière la Gateway : un verrou pris dans
une instance n'empêche rien dans l'autre, et un événement publié dans l'une ne réveille personne
dans l'autre.

## Ce que le socle fait · ce qu'il interdit
Java : l'interface est la même, le comportement est celui de l'implémentation choisie ; le type
d'implémentation est lisible à l'exécution.

**Moteurs Python : hors périmètre déclaré.** La spécification signée ne porte que le bus en
mémoire ; seule l'interface est prévue pour qu'une autre implémentation reste possible plus tard.
Concrètement, dans un backend Python, tout ce qui touche au bus est **local à l'instance**.

Ce qu'il ne faut donc pas faire en Python : fonder une exclusion mutuelle ou un comptage global sur
le bus en imaginant qu'il sera partagé. Pour coordonner plusieurs instances, on passe par la base :
une contrainte d'unicité, une ligne d'état, une transaction (UC-DOM-06, UC-DB-01).

## Exemples
### Socle Java — bascule par configuration
```yaml
socle:
  kv:
    implementation: redis        # ou memory
    redis: {host: ${REDIS_HOST:localhost}, port: 6379}
```
```java
logger.info("[step:kv_implementation] {}", kvBus.getImplementationType());
```

### Moteurs Python — ce qu'on fait à la place
```python
# Un seul traitement, même avec plusieurs instances : c'est la base qui arbitre.
try:
    mutators.JobMutator.claim(partition=partition, job_key=key)   # contrainte d'unicité
except db.IntegrityError:
    return                       # une autre instance l'a pris
```

## Pièges courants
- **Supposer le bus partagé** parce que le code marche sur une seule instance : le défaut
  n'apparaît qu'en production, à la deuxième instance.
- **Mettre un verrou dans le bus pour un traitement critique** en Python : local, donc inopérant
  entre instances.
- **Attendre de Redis une sémantique identique** : persistance, latence et expiration ne se
  comportent pas comme en mémoire. Vérifier les cas de bord après bascule.

## Cas d'usage voisins
- UC-BUS-01 — clé/valeur avec expiration
- UC-BUS-02 — opérations atomiques
- UC-DB-01 — persister l'état technique
- UC-DOM-06 — porter l'intégrité par des contraintes en base
