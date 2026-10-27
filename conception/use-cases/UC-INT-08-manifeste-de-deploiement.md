---
id: UC-INT-08
titre: "Déployer via le manifeste du Hub"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "manifest.json, DeployManifest, scopes IAM, variables injectées"
---

# UC-INT-08 — Déployer via le manifeste du Hub

## Questions auxquelles répond ce cas d'usage
1. À quoi sert le fichier de manifeste d'une application, et qui le lit ?
2. Que doit-il déclarer : identité, scopes, MCP, variables attendues ?
3. Pourquoi faut-il y déclarer le droit d'invocation des actions ?
4. Qui fournit les secrets annoncés dans le manifeste ?
5. Le manifeste est-il généré ou écrit à la main ?
6. Que se passe-t-il si une déclaration manque ?
7. Comment le relire pour vérifier un déploiement ?

## Mots-clés
manifeste, `manifest.json`, `DeployManifest`, Hub, déploiement, `appId`,
`iam.scopes`, `socle.actions.invoke`, MCP, variables injectées, `ADMIN_API_KEY`,
`MCP_API_KEY`, RG-28, projet généré, plateforme

## Ce que c'est, et quand s'en servir
Un fichier à la racine du projet qui décrit l'application pour la plateforme : son identifiant, les
droits qu'elle attend, si elle expose MCP, et les variables que la plateforme doit lui injecter.
C'est le contrat de déploiement.

Le projet généré en livre un, correct et complet, dès la création — c'est le genre de fichier qu'on
oublie d'écrire et qui bloque un déploiement en fin de parcours.

## Ce que le socle fait · ce qu'il interdit
Le socle ne lit pas ce fichier : **la plateforme** le lit. Il sert à accorder les droits, à injecter
les secrets, à publier l'application dans le catalogue.

La déclaration la plus importante est le **droit d'invocation des actions** : sans lui, aucun
utilisateur ne peut obtenir le droit d'appeler les actions avec un jeton délégué (UC-SEC-04), et
l'application n'est utilisable qu'avec une clé d'administration — ce qui n'est pas ce qu'on veut.

## Exemples
### Le manifeste du projet généré
```json
{
  "manifestVersion": "1.0",
  "appId": "mon-app",
  "name": "mon-app",
  "framework": "socle-v005",
  "iam": {
    "scopes": [
      {"name": "socle.actions.invoke",
       "description": "Invoquer les actions REST du Socle avec un JWT délégué (RG-28)"}
    ]
  },
  "mcp": {"enabled": true, "mode": "http"},
  "env": {"injectedBySoclehub": ["ADMIN_API_KEY", "MCP_API_KEY"]}
}
```

### Déclarer ses propres droits métier
```json
"iam": {"scopes": [
  {"name": "socle.actions.invoke", "description": "…"},
  {"name": "orders.read",  "description": "Consulter les commandes du tenant"},
  {"name": "orders.write", "description": "Créer et confirmer des commandes"}
]}
```

### Vérifier
```bash
jq '{appId, framework, scopes: [.iam.scopes[].name], env: .env.injectedBySoclehub}' manifest.json
```

## Pièges courants
- **Oublier le droit d'invocation** : les jetons délégués sont refusés sur les actions.
- **Déclarer des scopes que le code n'exige pas** (ou l'inverse) : les habilitations ne
  correspondent à rien.
- **Mettre des valeurs de secrets** dans le manifeste : il déclare des **noms** de variables, pas
  des valeurs.
- **Un identifiant d'application différent** de celui de la configuration : la plateforme ne
  retrouve pas l'instance.
- **Ne pas le mettre à jour** quand on ajoute un scope : le déploiement suivant ne l'accordera pas.

## Cas d'usage voisins
- UC-SEC-04 — accepter un JWT délégué sur les actions REST
- UC-ACT-04 — exiger un scope
- UC-INT-06 — s'insérer derrière la Gateway
- UC-DEV-01 — créer un projet neuf
