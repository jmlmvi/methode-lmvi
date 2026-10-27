---
id: UC-SEC-02
titre: "Protéger /mcp par clé"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "Authorization Bearer, MCP_API_KEY, RG-14"
---

# UC-SEC-02 — Protéger /mcp par clé

## Questions auxquelles répond ce cas d'usage
1. Comment protéger le point d'entrée MCP, et avec quel en-tête ?
2. Pourquoi la clé MCP est-elle distincte de la clé d'administration ?
3. Un client MCP peut-il se présenter avec une identité d'utilisateur à la place ?
4. Que répond l'instance quand la clé est absente ou fausse ?
5. Faut-il exposer MCP sur un port séparé ?
6. Comment révoquer l'accès d'un agent sans redéployer toute la plateforme ?

## Mots-clés
MCP, `/mcp`, clé MCP, `MCP_API_KEY`, `Authorization: Bearer`, RG-14, agent IA,
jeton, 401, séparation des secrets, révocation, proxy MCP du Hub, port principal,
`socle.mcp.enabled`

## Ce que c'est, et quand s'en servir
Le point d'entrée MCP est servi sur le port principal et protégé par **son propre secret**, envoyé
en jeton porteur. C'est ce qu'on donne à un client MCP de confiance : un agent interne, le proxy du
Hub, un poste de développement.

La séparation des secrets n'est pas de la bureaucratie : l'accès MCP et l'accès d'administration
n'ont pas la même population d'appelants ni la même durée de vie. On révoque l'un sans casser
l'autre.

## Ce que le socle fait · ce qu'il interdit
Le socle vérifie le jeton avant tout traitement, et accepte en plus un **jeton délégué** porteur
d'une identité utilisateur et du droit d'invocation : c'est ce qui permet à un agent d'agir au nom
d'une personne, avec ses scopes et son tenant (UC-ACT-13).

Ce qu'il ne fait pas : distinguer deux agents qui partagent la même clé. Pour une traçabilité
nominative, il faut l'identité déléguée — l'audit enregistrera alors la personne, pas « la clé ».

## Exemples
### Configuration
```yaml
socle:
  mcp:
    enabled: ${MCP_ENABLED:true}
    api-key: ${MCP_API_KEY:}
```

### Appeler
```bash
curl -X POST localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -X POST localhost:8080/mcp -d '{}'      # sans jeton
# 401
```

### État du point d'entrée
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcp/info
```

## Pièges courants
- **Réutiliser la clé d'administration** comme clé MCP : on perd la séparation, et la révocation
  devient impossible sans tout casser.
- **Donner la clé à un agent exposé au public** : la clé n'identifie personne et ouvre tous les
  outils.
- **Oublier de désactiver MCP** sur une instance qui n'en a pas besoin : surface inutile.
- **Croire MCP moins sensible que REST** : même exécution, mêmes données, mêmes droits.

## Cas d'usage voisins
- UC-SEC-01 — protéger l'API d'administration par clé
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-ACT-09 — exposer les actions en outils MCP
- UC-ACT-13 — consommer les actions depuis un agent IA
