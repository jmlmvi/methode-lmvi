---
id: UC-WRK-01
titre: "Exécuter une tâche toutes les N millisecondes"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "cycle_interval_ms, getCycleIntervalMs, do_work, Orchestrator"
---

# UC-WRK-01 — Exécuter une tâche toutes les N millisecondes

## Questions auxquelles répond ce cas d'usage
1. Comment faire tourner un traitement en boucle, par exemple toutes les trente secondes ?
2. Où écrit-on le code d'un rafraîchissement de cache périodique ?
3. Pourquoi ai-je l'interdiction d'écrire `while True` + `sleep` dans un worker ?
4. Mon traitement périodique lève une exception : est-ce que la planification s'arrête ?
5. Quelle est la différence entre un intervalle et une expression cron, et lequel choisir ?
6. Je veux que mon worker ne tourne plus, sans le supprimer — que vaut un intervalle à zéro ?
7. Mon worker interroge une API lente : est-ce que je bloque l'application entière ?
8. Comment le socle décide-t-il du moment de la première exécution ?

## Mots-clés
intervalle, polling, cadence, période, périodique, toutes les N secondes, `cycle_interval_ms`,
`getCycleIntervalMs`, `do_work`, `doWork`, planification, scheduler, orchestrateur, boucle,
`while True` interdit, `sleep` interdit, rafraîchissement, collecte, nettoyage,
`SimplePollingWorker`, `simple_polling_worker.py`, RG-01

## Ce que c'est, et quand s'en servir
Le cas le plus courant : un travail unitaire que l'on veut voir se répéter à cadence fixe —
contrôler l'état d'un système tiers, rafraîchir un cache, collecter des mesures, nettoyer des
fichiers temporaires. On écrit **le travail d'un seul cycle**, et c'est l'orchestrateur qui rappelle
la méthode à chaque échéance.

Choisir l'intervalle quand la **fréquence** importe (« toutes les 30 s ») ; choisir une expression
cron (UC-WRK-02) quand c'est l'**heure** qui importe (« chaque jour à 3 h »). Un intervalle
inférieur à la durée réelle d'un cycle ne fait pas se chevaucher deux exécutions : l'échéance
suivante attend la fin de la précédente.

## Ce que le socle fait · ce qu'il interdit
Le socle planifie, appelle, mesure, journalise et continue : une exception levée par un cycle est
tracée (`[step:scheduler_task_error]`) et **n'arrête pas** la planification. Le travail n'est appelé
que lorsque l'instance est en service (RG-01) ; pendant le drain, plus aucun cycle ne démarre.

Interdits, dans les trois moteurs : la boucle infinie, l'attente active, le fil d'exécution créé à
la main, la tâche asynchrone lancée soi-même, l'annotation de planification d'un autre framework.
Un worker qui gère lui-même son temps échappe au drain, aux statistiques et au superviseur — c'est
pour cela que la revue de code le refuse (règle C13 en Python).

## Exemples
### socle-py-django et socle-py
```python
class CacheRefreshWorker(Worker):
    cycle_interval_ms = 30_000          # un cycle toutes les 30 s
    start_priority = 100

    def __init__(self, kv_bus: KvBus):  # dépendances annotées : injectées à la découverte
        self._kv_bus = kv_bus
        self._cycles = 0

    @property
    def name(self) -> str:
        return "cache_refresh_worker"

    def do_work(self) -> None:          # le travail d'UN cycle, et rien de plus
        self._cycles += 1
        self._kv_bus.set("cache:last_refresh_ms", int(time.time() * 1000))

    def is_healthy(self) -> bool:
        return True

    def get_stats(self) -> dict:
        return {"cycles": self._cycles}
```
Travail bloquant (requête synchrone, fichier, calcul long) : garder `def do_work`, que le socle
exécute hors de la boucle d'événements. `async def do_work` ne doit rien bloquer (UC-WRK-11).

### Socle Java
```java
@Component
public class CacheRefreshWorker implements Worker {
    @Override public String getName() { return "cache_refresh_worker"; }
    @Override public long getCycleIntervalMs() { return 30_000L; }
    @Override public void doWork() { /* le travail d'un cycle */ }
    @Override public boolean isHealthy() { return true; }
    @Override public Map<String, Object> getStats() { return Map.of("cycles", cycles); }
}
```

### Observer de l'extérieur
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers
# { "cache_refresh_worker": { "stats": {"cycles": 42}, "healthy": true, "enabled": true }, … }
```

## Pièges courants
- **Mettre la boucle dans le travail.** Un cycle = un passage. La répétition est le métier de
  l'orchestrateur.
- **Un intervalle trop court sur une tâche lourde** : les cycles s'enchaînent sans répit et la
  machine ne fait plus que ça. Mesurer la durée d'un cycle avant de choisir la cadence.
- **Oublier que l'intervalle ≤ 0 rend le worker passif** : il est démarré mais ne tourne jamais.
  C'est utile (UC-WRK-03), déroutant quand c'est involontaire.
- **Compter sur la régularité pour mesurer le temps** : l'échéance peut glisser. Lire l'heure dans
  le cycle, ne pas la déduire du nombre de cycles.

## Cas d'usage voisins
- UC-WRK-02 — planifier par cron quand c'est l'heure qui compte
- UC-WRK-03 — worker passif, piloté par ses seules actions
- UC-WRK-11 — travail bloquant ou asynchrone
- UC-SUP-05 — déclencher un worker planifié hors de son cycle
