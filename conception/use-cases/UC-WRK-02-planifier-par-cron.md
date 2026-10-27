---
id: UC-WRK-02
titre: "Exécuter une tâche à heure fixe (cron)"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "schedule, getSchedule, alias @daily, CronWorker"
---

# UC-WRK-02 — Exécuter une tâche à heure fixe (cron)

## Questions auxquelles répond ce cas d'usage
1. Comment lancer un traitement chaque nuit à 3 h, ou chaque lundi matin ?
2. Quelle syntaxe d'expression cron le socle accepte-t-il — cinq champs, six champs, des alias ?
3. Mon expression est refusée au démarrage : que signifie `[step:worker_cron_invalid]` ?
4. Dans quel fuseau horaire l'heure est-elle interprétée ?
5. L'instance était arrêtée à l'heure prévue : le traitement est-il rattrapé au redémarrage ?
6. Puis-je rendre l'horaire configurable au lieu de le figer dans le code ?
7. Comment tester un worker cron sans attendre 3 h du matin ?

## Mots-clés
cron, crontab, expression cron, cinq champs, `@daily`, `@hourly`, `@weekly`, `@monthly`,
`@yearly`, heure fixe, planification horaire, nocturne, batch de nuit, `schedule`, `getSchedule`,
`CronWorker`, `cron_worker.py`, fuseau horaire, rattrapage, RG-03

## Ce que c'est, et quand s'en servir
Quand l'exécution doit tomber à un **moment** précis plutôt qu'à une fréquence : clôture
quotidienne, purge nocturne, envoi d'un relevé hebdomadaire, export en fin de mois. On déclare une
expression cron à cinq champs (`minute heure jour-du-mois mois jour-de-semaine`) ou un alias
(`@daily`, `@hourly`, `@weekly`, `@monthly`, `@yearly`).

Si l'heure n'a pas d'importance, préférer l'intervalle (UC-WRK-01) : il est plus simple à lire et à
régler.

## Ce que le socle fait · ce qu'il interdit
Le socle valide l'expression **au démarrage** et refuse une instance mal configurée plutôt que de
laisser un worker muet. Il calcule les échéances, appelle le travail, et n'appelle rien pendant le
drain. Une exception est tracée et n'empêche pas la prochaine échéance.

Il n'y a **pas de rattrapage** : une échéance manquée parce que l'instance était arrêtée est
perdue. Un traitement qui doit absolument passer se rend idempotent et vérifie lui-même ce qui reste
à faire — c'est plus sûr que d'espérer une exécution.

## Exemples
### socle-py-django et socle-py
```python
class NightlyPurgeWorker(Worker):
    schedule = "0 3 * * *"                 # chaque jour à 3 h 00

    def __init__(self, config: SocleConfig):
        # Horaire configurable : la valeur du code n'est qu'un défaut.
        self.schedule = config.raw.as_str("app.purge.schedule", "0 3 * * *")
        self._retention_days = config.raw.as_int("app.purge.retention-days", 7)

    @property
    def name(self) -> str:
        return "nightly_purge_worker"

    def do_work(self) -> None:
        ...                                 # le travail d'une échéance
```

### Socle Java
```java
@Component
public class NightlyPurgeWorker implements Worker {
    @Override public String getName() { return "nightly_purge_worker"; }
    @Override public String getSchedule() { return "0 3 * * *"; }   // ou "@daily"
    @Override public void doWork() { /* … */ }
}
```

### Déclencher sans attendre l'heure
En test, on déclenche l'échéance à la main plutôt que d'avancer l'horloge ; en exploitation, c'est
l'action de déclenchement (UC-SUP-05).
```python
schedule = orchestrator.schedules["nightly_purge_worker"]
assert schedule.mode == "cron" and schedule.cron.resolved == "0 3 * * *"
schedule.trigger_now()
```

## Pièges courants
- **Six champs** (avec les secondes) : le contrat en attend cinq. Une expression à six champs est
  refusée au démarrage.
- **Supposer le fuseau du client** : l'heure est celle de l'instance. Pour une heure locale
  métier, convertir explicitement, et le dire dans la configuration.
- **Compter sur le rattrapage** : il n'existe pas. Rendre le traitement idempotent.
- **Figer l'horaire dans le code** : l'exploitant ne peut plus le changer sans livraison. Le lire
  dans la configuration, avec un défaut.
- **Confondre `PASSIVE` et une expression** : `PASSIVE` n'est pas un horaire, c'est l'absence de
  planification (UC-WRK-03).

## Cas d'usage voisins
- UC-WRK-01 — planifier par intervalle
- UC-WRK-03 — worker passif
- UC-SUP-05 — déclencher hors cycle
- UC-CFG-04 — lire une clé de configuration typée
