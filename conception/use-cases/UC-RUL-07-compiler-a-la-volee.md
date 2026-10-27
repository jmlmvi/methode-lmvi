---
id: UC-RUL-07
titre: "Compiler du code à la volée (Janino)"
theme: "UC-RUL · Moteurs de décision et code dynamique"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "JaninoEngine, cache de scripts, chargeur de classes, délai d'exécution"
---

# UC-RUL-07 — Compiler du code à la volée (Janino)

## Questions auxquelles répond ce cas d'usage
1. Peut-on compiler et exécuter du code fourni en configuration ?
2. À quoi sert cette possibilité dans une application métier ?
3. Comment le code compilé est-il isolé du reste de l'application ?
4. Comment éviter qu'un script boucle indéfiniment ?
5. Le code compilé est-il rechargé à chaud quand il change ?
6. Dans les moteurs Python, quelle est la position sur ce sujet ?

## Mots-clés
compilation à la volée, `JaninoEngine`, script compilé, cache, chargeur de classes,
isolation, délai d'exécution, rechargement à chaud, code en configuration,
exécution arbitraire, risque, hors périmètre, alternative

## Ce que c'est, et quand s'en servir
Compiler un fragment de code à l'exécution, puis l'appeler comme une fonction. Le Socle Java
l'utilise pour des transformations et des calculs modifiables sans livraison, avec un cache de
compilation, un chargeur de classes dédié et un délai d'exécution.

Le besoin derrière est presque toujours « changer un calcul sans redéployer ». C'est légitime ; la
compilation à la volée n'est qu'une des réponses, et la plus lourde en conséquences.

## Ce que le socle fait · ce qu'il interdit
Java : le moteur compile, met en cache, isole et borne le temps d'exécution — les trois protections
sans lesquelles l'idée est dangereuse.

Moteurs Python : **hors périmètre**, et c'est heureux. Compiler ou évaluer du code fourni de
l'extérieur donne à son auteur **tous** les droits du processus : fichiers, réseau, secrets,
base. Aucune mise en bac à sable crédible n'est réalisable à la légère.

Ce qu'on fait à la place, par ordre de préférence : rendre le comportement **configurable** (une
grille, un seuil, un choix parmi des stratégies implémentées), publier les variantes comme
**paquets versionnés** (UC-WRK-04), ou appeler un service externe qui porte le calcul.

## Exemples
### Socle Java
```java
JaninoScript script = janinoEngine.compile("remise", "return amount > 10000 ? 0.05 : 0.02;");
Object remise = script.execute(Map.of("amount", 12000));     // délai d'exécution appliqué
```

### Moteurs Python — des stratégies implémentées, choisies par configuration
```python
STRATEGIES = {"lineaire": LinearDiscount, "palier": TieredDiscount, "aucune": NoDiscount}

def __init__(self, config: SocleConfig):
    nom = config.raw.as_str("app.pricing.strategy", "palier")
    if nom not in STRATEGIES:                 # choix fermé : pas d'exécution arbitraire
        raise ValueError(f"app.pricing.strategy inconnue : {nom}")
    self._strategy = STRATEGIES[nom]()
```

### Ce qu'il ne faut jamais écrire
```python
exec(config.raw.as_str("app.pricing.code", ""))      # tous les droits du processus
```

## Pièges courants
- **Exécuter du code de configuration** : exécution arbitraire, avec les droits de l'application.
- **Pas de délai d'exécution** : un script qui boucle gèle le traitement.
- **Pas de cache** : compilation à chaque appel, coût invisible mais réel.
- **Du code hors suivi de version** : plus personne ne sait ce qui calcule quoi.
- **Confondre configurable et programmable** : un seuil se configure ; un algorithme se livre.

## Cas d'usage voisins
- UC-RUL-08 — exposer des interfaces de calcul dynamique
- UC-RUL-09 — exécuter un script dynamique
- UC-OPS-08 — charger des plugins à chaud
- UC-CFG-04 — lire une clé typée
