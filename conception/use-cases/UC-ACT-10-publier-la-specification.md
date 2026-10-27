---
id: UC-ACT-10
titre: "Publier la spécification des actions"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "/mcpagger/spec.json, /mcpagger/mcp-tools.json, PublishedSpecService"
---

# UC-ACT-10 — Publier la spécification des actions

## Questions auxquelles répond ce cas d'usage
1. Comment un outil extérieur découvre-t-il ce que mon application sait faire ?
2. Où lire la liste des actions avec leurs paramètres, sans ouvrir le code ?
3. Qui produit ce document — faut-il le maintenir à la main ?
4. Quelle différence entre la spécification publiée et le document OpenAPI ?
5. Comment le Hub se sert-il de cette spécification ?
6. Ce document est-il protégé, ou public ?
7. Comment vérifier qu'une action nouvellement écrite y apparaît bien ?

## Mots-clés
spécification publiée, `spec.json`, `mcp-tools.json`, découverte, catalogue, MCPagger,
métadonnées, schéma, Hub, agrégation, documentation générée, contrat, `PublishedSpecService`,
version de contrat, horodatage

## Ce que c'est, et quand s'en servir
Deux documents que l'instance publie d'elle-même : la **spécification** de ce qu'elle expose
(workers, actions, paramètres, métadonnées) et la **liste des outils MCP** avec leurs schémas. Ils
sont générés depuis le code au moment de l'appel, donc toujours exacts.

On s'en sert pour alimenter un catalogue central, pour vérifier qu'un déploiement expose bien ce
qu'on croit, et pour nourrir un client ou un agent qui veut se brancher sans documentation humaine.

## Ce que le socle fait · ce qu'il interdit
Le socle construit ces documents à partir du registre réel d'actions : ce qui est publié est ce qui
est exécutable. Il y joint la version de contrat et l'horodatage de génération. Ces routes sont
protégées comme le reste de l'administration.

On ne maintient donc **jamais** une liste d'actions à la main dans un fichier annexe : elle
divergerait. Si une action n'apparaît pas, c'est qu'elle n'est pas déclarée ou que son worker n'est
pas découvert (UC-WRK-04) — pas qu'il manque une ligne de documentation.

## Exemples
### Lire la spécification
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/spec.json | jq '{contract, generated_at}'
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/spec.json \
  | jq '.workers[] | {name, actions: [.actions[].name]}'
```

### Lire les outils MCP
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/mcp-tools.json \
  | jq '.tools[] | {name, inputSchema}'
```

### Vérifier qu'une action est bien publiée, en test
```python
tools = client.get("/mcpagger/mcp-tools.json", headers={"X-Admin-Key": "k"}).json()["tools"]
assert "orders_worker__create_order" in {t["name"] for t in tools}
```

## Pièges courants
- **Documenter les actions ailleurs** : la seule source juste est celle que l'instance publie.
- **Croire ces documents publics** : ils décrivent toute la surface ; ils sont protégés, et c'est
  voulu.
- **Confondre avec OpenAPI** : la spécification décrit les **actions** (le modèle du socle) ;
  OpenAPI décrit les **routes HTTP** (UC-ACT-11). Les deux coexistent.
- **Oublier de régénérer un catalogue externe** après livraison : l'agrégat se périme, pas la
  source.

## Cas d'usage voisins
- UC-ACT-11 — publier un OpenAPI exact
- UC-ACT-14 — agréger plusieurs instances dans un catalogue
- UC-ACT-09 — exposer les actions en outils MCP
- UC-CTR-03 — annoncer sa version de contrat
