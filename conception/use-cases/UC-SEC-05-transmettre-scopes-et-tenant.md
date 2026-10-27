---
id: UC-SEC-05
titre: "Transmettre scopes et tenant jusqu'à l'action"
theme: "UC-SEC · Sécurité et identité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "ActionContext, CallerIdentity, request.socle_identity, RG-29"
---

# UC-SEC-05 — Transmettre scopes et tenant jusqu'à l'action

## Questions auxquelles répond ce cas d'usage
1. Comment mon action connaît-elle l'identité de l'appelant ?
2. Que contient exactement le contexte d'appel ?
3. D'où viennent les scopes et le tenant, et peuvent-ils être falsifiés ?
4. Comment construire le contexte de tenant à partir du contexte d'appel ?
5. L'identité est-elle la même en REST et en MCP ?
6. Un worker planifié a-t-il une identité ?
7. Comment tester une action avec une identité donnée ?

## Mots-clés
`ActionContext`, contexte d'appel, identité, `CallerIdentity`, `caller_id`, `CallerType`,
scopes, tenant, `tenant_id`, trace, `request.socle_identity`, `TenantContext.from_action_context`,
propagation, RG-29, REST, MCP, interne

## Ce que c'est, et quand s'en servir
Le lien entre l'authentification et le métier : une fois l'appelant authentifié, le socle pose son
identité sur la requête et la passe à l'action dans un **contexte d'appel** — qui appelle, par
quel canal, avec quels scopes, pour quel tenant, sous quelle trace.

C'est ce contexte que l'interface traduit en contexte de tenant pour appeler le domaine
(UC-DB-09). Toute action qui touche des données isolées en a besoin.

## Ce que le socle fait · ce qu'il interdit
Le socle résout l'identité **une fois**, au bord de l'application, à partir du titre d'accès
présenté, et la propage ensuite. L'identité est la même quel que soit le canal : REST, MCP, ou
appel interne — le type d'appelant change, pas la structure.

Ce que le code applicatif ne doit pas faire : relire les en-têtes lui-même pour « retrouver » le
tenant ou l'utilisateur. La résolution est centralisée, avec ses règles de confiance
(UC-SEC-06) ; la contourner, c'est rouvrir la porte qu'elle ferme.

## Exemples
### Dans l'action
```python
def confirm_order(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    # Le tenant vient de l'identité, pas des paramètres.
    tenant_context = tenant.TenantContext.from_action_context(context)
    ...
```

### Ce que porte le contexte
```python
context.caller_id        # "alice@exemple.fr" ou l'appelant de confiance
context.caller_type      # REST | MCP | INTERNAL
context.tenant_id        # "acme" — ou None, et alors les tables partitionnées refusent
context.scopes           # les droits portés par le jeton
```

### En test
```python
ctx = ActionContext("test", CallerType.REST, tenant_id="acme", scopes=("orders.write",))
resultat = await executor.execute("orders_worker", "confirm_order", {"reference": "C-1"}, ctx)
```

### Socle Java
```java
public ActionResult confirmOrder(@McpParam(name = "reference") String reference,
                                 ActionContext context) {
    String tenant = context.getTenantId();
    ...
}
```

## Pièges courants
- **Prendre le tenant dans les paramètres de l'action** : n'importe quel appelant choisirait alors
  ses données. Le tenant vient de l'identité.
- **Ignorer le contexte** dans une action multi-tenant : refus `MISSING_TENANT`, et c'est le bon
  comportement.
- **Relire les en-têtes dans le code applicatif** : on recrée une résolution d'identité sans ses
  garde-fous.
- **Supposer une identité dans un worker planifié** : il n'a pas d'appelant ; il boucle
  explicitement sur les tenants (UC-DB-10).
- **Journaliser le jeton** : seule l'identité résolue a sa place dans les traces.

## Cas d'usage voisins
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-SEC-06 — proxy de confiance pour l'en-tête de tenant
- UC-DB-09 — isoler les données métier par tenant
- UC-ACT-04 — exiger un scope
