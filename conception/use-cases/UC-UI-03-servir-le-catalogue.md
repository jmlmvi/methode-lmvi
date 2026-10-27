---
id: UC-UI-03
titre: "Servir le catalogue des actions"
theme: "UC-UI · Pages et frontend"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "page de catalogue, groupes, métadonnées d'actions"
---

# UC-UI-03 — Servir le catalogue des actions

## Questions auxquelles répond ce cas d'usage
1. Comment présenter les actions d'une instance de façon lisible à un humain ?
2. Que doit afficher la page pour être réellement utile ?
3. Peut-on invoquer une action depuis cette page ?
4. Comment la page reste-t-elle à jour ?
5. Dans les moteurs Python, où en est-elle ?
6. Qui doit y avoir accès ?

## Mots-clés
catalogue, page d'actions, groupes, `group`, `tags`, description, paramètres,
lecture seule, confirmation, scope requis, invocation depuis la page, à jour,
protection, I3, P-4

## Ce que c'est, et quand s'en servir
La présentation lisible du catalogue d'actions (UC-OPS-10) : groupes, descriptions, paramètres, et
les indications d'intention — lecture seule, confirmation requise, droit exigé. Une page qui permet
à un exploitant de comprendre ce qu'il peut faire avant de le faire.

## Ce que le socle fait · ce qu'il interdit
Java : la page existe et s'appuie sur le registre réel, donc elle ne peut pas être périmée. Moteurs
Python : phase **P-4** ; le JSON est déjà servi.

Si la page permet d'invoquer, alors deux exigences : respecter les confirmations déclarées, et
conserver l'audit (UC-ACT-06). Une page d'invocation sans trace, c'est une porte sans registre.

## Exemples
### Les données de la page, déjà disponibles partout
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/actions \
  | jq 'group_by(.group) | map({groupe: .[0].group, actions: [.[].name]})'
```

### Ce qui rend la page utile
```python
@action("purge_tenant", description="Supprime toutes les données du tenant",
        group="orders", requires_confirmation=True, required_scope="orders.admin")
```

## Pièges courants
- **Des descriptions absentes** : la page affiche une liste de noms, sans valeur.
- **Pas de groupes** : illisible dès vingt actions.
- **Invoquer sans respecter les confirmations** : la page devient plus dangereuse que l'API.
- **L'ouvrir trop largement** : c'est la surface d'administration.

## Cas d'usage voisins
- UC-OPS-10 — catalogue des actions pour l'exploitant
- UC-ACT-05 — lecture seule et confirmation requise
- UC-ACT-10 — publier la spécification des actions
- UC-UI-01 — servir le tableau de bord des workers
