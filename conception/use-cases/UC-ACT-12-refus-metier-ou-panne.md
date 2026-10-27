---
id: UC-ACT-12
titre: "Distinguer un refus métier d'une panne"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "ActionResult.failure, errorType, exception anticipée"
---

# UC-ACT-12 — Distinguer un refus métier d'une panne

## Questions auxquelles répond ce cas d'usage
1. Comment dire à l'appelant « c'est refusé, et voilà pourquoi » sans faire croire à une panne ?
2. À quoi sert le code de refus, et qui le choisit ?
3. Pourquoi ne pas simplement renvoyer un message d'erreur lisible ?
4. Un refus métier doit-il arriver en 200 ou en 400 ?
5. Comment mon service signale-t-il un refus, s'il ne connaît pas la couche interface ?
6. Que faire des exceptions non anticipées — faut-il les attraper ?
7. Comment un agent IA réagit-il différemment selon le code de refus ?

## Mots-clés
refus, refus métier, `errorType`, code de refus, `ActionResult.failure`, exception anticipée,
exception dédiée, `OrderRuleViolation`, `NOT_CONFIRMABLE`, `MISSING_TENANT`, panne, 500,
message d'erreur, contrat d'erreur, stabilité des codes

## Ce que c'est, et quand s'en servir
Un refus métier n'est pas une panne. « La commande est déjà confirmée » est un résultat normal du
domaine ; « la base ne répond pas » est une panne. L'appelant doit pouvoir les distinguer **sans
lire le message**, car un message est fait pour un humain et change au fil des versions.

D'où le code de refus : une chaîne stable, en majuscules, qui nomme la règle violée. C'est un
contrat aussi sérieux que les routes — un client peut l'utiliser pour brancher un comportement, un
agent IA pour décider s'il réessaie ou s'il demande autre chose à l'utilisateur.

## Ce que le socle fait · ce qu'il interdit
Le socle transporte le code tel quel dans la réponse, et une exception non attrapée devient une
panne journalisée. Il ne classe rien pour vous : c'est le domaine qui nomme ses refus.

La bonne chaîne est : le service lève une **exception dédiée** portant le code de la règle ;
l'action l'attrape — et seulement celle-là — et la traduit en refus. On n'attrape jamais toutes les
exceptions pour les transformer en refus : une panne déguisée en refus métier se traduit par un
incident invisible.

## Exemples
### Le service nomme la règle
```python
class OrderRuleViolation(Exception):
    def __init__(self, rule: str, message: str):
        super().__init__(message)
        self.rule = rule          # NOT_CONFIRMABLE, AMOUNT_ABOVE_LIMIT, …

if order.status != OrderStatus.DRAFT:
    raise OrderRuleViolation("NOT_CONFIRMABLE", f"Commande {reference} déjà au statut {order.status}")
```

### L'action traduit, sans décider
```python
try:
    view = self.techdb.run(lambda: services.OrderService.confirm_order(...))
except services.OrderRuleViolation as exc:          # attendue : refus typé
    return ActionResult.failure(str(exc), exc.rule)
except tenant.MissingTenant as exc:                 # attendue : refus typé
    return ActionResult.failure(str(exc), "MISSING_TENANT")
return ActionResult.ok(view.as_json())
# Toute autre exception remonte : c'est une panne, et elle doit se voir comme telle.
```

### Ce que reçoit l'appelant
```json
{"success": false, "data": {}, "error": "Commande C-1 déjà au statut CONFIRMED",
 "errorType": "NOT_CONFIRMABLE"}
```

### Socle Java
```java
return ActionResult.failure(exc.getMessage(), exc.getRule());
```

## Pièges courants
- **Attraper toutes les exceptions** et renvoyer un refus générique : les pannes disparaissent des
  radars.
- **Changer un code de refus** entre deux versions : les clients branchés dessus cassent
  silencieusement.
- **Mettre l'explication dans le code** (`ERREUR_LE_MONTANT_EST_TROP_GRAND_POUR_CE_CLIENT`) : le
  code nomme la règle, le message explique.
- **Un seul code pour tous les refus** : l'appelant ne peut rien en faire.
- **Refuser sans message** : l'humain qui lit le journal a besoin du contexte.

## Cas d'usage voisins
- UC-ACT-02 — valider les paramètres
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-ACT-07 — invoquer une action en REST
- UC-DB-10 — refuser un accès sans tenant
