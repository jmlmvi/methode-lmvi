# HOWTO 13 — Utiliser SocleHub comme MCP aggregator unique pour un agent IA

**Niveau :** Senior
**Prérequis :** SocleHub 3.12+ déployé, au moins une app V005 installée et `running`, un agent IA compatible MCP (Claude Desktop, Claude Code, ChatGPT, Cline, Cursor…), accès à `MCP_API_KEY` ou un compte OIDC actif.
**Temps estimé :** 30 minutes

> **Deux composants distincts à ne pas confondre :**
> - **`McpProxyWorker`** (priorité 55, `mcp_proxy_worker`) — l'agrégateur **runtime** : il expose et **forwarde** les outils MCP des apps `running` sur l'endpoint unique `POST /mcp`. C'est lui qui sert un agent IA. Réf : [[55-mcp-proxy-worker]].
> - **`McpaggerAggregatorWorker`** (`mcpagger_aggregator_worker`) + le contrôleur `/hub/mcpagger` — **MCPagger** au sens strict : il agrège les **specs** MCP (riches via `GET {app}/mcpagger/spec.json`, ou dégradées via `tools/list`) pour les présenter dans une page Hub et des endpoints JSON. Réf : [[56-mcpagger-aggregator]].
>
> Ce guide couvre les deux : §3-§9 = `McpProxyWorker` (brancher un agent IA), §9bis = MCPagger (catalogue de specs).

---

## 1. Contexte

Un environnement SocleHub héberge typiquement plusieurs applications V005 indépendantes : `appdemo`, `meteo-paris`, un connecteur métier custom, etc. Chacune expose son propre serveur MCP (Model Context Protocol) sur son port interne via JSON-RPC 2.0 (`POST /mcp` avec `tools/list` et `tools/call`). Brancher un agent IA sur **chaque** app individuellement signifie multiplier les configurations dans le client (un endpoint par app, un token par app, une re-déclaration à chaque install/uninstall).

Le rôle du Hub change radicalement la donne : SocleHub agrège **dynamiquement** tous les outils MCP des apps `running` dans un endpoint unique `POST /mcp`. L'agent IA voit alors un seul serveur MCP, mais chaque outil porte un préfixe `{appId}__{toolName}` qui identifie son app d'origine. Quand une nouvelle app est installée et démarrée, son catalogue MCP est exposé dans les ~5 minutes (refresh automatique du `McpProxyWorker`) ou immédiatement via `mcp_proxy_refresh`. Les ~110 actions natives du Hub (workers `iam_worker`, `db_worker`, `docker_worker`, `storage_worker`, `signature_worker`, `acme_worker`, `dns_sync_worker`, `vault_worker`, `mail_worker`, `james_worker`, etc.) sont également exposées sans préfixe.

L'agrégateur doit :

- Présenter une vue unifiée `tools/list` mêlant outils Hub et outils apps (préfixés)
- Forwarder les `tools/call` préfixés vers l'app cible via le réseau Docker interne
- Authentifier les clients tiers en JWT OIDC (Claude.ai OAuth flow) **et** en API key statique (Claude Desktop, Cline)
- Survivre aux apps qui tombent (cache `healthy=false`, dégradation gracieuse)
- Permettre le refresh manuel sans redémarrage (action `mcp_proxy_refresh`)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Agent IA (Claude Desktop / claude.ai / Cline / ChatGPT)                │
│                                                                         │
│         POST https://admin.thesocle.net/mcp                             │
│         Authorization: Bearer <MCP_API_KEY ou JWT OIDC>                 │
│         { "jsonrpc":"2.0", "method":"tools/list", "id":1 }              │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SocleHub (port 80/443 + Cloudflare TLS)                                │
│                                                                         │
│  1. OidcMcpAuthFilter   ── valide MCP_API_KEY OU JWT IAM, réécrit       │
│                            l'Authorization en Bearer MCP_API_KEY        │
│  2. ApiAuthFilter       ── laisse passer si MCP_API_KEY OK              │
│  3. McpHttpController   ── (framework V005) route vers ActionRegistry   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ ActionRegistry — agrège :                                        │   │
│  │   • Workers natifs Hub (iam_worker__create_user, …)              │   │
│  │   • McpProxyWorker (status/refresh/list_apps/invoke/get_status)  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              │  invoke(prefixedTool, args)              │
│                              ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ McpProxyWorker (PASSIVE, priority=55)                            │   │
│  │   - cache mcpCache: appId → {tools[], internalUrl, healthy}      │   │
│  │   - refresh = list_apps DockerWorker → fetchAppTools (par app)   │   │
│  │   - invoke = JSON-RPC tools/call vers http://{appId}:{port}/mcp  │   │
│  └────────────────┬───────────────────┬─────────────────────────────┘   │
└───────────────────┼───────────────────┼─────────────────────────────────┘
                    │                   │ Docker network: docker_soclehub-net
                    ▼                   ▼
        ┌─────────────────┐    ┌─────────────────┐
        │ appdemo:8080    │    │ meteo-paris:8081│
        │  /mcp           │    │  /mcp           │
        │  9 tools        │    │  3 tools        │
        └─────────────────┘    └─────────────────┘
```

---

## 3. Étape 1 — Déclencher l'agrégation côté Hub

`McpProxyWorker` se lance automatiquement avec priority 55 (après `DockerWorker`). À l'`initialize()`, il interroge `docker_worker/list_apps`, garde les apps en `running`, et tente une découverte MCP sur chaque endpoint interne `http://{containerName}:{port_internal}/mcp`. Le code complet est dans `eu/lmvi/soclehub/worker/McpProxyWorker.java` (réf [[55-mcp-proxy-worker|McpProxyWorker]]). Aucun travail périodique n'est fait dans `doWork()` — le rafraîchissement passe par l'action explicite `mcp_proxy_refresh`.

Le worker expose exactement **5 actions** : `mcp_proxy_status`, `mcp_proxy_refresh`, `mcp_proxy_list_apps`, `mcp_proxy_invoke` et `get_status`.

Vérifier l'agrégation après démarrage :

```bash
curl -s -X POST https://admin.thesocle.net/mcp \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
          "name": "mcp_proxy_status",
          "arguments": {}
        },
        "id": 1
      }' | jq '.result.content[0].text | fromjson'
```

Réponse attendue (extrait) :

```json
{
  "total_apps": 2,
  "total_tools": 12,
  "healthy_apps": 2,
  "apps": [
    { "app_id": "appdemo",     "tools": 9, "healthy": true, "fetched_at": 1712850123412 },
    { "app_id": "meteo-paris", "tools": 3, "healthy": true, "fetched_at": 1712850123502 }
  ]
}
```

**Points clés :**

- Le cache contient uniquement les apps qui répondent un `status: "ready"` à `GET /mcp` ET retournent un tableau `result.tools` non vide à `POST /mcp tools/list`.
- Une app qui sert un `index.html` (SPA catch-all) sur `/mcp` est filtrée — `McpProxyWorker.fetchAppTools` détecte le `<!` initial et abandonne.
- Le préfixe utilisé est `__` (deux underscores). C'est vital pour éviter les collisions avec les `_` legitimes dans les noms d'outils MCP (`techdb_reader_worker__get_recent_actions`).

---

## 4. Étape 2 — Configurer l'authentification

Deux modes coexistent et sont gérés par `OidcMcpAuthFilter` :

### Mode A — API key statique (Claude Desktop, Cline, ChatGPT custom GPT)

Le `MCP_API_KEY` est défini dans `docker/.env` et passé au container Hub via `docker-compose.yml`. C'est la méthode la plus simple pour les clients qui n'implémentent pas le flow OAuth complet. Exemple `.env` :

```bash
MCP_ENABLED=true
MCP_MODE=http
MCP_API_KEY=gateway-mcp-2026
```

Un `Authorization: Bearer gateway-mcp-2026` suffit pour passer le filtre. `OidcMcpAuthFilter.doFilterInternal()` détecte l'égalité avec `staticApiKey` et laisse passer la requête sans réécriture.

### Mode B — JWT OIDC (Claude.ai sur le web, ChatGPT plugin entreprise)

Quand un client tiers initie un flow OAuth 2.0 contre l'IAM de SocleHub (`/oidc/authorize`, `/oidc/token`), il reçoit un JWT signé par notre IAM. Ce JWT a 3 segments séparés par `.` ; le filtre détecte le format, appelle `IamService.validateToken(token)` (vérif signature HS256 + exp + issuer matchant `JWT_ISSUER`), et **réécrit** l'`Authorization` en `Bearer <MCP_API_KEY>` avant de chaîner. Le contrôleur framework voit donc toujours la static key, mais le filtre a tracé l'utilisateur réel via `sub` et `email` dans les logs.

Validation manuelle d'un JWT :

```bash
# 1. Obtenir un access token via login
TOKEN=$(curl -s -X POST https://admin.thesocle.net/api/v1/iam/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jmh@lmvi.eu","password":"THlmvi0330!"}' \
  | jq -r '.access_token')

# 2. Utiliser le JWT comme Bearer sur /mcp
curl -s -X POST https://admin.thesocle.net/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | jq '.result.tools | length'
```

---

## 5. Étape 3 — Configurer Claude Desktop

Dans `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows), ajouter :

```json
{
  "mcpServers": {
    "soclehub": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://admin.thesocle.net/mcp",
        "--header",
        "Authorization: Bearer gateway-mcp-2026"
      ]
    }
  }
}
```

`mcp-remote` (Node.js, package `@modelcontextprotocol/mcp-remote`) joue le pont stdio ↔ HTTP. Il forward les requêtes JSON-RPC stdio de Claude Desktop vers l'endpoint HTTP du Hub avec les headers fournis.

Redémarrer Claude Desktop puis ouvrir une conversation. L'icône slash `/` doit afficher la liste des outils MCP. Tester avec `/iam_worker__list_users` ou un outil préfixé `appdemo__meteo_paris__get_last_result`.

---

## 6. Étape 4 — Configurer Claude Code (CLI)

Claude Code utilise des MCP servers déclarés dans `~/.claude/settings.json` ou `.claude/settings.json` du projet. Ajouter :

```json
{
  "mcpServers": {
    "soclehub": {
      "type": "http",
      "url": "https://admin.thesocle.net/mcp",
      "headers": {
        "Authorization": "Bearer gateway-mcp-2026"
      }
    }
  }
}
```

Lancer Claude Code, vérifier la connexion :

```bash
claude
> /mcp
# Doit afficher :
# soclehub : connected (12 tools)
```

---

## 7. Étape 5 — Configurer ChatGPT / Cline / Cursor

### Cline (VSCode extension)

Settings → Cline → MCP Servers → Add :

```json
{
  "soclehub": {
    "url": "https://admin.thesocle.net/mcp",
    "transport": "http",
    "headers": {
      "Authorization": "Bearer gateway-mcp-2026"
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` :

```json
{
  "mcpServers": {
    "soclehub": {
      "url": "https://admin.thesocle.net/mcp",
      "headers": { "Authorization": "Bearer gateway-mcp-2026" }
    }
  }
}
```

### ChatGPT (Custom GPT avec MCP via Actions)

ChatGPT n'a pas de support MCP natif. Utiliser un wrapper (`mcp-bridge` Node) qui expose les tools en OpenAPI. Configurer le wrapper avec les mêmes credentials.

---

## 8. Étape 6 — Forcer le refresh après installation d'une nouvelle app

Quand vous installez une nouvelle app via le portail Hub ou via `docker_worker__install_app`, le cache MCP n'est pas immédiatement à jour. Deux solutions :

```bash
# Solution 1 : appel direct via l'API REST admin du Hub
curl -X POST https://admin.thesocle.net/admin/workers/mcp_proxy_worker/actions/mcp_proxy_refresh \
  -H "Authorization: Bearer gateway-mcp-2026"

# Solution 2 : appel via le protocole MCP (recommandé depuis un agent IA)
curl -s -X POST https://admin.thesocle.net/mcp \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": { "name": "mcp_proxy_refresh", "arguments": {} },
        "id": 99
      }' | jq '.result.content[0].text | fromjson'
```

Réponse attendue :

```json
{ "status": "refreshed", "apps": 3, "total_tools": 18 }
```

---

## 9. Validation

### Vérifier la santé du proxy

```bash
curl -s https://admin.thesocle.net/admin/workers/mcp_proxy_worker/stats \
  -H "Authorization: Bearer gateway-mcp-2026" | jq
```

Réponse attendue :

```json
{
  "state": "running",
  "execution_count": 42,
  "errors_count": 0,
  "total_duration_ms": 1820,
  "schedule": "PASSIVE",
  "name": "mcp_proxy_worker",
  "cached_apps": 2,
  "total_tools": 12
}
```

### Lister tous les outils agrégés

```bash
curl -s -X POST https://admin.thesocle.net/mcp \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | jq '.result.tools[] | .name' | head -20
```

### Invoquer un outil agrégé d'une app

```bash
curl -s -X POST https://admin.thesocle.net/mcp \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
          "name": "appdemo__meteo_paris__get_last_result",
          "arguments": {}
        },
        "id": 2
      }' | jq '.result'
```

### Vérifier dans les logs

```bash
docker logs soclehub --tail 200 | grep -E "mcp_proxy|mcp_oidc_auth"
```

Attendu :

```
[mcp_oidc_auth] OIDC bearer accepté pour sub=2f3a... email=jmh@lmvi.eu
[worker:mcp_proxy_worker][step:fetch] App appdemo → 9 MCP tools from http://appdemo:8080/mcp
[worker:mcp_proxy_worker][step:invoke] Forwarding tool=meteo_paris__get_last_result to http://appdemo:8080/mcp via MCP
```

---

## 9bis. MCPagger — le catalogue de specs (`/hub/mcpagger`)

Là où `McpProxyWorker` **forwarde** des appels en temps réel, **MCPagger** (`McpaggerAggregatorWorker` + `McpaggerHubController`) sert un **catalogue de specs** consultable. Stratégie de fetch par app (cf. `eu/lmvi/soclehub/worker/McpaggerAggregatorWorker.java`) :

1. `GET http://{appId}:{port}/mcpagger/spec.json` — spec riche (format `mcpagger 1.0`),
2. Fallback `POST {app}/mcp tools/list` — spec dégradée, toujours dispo sur V005.

SocleHub s'ajoute lui-même comme app `soclehub` via le `WorkerActionRegistry` local. Les specs sont mises en cache KvBus sous le préfixe `mcpagger.specs.<appId>`.

### Page Hub

```
GET https://admin.thesocle.net/hub/mcpagger
```

Affiche la liste des apps, leur disponibilité, le nombre d'outils et un token Bearer pré-généré (session OIDC du portail).

### Endpoints JSON

```bash
# Liste des apps + statut
curl -s https://admin.thesocle.net/hub/mcpagger/apps | jq

# Spec d'une app
curl -s https://admin.thesocle.net/hub/mcpagger/apps/appdemo/spec.json | jq

# Spec consolidée de toutes les apps
curl -s https://admin.thesocle.net/hub/mcpagger/spec.json | jq

# Forcer le refresh (redirige vers la page)
curl -s https://admin.thesocle.net/hub/mcpagger/refresh
```

### Actions MCP du worker

`mcpagger_aggregator_worker` expose **4 actions** : `list_all_specs`, `get_app_spec` (param `app_id`), `get_aggregated_spec`, `refresh_specs`.

```bash
curl -s -X POST https://admin.thesocle.net/mcp \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call",
       "params":{"name":"mcpagger_aggregator_worker__list_all_specs","arguments":{}},"id":1}' \
  | jq '.result.content[0].text | fromjson'
```

Détails du format de spec et du cycle de vie : [[56-mcpagger-aggregator]].

---

## 10. Pièges courants

### Piège 1 — Outil préfixé non trouvé après installation

**Symptôme :** L'agent IA dit `Tool not found: appdemo__xxx` alors que l'app vient d'être installée.
**Cause :** Le cache `McpProxyWorker.mcpCache` est rafraîchi au démarrage et sur action explicite. Aucun timer ne le force après un install.
**Résolution :** Appeler `mcp_proxy_refresh` après chaque `docker_worker/install_app` ou `start_app`.

```bash
# Workflow complet
curl -X POST .../docker_worker/install_app -d '{"app_id":"newapp"}'
curl -X POST .../docker_worker/start_app  -d '{"app_id":"newapp"}'
sleep 10  # laisser le temps à l'app de démarrer son MCP
curl -X POST .../mcp_proxy_worker/actions/mcp_proxy_refresh
```

### Piège 2 — Erreur 401 sur /mcp avec un JWT pourtant valide

**Symptôme :** `HTTP 401 Unauthorized` malgré un JWT obtenu via `/api/v1/iam/login`.
**Cause :** Le JWT est validé par `IamService.validateToken` qui vérifie l'`issuer` du token. Si `JWT_ISSUER` côté `.env` est `www.thesocle.net` mais que le token a été signé avec un autre issuer (env vars hétérogènes après upgrade), validateToken retourne `null`.
**Résolution :** Aligner `JWT_ISSUER` partout, redémarrer le container Hub. Vérifier le claim `iss` du token avec `jq -R 'split(".") | .[1] | @base64d | fromjson'`.

### Piège 3 — `<!DOCTYPE html>` dans la réponse MCP d'une app

**Symptôme :** Logs Hub : `[worker:mcp_proxy_worker] App xxx returned HTML at /mcp — no MCP server`.
**Cause :** L'app a un SPA catch-all qui sert `index.html` sur toutes les routes inconnues, masquant le vrai endpoint MCP du framework.
**Résolution :** Côté app, configurer le routing Spring pour exclure `/mcp` du SPA fallback. Vérifier que `spring.web.resources.static-locations` ne capture pas `/mcp` avant le `McpHttpController`.

### Piège 4 — `Authorization: Bearer ...` rejeté avec MCP_API_KEY pourtant correct

**Symptôme :** 401 immédiat même avec la bonne API key.
**Cause :** Espaces invisibles ou retour à la ligne dans `MCP_API_KEY` (typique d'un copier/coller depuis un éditeur). `staticApiKey.equals(token)` est strict.
**Résolution :** `echo -n "$MCP_API_KEY" | wc -c` pour vérifier. Régénérer la clé via `openssl rand -base64 24 | tr -d '=+/' | head -c 32`.

### Piège 5 — Outil MCP invoqué retourne un timestamp en `OffsetDateTime` non sérialisable

**Symptôme :** Le call agrégé retourne `Cannot construct instance of java.time.OffsetDateTime`.
**Cause :** L'app distante retourne un type Java 8 datetime que Jackson ne sérialise pas par défaut.
**Résolution :** `McpProxyWorker.objectMapper` enregistre déjà `JavaTimeModule` (ligne 48). Si vous étendez le proxy, gardez ce module. Côté app distante, retournez plutôt `Instant.toString()` (ISO-8601).

### Piège 6 — Refresh ne voit pas une nouvelle app

**Symptôme :** `mcp_proxy_refresh` retourne `apps: 2` au lieu de 3 attendu.
**Cause :** L'app n'est pas dans l'état `running` côté `docker_worker/list_apps`. Soit elle est en `starting` (crash boucle), soit le healthcheck Docker n'est pas vert.
**Résolution :** `docker ps | grep newapp` puis `docker logs newapp` pour diagnostiquer le démarrage. `McpProxyWorker.refreshAllApps()` filtre strictement sur `"running".equalsIgnoreCase(status)`.

### Piège 7 — `mcp-remote` boucle sur "connection lost"

**Symptôme :** Claude Desktop affiche "MCP server disconnected" en boucle.
**Cause :** Mauvaise version de `mcp-remote` (avant 0.0.16) qui ne supporte pas les headers HTTP customs, ou TLS auto-signé non accepté.
**Résolution :** `npx mcp-remote@latest`. Pour un certificat valide, voir `howto-17-deployer-en-production.md` étape ACME.

### Piège 8 — `tools/call` réussit côté Hub mais l'agent IA voit `null`

**Symptôme :** `result.content[0].text` est vide alors que l'app a bien renvoyé des données.
**Cause :** L'app distante retourne le résultat dans `result` directement (pas dans `result.content`). `McpProxyWorker.handleInvoke` cherche `result.content[0].text`, sinon fallback sur `convertValue(result, Map.class)`.
**Résolution :** Côté app, conformer au standard MCP : `{ "result": { "content": [ { "type": "text", "text": "<json>" } ] } }`. Sinon `McpProxyWorker` retourne le `result` brut, ce qui peut casser le parsing côté agent.

### Piège 9 — Outils du Hub absents de `tools/list`

**Symptôme :** `tools/list` ne renvoie que les outils d'apps, pas `iam_worker__create_user` etc.
**Cause :** La feature flag `MCP_ENABLED=false` ou le contrôleur MCP framework n'est pas câblé. Cela arrive sur les déploiements pre-v2.4 où l'`ActionRegistry` n'agrège pas les `ActionProvider` Spring.
**Résolution :** Vérifier `MCP_ENABLED=true` dans `.env`. Tester `GET /mcp` (sans Bearer) doit retourner `{"status":"ready", ...}`. Si erreur 404, le framework V005 est < 5.0.0.

### Piège 10 — Performance : `tools/list` met 8 secondes

**Symptôme :** L'agent IA timeout sur le list initial.
**Cause :** Le Hub appelle `fetchAppTools` séquentiellement par app (pas en parallèle). Avec 10 apps × 800 ms par app = 8 s.
**Résolution :** Le `tools/list` côté MCP du framework lit le cache, donc rapide. Si lenteur, c'est `mcp_proxy_refresh` qui est lent — l'utiliser hors flux client (cron côté admin). Augmenter aussi `httpClient.connectTimeout` et `readTimeout` du `McpProxyWorker.initialize()` si vos apps mettent du temps à booter.

### Piège 11 — Token JWT révoqué mais accepté

**Symptôme :** Un JWT déconnecté (logout côté portail) reste utilisable sur `/mcp`.
**Cause :** Les JWT sont stateless. `IamService.validateToken` valide juste signature + exp.
**Résolution :** Soit utiliser `MCP_API_KEY` pour les agents (rotation manuelle), soit raccourcir `JWT_ACCESS_TTL` à 15 min, soit implémenter une blacklist Redis (V7+).

### Piège 12 — Collisions de noms d'outils

**Symptôme :** Deux apps exposent toutes deux un outil `get_status`. Les deux sont dans `tools/list` mais préfixés (`appA__get_status`, `appB__get_status`).
**Cause :** Pas un bug, c'est le design. Mais un appel non-préfixé `get_status` route vers le `McpProxyWorker.get_status` du Hub, ce qui peut surprendre.
**Résolution :** Toujours utiliser le nom complet `{appId}__{toolName}` dans les calls vers les apps. Le préfixe vide (Hub) est réservé aux workers du Hub.

---

## 11. Pour aller plus loin

- [[55-mcp-proxy-worker]] — référence complète du proxy runtime, contrats JSON-RPC, format du cache.
- [[56-mcpagger-aggregator]] — le worker MCPagger : format de spec, page `/hub/mcpagger`, cycle de vie.
- [[72-api-keys-jwt]] — mécanique de rotation des keys MCP et JWT IAM.
- Voir `howto-14-onlyoffice-edition.md` pour un cas d'usage concret avec un outil `appdemo__open_document`.
- Voir `agent-guide/04-mcp-interaction.md` pour les patterns côté agent IA.
