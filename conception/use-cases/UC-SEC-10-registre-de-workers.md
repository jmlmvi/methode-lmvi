---
id: UC-SEC-10
titre: "S'enregistrer auprès du registre de workers de la plateforme"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "WorkerRegistryClient, SocleAuthClient, enregistrement, F4"
---

# UC-SEC-10 — S'enregistrer auprès du registre de workers de la plateforme

## Questions auxquelles répond ce cas d'usage
1. Comment la plateforme sait-elle que mon instance existe et ce qu'elle expose ?
2. Qui s'enregistre — l'instance elle-même, ou un opérateur ?
3. Que se passe-t-il si le registre est injoignable au démarrage ?
4. Quelles informations sont publiées : workers, actions, version ?
5. Dans les moteurs Python, cet enregistrement existe-t-il ?
6. Comment éviter qu'une instance de développement pollue le registre ?

## Mots-clés
registre de workers, `WorkerRegistryClient`, `SocleAuthClient`, enregistrement,
découverte de services, Hub, plateforme, démarrage non bloquant, version annoncée,
environnement, F4, P-4, clients externes

## Ce que c'est, et quand s'en servir
À son démarrage, une instance peut s'annoncer à la plateforme : voici mon identifiant, ma version,
mes workers et leurs actions. Le registre sert ensuite à la découverte, à l'agrégation des outils et
aux tableaux de bord transverses.

Utile dès qu'il y a plus d'une application : sans registre, la connaissance du parc vit dans des
tableurs et des mémoires.

## Ce que le socle fait · ce qu'il interdit
Java : des clients dédiés gèrent l'authentification auprès de la plateforme et l'enregistrement. Le
principe retenu est que l'enregistrement **ne bloque pas le démarrage** : une plateforme injoignable
ne doit pas empêcher l'application de servir.

Moteurs Python : phase **P-4**. En attendant, l'inventaire se fait par les documents que chaque
instance publie déjà (UC-ACT-10) — ce qui suffit à alimenter un inventaire externe, sans écrire un
client d'enregistrement maison qui divergerait du contrat à venir.

Et une précaution d'exploitation : une instance de développement ne s'enregistre pas dans le
registre de production. L'environnement fait partie de l'identité annoncée.

## Exemples
### Socle Java
```java
// Enregistrement au démarrage, sans bloquer : un échec est journalisé, pas fatal.
workerRegistryClient.register(socleId, socleVersion, workers);
```

### Ce qu'une instance publie déjà, dans tous les moteurs
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/spec.json | jq '{contract}'
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers | jq 'keys'
```

### Configuration de l'identité annoncée
```yaml
socle:
  app_name: ${APP_NAME:mon-app}
  env_name: ${ENV_NAME:dev}
  mcp:
    socle-id: ${SOCLE_ID:${socle.app_name}}
```

## Pièges courants
- **Faire échouer le démarrage** si le registre ne répond pas : l'application doit servir même sans
  plateforme.
- **Enregistrer une instance de développement en production** : le parc devient faux.
- **Enregistrer sans version** : impossible de savoir ce qui tourne réellement.
- **Croire le registre à jour** après une livraison : il reflète ce qui s'est annoncé, donc il se
  réconcilie.

## Cas d'usage voisins
- UC-ACT-10 — publier la spécification des actions
- UC-INT-07 — appeler un autre Socle en client authentifié
- UC-INT-06 — s'insérer derrière la Gateway
- UC-ACT-14 — agréger plusieurs instances
