# HOWTO 27 — Configurer le LLM Gateway AgentIA (provider + tenant + quota)

> **Niveau** : intermédiaire | **Cible** : SocleHub Hub 3.12.1 | **Worker vérifié** : `AgentIaWorker` (22 actions `agentia_worker/*`), gateway `AgentIaGatewayService` exposé sous `/api/agentia/v1/*`

**Audience** : admin SocleHub qui doit activer ou faire évoluer la passerelle LLM AgentIA pour un nouveau tenant : déclarer un provider, provisionner un user technique, fixer des quotas, faire le premier appel.

**Préalable** : avoir lu [[57-agentia-worker|AgentIA Worker]], [[58-pricing-sync-worker|PricingSync Worker]] et [[82-services-clients|Services clients (Gateway, adapters)]]. Avoir un compte admin SocleHub (scope `admin`).

---

## Vue d'ensemble du workflow

```
1. Stocker la clé API du LLM dans Vault
2. Déclarer le provider dans AgentIA (upsert_provider)
3. (Optionnel) Synchroniser le pricing OpenRouter
4. Provisionner un tenant (provision_tenant) → récupérer l'API key user
5. Enregistrer l'app autorisée (register_app)
6. Fixer un quota (set_quota)
7. Faire le premier appel à /api/agentia/v1/chat/completions
8. Vérifier la consommation (list_sessions, get_usage_summary)
```

---

## Étape 1 — Stocker la clé API du LLM dans Vault

Le Worker AgentIA ne reçoit **jamais** la clé en clair — seulement un chemin Vault.

```bash
JWT="eyJhbGc..."          # Bearer JWT admin SocleHub
PROVIDER_NAME="anthropic-claude"

curl -sk -X POST "https://admin.thesocle.net/api/actions/vault_worker/set_secret" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "path":   "agentia/providers/anthropic-claude",
       "key":    "api_key",
       "value":  "sk-ant-api03-..."
     }' | jq .
```

Vérification que la clé est bien posée (la valeur ne sera **pas** affichée — seulement les clés du chemin) :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/vault_worker/get_secret_keys" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{ "path": "agentia/providers/anthropic-claude" }' | jq .
# → {"keys":["api_key"]}
```

---

## Étape 2 — Déclarer le provider dans AgentIA

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/upsert_provider" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "name":             "anthropic-claude",
       "mode":             "anthropic-rest",
       "base_url":         "https://api.anthropic.com",
       "default_model":    "claude-sonnet-4-6",
       "available_models": "claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-7",
       "api_key_vault_path": "agentia/providers/anthropic-claude",
       "timeout_sec":      60,
       "max_concurrent":   4,
       "enabled":          true
     }' | jq .
# → {"name":"anthropic-claude","status":"created"}
```

Les `mode` possibles (validés strict par le Worker, cf. `LlmProviderMode`) :
- `openai-compat-rest` : OpenAI compatible (OpenAI direct, OpenRouter, Groq, Mistral...)
- `anthropic-rest` : Anthropic native (Claude direct)
- `ollama-rest` : Ollama local
- `mcp-http` : provider MCP over HTTP
- `mcp-stdio` : provider MCP over stdio

Vérifier :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/get_provider" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{ "name": "anthropic-claude" }' | jq .
```

---

## Étape 3 (Optionnel) — Synchroniser le pricing OpenRouter

Le `PricingSyncWorker` (`58-pricing-sync-worker.md`) tourne toutes les 24 h pour mettre à jour `agentia.z_pricing` depuis OpenRouter. Pour forcer immédiatement :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/pricing_sync_worker/sync_now" \
     -H "Authorization: Bearer $JWT" | jq .
# → {"synced_models": 312, "synced_at": "2026-05-14T08:00:00Z"}
```

Lister la tarification courante (par exemple pour Claude Sonnet) :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/list_pricing" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{}' | jq '.pricing[] | select(.model == "anthropic/claude-sonnet-4-6")'
```

Pour overrider manuellement un prix (résistant aux syncs) :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/set_pricing" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "provider_name":       "anthropic-claude",
       "model":               "claude-sonnet-4-6",
       "input_per_1m_usd":    3.00,
       "output_per_1m_usd":   15.00
     }' | jq .
# → "source": "admin_override"
```

---

## Étape 4 — Provisionner un tenant

```bash
TENANT_ID="acme-corp"

curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/provision_tenant" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{ \"tenant_id\": \"$TENANT_ID\" }" | jq .
```

Réponse — **garder l'API key précieusement, elle ne sera plus affichée** :

```json
{
  "tenant_id": "acme-corp",
  "status":    "provisioned",
  "api_key":   "sk_agentia_4f8e2a30b4c5d6e7f8a9...",
  "warning":   "ne sera pas affiché à nouveau"
}
```

Le Hub a créé :
- Un user technique IAM `agentia-runner@acme-corp` (password aléatoire, BCrypt cost 10).
- Un rôle `agentia:runner` attribué.
- Une API key (hash SHA-256 en `iam.api_keys`, valeur en clair stockée dans Vault sous `agentia/tenants/acme-corp/api_key`).
- Un enregistrement dans `agentia.z_tenant_user`.

---

## Étape 5 — Enregistrer l'app autorisée

Restreint les modèles que l'app peut consommer :

```bash
APP_ID="acme-support-bot"

curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/register_app" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{
       \"tenant_id\":         \"$TENANT_ID\",
       \"app_id\":            \"$APP_ID\",
       \"app_name\":          \"Support Bot ACME\",
       \"allowed_providers\": \"anthropic-claude\",
       \"allowed_models\":    \"claude-haiku-4-5,claude-sonnet-4-6\",
       \"enabled\":           true
     }" | jq .
```

---

## Étape 6 — Fixer un quota

Un quota mensuel global sur le tenant + un quota journalier spécifique à une app :

```bash
# Quota mensuel global sur le tenant
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/set_quota" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{
       \"tenant_id\":           \"$TENANT_ID\",
       \"period\":              \"monthly\",
       \"max_cost_usd\":        500.00,
       \"max_calls\":           100000,
       \"alert_threshold_pct\": 80,
       \"enabled\":             true
     }" | jq .

# Quota journalier spécifique à une app
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/set_quota" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{
       \"tenant_id\":           \"$TENANT_ID\",
       \"app_id\":              \"$APP_ID\",
       \"period\":              \"daily\",
       \"max_tokens_in\":       1000000,
       \"max_tokens_out\":      500000,
       \"alert_threshold_pct\": 80,
       \"enabled\":             true
     }" | jq .
```

Les deux quotas s'appliquent simultanément : le **premier** qui dépasse rejette ou alerte (selon `soclehub.agentia.quota.check-mode`).

---

## Étape 7 — Faire le premier appel

Depuis le côté tenant (l'API key obtenue à l'étape 4) :

```bash
TENANT_API_KEY="sk_agentia_4f8e2a30..."

curl -sk -X POST "https://admin.thesocle.net/api/agentia/v1/chat/completions" \
     -H "Authorization: Bearer $TENANT_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model":     "claude-haiku-4-5",
       "messages":  [{"role":"user","content":"Bonjour, raconte-moi une blague."}],
       "max_tokens": 200
     }' | jq .
```

L'app peut aussi streamer la réponse avec `"stream": true` (format SSE, identique au format OpenAI).

---

## Étape 8 — Vérifier la consommation

```bash
# Lister les dernières sessions LLM du tenant
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/list_sessions" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{ \"tenant_id\": \"$TENANT_ID\", \"limit\": 20 }" | jq .

# Résumé d'usage (par modèle)
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/get_usage_summary" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{
       \"tenant_id\": \"$TENANT_ID\",
       \"from\":      \"2026-05-01\",
       \"group_by\":  \"model\"
     }" | jq .
```

Côté DB pour un debug rapide :

```sql
-- Dernières 10 sessions
SELECT model, tokens_in, tokens_out, cost_usd, response_time_ms, x_dateCreated
FROM agentia.tr_session_call
WHERE x_partition = 'acme-corp'
ORDER BY x_dateCreated DESC LIMIT 10;

-- Fenêtres glissantes de quota
SELECT period, window_start, cost_usd, calls
FROM agentia.tr_quota_window
WHERE x_partition = 'acme-corp'
ORDER BY window_start DESC;
```

---

## Configurer un provider local (Ollama / vLLM Spark / GLM-4.7)

Pour passer sur **vLLM Spark GLM-4.7-Flash** (alias `glm47`, activement utilisé en mai 2026 — cf. mémoire `reference_vllm_spark_glm47`) :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/upsert_provider" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "name":             "vllm-spark-glm47",
       "mode":             "openai-compat-rest",
       "base_url":         "https://prehook-spark.lmvi.io/v1",
       "default_model":    "glm47",
       "available_models": "glm47",
       "api_key_vault_path": "agentia/providers/vllm-spark/token",
       "timeout_sec":      120,
       "max_concurrent":   8
     }' | jq .
```

---

## Rotation d'une API key tenant

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/agentia_worker/rotate_tenant" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{ \"tenant_id\": \"$TENANT_ID\" }" | jq .
# → nouvelle API key, anciennes révoquées
```

---

## Pièges courants

1. **Clé API LLM passée directement au lieu de `api_key_vault_path`** : le Worker rejette avec 400. Toujours stocker la valeur dans Vault d'abord, puis donner le chemin.

2. **`mode` invalide** : 400 `Mode inconnu`. Cinq valeurs strictes uniquement (cf. enum `LlmProviderMode`).

3. **`provision_tenant` rejouée** : retourne `{status: "already_provisioned"}` sans erreur, mais **ne réaffiche pas l'API key**. Si vous l'avez perdue, utiliser `rotate_tenant`.

4. **Quota global + quota app** : les deux sont évalués **indépendamment**. Si le global est à 100 % atteint et l'app à 50 %, l'appel rejette quand même. Penser à ajuster les deux quand on veut élargir.

5. **OpenRouter pricing override écrasé** : si vous setez un override `admin_override` et qu'un autre admin fait `sync_now` puis re-`set_pricing` avec `source: "openrouter_sync"` (incorrect), l'override est perdu. Toujours utiliser `agentia_worker.set_pricing` qui force `source='admin_override'`.

6. **Streaming SSE bufferisé par le proxy** : la passerelle Gateway côté SocleHub (`AgentIaGatewayService`) relaie le flux `text/event-stream` du provider. Le `DynamicProxyFilter` du Hub flush bien par chunk depuis la 3.2.1, mais un proxy/CDN intermédiaire peut re-bufferiser. Pour des réponses longues, s'assurer côté client que le header `X-Accel-Buffering: no` est respecté et que les timeouts de lecture sont généreux (le provider amont peut mettre plusieurs dizaines de secondes avant le premier token sur les modèles « reasoning » comme `glm47`).

7. **`pricing_sync_worker` qui ne se déclenche pas** : le cycle est 30 min mais ne sync réellement que si > 23 h depuis le dernier sync. Pour forcer : `sync_now`.

8. **Modèle non reconnu côté provider** : si `available_models` contient un modèle non supporté par le provider (typo, modèle déprécié), l'appel `chat/completions` retourne 400 du provider. Toujours valider la liste contre l'API du provider (`GET https://api.anthropic.com/v1/models` ou équivalent).

---

## Pour aller plus loin

- **AgentIA Worker fiche** : [[57-agentia-worker|AgentIA Worker]]
- **PricingSyncWorker fiche** : [[58-pricing-sync-worker|PricingSync Worker]]
- **Services clients (Gateway + adapters)** : [[82-services-clients|Services clients]]
- **APP-08-AgentIA (vitrine)** : [[116-app-08-agentia|APP-08 AgentIA]]
- **Pack AI** : [[101-socle-pack-ai|socle-pack-ai]]
- **Spec LLM Gateway** : `docs/4agentIA/SPEC-LLM-GATEWAY-V001.md`
