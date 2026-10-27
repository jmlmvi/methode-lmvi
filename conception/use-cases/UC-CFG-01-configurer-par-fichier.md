---
id: UC-CFG-01
titre: "Configurer par fichier avec substitution d'environnement"
theme: "UC-CFG · Configuration"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "application.yml, ${VAR:défaut}, load_config, SocleConfig"
---

# UC-CFG-01 — Configurer par fichier avec substitution d'environnement

## Questions auxquelles répond ce cas d'usage
1. Où se trouve le fichier de configuration d'une application, et qui le lit ?
2. Comment écrire une valeur qui dépend de l'environnement, avec un défaut ?
3. Que se passe-t-il si la variable n'est pas définie et qu'il n'y a pas de défaut ?
4. Peut-on référencer une autre clé de configuration dans une valeur ?
5. Comment surcharger une valeur le temps d'un essai, sans modifier le fichier ?
6. Les clés sont-elles les mêmes dans les trois moteurs ?
7. Où mettre ses propres clés applicatives ?

## Mots-clés
configuration, `application.yml`, YAML, substitution, `${VAR:défaut}`, variable
d'environnement, `load_config`, `SocleConfig`, `raw`, clés `socle.*`, clés applicatives,
surcharge, `--config`, défaut, douze facteurs

## Ce que c'est, et quand s'en servir
Un fichier YAML, lu au démarrage, dans lequel **chaque valeur susceptible de changer d'un
environnement à l'autre est une variable** avec un défaut. Le fichier vit dans le dépôt ; les
valeurs sensibles ou spécifiques viennent de l'environnement.

C'est la règle de base du déploiement : la même image, la même configuration livrée, et des
variables différentes selon l'environnement. Rien à recompiler, rien à patcher.

## Ce que le socle fait · ce qu'il interdit
Le socle charge le fichier, applique la substitution (y compris les références à d'autres clés),
expose la configuration typée à l'application et la passe aux workers par injection. Les clés du
socle sont communes aux trois moteurs — c'est un point de contrat (UC-CFG-02).

Les clés applicatives vivent sous leur propre préfixe, pas dans l'espace du socle. Et une valeur en
dur dans le code, là où une clé existe, est une faute : elle rend un déploiement impossible à
ajuster sans livraison.

## Exemples
### Le fichier
```yaml
socle:
  app_name: ${APP_NAME:mon-app}
  http:
    port: ${HTTP_PORT:8080}
  techdb:
    enabled: ${TECHDB_ENABLED:true}
    backend: ${TECHDB_BACKEND:h2}
  python:
    worker-packages: ${SOCLE_WORKER_PACKAGES:mon_app.workers}

# Clés propres à l'application, sous leur propre préfixe
app:
  orders:
    max-amount-cents: ${APP_ORDERS_MAX_AMOUNT_CENTS:100000}
```

### Surcharger pour un essai
```bash
HTTP_PORT=18380 TECHDB_BACKEND=sqlite socle-py-django run
socle-py-django run --config ./application-essai.yml
```

### Lire dans le code
```python
def __init__(self, config: SocleConfig):
    self._max = config.raw.as_int("app.orders.max-amount-cents", 100_000)
```

### Socle Java
Mêmes clés `socle.*`, même substitution ; les propriétés sont liées à des objets typés.

## Pièges courants
- **Une valeur en dur** qu'un exploitant devra changer : il faudra une livraison pour un réglage.
- **Un défaut dangereux** (`ALLOW_INSECURE_ADMIN:true`, une clé de test) : le défaut est ce qui
  tourne quand personne ne décide.
- **Des clés applicatives sous le préfixe du socle** : collision possible, et confusion sur qui
  possède la clé.
- **Oublier le fichier d'exemple** pour les variables sensibles : personne ne sait ce qu'il faut
  fournir.
- **Lire la configuration dans le domaine** : elle se lit à l'interface et se passe en paramètre
  (UC-DOM-05).

## Cas d'usage voisins
- UC-CFG-02 — partager les mêmes clés entre les moteurs
- UC-CFG-03 — refuser une configuration invalide
- UC-CFG-04 — lire une clé typée
- UC-SEC-12 — lire ses secrets au démarrage
