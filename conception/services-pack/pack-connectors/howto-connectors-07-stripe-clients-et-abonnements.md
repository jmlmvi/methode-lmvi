# HOWTO CONNECTORS-07 — Stripe : clients, abonnements et Checkout

**Niveau :** Intermédiaire
**Cible :** app qui encaisse ses utilisateurs via Stripe (abonnement ou paiement unique)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:3.1.0` (Boot 4.1.2, socle 5.10.0 ; code de ce périmètre identique depuis 2.0.0 hors noms de beans préfixés `connectors*` ; 3.0.0 = Boot 4.0.6, 2.0.0 = dernière Boot 3) — `StripeWorker` (12 actions),
API Stripe v1 en `application/x-www-form-urlencoded`
**Temps estimé :** 30 min

> Réception des événements Stripe : [[howto-connectors-08-stripe-recevoir-les-webhooks|CONNECTORS-08]].
> Facturer l'usage d'une API publiée sur le Hub relève d'APIM, pas de ce pack :
> [[howto-35-configurer-le-wallet-et-la-facturation-apim|HOWTO 35]].

---

## 1. Contexte

`stripe_worker` encapsule les appels Stripe les plus courants d'un parcours SaaS : créer le client,
ouvrir une session Checkout, suivre et résilier l'abonnement, lire les factures et le solde.

| Action | Paramètres | Appel Stripe | Renvoie |
|---|---|---|---|
| `create_customer` | `email`, `name?`, `metadata?` | `POST /v1/customers` | `id, email, created` |
| `get_customer` | `customer_id` | `GET /v1/customers/{id}` | `id, email, name, created, balance, currency` |
| `list_customers` | `limit?` (10, max 100), `email?` | `GET /v1/customers` | `customers[], has_more` |
| `create_checkout_session` | `customer_id`, `price_id`, `success_url`, `cancel_url`, `mode?` (`subscription` par défaut) | `POST /v1/checkout/sessions`, quantité 1 | `id, url, payment_status` |
| `create_subscription` | `customer_id`, `price_id` | `POST /v1/subscriptions` | `id, status, current_period_end` |
| `cancel_subscription` | `subscription_id` | `DELETE /v1/subscriptions/{id}` (immédiat) | `id, status` |
| `get_subscription` | `subscription_id` | `GET /v1/subscriptions/{id}` | `id, customer, status, current_period_end` |
| `list_invoices` | `customer_id?`, `limit?` | `GET /v1/invoices` | `invoices[], has_more` |
| `get_balance` | — | `GET /v1/balance` | `available[]` |
| `create_webhook_endpoint` | `url`, `events[]` | `POST /v1/webhook_endpoints` | `id, url, secret` |
| `test_connection`, `get_status` | — | `GET /v1/balance` / local | — |

---

## 2. Architecture

```
navigateur ──► app : « s'abonner »
                │ 1. create_customer (si absent)       ┐
                │ 2. create_checkout_session            ├─► StripeWorker ─► RateLimiter (80/s)
                ▼                                       │                ─► ResilienceFactory("stripe")
          redirection vers data.url (checkout.stripe.com)┘                ─► api.stripe.com/v1 (form-urlencoded)
                │
                ▼ paiement
Stripe ──► POST https://monapp…/api/webhooks/stripe  (CONNECTORS-08)
```

---

## 3. Étape 1 — Configuration

```bash
SOCLE_CONN_STRIPE_ENABLED=true
SOCLE_CONN_STRIPE_SECRET_KEY=sk_test_xxxxxxxx
```

Les prix (`price_…`) se créent dans le Dashboard Stripe : le pack n'a pas d'action produit/prix.

---

## 4. Étape 2 — Le parcours d'abonnement dans l'app

```java
package eu.lmvi.monapp.billing;

import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.connectors.StripeWorker;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/billing")
public class AbonnementController {

    private final ObjectProvider<StripeWorker> stripe;
    private final JdbcTemplate jdbc;

    public AbonnementController(ObjectProvider<StripeWorker> stripe, JdbcTemplate jdbc) {
        this.stripe = stripe;
        this.jdbc = jdbc;
    }

    @PostMapping("/abonner")
    public ResponseEntity<?> abonner(@RequestParam String email, @RequestParam String priceId) {
        StripeWorker w = stripe.getIfAvailable();
        if (w == null) return ResponseEntity.status(503).body(Map.of("error", "Stripe inactif"));
        ActionContext ctx = ActionContext.internal("abonnement_controller");

        String customerId = clientExistant(email);
        if (customerId == null) {
            ActionResult c = w.executeAction("create_customer",
                    ActionParameters.fromMap(Map.of("email", email, "metadata", Map.of("app", "monapp"))), ctx);
            if (!c.success()) return ResponseEntity.status(502).body(Map.of("error", c.error()));
            customerId = c.getDataString("id");
            jdbc.update("INSERT INTO schema_monapp.tr_client_stripe (email, customer_id) VALUES (?, ?)",
                    email, customerId);
        }

        ActionResult s = w.executeAction("create_checkout_session", ActionParameters.fromMap(Map.of(
                "customer_id", customerId,
                "price_id", priceId,
                "mode", "subscription",
                "success_url", "https://monapp.thesocle.net/merci?session={CHECKOUT_SESSION_ID}",
                "cancel_url", "https://monapp.thesocle.net/tarifs")), ctx);
        if (!s.success()) return ResponseEntity.status(502).body(Map.of("error", s.error()));

        return ResponseEntity.status(303).location(URI.create(s.getDataString("url"))).build();
    }

    private String clientExistant(String email) {
        List<String> ids = jdbc.queryForList(
                "SELECT customer_id FROM schema_monapp.tr_client_stripe WHERE email = ?", String.class, email);
        return ids.isEmpty() ? null : ids.get(0);
    }
}
```

```sql
CREATE TABLE IF NOT EXISTS schema_monapp.tr_client_stripe (
    email        VARCHAR(255) PRIMARY KEY,
    customer_id  VARCHAR(64)  NOT NULL UNIQUE,
    x_dateCreated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

L'app garde la correspondance email ↔ `customer_id` **chez elle** : c'est ce qui empêche les
doublons (voir Pièges).

---

## 5. Étape 3 — Opérations ponctuelles en REST

```bash
W=http://localhost:8080/admin/workers/stripe_worker/actions
H=(-H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json")

curl -s "${H[@]}" -X POST $W/list_customers -d '{"email":"alice@example.com"}'
curl -s "${H[@]}" -X POST $W/get_subscription -d '{"subscription_id":"sub_123"}'
curl -s "${H[@]}" -X POST $W/cancel_subscription -d '{"subscription_id":"sub_123"}'
curl -s "${H[@]}" -X POST $W/get_balance -d '{}'
```

---

## 6. Vérifier

```bash
curl -s "${H[@]}" -X POST $W/test_connection -d '{}'
# data : {"connected":true,"currencies_count":1}
```

Avec `sk_test_`, la carte `4242 4242 4242 4242` termine un Checkout ; l'abonnement apparaît dans
`get_subscription` avec `status: active`.

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `create_customer` avec `metadata` | Client visible au Dashboard, métadonnées `metadata[app]=monapp` |
| 2 | `/api/billing/abonner` | Redirection 303 vers `checkout.stripe.com` |
| 3 | Paiement carte test | `get_subscription` → `active` |
| 4 | `cancel_subscription` | `status: canceled` immédiatement |
| 5 | Clé révoquée | `Stripe GET /balance HTTP 401: Invalid API Key provided…` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Retry des POST sans clé d'idempotence** | Client ou abonnement **en double** après un délai d'attente réseau : `RetryPolicy` rejoue `POST /customers` jusqu'à 3 fois, sans en-tête `Idempotency-Key` | Garder la correspondance email ↔ `customer_id` chez l'app ; vérifier par `list_customers` `email` avant de recréer |
| **`list_invoices` avec une facture brouillon** | Échec à erreur **vide** : `hosted_invoice_url` est `null` sur un brouillon, et `Map.of` refuse `null` | Filtrer côté Stripe (`customer_id`) et s'attendre à l'échec tant que le pack n'est pas corrigé |
| `cancel_subscription` pris pour une fin de période | Résiliation **immédiate** (`DELETE`) | Pour « fin de période », appeler l'API Stripe hors pack (`cancel_at_period_end`) |
| Quantité > 1 ou plusieurs prix | `create_checkout_session` envoie `line_items[0]`, quantité 1, en dur | Hors pack pour les paniers |
| `create_subscription` sans moyen de paiement | `status: incomplete` | Passer par Checkout, qui collecte la carte |
| `current_period_end` à 0 | Champ déplacé sur les items dans les versions récentes de l'API Stripe | Lire l'abonnement brut côté Stripe ; le pack ne fixe pas `Stripe-Version` |
| Erreurs 4xx comptées comme pannes | 5 erreurs de validation en 30 s ouvrent le circuit **pour tout Stripe** pendant 60 s | Valider les paramètres avant l'appel ([[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10]]) |
| `sk_live_` en recette | Vraies opérations | `sk_test_` partout hors `.io` |
| Montants | Stripe parle en **centimes** (`amount_due`, `amount`) | Diviser par 100 à l'affichage |

---

## 9. Pour aller plus loin

- [[howto-connectors-08-stripe-recevoir-les-webhooks|CONNECTORS-08 — Recevoir les webhooks Stripe]]
- [[howto-connectors-03-gerer-les-identifiants|CONNECTORS-03 — Identifiants]]
- [[howto-35-configurer-le-wallet-et-la-facturation-apim|HOWTO 35 — Wallet et facturation APIM]]
