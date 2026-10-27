---
id: UC-ACT-09
titre: "Exposer les actions comme outils MCP"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "worker__action, POST /mcp, mcp-tools.json, RG-09"
---

# UC-ACT-09 — Exposer les actions comme outils MCP

## Questions auxquelles répond ce cas d'usage
1. Comment rendre mes actions utilisables par un agent IA comme Claude ?
2. Quel est le nom de l'outil MCP correspondant à une action, et qui le décide ?
3. Faut-il écrire du code spécifique à MCP en plus de l'action REST ?
4. Comment l'agent connaît-il les paramètres attendus et leurs bornes ?
5. Comment protéger l'accès MCP, et avec quel en-tête ?
6. Un agent peut-il agir au nom d'un utilisateur, avec ses droits et son tenant ?
7. Comment vérifier la liste des outils publiés par une instance ?

## Mots-clés
MCP, Model Context Protocol, outil, tool, `worker__action`, double tiret bas, `POST /mcp`,
`tools/list`, `tools/call`, `mcp-tools.json`, clé MCP, `Authorization: Bearer`, agent IA,
Claude, schéma d'outil, RG-09, JWT délégué

## Ce que c'est, et quand s'en servir
La même action, publiée comme **outil MCP** : un agent la découvre, lit son schéma, et l'appelle.
Le nom de l'outil est mécanique — nom du worker, double tiret bas, nom de l'action — et c'est ce
nom que l'agent retiendra.

Il n'y a rien à écrire de plus : déclarer l'action (UC-ACT-01) suffit. C'est le point important du
modèle — une seule déclaration, deux surfaces, aucune divergence possible entre ce que voit un
humain et ce que voit un agent.

## Ce que le socle fait · ce qu'il interdit
Le socle expose un point d'entrée MCP, publie la liste des outils avec leur schéma de paramètres
(types, obligations, bornes, valeurs permises), exécute l'action dans le même moteur de validation
et d'audit que REST, et protège l'accès par clé. Il accepte aussi un jeton délégué portant une
identité utilisateur, ce qui permet à l'agent d'agir avec les droits et le tenant de la personne.

Ce qu'il ne faut pas faire : exposer un outil dont le nom ou le comportement change. Un agent
mémorise les noms d'outils, les décrit à l'utilisateur, les enchaîne. Renommer une action, c'est
casser un agent en production — sans erreur de compilation pour vous avertir.

## Exemples
### Lister les outils
```bash
curl -X POST localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# … "name": "orders_worker__create_order", "inputSchema": {…}
```

### Appeler un outil
```bash
curl -X POST localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"orders_worker__create_order",
                 "arguments":{"reference":"C-9","amount_cents":4200}}}'
```

### Voir le catalogue publié
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/mcp-tools.json | jq '.tools[].name'
```

## Pièges courants
- **Des descriptions vagues** : l'agent choisit l'outil d'après la description. « Traite les
  données » ne lui dit rien ; dire ce que ça fait, et sur quoi.
- **Des noms d'action instables** : chaque renommage casse les agents et les conversations déjà
  enregistrées.
- **Oublier de marquer les actions destructrices** (UC-ACT-05) : l'agent les appellera comme les
  autres.
- **Croire que MCP est une surface moins sensible** : c'est la même exécution, les mêmes données.
  Elle se protège comme le reste (UC-SEC-02).
- **Tout exposer** : une action interne de diagnostic devient un outil que l'agent peut appeler.
  Choisir ce qui mérite d'être un outil.

## Cas d'usage voisins
- UC-ACT-01 — déclarer une action
- UC-ACT-13 — consommer les actions depuis un agent IA
- UC-SEC-02 — protéger /mcp par clé
- UC-ACT-10 — publier la spécification des actions
