---
id: UC-SUP-05
titre: "Déclencher hors cycle un worker planifié"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "trigger_now, déclenchement manuel, B6"
---

# UC-SUP-05 — Déclencher hors cycle un worker planifié

## Questions auxquelles répond ce cas d'usage
1. Comment lancer tout de suite un traitement prévu pour 3 h du matin ?
2. Le déclenchement manuel décale-t-il les échéances suivantes ?
3. Que se passe-t-il si le worker est déjà en train de travailler ?
4. Qui peut déclencher, et l'opération est-elle auditée ?
5. Comment tester un worker cron sans manipuler l'horloge ?
6. Dans les moteurs Python, comment déclencher aujourd'hui ?
7. Faut-il exposer une action de déclenchement dans son propre worker ?

## Mots-clés
déclenchement, hors cycle, manuel, `trigger_now`, cron, échéance, exécution immédiate,
rattrapage, exploitation, test, horloge, concurrence, action dédiée, audit, P-4

## Ce que c'est, et quand s'en servir
Forcer l'exécution d'un travail planifié, maintenant. Deux usages : l'exploitation (on ne veut pas
attendre la nuit pour rejouer un traitement corrigé) et le test (on vérifie le travail sans
manipuler le temps).

C'est aussi le bon réflexe quand une échéance a été manquée : le socle ne rattrape pas (UC-WRK-02),
donc on déclenche.

## Ce que le socle fait · ce qu'il interdit
L'orchestrateur sait déclencher une échéance immédiatement, et c'est ce que les tests utilisent. Son
exposition en exploitation relève de la phase **P-4** dans les moteurs Python ; elle existe côté
Java.

Le déclenchement n'autorise pas deux exécutions simultanées du même travail : l'intérêt du modèle
est précisément qu'un worker ne se chevauche pas lui-même.

En attendant, le motif recommandé est une **action dédiée** qui appelle la même méthode privée que
le travail planifié. Jamais une action qui appelle le travail de cycle : la logique commune va dans
une méthode privée, appelée par les deux.

## Exemples
### En test
```python
schedule = orchestrator.schedules["nightly_purge_worker"]
assert schedule.trigger_now()
await eventually(lambda: worker.runs == 1)
```

### En exploitation, avec une action dédiée
```python
class NightlyPurgeWorker(Worker, ActionProvider):
    schedule = "0 3 * * *"

    def do_work(self) -> None:
        self._purge()                        # le travail planifié

    @action("purge_now", description="Lance la purge immédiatement",
            required_scope="ops.write", requires_confirmation=True)
    def purge_now(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
        return ActionResult.ok({"deleted": self._purge()})   # même méthode privée

    def _purge(self) -> int:
        ...
```

### Socle Java
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
  localhost:8080/supervision/workers/nightly_purge_worker/trigger
```

## Pièges courants
- **Appeler le travail de cycle depuis une action** : on duplique la planification et on perd le
  contrôle de la concurrence. Méthode privée commune.
- **Déclencher un traitement non idempotent** : deux exécutions, deux effets.
- **Déclencher sans confirmation ni scope** : une purge lancée par mégarde.
- **Croire que le déclenchement décale la suite** : l'échéance normale reste prévue.

## Cas d'usage voisins
- UC-WRK-02 — planifier par cron
- UC-SUP-04 — redémarrer un worker à la main
- UC-ACT-05 — lecture seule et confirmation requise
- UC-OPS-01 — piloter le système par commandes
