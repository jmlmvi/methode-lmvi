---
id: UC-BUS-04
titre: "S'abonner à un sujet, et seulement à l'initialisation"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "sub, subscribe, initialize, onInitialize, RG-25"
---

# UC-BUS-04 — S'abonner à un sujet, et seulement à l'initialisation

## Questions auxquelles répond ce cas d'usage
1. À quel endroit du worker doit-on écrire l'abonnement au bus ?
2. Pourquoi est-il interdit de s'abonner dans un cycle de travail ou dans une action ?
3. Mon gestionnaire est appelé deux, trois, dix fois pour le même message : d'où ça vient ?
4. Faut-il se désabonner à l'arrêt du worker ?
5. Un abonnement survit-il au redémarrage du worker par le superviseur ?
6. Comment la revue de code détecte-t-elle un abonnement mal placé ?
7. Quelle est la règle de gestion qui impose ça, et pourquoi existe-t-elle ?

## Mots-clés
abonnement, s'abonner, `sub`, `subscribe`, `initialize`, `onInitialize`, RG-25, règle absolue,
abonnements en double, gestionnaire, handler, désabonnement, `unsub`, `close`, C14,
revue de code, fuite d'abonnement

## Ce que c'est, et quand s'en servir
Une règle, pas une fonctionnalité : **tout abonnement au bus se déclare à l'initialisation du
worker**, jamais ailleurs. Elle vaut pour la publication simple comme pour la publication fiable, et
elle est identique dans les trois moteurs (RG-25).

La raison est mécanique. L'initialisation passe une fois ; un cycle de travail passe des milliers de
fois, une action à chaque appel. Un abonnement posé là s'empile, et chaque message finit traité
autant de fois qu'il y a d'abonnements. Le symptôme — « mon traitement se déclenche plusieurs
fois » — est toujours celui-là.

## Ce que le socle fait · ce qu'il interdit
Le socle appelle l'initialisation une seule fois par worker, avant le démarrage, dans l'ordre des
priorités. C'est le seul endroit où l'ordre est garanti et le passage unique.

En Python, la revue de code refuse un appel d'abonnement hors de l'initialisation (règle C14) : le
hook de pré-commit et la CI bloquent la livraison. En Java, c'est une règle absolue des conventions
de worker, rappelée dans tous les modèles.

Ce que le socle ne fait pas : nettoyer vos abonnements. Une souscription fiable rend un objet
qu'il faut fermer à l'arrêt du worker.

## Exemples
### socle-py-django et socle-py — correct
```python
def initialize(self) -> None:
    self._kv_bus.sub("orders/confirmed", self._on_confirmed)                      # simple
    self._subscription = self._kv_bus.subscribe("orders/created",                  # fiable
                                                "invoice_worker", self._on_created)

def stop(self) -> None:
    self._subscription.close()
```

### Incorrect — et refusé par la revue
```python
def do_work(self) -> None:
    self._kv_bus.sub("orders/confirmed", self._on_confirmed)   # C14 : un abonné de plus par cycle

@action(description="Recharger")
def reload(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    self._kv_bus.sub("referential/reloaded", self._on_reload)  # C14 : un abonné par appel
```

### Socle Java
```java
@Override
public void initialize() {
    kvBus.sub("orders/confirmed", payload -> onConfirmed(payload));   // le seul endroit permis
}
```

## Pièges courants
- **S'abonner dans le constructeur** : le worker n'est pas encore prêt, et l'ordre n'est pas garanti.
  L'initialisation existe pour ça.
- **S'abonner « au cas où » dans une action de rechargement** : c'est la façon la plus courante de
  fabriquer des doublons.
- **Ne pas fermer une souscription fiable à l'arrêt** : le groupe garde un membre fantôme.
- **Croire qu'un gestionnaire lent est sans conséquence** : il retarde la livraison aux autres.

## Cas d'usage voisins
- UC-BUS-03 — publier un événement
- UC-BUS-05 — publication fiable avec groupes
- UC-WRK-07 — injecter ses dépendances
- UC-DEV-04 — contrôler son code contre les conventions
