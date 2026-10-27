---
id: UC-CFG-03
titre: "Refuser au démarrage une configuration invalide"
theme: "UC-CFG · Configuration"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "validation au démarrage, échec explicite, G2"
---

# UC-CFG-03 — Refuser au démarrage une configuration invalide

## Questions auxquelles répond ce cas d'usage
1. Pourquoi mon instance refuse-t-elle de démarrer au lieu de tourner avec un défaut ?
2. Quelles incohérences sont détectées au démarrage ?
3. Vaut-il mieux échouer tout de suite ou se dégrader en route ?
4. Comment lire le message d'erreur pour trouver la clé fautive ?
5. Comment valider la configuration d'une application avant un déploiement ?
6. Puis-je ajouter mes propres validations applicatives au démarrage ?

## Mots-clés
validation, configuration invalide, échec au démarrage, fail-fast, message d'erreur,
clé fautive, cron invalide, port occupé, base injoignable, défaut dangereux, G2,
contrôle avant déploiement, `initialize`

## Ce que c'est, et quand s'en servir
Une configuration incohérente **arrête le démarrage**, avec un message qui nomme le problème. C'est
un choix de conception : une instance qui démarre à moitié configurée produit des pannes
difficiles à relier à leur cause, parfois des heures plus tard.

Les cas classiques : une expression de planification invalide, une administration exposée sans clé,
une base dont l'adresse est incompréhensible, une valeur attendue en entier qui n'en est pas un.

## Ce que le socle fait · ce qu'il interdit
Le socle valide ce qu'il sait valider au démarrage — planifications, exigences de sécurité, moteur
de base — et refuse avec un message explicite plutôt qu'un comportement dégradé.

Un enseignement d'exploitation vaut d'être rappelé : une sentinelle de planification mal reconnue a
produit, dans une version, treize messages d'erreur au démarrage, qui ont ensuite été capturés et
expédiés par le rapport d'erreurs. Le niveau de journalisation d'un problème de configuration n'est
pas qu'un détail de confort — il nourrit des chaînes d'alerte en aval.

Côté application, c'est le bon endroit pour ses propres validations : vérifier dans
l'initialisation du worker que la configuration qu'il exige est présente et cohérente, et échouer
clairement sinon.

## Exemples
### Ce que le socle refuse
```
… ERROR socle.core.discovery - [step:worker_cron_invalid] 'POLLING' n'est pas une expression cron
… ERROR socle.application - [step:admin_exposed_without_key] définissez ADMIN_API_KEY ou
                            ALLOW_INSECURE_ADMIN=true (développement uniquement)
```

### Valider ses propres exigences
```python
def initialize(self) -> None:
    if self._max_amount_cents <= 0:
        raise ValueError("app.orders.max-amount-cents doit être strictement positif")
```

### Contrôler avant de déployer
```bash
docker compose config -q                   # la pile est-elle cohérente
TECHDB_ENABLED=false socle-py-django run   # démarrage à blanc, sans base
```

## Pièges courants
- **Vouloir un démarrage tolérant** : une instance à moitié configurée fait perdre plus de temps
  qu'un refus net.
- **Un message d'erreur sans nom de clé** : l'exploitant ne peut pas corriger. Nommer la clé et la
  valeur reçue.
- **Valider trop tard** (au premier appel) : le défaut se révèle en production, sous charge.
- **Journaliser en erreur ce qui est normal** : les chaînes d'alerte en aval se mettent à crier
  pour rien.

## Cas d'usage voisins
- UC-CFG-01 — configurer par fichier
- UC-SEC-01 — protéger l'API d'administration par clé
- UC-WRK-02 — planifier par cron
- UC-SUP-11 — agréger et expédier un rapport d'erreurs
