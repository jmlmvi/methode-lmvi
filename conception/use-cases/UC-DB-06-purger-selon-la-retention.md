---
id: UC-DB-06
titre: "Purger la TechDB selon une rétention"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: P-3
  socle-py-django: P-3
contrat: "5.9"
mecanismes: "purge, rétention, MaintenanceWorker, K1"
---

# UC-DB-06 — Purger la TechDB selon une rétention

## Questions auxquelles répond ce cas d'usage
1. Ma base technique grossit sans fin : que faut-il supprimer, et à partir de quand ?
2. Quelles tables ont une rétention, et laquelle est la plus volumineuse ?
3. La purge est-elle automatique, ou faut-il la déclencher ?
4. Comment purger sans bloquer l'instance pendant plusieurs minutes ?
5. Que perd-on exactement en purgeant — peut-on encore auditer après ?
6. Comment la rétention se configure-t-elle, et quelle valeur est raisonnable ?
7. Dans les moteurs Python, comment tenir la taille en attendant la purge outillée ?

## Mots-clés
purge, rétention, `retention-days`, nettoyage, volumétrie, croissance, audit,
`techdb_worker_actions`, `techdb_events`, `MaintenanceWorker`, hygiène, suppression par lots,
conservation légale, P-3

## Ce que c'est, et quand s'en servir
Les tables d'audit et d'événements grossissent à chaque invocation et à chaque incident. La purge
supprime les lignes plus anciennes qu'une durée de conservation choisie — c'est une opération
d'hygiène, pas un correctif d'urgence.

À prévoir **avant** la mise en production : une application qui tourne un an sans purge finit par
avoir une base technique plus volumineuse que ses données métier.

## Ce que le socle fait · ce qu'il interdit
Java : la purge est outillée, pilotable par action et exécutable périodiquement par le worker
d'hygiène (UC-OPS-02), avec la rétention en configuration. Le correctif de portabilité SQL mentionné
pour la TechDB touchait précisément la purge : c'est un endroit où le dialecte compte.

**Moteurs Python : phase P-3.** En attendant, on surveille la volumétrie et on purge par une tâche
d'exploitation ; ce qu'il ne faut pas faire, c'est une suppression massive en une transaction sur
une grosse table — elle verrouille et s'étire. On supprime par lots.

Et avant de purger : vérifier les obligations de conservation. L'audit des actions peut être une
pièce de conformité (UC-ACT-06).

## Exemples
### Configuration de la rétention
```yaml
socle:
  techdb:
    retention-days: ${TECHDB_RETENTION_DAYS:30}
```

### Purge par lots (en attendant P-3)
```python
@action("purge_events", description="Supprime les événements plus anciens que la rétention",
        required_scope="techdb.admin", requires_confirmation=True)
@param("days", type=ParameterType.INTEGER, min_value=1, max_value=3650, default=30)
def purge_events(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    supprimees = 0
    while True:                     # par lots : ni verrou long, ni transaction géante
        lot = self.techdb.execute_returning_count(
            "DELETE FROM techdb_events WHERE x_id IN "
            "(SELECT x_id FROM techdb_events WHERE x_datecreated < %s LIMIT 1000)",
            (limite,))
        supprimees += lot
        if lot == 0:
            break
    return ActionResult.ok({"deleted": supprimees})
```

### Surveiller la volumétrie
```sql
SELECT COUNT(*) FROM techdb_worker_actions;
SELECT COUNT(*) FROM techdb_events;
```

## Pièges courants
- **Purger en une seule transaction** : verrou long, journal de transactions gonflé, instance
  ralentie.
- **Purger l'audit sans vérifier les obligations** : on détruit une pièce de conformité.
- **Attendre la saturation du disque** pour découvrir le sujet : surveiller la volumétrie dès la
  mise en service.
- **Rétention identique pour tout** : un événement de démarrage et un audit d'action n'ont pas la
  même valeur.
- **Oublier que le dialecte compte** : la requête de purge est un endroit classique de SQL non
  portable.

## Cas d'usage voisins
- UC-DB-07 — sauvegarder et restaurer
- UC-OPS-02 — hygiène périodique automatique
- UC-ACT-06 — auditer les invocations
- UC-DB-02 — choisir le moteur
