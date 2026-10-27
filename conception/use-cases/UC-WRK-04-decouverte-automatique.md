---
id: UC-WRK-04
titre: "Faire découvrir ses workers automatiquement"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "worker-packages, entry points socle.workers, @Component"
---

# UC-WRK-04 — Faire découvrir ses workers automatiquement

## Questions auxquelles répond ce cas d'usage
1. Comment le socle sait-il quels workers existent dans mon application ?
2. J'ai écrit une classe de worker et elle ne démarre pas : où faut-il la déclarer ?
3. Peut-on livrer des workers dans une bibliothèque installée séparément ?
4. Que se passe-t-il si deux workers portent le même nom ?
5. Comment les dépendances d'un worker sont-elles fournies, puisque je n'instancie rien moi-même ?
6. Dans quel ordre les workers découverts sont-ils démarrés ?
7. Comment vérifier, au démarrage, la liste de ce qui a été trouvé ?

## Mots-clés
découverte, découverte automatique, `worker-packages`, `socle.python.worker-packages`,
entry point, `socle.workers`, paquet de workers, `@Component`, injection par constructeur,
instanciation, nom unique, `[step:workers_discovered]`, scan, classpath

## Ce que c'est, et quand s'en servir
On n'enregistre pas ses workers un par un : on dit **où chercher**, et le socle trouve les classes
de worker, les instancie en fournissant leurs dépendances, et les conduit dans leur cycle de vie.
Un worker nouveau se contente d'exister au bon endroit, dans son propre fichier.

Deux chemins, selon la livraison : le **paquet déclaré** pour les workers de l'application
(`<paquet>.workers` — ce que le projet généré configure déjà), et le **point d'entrée publié** pour
des workers livrés par une bibliothèque réutilisable.

## Ce que le socle fait · ce qu'il interdit
Le socle importe les modules, retient les classes concrètes de worker, lit la signature de leur
constructeur et **injecte les composants par leur type** (bus interne, configuration, registre
partagé, base technique). Il journalise ce qu'il a trouvé (`[step:workers_discovered]`) : c'est la
première chose à lire quand un worker « ne démarre pas ».

Deux workers de même nom font échouer la découverte : le nom est l'identifiant d'exploitation, il
apparaît dans les routes, les outils MCP et les métriques. Un worker ne s'instancie pas lui-même,
ne va pas chercher ses dépendances dans une variable globale et ne dépend pas d'un autre worker par
import direct — c'est le bus interne ou le registre partagé qui les relie (UC-WRK-12).

## Exemples
### socle-py-django et socle-py — paquet déclaré
```yaml
socle:
  python:
    worker-packages: ${SOCLE_WORKER_PACKAGES:mon_app.workers}
```
```
src/mon_app/workers/
├── __init__.py
├── inventory_worker.py      une classe de worker par fichier
└── nightly_purge_worker.py
```

### socle-py-django et socle-py — point d'entrée publié
```toml
[project.entry-points."socle.workers"]
inventory = "ma_biblio.workers.inventory_worker:InventoryWorker"
```

### Socle Java
```java
@Component                       // découvert par le scan du contexte Spring
public class InventoryWorker implements Worker { … }
```

### Contrôler ce qui a été découvert
```bash
# au démarrage
… INFO socle.core.discovery - [step:workers_discovered] ['inventory_worker', 'nightly_purge_worker']
# à chaud
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers
```

## Pièges courants
- **Oublier de déclarer le paquet** : aucun worker, aucune erreur — juste une liste vide.
- **Deux classes dans un même fichier** : interdit par les conventions, et source de découvertes
  surprenantes.
- **Un constructeur avec un paramètre non annoté** ou d'un type inconnu : l'instanciation échoue au
  démarrage.
- **Un module qui exécute du code au chargement** (connexion, lecture de fichier) : il s'exécute
  pendant la découverte, avant l'initialisation. Tout ce qui ouvre une ressource va dans
  l'initialisation.
- **Renommer un worker à la légère** : son nom est public (routes, outils MCP, métriques).

## Cas d'usage voisins
- UC-WRK-07 — injecter ses dépendances par le constructeur
- UC-WRK-05 — ordonner démarrage et arrêt
- UC-DEV-03 — partir du bon modèle de worker
- UC-CFG-01 — configurer par fichier
