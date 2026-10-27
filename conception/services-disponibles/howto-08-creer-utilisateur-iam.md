# HOWTO 08 — Créer un utilisateur IAM, lui assigner un rôle et générer une API key

**Niveau :** Junior
**Prérequis :** SocleHub démarré, PostgreSQL `iam` schema migré (V1), accès admin REST `/api/actions/iam_worker/*` ou IHM `/hub/iam/users`
**Temps estimé :** 15 minutes

---

## 1. Contexte

Dans SocleHub, l'identité d'un utilisateur est gérée par le [[10-iam-worker|`iam_worker`]] qui persiste tout dans le schéma PostgreSQL `iam` (tables `iam.db_users`, `iam.db_roles`, `iam.db_scopes`, `iam.tr_user_roles`, `iam.tr_role_scopes`, `iam.tr_api_keys`, `iam.tr_sessions`, `iam.tr_token_blacklist`). La clé primaire `x_id` de ces tables est un **BIGINT auto-incrémenté** (migration UUID→BIGINT) : les `user_id`, `role_id`, `key_id` manipulés par les actions sont donc des entiers (ex. `42`), **pas** des UUID. Les mots de passe sont **toujours** hashés en BCrypt (`IamService.hashPassword()`), jamais stockés en clair. Les API keys, elles, restent des UUID v4 (`X-Api-Key`) dont seul le hash SHA-256 est persisté en base — le secret en clair n'est retourné **qu'une seule fois** à la création. La gestion des tenants (`iam.db_tenants`) est décrite dans [[13-iam-tenant-management]].

Vous devez ajouter un nouveau collaborateur (par exemple `alice@thesocle.net`) qui doit :

- Pouvoir se connecter via le formulaire `/hub/login` ou l'API REST `POST /auth/login` pour obtenir un JWT RS256.
- Disposer du rôle `admin` (qui inclut le scope `admin` permettant d'accéder à toutes les apps SSO).
- Disposer d'une API key `X-Api-Key` valable 365 jours pour ses scripts CI/CD, qui contourne le SSO via les filtres `SsoFilter.validateApiKey()` et `DynamicProxyFilter`.
- Pouvoir être supprimé proprement (cascade sur `user_roles`, `api_keys`, `sessions`).

Toute la chaîne — création du user, hash BCrypt, assignation du rôle, génération de l'API key, persistence de la session lors du login — doit être idempotente (rejouable sans erreur) et auditée dans les logs structurés `[worker:iam_worker][step:...]`.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SocleHub                                   │
│                                                                     │
│  ┌──────────────┐   create_user    ┌──────────────┐                 │
│  │  Operator    │ ───────────────► │  iam_worker  │                 │
│  │ (CLI / IHM)  │                  │ (Worker MOP) │                 │
│  └──────────────┘                  └──────┬───────┘                 │
│                                           │                         │
│                                           │ JDBC                    │
│                                           ▼                         │
│                                    ┌──────────────┐                 │
│                                    │ PostgreSQL   │                 │
│                                    │   schema iam │                 │
│                                    │  - db_users  │                 │
│                                    │  - db_roles  │                 │
│                                    │  - tr_api_keys│                │
│                                    │  - tr_sessions│                │
│                                    └──────────────┘                 │
│                                           ▲                         │
│  ┌──────────────┐  POST /auth/login       │                         │
│  │ Browser/curl │ ────────────────────────┘                         │
│  └──────────────┘  (BCrypt match → JWT RS256 + session row)         │
│                                                                     │
│  ┌──────────────┐  X-Api-Key header                                 │
│  │  CI / Script │ ─────────► SsoFilter.validateApiKey()             │
│  └──────────────┘             SHA-256(apiKey) → iam.tr_api_keys lookup │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Créer le rôle et le scope

Avant de créer l'utilisateur, il faut s'assurer que le rôle `admin` existe et qu'il porte le scope `admin`. Les actions sont idempotentes (`ON CONFLICT (name) DO NOTHING`).

```bash
# 1.1 Créer le rôle admin
curl -sS -X POST http://localhost:8080/api/actions/iam_worker/create_role \
  -H "Content-Type: application/json" \
  -d '{
        "name": "admin",
        "description": "Accès administrateur global"
      }'

# Réponse attendue :
# {"success":true,"data":{"role_id":1,"role_name":"admin","status":"created"}}

# 1.2 Le scope "admin" est créé par la migration V1 (table iam.db_scopes seedée).
#     On l'attache au rôle :
curl -sS -X POST http://localhost:8080/api/actions/iam_worker/assign_scope_to_role \
  -H "Content-Type: application/json" \
  -d '{
        "role_name": "admin",
        "scope_name": "admin"
      }'

# Réponse attendue :
# {"success":true,"data":{"role_name":"admin","scope_name":"admin","status":"assigned"}}
```

**Points clés :**

- `create_role` est idempotent (clé unique sur `iam.db_roles.name`). Un second appel renvoie `status: exists`.
- Les scopes prédéfinis seedés par la migration sont `admin`, `read:users`, `write:users`, `read:apps`, `write:apps`, `read:billing`. Ajouter un nouveau scope passe par `INSERT INTO iam.db_scopes (name, description) VALUES (...)` côté migration — il n'y a volontairement pas d'action `create_scope` pour préserver le contrat de sécurité.
- Le scope `admin` est traité comme un super-scope par `SsoFilter.checkStandard()` : un user qui le possède passe toutes les vérifications de scope SSO.

---

## 4. Étape 2 — Créer l'utilisateur (action `iam_worker/create_user`)

Le mot de passe est passé en clair sur le wire (HTTPS obligatoire en prod) et est **immédiatement** transformé en hash BCrypt par `IamService.hashPassword()` avant l'INSERT. La PK `x_id` est un BIGINT généré par PostgreSQL (`GENERATED ... AS IDENTITY`) et récupéré via `RETURNING x_id`.

```bash
curl -sS -X POST http://localhost:8080/api/actions/iam_worker/create_user \
  -H "Content-Type: application/json" \
  -d '{
        "email": "alice@thesocle.net",
        "password": "Tr0ub4dor&3-ChangeMe!",
        "first_name": "Alice",
        "last_name": "Martin",
        "tenant_id": "thesocle"
      }'

# Réponse attendue (user_id = BIGINT rendu en chaîne) :
# {
#   "success": true,
#   "data": {
#     "user_id": "42",
#     "email":   "alice@thesocle.net",
#     "first_name": "Alice",
#     "last_name":  "Martin",
#     "tenant_id":  "thesocle",
#     "status":     "created"
#   }
# }
```

Le code exécuté côté Java (extrait de `IamWorker.handleCreateUser()`) :

```java
package eu.lmvi.soclehub.worker;

// ... imports complets dans le fichier source

private ActionResult handleCreateUser(ActionParameters params) {
    String email     = params.getString("email");
    String password  = params.getString("password");
    String firstName = params.getString("first_name");
    String lastName  = params.getString("last_name");
    String tenantId  = params.getString("tenant_id");

    String sql = """
        INSERT INTO iam.db_users (email, password_hash, first_name, last_name, tenant_id, locked)
        VALUES (?, ?, ?, ?, ?, false)
        RETURNING x_id
        """;

    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {

        String hashedPassword = iamService.hashPassword(password); // BCrypt

        ps.setString(1, email);
        ps.setString(2, hashedPassword);
        ps.setString(3, firstName);
        ps.setString(4, lastName);
        ps.setString(5, tenantId);

        long userId;
        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return ActionResult.ofFailure("Failed to create user: no x_id returned");
            }
            userId = rs.getLong("x_id");   // BIGINT généré par PostgreSQL
        }

        return ActionResult.ofSuccess(Map.of(
            "user_id",    String.valueOf(userId),
            "email",      email,
            "first_name", firstName != null ? firstName : "",
            "last_name",  lastName  != null ? lastName  : "",
            "tenant_id",  tenantId  != null ? tenantId  : "",
            "status",     "created"
        ));
    } catch (SQLException e) {
        return ActionResult.ofFailure("Failed to create user: " + e.getMessage());
    }
}
```

**Points clés :**

- BCrypt utilise un sel aléatoire intégré dans le hash. Deux users avec le même mot de passe auront deux hashes différents.
- `tenant_id` est facultatif mais recommandé en multi-tenant : il est repris dans le claim JWT `tenant` pour filtrer les ressources côté apps métier.
- `locked = false` par défaut. L'action `lock_user` permet de désactiver un compte sans le supprimer (mode "tombstone").
- En cas de licence restreinte (`KeyRegistry.assertNotRestricted()`), la création d'utilisateur est bloquée et renvoie `License restricted`.

---

## 5. Étape 3 — Assigner le rôle à l'utilisateur

L'action `assign_role` résout le rôle par son nom puis insère dans `iam.tr_user_roles` avec `ON CONFLICT DO NOTHING` (idempotent).

```bash
USER_ID="42"  # extrait de l'étape précédente

curl -sS -X POST http://localhost:8080/api/actions/iam_worker/assign_role \
  -H "Content-Type: application/json" \
  -d "{
        \"user_id\": \"${USER_ID}\",
        \"role_name\": \"admin\"
      }"

# Réponse attendue :
# {"success":true,"data":{"user_id":"9c4f...","role_name":"admin","status":"assigned"}}
```

À ce stade, vérifier l'état complet de l'utilisateur :

```bash
curl -sS -X POST http://localhost:8080/api/actions/iam_worker/get_user \
  -H "Content-Type: application/json" \
  -d "{\"user_id\": \"${USER_ID}\"}"

# Réponse :
# {
#   "success": true,
#   "data": {
#     "user_id":    "42",
#     "created_at": "2026-04-28T14:12:33Z",
#     "email":      "alice@thesocle.net",
#     "first_name": "Alice",
#     "last_name":  "Martin",
#     "tenant_id":  "thesocle",
#     "locked":     false,
#     "roles":      ["admin"],
#     "scopes":     ["admin"]
#   }
# }
```

**Points clés :**

- `get_user` fait 3 requêtes : la fiche user, les rôles via `user_roles JOIN roles`, et les scopes effectifs via `user_roles JOIN role_scopes JOIN scopes`.
- Pour donner accès à une app spécifique sans rôle global, utilisez `grant_app_access` qui crée à la volée le rôle `app:{app_id}:{role_name}` (cf. [[10-iam-worker]]). Pour rattacher l'utilisateur à un tenant, voir `grant_tenant_access` / `create_tenant` dans [[13-iam-tenant-management]].

---

## 6. Étape 4 — Générer une API key (action `create_api_key`)

L'API key est un UUID v4 généré par `UUID.randomUUID().toString()`. Seul son hash SHA-256 (64 caractères hex) est persisté dans `iam.tr_api_keys.key_hash`. La valeur en clair est retournée **une seule fois** dans la réponse — il faut la stocker côté client immédiatement.

```bash
curl -sS -X POST http://localhost:8080/api/actions/iam_worker/create_api_key \
  -H "Content-Type: application/json" \
  -d "{
        \"user_id\": \"${USER_ID}\",
        \"key_name\": \"alice-ci-cd\",
        \"expires_in_days\": 365
      }"

# Réponse :
# {
#   "success": true,
#   "data": {
#     "key_id":   7,
#     "api_key":  "8e3b5d7a-2c4f-4f1a-9b6e-d4f2c1a7e9b3",
#     "key_name": "alice-ci-cd",
#     "user_id":  "42",
#     "expires_at": "2027-04-28T14:15:00Z",
#     "status":   "created",
#     "warning":  "Store this API key securely — it will not be shown again"
#   }
# }
```

Code Java correspondant (extrait de `IamWorker.handleCreateApiKey()`) :

```java
private ActionResult handleCreateApiKey(ActionParameters params) {
    String userId  = params.getString("user_id");
    String keyName = params.getString("key_name");

    int expiresInDays = 365;
    String expiresInDaysStr = params.getString("expires_in_days");
    if (expiresInDaysStr != null && !expiresInDaysStr.isBlank()) {
        expiresInDays = Integer.parseInt(expiresInDaysStr);
    }

    String sql = """
        INSERT INTO iam.tr_api_keys (id_users, key_name, key_hash, expires_at, revoked)
        VALUES (?, ?, ?, ?, false)
        RETURNING x_id
        """;

    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {

        String rawKey  = UUID.randomUUID().toString();   // SECRET — montré une seule fois
        String keyHash = sha256Hex(rawKey);              // ce qui est stocké en base

        Timestamp expiresAt = expiresInDays > 0
                ? Timestamp.from(Instant.now().plus(expiresInDays, ChronoUnit.DAYS))
                : null;

        ps.setLong(1, Long.parseLong(userId));   // id_users = BIGINT
        ps.setString(2, keyName);
        ps.setString(3, keyHash);
        if (expiresAt != null) ps.setTimestamp(4, expiresAt);
        else                   ps.setNull(4, java.sql.Types.TIMESTAMP);

        long keyId;
        try (ResultSet rs = ps.executeQuery()) {
            rs.next();
            keyId = rs.getLong("x_id");          // key_id = BIGINT
        }

        Map<String, Object> data = new HashMap<>();
        data.put("key_id",    keyId);
        data.put("api_key",   rawKey);              // clé claire — à stocker côté client
        data.put("key_name",  keyName);
        data.put("user_id",   userId);
        data.put("expires_at", expiresAt != null ? expiresAt.toInstant().toString() : null);
        data.put("status",    "created");
        data.put("warning",   "Store this API key securely — it will not be shown again");
        return ActionResult.ofSuccess(data);
    } catch (SQLException e) {
        return ActionResult.ofFailure("Failed to create API key: " + e.getMessage());
    }
}

private static String sha256Hex(String input) {
    try {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(64);
        for (byte b : hash) hex.append(String.format("%02x", b));
        return hex.toString();
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException("SHA-256 not available", e);
    }
}
```

**Points clés :**

- `expires_in_days <= 0` → la colonne `expires_at` est mise à NULL (clé sans expiration). À éviter en production.
- Le format UUID est **volontairement** non-opaque pour permettre la révocation par préfixe humainement lisible. Les versions futures pourront passer à un format `sk_live_xxx...` à 256 bits si besoin (la table garde le hash SHA-256 dans tous les cas).
- La fenêtre entre la création et la première utilisation doit être courte : le hash SHA-256 d'un UUID brute-force est résistant, mais une fuite de la clé en clair (logs, screenshot, copier-coller) est catastrophique.

---

## 7. Étape 5 — Tester le login (form HTML et REST API)

### 7.1 Login via formulaire `/hub/login`

```bash
# 1) Récupérer le formulaire (établit un cookie CSRF si activé)
curl -sS -c /tmp/cookie.txt http://localhost:8080/hub/login > /dev/null

# 2) Soumettre le form (Spring Security par défaut → POST /hub/login)
curl -sS -b /tmp/cookie.txt -c /tmp/cookie.txt -i \
  -X POST http://localhost:8080/hub/login \
  -d "email=alice@thesocle.net&password=Tr0ub4dor%263-ChangeMe%21"

# Réponse attendue :
# HTTP/1.1 302 Found
# Location: /hub
# Set-Cookie: soclehub_token=eyJhbGciOiJSUzI1NiIs...; Domain=.thesocle.net; HttpOnly; Secure
```

### 7.2 Login via REST `POST /auth/login`

```bash
curl -sS -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{
        "email": "alice@thesocle.net",
        "password": "Tr0ub4dor&3-ChangeMe!"
      }'

# Réponse :
# {
#   "accessToken":  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9....",
#   "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9....",
#   "expiresIn":    900,
#   "refreshExpiresIn": 604800
# }
```

Le contrôleur `AuthController.login()` :

1. SELECT `iam.db_users WHERE email = ?` → récupère `password_hash`, `locked`, claims user.
2. `iamService.checkPassword(rawPassword, hash)` → BCrypt match.
3. SELECT scopes via JOIN `user_roles → role_scopes → scopes`.
4. `iamService.generateAccessToken()` (TTL 900s par défaut) + `generateRefreshToken()` (TTL 7j ou 30j si `device=mobile`).
5. INSERT dans `iam.tr_sessions` avec le JTI du refresh token.

### 7.3 Décoder et vérifier le JWT

```bash
ACCESS=$(curl -sS -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@thesocle.net","password":"Tr0ub4dor&3-ChangeMe!"}' \
  | jq -r .accessToken)

# Décoder le payload (sans vérification de signature, juste pour inspecter)
echo "$ACCESS" | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# Champs attendus :
# {
#   "jti":        "...",
#   "sub":        "42",
#   "iss":        "soclehub",
#   "aud":        ["soclehub-apps"],
#   "iat":        1714300000,
#   "exp":        1714300900,
#   "email":      "alice@thesocle.net",
#   "first_name": "Alice",
#   "last_name":  "Martin",
#   "scopes":     ["admin"],
#   "tenant":     "thesocle",
#   "token_type": "access"
# }
```

---

## 8. Étape 6 — Tester l'API key via `X-Api-Key`

L'API key est validée par `SsoFilter.validateApiKey()` côté proxy (voir la chaîne de filtres dans [[70-securite-filtres]] et les bonnes pratiques dans [[72-api-keys-jwt]]) : SHA-256(clé reçue) puis lookup dans `iam.tr_api_keys` (sur `key_hash`, `revoked = false`, `expires_at` valide).

```bash
API_KEY="8e3b5d7a-2c4f-4f1a-9b6e-d4f2c1a7e9b3"

# Appeler une route SSO-protégée avec l'API key au lieu d'un cookie
curl -sS -i \
  -H "X-Api-Key: ${API_KEY}" \
  https://app1.thesocle.net/api/me

# Réponse attendue (l'app upstream reçoit X-SSO-User: <userId> injecté par DynamicProxyFilter)
```

Côté SocleHub, ce qui se passe (extrait `SsoFilter.validateApiKey()`) :

```java
private static final String API_KEY_LOOKUP_SQL = """
        SELECT k.x_id, k.id_users, k.revoked, k.expires_at, u.email
        FROM iam.tr_api_keys k
        JOIN iam.db_users u ON u.x_id = k.id_users
        WHERE k.key_hash = ? AND k.revoked = false
        """;

private Map<String, String> validateApiKey(HttpServletRequest request) {
    String apiKey = request.getHeader("X-Api-Key");
    if (apiKey == null || apiKey.isBlank()) return null;

    String keyHash = sha256Hex(apiKey);  // SHA-256 hex 64 chars
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(API_KEY_LOOKUP_SQL)) {
        ps.setString(1, keyHash);
        try (ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                Timestamp expiresAt = rs.getTimestamp("expires_at");
                if (expiresAt == null || expiresAt.toInstant().isAfter(Instant.now())) {
                    return Map.of(
                        "user_id", rs.getString("id_users"),
                        "email",   rs.getString("email")
                    );
                }
            }
        }
    } catch (Exception e) {
        log.debug("API key validation error: {}", e.getMessage());
    }
    return null;
}
```

Si la clé est valide :

- `request.setAttribute("auth.user_id", userId)` — repris par `DynamicProxyFilter` qui ajoute `X-SSO-User: <userId>` à la requête vers l'upstream.
- Aucun cookie n'est posé.
- Aucun JWT n'est généré (économie de CPU, pas de session DB créée).

---

## 9. Validation

### 9.1 Vérifier que tout est en base

```bash
# Connexion psql au container SocleHub
docker exec -it soclehub-postgres psql -U socle_prod -d socle_prod
```

```sql
-- L'utilisateur existe et a le bon hash BCrypt (60 chars commençant par $2a$ ou $2b$)
SELECT x_id, email, substring(password_hash from 1 for 7) AS hash_prefix,
       first_name, last_name, tenant_id, locked
FROM iam.db_users WHERE email = 'alice@thesocle.net';

-- Le rôle admin lui est assigné
SELECT u.email, r.name AS role_name
FROM iam.db_users u
JOIN iam.tr_user_roles ur ON ur.id_users = u.x_id
JOIN iam.db_roles r ON r.x_id = ur.id_roles
WHERE u.email = 'alice@thesocle.net';

-- Les scopes effectifs (via le rôle)
SELECT u.email, s.name AS scope_name
FROM iam.db_users u
JOIN iam.tr_user_roles ur ON ur.id_users = u.x_id
JOIN iam.tr_role_scopes rs ON rs.id_roles = ur.id_roles
JOIN iam.db_scopes s ON s.x_id = rs.id_scopes
WHERE u.email = 'alice@thesocle.net';

-- L'API key existe (mais le hash, pas la clé claire)
SELECT key_name, substring(key_hash from 1 for 16) AS hash_prefix,
       expires_at, revoked
FROM iam.tr_api_keys
WHERE id_users = (SELECT x_id FROM iam.db_users WHERE email = 'alice@thesocle.net');

-- Une session existe après le login REST
SELECT x_dateCreated, expires_at, substring(refresh_token from 1 for 8) AS jti_prefix
FROM iam.tr_sessions
WHERE id_users = (SELECT x_id FROM iam.db_users WHERE email = 'alice@thesocle.net')
ORDER BY x_dateCreated DESC LIMIT 5;
```

### 9.2 Tester l'API key sur une vraie route

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "X-Api-Key: ${API_KEY}" \
  https://app1.thesocle.net/api/me
# → 200

# Sans la clé, la même route SSO-required redirige vers le login
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://app1.thesocle.net/api/me
# → 302 (redirect vers /hub/login?redirect=...)
```

### 9.3 Révoquer la clé et vérifier

```bash
KEY_ID="7"  # depuis la création

curl -sS -X POST http://localhost:8080/api/actions/iam_worker/revoke_api_key \
  -H "Content-Type: application/json" \
  -d "{\"key_id\": \"${KEY_ID}\"}"

# Réessayer la requête : la clé doit être refusée car revoked = true
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "X-Api-Key: ${API_KEY}" \
  https://app1.thesocle.net/api/me
# → 302 (la clé n'est plus valide, fallback redirect login)
```

### 9.4 Logs structurés

```bash
docker logs soclehub --since 5m | grep -E '\[worker:iam_worker\]\[step:(create_user|create_api_key|assign_role)\]'
```

---

## 10. Pièges courants

### Piège 1 — `Failed to create user: duplicate key value violates unique constraint "users_email_key"`

**Cause :** L'email est en contrainte UNIQUE dans `iam.db_users`. Une seconde création avec le même email échoue.
**Résolution :** Soit utiliser un email différent, soit récupérer l'ID existant via `list_users` et continuer (`update_user` pour modifier).

```bash
# INCORRECT — relance brutale
curl -X POST .../create_user -d '{"email":"alice@thesocle.net",...}'  # 2e fois → 23505

# CORRECT — vérifier d'abord
curl -sS -X POST .../list_users | jq '.data.users[] | select(.email=="alice@thesocle.net")'
```

### Piège 2 — `For input string: "alice"` (ou autre `NumberFormatException`)

**Cause :** Toutes les actions IAM (sauf `create_user`, `list_users`, `create_role`) attendent un `user_id` au format **BIGINT** (la PK `x_id`, ex. `42`). Passer l'email à la place lève `Long.parseLong()` `NumberFormatException`.
**Résolution :** Utiliser `list_users` ou `get_user` avec un email connu pour récupérer l'`x_id` numérique, puis le passer aux actions suivantes.

### Piège 3 — Le user se connecte mais `scopes` est vide dans le JWT

**Cause :** Aucun rôle n'a été assigné OU le rôle assigné n'a pas de scope attaché. La requête JOIN `user_roles → role_scopes → scopes` renvoie 0 ligne.
**Résolution :** Exécuter `assign_scope_to_role` pour le rôle concerné. Vérifier avec la query SQL de la section 9.1 (3e bloc).

### Piège 4 — `Invalid credentials` malgré le bon mot de passe

**Cause :** BCrypt cost factor : si l'INSERT initial a stocké un hash factice (par exemple en seed), `checkPassword` renvoie false. Autre cause : l'utilisateur a été créé avec une version antérieure qui utilisait un autre encoder.
**Résolution :** Régénérer le hash via `update_user` n'est pas exposé pour le password. Faire un UPDATE direct :

```sql
UPDATE iam.db_users
SET password_hash = '$2a$10$...'  -- généré côté client par bcrypt
WHERE email = 'alice@thesocle.net';
```

Ou plus simple : `delete_user` puis `create_user`.

### Piège 5 — `Account is disabled` au login

**Cause :** Le flag `iam.db_users.locked = true`. Cela survient après un `lock_user` manuel ou après dépassement du nombre de tentatives échouées (si la politique de lock automatique est activée).
**Résolution :**

```sql
UPDATE iam.db_users SET locked = false, x_dateUpdated = now()
WHERE email = 'alice@thesocle.net';
```

### Piège 6 — L'API key est refusée alors qu'elle vient juste d'être créée

**Cause possible 1 :** La clé est passée avec un préfixe parasite (`Bearer 8e3b...` au lieu de juste `8e3b...`).
**Cause possible 2 :** Le header est mal écrit (`Api-Key`, `apikey`, `X-API-KEY`). Le filtre matche **exactement** `X-Api-Key` (case-insensitive niveau Servlet, mais préférer la casse exacte).
**Résolution :** Vérifier le header brut dans les logs `DynamicProxyFilter` :

```bash
docker logs soclehub --since 1m | grep -i "api.key\|X-Api-Key"
```

### Piège 7 — Le cookie `soclehub_token` n'est pas posé après le login form

**Cause :** Le navigateur rejette le cookie car `Domain=.thesocle.net` ne correspond pas au domaine d'accès (par exemple `localhost`). En dev, Spring Security fallback sur le hostname courant.
**Résolution :** Tester en local via `https://hub.thesocle.net.localhost` ou en désactivant l'attribut `Domain` dans `SsoCallbackController` pour les tests. En prod, la variable d'env `SOCLEHUB_DOMAIN=thesocle.net` doit être correcte.

### Piège 8 — `Token validation failed: JWT signature does not match`

**Cause :** Le pod SocleHub a redémarré → `IamService.generateKeyPair()` génère une nouvelle paire RSA en mémoire (pas de persistence Vault encore). Tous les tokens émis avant ce redémarrage sont invalides.
**Résolution :** Re-loginner les users. À terme : persister la paire RSA dans Vault (`soclehub/iam/keypair`) et la recharger au boot.

### Piège 9 — `revoke_api_key` retourne `success` mais la clé fonctionne toujours

**Cause :** Le filtre `SsoFilter` ne vérifie `revoked = false` qu'au moment de la requête, pas de cache. Si la requête tombe sur une connexion JDBC qui voit l'ancienne valeur (rare) ou si le test utilise une requête HTTP/keep-alive avec un upstream qui a déjà ouvert une session — la session reste ouverte côté app.
**Résolution :** L'API key elle-même est bien refusée à la prochaine requête. Si l'app upstream maintient sa propre session, c'est à elle de la fermer (la révocation IAM côté SocleHub ne propage pas automatiquement aux apps).

### Piège 10 — `delete_user` cascade et perte de données

**Cause :** La FK `iam.tr_user_roles.id_users → iam.db_users.x_id ON DELETE CASCADE` supprime aussi les API keys, les sessions et les blacklist tokens du user. C'est volontaire et irréversible.
**Résolution :** Pour désactiver sans perdre l'historique : utiliser `lock_user` à la place de `delete_user`. La table `iam.db_users` peut être étendue avec une colonne `deleted_at` si on veut un soft-delete (non implémenté par défaut).

---

## 11. Pour aller plus loin

- Voir [[10-iam-worker]] pour la référence complète du `iam_worker` (toutes les actions, schéma DB BIGINT, lifecycle).
- Voir [[13-iam-tenant-management]] pour la gestion des tenants (`iam.db_tenants`), `create_tenant`, `grant_tenant_access` et l'audit de cohérence.
- Voir [[71-sso-oidc]] pour l'utilisation des JWT côté apps métier (validation, refresh).
- Voir [[72-api-keys-jwt]] pour la rotation et les bonnes pratiques de gestion d'API keys et de JWT.
- Voir `howto-09-configurer-sso-multi-app.md` pour propager l'identité de cet utilisateur sur plusieurs apps `*.thesocle.net`.
- Voir `howto-10-configurer-oidc-provider.md` pour autoriser une app tierce (claude.ai, GitHub Apps, etc.) à s'authentifier sur SocleHub via OIDC.
