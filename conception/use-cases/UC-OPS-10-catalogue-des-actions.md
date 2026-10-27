---
id: UC-OPS-10
titre: "Catalogue des actions pour l'exploitant"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "/admin/actions, page catalogue, groupes, I3"
---

# UC-OPS-10 — Catalogue des actions pour l'exploitant

## Questions auxquelles répond ce cas d'usage
1. Comment un exploitant découvre-t-il les actions disponibles sur une instance ?
2. Quelles informations doit-il voir avant d'appeler une action ?
3. Comment le catalogue reste-t-il à jour ?
4. Peut-on y invoquer directement une action ?
5. Dans les moteurs Python, où est ce catalogue ?
6. Comment ranger un grand nombre d'actions pour que ce soit utilisable ?

## Mots-clés
catalogue des actions, `/admin/actions`, découverte, exploitant, groupes, `group`,
`tags`, lecture seule, confirmation, scope requis, délai, page HTML, I3,
documentation vivante, P-4

## Ce que c'est, et quand s'en servir
La liste des actions d'une instance, avec ce qu'il faut savoir avant d'appeler : à quoi elle sert,
quels paramètres, quel droit, est-elle destructrice, combien de temps elle peut prendre. C'est la
documentation vivante de la surface d'exploitation.

Elle est produite depuis le registre réel : elle ne peut pas être périmée — contrairement à une page
de wiki maintenue à la main.

## Ce que le socle fait · ce qu'il interdit
Tous les moteurs servent la liste en JSON. Côté Java, une page d'exploitation la présente
lisiblement ; dans les moteurs Python, la page relève de la phase **P-4**, mais le JSON est déjà là
et suffit à un exploitant outillé.

Ce que le socle ne peut pas inventer : la qualité des descriptions et le rangement par groupe. Un
catalogue de quarante actions sans groupes ni descriptions utiles n'aide personne — ni un humain, ni
un agent (UC-ACT-13).

## Exemples
### Le catalogue, partout
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/actions \
  | jq '.[] | {name, group, read_only, requires_confirmation, required_scope}'

curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/workers/orders_worker/actions
```

### Le rendre lisible
```python
@action("list_orders", description="Commandes et encours du tenant", read_only=True,
        group="orders", tags=("reporting",))
@action("purge_tenant", description="Supprime toutes les données du tenant",
        group="orders", requires_confirmation=True, required_scope="orders.admin")
```

### Ce qu'un exploitant en fait
```bash
# Les actions sans danger, pour un diagnostic
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/actions \
  | jq -r '.[] | select(.read_only) | "\(.group // "-")  \(.name)"' | sort
```

## Pièges courants
- **Descriptions vides** : le catalogue existe mais ne renseigne rien.
- **Aucun groupe** : illisible au-delà de vingt actions.
- **Actions destructrices non marquées** : un exploitant pressé ne verra pas le risque.
- **Un catalogue recopié à la main** dans un wiki : il se périme dès la livraison suivante.

## Cas d'usage voisins
- UC-ACT-10 — publier la spécification des actions
- UC-ACT-05 — lecture seule et confirmation requise
- UC-UI-03 — servir le catalogue des actions
- UC-ACT-13 — consommer les actions depuis un agent IA
