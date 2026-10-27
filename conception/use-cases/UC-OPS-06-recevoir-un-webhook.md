---
id: UC-OPS-06
titre: "Recevoir un webhook externe"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: hors
  socle-py-django: hors
contrat: "5.9"
mecanismes: "WebhookReceiverWorker, PASSIVE, accusé immédiat, Virtual Thread"
---

# UC-OPS-06 — Recevoir un webhook externe

## Questions auxquelles répond ce cas d'usage
1. Comment recevoir les notifications d'un service tiers qui appelle une URL ?
2. Faut-il traiter le message dans la requête, ou accuser réception tout de suite ?
3. Comment vérifier que l'appel vient bien du partenaire annoncé ?
4. Comment ne pas perdre un message si le traitement échoue ?
5. Dans les moteurs Python, comment faire sans route dédiée ?
6. Comment supporter les renvois du partenaire, qui réémet en cas de doute ?

## Mots-clés
webhook, notification entrante, partenaire, accusé de réception, 202, traitement différé,
signature HMAC, vérification d'origine, rejeu, idempotence, `WebhookReceiverWorker`,
Virtual Thread, file interne, hors périmètre, Gateway

## Ce que c'est, et quand s'en servir
Un service tiers vous appelle quand quelque chose se passe chez lui. La bonne forme est connue :
**accuser réception immédiatement**, poser le message dans une file, et le traiter derrière. Un
partenaire qui attend votre traitement finit par considérer l'appel en échec et le rejouer.

## Ce que le socle fait · ce qu'il interdit
Java : un modèle de worker récepteur combine le contrôleur, le worker passif et un traitement en
tâche légère, avec l'accusé immédiat.

Moteurs Python : **hors périmètre** (pas de route applicative, UC-OPS-05). Deux montages honnêtes :
la Gateway reçoit le webhook et le transforme en invocation d'action, ou le partenaire appelle
directement la route d'action avec un jeton. Dans les deux cas, l'action doit faire **le minimum** :
valider, enregistrer, publier sur le bus, répondre — le traitement se fait dans un consommateur
(UC-BUS-05).

Trois exigences ne sont jamais optionnelles : vérifier l'origine (signature du partenaire),
accuser vite, et être idempotent, parce que le rejeu est le mode de fonctionnement normal de ces
systèmes.

## Exemples
### Moteurs Python — une action qui ne fait que recevoir
```python
@action("receive_payment_event", description="Reçoit un événement du prestataire de paiement")
@param("event_id", required=True, max_length=80)
@param("signature", required=True, sensitive=True)
@param("payload", required=True, type=ParameterType.OBJECT)
def receive_payment_event(self, params: dict[str, Any], context: ActionContext) -> ActionResult:
    if not self._signature_valide(params["payload"], params["signature"]):
        return ActionResult.failure("Signature invalide", "BAD_SIGNATURE")
    # Idempotence : le partenaire rejoue, c'est normal.
    if not self._kv_bus.set_if_not_exists(f"webhook:seen:{params['event_id']}", 1,
                                          ttl_seconds=86_400):
        return ActionResult.ok({"status": "duplicate"})
    self._kv_bus.publish("payments/received", params["payload"])   # traitement différé, fiable
    return ActionResult.ok({"status": "accepted"})
```

### Socle Java
```java
@PostMapping("/webhooks/payments")
public ResponseEntity<Void> receive(@RequestBody Map<String, Object> body) {
    queue.offer(body);                       // accusé immédiat, traitement derrière
    return ResponseEntity.accepted().build();
}
```

## Pièges courants
- **Traiter dans la requête** : le partenaire expire et rejoue, et vous traitez deux fois.
- **Ne pas vérifier la signature** : n'importe qui peut injecter un événement.
- **Pas d'idempotence** : les rejeux créent des doublons métier.
- **Journaliser la charge utile complète** : elle contient souvent des données personnelles.
- **Répondre en erreur pour un doublon** : le partenaire continuera de rejouer. Répondre « déjà
  reçu ».

## Cas d'usage voisins
- UC-OPS-05 — servir des routes HTTP applicatives
- UC-BUS-05 — publication fiable avec groupes
- UC-BUS-07 — rendre un consommateur idempotent
- UC-INT-06 — s'insérer derrière la Gateway
