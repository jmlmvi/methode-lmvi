---
id: UC-ACT-13
titre: "Consommer les actions depuis un agent IA"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "client MCP, proxy MCP du Hub, JWT délégué, tools/call"
---

# UC-ACT-13 — Consommer les actions depuis un agent IA

## Questions auxquelles répond ce cas d'usage
1. Comment brancher Claude, ou un autre client MCP, sur mon application Socle ?
2. Quelle adresse et quel titre d'accès donner à l'agent ?
3. L'agent agit-il en son nom propre ou au nom de l'utilisateur connecté ?
4. Comment limiter ce qu'un agent peut faire chez moi ?
5. Comment écrire la description d'une action pour qu'un agent la choisisse à bon escient ?
6. Comment déboguer un agent qui appelle le mauvais outil, ou mal ?
7. Faut-il passer par le Hub, ou l'agent peut-il appeler l'instance directement ?

## Mots-clés
agent IA, Claude, client MCP, `tools/call`, `tools/list`, proxy MCP, Hub, clé MCP,
JWT délégué, identité utilisateur, scopes, tenant, description d'outil, choix d'outil,
confirmation, action destructrice, journal d'audit

## Ce que c'est, et quand s'en servir
L'autre bout du modèle : non plus publier des outils, mais **les faire consommer**. Un agent se
connecte au point d'entrée MCP, découvre les outils, et les appelle pour répondre à une demande
exprimée en langage naturel.

Deux montages. En direct, l'agent porte la clé MCP : simple, mais il agit alors sans identité
utilisateur. Par le Hub, l'agent passe par le proxy MCP de la plateforme, qui l'authentifie et
transmet un jeton délégué : l'action s'exécute **avec les droits et le tenant de la personne**,
et l'audit porte son nom.

## Ce que le socle fait · ce qu'il interdit
Le socle sert la liste des outils avec leurs schémas, exécute l'appel dans le même moteur de
validation, de scope et d'audit que REST, et accepte l'identité déléguée quand elle est fournie.

Ce qu'il ne fait pas : juger la pertinence d'un appel. Si une action destructrice est publiée sans
scope, sans confirmation et avec une description vague, l'agent l'appellera un jour. La qualité des
descriptions et des métadonnées (UC-ACT-05) est une mesure de sécurité, pas une coquetterie.

## Exemples
### Brancher un client MCP
```json
{
  "mcpServers": {
    "mon-app": {
      "url": "https://mon-app.thesocle.net/mcp",
      "headers": { "Authorization": "Bearer ${MCP_API_KEY}" }
    }
  }
}
```

### Vérifier ce que l'agent voit
```bash
curl -X POST localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | jq '.result.tools[] | {name, description}'
```

### Écrire une description qu'un agent comprend
```python
# Faible : "Traite les commandes"
# Bonne : dit ce que ça fait, sur quoi, et ce que ça rend.
@action("confirm_order",
        description="Confirme une commande au brouillon du tenant courant et rend son nouvel état ; "
                    "refuse si elle est déjà confirmée ou annulée")
```

### Retrouver ce qu'a fait l'agent
```sql
SELECT ACTION_NAME, CALLER_ID, SUCCESS FROM TECHDB_WORKER_ACTIONS
WHERE CALLER_TYPE = 'MCP' ORDER BY X_ID DESC LIMIT 20;
```

## Pièges courants
- **Donner la clé MCP à un agent public** : la clé n'identifie personne et ouvre toute la surface.
  Pour des utilisateurs, c'est le Hub et les jetons délégués.
- **Descriptions ambiguës** : l'agent choisit mal, et c'est votre modèle qui est en cause, pas lui.
- **Aucune action marquée destructrice** : rien n'indique à l'agent qu'il faut demander avant.
- **Oublier le tenant** : sans identité, une action multi-tenant est refusée — ce qui est le bon
  comportement (UC-DB-10).
- **Ne pas lire l'audit** : c'est le seul endroit où l'on voit ce que l'agent a réellement fait.

## Cas d'usage voisins
- UC-ACT-09 — exposer les actions en outils MCP
- UC-ACT-05 — lecture seule et confirmation requise
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-ACT-06 — auditer les invocations
