---
id: UC-ACT-07
titre: "Invoquer une action en REST (synchrone)"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "POST /admin/workers/{worker}/actions/{action}, ActionResult JSON"
---

# UC-ACT-07 — Invoquer une action en REST (synchrone)

## Questions auxquelles répond ce cas d'usage
1. Quelle est l'URL exacte pour appeler une action depuis un script ou un frontend ?
2. Quelle forme a la réponse JSON, et où lire le résultat ?
3. Pourquoi est-ce que je reçois 401 alors que mon JSON est correct ?
4. Comment appeler une action pour le compte d'un tenant précis ?
5. Les champs vides ou nuls apparaissent-ils dans la réponse ?
6. Quels codes HTTP distinguent une mauvaise requête, un refus et une panne ?
7. Comment lister les actions appelables avant d'en choisir une ?

## Mots-clés
REST, invoquer, `POST`, `/admin/workers/{worker}/actions/{action}`, `/admin/actions`,
`X-Admin-Key`, `Authorization: Bearer`, `X-SSO-Tenant`, réponse JSON, `success`, `data`,
`error`, `errorType`, 200, 400, 401, curl, client HTTP

## Ce que c'est, et quand s'en servir
L'appel direct d'une action par HTTP, en synchrone : on poste les paramètres en JSON, on reçoit le
résultat. C'est le chemin qu'emprunte un frontend, un script d'exploitation, un autre service, ou
la Gateway.

La forme est **la même dans les trois moteurs** — c'est un point de contrat : même URL, même corps,
mêmes champs de réponse. Un client écrit pour un backend Java fonctionne sans modification contre
un backend Python.

## Ce que le socle fait · ce qu'il interdit
Le socle authentifie **avant** de router, valide les paramètres, exécute, audite et rend une
réponse de forme stable : un indicateur de succès, un objet de données, un message d'erreur et, en
cas de refus métier, un code de refus. Les valeurs nulles de premier niveau sont retirées de l'objet
de données : un champ absent n'est pas un champ à `null`.

Il n'y a pas de route par action à écrire : l'URL se déduit du nom du worker et du nom de l'action.
Et sans titre d'accès, toute surface non publique répond 401 — y compris celle-ci.

## Exemples
### Appel avec la clé d'administration
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"reference":"C-1","amount_cents":12000}' \
  localhost:8080/admin/workers/orders_worker/actions/create_order
# {"success":true,"data":{"id":1,"reference":"C-1","status":"DRAFT","amount_cents":12000},"error":""}
```

### Appel pour un tenant, derrière un proxy de confiance
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "X-SSO-Tenant: acme" \
  -H "Content-Type: application/json" -d '{"reference":"C-1"}' \
  localhost:8080/admin/workers/orders_worker/actions/confirm_order
```

### Refus métier — succès HTTP, échec applicatif
```json
{"success": false, "data": {}, "error": "Commande C-1 déjà au statut CONFIRMED",
 "errorType": "NOT_CONFIRMABLE"}
```

### Découvrir les actions disponibles
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/actions
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers/orders_worker/actions
```

## Pièges courants
- **Oublier le titre d'accès** : 401, et on cherche dans le JSON. La sécurité s'applique avant le
  routage (UC-SEC-07).
- **Déclarer son tenant soi-même** : l'en-tête de tenant n'est cru que derrière un proxy de
  confiance (UC-SEC-06). Sinon, refus `MISSING_TENANT`.
- **Confondre refus métier et panne** : un refus arrive en 200 avec `success` à faux et un code.
  Traiter le code, pas le message (UC-ACT-12).
- **Attendre un champ à `null`** : les valeurs nulles de premier niveau sont absentes.
- **Deviner l'URL au pluriel ou au singulier** : la lister plutôt que l'inventer.

## Cas d'usage voisins
- UC-ACT-08 — invoquer une action en asynchrone
- UC-ACT-12 — distinguer un refus métier d'une panne
- UC-SEC-01 — protéger l'API d'administration par clé
- UC-ACT-11 — publier un OpenAPI exact
