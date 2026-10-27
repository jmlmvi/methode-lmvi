---
id: UC-DEV-03
titre: "Partir du bon modèle de worker"
theme: "UC-DEV · Outillage du développeur"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "docs/templates/workers, arbre de sélection, modèles exécutés par les tests"
---

# UC-DEV-03 — Partir du bon modèle de worker

## Questions auxquelles répond ce cas d'usage
1. Quels modèles de workers existent, et comment choisir ?
2. Où les trouve-t-on, et sont-ils à jour ?
3. Que faut-il modifier après avoir copié un modèle ?
4. Quand ajouter un worker à un projet, et quand en générer un nouveau ?
5. Certains modèles Java n'existent pas en Python : lesquels, et pourquoi ?
6. Comment être sûr qu'un modèle fonctionne vraiment ?

## Mots-clés
modèle de worker, `docs/templates/workers/`, arbre de sélection, copier,
renommer, TODO, intervalle, cron, passif, consommateur fiable, multi-tenant,
ORM, modèles exécutés par les tests, J1, parité Java

## Ce que c'est, et quand s'en servir
Des fichiers prêts à copier, un par forme de worker, avec les points à personnaliser marqués. Ils
servent à **ajouter un worker** à un projet existant — pour démarrer un projet, c'est le générateur
(UC-DEV-01).

Le choix se fait par la question « que doit faire mon worker ? » : une tâche répétée, une tâche à
heure fixe, répondre à des appels, consommer des messages de façon fiable, travailler sur des
données isolées par tenant.

## Ce que le socle fait · ce qu'il interdit
Point important sur la confiance : **ces modèles sont exécutés par la suite de tests** du
framework — importés, instanciés par l'injection réelle, joués par l'orchestrateur, avec une vraie
base pour les modèles multi-tenant. Un modèle qui ne marche pas fait échouer les tests.

Après la copie, trois gestes : renommer la classe **et** le nom exposé (unique dans l'instance, sous
peine d'échec de découverte), suivre les points à personnaliser dans l'ordre, et vérifier que le
paquet est bien déclaré pour la découverte (UC-WRK-04).

Certains modèles Java n'ont pas d'équivalent Python parce que la brique n'est pas portée
(événementiel, appel protégé) ou qu'elle est hors périmètre (Kafka, pipelines, agrégation) : le
tableau des modèles le dit, et il ne faut pas les imiter à la main.

## Exemples
### Les modèles disponibles (moteurs Python)
```
docs/templates/workers/
├── simple_polling_worker.py       tâche répétée toutes les N ms
├── cron_worker.py                 tâche à heure fixe
├── passive_action_worker.py       piloté par REST / MCP
├── reliable_consumer_worker.py    consommation fiable, groupe, file d'échec
├── tenant_aware_worker.py         multi-tenant en SQL brut
└── tenant_orm_worker.py           multi-tenant par l'ORM, en couches
```

### L'arbre de sélection, en une question
```
tâche répétée ?            → simple_polling_worker
à heure fixe ?             → cron_worker
appels explicites ?        → passive_action_worker
messages à ne pas perdre ? → reliable_consumer_worker
données par tenant ?       → une vraie application : socle-py-django new (starter pack)
```

### Après la copie
```python
class StockWorker(Worker):        # 1. renommer la classe
    @property
    def name(self) -> str:
        return "stock_worker"     # 2. renommer le nom exposé (unique)
```

## Pièges courants
- **Copier un modèle sans renommer le nom exposé** : deux workers homonymes font échouer la
  découverte.
- **Copier un modèle pour démarrer un projet** : le générateur fait bien plus.
- **Imiter un modèle Java non porté** : on réécrit à la main une brique qui arrivera, et on devra
  la défaire.
- **Modifier un modèle de la documentation sans relancer les tests** : ils l'exécutent.

## Cas d'usage voisins
- UC-DEV-01 — créer un projet neuf
- UC-WRK-04 — découverte automatique des workers
- UC-WRK-09 — worker événementiel
- UC-DEV-02 — obtenir un squelette complet en couches
