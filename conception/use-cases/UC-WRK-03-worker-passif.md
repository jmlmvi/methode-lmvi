---
id: UC-WRK-03
titre: "Worker passif — jamais planifié, piloté par ses actions"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "schedule = PASSIVE, ActionProvider, RG-02"
---

# UC-WRK-03 — Worker passif : jamais planifié, piloté par ses actions

## Questions auxquelles répond ce cas d'usage
1. Comment écrire un worker qui ne fait rien tout seul et ne répond qu'aux appels qu'on lui fait ?
2. Mon worker n'a aucune tâche périodique : que dois-je mettre comme planification ?
3. Pourquoi mon worker passif apparaît-il quand même dans la liste des workers démarrés ?
4. Est-ce qu'un worker passif consomme des ressources quand personne ne l'appelle ?
5. Comment exposer une capacité à un agent IA sans écrire de route HTTP ?
6. Un worker passif peut-il aussi réagir à des messages internes ?
7. Quelle différence entre un worker passif et un worker désactivé ?

## Mots-clés
worker passif, `PASSIVE`, pas de planification, jamais planifié, piloté par les actions,
`ActionProvider`, action REST, outil MCP, `PassiveActionWorker`, `passive_action_worker.py`,
RG-02, service à la demande, à la demande, sans cycle

## Ce que c'est, et quand s'en servir
Un worker passif est **démarré, vivant, supervisé, mais jamais planifié** : il ne fait rien de
lui-même. Il sert ses actions (UC-ACT-01) — c'est la forme normale pour exposer une capacité à un
humain, à un frontend ou à un agent IA — ou il consomme des événements internes.

C'est le modèle qu'on choisit par défaut pour une application orientée service : interroger un
stock, créer une commande, lancer un calcul. Toute la surface REST et MCP vient de là, sans écrire
une seule route HTTP.

## Ce que le socle fait · ce qu'il interdit
Déclarer `PASSIVE` (ou un intervalle ≤ 0) fait que le socle **n'inscrit aucune échéance** : le
worker n'apparaît pas dans les planifications, mais il apparaît bien dans la liste des workers avec
sa santé et ses statistiques. Il est initialisé et arrêté comme les autres, dans l'ordre des
priorités.

Un worker passif n'a pas le droit de se donner son propre rythme : ni boucle d'attente, ni fil
d'exécution. S'il a besoin de travailler à intervalle régulier, c'est qu'il n'est pas passif
(UC-WRK-01) — ou qu'il consomme un flux (UC-WRK-09).

## Exemples
### socle-py-django et socle-py
```python
class InventoryWorker(Worker, ActionProvider):
    schedule = PASSIVE                      # démarré, jamais planifié (RG-02)

    @property
    def name(self) -> str:
        return "inventory_worker"

    @action("get_item", description="Lire le stock d'un article")
    @param("item", description="Code article", required=True, pattern=r"^[a-z0-9-]+$")
    def get_item(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
        item = params["item"]
        quantity = self._stock.get(item)
        if quantity is None:
            return ActionResult.failure(f"Article {item} inconnu", "NOT_FOUND")
        return ActionResult.ok({"item": item, "quantity": quantity})
```
L'action est aussitôt servie en REST **et** publiée en outil MCP `inventory_worker__get_item`.

### Socle Java
```java
@Component
public class InventoryWorker implements Worker, ActionProvider {
    @Override public String getSchedule() { return Worker.PASSIVE; }
    @Override public void doWork() { /* jamais appelé */ }
}
```

### Vérifier qu'il n'est pas planifié
```python
await orchestrator.start()
assert "inventory_worker" not in orchestrator.schedules      # RG-02
```

## Pièges courants
- **Écrire du travail dans la méthode de cycle** d'un worker passif : elle ne sera jamais appelée,
  et le code mort passe inaperçu des mois.
- **Confondre passif et désactivé** : un worker désactivé (UC-WRK-06) n'est ni planifié **ni
  supervisé** et ne sert pas ses actions de la même façon ; un worker passif est pleinement vivant.
- **Appeler le travail de cycle depuis une action** pour « réutiliser » : mettre la logique commune
  dans une méthode privée appelée par les deux.
- **Croire qu'un worker passif n'a pas besoin de santé** : il est supervisé comme les autres, sa
  santé doit dire quelque chose de vrai.

## Cas d'usage voisins
- UC-ACT-01 — déclarer une action
- UC-WRK-06 — désactiver un worker
- UC-WRK-09 — worker événementiel
- UC-ACT-09 — exposer les actions en outils MCP
