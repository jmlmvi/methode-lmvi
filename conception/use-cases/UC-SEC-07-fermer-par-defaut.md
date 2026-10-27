---
id: UC-SEC-07
titre: "Fermer par défaut toute surface non publique"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "middleware avant routage, FRAMEWORK_PROTECTED_PREFIXES, L1"
---

# UC-SEC-07 — Fermer par défaut toute surface non publique

## Questions auxquelles répond ce cas d'usage
1. Quelles routes sont protégées sans que j'aie rien à faire ?
2. À quel moment la sécurité est-elle appliquée — avant ou après le routage ?
3. Une route que j'ajoute est-elle protégée automatiquement ?
4. Pourquoi certaines routes anciennement ouvertes répondent-elles maintenant 401 ?
5. Comment vérifier, d'un coup d'œil, l'état réel de la protection d'une instance ?
6. Comment rendre une route publique sans ouvrir tout le reste ?
7. Que montre le document OpenAPI de cette protection ?

## Mots-clés
fermé par défaut, fail-closed, surfaces protégées, `FRAMEWORK_PROTECTED_PREFIXES`,
middleware, avant routage, 401, `/admin`, `/workers`, `/dashboard`, `/hub`, `/metrics/json`,
L1, 5.8.10, sécurisation par défaut, routes publiques, OpenAPI

## Ce que c'est, et quand s'en servir
Le principe de base : **toute surface non publique est fermée**, et on ouvre explicitement ce qui
doit l'être. Les préfixes du framework — administration, supervision, arrêt, liste des workers,
tableau de bord, données du bus, publications, pages du Hub, métriques détaillées — exigent un titre
d'accès.

Ce n'était pas le cas historiquement : des routes utiles au diagnostic étaient ouvertes. La
fermeture par défaut a été livrée comme un correctif de sécurité, dans les deux moteurs, avec une
note de version — parce qu'elle **casse** des appelants qui en profitaient.

## Ce que le socle fait · ce qu'il interdit
La vérification est faite par un middleware, **avant le routage** : la requête n'atteint pas le code
applicatif. Conséquence pratique : la protection ne dépend pas de ce que chaque vue pense faire, et
une route ajoutée sous un préfixe protégé l'est automatiquement.

Autre conséquence, moins intuitive : la bibliothèque HTTP ne voit pas cette sécurité, donc elle ne
peut pas la documenter — c'est le socle qui enrichit le document OpenAPI pour la rendre visible
(UC-ACT-11).

Il reste une porte de développement, bruyante, pour démarrer sans clé ; elle n'a pas sa place en
production.

## Exemples
### Vérifier l'état réel
```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/admin/workers        # 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/health/ready         # 200 (public)
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" -o /dev/null -w '%{http_code}\n' \
  localhost:8080/admin/workers                                               # 200
```

### Le voir dans le document OpenAPI
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/mcpagger/openapi.json \
  | jq '.paths["/admin/workers"].get.security'
# [ { "AdminApiKey": [] } ]
```

### Le tester dans sa suite
```python
assert client.post(url, json={"item": "ab", "quantity": 1}).status_code == 401
assert client.post(url, headers={"X-Admin-Key": "k"}, json={...}).status_code == 200
```

## Pièges courants
- **Supposer qu'une route de diagnostic est ouverte** parce qu'elle l'était avant : la liste des
  surfaces protégées a été élargie, volontairement.
- **Ajouter une route à la liste publique** pour contourner un 401 : on ouvre une surface, parfois
  bien plus large qu'on ne croit (UC-SEC-08).
- **Laisser la porte de développement active** en production : l'administration devient ouverte.
- **Protéger dans la vue** plutôt que par la politique : un oubli suffit, et le contrôle n'est plus
  uniforme.
- **Oublier les sondes** : elles doivent rester publiques pour que l'orchestrateur d'infrastructure
  fonctionne.

## Cas d'usage voisins
- UC-SEC-01 — protéger l'API d'administration par clé
- UC-SEC-08 — déclarer les routes publiques
- UC-ACT-11 — publier un OpenAPI exact
- UC-SUP-01 — répondre aux sondes de santé
