---
id: UC-OPS-01
titre: "Piloter le système par commandes"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "ControlWorker, control.command, set_mode, get_status, K6"
---

# UC-OPS-01 — Piloter le système par commandes

## Questions auxquelles répond ce cas d'usage
1. Comment donner un ordre à une instance en marche, sans la redéployer ?
2. Quelles commandes existent, et comment les découvrir ?
3. Qu'est-ce qu'un mode système, et à quoi sert un mode dégradé ?
4. Comment une commande atteint-elle l'instance — route HTTP ou message interne ?
5. Les commandes sont-elles tracées et comptées ?
6. Dans les moteurs Python, par quoi remplacer ce worker ?
7. Comment éviter qu'une commande d'exploitation devienne une porte dérobée ?

## Mots-clés
pilotage, commande, `ControlWorker`, `control.command`, `control.mode_changed`,
`set_mode`, `NORMAL`, `SAFE`, `DEGRADED`, `get_status`, `ping`, `help`,
`trigger_maintenance`, worker intégré, exploitation, audit, K6, P-4

## Ce que c'est, et quand s'en servir
Un worker intégré qui reçoit des commandes d'exploitation et agit sur le système : état global,
changement de mode, déclenchement d'une maintenance. Les commandes arrivent par un sujet interne du
bus, et le worker publie en retour les changements d'état.

Le mode système est l'usage le plus intéressant : passer une instance en mode restreint pendant un
incident — moins de travail en arrière-plan, le strict nécessaire — sans la redéployer.

## Ce que le socle fait · ce qu'il interdit
Java : le worker de pilotage expose ses commandes, compte ce qu'il reçoit, traite et réussit, et
publie les changements de mode sur le bus pour que les autres workers s'y adaptent. Certaines
commandes y sont encore des emplacements réservés — la liste publiée dit lesquelles.

Moteurs Python : phase **P-4**. En attendant, on expose des **actions applicatives** ciblées, avec
scope et confirmation, plutôt qu'une commande générique.

Ce qu'il faut éviter dans tous les cas : une commande « exécute ceci » qui prend du code ou du SQL
libre. Une commande d'exploitation est nommée, bornée, auditée.

## Exemples
### Socle Java — les commandes
```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{}' \
  localhost:8080/admin/workers/control_worker/actions/get_status

curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"mode":"DEGRADED"}' localhost:8080/admin/workers/control_worker/actions/set_mode
```

### S'adapter au mode, dans son propre worker
```python
def initialize(self) -> None:
    self._kv_bus.sub("control.mode_changed", self._on_mode)      # à l'initialisation

def _on_mode(self, payload: dict) -> None:
    self._mode = payload.get("mode", "NORMAL")

def do_work(self) -> None:
    if self._mode == "DEGRADED":
        return                      # on se met en veille, sans mourir
```

### Moteurs Python — une action ciblée plutôt qu'une commande générique
```python
@action("set_collect_mode", description="Change le mode de collecte",
        required_scope="ops.write")
@param("mode", required=True, allowed_values=("NORMAL", "LIGHT", "OFF"))
def set_collect_mode(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    self._mode = params["mode"]
    return ActionResult.ok({"mode": self._mode})
```

## Pièges courants
- **Une commande non bornée** : « exécuter » du code ou du SQL arbitraire, c'est une porte dérobée.
- **Un mode que personne n'écoute** : le changement est publié, mais aucun worker ne s'y adapte.
- **Un mode persistant oublié** : l'instance reste en mode restreint après l'incident. Rendre le
  mode visible dans l'état.
- **Commandes sans scope ni confirmation** : une bascule de mode par mégarde.
- **Attendre les commandes réservées** : certaines sont annoncées mais pas encore implémentées.

## Cas d'usage voisins
- UC-OPS-02 — hygiène périodique automatique
- UC-SUP-04 — redémarrer un worker à la main
- UC-ACT-05 — lecture seule et confirmation requise
- UC-BUS-03 — publier un événement
