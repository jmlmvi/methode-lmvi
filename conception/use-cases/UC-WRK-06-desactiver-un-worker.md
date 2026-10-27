---
id: UC-WRK-06
titre: "Désactiver un worker sans le supprimer"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "enabled, isEnabled, RG-05"
---

# UC-WRK-06 — Désactiver un worker sans le supprimer

## Questions auxquelles répond ce cas d'usage
1. Comment couper un traitement en production sans livrer une nouvelle version ?
2. Je veux qu'un worker ne tourne qu'en préproduction : comment conditionner son activité ?
3. Un worker désactivé est-il encore supervisé, encore redémarré s'il va mal ?
4. Quelle différence entre désactiver un worker et le rendre passif ?
5. Comment voir, en exploitation, qu'un worker est volontairement éteint ?
6. Faut-il commenter le code ou retirer la classe pour désactiver un traitement ?

## Mots-clés
désactiver, désactivé, `enabled`, `isEnabled`, drapeau, feature flag, couper un traitement,
mise hors service, RG-05, non supervisé, non planifié, bascule par configuration, préproduction

## Ce que c'est, et quand s'en servir
Un drapeau, lu par le socle, qui laisse le worker **présent mais inerte** : ni planifié, ni
supervisé. On l'utilise pour éteindre un traitement en production le temps d'un incident, pour
n'activer un worker que sur certains environnements, ou pour livrer un traitement avant son
ouverture.

La bonne pratique est de brancher ce drapeau sur la configuration : l'exploitant décide, sans
livraison et sans toucher au code.

## Ce que le socle fait · ce qu'il interdit
Le socle lit l'état d'activation à la découverte et, s'il est faux, n'inscrit aucune échéance et ne
soumet pas le worker au superviseur (RG-05). Le worker reste visible dans la liste d'exploitation,
avec son état — c'est la différence avec une classe supprimée : on voit qu'il existe et qu'il est
éteint.

Ce drapeau n'est pas un interrupteur à chaud dans les moteurs Python : il est lu au démarrage.
Couper un traitement sans redémarrer relève du pilotage (UC-OPS-01) ou d'une action dédiée.

## Exemples
### socle-py-django et socle-py
```python
class ExportWorker(Worker):
    def __init__(self, config: SocleConfig):
        # L'exploitant décide, sans livraison : app.export.enabled=false
        self.enabled = config.raw.as_bool("app.export.enabled", True)
```

### Socle Java
```java
@Override public boolean isEnabled() { return configuration.isExportWorker_enabled(); }
```

### Constater l'état
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers
# { "export_worker": { "enabled": false, "healthy": true, "stats": {} }, … }
```

## Pièges courants
- **Commenter la classe ou la retirer du paquet** : on perd la trace de son existence et l'historique
  de la décision. Le drapeau est explicite, et visible en exploitation.
- **Confondre avec le worker passif** : un passif est pleinement vivant et sert ses actions ; un
  désactivé est éteint.
- **Désactiver un worker dont un autre attend les messages** : le consommateur reste en attente
  silencieuse. Vérifier les dépendances fonctionnelles avant de couper.
- **Croire à un effet immédiat** : le drapeau est lu au démarrage de l'instance.

## Cas d'usage voisins
- UC-WRK-03 — worker passif
- UC-CFG-04 — lire une clé de configuration typée
- UC-SUP-02 — lister les workers et leur état
- UC-OPS-01 — piloter le système par commandes
