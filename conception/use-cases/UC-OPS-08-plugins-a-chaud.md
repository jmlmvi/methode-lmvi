---
id: UC-OPS-08
titre: "Charger des plugins à chaud"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "PluginManager, chargement dynamique, isolation de classes"
---

# UC-OPS-08 — Charger des plugins à chaud

## Questions auxquelles répond ce cas d'usage
1. Peut-on ajouter du code à une instance sans la redéployer ?
2. Quels usages justifient un plugin plutôt qu'une livraison ?
3. Quels risques de sécurité et de stabilité cela introduit-il ?
4. Comment isoler un plugin du reste de l'application ?
5. Dans les moteurs Python, ce mécanisme existe-t-il ?
6. Quelle alternative quand on veut faire évoluer un comportement sans livraison ?

## Mots-clés
plugin, `PluginManager`, chargement dynamique, à chaud, JAR, isolation,
chargeur de classes, extension, règle métier modifiable, risque, sécurité,
hors périmètre, configuration, point d'entrée

## Ce que c'est, et quand s'en servir
Charger du code à l'exécution pour étendre une application : transformations dynamiques, règles
métier modifiables sans livraison. Le Socle Java fournit un gestionnaire pour cela.

C'est un outil puissant et coûteux : du code chargé à chaud échappe à la revue, aux tests et au
suivi de version. Avant d'y recourir, la question utile est « est-ce que de la configuration
suffirait ? » — et la réponse est souvent oui.

## Ce que le socle fait · ce qu'il interdit
Java : le gestionnaire charge, isole et expose les extensions. Moteurs Python : **hors périmètre
déclaré**.

Ce que les moteurs Python offrent à la place, et qui couvre la plupart des besoins : la découverte
par **points d'entrée publiés** (UC-WRK-04), qui permet de livrer des workers dans une
bibliothèque séparée — versionnée, testée, installée — plutôt que de charger un fichier déposé dans
un dossier. Et pour un comportement ajustable sans livraison, la configuration (UC-CFG-04).

Ce qu'il ne faut pas faire : importer dynamiquement un module d'après une valeur de configuration
pointant vers un chemin arbitraire. C'est une exécution de code arbitraire déguisée en réglage.

## Exemples
### Socle Java
```java
pluginManager.load(Path.of("/opt/app/plugins/transformation-v2.jar"));
Transformation t = pluginManager.get(Transformation.class, "transformation-v2");
```

### Moteurs Python — l'extension par paquet publié
```toml
[project.entry-points."socle.workers"]
enrichissement = "ma_biblio.workers.enrich_worker:EnrichWorker"
```
```bash
pip install ma-biblio==1.4.0     # versionné, testé, traçable
```

### Ce qu'il ne faut pas écrire
```python
module = importlib.import_module(config.raw.as_str("app.plugin.module", ""))  # exécution arbitraire
```

## Pièges courants
- **Du code hors suivi de version** : plus personne ne sait ce qui tourne.
- **Un import dynamique piloté par la configuration** : porte ouverte à l'exécution de code.
- **Pas d'isolation** : un plugin fautif fait tomber l'instance.
- **Confondre extensibilité et configurabilité** : la seconde suffit presque toujours, et coûte
  infiniment moins cher.

## Cas d'usage voisins
- UC-WRK-04 — découverte automatique des workers
- UC-RUL-09 — exécuter un script dynamique
- UC-CFG-04 — lire une clé typée
- UC-RUL-07 — compiler du code à la volée
