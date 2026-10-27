# HOWTO 09 — Configurer le SSO transparent sur plusieurs apps `*.thesocle.net`

**Niveau :** Senior
**Prérequis :** SocleHub démarré, `iam_worker` opérationnel, `proxy_worker` configuré, au moins une app installée et routée derrière le proxy, certificat TLS actif sur `*.thesocle.net`
**Temps estimé :** 30 minutes

---

## 1. Contexte

SocleHub joue le rôle d'**Identity Hub** pour toutes les apps déployées sur `*.thesocle.net`. Quand un utilisateur se connecte une fois sur `https://hub.thesocle.net/hub/login`, il doit pouvoir naviguer librement entre `https://app1.thesocle.net`, `https://wordpress.thesocle.net`, `https://pgadmin.thesocle.net`, etc. — sans se reloguer. C'est le principe du **Single Sign-On transparent**.

Le mécanisme repose sur un cookie partagé `soclehub_token` posé sur le **domaine parent** `.thesocle.net` (notez le point initial : ça partage le cookie avec **tous** les sous-domaines). Ce cookie contient un JWT RS256 émis par `IamService` et validé à chaque requête par le `SsoFilter` de la chaîne `DynamicProxyFilter` (voir [[70-securite-filtres]]). La spécification des 4 modes SSO est détaillée dans [[71-sso-oidc]].

Quatre **modes SSO** sont disponibles, chacun ayant un comportement différent au niveau du proxy :

- `none` — pas de SSO, l'app est publique (par défaut).
- `gate` — vérification one-time : si l'utilisateur est connecté, on pose un cookie HMAC court terme propre à l'app et on laisse passer ; l'app upstream **ne reçoit jamais** le `soclehub_token` (utile pour pgAdmin/phpMyAdmin qui s'embrouillent avec un cookie inconnu et renvoient 401).
- `optional` — on injecte `X-SSO-User` dans la requête upstream **si** un token valide est présent, mais on laisse passer les requêtes anonymes. Idéal pour des sites en partie publics.
- `required` — on exige un token valide ; redirection vers `/hub/login` sinon. L'app upstream reçoit `X-SSO-User: <user_id>`.

Vous devez : activer le SSO `gate` sur pgAdmin (l'utilisateur doit être connecté pour accéder à l'interface, mais pgAdmin a son propre login DB), et activer le SSO `required` sur `app1.thesocle.net` qui est une app maison qui fait confiance au header `X-SSO-User`.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ Browser                                                                │
│  ┌──────────────────────────────┐    ┌────────────────────────────┐    │
│  │ hub.thesocle.net/hub/login   │ ─► │ POST /hub/login (form)     │    │
│  └──────────────────────────────┘    └─────────────┬──────────────┘    │
│                                                    │                   │
│                                                    ▼                   │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ Set-Cookie: soclehub_token=<JWT>; Domain=.thesocle.net; Secure │    │
│  └─────────────────────────┬──────────────────────────────────────┘    │
│                            │                                           │
│                            ▼ navigate to                               │
│  ┌──────────────────────────────┐                                      │
│  │ https://app1.thesocle.net/   │                                      │
│  │ Cookie: soclehub_token=...   │  (envoyé automatiquement)            │
│  └──────────────┬───────────────┘                                      │
└─────────────────┼──────────────────────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              SocleHub                                  │
│                                                                        │
│  ┌─────────────────────────┐                                           │
│  │ DynamicProxyFilter      │                                           │
│  │  ▶ extract hostname     │                                           │
│  │  ▶ lookup ProxyRoute    │ ◄── proxy_worker  (table apps.proxy_routes)    │
│  │  ▶ if sso_enabled:      │                                           │
│  │     SsoFilter.check()   │                                           │
│  │       ├─ none    → pass                                             │
│  │       ├─ gate    → check gate cookie OR JWT, set sso_gate_<app>     │
│  │       ├─ optional→ inject X-SSO-User if JWT present, else anon     │
│  │       └─ required→ require JWT, inject X-SSO-User                   │
│  └────────────┬────────────┘                                           │
│               │                                                        │
│               ▼ (with X-SSO-User header)                               │
│  ┌─────────────────────────┐                                           │
│  │ Upstream app container  │                                           │
│  │ (app1, pgadmin, ...)    │                                           │
│  └─────────────────────────┘                                           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Comprendre les 4 modes et choisir

| Mode       | Token requis | Cookie soclehub_token vu par l'app | X-SSO-User envoyé | Cas d'usage typique                           |
|------------|--------------|------------------------------------|-------------------|-----------------------------------------------|
| `none`     | non          | oui (passe-plat)                   | non               | Site public, marketing                        |
| `gate`     | oui (1 fois) | **non** (filtré)                   | non               | pgAdmin, phpMyAdmin, apps avec login propre   |
| `optional` | non          | oui                                | si présent        | Blog WordPress (pages publiques + admin)      |
| `required` | oui          | oui                                | toujours          | App métier maison qui trust X-SSO-User        |

**Règle de décision :**

- L'app a **son propre système de login** que vous ne voulez pas court-circuiter mais vous voulez quand même restreindre l'accès aux users SocleHub → `gate`.
- L'app **fait confiance** au header `X-SSO-User` injecté par le proxy → `required`.
- L'app a une partie publique et une partie privée gérée à l'intérieur → `optional`.
- L'app est totalement publique → `none` (ne pas activer le SSO).

---

## 4. Étape 2 — Pré-requis : déclarer la route et les domaines de cookie

Le cookie `soclehub_token` est posé par `SsoCallbackController.ssoCallback()` avec `Domain=.{baseDomain}`. La valeur de `baseDomain` vient de `SocleHubProperties.cloudflare.defaultZone`, fallback sur `properties.domain`.

```yaml
# soclehub/docker/.env
SOCLEHUB_DOMAIN=thesocle.net
SOCLEHUB_CLOUDFLARE_DEFAULT_ZONE=thesocle.net
```

Vérifier qu'une route proxy existe pour `app1.thesocle.net` :

```bash
curl -sS http://localhost:8080/api/actions/proxy_worker/list_routes | jq
```

Si la route n'existe pas, l'ajouter :

```bash
curl -sS -X POST http://localhost:8080/api/actions/proxy_worker/add_route \
  -H "Content-Type: application/json" \
  -d '{
        "app_id":      "app1",
        "hostname":    "app1.thesocle.net",
        "target_host": "app1-container",
        "target_port": 8080
      }'

# Réponse :
# {"success":true,"data":{"app_id":"app1","hostname":"app1.thesocle.net",
#  "target":"app1-container:8080","status":"added"}}
```

---

## 5. Étape 3 — Activer le SSO mode `gate` sur pgAdmin

`gate` est le mode adapté quand l'app upstream a son propre login (pgAdmin, phpMyAdmin, Mattermost…) qui retournerait 401 en voyant un cookie inconnu. L'astuce : on **valide une fois** le `soclehub_token`, on pose un mini-cookie `sso_gate_<app_id>` (HMAC SHA-256 sur `userId|timestamp`, TTL 15 min) propre à l'host de l'app, et on **filtre** le cookie `soclehub_token` du flux upstream.

```bash
curl -sS -X POST http://localhost:8080/api/actions/proxy_worker/enable_sso \
  -H "Content-Type: application/json" \
  -d '{
        "app_id":   "pgadmin",
        "sso_mode": "gate",
        "sso_scope": "admin"
      }'

# Réponse :
# {"success":true,"data":{"app_id":"pgadmin","sso_enabled":true,
#  "sso_mode":"gate","sso_scope":"admin","status":"sso_enabled"}}
```

Le code Java exécuté côté `ProxyWorker.handleEnableSso()` (référence : [[43-proxy-worker]]) :

```java
package eu.lmvi.soclehub.worker;

private ActionResult handleEnableSso(ActionParameters params) {
    String appId    = params.getString("app_id");
    String ssoScope = params.getString("sso_scope");
    String ssoMode  = params.getString("sso_mode");
    if (ssoMode == null || ssoMode.isEmpty()) {
        ssoMode = "required";  // default si non précisé
    }
    try {
        ProxyRoute route = findRouteByAppId(appId);
        if (route == null) {
            return ActionResult.ofFailure("No route found for app_id: " + appId);
        }
        route.setSsoEnabled(true);
        route.setSsoScope(ssoScope);
        route.setSsoMode(ssoMode);

        return ActionResult.ofSuccess(Map.of(
            "app_id",      appId,
            "sso_enabled", true,
            "sso_mode",    ssoMode,
            "sso_scope",   ssoScope,
            "status",      "sso_enabled"
        ));
    } catch (Exception e) {
        return ActionResult.ofFailure("Failed to enable SSO: " + e.getMessage());
    }
}
```

Et dans `SsoFilter.checkGate()` la logique côté requête (flux nominal) :

```java
private boolean checkGate(HttpServletRequest request, HttpServletResponse response, ProxyRoute route)
        throws IOException {

    // 0. Court-circuit API key (X-Api-Key bypass)
    Map<String, String> apiKeyAuth = validateApiKey(request);
    if (apiKeyAuth != null) {
        request.setAttribute("auth.user_id", apiKeyAuth.get("user_id"));
        request.setAttribute("auth.email",   apiKeyAuth.get("email"));
        return true;
    }

    String gateCookieName = "sso_gate_" + route.getAppId();

    // 1. Cookie gate déjà présent et valide ? → on laisse passer
    String gateCookieValue = extractCookie(request, gateCookieName);
    if (gateCookieValue != null && isGateCookieValid(gateCookieValue)) {
        return true;
    }

    // 2. Sinon, on cherche un soclehub_token (Bearer ou cookie)
    String token = extractBearerToken(request);
    if (token == null || token.isBlank()) token = extractCookie(request, "soclehub_token");
    if (token == null || token.isBlank()) {
        redirectToLogin(request, response);
        return false;
    }

    Map<String, Object> claims = iamService.validateToken(token);
    if (claims == null || claims.isEmpty()) {
        redirectToLogin(request, response);
        return false;
    }

    // 3. Si la route impose un scope, on le vérifie
    String requiredScope = route.getSsoScope();
    if (requiredScope != null && !requiredScope.isBlank()) {
        List<String> tokenScopes = extractScopes(claims.get("scopes"));
        if (!tokenScopes.contains(requiredScope) && !tokenScopes.contains("admin")) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.getWriter().write("403 Forbidden - Insufficient scope");
            return false;
        }
    }

    // 4. Tout OK → on pose le mini-cookie HMAC propre à cette app et on relâche
    String userId = claims.get("sub") != null ? claims.get("sub").toString() : "unknown";
    setGateCookie(response, gateCookieName, userId, route.getHostname());
    return true;
}
```

**Points clés :**

- Le mini-cookie `sso_gate_<app>` est `userId|timestamp|HMAC(userId|timestamp)`. La clé HMAC dérive du SHA-256 de la clé privée RSA en mémoire (méthode `IamService.deriveHmacKey()`). Un attaquant ne peut donc pas forger un cookie sans accéder à la JVM.
- TTL 15 min : passé ce délai, l'utilisateur sera revérifié contre le `soclehub_token` (qui dure 15 min lui aussi par défaut, mais peut être renouvelé via `/auth/refresh`).
- Le cookie est posé sur **l'hostname exact** de l'app (`Domain=pgadmin.thesocle.net`), pas sur `.thesocle.net`. Il ne fuite donc pas vers les autres apps.

---

## 6. Étape 4 — Activer le SSO mode `required` sur app1

Cette app est codée par votre équipe et fait confiance au header `X-SSO-User` que SocleHub injecte. C'est le pattern le plus sécurisé pour des apps internes.

```bash
curl -sS -X POST http://localhost:8080/api/actions/proxy_worker/enable_sso \
  -H "Content-Type: application/json" \
  -d '{
        "app_id":   "app1",
        "sso_mode": "required",
        "sso_scope": "user"
      }'
```

Côté `SsoFilter.checkStandard()`, le mode `required` :

1. Cherche un `Authorization: Bearer <token>` ou un cookie `soclehub_token`.
2. Sans token → redirige vers `/hub/login?redirect=<url-courante>`.
3. Avec token invalide/expiré → idem.
4. Avec token valide → vérifie le scope (si `sso_scope` est positionné), stocke les claims dans `request.setAttribute("sso.claims", claims)`.

Plus loin, `DynamicProxyFilter` lit `sso.claims` et ajoute les headers à la requête upstream :

```java
// Extrait DynamicProxyFilter (~ligne 260)
Object ssoClaimsAttr = request.getAttribute("sso.claims");
if (ssoClaimsAttr instanceof Map<?, ?> claims) {
    Object sub = claims.get("sub");
    if (sub != null) {
        upstreamBuilder.header("X-SSO-User", sub.toString());
    }
    Object email = claims.get("email");
    if (email != null) upstreamBuilder.header("X-SSO-Email", email.toString());
    Object tenant = claims.get("tenant");
    if (tenant != null) upstreamBuilder.header("X-SSO-Tenant", tenant.toString());
}

// Fallback : si l'auth s'est faite par API key, on a stocké auth.user_id
Object authUserId = request.getAttribute("auth.user_id");
if (authUserId != null) upstreamBuilder.header("X-SSO-User", authUserId.toString());
```

Donc l'app upstream reçoit, pour un user authentifié :

```
GET /api/me HTTP/1.1
Host: app1-container:8080
X-Forwarded-For: 1.2.3.4
X-Forwarded-Proto: https
X-SSO-User: 42
X-SSO-Email: alice@thesocle.net
X-SSO-Tenant: thesocle
Cookie: soclehub_token=... (mode required, le cookie est passé)
```

**Important :** l'app **ne doit jamais** faire confiance à `X-SSO-User` si elle est exposée en direct sans passer par le proxy SocleHub — c'est une convention de confiance basée sur la topologie réseau (le réseau Docker `soclehub_default` est isolé).

---

## 7. Étape 5 — Tester le flux complet de bout en bout

### 7.1 Premier accès non authentifié à app1

```bash
# Browser éphémère, pas de cookie
curl -sS -i -L --max-redirs 0 https://app1.thesocle.net/

# Réponse attendue :
# HTTP/1.1 302 Found
# Location: https://hub.thesocle.net/hub/login?redirect=https%3A%2F%2Fapp1.thesocle.net%2F
```

### 7.2 Login + réception du cookie SSO

```bash
# 1. Login REST → on récupère le accessToken
TOKEN=$(curl -sS -X POST https://hub.thesocle.net/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@thesocle.net","password":"Tr0ub4dor&3-ChangeMe!"}' \
  | jq -r .accessToken)

# 2. Appeler le sso-callback pour poser le cookie sur .thesocle.net
curl -sS -i -c /tmp/sso.txt \
  "https://hub.thesocle.net/sso-callback?token=${TOKEN}&redirect=/hub"

# Vérifier le cookie posé
cat /tmp/sso.txt | grep soclehub_token
# # HttpOnly_.thesocle.net  TRUE  /  TRUE  <expiry>  soclehub_token  eyJhbGciOiJSUzI1NiIs...
```

### 7.3 Naviguer sur app1 avec le cookie

```bash
curl -sS -b /tmp/sso.txt -i https://app1.thesocle.net/api/me

# Réponse attendue :
# HTTP/1.1 200 OK
# Content-Type: application/json
#
# {"user_id":"42","email":"alice@thesocle.net","tenant":"thesocle"}
#
# (l'app a lu X-SSO-User et a renvoyé son propre userInfo)
```

### 7.4 Naviguer sur pgAdmin (mode gate)

```bash
# Premier accès : on a le cookie soclehub_token, pas encore de gate cookie
curl -sS -b /tmp/sso.txt -c /tmp/sso.txt -i https://pgadmin.thesocle.net/login

# La réponse pose un Set-Cookie: sso_gate_pgadmin=...
# Et laisse passer la requête vers pgAdmin qui affiche son propre formulaire de login DB.

# Deuxième accès : pas besoin de revérifier
curl -sS -b /tmp/sso.txt -i https://pgadmin.thesocle.net/login
# → 200 direct, sans coût de validation JWT
```

### 7.5 Vérifier la révocation

```bash
# Logout : invalide la session côté SocleHub
curl -sS -X POST https://hub.thesocle.net/auth/logout \
  -H "Authorization: Bearer ${TOKEN}"

# La table iam.tr_token_blacklist est mise à jour mais le JWT reste valide
# techniquement jusqu'à son exp (le mécanisme actuel ne lit pas la blacklist
# côté SsoFilter — voir Piège 9).
```

---

## 8. Étape 6 — Restreindre par chemin (`sso_protected_paths`)

Pour les apps comme WordPress où le frontend public est ouvert mais `/wp-admin` exige un login, on combine `sso_mode=gate` avec `sso_protected_paths`.

```bash
curl -sS -X POST http://localhost:8080/api/actions/proxy_worker/update_route \
  -H "Content-Type: application/json" \
  -d '{
        "app_id": "wordpress",
        "sso_mode": "gate",
        "sso_protected_paths": "/wp-admin,/wp-login.php"
      }'
```

Dans `SsoFilter.checkGate()` :

```java
String protectedPaths = route.getSsoProtectedPaths();
if (protectedPaths != null && !protectedPaths.isBlank()) {
    String requestPath = request.getRequestURI();
    boolean isProtected = false;
    for (String prefix : protectedPaths.split(",")) {
        prefix = prefix.trim();
        if (!prefix.isEmpty() && requestPath.startsWith(prefix)) {
            isProtected = true; break;
        }
    }
    if (!isProtected) return true; // Path public → on laisse passer sans auth
}
```

---

## 9. Validation

### 9.1 Vérifier la route en base

```sql
SELECT app_id, hostname, target_host, target_port,
       sso_enabled, sso_mode, sso_scope, sso_protected_paths
FROM apps.proxy_routes
ORDER BY app_id;
```

### 9.2 Tester chaque mode avec curl

```bash
# Mode "none" : tout le monde passe
curl -o /dev/null -w "%{http_code}\n" https://blog.thesocle.net/    # 200

# Mode "optional" sans cookie : passe en anonyme
curl -o /dev/null -w "%{http_code}\n" https://wordpress.thesocle.net/   # 200

# Mode "optional" avec cookie : passe avec X-SSO-User
curl -o /dev/null -w "%{http_code}\n" -b /tmp/sso.txt https://wordpress.thesocle.net/   # 200

# Mode "gate" sans cookie : redirect login
curl -o /dev/null -w "%{http_code}\n" --max-redirs 0 https://pgadmin.thesocle.net/   # 302

# Mode "required" sans cookie : redirect login
curl -o /dev/null -w "%{http_code}\n" --max-redirs 0 https://app1.thesocle.net/   # 302

# Mode "required" avec cookie : 200
curl -o /dev/null -w "%{http_code}\n" -b /tmp/sso.txt https://app1.thesocle.net/   # 200
```

### 9.3 Inspecter les headers reçus côté upstream

Pour debugger ce que l'app voit, ajouter temporairement un endpoint mock côté app :

```bash
# Container app1 : exposer un endpoint /headers qui dump tout
curl -sS -b /tmp/sso.txt https://app1.thesocle.net/headers | jq
# {
#   "host": "app1-container:8080",
#   "x-forwarded-for": "1.2.3.4",
#   "x-forwarded-proto": "https",
#   "x-sso-user": "42",
#   "x-sso-email": "alice@thesocle.net",
#   "x-sso-tenant": "thesocle"
# }
```

### 9.4 Logs

```bash
docker logs soclehub --since 5m | grep -E "SSO|gate|sso_gate"
```

---

## 10. Pièges courants

### Piège 1 — Le cookie `soclehub_token` n'est pas partagé entre sous-domaines

**Cause :** Le cookie est posé sur le mauvais Domain. Si `SOCLEHUB_DOMAIN=hub.thesocle.net` et que `cloudflare.defaultZone` n'est pas défini, le cookie est posé sur `.hub.thesocle.net` au lieu de `.thesocle.net`.
**Résolution :** Forcer `SOCLEHUB_CLOUDFLARE_DEFAULT_ZONE=thesocle.net` dans `.env`. Le cookie doit absolument avoir `Domain=.thesocle.net` (point initial) pour être visible des sous-domaines.

```bash
# Vérifier
curl -sI https://hub.thesocle.net/sso-callback?token=$TOKEN | grep -i set-cookie
# Set-Cookie: soclehub_token=...; Path=/; Domain=.thesocle.net; HttpOnly; Secure
```

### Piège 2 — `403 Forbidden - Insufficient scope`

**Cause :** La route a `sso_scope=admin` mais l'utilisateur n'a pas ce scope (ni le scope `admin` qui agit comme super-scope).
**Résolution :** Soit assouplir le scope (`sso_scope=user`), soit assigner le scope manquant via `assign_scope_to_role`.

### Piège 3 — pgAdmin renvoie 401 même avec mode `gate`

**Cause :** Le filtre `gate` filtre les cookies inconnus avant de relayer la requête, mais certaines versions de pgAdmin valident **strictement** le header `Origin` et `Referer`. Si la requête vient de hub.thesocle.net (après redirect), `Origin` pointe vers le hub — pgAdmin refuse.
**Résolution :** Configurer pgAdmin pour accepter `Origin: https://pgadmin.thesocle.net` (variable `PGADMIN_CONFIG_X_FRAME_OPTIONS=ALLOWALL` n'est PAS la bonne solution — utiliser `PGADMIN_CONFIG_WTF_CSRF_ENABLED=False` en dev seulement).

### Piège 4 — Boucle de redirection `/hub/login → /sso-callback → /hub/login`

**Cause :** Le `sso-callback` reçoit un token invalide (sig RSA différente après redémarrage du Hub) → le cookie posé est rejeté à la première requête → re-redirect.
**Résolution :** Re-loginner pour obtenir un token fraîchement signé. À terme, persister la paire RSA dans Vault.

### Piège 5 — `X-SSO-User` est vide alors que l'utilisateur est connecté

**Cause :** Le mode est `gate` (qui n'injecte **pas** `X-SSO-User`, c'est volontaire). Confondre `gate` et `required`.
**Résolution :** Si l'app upstream a besoin de connaître l'utilisateur via `X-SSO-User`, utiliser `required`. `gate` est uniquement un contrôle d'accès, pas une injection d'identité.

### Piège 6 — Le cookie `sso_gate_<app>` reste valide après un logout

**Cause :** Le cookie gate est HMAC-signé avec un timestamp et a une TTL de 15 min. Le logout sur le hub n'invalide PAS ces cookies (chaque app garde son propre).
**Résolution :** Côté app, exposer un bouton "Logout" qui appelle `/sso-logout-gate` (à implémenter) qui efface le cookie via `Set-Cookie: sso_gate_<app>=; Max-Age=0`. Ou attendre 15 min.

### Piège 7 — `sso_protected_paths` ne fonctionne pas

**Cause :** Le chemin spécifié n'est pas exact ou utilise des wildcards. Le code fait du `requestPath.startsWith(prefix)`, donc `/wp-admin/*` doit s'écrire `/wp-admin` (pas de wildcard).
**Résolution :** Liste séparée par virgules, chaque entrée est un préfixe. Exemple : `/wp-admin,/wp-login.php,/api/private`.

### Piège 8 — L'API key `X-Api-Key` ne court-circuite pas le mode `required`

**Cause :** Le filtre vérifie l'API key en tout premier (`SsoFilter.checkStandard()` ligne 0), mais il faut que la clé soit valide et non révoquée. Une clé mal copiée ou expirée ne bypass pas.
**Résolution :** Tester d'abord la clé avec `list_api_keys` puis vérifier l'absence d'espace ou de retour à la ligne dans le header.

### Piège 9 — Le logout invalide la session mais le JWT reste utilisable jusqu'à expiration

**Cause :** `SsoFilter` ne lit **pas** la table `iam.tr_token_blacklist` actuellement (pour des raisons de perfs). Un JWT révoqué reste valide jusqu'à `exp` (15 min par défaut).
**Résolution acceptée :** TTL court (15 min) + révocation au prochain refresh. Pour des révocations immédiates, baisser le TTL à 60s ou implémenter la consultation de la blacklist dans `SsoFilter` (impact perf à évaluer).

### Piège 10 — `Cookie: soclehub_token=...` est envoyé à l'upstream en mode `gate` alors qu'on ne le veut pas

**Cause :** Le filtre ne supprime pas le cookie de la requête `Cookie:` header — il se contente de ne pas exposer le `soclehub_token` via headers SSO. Le cookie passe naturellement à l'upstream.
**Résolution :** Pour un strip complet, modifier `DynamicProxyFilter` qui réécrit le header `Cookie:` en filtrant les cookies dont le nom est dans une blacklist (`soclehub_token`, `XSRF-TOKEN`, etc.). Cette logique est en cours d'ajout dans la roadmap V7.

### Piège 11 — Mode `optional` avec scope défini : l'anonyme passe alors qu'on s'attendait à un 403

**Cause :** En mode `optional`, le scope n'est vérifié **que si un token est présent**. Sans token, on passe en anonyme.
**Résolution :** Si l'on veut "anonyme accepté SAUF si token sans le bon scope", c'est OK avec `optional`. Si l'on veut "soit anonyme soit le bon scope", c'est exactement ça. Si l'on veut "obligatoire et avec scope", utiliser `required`.

### Piège 12 — Le cookie n'est pas envoyé en HTTP local (dev sans HTTPS)

**Cause :** L'attribut `Secure` est positionné sur le cookie. Les navigateurs refusent d'envoyer un cookie `Secure` sur HTTP.
**Résolution :** En dev, retirer `Secure` du `cookieHeader` (variable d'env `SOCLEHUB_DEV_INSECURE_COOKIES=true` à implémenter), ou utiliser `mkcert` pour générer un cert local et tourner en HTTPS.

---

## 11. Pour aller plus loin

- Voir [[71-sso-oidc]] pour la spécification complète des 4 modes SSO et la matrice de décision.
- Voir [[70-securite-filtres]] pour la chaîne complète `SsoFilter` → `DynamicProxyFilter` → `RateLimitFilter`.
- Voir [[43-proxy-worker]] pour la référence du `proxy_worker` (`add_route`, `enable_sso`, `update_route`, table `apps.proxy_routes`).
- Voir [[72-api-keys-jwt]] pour le bypass `X-Api-Key` et les bonnes pratiques JWT.
- Voir `howto-08-creer-utilisateur-iam.md` pour la création des users et des scopes consommés ici.
- Voir `howto-10-configurer-oidc-provider.md` pour exposer SocleHub en tant qu'**OIDC Provider** vers des apps externes (au-delà de `*.thesocle.net`).
