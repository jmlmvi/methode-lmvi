---
id: UC-DB-01
titre: "Persister l'état technique d'une instance"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "TechDb, techdb.run, arun, save_worker_state, record_event, save_offset"
---

# UC-DB-01 — Persister l'état technique d'une instance

## Questions auxquelles répond ce cas d'usage
1. Où le socle garde-t-il ce qui doit survivre au redémarrage ?
2. Quelle est la différence entre la base technique et une base métier ?
3. Comment accéder à la base depuis un worker, et pourquoi pas directement ?
4. Puis-je créer mes propres tables dans cette base ?
5. Quelles informations le socle y écrit-il tout seul ?
6. Comment reprendre un traitement là où il s'était arrêté après une coupure ?
7. Que se passe-t-il si la base technique est désactivée ?

## Mots-clés
TechDB, base technique, `TechDb`, `techdb.run`, `techdb.arun`, persistance, survit au redémarrage,
`techdb_*`, état des workers, `save_worker_state`, événements, `record_event`, offsets,
`save_offset`, `get_offset`, audit, reprise, `TECHDB_ENABLED`

## Ce que c'est, et quand s'en servir
La base **technique** de l'instance : l'état des workers, les événements du socle, les offsets de
reprise, l'audit des actions. Elle existe pour que le redémarrage ne soit pas une amnésie.

On y met aussi ses propres tables métier quand l'application en a besoin — avec les conventions de
partitionnement par tenant (UC-DB-09). Ce qui n'y va pas : les données de travail volatiles, qui
appartiennent au bus (UC-BUS-01).

L'accès passe **toujours** par le composant fourni : il tient la connexion, applique les migrations
au démarrage, et protège la boucle d'événements.

## Ce que le socle fait · ce qu'il interdit
Le socle crée et fait évoluer son schéma (UC-DB-03), écrit lui-même l'état des workers, les
événements et l'audit, et expose des opérations de lecture et d'écriture. Il garantit que le même
schéma `techdb_*` est utilisé par les trois moteurs — c'est un point de contrat, pas un détail
d'implémentation.

Dans les moteurs Python, l'ORM est **interdit dans la boucle d'événements** : tout accès passe par
l'accesseur synchrone depuis du code synchrone, ou par sa variante asynchrone depuis du code
asynchrone (UC-WRK-11). La revue de code refuse le mélange.

## Exemples
### socle-py-django et socle-py
```python
class ReportWorker(Worker):
    def __init__(self, techdb: TechDb):        # injecté : on ne construit pas de connexion
        self.techdb = techdb

    def do_work(self) -> None:
        # Code synchrone → accesseur synchrone.
        rows = self.techdb.run(lambda: selectors.OrderSelector.get_all())
        self.techdb.record_event("report_generated", self.name, datas=f"{len(rows)} lignes")

    async def _async_path(self) -> None:
        # Code asynchrone → accesseur asynchrone.
        await self.techdb.arun(lambda: mutators.ReportMutator.save(...))
```

### Reprendre où l'on s'était arrêté
```python
depuis = self.techdb.get_offset("collect_worker:orders") or 0
...
self.techdb.save_offset("collect_worker:orders", topic="orders", value=dernier_id)
```

### Socle Java
```java
techDb.execute("INSERT INTO x_orders (x_partition, reference) VALUES (?, ?)", partition, reference);
List<Map<String, Object>> rows = techDb.query("SELECT * FROM TECHDB_WORKER_STATES");
```

## Pièges courants
- **Ouvrir sa propre connexion** : on perd les migrations, la configuration et la supervision.
- **Mélanger l'accès synchrone et l'asynchrone** : erreur à l'exécution, souvent tardive.
- **Y stocker des données volumineuses de travail** : la base technique n'est pas un entrepôt.
- **Oublier qu'elle peut être désactivée** (`TECHDB_ENABLED=false` pour une application sans
  persistance) : un worker qui en dépend doit le dire clairement au démarrage.
- **Écrire dans les tables `techdb_*` du socle** : elles appartiennent au contrat. Vos tables sont
  les vôtres, préfixées `x_`.

## Cas d'usage voisins
- UC-DB-02 — choisir le moteur
- UC-DB-03 — migrations tracées
- UC-DB-09 — isoler les données métier par tenant
- UC-WRK-11 — travail bloquant ou asynchrone
