# HOWTO 20 — Configurer le cache L1+L2 (RAM + Redis) pour une app

**Niveau :** Intermédiaire
**Prérequis :** SocleHub Hub 3.12.1, une app installée avec une route active dans `apps.proxy_route`, accès admin (`X-Api-Key` ou OIDC bearer)
**Temps estimé :** 15-30 min

---

## 1. Contexte

Le cache est piloté par le [[42-cache-worker|`CacheWorker`]] : le Hub interpose un reverse-proxy (`ProxyWorker` + `DynamicProxyFilter`) entre l'utilisateur et chaque container applicatif (port 443 → conteneur Docker). Pour absorber un pic de charge sur les sites publics (vitrine WordPress, portails statiques, documentation Hugo), un cache HTTP à deux niveaux est intercalé : **L1 = RAM JVM (Caffeine, 1 000 entrées max)** et **L2 = Redis** (`soclehub-redis`, base 0). Les hits L1 répondent en <1 ms, L2 en 5-20 ms ; sur un site WordPress vitrine, on observe typiquement 80-95 % de hit rate après warm-up et des temps de page de 35 ms au lieu de 600 ms.

Ce HOWTO décrit comment activer le cache pour une app existante, ajuster les TTL, purger sélectivement, et identifier les cas où **il ne faut surtout pas** activer le cache.

Le cache doit :

- Cacher uniquement les **réponses GET** avec status 200 et taille ≤ `cache.max-body-size-mb` (2 MB par défaut).
- Ignorer les requêtes avec cookie `JSESSIONID`, `Authorization`, `Cookie: wordpress_logged_in_*`.
- Distinguer les *pages* (`text/html` → `page_ttl` = 300 s) des *assets* (`text/css|js`, `image/*`, fonts → `asset_ttl` = 86 400 s).
- Permettre une purge ciblée sur changement de contenu.

---

## 2. Architecture du cache

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Hub Tomcat (port 443)                          │
│                                                                        │
│   Browser ──► HTTPS ──► Tomcat ──► CacheFilter ──► DynamicProxyFilter  │
│                                       │                                │
│                                       ▼                                │
│                          ┌──────────────────────┐                      │
│                          │  CacheService (L1)   │                      │
│                          │  Caffeine in-process │                      │
│                          │  max_entries=1000    │                      │
│                          │  max_entry_size=512K │                      │
│                          └──────┬───────────────┘                      │
│                                 │ miss                                  │
│                                 ▼                                      │
│                          ┌──────────────────────┐    ┌──────────────┐ │
│                          │   Redis L2           │ ◄──┤ MISS / EXPIRY│ │
│                          │  soclehub-redis:6379 │    │ → upstream   │ │
│                          │  DB 0                │    │ → store both │ │
│                          └──────────────────────┘    └──────────────┘ │
│                                 │ miss                                  │
│                                 ▼                                      │
│                          ┌──────────────────────┐                      │
│                          │  ProxyWorker upstream│  ─►  container app  │
│                          │  (HTTP 1.1 keepalive)│                      │
│                          └──────────────────────┘                      │
└────────────────────────────────────────────────────────────────────────┘

CachePolicy (par route, JSONB dans apps.proxy_route.datas) :
  enabled, page_ttl_seconds, asset_ttl_seconds,
  respect_cache_control, max_entries_per_app
```

Clé de cache : `<hostname>::<method>::<path>::<query>::<accept-encoding>`. La séparation par hostname empêche les fuites entre apps multi-tenants.

---

## 3. Étape 1 — Vérifier que le cache est globalement actif

Le cache global est piloté par `CACHE_ENABLED=true` dans `.env` (défaut). Vérifier :

```bash
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/get_status \
  -H "X-Api-Key: $MCP_API_KEY"
```

Réponse attendue :

```json
{
  "success": true,
  "data": {
    "name": "cache_worker",
    "running": true,
    "cache_enabled": true,
    "hit_rate": 0.0,
    "l1_size": 0,
    "action_count": 1
  }
}
```

Si `cache_enabled` = false, ajouter dans `/opt/soclehub/docker/.env` :

```dotenv
CACHE_ENABLED=true
REDIS_HOST=soclehub-redis
REDIS_PORT=6379
REDIS_PASSWORD=<password>
REDIS_CACHE_DB=0
```

Puis `docker compose -f /opt/soclehub/docker/docker-compose.yml up -d soclehub`.

---

## 4. Étape 2 — Activer le cache pour une app

Cas d'école : une vitrine WordPress `corporate.thesocle.net` (`app_id = wordpress-corporate`).

```bash
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/cache_configure \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "wordpress-corporate",
    "page_ttl": "300",
    "asset_ttl": "86400"
  }'
```

Réponse :

```json
{
  "success": true,
  "data": {
    "app_id": "wordpress-corporate",
    "enabled": true,
    "page_ttl": 300,
    "asset_ttl": 86400
  }
}
```

L'action exécute :

1. Recherche la `ProxyRoute` par `app_id` dans `ProxyRoutingTable` (cache RAM).
2. Crée/met à jour `CachePolicy` (POJO `eu.lmvi.soclehub.model.CachePolicy`).
3. Persiste en DB : `UPDATE apps.proxy_route SET datas = '{"cachePolicy": {...}}'::jsonb WHERE app_id = ?`.
4. La table de routage est rechargée par `ProxyWorker` au prochain cycle (max 30 s).

**Points clés :**

- Le `page_ttl` doit être ≤ TTL des sessions user pour éviter d'afficher du contenu obsolète à un user connecté → en pratique, le cache ignore les requêtes avec cookie de session (voir §6 Piège 1).
- `asset_ttl` peut être très long (1 jour) car les URLs WordPress incluent un `?ver=` qui change à chaque update.

---

## 5. Étape 3 — Vérifier que le cache se remplit

```bash
# 1. Faire 5 requêtes anonymes (pas de cookie session)
for i in 1 2 3 4 5; do
  curl -sk -o /dev/null -w "%{http_code} %{time_total}s\n" \
    https://corporate.thesocle.net/
done

# Attendu :
# 200 0.620s    ← MISS, requête upstream
# 200 0.018s    ← HIT L1
# 200 0.017s    ← HIT L1
# 200 0.018s    ← HIT L1
# 200 0.017s    ← HIT L1

# 2. Stats
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/cache_stats \
  -H "X-Api-Key: $MCP_API_KEY" | jq
```

Réponse :

```json
{
  "data": {
    "hitRate": 0.80,
    "l1Size": 4,
    "l1Hits": 4,
    "l2Hits": 0,
    "misses": 1,
    "totalRequests": 5,
    "per_app": {
      "corporate.thesocle.net": 4
    }
  }
}
```

Si `hitRate = 0.0` après 10 requêtes, voir §10 Piège 2.

---

## 6. Étape 4 — Activer les en-têtes de debug

Pour debugger un cache qui ne fonctionne pas comme prévu, activer les en-têtes :

```bash
# Dans .env
CACHE_DEBUG_HEADERS=true
docker compose up -d soclehub
```

Désormais chaque réponse HTTP du cache porte :

```
X-Cache: HIT-L1               (ou HIT-L2, MISS, BYPASS)
X-Cache-Key: <hash>
X-Cache-Age: 42               (secondes depuis stockage)
X-Cache-TTL: 258              (secondes restantes)
```

```bash
curl -skI https://corporate.thesocle.net/ | grep -i x-cache
# X-Cache: HIT-L1
# X-Cache-Age: 42
```

---

## 7. Étape 5 — Purger le cache après update de contenu

### 7.1 Purge totale d'une app (après deploy WordPress, mise à jour CMS)

```bash
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/cache_purge_app \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "app_id": "wordpress-corporate" }'
```

### 7.2 Purge d'un chemin précis (après update d'une page)

```bash
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/cache_purge_path \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "app_id": "wordpress-corporate", "path": "/blog/article-2026" }'
```

### 7.3 Purge globale (incident, contenu obsolète massif)

```bash
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/cache_purge_all \
  -H "X-Api-Key: $MCP_API_KEY"
```

**Points clés :**

- La purge est synchrone et invalide L1 (RAM) et L2 (Redis `DEL` par pattern).
- Aucune notification automatique ; à intégrer dans le hook post-deploy de l'app via webhook → action MCP.

---

## 8. Étape 6 — Webhook post-deploy automatique

Pour qu'un push WordPress purge le cache automatiquement, configurer un plugin (ex. WP Cache Notify) qui frappe l'endpoint :

```php
// wp-content/plugins/cache-purge/cache-purge.php
add_action('save_post', function($post_id) {
    if (wp_is_post_revision($post_id)) return;
    $url = 'https://thesocle.net/api/actions/cache_worker/cache_purge_app';
    wp_remote_post($url, [
        'headers' => [
            'X-Api-Key' => 'sk-...',
            'Content-Type' => 'application/json',
        ],
        'body' => json_encode(['app_id' => 'wordpress-corporate']),
        'timeout' => 5,
    ]);
});
```

---

## 9. Validation

```bash
# 1. Test de charge minimal (anonyme)
ab -n 100 -c 10 https://corporate.thesocle.net/

# Réponse attendue : Time per request < 30 ms après warm-up

# 2. Test avec cookie de session → doit BYPASS le cache
curl -skI https://corporate.thesocle.net/wp-admin/ \
  -b "wordpress_logged_in_xxx=user|expiration|hmac" \
  | grep -i x-cache
# Attendu : X-Cache: BYPASS

# 3. Test après purge
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/cache_purge_app \
  -H "X-Api-Key: $MCP_API_KEY" -d '{"app_id":"wordpress-corporate"}'

curl -skI https://corporate.thesocle.net/ | grep -i x-cache
# Attendu : X-Cache: MISS
curl -skI https://corporate.thesocle.net/ | grep -i x-cache
# Attendu : X-Cache: HIT-L1
```

---

## 10. Quand utiliser / quand ne pas utiliser

### Cibles idéales (cache ON)

| Cas | Page TTL | Asset TTL |
|---|---|---|
| Vitrine WordPress (lecture seule, anonymes) | 300 s | 86 400 s |
| Documentation Hugo/MkDocs (statique) | 3 600 s | 604 800 s |
| Catalogue produit (Shopify-like) | 60 s | 86 400 s |
| Blog Ghost / Hashnode | 600 s | 86 400 s |
| Site one-pager corporate | 1 800 s | 86 400 s |

### Cibles à éviter (cache OFF ou très restrictif)

| Cas | Pourquoi |
|---|---|
| App SaaS multi-tenant (Nextcloud, Dolibarr) | Réponses dynamiques par user, fuite de données entre tenants |
| Webhook receiver / API REST | Toutes les requêtes sont uniques/POST |
| App avec WebSocket (chat, dashboard temps réel) | Le cache n'intercepte pas WebSocket, mais peut casser le upgrade HTTP |
| Page de paiement (Stripe, PayPal callback) | Risque de servir une réponse cachée d'un autre user |
| API authentifiée par user | `Authorization` est ignoré par le cache key, ne CACHEZ JAMAIS |

---

## 11. Pièges courants

### Piège 1 — Hit rate à 0 % alors que les TTL sont configurés

**Cause :** chaque réponse upstream contient `Set-Cookie` (session WordPress, CSRF tracking). Le cache refuse de stocker une réponse avec `Set-Cookie` (sécurité — éviter de redonner le cookie d'un autre user).
**Résolution :** sur le container app, désactiver les cookies sur les pages publiques. WordPress : plugin "Disable Sessions" sur les routes anonymes, ou patch theme :

```php
if (!is_user_logged_in()) {
    add_filter('comment_cookie_lifetime', '__return_zero');
    remove_action('init', 'send_origin_headers');
}
```

### Piège 2 — `X-Cache: BYPASS` permanent

**Cause :** la requête contient un cookie de session ou un en-tête `Cache-Control: no-store`. Le cache respecte `respect_cache_control = true` (défaut).
**Résolution :** vérifier les en-têtes envoyés par le browser :

```bash
curl -skI https://corporate.thesocle.net/ -H "Cache-Control: no-store"
# X-Cache: BYPASS
```

Pour forcer le cache même sur `Cache-Control: no-store` : modifier la `CachePolicy` :

```bash
curl -sk -X POST https://thesocle.net/api/actions/cache_worker/cache_configure \
  -d '{"app_id":"wordpress-corporate","respect_cache_control":"false"}'
```

À ne faire que sur du contenu vraiment public.

### Piège 3 — Une page mise à jour ne se rafraîchit pas

**Cause :** la TTL n'est pas écoulée et aucun webhook de purge n'est branché.
**Résolution :** purge ciblée via `cache_purge_path`, ou attendre TTL.

```bash
# INCORRECT — purge globale après chaque modif (perte du cache pour tout le monde)
curl -X POST .../cache_purge_all

# CORRECT
curl -X POST .../cache_purge_path -d '{"app_id":"...","path":"/page-modifiee"}'
```

### Piège 4 — Redis `OOM command not allowed when used memory > 'maxmemory'`

**Cause :** Redis n'a pas de politique d'éviction et a saturé sa RAM allouée.
**Résolution :** configurer `maxmemory-policy allkeys-lru` :

```bash
docker exec soclehub-redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
docker exec soclehub-redis redis-cli CONFIG REWRITE
```

### Piège 5 — Cache renvoie une réponse 500 au lieu de réessayer

**Cause :** le cache stocke aussi les réponses 5xx si on ne filtre pas.
**Résolution :** vérifier dans `CacheService` : seuls les status 200, 301, 404, 410 sont cachés. Si vous voyez un 500 caché, c'est un bug à reporter.

### Piège 6 — App qui retourne `Content-Encoding: br` (brotli) cachée incorrectement

**Cause :** la clé de cache inclut `Accept-Encoding`, mais si le upstream renvoie brotli alors que le client demande gzip, le mapping casse.
**Résolution :** désactiver brotli côté upstream, ne servir que gzip :

```nginx
# côté container app
gzip on;
gzip_types text/html text/css application/javascript;
brotli off;
```

### Piège 7 — Purge ne fonctionne pas car le `app_id` n'existe pas

**Cause :** la route a été supprimée ou l'app a été désinstallée. `findRouteByAppId` retourne null.
**Résolution :** vérifier d'abord :

```bash
curl -sk -X POST https://thesocle.net/api/actions/proxy_worker/list_routes \
  -H "X-Api-Key: $MCP_API_KEY" | jq '.data.routes[] | .app_id'
```

### Piège 8 — Cache servait une vieille version après un `docker compose up -d` du Hub

**Cause :** L1 est en RAM JVM et est perdu au restart, mais L2 (Redis) survit. Donc la première requête après restart hit L2 et renvoie une réponse stockée avant la mise à jour.
**Résolution :** purge L2 lors d'un redéploiement majeur du Hub :

```bash
docker exec soclehub-redis redis-cli -n 0 FLUSHDB
```

### Piège 9 — Réponses > 2 MB jamais cachées (PDF, images haute résolution)

**Cause :** `cache.max-body-size-mb=2` (défaut). Au-dessus, BYPASS systématique.
**Résolution :** augmenter dans `.env` si vraiment nécessaire, en surveillant la RAM Redis :

```dotenv
# .env
SOCLEHUB_CACHE_MAX_BODY_SIZE_MB=10
```

### Piège 10 — `cache_stats` rapporte un `hitRate` plus élevé que la réalité observée

**Cause :** le compteur `hitRate` agrège L1 + L2 sur la durée de vie du process JVM. Après un long uptime, le ratio est dominé par les hits historiques. Pour les stats fraîches, utiliser une fenêtre glissante.
**Résolution :** purger les stats en restartant le worker (ou ajouter `cache_reset_stats` — non implémenté à ce jour). En attendant, comparer `cache_stats` à 1 h d'écart :

```bash
curl ... cache_stats > /tmp/before.json
sleep 3600
curl ... cache_stats > /tmp/after.json
# Calculer le delta : (after.l1Hits - before.l1Hits) / (after.totalRequests - before.totalRequests)
```

---

## 12. Pour aller plus loin

- Voir [[42-cache-worker|CacheWorker]] pour la référence des 6 actions (`cache_configure`, `cache_purge_all`, `cache_purge_app`, `cache_purge_path`, `cache_stats`, `get_status`), la structure `CachePolicy` (JSONB dans `apps.proxy_route.datas`) et l'algorithme de clé L1/L2.
- Voir [[43-proxy-worker|ProxyWorker]] pour l'intégration du cache dans la table de routage.
- Voir `howto-19-rotation-secrets.md` pour la rotation `REDIS_PASSWORD`.
