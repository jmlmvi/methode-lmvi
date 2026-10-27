# HOWTO 30 — Publier une API via le wizard APIM

> **Niveau** : avancé | **Prérequis** : SocleHub Hub 3.12.1 démarré, app cible installée (ou mini-hub enrôlé), zone Cloudflare configurée, ACME opérationnel, accès admin APIM | **Temps estimé** : 5-15 min (DNS + ACME compris)

Ce guide montre comment exposer publiquement une API (d'une app du Hub, d'un container sur mini-hub, ou d'une URL externe) à travers la passerelle **APIM** de SocleHub. La publication passe par le **wizard 3 étapes** (`ApimWizardController`), qui insère la `tr_published_api` en `status='provisioning'`, génère scopes + clés par tenant, puis déclenche la **cascade de provisioning** `DNS → ACME → backend → activate` (`ApimProvisioningWorker`). Une fois `published`, l'`ApimFilter` route le trafic entrant `(hostname, path)` vers le backend résolu.

---

## 1. Contexte

L'opérateur veut mettre une API derrière une URL publique (`https://data-items.thesocle.net` ou `https://api.lmvi.io/data/v1`) avec authentification par clé, scopes, rate-limit, anti-scan, audit et tarification — sans écrire de reverse-proxy ni de couche d'auth. L'APIM fait tout cela en interceptant la requête **avant** le proxy SSO interne (`@Order(HIGHEST_PRECEDENCE + 5)` contre `+10` pour `DynamicProxyFilter`, cf. [[120-apim-architecture-pipeline|architecture APIM]]).

Le wizard doit :

- Choisir le **backend** : `HUB_CONTAINER`, `MINIHUB_CONTAINER` ou `EXTERNAL_URL`,
- Définir l'**exposition** : sous-domaine (`subdomain`) ou chemin sous `api.lmvi.io` (`path`),
- Auto-générer les **4 scopes** de l'API et une **clé par tenant** sélectionné,
- Lancer la **cascade de provisioning** (DNS LMVI + certificat ACME + test backend + activation),
- Persister `apim.tr_published_api` puis recharger le catalogue (`PublishedApiCatalog`).

---

## 2. Architecture

```
   POST /api/apim/admin/wizard/publish  (body = état wizard step2/step3)
        │
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │            ApimWizardController.publish                   │
   │  1. INSERT apim.tr_published_api  status='provisioning'   │
   │  2. INSERT apim.z_app_publication (lien app→API)          │
   │  3. scopeService.autoGenerateScopesForApi → 4 scopes      │
   │  4. par tenant : raw_key + INSERT iam.tr_api_keys         │
   │  5. provisioningWorker.executeAction("provision_api")     │
   └───────────────────────────┬──────────────────────────────┘
                               │ job_id
                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │     ApimProvisioningWorker.runCascade (pool 2 threads)    │
   │   dns_create ─► acme_request ─► backend_test ─► activate  │
   │       │             │               │            │        │
   │       ▼             ▼               ▼            ▼        │
   │  DnsSyncWorker   AcmeService    test backend  status=     │
   │  (sous-dom LMVI) (certificat)   (hub_container) 'published'│
   └───────────────────────────┬──────────────────────────────┘
                               │ reload catalogue
                               ▼
   ┌──────────────────────────────────────────────────────────┐
   │  ApimFilter : match(hostname, path) → forward backend     │
   │   HUB_CONTAINER → http://<container>:<port>               │
   │   MINIHUB_CONTAINER → tunnel gRPC HttpProxyBridge         │
   │   EXTERNAL_URL → target_url                               │
   └──────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Choisir le backend

Le `BackendType` (`apim/model/BackendType.java`) est strictement l'un de ces trois (valeurs DB dans `apim.tr_published_api.target_backend_type`) :

| Enum | Valeur DB | Forward | Quand l'utiliser |
|------|-----------|---------|------------------|
| `HUB_CONTAINER` | `hub_container` | `http://<container>:<port><path>` via `HttpClient` | App installée localement sur le Hub |
| `MINIHUB_CONTAINER` | `minihub_container` | tunnel gRPC `HttpProxyBridge.forwardAndWait` | Container hébergé sur un mini-hub distant (cf. [[140-minihub-architecture-grpc]]) |
| `EXTERNAL_URL` | `external_url` | URL complète `target_url` | Webhook / API tierce externe |

Le wizard **déduit automatiquement** le backend (`ApimWizardController.publish`, l.116-132) :

- il cherche d'abord l'app dans `apps.applications` (`port_internal` → `hub_container`),
- à défaut, un `minihub_slug` dans `iam.db_minihub` → `minihub_container`.

> Pour un backend `external_url`, on passe par l'API admin générique (`POST /api/apim/admin/apis`) plutôt que par le wizard, qui ne déduit que hub/mini-hub.

Lister les apps publiables (celles avec un port interne et pas déjà publiées) :

```bash
curl -s -H "X-Internal-Auth: dev" \
  http://localhost:8080/api/apim/admin/apps/publish-candidates | jq '.[] | {app_id, port_internal}'
```

Détecter automatiquement une spec OpenAPI de l'app (suggère slug, opérations, scopes) :

```bash
curl -s -X POST http://localhost:8080/api/apim/admin/openapi/detect \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"app_id": "data-app"}' | jq
```

---

## 4. Étape 2 — Définir le slug, l'exposition et les scopes

### Mode `subdomain`

L'API est servie sur `<subdomainName><subdomainSuffix>` (suffixe par défaut `.thesocle.net`), `base_path_external = "/"`. C'est le seul mode où la cascade crée le **DNS LMVI** (sous-domaines `*.thesocle.net` / `*.lmvi.io` uniquement, `isLmviSubdomain`).

### Mode `path`

L'API est servie sous `api.lmvi.io` avec `base_path_external = pathBase` (défaut `/<slug>/v1`). Le matching est **longest-prefix** sur le chemin (`PublishedApiCatalog.match`), donc plusieurs APIs peuvent cohabiter sur le même hostname.

### Scopes

Le wizard appelle `scopeService.autoGenerateScopesForApi(apiId, slug, ...)` qui crée **4 scopes** dérivés du slug. Le `required_scope` par défaut est `api:<slug>:read`. Chaque tenant sélectionné reçoit une clé portant le scope `api:<slug>:<scope_level>` (`read` / `write` / `admin`).

Vérifier au préalable la disponibilité du hostname et du slug :

```bash
curl -s -X POST http://localhost:8080/api/apim/admin/apps/check-subdomain \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"subdomain": "data-items", "suffix": ".thesocle.net"}' | jq

curl -s -X POST http://localhost:8080/api/apim/admin/apps/check-slug \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"slug": "data-app-items"}' | jq
```

---

## 5. Étape 3 — Publier (POST /wizard/publish)

Le corps reflète l'état du wizard (`app_id`, `step2`, `step3`). Exemple complet (backend `hub_container`, exposition sous-domaine) :

```bash
curl -s -X POST http://localhost:8080/api/apim/admin/wizard/publish \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{
    "app_id": "data-app",
    "step2": {
      "slug": "data-app-items",
      "displayName": "DataApp Items",
      "exposureMode": "subdomain",
      "subdomainName": "data-items",
      "subdomainSuffix": ".thesocle.net",
      "scanGuard": true,
      "selectedOps": ["GET /items", "POST /items"]
    },
    "step3": {
      "selectedTenants": [
        {"id_tenant": 6, "scope_level": "read"},
        {"id_tenant": 7, "scope_level": "write"}
      ],
      "costPerCallCents": 2,
      "costPerMbInCents": 0,
      "costPerMbOutCents": 0,
      "paymentMode": "subscription",
      "topupMinEurCents": 500,
      "signIdentityJwt": false,
      "isPrivate": false
    }
  }' | jq
```

Réponse `201 Created` (extrait — la clé brute n'est montrée **qu'une fois**) :

```json
{
  "status": "published",
  "api_id": 42,
  "slug": "data-app-items",
  "public_hostname": "data-items.thesocle.net",
  "base_path_external": "/",
  "public_url": "https://data-items.thesocle.net/",
  "scopes_created": ["api:data-app-items:read", "api:data-app-items:write", "..."],
  "required_scope": "api:data-app-items:read",
  "keys_generated": [
    {
      "tenant_id": 6,
      "tenant_slug": "acme",
      "key_name": "data-app-items-read",
      "scope": "api:data-app-items:read",
      "raw_key": "sk_prod_xxxxxxxxxxxxxxxxxxxxxxxx",
      "warning": "Copy this raw_key now — it will NEVER be shown again."
    }
  ],
  "provisioning_job_id": "prov-...",
  "provisioning_status_url": "/api/apim/admin/apis/42/provisioning-status",
  "provisioning_stream_url": "/api/apim/admin/apis/42/provisioning-stream"
}
```

> **Paramètres `step3` notables** : `paymentMode` (`subscription` par défaut, `prepaid_wallet` pour facturer au wallet — cf. [[howto-35-configurer-le-wallet-et-la-facturation-apim|HOWTO 35]]), `signIdentityJwt` (injecte `Authorization: ApimSigned <jwt>` vers le backend), `isPrivate` (API non listée publiquement).

---

## 6. Étape 4 — Suivre la cascade de provisioning

Le wizard a déjà déclenché `provision_api` ; on suit l'avancement par `api_id`. La cascade exécute 4 étapes journalisées dans `apim.z_provisioning_step` : `dns_create`, `acme_request`, `backend_test`, `activate`.

### Snapshot REST

```bash
curl -s -H "X-Internal-Auth: dev" \
  http://localhost:8080/api/apim/admin/apis/42/provisioning-status | jq
```

### Stream SSE (poll 2 s, timeout 5 min)

```bash
curl -N -H "X-Internal-Auth: dev" \
  http://localhost:8080/api/apim/admin/apis/42/provisioning-stream
```

### Via MCP

L'action `provision_api` du worker `apim_provisioning_worker` est SYNC et rend immédiatement un `job_id` ; la cascade tourne en fond sur un pool de 2 threads.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"apim_provisioning_worker__provision_api",
           "arguments":{"api_id":42}}}
```

État du worker (jobs actifs) :

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"apim_provisioning_worker__get_status","arguments":{}}}
```

> **`dns_create` skipped** si le hostname n'est **pas** un sous-domaine LMVI (`.thesocle.net` / `.lmvi.io`) : pour un domaine custom, il faut apporter le certificat (cf. [[126-apim-certs-jwt-security]]). De même `backend_test` n'est exécuté que pour `hub_container`, `skipped` sinon.

### Reprise et rollback

- En cas d'échec (`failed_dns` / `failed_ssl` / `failed_backend`), relancer la cascade :

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call",
 "params":{"name":"apim_provisioning_worker__retry_provisioning",
           "arguments":{"api_id":42}}}
```

- Pour défaire la publication (supprime le DNS, passe l'API en `archived` — **irréversible**) :

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call",
 "params":{"name":"apim_provisioning_worker__rollback_provisioning",
           "arguments":{"api_id":42}}}
```

---

## 7. Validation

### Statut de l'API publiée

```sql
SELECT x_id, slug, status, public_hostname, base_path_external,
       target_backend_type, target_app_id, target_port, required_scope
FROM apim.tr_published_api WHERE slug = 'data-app-items';
-- status doit passer 'provisioning' → 'published'
```

### Étapes de provisioning

```sql
SELECT step_index, step_name, step_status, duration_ms, error_message
FROM apim.z_provisioning_step
WHERE id_published_api = 42 ORDER BY step_index;
```

### Clés générées par tenant

```sql
SELECT k.x_id, k.key_name, k.id_tenant, k.scopes, k.tier
FROM iam.tr_api_keys k
WHERE k.key_name LIKE 'data-app-items-%';
-- key_hash = SHA-256 ; la clé brute n'est jamais stockée
```

### Appel réel à travers l'APIM

```bash
curl -s https://data-items.thesocle.net/items \
  -H "X-API-Key: sk_prod_xxxxxxxxxxxxxxxxxxxxxxxx" | jq
# Réponses APIM possibles : 401 AUTH_MISSING/AUTH_INVALID_KEY, 403 AUTH_SCOPE_DENIED,
# 429 RATE_LIMIT_EXCEEDED, 402 PAYMENT_REQUIRED (wallet), 200 + body backend
```

Les en-têtes de réponse portent `X-APIM-Call-Id` et le rate-limit ; le backend reçoit `X-APIM-Tenant-Id`, `X-APIM-Plan`, `X-APIM-Scopes` (la clé brute n'est **jamais** transmise au backend).

---

## 8. Pièges courants

### Piège 1 — `status` reste `provisioning` puis `failed_dns`

**Symptôme** : `provisioning-status` montre `dns_create` en `failed`.

**Cause** : le hostname est un sous-domaine LMVI mais la création DNS Cloudflare a échoué (token, zone). En revanche, un hostname **non** LMVI passe en `skipped` (normal, pas un échec).

**Résolution** : vérifier la zone (`dns_sync_worker__list_zones`), corriger `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`, puis `retry_provisioning`.

### Piège 2 — `failed_ssl`

**Symptôme** : `acme_request` en `failed`, l'API ne passe pas `published`.

**Cause** : `acmeService.requestCertificate(hostname)` a échoué (DNS pas propagé, rate-limit Let's Encrypt, port 80 fermé).

**Résolution** : attendre la propagation DNS, vérifier l'`acme_worker`, puis `retry_provisioning`. Pour un domaine custom, fournir le certificat (cf. [[126-apim-certs-jwt-security]]).

### Piège 3 — 404 du Hub au lieu de l'API

**Symptôme** : l'appel `https://<host>/<path>` tombe sur le proxy SSO ou un 404, pas sur l'APIM.

**Cause** : l'API n'est pas `published` **et** `x_active=TRUE`, ou le catalogue n'a pas rechargé. `PublishedApiCatalog` ne charge que `WHERE status='published' AND x_active=TRUE`, reload toutes les 5 min.

**Résolution** : vérifier le statut en base, attendre/forcer le reload (re-publier déclenche un reload). Vérifier que `public_hostname` (en minuscules) correspond exactement au `Host` envoyé.

### Piège 4 — `publish_failed` : `relation "apps.applications" does not exist`

**Symptôme** : le wizard renvoie `400 publish_failed` avec une `root_cause` SQL.

**Cause** : la requête de déduction du backend interroge `apps.applications` (au pluriel) et `iam.db_minihub`. Sur un Hub mal migré, ces relations peuvent manquer.

**Résolution** : appliquer les migrations (`\dt apps.*`, `\dt iam.*`). Pour un backend externe, passer par `POST /api/apim/admin/apis` au lieu du wizard.

### Piège 5 — La clé brute est perdue

**Symptôme** : on n'a pas copié `raw_key`, l'app cliente ne peut plus s'authentifier.

**Cause** : `iam.tr_api_keys.key_hash` stocke le SHA-256 ; la clé brute n'est renvoyée qu'une fois par le wizard.

**Résolution** : révoquer la clé (`POST /api/apim/admin/keys/{id}/revoke`) et en émettre une nouvelle (`POST /api/apim/admin/keys`).

### Piège 6 — Backend `hub_container` injoignable

**Symptôme** : appels en `502/504` (`UPSTREAM_UNREACHABLE`/`UPSTREAM_TIMEOUT`), circuit breaker OPEN.

**Cause** : `target_port` faux, container arrêté, ou app pas sur le réseau `soclehub-net`. Le timeout effectif est `upstream_timeout_ms` (défaut 30 s).

**Résolution** : vérifier `target_app_id`/`target_port`, l'état du container (`docker_worker__get_app`), et que le `backend_test` était `success`.

### Piège 7 — Le backend reçoit la clé API

**Symptôme** : on voit `Authorization`/`X-API-Key` arriver côté backend.

**Cause** : confusion — l'APIM **retire** `Authorization` et `X-API-Key` avant forward (`injectHeaders`). Si le backend les reçoit, c'est qu'il n'est pas derrière l'APIM mais derrière le proxy SSO.

**Résolution** : confirmer que le `(hostname, path)` matche bien une Published API (`PublishedApiCatalog`), sinon c'est `DynamicProxyFilter` qui sert (cf. [[43-proxy-worker]]).

---

## 9. Pour aller plus loin

- [[120-apim-architecture-pipeline]] — pipeline complet (auth, JDM, rate-limit, forward) et `ApimContext`,
- [[121-apim-published-apis-catalog]] — matching longest-prefix, backends nommés, circuit breakers,
- [[127-apim-provisioning-wizard]] — détail de la cascade, SSE, audit `tr_api_call_audit`,
- [[126-apim-certs-jwt-security]] — certificats custom domain et JWT d'identité signé,
- [[howto-31-creer-une-regle-jdm-apim|HOWTO 31]] — personnaliser accès/routage/pricing par règle JDM,
- [[howto-35-configurer-le-wallet-et-la-facturation-apim|HOWTO 35]] — facturation prépayée et top-up Stripe.
