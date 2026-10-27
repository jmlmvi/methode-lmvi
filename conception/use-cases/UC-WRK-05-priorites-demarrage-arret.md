---
id: UC-WRK-05
titre: "Ordonner démarrage et arrêt par priorités"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "start_priority, stop_priority, getStartPriority, RG-04"
---

# UC-WRK-05 — Ordonner démarrage et arrêt par priorités

## Questions auxquelles répond ce cas d'usage
1. Mon worker a besoin qu'un autre soit prêt avant lui : comment l'imposer ?
2. Quel nombre démarre en premier, le plus petit ou le plus grand ?
3. Comment faire en sorte qu'un worker s'arrête en dernier, après ceux qui l'utilisent ?
4. Que vaut la priorité si je ne la déclare pas ?
5. Deux workers portent la même priorité : dans quel ordre passent-ils ?
6. Peut-on créer une dépendance entre workers par un import direct plutôt qu'une priorité ?
7. Comment vérifier l'ordre réellement appliqué au démarrage ?

## Mots-clés
priorité, `start_priority`, `stop_priority`, `getStartPriority`, `getStopPriority`, ordre de
démarrage, ordre d'arrêt, dépendance entre workers, 100 par défaut, RG-04, séquence,
initialisation ordonnée, arrêt ordonné, drain

## Ce que c'est, et quand s'en servir
Deux entiers, un pour le démarrage, un pour l'arrêt : **le plus petit passe en premier**. Le défaut
est 100 partout, donc tant qu'on ne touche à rien, l'ordre n'est pas garanti — et c'est très bien
pour des workers indépendants.

On s'en sert quand un worker en prépare un autre : celui qui charge un référentiel en mémoire
démarre avant celui qui le consulte ; celui qui tient une connexion s'arrête après ceux qui s'en
servent. L'ordre d'arrêt n'est pas l'inverse automatique de l'ordre de démarrage : il se déclare.

## Ce que le socle fait · ce qu'il interdit
Le socle trie les workers à chaque phase et conduit la séquence : initialisation, démarrage, puis
à l'arrêt le drain (plus aucune échéance ne démarre) suivi des arrêts dans l'ordre déclaré.

Les priorités ne créent pas une dépendance d'objets : elles ordonnent le temps. Un worker ne doit
jamais importer un autre worker pour l'appeler directement — on passe par le bus interne
(UC-BUS-03), par le registre partagé (UC-WRK-12) ou par un service du domaine.

## Exemples
### socle-py-django et socle-py
```python
class ReferentialWorker(Worker):     # charge le référentiel
    start_priority = 10              # démarre tôt
    stop_priority = 200              # s'arrête tard

class QuoteWorker(Worker):           # consulte le référentiel
    start_priority = 100             # démarre après
    stop_priority = 100              # s'arrête avant
```

### Socle Java
```java
@Override public int getStartPriority() { return 10; }
@Override public int getStopPriority()  { return 200; }
```

### Vérifier l'ordre appliqué
```bash
… [step:worker_initialized] referential_worker
… [step:worker_initialized] quote_worker
… [step:mop_running] 2 workers started
```

## Pièges courants
- **Croire que le plus grand démarre d'abord.** C'est l'inverse : 10 passe avant 100.
- **Oublier l'arrêt.** Un worker qui ferme une ressource trop tôt fait échouer l'arrêt des autres.
- **Tout prioriser.** Si chaque worker a sa valeur unique, le démarrage devient un ordre total
  fragile à maintenir. Ne déclarer que les contraintes réelles.
- **Remplacer une priorité par une attente** (« je dors deux secondes, le temps que l'autre soit
  prêt ») : interdit, et faux dès que la machine est chargée.

## Cas d'usage voisins
- UC-WRK-04 — découverte automatique
- UC-WRK-12 — partager un état entre workers
- UC-SUP-06 — drainer puis arrêter proprement
- UC-BUS-03 — publier un événement
