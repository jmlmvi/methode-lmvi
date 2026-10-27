---
id: UC-INT-05
titre: "Servir gRPC-Web à un frontend"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "gRPC-Web, proxy, navigateur, CORS"
---

# UC-INT-05 — Servir gRPC-Web à un frontend

## Questions auxquelles répond ce cas d'usage
1. Un navigateur peut-il appeler directement un service gRPC ?
2. À quoi sert la variante web de gRPC, et qu'exige-t-elle ?
3. Comment un frontend consomme-t-il une application Socle dans les moteurs Python ?
4. Quelles questions d'origine croisée se posent ?
5. Comment l'authentification de l'utilisateur est-elle transmise ?
6. Quand ce choix est-il justifié pour un frontend ?

## Mots-clés
gRPC-Web, navigateur, frontend, proxy, origine croisée, CORS, authentification,
jeton délégué, actions REST, JSON, hors périmètre, FrontendShell,
typage client, génération de code

## Ce que c'est, et quand s'en servir
Un navigateur ne parle pas gRPC nativement : il faut une variante web et un intermédiaire. Le
Socle Java la prend en charge, ce qui permet à un frontend d'appeler des services typés.

Dans les moteurs Python, c'est **hors périmètre**, et la question se pose peu : un frontend consomme
les actions en JSON, avec l'identité de l'utilisateur portée par un jeton délégué (UC-SEC-04), et
un document OpenAPI pour générer son client typé (UC-ACT-11).

## Ce que le socle fait · ce qu'il interdit
Java : la variante web est servie, avec les réglages d'origine croisée associés.

Moteurs Python : la surface pour un frontend est celle des actions. Ce qu'il ne faut pas faire, c'est
ouvrir largement l'origine croisée pour « débloquer » un frontend en développement : une politique
permissive laissée en production expose les surfaces d'administration au navigateur de n'importe qui.

## Exemples
### Moteurs Python — un frontend sur les actions
```javascript
// Le frontend porte le jeton délégué de l'utilisateur, pas une clé d'administration.
const r = await fetch("/admin/workers/orders_worker/actions/list_orders", {
  method: "POST",
  headers: {"Authorization": `Bearer ${jeton}`, "Content-Type": "application/json"},
  body: "{}"
});
const {success, data} = await r.json();
```

### Générer un client typé
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/openapi.json > openapi.json
# puis le générateur de votre choix
```

## Pièges courants
- **Une clé d'administration dans un frontend** : elle est publique dès qu'elle est dans le
  navigateur.
- **Origine croisée permissive** laissée en production : les surfaces d'administration deviennent
  appelables depuis n'importe quel site.
- **Appeler les actions sans identité** : les données multi-tenant sont refusées, à juste titre.
- **Dupliquer les types à la main** côté frontend : le document OpenAPI existe pour ça.

## Cas d'usage voisins
- UC-INT-02 — exposer un service gRPC
- UC-UI-04 — héberger un frontend FrontendShell
- UC-SEC-04 — accepter un JWT délégué sur les actions REST
- UC-ACT-11 — publier un OpenAPI exact
