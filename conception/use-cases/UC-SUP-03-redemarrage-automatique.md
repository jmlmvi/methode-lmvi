---
id: UC-SUP-03
titre: "Redémarrer automatiquement un worker malade"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "superviseur, contrôles en échec, workers intégrés exclus, RG-06"
---

# UC-SUP-03 — Redémarrer automatiquement un worker malade

## Questions auxquelles répond ce cas d'usage
1. Que fait le socle quand un worker se déclare malade ?
2. Combien de contrôles en échec faut-il avant un redémarrage ?
3. Tous les workers sont-ils redémarrables, ou y a-t-il des exclusions ?
4. Que se passe-t-il si le redémarrage ne suffit pas ?
5. Un redémarrage de worker perd-il l'état en mémoire ?
6. Dans les moteurs Python, cette supervision existe-t-elle déjà ?
7. Comment éviter des redémarrages en boucle sur une panne externe ?

## Mots-clés
superviseur, redémarrage automatique, worker malade, contrôles en échec, seuil,
`isHealthy`, workers intégrés exclus, RG-06, RG-07, escalade, boucle de redémarrage,
état perdu, panne externe, P-4

## Ce que c'est, et quand s'en servir
Un surveillant interne interroge périodiquement la santé des workers et **redémarre** celui qui va
mal après un nombre donné de contrôles en échec. L'intention est de récupérer d'une panne transitoire
sans intervention humaine.

C'est utile pour un worker qui tient une ressource qui peut se casser — une connexion, un client, un
cache corrompu. Ce n'est pas une solution à une panne externe durable : redémarrer en boucle un
worker dont le fournisseur est en panne ne fait que du bruit (UC-RES-01 répond mieux).

## Ce que le socle fait · ce qu'il interdit
Java : le superviseur contrôle, compte, redémarre, et escalade si cela ne suffit pas (UC-SUP-09).
Les workers **intégrés** du framework sont exclus du redémarrage automatique, et les workers
désactivés ne sont pas supervisés.

Moteurs Python : phase **P-4**. En attendant, un worker doit se **réparer lui-même** dans son
initialisation ou son cycle : refermer et réouvrir ce qui est cassé, plutôt que de compter sur un
redémarrage qui n'aura pas lieu.

Dans tous les cas, le redémarrage **perd l'état en mémoire** du worker : ce qui doit survivre est en
base (UC-DB-01) ou dans le bus (UC-BUS-01).

## Exemples
### Dire la vérité sur sa santé, pour que la supervision serve
```python
def is_healthy(self) -> bool:
    return self._initialized and self._consecutive_failures < 3
```

### Se réparer soi-même, en attendant P-4
```python
def do_work(self) -> None:
    if not self._client_ok:
        self._reconnect()          # réparation dans le cycle, sans boucle ni attente
    ...
```

### Configuration du superviseur (Java)
```yaml
supervisor:
  enabled: ${SUPERVISOR_ENABLED:true}
  check-interval-ms: ${SUPERVISOR_CHECK_INTERVAL_MS:30000}
  failures-before-restart: ${SUPERVISOR_FAILURES_BEFORE_RESTART:3}
```

## Pièges courants
- **Se déclarer malade pour une panne externe** : on provoque des redémarrages inutiles au lieu de
  protéger l'appel (UC-WRK-10).
- **Compter sur le redémarrage pour nettoyer un état** : en Python, il n'arrive pas encore.
- **Un état critique en mémoire** : il disparaît au redémarrage.
- **Un seuil à un seul échec** : le moindre hoquet redémarre le worker.
- **Se déclarer sain alors que l'initialisation a échoué** : le superviseur ne verra rien.

## Cas d'usage voisins
- UC-WRK-08 — publier santé et statistiques
- UC-SUP-04 — redémarrer un worker à la main
- UC-SUP-09 — escalade du superviseur
- UC-WRK-10 — worker d'appel externe protégé
