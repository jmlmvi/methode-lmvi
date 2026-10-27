---
id: UC-SEC-04
titre: "Accepter un JWT délégué sur les actions REST"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "routes d'action, socle.actions.invoke, RG-28, Q-11"
---

# UC-SEC-04 — Accepter un JWT délégué sur les actions REST

## Questions auxquelles répond ce cas d'usage
1. Un utilisateur peut-il invoquer une action sans connaître la clé d'administration ?
2. Quel droit le jeton doit-il porter pour être accepté sur une route d'action ?
3. Quelles routes exactement acceptent les deux titres d'accès ?
4. Comment l'audit distingue-t-il un appel par clé d'un appel par identité ?
5. Faut-il déclarer ce droit quelque part pour que le Hub puisse l'accorder ?
6. Que se passe-t-il si le jeton est valide mais sans ce droit ?

## Mots-clés
action REST, jeton délégué, `socle.actions.invoke`, scope d'invocation, deux titres d'accès,
clé d'administration, RG-28, routes d'action, `/admin/workers/{worker}/actions/{action}`,
`/admin/jobs/`, manifeste, audit nominatif, 401, 403

## Ce que c'est, et quand s'en servir
Les routes d'invocation d'actions acceptent **deux** titres d'accès : la clé d'administration
(appelant de confiance) ou un jeton délégué portant le droit d'invocation. C'est ce qui permet à
une interface ou à un agent d'appeler une action **au nom d'un utilisateur**, sans jamais détenir
la clé d'administration.

Le gain est l'audit : l'invocation est enregistrée au nom de la personne, avec ses scopes et son
tenant, et l'isolation des données s'applique naturellement.

## Ce que le socle fait · ce qu'il interdit
Le socle reconnaît les routes d'action (invocation synchrone, asynchrone, suivi de job) et y accepte
les deux titres. Sur un jeton, il exige le droit d'invocation en plus de la validité ; les scopes
métier de l'action restent contrôlés par ailleurs (UC-ACT-04).

Ce droit doit être **déclaré dans le manifeste de déploiement** de l'application, sinon le Hub ne
peut pas l'accorder à un utilisateur — le projet généré le déclare déjà.

## Exemples
### Ce que déclare le manifeste
```json
{
  "iam": {
    "scopes": [
      {"name": "socle.actions.invoke",
       "description": "Invoquer les actions REST du Socle avec un JWT délégué (RG-28)"}
    ]
  }
}
```

### Deux chemins pour la même action
```bash
# Appelant de confiance : clé d'administration
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"reference":"C-1"}' localhost:8080/admin/workers/orders_worker/actions/confirm_order

# Utilisateur : jeton délégué portant socle.actions.invoke
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"reference":"C-1"}' localhost:8080/admin/workers/orders_worker/actions/confirm_order
```

### Ce que l'audit retient
```sql
SELECT ACTION_NAME, CALLER_ID, CALLER_TYPE FROM TECHDB_WORKER_ACTIONS ORDER BY X_ID DESC LIMIT 5;
-- confirm_order | alice@exemple.fr | REST    ← par identité
-- confirm_order | admin-key        | REST    ← par clé
```

## Pièges courants
- **Oublier de déclarer le droit d'invocation** dans le manifeste : aucun utilisateur ne l'obtient,
  et tous les appels par jeton sont refusés.
- **Croire que ce droit suffit** : il ouvre la porte des actions, pas les droits métier de chaque
  action.
- **Distribuer la clé d'administration aux interfaces** pour aller plus vite : on perd l'audit
  nominatif et l'isolation par tenant.
- **Supposer les deux titres acceptés partout** : seules les routes d'action le permettent ; le
  reste de l'administration exige la clé.

## Cas d'usage voisins
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-ACT-04 — exiger un scope
- UC-INT-08 — déployer via le manifeste du Hub
- UC-ACT-06 — auditer les invocations
