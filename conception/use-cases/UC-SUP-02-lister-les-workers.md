---
id: UC-SUP-02
titre: "Lister les workers, leur état et leurs statistiques"
theme: "UC-SUP · Supervision et exploitation"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "GET /workers, GET /admin/workers, WorkerStatusService"
---

# UC-SUP-02 — Lister les workers, leur état et leurs statistiques

## Questions auxquelles répond ce cas d'usage
1. Comment savoir quels workers tournent dans une instance, et comment ils vont ?
2. Quelle route interroger, et faut-il un titre d'accès ?
3. Que contient la réponse pour chaque worker ?
4. Comment repérer d'un coup d'œil un worker malade ou désactivé ?
5. Où voit-on qu'un worker est planifié, et à quel rythme ?
6. Comment exploiter ces données pour une alerte ?
7. Pourquoi cette route a-t-elle deux adresses ?

## Mots-clés
liste des workers, `/workers`, `/admin/workers`, état, `healthy`, `enabled`, statistiques,
`stats`, `workers_count`, supervision, diagnostic, alerte, tableau de bord,
clé d'administration, JSON

## Ce que c'est, et quand s'en servir
La vue d'ensemble d'une instance : chaque worker, son état de santé, son activation, ses
statistiques. C'est la première chose à regarder quand quelque chose ne va pas, et la source
naturelle d'une alerte.

Deux adresses pour la même information, pour des raisons de compatibilité historique ; les deux sont
protégées depuis la fermeture par défaut des surfaces (UC-SEC-07).

## Ce que le socle fait · ce qu'il interdit
Le socle agrège ce que les workers publient : il appelle leur santé et récupère leurs statistiques.
La qualité de cette vue dépend donc entièrement de l'honnêteté des workers (UC-WRK-08) — le socle ne
sait rien de plus que ce qu'ils disent.

Ce n'est pas un historique : c'est un instantané. Pour une tendance, il faut des métriques
(UC-SUP-08) ou une collecte externe.

## Exemples
### Interroger
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers
# {"workers":{"orders_worker":{"stats":{"created":2,"refusals":6},"healthy":true,"enabled":true},
#             "nightly_purge_worker":{"stats":{"runs":1},"healthy":true,"enabled":true}},
#  "workers_count":2}
```

### Repérer ce qui va mal
```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers \
  | jq -r '.workers | to_entries[] | select(.value.healthy == false) | .key'
```

### En faire une alerte
```bash
# Un worker malade, ou une file d'échec qui se remplit : deux signaux à surveiller.
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers \
  | jq '[.workers[] | select(.healthy == false)] | length'
```

## Pièges courants
- **Des statistiques inutiles** : un compteur qui ne sert à aucune décision encombre la vue.
- **Un worker toujours sain** : la liste devient décorative.
- **Y chercher un historique** : l'instantané ne dit rien de la tendance.
- **Appeler cette route très fréquemment** : elle interroge tous les workers ; elle n'est pas faite
  pour être sondée dix fois par seconde.
- **Oublier le titre d'accès** dans un script d'alerte : l'alerte croit l'instance morte sur un 401.

## Cas d'usage voisins
- UC-WRK-08 — publier santé et statistiques
- UC-SUP-01 — répondre aux sondes de santé
- UC-SUP-12 — tableau de bord d'exploitation
- UC-SUP-08 — exposer des métriques Prometheus
