---
id: UC-BUS-03
titre: "Publier un événement à tous les abonnés"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "kv_bus.pub, kv_bus.sub, list_topics, publication simple"
---

# UC-BUS-03 — Publier un événement à tous les abonnés

## Questions auxquelles répond ce cas d'usage
1. Comment prévenir d'autres workers qu'il s'est passé quelque chose ?
2. Est-ce que mon message est garanti d'arriver, et que se passe-t-il s'il n'y a aucun abonné ?
3. Plusieurs workers peuvent-ils recevoir le même événement ?
4. Mon worker peut-il appeler directement l'autre, plutôt que de publier ?
5. Quelle forme donner au contenu d'un message pour ne pas coincer les abonnés plus tard ?
6. Quand la publication simple suffit-elle, et quand faut-il la version fiable ?
7. Comment nommer un sujet, et où voir la liste de ceux qui existent ?

## Mots-clés
publication, `pub`, `sub`, publier, s'abonner, abonné, sujet, topic, événement, notification,
diffusion, pub/sub, perte acceptable, sans garantie, découplage, `list_topics`, charge utile,
payload

## Ce que c'est, et quand s'en servir
La diffusion : on publie sur un sujet, et **tous** les abonnés présents reçoivent le message. Aucune
garantie de livraison — s'il n'y a personne, le message est perdu, et c'est voulu.

C'est le bon outil pour une notification : « le référentiel vient d'être rechargé », « une commande
a été confirmée ». Ce n'est pas le bon outil quand chaque message doit être traité exactement une
fois : là, c'est la publication fiable (UC-BUS-05).

## Ce que le socle fait · ce qu'il interdit
Le socle livre le message aux abonnés du sujet, dans l'instance. Il ne garde rien, ne réessaie pas,
ne range pas les messages non traités. Une exception dans un abonné ne bloque pas les autres, mais
le message n'est pas rejoué.

L'abonnement se fait **uniquement à l'initialisation du worker** (UC-BUS-04) : s'abonner dans un
cycle ou dans une action crée des abonnements en double, et c'est une règle que la revue de code
vérifie. Et un worker n'appelle jamais un autre worker directement : le sujet est le contrat entre
eux.

## Exemples
### socle-py-django et socle-py
```python
class OrderWorker(Worker, ActionProvider):
    def _confirm(self, reference: str) -> None:
        ...
        # Charge utile : des types simples, nommés — jamais un objet du domaine.
        self._kv_bus.pub("orders/confirmed", {"reference": reference, "at_ms": now_ms})


class InvoiceWorker(Worker):
    def initialize(self) -> None:
        self._kv_bus.sub("orders/confirmed", self._on_confirmed)   # À L'INITIALISATION

    def _on_confirmed(self, payload: dict) -> None:
        reference = payload.get("reference")
        if not reference:          # un message mal formé ne doit pas tuer l'abonné
            return
        ...
```

### Socle Java
```java
kvBus.pub("orders/confirmed", Map.of("reference", reference, "at_ms", nowMs));
kvBus.sub("orders/confirmed", payload -> onConfirmed((Map<String, Object>) payload));
```

### Voir les sujets
En Python, la liste des sujets se lit depuis le code (`kv_bus.list_topics()`) — par exemple dans
une action de diagnostic du worker ; le Socle Java l'expose en plus sur sa route
d'administration du bus.
```python
@action(description="Sujets du bus", read_only=True)
def topics(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    return ActionResult.ok({"topics": sorted(self._kv_bus.list_topics())})
```

## Pièges courants
- **Attendre une garantie** : la publication simple perd les messages sans abonné. Si ça compte,
  c'est UC-BUS-05.
- **Publier un objet du domaine** : l'abonné se retrouve couplé à votre modèle. Publier des types
  simples, et des champs nommés.
- **S'abonner hors de l'initialisation** : abonnements multipliés, messages traités plusieurs fois.
- **Faire du travail long dans l'abonné** : on retarde les autres. L'abonné enregistre, et le
  travail se fait dans un cycle ou une action.
- **Renommer un sujet sans prévenir** : c'est un contrat entre workers, aussi public qu'une route.

## Cas d'usage voisins
- UC-BUS-04 — s'abonner à un sujet
- UC-BUS-05 — publication fiable avec groupes
- UC-WRK-12 — partager un état entre workers
- UC-WRK-09 — worker événementiel
