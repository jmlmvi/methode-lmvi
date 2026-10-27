---
id: UC-ACT-11
titre: "Publier un OpenAPI exact, sécurité comprise"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "/mcpagger/openapi.json, tags, response schemas, securitySchemes"
---

# UC-ACT-11 — Publier un OpenAPI exact, sécurité comprise

## Questions auxquelles répond ce cas d'usage
1. Comment obtenir un document OpenAPI utilisable par un générateur de client ?
2. Pourquoi mon document OpenAPI ne montrait-il ni les codes de réponse ni la sécurité ?
3. Comment la sécurité appliquée par le middleware peut-elle apparaître dans le document ?
4. Les corps de réponse décrits sont-ils garantis identiques aux corps réels ?
5. Comment regrouper les routes par domaine dans l'interface de documentation ?
6. Faut-il écrire ce document à la main pour les routes d'invocation d'actions ?

## Mots-clés
OpenAPI, Swagger, `openapi.json`, document, schéma de réponse, `response`, tags, regroupement,
`securitySchemes`, `AdminApiKey`, `DelegatedBearer`, 401, génération de client, Django Ninja,
documentation d'API, corps libre, exactitude

## Ce que c'est, et quand s'en servir
Le document OpenAPI des routes HTTP de l'instance : routes d'administration, sondes, invocation
d'actions, spécifications. Il sert à générer un client, à explorer l'API, à la faire valider par un
outil.

Le point délicat est l'**exactitude**. Dans les moteurs Python, la sécurité est appliquée par un
middleware **avant** le routage : la bibliothèque HTTP ne la voit pas, donc elle ne peut pas la
documenter. Le socle complète donc le document après génération, route par route, d'après la
politique de sécurité réellement en vigueur dans l'instance.

## Ce que le socle fait · ce qu'il interdit
Le socle produit le document, le regroupe par domaine, y déclare les schémas de réponse et y injecte
les exigences de sécurité calculées depuis la politique de l'instance — clé d'administration ou
jeton délégué selon la route, réponse 401 documentée, corps libre pour les invocations d'actions
(puisque les paramètres dépendent de l'action appelée).

Ce document **ne doit pas** changer les corps de réponse : il les décrit. Dans les moteurs Python,
les réponses sont construites à la main pour coller au contrat du Socle Java, et déclarer un schéma
n'y touche pas — c'est de la documentation, pas de la sérialisation. Un schéma faux est donc
possible : si on modifie un corps, on met le schéma à jour dans le même mouvement.

## Exemples
### Lire le document
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/openapi.json \
  | jq '.paths["/admin/workers/{worker}/actions/{action}"].post.security'
# [ { "AdminApiKey": [] }, { "DelegatedBearer": [] } ]
```

### Vérifier l'exactitude en test
```python
schema = client.get("/mcpagger/openapi.json", headers={"X-Admin-Key": "k"}).json()
assert schema["components"]["securitySchemes"].keys() == {"AdminApiKey", "DelegatedBearer"}
assert schema["paths"]["/health/ready"]["get"]["security"] == []        # route publique
```

### Générer un client
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/openapi.json > openapi.json
# puis l'outil de génération de votre langage
```

## Pièges courants
- **Déclarer un schéma de réponse et croire qu'il sérialise** : dans les moteurs Python, la réponse
  est construite à la main ; le schéma est documentaire.
- **Modifier un corps sans toucher au schéma** : le document devient faux, et les clients générés
  avec lui cassent.
- **Attendre que la bibliothèque documente la sécurité** : elle ne la voit pas, le socle la rajoute.
- **Publier le document sans protection** : il décrit toute la surface d'administration.

## Cas d'usage voisins
- UC-ACT-10 — publier la spécification des actions
- UC-SEC-07 — fermer par défaut les surfaces non publiques
- UC-ACT-07 — invoquer une action en REST
- UC-CTR-01 — écrire un contrat hors du code
