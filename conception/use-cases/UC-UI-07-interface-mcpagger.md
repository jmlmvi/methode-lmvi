---
id: UC-UI-07
titre: "Exposer l'interface MCPagger"
theme: "UC-UI · Pages et frontend"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "interface d'exploration, catalogue agrégé, génération, Hub"
---

# UC-UI-07 — Exposer l'interface MCPagger

## Questions auxquelles répond ce cas d'usage
1. Existe-t-il une interface pour explorer les outils MCP disponibles ?
2. Montre-t-elle une instance, ou l'ensemble de la plateforme ?
3. Peut-on y essayer un outil avant de brancher un agent ?
4. Qui y a accès, et comment est-elle protégée ?
5. Dans les moteurs Python, où en est cette interface ?
6. Comment explorer les outils en attendant ?

## Mots-clés
MCPagger, interface d'exploration, catalogue agrégé, outils MCP, essai,
schéma d'entrée, génération, Hub, protection, plusieurs instances,
`mcp-tools.json`, P-4

## Ce que c'est, et quand s'en servir
Une interface pour voir les outils publiés, lire leur schéma et les essayer — avant de brancher un
agent dessus. C'est le moyen le plus rapide de vérifier qu'une action est bien décrite et bien
nommée du point de vue d'un agent.

## Ce que le socle fait · ce qu'il interdit
Java : l'interface fait partie de la chaîne MCPagger, avec l'agrégation et la génération du
catalogue. Moteurs Python : phase **P-4** ; les documents sont publiés dès maintenant, donc
l'exploration est possible à la main.

Ce qu'il ne faut pas faire : exposer une interface d'essai sans protection. Essayer un outil, c'est
**exécuter une action** — avec ses effets.

## Exemples
### Explorer à la main, en attendant
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/mcp-tools.json \
  | jq '.tools[] | {name, description, required: .inputSchema.required}'
```

### Essayer un outil
```bash
curl -X POST localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"orders_worker__list_orders","arguments":{}}}'
```

### Ce qu'on vérifie en explorant
Que le nom dit ce que fait l'outil, que la description suffit à choisir, et que les paramètres
obligatoires sont ceux qu'on croit.

## Pièges courants
- **Une interface d'essai ouverte** : les outils s'exécutent pour de vrai.
- **Essayer une action destructrice** sur une instance de production : lire d'abord les
  métadonnées (UC-ACT-05).
- **Croire le catalogue agrégé à jour** après une livraison : il se rafraîchit.
- **Explorer sans tenant** : les actions multi-tenant refusent, ce qui est normal.

## Cas d'usage voisins
- UC-ACT-14 — agréger plusieurs instances dans un catalogue
- UC-ACT-09 — exposer les actions en outils MCP
- UC-ACT-13 — consommer les actions depuis un agent IA
- UC-ACT-10 — publier la spécification des actions
