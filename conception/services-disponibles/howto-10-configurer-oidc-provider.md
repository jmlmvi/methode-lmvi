# HOWTO 10 — Configurer SocleHub comme OIDC Provider pour une app externe

**Niveau :** Senior
**Prérequis :** SocleHub 3.12.1 démarré, schémas IAM migrés (`iam.db_oidc_clients`, `iam.tr_oidc_auth_codes`), au moins un utilisateur IAM créé (cf. [[howto-08-creer-utilisateur-iam|HOWTO 08]]), accès à PostgreSQL pour insérer un client OIDC, app tierce capable de faire un flow OAuth2 Authorization Code
**Temps estimé :** 45 minutes

---

## 1. Contexte

Au-delà du SSO interne `*.thesocle.net` (cf. HOWTO 09), SocleHub expose une **interface OpenID Connect Provider** complète, permettant à des apps tierces (claude.ai, GitHub Apps, Grafana, un SPA Angular hébergé ailleurs…) d'authentifier leurs utilisateurs via SocleHub. C'est le scénario "Login with SocleHub".

L'implémentation suit le standard **OpenID Connect 1.0** + **OAuth 2.0 Authorization Code Flow** + **PKCE (RFC 7636)** pour les clients publics. Tous les endpoints sont conformes à la **spec discovery** (`/.well-known/openid-configuration`) et les ID Tokens sont signés en **RS256** par la clé privée du `IamService`. Voir [[71-sso-oidc|71-sso-oidc]] pour la spec complète du provider OIDC du Hub.

En 3.12.1 le provider supporte aussi :

- **`refresh_token` grant** (renouvellement silencieux de l'access token, ex. Claude Desktop),
- **Dynamic Client Registration (RFC 7591)** sur `/oidc/register` — les clients MCP s'auto-enregistrent,
- **Token Introspection (RFC 7662)** sur `/oidc/introspect` — utilisé par l'APIM et les apps relais (cf. webmail TMail),
- les **scopes** `mcp:invoke` et `admin` en plus de `openid profile email`.

Vous devez :

- Enregistrer un client OIDC pour une app externe (par exemple `claude.ai` ou `analytics-prod.example.com`) avec un `client_id`, un `client_secret`, et la liste des `redirect_uris` autorisés.
- Vérifier que tous les endpoints OIDC répondent : `/.well-known/openid-configuration`, `/oidc/authorize`, `/oidc/token`, `/oidc/userinfo`, `/oidc/jwks`, `/oidc/introspect`, `/oidc/register`.
- Tester un flow complet Authorization Code + PKCE depuis curl (l'équivalent d'un client OAuth2).
- Documenter une intégration côté app tierce (Python avec `requests`, ou Node avec `openid-client`).

Le code complet vit dans `eu.lmvi.soclehub.controller.OidcController` et `eu.lmvi.soclehub.service.OidcService`. Les tokens utilisent la **même paire RSA** que le JWT interne, donc un access_token OIDC est utilisable sur les routes proxy SocleHub (cohérence cross-feature).

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          App tierce (analytics)                          │
│                                                                          │
│  1. User clique "Login with SocleHub"                                    │
│  2. App génère code_verifier + code_challenge (S256)                     │
│  3. Browser redirect → /oidc/authorize?response_type=code&...            │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            SocleHub                                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ OidcController                                                     │  │
│  │  GET  /.well-known/openid-configuration  →  discovery doc          │  │
│  │  GET  /oidc/authorize  ── if not auth → /hub/login?redirect=...    │  │
│  │                       ── if auth      → create code, redirect      │  │
│  │  POST /oidc/token     ── code + verifier → tokens (access+id)      │  │
│  │  GET  /oidc/userinfo  ── Bearer access → user claims               │  │
│  │  GET  /oidc/jwks      ── RSA public key (JWK format)               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│  ┌─────────────────────────┐ │ JDBC                                      │
│  │ OidcService             │◄┘                                           │
│  │ - findClient(id)        │                                             │
│  │ - createAuthorizationCode (with PKCE binding)                         │
│  │ - exchangeCode (with PKCE verify)                                     │
│  │ - buildIdToken (RS256)                                                │
│  └─────────────────────────┘                                             │
│             │                                                            │
│             ▼                                                            │
│  ┌─────────────────────────────────────────────────────┐                 │
│  │ PostgreSQL  iam schema                              │                 │
│  │ - iam.db_oidc_clients    (client_id, secret, uris…) │                 │
│  │ - iam.tr_oidc_auth_codes (code, ttl 5min, pkce…)    │                 │
│  │ - iam.tr_sessions        (refresh_token grant)      │                 │
│  │ - iam.db_users           (lookup pour userinfo)     │                 │
│  └─────────────────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Vérifier le Discovery document

Dès que SocleHub démarre, le Discovery est servi sur `/.well-known/openid-configuration` (par convention OpenID Connect Discovery 1.0).

```bash
curl -sS https://hub.thesocle.net/.well-known/openid-configuration | jq
```

Réponse type :

```json
{
  "issuer": "https://hub.thesocle.net",
  "authorization_endpoint": "https://hub.thesocle.net/oidc/authorize",
  "token_endpoint":         "https://hub.thesocle.net/oidc/token",
  "userinfo_endpoint":      "https://hub.thesocle.net/oidc/userinfo",
  "introspection_endpoint": "https://hub.thesocle.net/oidc/introspect",
  "jwks_uri":               "https://hub.thesocle.net/oidc/jwks",
  "registration_endpoint":  "https://hub.thesocle.net/oidc/register",
  "scopes_supported":         ["openid", "profile", "email", "mcp:invoke", "admin"],
  "response_types_supported": ["code"],
  "grant_types_supported":    ["authorization_code", "refresh_token"],
  "subject_types_supported":  ["public"],
  "id_token_signing_alg_values_supported":   ["RS256"],
  "token_endpoint_auth_methods_supported":   ["client_secret_post", "client_secret_basic", "none"],
  "claims_supported": ["sub","iss","aud","exp","iat","email","name","preferred_username"],
  "code_challenge_methods_supported": ["S256", "plain"]
}
```

Le code Java côté `OidcService.getDiscoveryDocument()` :

```java
package eu.lmvi.soclehub.service;

public Map<String, Object> getDiscoveryDocument() {
    String issuer = getIssuerUrl();   // "https://" + properties.getDomain()
    Map<String, Object> doc = new LinkedHashMap<>();
    doc.put("issuer", issuer);
    doc.put("authorization_endpoint", issuer + "/oidc/authorize");
    doc.put("token_endpoint",         issuer + "/oidc/token");
    doc.put("userinfo_endpoint",      issuer + "/oidc/userinfo");
    doc.put("introspection_endpoint", issuer + "/oidc/introspect");
    doc.put("jwks_uri",               issuer + "/oidc/jwks");
    doc.put("scopes_supported",       List.of("openid", "profile", "email", "mcp:invoke", "admin"));
    doc.put("response_types_supported", List.of("code"));
    doc.put("grant_types_supported",  List.of("authorization_code", "refresh_token"));
    doc.put("subject_types_supported", List.of("public"));
    doc.put("id_token_signing_alg_values_supported", List.of("RS256"));
    // "none" = client public PKCE (Claude Desktop & clients MCP)
    doc.put("token_endpoint_auth_methods_supported",
            List.of("client_secret_post", "client_secret_basic", "none"));
    doc.put("claims_supported",
            List.of("sub","iss","aud","exp","iat","email","name","preferred_username"));
    doc.put("code_challenge_methods_supported", List.of("S256", "plain"));
    // RFC 7591 — Dynamic Client Registration (clients MCP s'auto-enregistrent)
    doc.put("registration_endpoint", issuer + "/oidc/register");
    return doc;
}
```

Et le JWKS (JSON Web Key Set) sur `/oidc/jwks` :

```bash
curl -sS https://hub.thesocle.net/oidc/jwks | jq
# {
#   "keys": [
#     {
#       "kty": "RSA",
#       "use": "sig",
#       "alg": "RS256",
#       "kid": "ad87f3e2-1234-5678-9abc-def012345678",
#       "n":   "<base64url modulus>",
#       "e":   "AQAB"
#     }
#   ]
# }
```

**Points clés :**

- L'`issuer` est `https://{soclehub.domain}` (sans path). Cette valeur est **vérifiée côté client** : tout drift (par exemple un cert TLS différent ou un domaine mal configuré) cassera la validation.
- Le `kid` est régénéré à chaque démarrage du Hub (cf. `IamService.generateKeyPair()`). Les clients OIDC qui mettent en cache la JWKS doivent rafraîchir au moins toutes les 24h.

---

## 4. Étape 2 — Enregistrer un client OIDC

Il y a trois façons : SQL direct (rapide, pour le bootstrap), Dynamic Client Registration via `POST /oidc/register` (RFC 7591, pour les clients MCP qui s'auto-enregistrent), ou via le service Java `OidcService.createClient()` appelable depuis un autre Worker. Il n'y a **pas** d'action MCP `iam_worker` dédiée à la création de clients OIDC en 3.12.1.

### 4.1 SQL direct

```sql
-- Connexion : docker exec -it soclehub-postgres psql -U postgres -d soclehub

INSERT INTO iam.db_oidc_clients
    (client_id, client_secret, client_name, redirect_uris, allowed_scopes, app_id, x_active)
VALUES
    ('oidc_analytics',
     'sk_secret_change_me_to_a_real_random_value_at_least_32_chars',
     'Analytics Production',
     '["https://analytics.example.com/callback","http://localhost:3000/callback"]'::jsonb,
     '["openid","profile","email"]'::jsonb,
     'analytics',
     true);

-- Vérifier
SELECT client_id, client_name, redirect_uris, x_active
FROM iam.db_oidc_clients;
```

> **Note table** : en 3.12.1 la table suit la convention THESOCLE — `iam.db_oidc_clients` (préfixe `db_`), colonne `x_active`, codes d'autorisation dans `iam.tr_oidc_auth_codes` (préfixe `tr_`). Les anciens noms `iam.oidc_clients` / `iam.oidc_auth_codes` n'existent plus.

### 4.2 Dynamic Client Registration (RFC 7591)

Les clients MCP (Claude Desktop, etc.) peuvent s'auto-enregistrer en client **public** (PKCE, sans secret) :

```bash
curl -sS -X POST https://hub.thesocle.net/oidc/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Claude Desktop MCP",
    "redirect_uris": ["http://localhost:33418/callback"],
    "token_endpoint_auth_method": "none"
  }' | jq
# → { "client_id": "...", "client_id_issued_at": ..., "redirect_uris": [...],
#     "grant_types": ["authorization_code","refresh_token"], ... }
```

Le service force `allowed_scopes = ["openid","profile","email","mcp:invoke"]` pour les clients DCR.

Le `client_secret` doit être généré côté serveur (32+ caractères aléatoires). Exemple :

```bash
openssl rand -base64 32
# <client_secret rendu à l'enregistrement du client>
```

### 4.3 Via le service Java (utilisable depuis un autre Worker)

Le code de référence (`OidcService.createClient()`) est appelable :

```java
package eu.lmvi.soclehub.service;

public Map<String, Object> createClient(String clientName, String appId,
                                         List<String> redirectUris) throws Exception {
    String clientId     = "oidc_" + appId;
    String clientSecret = generateSecureCode();   // 32 bytes Base64URL

    String sql = """
        INSERT INTO iam.db_oidc_clients
            (client_id, client_secret, client_name, redirect_uris, app_id)
        VALUES (?, ?, ?, ?::jsonb, ?)
        ON CONFLICT (client_id) DO UPDATE SET
            client_secret = EXCLUDED.client_secret,
            client_name   = EXCLUDED.client_name,
            redirect_uris = EXCLUDED.redirect_uris,
            x_dateUpdated = now()
        """;

    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setString(1, clientId);
        ps.setString(2, clientSecret);
        ps.setString(3, clientName);
        ps.setString(4, objectMapper.writeValueAsString(redirectUris));
        ps.setString(5, appId);
        ps.executeUpdate();
    }

    Map<String, Object> result = new LinkedHashMap<>();
    result.put("client_id",     clientId);
    result.put("client_secret", clientSecret);  // SECRET — montré une seule fois
    result.put("client_name",   clientName);
    result.put("redirect_uris", redirectUris);
    result.put("app_id",        appId);
    return result;
}
```

**Points clés :**

- `redirect_uris` est un JSON array stocké en `jsonb`. La validation (`OidcService.isValidRedirectUri()`) est en match exact, pas en pattern matching. `https://analytics.example.com/callback` ≠ `https://analytics.example.com/callback/`.
- Stocker plusieurs URIs pour gérer dev/staging/prod : `["http://localhost:3000/callback","https://staging.example.com/callback","https://analytics.example.com/callback"]`.

---

## 5. Étape 3 — Le flow Authorization Code + PKCE expliqué

PKCE (RFC 7636) est **obligatoire** pour les clients publics (SPA, mobile) qui ne peuvent pas garder un secret. Pour les clients confidentiels (backend serveur), c'est optionnel mais recommandé.

### 5.1 Côté client : générer le code_verifier et code_challenge

```bash
# code_verifier : 43-128 caractères Base64URL aléatoires
CODE_VERIFIER=$(openssl rand -base64 64 | tr -d '=' | tr '/+' '_-' | head -c 64)
echo "code_verifier=${CODE_VERIFIER}"
# code_verifier=QwErTy_7YzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_QwErTyZxCv

# code_challenge = Base64URL(SHA-256(code_verifier))
CODE_CHALLENGE=$(printf '%s' "${CODE_VERIFIER}" \
  | openssl dgst -sha256 -binary \
  | openssl base64 -A | tr -d '=' | tr '/+' '_-')
echo "code_challenge=${CODE_CHALLENGE}"
# code_challenge=KNMPdH3TqU8w3xrWX_aF1vU9yEcD8tQfG2rY6lZbA0M
```

### 5.2 Étape `authorize` : redirection dans le navigateur

```
GET https://hub.thesocle.net/oidc/authorize?
    response_type=code
    &client_id=oidc_analytics
    &redirect_uri=https%3A%2F%2Fanalytics.example.com%2Fcallback
    &scope=openid%20profile%20email
    &state=random_state_for_csrf_protection
    &nonce=random_nonce_for_id_token_replay_protection
    &code_challenge=KNMPdH3TqU8w3xrWX_aF1vU9yEcD8tQfG2rY6lZbA0M
    &code_challenge_method=S256
```

Ce que fait `OidcController.authorize()` côté Hub :

1. Valider `response_type=code` (rejette `token`, `id_token`).
2. `OidcService.findClient(clientId)` → vérifier que le client existe et est actif.
3. `isValidRedirectUri(client, redirectUri)` → match exact contre la liste.
4. Vérifier `SecurityContextHolder.getContext().getAuthentication()` :
   - Si non authentifié → redirect vers `/hub/login?redirect=<currentUrl>`.
   - Si authentifié → continuer.
5. Résoudre `userId` via SELECT `iam.db_users WHERE email = ?` (l'auth Spring Security stocke l'email comme principal).
6. `OidcService.createAuthorizationCode(clientId, userId, redirectUri, scope, nonce, codeChallenge, codeChallengeMethod)` → INSERT dans `iam.tr_oidc_auth_codes` (colonnes `code, client_id, id_users, redirect_uri, scopes, nonce, expires_at, code_challenge, code_challenge_method`) avec TTL 5 min.
7. Redirect vers `redirect_uri` avec `?code=...&state=...`.

### 5.3 Étape `token` : échange du code contre les tokens

```bash
# Côté app tierce, le browser a été redirigé sur :
#   https://analytics.example.com/callback?code=BiK3v_ABC...&state=random_state_for_csrf_protection
#
# Le backend de l'app tierce extrait le code et fait :

curl -sS -X POST https://hub.thesocle.net/oidc/token \
  -u "oidc_analytics:<client_secret rendu à l'enregistrement du client>" \
  -d "grant_type=authorization_code" \
  -d "code=BiK3v_ABCdef..." \
  -d "redirect_uri=https://analytics.example.com/callback" \
  -d "code_verifier=${CODE_VERIFIER}"
```

Réponse :

```json
{
  "access_token":  "eyJhbGciOiJSUzI1NiIs...",
  "token_type":    "Bearer",
  "expires_in":    900,
  "id_token":      "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "rt_8f2c...",
  "scope":         "openid profile email"
}
```

> Le `refresh_token` est persisté dans `iam.tr_sessions`. Le client peut renouveler son access token sans relancer le flux navigateur :
>
> ```bash
> curl -sS -X POST https://hub.thesocle.net/oidc/token \
>   -u "oidc_analytics:${CLIENT_SECRET}" \
>   -d "grant_type=refresh_token" \
>   -d "refresh_token=rt_8f2c..."
> ```

Code Java pertinent (`OidcService.exchangeCode()` partie PKCE) :

```java
// PKCE verification (RFC 7636) — si un challenge a été enregistré, le verifier est OBLIGATOIRE
if (storedChallenge != null && !storedChallenge.isBlank()) {
    if (codeVerifier == null || codeVerifier.isBlank()) {
        log.warn("OIDC code exchange: PKCE code_verifier required but missing");
        return null;
    }
    String method = (storedMethod != null && !storedMethod.isBlank()) ? storedMethod : "plain";
    String computed;
    if ("S256".equalsIgnoreCase(method)) {
        java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
        byte[] hash = md.digest(codeVerifier.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        computed = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
    } else {
        computed = codeVerifier;  // method "plain"
    }
    if (!storedChallenge.equals(computed)) {
        log.warn("OIDC code exchange: PKCE verification failed (method={})", method);
        return null;
    }
}
```

### 5.4 Étape `userinfo` : enrichir la session

```bash
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r .access_token)

curl -sS https://hub.thesocle.net/oidc/userinfo \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

Réponse :

```json
{
  "sub":                "9c4f1e2a-7b3d-4e1f-8c0a-1234567890ab",
  "email":              "alice@thesocle.net",
  "name":               "Alice Martin",
  "preferred_username": "alice@thesocle.net"
}
```

### 5.4bis Introspection (RFC 7662) — pour les apps relais

Un client confidentiel peut valider un access token côté serveur via `/oidc/introspect`. C'est le mécanisme utilisé par l'APIM et les apps relais (ex. webmail TMail qui valide le token du Hub) :

```bash
curl -sS -X POST https://hub.thesocle.net/oidc/introspect \
  -u "oidc_analytics:${CLIENT_SECRET}" \
  -d "token=${ACCESS_TOKEN}" | jq
# → { "active": true, "sub": "...", "scope": "openid profile email", "exp": ..., ... }
```

L'endpoint exige une **authentification client confidentielle** (Basic ou `client_id`/`client_secret` en POST) — sinon `401 invalid_client`.

### 5.5 Vérifier l'`id_token`

L'`id_token` est un JWT RS256 — l'app tierce doit le valider avec la clé publique du JWKS :

```bash
ID_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r .id_token)

# Décoder le payload
echo "$ID_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq
```

```json
{
  "jti":                "9eaa1c9d-...",
  "sub":                "9c4f1e2a-...",
  "iss":                "https://hub.thesocle.net",
  "aud":                ["oidc_analytics"],
  "iat":                1714312800,
  "exp":                1714313700,
  "email":              "alice@thesocle.net",
  "name":               "Alice Martin",
  "preferred_username": "alice@thesocle.net",
  "nonce":              "random_nonce_for_id_token_replay_protection"
}
```

---

## 6. Étape 4 — Intégration côté app tierce (Python)

Exemple complet avec le SDK officiel `Authlib` :

```python
# pip install Authlib requests Flask
from flask import Flask, redirect, request, session, url_for
from authlib.integrations.flask_client import OAuth

app = Flask(__name__)
app.secret_key = 'change-me-in-prod'

oauth = OAuth(app)
oauth.register(
    name='soclehub',
    client_id='oidc_analytics',
    client_secret='<client_secret rendu à l'enregistrement du client>',
    server_metadata_url='https://hub.thesocle.net/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid profile email',
        'code_challenge_method': 'S256',  # ⚡ PKCE auto-géré par Authlib
    },
)

@app.route('/login')
def login():
    redirect_uri = url_for('callback', _external=True)
    return oauth.soclehub.authorize_redirect(redirect_uri)

@app.route('/callback')
def callback():
    token    = oauth.soclehub.authorize_access_token()  # gère code+verifier
    userinfo = token.get('userinfo') or oauth.soclehub.userinfo()
    session['user'] = dict(userinfo)
    return redirect('/')

@app.route('/')
def home():
    user = session.get('user')
    if not user:
        return '<a href="/login">Login with SocleHub</a>'
    return f'Hello {user["name"]} ({user["email"]}) — sub={user["sub"]}'

if __name__ == '__main__':
    app.run(port=3000, debug=True)
```

### Intégration côté Node.js (`openid-client`)

```javascript
// npm install openid-client express express-session
const express  = require('express');
const session  = require('express-session');
const { Issuer, generators } = require('openid-client');

(async () => {
  const issuer = await Issuer.discover('https://hub.thesocle.net');
  const client = new issuer.Client({
    client_id:     'oidc_analytics',
    client_secret: '<client_secret rendu à l'enregistrement du client>',
    redirect_uris: ['http://localhost:3000/callback'],
    response_types: ['code'],
  });

  const app = express();
  app.use(session({ secret: 'change-me', resave: false, saveUninitialized: false }));

  app.get('/login', (req, res) => {
    const code_verifier  = generators.codeVerifier();
    const code_challenge = generators.codeChallenge(code_verifier);
    req.session.code_verifier = code_verifier;
    res.redirect(client.authorizationUrl({
      scope: 'openid profile email',
      code_challenge,
      code_challenge_method: 'S256',
    }));
  });

  app.get('/callback', async (req, res) => {
    const params   = client.callbackParams(req);
    const tokenSet = await client.callback(
      'http://localhost:3000/callback', params,
      { code_verifier: req.session.code_verifier }
    );
    const userinfo = await client.userinfo(tokenSet.access_token);
    req.session.user = userinfo;
    res.json({ tokenSet, userinfo });
  });

  app.listen(3000);
})();
```

---

## 7. Étape 5 — Test manuel complet via curl (bash script)

```bash
#!/usr/bin/env bash
set -euo pipefail

HUB="https://hub.thesocle.net"
CLIENT_ID="oidc_analytics"
CLIENT_SECRET="<client_secret rendu à l'enregistrement du client>"
REDIRECT="http://localhost:3000/callback"

# 1. Générer PKCE
CODE_VERIFIER=$(openssl rand -base64 64 | tr -d '=' | tr '/+' '_-' | head -c 64)
CODE_CHALLENGE=$(printf '%s' "${CODE_VERIFIER}" \
  | openssl dgst -sha256 -binary \
  | openssl base64 -A | tr -d '=' | tr '/+' '_-')

# 2. Construire l'URL d'authorize
AUTHORIZE_URL="${HUB}/oidc/authorize?response_type=code"
AUTHORIZE_URL+="&client_id=${CLIENT_ID}"
AUTHORIZE_URL+="&redirect_uri=$(jq -rn --arg v "${REDIRECT}" '$v|@uri')"
AUTHORIZE_URL+="&scope=openid%20profile%20email"
AUTHORIZE_URL+="&state=test_state_$(date +%s)"
AUTHORIZE_URL+="&nonce=test_nonce_$(date +%s)"
AUTHORIZE_URL+="&code_challenge=${CODE_CHALLENGE}"
AUTHORIZE_URL+="&code_challenge_method=S256"

echo "1. Ouvre dans un navigateur (ou utilise curl avec un cookie auth) :"
echo "   ${AUTHORIZE_URL}"
echo
echo "2. Après login, l'URL de retour aura ?code=XYZ&state=..."
read -p "Colle le code reçu : " CODE

# 3. Échanger le code contre les tokens
TOKEN_RESPONSE=$(curl -sS -X POST "${HUB}/oidc/token" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -d "grant_type=authorization_code" \
  -d "code=${CODE}" \
  -d "redirect_uri=${REDIRECT}" \
  -d "code_verifier=${CODE_VERIFIER}")

echo "Token response :"
echo "$TOKEN_RESPONSE" | jq

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r .access_token)

# 4. Récupérer le userinfo
echo
echo "UserInfo :"
curl -sS "${HUB}/oidc/userinfo" -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq
```

---

## 8. Validation

### 8.1 Vérifier le client en base

```sql
SELECT client_id, client_name, jsonb_array_length(redirect_uris) AS uri_count,
       x_active, x_dateCreated
FROM iam.db_oidc_clients;
```

### 8.2 Vérifier les codes émis et leur cycle de vie

```sql
-- Codes encore actifs (TTL 5 min)
SELECT code, client_id, id_users, scopes, consumed, expires_at,
       (expires_at - now()) AS ttl_remaining
FROM iam.tr_oidc_auth_codes
WHERE expires_at > now()
ORDER BY expires_at DESC LIMIT 10;

-- Codes consommés récemment
SELECT code, client_id, consumed, expires_at
FROM iam.tr_oidc_auth_codes
WHERE consumed = true
ORDER BY expires_at DESC LIMIT 10;
```

### 8.3 Vérifier le JWKS

```bash
curl -sS https://hub.thesocle.net/oidc/jwks | jq .keys[0].kid
# "ad87f3e2-1234-..."

# Comparer avec le kid attendu (regen au démarrage du Hub)
docker logs soclehub-hub 2>&1 | grep "RSA 4096 key pair generated" | tail -1
# RSA 4096 key pair generated successfully (kid=ad87f3e2-1234-...)
```

### 8.4 Vérifier la signature de l'`id_token` avec jwt.io ou jose

```bash
ID_TOKEN="eyJhbGciOiJSUzI1NiIs..."

# Récupérer la JWKS
curl -sS https://hub.thesocle.net/oidc/jwks > /tmp/jwks.json

# Avec node-jose (npm install -g jose-cli)
echo "$ID_TOKEN" | jose verify -k /tmp/jwks.json
# → OK si signature valide
```

---

## 9. Pièges courants

### Piège 1 — `invalid_client: Unknown or inactive client_id`

**Cause :** Le `client_id` envoyé n'existe pas dans `iam.db_oidc_clients`, ou la colonne `x_active` vaut `false`.
**Résolution :** `SELECT client_id, x_active FROM iam.db_oidc_clients WHERE client_id = 'oidc_analytics'`. Si `x_active=false`, faire `UPDATE iam.db_oidc_clients SET x_active = true WHERE client_id = ...`.

### Piège 2 — `invalid_redirect_uri: redirect_uri not registered`

**Cause :** Le `redirect_uri` passé à `/oidc/authorize` n'est pas **strictement égal** à un des URIs dans `redirect_uris` du client. Différence courante : `https://example.com/callback` vs `https://example.com/callback/` (trailing slash).
**Résolution :** Aligner les deux. La spec OIDC autorise le match exact uniquement. Si plusieurs URIs nécessaires, les ajouter tous dans le JSON :

```sql
UPDATE iam.db_oidc_clients
SET redirect_uris = '["https://example.com/callback","https://example.com/callback/"]'::jsonb
WHERE client_id = 'oidc_analytics';
```

### Piège 3 — `invalid_grant: Invalid, expired, or already-used authorization code`

**Cause possible 1 :** Le code a expiré (TTL 5 min).
**Cause possible 2 :** Le code a déjà été utilisé (`consumed = true`).
**Cause possible 3 :** Le `client_id` ne correspond pas au code.
**Cause possible 4 :** Le `redirect_uri` du token request diffère de celui du authorize.
**Résolution :** Inspecter les logs `OIDC code exchange: <reason>` pour identifier la cause précise. Refaire le flow complet — ne **jamais** stocker ni rejouer un code.

### Piège 4 — PKCE : `code_verifier required but missing`

**Cause :** Le client a envoyé `code_challenge` à `/authorize` mais a oublié `code_verifier` à `/token`. Le verifier est obligatoire si un challenge a été enregistré.
**Résolution :** Côté SDK client, vérifier que la persistance du verifier (en session) fonctionne entre les deux requêtes.

### Piège 5 — `access_token` accepté par `/oidc/userinfo` mais pas par les routes proxy

**Cause :** L'access token OIDC a un `aud=client_id` mais le `SsoFilter` ne vérifie pas l'audience pour les routes proxy. Cela devrait fonctionner — sinon vérifier le `iss` ou la signature.
**Résolution :** Le token est en théorie cross-utilisable car émis par la même paire RSA et avec `iss=soclehub`. Si problème, dump les claims via `jwt-cli decode` et vérifier que `iss` matche bien.

### Piège 6 — `id_token` signature invalide côté client

**Cause possible 1 :** Le `kid` dans l'header JWT ne matche aucun `kid` du JWKS — typiquement après un redémarrage du Hub qui regénère la paire.
**Cause possible 2 :** Le client a mis en cache la JWKS et ne la rafraîchit jamais.
**Résolution :** Forcer le rafraîchissement de la JWKS au démarrage de l'app cliente, ou implémenter un cache TTL court (5 min). À long terme, persister la paire RSA dans Vault pour stabilité.

### Piège 7 — `UnsupportedResponseType: Only 'code' response_type is supported`

**Cause :** Le client tente un `response_type=token` (Implicit Flow) ou `id_token` (Hybrid). SocleHub ne supporte **que** Authorization Code (recommandation officielle de l'OAuth 2.1 working group).
**Résolution :** Migrer le client vers Authorization Code + PKCE. L'Implicit Flow est déprécié.

### Piège 8 — Le user n'a pas de `first_name` / `last_name` → claim `name` est vide

**Cause :** Les claims `name` et `preferred_username` viennent de `iam.db_users.first_name + last_name`. Si null en base, le claim `name` est une string vide ou n'est pas inclus.
**Résolution :** `update_user` pour compléter les champs, ou modifier `OidcService.getUserInfo()` pour utiliser `email` en fallback (déjà le cas pour `preferred_username`).

### Piège 9 — Le scope `profile` ne renvoie rien de plus que `openid` seul

**Cause :** L'implémentation actuelle n'utilise pas le scope pour filtrer les claims du userinfo — tous les claims utilisateur sont toujours retournés. Cela contrevient à la spec stricte.
**Résolution :** Ce n'est pas bloquant pour la plupart des clients (qui demandent `openid profile email` par défaut). Si une intégration nécessite un scope-filtering strict, modifier `OidcService.getUserInfo()` pour conditionner les claims.

### Piège 10 — `Authorization Bearer` rejeté en Basic auth pour le token endpoint

**Cause :** Le client envoie le secret en `Authorization: Bearer <secret>` au lieu de `Authorization: Basic base64(client_id:secret)`. Trois méthodes sont supportées : `client_secret_post` (params POST), `client_secret_basic` (Basic auth) et `none` (client public PKCE, sans secret — Claude Desktop / clients MCP).
**Résolution :**
```bash
# CORRECT — Basic auth
curl -u "client_id:client_secret" -d "grant_type=authorization_code&code=..."
# CORRECT — POST body
curl -d "client_id=...&client_secret=...&grant_type=authorization_code&code=..."
# INCORRECT
curl -H "Authorization: Bearer <secret>" -d "grant_type=..."
```

### Piège 11 — Le proxy `*.thesocle.net` ne route pas `/oidc/*` vers le Hub

**Cause :** Si vous accédez à `https://app1.thesocle.net/oidc/authorize`, le proxy renvoie sur l'app1 (qui ne connaît pas OIDC). Tous les endpoints OIDC vivent **sur le hub**, pas sur les apps.
**Résolution :** Toujours utiliser `https://hub.thesocle.net/oidc/...` (ou plus généralement la valeur de `properties.domain`) comme issuer.

### Piège 12 — Le user est déjà loggé sur le Hub mais `/oidc/authorize` redirige tout de même vers le login

**Cause :** Spring Security n'a pas reconnu le cookie `soclehub_token` car la requête vient sur `hub.thesocle.net` mais le cookie est `Domain=.thesocle.net`. Le contrôleur `OidcController.authorize()` lit `SecurityContextHolder.getContext().getAuthentication()` qui dépend des filtres de sécurité Spring.
**Résolution :** Vérifier `SecurityConfig.java` : un filtre custom doit lire le `soclehub_token` cookie et populer le SecurityContext. Sinon, tous les flows OIDC obligent un login fresh.

---

## 10. Pour aller plus loin

- [[71-sso-oidc|71-sso-oidc]] — spec complète OIDC + endpoints (`/oidc/register`, `/oidc/introspect`) + claims supportés.
- [[72-api-keys-jwt|72-api-keys-jwt]] — cohabitation OIDC tokens / API keys / SSO cookie.
- [[10-iam-worker|10-iam-worker]] — gestion des utilisateurs et rôles consommés par le provider OIDC.
- [[howto-08-creer-utilisateur-iam|HOWTO 08]] — créer les users qui se connecteront via OIDC.
- [[howto-09-configurer-sso-multi-app|HOWTO 09]] — SSO interne (alternative à OIDC pour `*.thesocle.net`).
- Spec OpenID Connect Core 1.0 : https://openid.net/specs/openid-connect-core-1_0.html
- Spec PKCE (RFC 7636) : https://datatracker.ietf.org/doc/html/rfc7636
