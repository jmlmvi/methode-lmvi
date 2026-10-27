---
id: UC-WRK-08
titre: "Publier santé et statistiques d'un worker"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "is_healthy, get_stats, isHealthy, getStats, superviseur"
---

# UC-WRK-08 — Publier santé et statistiques d'un worker

## Questions auxquelles répond ce cas d'usage
1. Comment mon worker dit-il qu'il va bien, ou qu'il va mal ?
2. Que doit renvoyer la santé — l'état de l'instance, ou celui du système que j'appelle ?
3. Quelles statistiques l'exploitant attend-il d'un worker ?
4. Qui lit cette santé, et qu'est-ce qui se passe quand elle est fausse ?
5. Mon worker est sain alors que son initialisation a échoué : comment éviter ça ?
6. Puis-je mettre un appel réseau dans le contrôle de santé ?
7. Comment mes statistiques se retrouvent-elles dans les métriques et le tableau de bord ?

## Mots-clés
santé, `is_healthy`, `isHealthy`, statistiques, `get_stats`, `getStats`, sain, malade,
contrôle de santé, superviseur, redémarrage automatique, compteurs, `errors`, `last_error`,
sondes, `/health/ready`, tableau de bord, métriques

## Ce que c'est, et quand s'en servir
Deux méthodes que **tout** worker doit rendre honnêtes : l'une dit s'il est en état de travailler,
l'autre expose quelques compteurs utiles à l'exploitation. Elles ne servent pas à faire joli : le
superviseur s'appuie sur la santé pour redémarrer (UC-SUP-03), les sondes et le tableau de bord
s'appuient sur elles pour montrer l'état de l'instance.

Les statistiques utiles sont presque toujours les mêmes : nombre de cycles ou d'exécutions, nombre
d'erreurs, dernière erreur, horodatage du dernier succès, taille de ce qui est en attente.

## Ce que le socle fait · ce qu'il interdit
Le socle interroge la santé périodiquement, agrège les statistiques dans la liste des workers et
dans les sondes, et — selon la phase du moteur — déclenche les redémarrages. Il ne devine rien : un
worker qui renvoie toujours « sain » est un worker qu'on ne surveille pas.

Le contrôle de santé doit être **immédiat et sans effet de bord** : pas d'appel réseau, pas de
requête en base, pas de calcul. On observe un état déjà connu (un drapeau posé par l'initialisation,
l'horodatage du dernier succès), on ne va pas le chercher.

## Exemples
### socle-py-django et socle-py
```python
class CollectWorker(Worker):
    def __init__(self):
        self._initialized = False
        self._cycles = 0
        self._errors = 0
        self._last_error: str | None = None

    def initialize(self) -> None:
        ...                              # ce qui peut échouer
        self._initialized = True         # drapeau posé EN FIN d'initialisation

    def do_work(self) -> None:
        try:
            self._collect()
            self._cycles += 1
        except TimeoutError as exc:
            self._errors += 1
            self._last_error = str(exc)
            raise

    def is_healthy(self) -> bool:
        return self._initialized and self._errors < 5      # immédiat, sans effet de bord

    def get_stats(self) -> dict:
        return {"cycles": self._cycles, "errors": self._errors, "last_error": self._last_error}
```

### Socle Java
```java
@Override public boolean isHealthy() { return initialized && errors < 5; }
@Override public Map<String, Object> getStats() {
    return Map.of("cycles", cycles, "errors", errors, "last_error", lastError);
}
```

### Lire le résultat
```bash
curl localhost:8080/health/ready
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers
```

## Pièges courants
- **Se déclarer sain après une initialisation en échec** : poser le drapeau en fin
  d'initialisation, jamais au début (c'est un défaut qui a déjà été corrigé dans le Socle Java).
- **Mettre un appel réseau dans la santé** : la sonde devient lente, et une panne externe fait
  redémarrer un worker qui va bien.
- **Publier une statistique à `-1`** pour dire « je ne sais pas », tout en se déclarant sain :
  l'exploitant croit à une valeur. Dire explicitement que la mesure est indisponible.
- **Statistiques qui grossissent sans limite** (liste de toutes les erreurs) : des compteurs, pas
  un journal.

## Cas d'usage voisins
- UC-SUP-01 — répondre aux sondes de santé
- UC-SUP-03 — redémarrer automatiquement un worker malade
- UC-SUP-08 — exposer des métriques Prometheus
- UC-SUP-12 — tableau de bord d'exploitation
