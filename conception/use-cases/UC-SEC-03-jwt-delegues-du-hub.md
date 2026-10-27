---
id: UC-SEC-03
titre: "Accepter les JWT délégués du Hub"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "RS256, JWKS, issuer, audience, token-type, RG-16"
---

# UC-SEC-03 — Accepter les JWT délégués du Hub

## Questions auxquelles répond ce cas d'usage
1. Comment mon application sait-elle qui est l'utilisateur derrière un appel ?
2. Qui émet ces jetons, et comment leur signature est-elle vérifiée ?
3. Quelles vérifications le socle fait-il — émetteur, destinataire, type, expiration ?
4. Que faut-il configurer pour activer cette vérification ?
5. Comment tester en local sans dépendre du vrai Hub ?
6. Que contient le jeton, et qu'est-ce qui en est utilisable par l'application ?
7. Quelle tolérance d'horloge est acceptée entre l'émetteur et l'instance ?

## Mots-clés
JWT, jeton délégué, RS256, signature, JWKS, clé publique, `issuer`, `audience`,
`required-token-type`, `socle-delegated`, expiration, tolérance d'horloge, Hub, SSO,
identité, scopes, tenant, RG-16, fournisseur d'identité de test

## Ce que c'est, et quand s'en servir
Le Hub de la plateforme authentifie l'utilisateur, puis émet un **jeton délégué** destiné à une
application précise, portant l'identité, les scopes et le tenant. L'application le vérifie et sait
alors pour qui elle travaille.

C'est le mécanisme à utiliser dès qu'il y a un humain derrière l'appel — interface, agent agissant
pour un utilisateur, accès à des données isolées par tenant.

## Ce que le socle fait · ce qu'il interdit
Le socle récupère les clés publiques de l'émetteur (avec un cache), vérifie la signature,
l'émetteur, le destinataire, le type de jeton et l'expiration avec une tolérance d'horloge, puis
pose l'identité résolue sur la requête — scopes et tenant compris (UC-SEC-05).

Il ne fabrique pas d'identité : pas de jeton, pas d'identité. Et il ne fait **jamais** confiance au
contenu d'un en-tête pour dire qui est l'utilisateur ou quel est son tenant — sauf si la requête
vient d'un proxy déclaré de confiance (UC-SEC-06).

## Exemples
### Configuration
```yaml
socle:
  oidc:
    enabled: ${SOCLE_OIDC_ENABLED:false}
    issuer-jwks-url: ${SOCLE_OIDC_ISSUER_JWKS_URL:}
    issuer: ${SOCLE_OIDC_ISSUER:soclehub}
    audience: ${SOCLE_OIDC_AUDIENCE:}
    required-token-type: ${SOCLE_OIDC_REQUIRED_TOKEN_TYPE:socle-delegated}
    jwks-cache-ttl-seconds: ${SOCLE_OIDC_JWKS_CACHE_TTL_SECONDS:300}
    clock-skew-seconds: ${SOCLE_OIDC_CLOCK_SKEW_SECONDS:30}
    protected-paths: ${SOCLE_OIDC_PROTECTED_PATHS:/api/repository}
```

### Appeler avec un jeton
```bash
curl -H "Authorization: Bearer $JWT" \
  -X POST -H "Content-Type: application/json" -d '{"reference":"C-1"}' \
  localhost:8080/admin/workers/orders_worker/actions/confirm_order
```

### En local, avec le fournisseur d'identité de test
```bash
# Fourni par les contrats, pour la suite de conformité et les essais
python contracts/conformance/identity/idp.py serve     # JWKS sur le port 18499
SOCLE_OIDC_ENABLED=true SOCLE_OIDC_ISSUER_JWKS_URL=http://127.0.0.1:18499/jwks.json \
  socle-py-django run
```

## Pièges courants
- **Oublier le destinataire** : un jeton émis pour une autre application serait accepté. Le
  destinataire se vérifie.
- **Un cache de clés trop long** : une rotation de clés côté émetteur provoque des refus pendant la
  durée du cache.
- **Horloges désynchronisées** : des refus d'expiration incompréhensibles. La tolérance est petite
  par choix.
- **Tester sans fournisseur d'identité** : les cas de jeton échouent tous, et on cherche au mauvais
  endroit (c'est exactement ce qui arrive quand on lance la suite de conformité sans démarrer le
  fournisseur de test).
- **Conclure qu'un jeton valide autorise tout** : il porte des scopes, et ils se vérifient
  (UC-ACT-04).

## Cas d'usage voisins
- UC-SEC-04 — accepter un JWT délégué sur les actions REST
- UC-SEC-05 — transmettre scopes et tenant jusqu'à l'action
- UC-SEC-09 — protéger des routes par session OIDC
- UC-INT-06 — s'insérer derrière la Gateway
