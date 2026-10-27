---
id: UC-INT-06
titre: "S'insérer derrière la Gateway TheSocle"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "proxy inverse, SSO, JWT délégués, proxy MCP, TRUSTED_PROXIES"
---

# UC-INT-06 — S'insérer derrière la Gateway TheSocle

## Questions auxquelles répond ce cas d'usage
1. Que fait la Gateway, et ce que mon application n'a donc pas à faire ?
2. Comment l'identité de l'utilisateur arrive-t-elle jusqu'à mes actions ?
3. Que faut-il configurer dans l'application pour fonctionner derrière elle ?
4. Comment un agent IA atteint-il mon application à travers la plateforme ?
5. Mon application reste-t-elle appelable directement, sans la Gateway ?
6. Comment vérifier que l'insertion fonctionne vraiment ?
7. Un backend Python est-il interchangeable avec un backend Java de ce point de vue ?

## Mots-clés
Gateway, Hub, proxy inverse, SSO, JWT délégué, proxy MCP, `TRUSTED_PROXIES`,
`X-SSO-Tenant`, point d'entrée, certificats, nom de domaine, indiscernable,
contrat, intégration plateforme

## Ce que c'est, et quand s'en servir
La Gateway est le point d'entrée de la plateforme : elle termine le TLS, authentifie l'utilisateur,
émet les jetons délégués destinés à l'application, relaie MCP, et route vers le bon backend.

L'exigence côté application est double, et c'est tout : **accepter les jetons délégués**
(UC-SEC-03) et **déclarer la Gateway comme proxy de confiance** (UC-SEC-06) pour que l'en-tête de
tenant soit honoré.

C'est aussi là que se mesure la promesse du chantier : pour la Gateway, un backend Python doit être
indiscernable d'un backend Java.

## Ce que le socle fait · ce qu'il interdit
Le socle vérifie les jetons, résout l'identité, transmet scopes et tenant jusqu'aux actions, et
publie les documents que la plateforme consomme (UC-ACT-10). Il n'a pas besoin de connaître la
Gateway : il applique une politique, et la Gateway s'y conforme.

Ce qu'il ne faut pas faire : dupliquer dans l'application ce que fait la Gateway — terminer le TLS,
gérer un cycle d'authentification, émettre des jetons. Ni se reposer sur elle pour la sécurité
interne : les surfaces restent fermées par défaut (UC-SEC-07), parce qu'une application peut être
atteinte autrement qu'en passant par la porte d'entrée.

## Exemples
### Ce que l'application configure
```bash
SOCLE_OIDC_ENABLED=true
SOCLE_OIDC_ISSUER_JWKS_URL=https://hub.thesocle.net/.well-known/jwks.json
SOCLE_OIDC_AUDIENCE=mon-app
TRUSTED_PROXIES=10.0.0.4          # l'adresse de la Gateway, et rien d'autre
ADMIN_API_KEY=…                   # injectée par la plateforme
MCP_API_KEY=…
```

### Vérifier l'insertion
```bash
# Par la Gateway, avec un vrai jeton d'utilisateur
curl -H "Authorization: Bearer $JWT" https://mon-app.thesocle.net/admin/workers
# Les outils MCP, par le proxy de la plateforme
curl -X POST https://hub.thesocle.net/mcp -H "Authorization: Bearer $JWT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Ce que la plateforme lit de l'application
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/spec.json
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcp/info
```

## Pièges courants
- **Oublier le proxy de confiance** : l'en-tête de tenant est ignoré, et les actions
  multi-tenant sont refusées (c'est le symptôme le plus courant).
- **Déclarer une plage trop large** de proxys de confiance : n'importe qui choisit son tenant.
- **Compter sur la Gateway pour la sécurité interne** : l'instance peut être atteinte directement.
- **Ne pas déclarer le destinataire du jeton** : des jetons d'autres applications seraient acceptés.
- **Reproduire le TLS et le SSO dans l'application** : double travail, double surface d'erreur.

## Cas d'usage voisins
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-SEC-06 — proxy de confiance pour l'en-tête de tenant
- UC-INT-08 — déployer via le manifeste du Hub
- UC-CTR-06 — vérifier qu'un backend est indiscernable
