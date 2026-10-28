# HOWTO CONNECTORS-08 — Stripe : recevoir et traiter les webhooks

**Niveau :** Confirmé
**Cible :** app qui doit réagir à `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`…
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:3.0.0` (Boot 4.0.6 ; contrôleur inchangé depuis 2.0.0) — `StripeWebhookController`
(`POST /api/webhooks/stripe`), `StripeWorker.create_webhook_endpoint`, `StripeWorker.resolveWebhookSecret()`
**Temps estimé :** 40 min

---

## 1. Contexte

Activer Stripe (`SOCLE_CONN_STRIPE_ENABLED=true`) monte `StripeWebhookController` sur
`POST /api/webhooks/stripe`. Il vérifie correctement la signature (`Stripe-Signature`, HMAC-SHA256,
tolérance 300 s, comparaison en temps constant) puis **se contente de journaliser** l'événement et
de répondre `200 {"received":true,…}`.

Sa javadoc annonce une publication sur « le bus d'événements interne » ; le code ne publie rien :

```java
// StripeWebhookController.receive — extrait exact
log.info("[stripe-webhook] received {} id={}", eventType, eventId);
// … Ici on logge simplement — l'intégration au bus est faite par l'hôte.
return ResponseEntity.ok(Map.of("received", true, "event_type", eventType, "event_id", eventId));
```

Il n'offre **aucun point d'extension** (pas d'événement Spring, pas d'interface à implémenter), et
sa vérification de signature est `private`. Pour **traiter** les événements, l'app expose son propre
récepteur sur un **autre chemin**, en réutilisant le secret résolu par le pack.

---

## 2. Architecture

```
Stripe ──► POST https://monapp.thesocle.net/api/stripe/events      ← déclaré chez Stripe
              │
              ▼
   StripeEventsController (app)
     1. vérifie Stripe-Signature avec StripeWorker.resolveWebhookSecret()
     2. dédoublonne sur event.id  (tr_stripe_event, clé primaire)
     3. traite : checkout.session.completed → active l'abonnement local
     4. répond 200 vite (Stripe réessaie sinon)

   POST /api/webhooks/stripe (pack) : reste monté, valide et journalise seulement
```

---

## 3. Étape 1 — Déclarer l'endpoint chez Stripe et poser le secret

```bash
W=http://localhost:8080/admin/workers/stripe_worker/actions
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -X POST $W/create_webhook_endpoint -d '{
    "url": "https://monapp.thesocle.net/api/stripe/events",
    "events": ["checkout.session.completed","invoice.paid","customer.subscription.deleted"]
  }'
# data : {"id":"we_…","url":"…","secret":"whsec_…","hint":"Stockez le secret dans SOCLE_CONN_STRIPE_WEBHOOK_SECRET…"}
```

Le `secret` n'est rendu par Stripe **qu'à la création**. Le poser immédiatement :

```bash
HUB=https://admin.thesocle.net
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST $HUB/api/actions/docker_worker/set_env_var \
  -d '{"app_id":"monapp","key":"SOCLE_CONN_STRIPE_WEBHOOK_SECRET","value":"whsec_…"}'
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST $HUB/api/actions/docker_worker/restart_app -d '{"app_id":"monapp"}'
```

---

## 4. Étape 2 — Tables et dépendance

```sql
CREATE TABLE IF NOT EXISTS schema_monapp.tr_stripe_event (
    event_id      VARCHAR(64) PRIMARY KEY,
    event_type    VARCHAR(100) NOT NULL,
    x_dateCreated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    datas         JSONB NOT NULL
);

-- complète tr_client_stripe de CONNECTORS-07
ALTER TABLE schema_monapp.tr_client_stripe
    ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS statut          VARCHAR(20);
```

Le calcul HMAC passe par Apache Commons Codec (version gérée par le BOM Spring Boot) :

```xml
<dependency>
    <groupId>commons-codec</groupId>
    <artifactId>commons-codec</artifactId>
</dependency>
```

---

## 5. Étape 3 — Le récepteur de l'app

```java
package eu.lmvi.monapp.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.lmvi.socle.pack.connectors.StripeWorker;
import org.apache.commons.codec.digest.HmacAlgorithms;
import org.apache.commons.codec.digest.HmacUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/stripe/events")
public class StripeEventsController {

    private static final Logger log = LoggerFactory.getLogger(StripeEventsController.class);
    private static final long TOLERANCE_SECONDS = 300;

    private final ObjectProvider<StripeWorker> stripe;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public StripeEventsController(ObjectProvider<StripeWorker> stripe, JdbcTemplate jdbc) {
        this.stripe = stripe;
        this.jdbc = jdbc;
    }

    @PostMapping
    public ResponseEntity<?> recevoir(@RequestHeader(value = "Stripe-Signature", required = false) String sig,
                                      @RequestBody String raw) throws Exception {
        StripeWorker w = stripe.getIfAvailable();
        String secret = w == null ? null : w.resolveWebhookSecret();
        if (secret == null || secret.isBlank()) return ResponseEntity.status(503).build();
        if (sig == null || !signatureValide(sig, raw, secret)) return ResponseEntity.status(400).build();

        JsonNode event = mapper.readTree(raw);
        String id = event.path("id").asText();
        String type = event.path("type").asText();

        int nouveau = jdbc.update("""
                INSERT INTO schema_monapp.tr_stripe_event (event_id, event_type, datas)
                VALUES (?, ?, ?::jsonb) ON CONFLICT (event_id) DO NOTHING
                """, id, type, raw);
        if (nouveau == 0) return ResponseEntity.ok(Map.of("duplicate", true));

        JsonNode obj = event.path("data").path("object");
        switch (type) {
            case "checkout.session.completed" -> jdbc.update(
                    "UPDATE schema_monapp.tr_client_stripe SET subscription_id = ?, statut = 'active' "
                    + "WHERE customer_id = ?",
                    obj.path("subscription").asText(null), obj.path("customer").asText());
            case "customer.subscription.deleted" -> jdbc.update(
                    "UPDATE schema_monapp.tr_client_stripe SET statut = 'canceled' WHERE subscription_id = ?",
                    obj.path("id").asText());
            case "invoice.paid" -> log.info("[stripe-events] facture payée {} client={}",
                    obj.path("id").asText(), obj.path("customer").asText());
            default -> log.debug("[stripe-events] ignoré {}", type);
        }
        return ResponseEntity.ok(Map.of("received", true));
    }

    /** Header « t=<ts>,v1=<sig>[,v1=<sig2>] » : accepte tout v1 valide (rotation de secret). */
    private boolean signatureValide(String header, String payload, String secret) {
        String ts = null;
        List<String> v1 = new ArrayList<>();
        for (String part : header.split(",")) {
            String[] kv = part.split("=", 2);
            if (kv.length != 2) continue;
            if (kv[0].equals("t")) ts = kv[1];
            if (kv[0].equals("v1")) v1.add(kv[1]);
        }
        if (ts == null || v1.isEmpty()) return false;
        if (Math.abs(System.currentTimeMillis() / 1000 - Long.parseLong(ts)) > TOLERANCE_SECONDS) return false;

        byte[] attendu = new HmacUtils(HmacAlgorithms.HMAC_SHA_256, secret)
                .hmacHex(ts + "." + payload).getBytes(StandardCharsets.US_ASCII);
        for (String s : v1) {
            if (MessageDigest.isEqual(attendu, s.getBytes(StandardCharsets.US_ASCII))) return true;
        }
        return false;
    }
}
```

---

## 6. Étape 4 — Rendre le chemin joignable

L'endpoint doit être appelable par Stripe **sans session SSO** ni clé : la seule authentification
est la signature. Les préfixes protégés par `AdminAuthFilter` du socle (`/admin`, `/supervision`…)
ne couvrent pas `/api/stripe/…`. Côté Hub, vérifier que la route de l'app ne
soumet pas ce chemin au SSO ([[howto-09-configurer-sso-multi-app|HOWTO 09]]).

---

## 7. Vérifier

```bash
stripe listen --forward-to localhost:8080/api/stripe/events     # Stripe CLI, en local
stripe trigger checkout.session.completed
```

```sql
SELECT event_type, count(*) FROM schema_monapp.tr_stripe_event GROUP BY 1;
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Événement signé valide | `200 {"received":true}`, ligne dans `tr_stripe_event` |
| 2 | Même événement rejoué | `200 {"duplicate":true}`, aucun double traitement |
| 3 | Corps modifié d'un octet | `400` |
| 4 | Horodatage de plus de 5 min | `400` |
| 5 | Secret absent | `503` (app) ; `500 webhook secret not configured` (contrôleur du pack) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Pointer Stripe sur `/api/webhooks/stripe` du pack | `200` reçus, événements journalisés, **aucun traitement** | Chemin propre à l'app, comme ci-dessus |
| Écrire un contrôleur sur `/api/webhooks/stripe` | `Ambiguous mapping` au démarrage : le chemin appartient au contrôleur du pack | Choisir un autre chemin |
| Rotation du secret Stripe | Le contrôleur du pack ne garde que le **dernier** `v1` du header | Le récepteur de l'app teste tous les `v1` |
| Corps relu après désérialisation | Signature toujours fausse | Recevoir `@RequestBody String` brut |
| `@RequestBody JsonNode` (Jackson 2) dans une app Boot 4 | `500 Cannot construct instance of JsonNode` avant même la signature | Le convertisseur HTTP de Boot 4 est Jackson 3 : `String` brut puis `new ObjectMapper().readTree(raw)`, comme ci-dessus. Le contrôleur du pack fait ainsi (couvert par `StripeWebhookBoot4Test` en 3.0.0) |
| Traitement lent avant le `200` | Stripe réessaie : doublons | Dédoublonner sur `event.id` ; traitement lourd en asynchrone |
| `whsec_` perdu | Impossible de le relire chez Stripe | Le poser dès `create_webhook_endpoint`, sinon recréer l'endpoint |
| Chemin derrière le SSO du Hub | Stripe reçoit une redirection vers la connexion | Exclure le chemin du SSO |
| Attendre un événement sur le KvBus | Rien n'arrive | Le pack ne publie rien ; publier soi-même depuis le récepteur |

---

## 10. Pour aller plus loin

- [[howto-connectors-07-stripe-clients-et-abonnements|CONNECTORS-07 — Clients et abonnements]]
- [[howto-09-configurer-sso-multi-app|HOWTO 09 — SSO multi-app]]
- [[howto-37-publier-des-messages-nats-depuis-une-app|HOWTO 37 — Publier sur NATS]] — diffuser l'événement à d'autres apps
