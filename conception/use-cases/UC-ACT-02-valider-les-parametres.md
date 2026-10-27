---
id: UC-ACT-02
titre: "Valider les paramètres d'une action"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "@param, pattern, allowed_values, min_value, max_length, ActionValidationFailed"
---

# UC-ACT-02 — Valider les paramètres d'une action

## Questions auxquelles répond ce cas d'usage
1. Où déclare-t-on qu'un paramètre est obligatoire, borné, ou limité à certaines valeurs ?
2. Dois-je revérifier les entrées dans mon service, puisque l'action les valide déjà ?
3. Quelle réponse reçoit l'appelant quand un paramètre est invalide ?
4. Comment imposer un format précis, par exemple un code en minuscules sans espace ?
5. La validation protège-t-elle aussi les appels venant d'un agent IA par MCP ?
6. Comment donner une valeur par défaut sans la coder dans la méthode ?
7. Un paramètre validé peut-il quand même être refusé ensuite par une règle de gestion ?

## Mots-clés
validation, `@param`, obligatoire, `required`, `pattern`, expression régulière,
`allowed_values`, valeurs permises, `min_value`, `max_value`, `min_length`, `max_length`,
`default`, type, `ParameterType`, `ActionValidationFailed`, 400, erreur de requête,
même moteur pour REST et MCP

## Ce que c'est, et quand s'en servir
La description des paramètres **est** la validation : type, obligation, bornes, motif, valeurs
permises, défaut, exemple. Un seul endroit, et le socle applique la règle avant d'appeler la
méthode — pour les appels REST comme pour les appels MCP.

Cette validation est **syntaxique** : elle dit si l'entrée est recevable, pas si l'opération est
permise. « Le montant est un entier positif » est de la validation ; « le montant dépasse le
plafond du client » est une règle de gestion, et elle appartient au service (UC-DOM-04).

## Ce que le socle fait · ce qu'il interdit
Le socle refuse l'appel avant d'entrer dans votre code, avec un message qui nomme le paramètre et
la contrainte violée, et le même refus quel que soit l'appelant. Les contraintes sont aussi
publiées dans la spécification et dans le schéma des outils MCP : un agent IA voit les bornes
avant d'appeler.

Ce qu'il ne fait pas : deviner vos invariants métier. Et un service du domaine ne doit **pas** faire
confiance aveuglément à la couche interface : il normalise et vérifie ce dont il dépend — c'est ce
qui permet de l'appeler depuis un test, un autre worker ou un script sans rejouer la validation.

## Exemples
### socle-py-django et socle-py
```python
@action("put_item", description="Enregistre une quantité en stock")
@param("item", description="Code article", required=True, pattern=r"^[a-z0-9-]+$", max_length=40)
@param("quantity", description="Quantité", required=True, type=ParameterType.INTEGER,
       min_value=0, max_value=10_000)
@param("unit", description="Unité", allowed_values=("piece", "box"), default="piece")
def put_item(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    # params est déjà validé ET complété des valeurs par défaut.
    return ActionResult.ok({"item": params["item"], "quantity": params["quantity"],
                            "unit": params["unit"]})
```

### Ce que voit l'appelant
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"item":"Vis M4","quantity":1}' \
  localhost:8080/admin/workers/stock_worker/actions/put_item
# 400 — "item" ne respecte pas le motif ^[a-z0-9-]+$
```

### Socle Java
```java
@McpParam(name = "quantity", required = true, min = 0, max = 10000) int quantity
```

## Pièges courants
- **Valider dans la méthode** ce que le décorateur sait faire : du code en double, et la
  spécification publiée devient fausse.
- **Confondre validation et règle de gestion** : la première est générique et refusable en 400, la
  seconde porte un code métier (UC-ACT-12).
- **Un motif trop permissif** sur un paramètre repris dans une requête ou un chemin de fichier :
  la validation est la première barrière de sécurité.
- **Oublier `default`** et gérer l'absence dans la méthode : le défaut déclaré est visible par les
  appelants, le défaut codé ne l'est pas.
- **Des bornes sans raison** : elles finissent par refuser un cas métier légitime.

## Cas d'usage voisins
- UC-ACT-01 — déclarer une action
- UC-ACT-12 — distinguer un refus métier d'une panne
- UC-ACT-10 — publier la spécification des actions
- UC-DOM-04 — porter les règles de gestion dans un service
