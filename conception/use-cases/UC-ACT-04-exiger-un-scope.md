---
id: UC-ACT-04
titre: "Exiger un scope pour une action"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "required_scope, scope-enforcement, strict, log-only, RG-12"
---

# UC-ACT-04 — Exiger un scope pour une action

## Questions auxquelles répond ce cas d'usage
1. Comment réserver une action à certains appelants seulement ?
2. Qu'est-ce qu'un scope, et d'où vient-il dans un appel ?
3. Mon action à scope requis s'exécute quand même sans ce scope : est-ce normal ?
4. Quelle différence entre le mode permissif et le mode strict, et lequel mettre en production ?
5. Comment voir les violations de scope avant de passer en strict ?
6. Faut-il déclarer un scope sur les actions de lecture ?
7. Comment un scope est-il déclaré au Hub pour être accordé aux utilisateurs ?

## Mots-clés
scope, `required_scope`, droit, habilitation, autorisation, `scope-enforcement`, strict,
`log-only`, permissif, violation de scope, JWT délégué, `socle.actions.invoke`, RG-12,
manifeste de déploiement, 403

## Ce que c'est, et quand s'en servir
Un nom de droit porté par l'appelant et exigé par l'action. On l'utilise pour séparer ce que tout
le monde peut faire de ce qui est réservé : lire un stock contre modifier un stock, consulter un
dossier contre le clôturer.

Les scopes arrivent avec l'identité (UC-SEC-03) : le Hub émet un jeton portant les scopes de
l'utilisateur, et le socle les transmet jusqu'à l'action (UC-SEC-05). Les scopes qu'une application
attend sont déclarés dans son manifeste de déploiement (UC-INT-08).

## Ce que le socle fait · ce qu'il interdit
Le socle compare le scope requis aux scopes de l'appelant et refuse l'exécution — **si** le mode
d'application est strict. Par défaut, le mode est permissif : la violation est **tracée et comptée**
mais l'action s'exécute. C'est un choix assumé du chantier, documenté comme tel : il permet
d'instrumenter une application existante sans la casser, puis de basculer.

Donc : une action à scope requis **n'est pas protégée** tant que le mode est permissif. La
protection d'une surface entière ne repose jamais sur ce seul réglage (UC-SEC-07).

## Exemples
### socle-py-django et socle-py
```python
@action("cancel_order", description="Annule une commande", required_scope="orders.write")
def cancel_order(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...

@action("list_orders", description="Commandes du tenant", read_only=True,
        required_scope="orders.read")
def list_orders(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...
```
```yaml
socle:
  actions:
    scope-enforcement: ${SCOPE_ENFORCEMENT:log-only}   # strict recommandé en production
```

### Socle Java
```java
@McpAction(name = "cancel_order", requiredScope = "orders.write")
```

### Constater une violation
```bash
… WARN socle.actions - [step:action_scope_violation] action=cancel_order required=orders.write
                       caller=alice scopes=[orders.read]
```

## Pièges courants
- **Croire le mode strict actif par défaut** : il ne l'est pas. Vérifier la configuration avant
  d'annoncer une action protégée.
- **Basculer en strict sans avoir lu les traces** : on casse des appelants légitimes. Les
  violations comptées en mode permissif sont exactement la liste des choses à corriger.
- **Un scope par action** : l'habilitation devient ingérable. Grouper par domaine et par droit.
- **Oublier de déclarer le scope dans le manifeste** : le Hub ne peut pas l'accorder, et personne
  ne l'a jamais.
- **Confondre scope et tenant** : le scope dit ce que l'appelant peut faire, le tenant dit sur
  quelles données (UC-DB-09).

## Cas d'usage voisins
- UC-SEC-03 — accepter les JWT délégués du Hub
- UC-SEC-05 — transmettre scopes et tenant jusqu'à l'action
- UC-SEC-07 — fermer par défaut les surfaces non publiques
- UC-INT-08 — déployer via le manifeste du Hub
