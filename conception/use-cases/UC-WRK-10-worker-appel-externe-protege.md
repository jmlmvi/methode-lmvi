---
id: UC-WRK-10
titre: "Worker d'appel externe protégé"
theme: "UC-WRK · Workers et cycle de vie"
moteurs:
  java: ok
  socle-py: P-4
  socle-py-django: P-4
contrat: "5.9"
mecanismes: "AbstractGatewayWorker, executeProtected, disjoncteur, reprises, débit"
---

# UC-WRK-10 — Worker d'appel externe protégé

## Questions auxquelles répond ce cas d'usage
1. Comment appeler une API tierce sans que ses pannes fassent tomber mon application ?
2. Le fournisseur répond en erreur depuis dix minutes : comment arrêter de l'appeler pour rien ?
3. Comment réessayer un appel sans marteler le serveur d'en face ?
4. Mon contrat m'autorise 100 appels par minute : comment le faire respecter par le code ?
5. Est-ce que j'écris ces protections moi-même dans chaque worker ?
6. En Python, ces protections existent-elles déjà, et sinon quel est le minimum à faire ?
7. Comment distinguer, dans les traces, un refus de protection d'une vraie panne du tiers ?

## Mots-clés
appel externe, API tierce, `AbstractGatewayWorker`, `executeProtected`, disjoncteur,
circuit breaker, reprises, retry, attente croissante, backoff, limiteur de débit, rate limiter,
quota, protection, timeout, `GatewayWorker.java`, résilience

## Ce que c'est, et quand s'en servir
Un worker dont le métier est d'appeler un système qu'il ne contrôle pas. Trois protections vont
ensemble : couper les appels après une série d'échecs, réessayer un nombre borné de fois avec une
attente croissante, et refuser au-delà du débit autorisé.

On en a besoin dès que l'indisponibilité du tiers ne doit pas devenir la nôtre : passerelle de
paiement, service d'envoi, API de référentiel, fournisseur d'IA.

## Ce que le socle fait · ce qu'il interdit
Dans le Socle Java, une classe de base enveloppe l'appel : le développeur fournit l'appel nu et la
classe applique les protections, compte les refus et expose l'état du disjoncteur dans les
statistiques. Les trois réglages sont de la configuration, pas du code.

Dans les moteurs Python, c'est une US de la phase **P-4**. En attendant, le minimum **obligatoire**
est le délai sur chaque appel sortant (UC-RES-05) — la revue de code refuse un appel HTTP sans
délai. Ne pas improviser un disjoncteur maison dans un worker : il faussera les mêmes statistiques
que la future classe de base, et il faudra le défaire.

## Exemples
### Socle Java
```java
@Component
public class PaymentGatewayWorker extends AbstractGatewayWorker {
    public PaymentResult charge(Order order) {
        return executeProtected(() -> client.charge(order));   // disjoncteur + reprises + débit
    }
}
```

### socle-py-django et socle-py — en attendant P-4
```python
class PaymentWorker(Worker, ActionProvider):
    def __init__(self, config: SocleConfig):
        self._timeout_s = config.raw.as_float("app.payment.timeout-seconds", 5.0)

    def _charge(self, order_id: str) -> dict:
        # Le délai est OBLIGATOIRE : sans lui, un tiers lent bloque le worker indéfiniment.
        response = httpx.post(self._url, json={"order": order_id}, timeout=self._timeout_s)
        response.raise_for_status()
        return response.json()
```

## Pièges courants
- **Réessayer sans attente** : on transforme une panne passagère en attaque sur le tiers.
- **Réessayer une erreur définitive** (400, 404, refus métier) : la reprise ne concerne que
  l'indisponible et le temporaire.
- **Oublier le délai** : c'est la panne la plus fréquente, et la plus facile à éviter.
- **Masquer le refus de protection en succès vide** : l'appelant croit l'opération faite. Un refus
  de protection est un refus, avec son code (UC-ACT-12).

## Cas d'usage voisins
- UC-RES-01 — disjoncteur
- UC-RES-02 — réessayer avec attente croissante
- UC-RES-03 — limiter le débit
- UC-RES-05 — imposer un délai à tout appel sortant
