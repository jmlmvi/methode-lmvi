---
id: UC-ACT-01
titre: "Déclarer une action avec ses paramètres typés"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "ActionProvider, @action, @param, @McpAction, ActionResult"
---

# UC-ACT-01 — Déclarer une action avec ses paramètres typés

## Questions auxquelles répond ce cas d'usage
1. Comment rendre une capacité de mon worker appelable de l'extérieur ?
2. Faut-il écrire une route HTTP pour exposer une fonction métier ?
3. Quelle est la signature exacte d'une méthode d'action, et que reçoit-elle ?
4. Comment nommer une action, et pourquoi ce nom est-il si important ?
5. Que doit renvoyer une action, et comment signaler un refus ?
6. Une seule déclaration suffit-elle pour REST et pour MCP à la fois ?
7. Combien de logique métier ai-je le droit d'écrire dans une action ?

## Mots-clés
action, `@action`, `@param`, `ActionProvider`, `@McpAction`, `@McpParam`, déclarer, exposer,
capacité, `ActionResult.ok`, `ActionResult.failure`, `ActionContext`, `params`, nom d'action,
outil MCP, route REST, couche interface, un seul appel au service

## Ce que c'est, et quand s'en servir
Une action est une **capacité invocable** d'un worker. On la déclare par un décorateur (ou par
l'interface de fournisseur d'actions), et le socle la publie **simultanément** en REST et en outil
MCP. Aucune route à écrire, aucun schéma à maintenir à la main.

C'est la façon normale d'exposer quelque chose : créer une commande, lire un stock, relancer un
calcul. Le nom de l'action est public et stable — il devient une URL et un nom d'outil MCP, donc on
le choisit comme on choisit un nom de colonne en base.

## Ce que le socle fait · ce qu'il interdit
Le socle valide les paramètres avant d'appeler la méthode (UC-ACT-02), applique le délai
(UC-ACT-03), contrôle le scope (UC-ACT-04), audite l'invocation (UC-ACT-06), publie la description
(UC-ACT-10) et traduit le résultat en JSON de contrat. La méthode reçoit les paramètres déjà
validés et un contexte d'appel (identité, scopes, tenant, trace).

L'action est de la **couche interface** : elle traduit la requête, fait **un seul appel** à un
service, puis traduit le résultat ou l'exception attendue. Pas de règle métier, pas d'accès direct
aux modèles, pas de deuxième appel « pour compléter ». Un `if` métier dans une action est un défaut
de couche, et la revue de code le signale.

## Exemples
### socle-py-django et socle-py
```python
class OrdersWorker(Worker, ActionProvider):
    schedule = PASSIVE

    @action("create_order", description="Enregistre une commande au brouillon pour le tenant")
    @param("reference", description="Référence de la commande", required=True,
           min_length=1, max_length=40)
    @param("amount_cents", description="Montant en centimes", required=True,
           type=ParameterType.LONG, min_value=1)
    def create_order(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
        request = exchanges.OrderRequest(reference=params["reference"],
                                         amount_cents=params["amount_cents"])
        tenant_context = tenant.TenantContext.from_action_context(context)
        try:
            view = self.techdb.run(lambda: services.OrderService.create_order(
                tenant_context=tenant_context, request=request, limits=self.limits))
        except services.OrderRuleViolation as exc:
            return ActionResult.failure(str(exc), exc.rule)       # refus typé
        return ActionResult.ok(view.as_json())                    # un seul appel au service
```

### Socle Java
```java
@McpAction(name = "create_order", description = "Enregistre une commande au brouillon")
public ActionResult createOrder(
        @McpParam(name = "reference", required = true) String reference,
        @McpParam(name = "amount_cents", required = true) long amountCents,
        ActionContext context) {
    return ActionResult.ok(orderService.create(reference, amountCents, context.getTenantId()));
}
```

### Ce que ça publie, sans rien de plus
```bash
POST /admin/workers/orders_worker/actions/create_order     # REST
outil MCP : orders_worker__create_order                    # MCP
```

## Pièges courants
- **Écrire la règle métier dans l'action** : elle devient intestable sans serveur et impossible à
  réutiliser. Elle va dans un service (UC-DOM-04).
- **Renommer une action** : on casse les appelants REST, les agents IA et les scripts. Le nom est
  un contrat.
- **Renvoyer un objet du domaine** : exposer une vue explicite, stable, documentée (UC-DOM-03).
- **Mettre plusieurs appels de service dans une action** « pour aller plus vite » : la transaction
  et la règle se diluent. Un appel, un service.
- **Oublier le contexte** : sans lui, pas de tenant, pas de scope, pas de trace.

## Cas d'usage voisins
- UC-ACT-02 — valider les paramètres
- UC-ACT-07 — invoquer une action en REST
- UC-ACT-09 — exposer les actions en outils MCP
- UC-DOM-04 — porter les règles de gestion dans un service
