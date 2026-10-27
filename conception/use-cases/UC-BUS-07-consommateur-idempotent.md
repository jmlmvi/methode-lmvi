---
id: UC-BUS-07
titre: "Rendre un consommateur idempotent"
theme: "UC-BUS · KvBus"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "identifiant de message, set_if_not_exists, contrainte d'unicité"
---

# UC-BUS-07 — Rendre un consommateur idempotent

## Questions auxquelles répond ce cas d'usage
1. Mon traitement s'est exécuté deux fois sur le même message : est-ce un bogue du bus ?
2. Comment écrire un consommateur qui supporte de recevoir deux fois la même chose ?
3. Où retenir ce qui a déjà été traité, et pendant combien de temps ?
4. Comment éviter d'envoyer deux fois le même courriel ou de facturer deux fois ?
5. Faut-il dédupliquer dans le code ou laisser la base refuser le doublon ?
6. Que faire quand le message n'a pas d'identifiant stable ?
7. L'idempotence est-elle encore nécessaire si je ne réessaie jamais ?

## Mots-clés
idempotence, idempotent, doublon, duplicata, au moins une fois, relivraison, déduplication,
identifiant de message, clé d'idempotence, `set_if_not_exists`, contrainte d'unicité,
effet de bord, rejouable, exactly-once impossible, UC de reprise

## Ce que c'est, et quand s'en servir
« Au moins une fois » veut dire « parfois deux fois ». Un consommateur idempotent est un
consommateur pour qui **traiter deux fois le même message a le même effet que le traiter une fois**.
Ce n'est pas une option quand on utilise la publication fiable, c'est la contrepartie.

Trois techniques, de la plus solide à la plus légère : laisser la base refuser le doublon par une
contrainte d'unicité (le plus sûr : c'est vrai même après redémarrage) ; retenir les identifiants
déjà traités dans le bus avec une durée de vie ; rendre l'opération naturellement rejouable
(écrire une valeur plutôt qu'incrémenter).

## Ce que le socle fait · ce qu'il interdit
Le socle garantit la livraison, pas l'unicité. Il ne connaît pas votre notion d'identité métier et
ne peut donc pas dédupliquer pour vous — la publication fiable rend un identifiant de message, mais
c'est à vous de décider ce qui constitue un doublon.

Ce qui est à éviter : une déduplication fondée sur un état en mémoire seule, perdue au redémarrage,
donc fausse exactement au moment où elle sert.

## Exemples
### Par la base — le plus sûr
```python
# La contrainte d'unicité fait foi, y compris après redémarrage ; on convertit le refus.
try:
    mutators.InvoiceMutator.create(partition=partition, order_reference=reference, ...)
except db.IntegrityError:
    return                      # déjà facturé : rien à faire, et ce n'est pas une erreur
```

### Par le bus, avec expiration
```python
def _handle(self, message: dict) -> None:
    cle = f"invoice_worker:seen:{message['order_id']}"
    if not self._kv_bus.set_if_not_exists(cle, 1, ttl_seconds=86_400):
        return                  # déjà vu dans les dernières 24 h
    self._invoice(message)
```

### Socle Java
```java
if (!kvBus.setIfNotExists("invoice_worker:seen:" + orderId, 1)) { return; }
```

### Le vérifier
```python
kv.publish(TOPIC, {"order_id": 2, "amount": 250})
kv.publish(TOPIC, {"order_id": 2, "amount": 250})     # doublon volontaire
await eventually(lambda: worker.processed == 1)        # traité une seule fois
```

## Pièges courants
- **Déduplication en mémoire seule** : le redémarrage remet le compteur à zéro, les doublons
  passent.
- **Clé d'idempotence trop large** (le sujet, l'heure) ou trop étroite (le contenu entier, qui peut
  varier d'un champ d'horodatage) : choisir un identifiant métier stable.
- **Durée de vie trop courte** : un message relivré après expiration est retraité.
- **Incrémenter plutôt qu'écrire** : un compteur incrémenté deux fois est faux ; une valeur écrite
  deux fois est juste.
- **Croire qu'on peut obtenir « exactement une fois »** : on obtient « au moins une fois » plus
  l'idempotence, ce qui en est l'équivalent observable.

## Cas d'usage voisins
- UC-BUS-05 — publication fiable avec groupes
- UC-BUS-02 — opérations atomiques
- UC-DOM-06 — porter l'intégrité par des contraintes en base
- UC-BUS-06 — file des messages en échec
