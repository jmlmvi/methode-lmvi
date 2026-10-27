---
id: UC-SUP-09
titre: "Escalade quand le redémarrage ne suffit pas"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "escalade, seuils, alerte, arrêt de l'instance"
---

# UC-SUP-09 — Escalade quand le redémarrage ne suffit pas

## Questions auxquelles répond ce cas d'usage
1. Que fait le socle quand un worker redémarre en boucle sans guérir ?
2. Jusqu'où va l'escalade — alerte, arrêt du worker, arrêt de l'instance ?
3. Comment éviter qu'un worker secondaire fasse tomber toute l'application ?
4. Comment être prévenu plutôt que de le découvrir dans les journaux ?
5. Quels seuils sont raisonnables ?
6. Dans les moteurs Python, quelle est la situation ?

## Mots-clés
escalade, redémarrage en boucle, seuils, alerte, arrêt du worker, arrêt de l'instance,
criticité, worker secondaire, rapport d'erreurs, notification, exploitation,
boucle de panne, P-4

## Ce que c'est, et quand s'en servir
Le cran d'après : si les redémarrages n'y changent rien, continuer indéfiniment n'a pas de sens. Le
superviseur escalade — il alerte, et selon la criticité il peut renoncer à redémarrer le worker, ou
conclure que l'instance n'est pas viable.

La décision importante est de **classer ses workers** : lequel est vital pour l'instance, lequel
est accessoire. Sans ce classement, soit on tolère une panne majeure, soit un worker secondaire fait
tomber l'ensemble.

## Ce que le socle fait · ce qu'il interdit
Java : l'escalade est outillée, avec ses seuils et ses canaux d'alerte, et s'appuie sur le rapport
d'erreurs (UC-SUP-11). Moteurs Python : phase **P-4**, en même temps que le superviseur.

Ce qu'un worker ne doit pas faire : décider lui-même d'arrêter l'instance. Un worker rend compte de
sa santé ; c'est la supervision qui décide des conséquences. Un appel à l'arrêt du processus depuis
un worker court-circuite le drain et l'arrêt ordonné.

## Exemples
### Classer la criticité par la configuration
```yaml
app:
  workers:
    collect_worker: {critical: false}     # accessoire : l'instance survit
    referential_worker: {critical: true}  # vital : sans lui, rien ne vaut
```

### Rendre compte, sans décider
```python
def is_healthy(self) -> bool:
    return self._initialized and self._consecutive_failures < 3
# Ce qui ne se fait JAMAIS dans un worker :
# sys.exit(1)   /   os._exit(1)   /   System.exit(1)
```

### Être prévenu
Brancher l'alerte sur la liste des workers (UC-SUP-02) ou sur le rapport d'erreurs : un worker
malade plus de N minutes mérite une notification, pas une ligne de journal.

## Pièges courants
- **Aucun classement de criticité** : la supervision ne peut pas arbitrer.
- **Un worker qui arrête le processus** : on perd le drain, les traitements en cours et l'ordre
  d'arrêt.
- **Escalader trop vite** : une panne externe de trente secondes ne justifie pas un arrêt
  d'instance.
- **Escalader sans trace** : on redémarre sans jamais savoir pourquoi.

## Cas d'usage voisins
- UC-SUP-03 — redémarrage automatique
- UC-SUP-11 — agréger et expédier un rapport d'erreurs
- UC-WRK-08 — publier santé et statistiques
- UC-SUP-06 — drainer puis arrêter proprement
