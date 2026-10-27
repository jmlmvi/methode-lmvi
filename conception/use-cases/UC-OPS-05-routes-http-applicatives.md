---
id: UC-OPS-05
titre: "Servir des routes HTTP applicatives"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "RestControllerTemplate, HttpWorker, actions à la place des routes"
---

# UC-OPS-05 — Servir des routes HTTP applicatives

## Questions auxquelles répond ce cas d'usage
1. Comment exposer une route HTTP propre à mon application ?
2. Pourquoi les moteurs Python ne permettent-ils pas d'ajouter des routes ?
3. Que faut-il utiliser à la place, et qu'est-ce qu'on y perd ?
4. Comment un frontend consomme-t-il une application Socle sans routes dédiées ?
5. Un chemin d'URL propre est-il indispensable, ou est-ce une préférence ?
6. Que se passe-t-il si j'ajoute quand même une route par la pile web sous-jacente ?

## Mots-clés
route HTTP, `@RestController`, `RestControllerTemplate`, `HttpWorker`, chemin d'URL,
action à la place d'une route, hors périmètre, API applicative, frontend,
contrat non garanti, Django Ninja, ASGI, rétrocompatibilité

## Ce que c'est, et quand s'en servir
Dans le Socle Java, une application peut ajouter ses propres routes HTTP avec un contrôleur, servi
sur le port principal. C'est pratique pour une API métier au chemin choisi, ou pour recevoir des
appels d'un partenaire qui impose son format.

Dans les moteurs Python, c'est **hors périmètre** : la couche web est une application ASGI (Django
et Django Ninja), mais **aucune API d'ajout de routes n'est contractualisée ni testée**. La surface
HTTP est celle du socle, et les capacités de l'application s'exposent par ses actions.

## Ce que le socle fait · ce qu'il interdit
Java : le worker HTTP tient le cycle de vie du serveur, le drain et le comptage des requêtes en
cours ; vos contrôleurs vivent dessus.

Python : les actions sont le chemin prévu — elles donnent REST et MCP d'un coup, avec validation,
scope, audit et documentation. On y perd le choix du chemin d'URL et la liberté du format de corps ;
on y gagne tout le reste.

Rien n'empêche techniquement de greffer une route dans la pile sous-jacente, mais ce serait **hors
contrat** : non testé, susceptible de casser à une évolution du socle, et privé des contrôles
transverses. Si le besoin est réel et durable, il se traite en évolution de contrat (UC-CTR-05), pas
en contournement local.

## Exemples
### Socle Java
```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @PostMapping public ResponseEntity<OrderView> create(@RequestBody OrderRequest request) { … }
}
```

### Moteurs Python — l'équivalent, par une action
```python
@action("create_order", description="Enregistre une commande au brouillon")
@param("reference", required=True, min_length=1, max_length=40)
@param("amount_cents", required=True, type=ParameterType.LONG, min_value=1)
def create_order(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...
```
```bash
POST /admin/workers/orders_worker/actions/create_order
```

### Pour un partenaire qui impose son chemin
Le bon endroit est la Gateway : elle réécrit le chemin public vers la route d'action
(UC-INT-06). L'application reste dans le contrat.

Depuis la livraison des pages (UC-OPS-07), les moteurs Python servent du **HTML déclaré**
(``@page``) : c'est la seule surface HTTP qu'une application y ajoute. Des routes JSON quelconques
restent **hors périmètre** — une capacité s'expose en action, publiée d'un coup en REST et en MCP,
avec sa validation, son audit et sa sécurité.

## Pièges courants
- **Greffer une route non contractualisée** : elle cassera, et sans contrôle de sécurité uniforme.
- **Croire qu'une action est moins bien** : elle apporte validation, scope, audit, MCP et
  documentation.
- **Faire porter la réécriture d'URL à l'application** : c'est le travail du point d'entrée.
- **Oublier que le corps d'une action est un objet JSON** de paramètres nommés : un format exotique
  se traite en amont.

## Cas d'usage voisins
- UC-ACT-07 — invoquer une action en REST
- UC-OPS-06 — recevoir un webhook externe
- UC-INT-06 — s'insérer derrière la Gateway
- UC-CTR-05 — faire évoluer un contrat dans les trois moteurs
