# HOWTO 35 — Configurer le wallet et la facturation APIM

> **Niveau** : avancé | **Prérequis** : SocleHub Hub 3.12.1 démarré, API publiée avec un tenant et une clé (cf. [[howto-30-publier-une-api-apim|HOWTO 30]]), accès admin APIM + accès portail tenant | **Temps estimé** : 20-40 min

Ce guide montre comment monétiser une API publiée via le sous-système **Pricing / Wallet / Billing** de l'APIM : facturation au coût par appel (et par Mo), **wallet prépayé** par tenant débité en temps réel, recharge par **Stripe Checkout** (mode `test` par défaut) confirmée par webhook signé, et génération de **factures mensuelles** idempotentes.

---

## 1. Contexte

Deux modes de paiement coexistent (`apim.tr_published_api.payment_mode`) :

- `subscription` (défaut) : chaque appel est **métré** (`apim.tr_metering_record`) et agrégé en fin de mois dans une facture,
- `prepaid_wallet` : chaque appel est **débité immédiatement** du solde prépayé du tenant ; solde insuffisant → `402 PAYMENT_REQUIRED`.

Le sous-système doit :

- Calculer le coût d'un appel : `cost_per_call + Mo_in × cost_in + Mo_out × cost_out` (centimes EUR),
- Débiter/créditer le wallet de façon **sérialisée** (`SELECT … FOR UPDATE`, table de transactions append-only),
- Permettre au tenant de **recharger** via Stripe Checkout,
- Générer des **factures mensuelles** idempotentes (agrégat metering + frais de plan).

---

## 2. Architecture

```
   Pipeline APIM (forward terminé)
        │ recordCall(ApimContext)
        ▼
  ┌───────────────────────────┐  flush() @Scheduled 2s, batch 100
  │   ApimMeteringService     │───────────────────────────► INSERT apim.tr_metering_record
  │  file 5000, coût (cents)  │
  └─────────────┬─────────────┘
                │ (mode prepaid_wallet : ApimPaymentRequiredHandler.handlePost)
                ▼ debit()
  ┌───────────────────────────┐        ┌──────────────────────────────┐
  │   ApimWalletService        │        │   ApimBillingService          │
  │  apim.tr_tenant_wallet     │        │  generateForTenant(YYYY-MM)   │
  │  apim.tr_wallet_transaction│        │  agrégat metering + plan_fee  │
  │  SELECT … FOR UPDATE        │        │  ON CONFLICT(invoice_number)  │
  └─────────────┬──────────────┘        │  → apim.tr_invoice            │
                ▲ credit("topup")        └──────────────────────────────┘
                │
  ┌───────────────────────────┐  webhook signé   ┌──────────────────────────┐
  │ StripeIntegrationService  │◄─────────────────│ ApimStripeWebhookController│
  │ createCheckoutSession     │                  │ POST /api/apim/stripe/    │
  └───────────────────────────┘                  │      webhook              │
        ▲ POST /portal/apim/wallet/checkout      └──────────────────────────┘
        │
  ┌───────────────────────────┐
  │ ApimWalletPortalController │  /portal/apim/wallet/*  (self-service tenant)
  └───────────────────────────┘
```

---

## 3. Étape 1 — Définir les tarifs d'une API

Les tarifs sont des colonnes de `apim.tr_published_api`. Le wizard les pose via `step3` (cf. [[howto-30-publier-une-api-apim|HOWTO 30]]). Ajustement direct :

```sql
UPDATE apim.tr_published_api
SET cost_per_call_cents = 2,     -- 0,02 € par appel
    cost_per_mb_in_cents = 1,    -- 0,01 € / Mo entrant
    cost_per_mb_out_cents = 1,   -- 0,01 € / Mo sortant
    payment_mode = 'prepaid_wallet',
    topup_min_eur_cents = 500    -- recharge minimale 5 €
WHERE slug = 'data-app-items';
```

Formule de coût (`ApimMeteringService`, division **entière** par 1 Mo) :

```java
long mbIn  = Math.max(0, ctx.requestBytes)  / (1024 * 1024);
long mbOut = Math.max(0, ctx.responseBytes) / (1024 * 1024);
long cost  = api.costPerCallCents()
           + mbIn  * api.costPerMbInCents()
           + mbOut * api.costPerMbOutCents();
```

> Conséquence : un appel **sous 1 Mo** ne facture que `cost_per_call_cents`. Les appels en **erreur** (`responseStatus >= 400`) sont **ignorés** par le metering. Pour un coût custom (token LLM, dégressif…), poser `cost_eur_cents` via une règle JDM `apim_pricing` (cf. [[howto-31-creer-une-regle-jdm-apim|HOWTO 31]]).

---

## 4. Étape 2 — Configurer Stripe

Configuration YAML (valeurs par défaut dans `application.yml`) :

```yaml
apim:
  stripe:
    mode: test                                       # défaut : test
    secret-key: ""                                   # vide → force le mode test
    webhook-secret: ""                               # vide → signature non vérifiée
    success-url: /portal/apim/wallet?topup=success
    cancel-url:  /portal/apim/wallet?topup=cancel
```

| Clé | Défaut | Effet |
|-----|--------|-------|
| `apim.stripe.mode` | `test` | `test` simule Checkout sans appel HTTP ; `live` (V2.1) lève `UnsupportedOperationException` |
| `apim.stripe.secret-key` | `""` | clé secrète Stripe ; absente → mode test forcé |
| `apim.stripe.webhook-secret` | `""` | secret HMAC-SHA256 pour vérifier `Stripe-Signature` |

En mode `test`, le wallet se recharge sans Stripe réel via le callback simulé. Pour passer en production, renseigner `secret-key` + `webhook-secret` (et attendre le support `live`).

---

## 5. Étape 3 — Recharger le wallet (tenant, self-service)

Le tenant accède au portail wallet : `GET https://admin.thesocle.net/portal/apim/wallet` (HTML). En coulisses :

### Créer une session de recharge

```bash
curl -s -X POST http://localhost:8080/portal/apim/wallet/checkout \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"amount_cents": 2000, "currency": "EUR"}' | jq
# → session Stripe (cs_test_… en mode test)
```

`createCheckoutSession` valide le montant (`1` à `10_000_000` cents = 100 000 €).

### Confirmer (mode test uniquement)

```bash
curl -s "http://localhost:8080/portal/apim/wallet/test-topup-confirm?session_id=cs_test_xxx&tenant_id=6&amount=2000"
# → 302 vers /portal/apim/wallet?topup=success&balance=<nouveau_solde>
```

### Confirmation réelle (Stripe → webhook)

Stripe POSTe sur l'endpoint signé ; en `live` la signature HMAC-SHA256 de `"timestamp.payload"` est vérifiée en temps constant, signature invalide → `401`. Les events `checkout.session.completed` et `payment_intent.succeeded` créditent le wallet (`tx_type="topup"`).

```bash
curl -s -X POST http://localhost:8080/api/apim/stripe/webhook \
  -H "Stripe-Signature: t=...,v1=..." \
  -H "Content-Type: application/json" \
  --data-binary @event.json
```

### Consulter le solde et l'historique

```bash
curl -s -H "X-Internal-Auth: dev" http://localhost:8080/portal/apim/wallet/summary | jq
curl -s -H "X-Internal-Auth: dev" "http://localhost:8080/portal/apim/wallet/transactions?limit=20" | jq
```

### Recharge automatique (optionnel)

```bash
curl -s -X POST http://localhost:8080/portal/apim/wallet/auto-topup \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"enabled": true, "at_cents": 100, "amount_cents": 2000}' | jq
# recharge de 20 € dès que le solde descend sous 1 €
```

---

## 6. Étape 4 — Générer les factures mensuelles

`generateForTenant(tenantId, "YYYY-MM")` agrège les `tr_metering_record` `invoiced = FALSE` de la période (par API : `SUM(cost_eur_cents)`, `COUNT(*)`, octets), ajoute le `plan_fee` (`apim.db_plan.monthly_fee_cents` ou override `tr_tenant_plan`), insère/met à jour `apim.tr_invoice` via `ON CONFLICT (invoice_number) DO UPDATE`, puis marque les records `invoiced = TRUE` — donc **idempotent** et sans double facturation.

### Côté admin (REST)

```bash
# Générer la facture du tenant 6 pour juin 2026 (query params)
curl -s -X POST "http://localhost:8080/api/apim/admin/billing/generate?tenant_id=6&month=2026-06" \
  -H "X-Internal-Auth: dev" | jq

# Lister les factures d'un tenant
curl -s -H "X-Internal-Auth: dev" \
  "http://localhost:8080/api/apim/admin/invoices?tenant_id=6" | jq
```

### Côté tenant

```bash
curl -s -H "X-Internal-Auth: dev" http://localhost:8080/portal/apim/me/invoices | jq
```

---

## 7. Validation

### Wallet et transactions

```sql
SELECT id_tenant, balance_cents, currency FROM apim.tr_tenant_wallet WHERE id_tenant = 6;

SELECT tx_type, amount_cents, balance_after_cents, description,
       stripe_payment_intent, x_dateCreated
FROM apim.tr_wallet_transaction
WHERE id_tenant = 6 ORDER BY x_dateCreated DESC LIMIT 10;
-- amount_cents NÉGATIF pour un débit, table append-only
```

### Metering d'un appel

```sql
SELECT id_call_audit, id_published_api, bytes_in, bytes_out, cost_eur_cents, invoiced
FROM apim.tr_metering_record
WHERE id_tenant = 6 ORDER BY x_dateCreated DESC LIMIT 10;
```

### Facture générée

```sql
SELECT invoice_number, id_tenant, period_start, period_end,
       total_cents, currency, status
FROM apim.tr_invoice WHERE id_tenant = 6 ORDER BY period_start DESC;
```

### Débit en temps réel (mode `prepaid_wallet`)

```bash
# Appel API : si le solde est insuffisant, l'APIM renvoie 402
curl -s -i https://data-items.thesocle.net/items -H "X-API-Key: sk_prod_xxxx"
# Solde OK  → 200 + débit ; Solde KO → HTTP/1.1 402 {"error":"PAYMENT_REQUIRED"}
```

---

## 8. Pièges courants

### Piège 1 — Un appel < 1 Mo coûte 0 alors qu'on a réglé `cost_per_mb_in`

**Symptôme** : seul `cost_per_call_cents` est facturé.

**Cause** : la division par 1 Mo est **entière** (`bytes / (1024*1024)`) ; sous 1 Mo, `mbIn = mbOut = 0`.

**Résolution** : facturer principalement via `cost_per_call_cents`, ou poser un coût custom par règle JDM `apim_pricing`.

### Piège 2 — Les erreurs ne sont pas facturées

**Symptôme** : des appels 4xx/5xx n'apparaissent pas dans le metering.

**Cause** : `recordCall` ignore les appels `responseStatus >= 400` (volontaire).

**Résolution** : comportement attendu ; pour facturer les rejets, le faire via une règle JDM en amont.

### Piège 3 — Le webhook Stripe renvoie 401

**Symptôme** : recharge non créditée, `401` sur `/api/apim/stripe/webhook`.

**Cause** : `apim.stripe.webhook-secret` mal configuré ou signature `Stripe-Signature` invalide (vérif HMAC-SHA256 en temps constant).

**Résolution** : recopier le `webhook-secret` du dashboard Stripe ; en `test`, laisser le secret vide (signature non vérifiée) et utiliser `test-topup-confirm`.

### Piège 4 — `mode: live` lève une exception

**Symptôme** : `UnsupportedOperationException` au checkout.

**Cause** : le mode `live` est prévu V2.1 mais pas encore implémenté ; sans `secret-key`, le système **force** le mode test.

**Résolution** : rester en `mode: test` (ou attendre la V2.1) ; la recharge test crédite réellement le wallet.

### Piège 5 — Facture régénérée mais montant inchangé

**Symptôme** : relancer `billing/generate` ne change pas le total.

**Cause** : c'est l'idempotence (`ON CONFLICT (invoice_number)` + records marqués `invoiced=TRUE`). Les appels déjà facturés ne sont pas recomptés.

**Résolution** : comportement attendu. Pour refacturer, il faudrait remettre `invoiced=FALSE` (déconseillé) — préférer générer le mois suivant.

### Piège 6 — `402 PAYMENT_REQUIRED` alors que le solde semble suffisant

**Symptôme** : appels rejetés en 402.

**Cause** : `payment_mode='prepaid_wallet'` et le débit échoue (solde < coût). Le débit est sérialisé (`FOR UPDATE`) ; un solde bas + appels concurrents peut basculer en négatif.

**Résolution** : recharger le wallet, activer l'auto-topup, ou repasser l'API en `subscription`.

### Piège 7 — `balance_cents` jamais créé pour un tenant

**Symptôme** : `tr_tenant_wallet` vide pour le tenant.

**Cause** : le wallet est créé paresseusement (`getOrCreateWallet`) au premier checkout/débit.

**Résolution** : appeler `/portal/apim/wallet/summary` ou `/checkout` une fois pour initialiser le wallet.

---

## 9. Pour aller plus loin

- [[124-apim-pricing-wallet-billing]] — détail metering, wallet (verrous), facturation, Stripe,
- [[120-apim-architecture-pipeline]] — `ApimPaymentRequiredHandler` (402) dans le pipeline,
- [[125-apim-jdm-rules-engine]] — règle `apim_pricing` injectant `cost_eur_cents`,
- [[howto-30-publier-une-api-apim|HOWTO 30]] — publier l'API et fixer les tarifs au wizard,
- [[howto-31-creer-une-regle-jdm-apim|HOWTO 31]] — pricing dynamique par règle JDM,
- [[58-pricing-sync-worker]] — synchronisation des prix LLM (AgentIA, sous-système distinct).
