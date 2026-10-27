---
id: UC-ACT-05
titre: "Action en lecture seule ou à confirmation requise"
theme: "UC-ACT · Actions REST et MCP"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "read_only, requires_confirmation, tags, group, deprecated"
---

# UC-ACT-05 — Action en lecture seule ou à confirmation requise

## Questions auxquelles répond ce cas d'usage
1. Comment dire à un agent IA qu'une action est sans danger, ou au contraire destructrice ?
2. À quoi sert exactement le drapeau de lecture seule — le socle empêche-t-il l'écriture ?
3. Comment demander une confirmation humaine avant une opération irréversible ?
4. Comment ranger mes actions par groupe pour qu'un catalogue reste lisible ?
5. Comment signaler qu'une action est dépréciée sans la supprimer tout de suite ?
6. Ces indications apparaissent-elles dans les outils MCP et dans la spécification publiée ?

## Mots-clés
lecture seule, `read_only`, sans effet de bord, destructeur, `requires_confirmation`,
confirmation, irréversible, garde-fou, `tags`, `group`, catalogue, `deprecated`,
`deprecation_message`, `since`, métadonnées d'action, agent IA, outil MCP

## Ce que c'est, et quand s'en servir
Des métadonnées qui **décrivent l'intention** d'une action : est-elle sans effet de bord ?
Faut-il une confirmation avant de la lancer ? À quel groupe appartient-elle ? Est-elle dépréciée ?

Elles comptent surtout depuis l'arrivée des agents : un client MCP choisit les outils qu'il
appelle, et il a besoin de savoir lequel est une simple lecture et lequel efface des données. Un
catalogue sans ces indications pousse à l'accident.

## Ce que le socle fait · ce qu'il interdit
Le socle publie ces métadonnées dans la liste des actions, dans la spécification et dans le schéma
des outils MCP. Le drapeau de confirmation est **une déclaration d'intention** que les clients
honorent (le Hub, une interface, un agent) ; le drapeau de lecture seule renseigne l'appelant et
l'audit.

Attention à ne pas s'y tromper : le socle **n'empêche pas** une action déclarée en lecture seule
d'écrire. C'est une promesse que le code doit tenir. Mentir ici, c'est tromper les clients qui s'y
fient — un agent considérera cette action comme rejouable sans risque.

## Exemples
### socle-py-django et socle-py
```python
@action("list_orders", description="Commandes et encours du tenant", read_only=True,
        group="orders", tags=("reporting",))
def list_orders(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...

@action("purge_tenant", description="Supprime toutes les données du tenant",
        requires_confirmation=True, required_scope="orders.admin")
def purge_tenant(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...

@action("old_export", description="Export historique", deprecated=True,
        deprecation_message="Utilisez export_orders depuis la 5.9")
def old_export(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...
```

### Socle Java
```java
@McpAction(name = "purge_tenant", requiresConfirmation = true, readOnly = false)
```

### Le vérifier dans le catalogue
```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" localhost:8080/admin/actions \
  | jq '.[] | select(.requires_confirmation) | .name'
```

## Pièges courants
- **Déclarer une action en lecture seule alors qu'elle écrit** (un compteur, un cache, un journal
  métier) : le drapeau devient un mensonge exploité par les agents.
- **Attendre du socle un verrou de confirmation** : c'est le client qui demande la confirmation.
  Pour un vrai garde-fou côté serveur, exiger un paramètre explicite et un scope.
- **Ne pas grouper** : au-delà de vingt actions, un catalogue sans groupe est illisible.
- **Supprimer une action sans phase de dépréciation** : les agents et les scripts cassent sans
  préavis.

## Cas d'usage voisins
- UC-ACT-01 — déclarer une action
- UC-ACT-04 — exiger un scope
- UC-ACT-10 — publier la spécification des actions
- UC-ACT-13 — consommer les actions depuis un agent IA
