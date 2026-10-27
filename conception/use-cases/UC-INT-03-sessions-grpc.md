---
id: UC-INT-03
titre: "Tenir des sessions gRPC"
theme: "UC-INT · Intégrations et transports"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "sessions, flux persistant, cycle de vie, reconnexion"
---

# UC-INT-03 — Tenir des sessions gRPC

## Questions auxquelles répond ce cas d'usage
1. Comment maintenir une connexion longue avec un client, plutôt qu'un appel ponctuel ?
2. Qui garde l'état d'une session, et que devient-il à la déconnexion ?
3. Comment gérer la reconnexion d'un client qui a perdu le réseau ?
4. Combien de sessions simultanées peut-on tenir, et comment le borner ?
5. Dans les moteurs Python, cette possibilité existe-t-elle ?
6. Quelle alternative pour un besoin de temps réel ?

## Mots-clés
session, flux persistant, connexion longue, état de session, déconnexion,
reconnexion, borne, nombre de sessions, mémoire, temps réel, sondage,
hors périmètre, bus, notification

## Ce que c'est, et quand s'en servir
Une session garde un contexte entre un client et le serveur pendant toute la durée d'une connexion :
utile pour du temps réel, des abonnements, des échanges longs.

C'est aussi le mode d'intégration le plus coûteux à exploiter : chaque session consomme de la
mémoire et un contexte, les déconnexions sont normales, et la reconnexion doit être prévue dès le
départ.

## Ce que le socle fait · ce qu'il interdit
Java : l'architecture gRPC du socle gère les sessions et leur cycle de vie.

Moteurs Python : **hors périmètre**. Pour un besoin de temps réel, les options qui restent dans le
contrat sont le sondage d'une action en lecture seule (simple, suffisant dans bien des cas) ou une
notification poussée par un composant dédié hors du Socle, alimenté par le bus interne.

Dans tous les cas, deux règles : **borner** le nombre de sessions (sinon un client fautif épuise la
mémoire) et considérer la déconnexion comme un événement **normal**, pas comme une erreur.

## Exemples
### Moteurs Python — le sondage, honnête et suffisant
```python
@action("get_order_status", description="État courant d'une commande", read_only=True)
@param("reference", required=True, max_length=40)
def get_order_status(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    ...
```
```bash
# Le client interroge à intervalle raisonnable, avec un arrêt borné.
```

### Pousser, sans session dans le Socle
```python
# Le worker publie ; un composant dédié (hors Socle) relaie vers les clients connectés.
self._kv_bus.pub("orders/confirmed", {"reference": reference})
```

## Pièges courants
- **Sessions non bornées** : la mémoire part avec le nombre de clients.
- **Traiter la déconnexion comme une erreur** : les journaux se remplissent de faux incidents.
- **Un état de session irremplaçable** : à la reconnexion, le client doit pouvoir repartir.
- **Du sondage trop fréquent** quand on remplace une session : on charge l'instance pour rien.

## Cas d'usage voisins
- UC-INT-02 — exposer un service gRPC
- UC-INT-04 — relier deux instances en pair-à-pair
- UC-BUS-03 — publier un événement
- UC-ACT-07 — invoquer une action en REST
