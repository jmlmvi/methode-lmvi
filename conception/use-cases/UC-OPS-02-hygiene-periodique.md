---
id: UC-OPS-02
titre: "Hygiène périodique automatique"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "MaintenanceWorker, lease recovery, compaction, fichiers temporaires, K5"
---

# UC-OPS-02 — Hygiène périodique automatique

## Questions auxquelles répond ce cas d'usage
1. Qui nettoie les traces, les fichiers temporaires et les verrous abandonnés ?
2. Quelles opérations d'hygiène le socle fait-il tout seul ?
3. À quelle fréquence, et peut-on la régler ?
4. Comment forcer un passage de maintenance tout de suite ?
5. Comment savoir ce que la maintenance a fait depuis le démarrage ?
6. Dans les moteurs Python, qu'est-ce qui tient ce rôle ?
7. Peut-on y greffer son propre nettoyage applicatif ?

## Mots-clés
maintenance, hygiène, `MaintenanceWorker`, `trigger_maintenance`, verrous abandonnés,
lease recovery, compaction, fichiers temporaires, nettoyage, rétention, cycles,
`cycles_completed`, statistiques, K5, P-4

## Ce que c'est, et quand s'en servir
Le ménage qu'une application a besoin de faire régulièrement : récupérer des verrous laissés par une
instance disparue, compacter la base technique, supprimer les fichiers temporaires, nettoyer des
traces d'exécution. Un worker intégré s'en charge, à heure régulière.

Sans ce ménage, une application fonctionne très bien… pendant quelques mois.

## Ce que le socle fait · ce qu'il interdit
Java : le worker de maintenance enchaîne ses tâches d'hygiène, publie des compteurs cumulés (cycles
réussis, cycles en échec, verrous récupérés, fichiers supprimés) et expose une action pour forcer un
passage — asynchrone et à confirmation, parce qu'elle peut être longue.

Moteurs Python : phase **P-4**. En attendant, le ménage applicatif se fait dans un worker planifié
qu'on écrit soi-même (UC-WRK-02), et la purge de la base technique est un cas d'usage à part
(UC-DB-06).

Ce qu'il ne faut pas faire : un nettoyage qui supprime sans compter ni journaliser. Un ménage muet
qui efface trop ne se découvre que lorsqu'il manque quelque chose.

## Exemples
### Socle Java — forcer et observer
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"confirm":true}' localhost:8080/admin/workers/maintenance_worker/actions/trigger_maintenance

curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers \
  | jq '.workers.maintenance_worker.stats'
# {"cycles_completed": 48, "cycles_failed": 0, "temp_files_cleaned_total": 1203}
```

### Moteurs Python — son propre ménage, compté et journalisé
```python
class HousekeepingWorker(Worker):
    schedule = "0 4 * * *"

    def do_work(self) -> None:
        supprimes = self._purge_exports(older_than_days=self._retention_days)
        self._cleaned += supprimes
        log.info("[step:housekeeping_done] exports supprimés=%s", supprimes)

    def get_stats(self) -> dict:
        return {"cleaned_total": self._cleaned}
```

## Pièges courants
- **Nettoyer sans compter** : on ne sait pas si le ménage fonctionne, ni s'il a trop supprimé.
- **Tout nettoyer dans un seul cycle** : un passage trop lourd bloque la nuit entière. Par lots.
- **Oublier les verrous abandonnés** : une instance disparue laisse des traitements bloqués.
- **Confondre hygiène et purge métier** : supprimer des données métier est une décision
  fonctionnelle, pas du ménage.

## Cas d'usage voisins
- UC-DB-06 — purger selon une rétention
- UC-WRK-02 — planifier par cron
- UC-OPS-01 — piloter le système par commandes
- UC-SUP-11 — agréger et expédier un rapport d'erreurs
