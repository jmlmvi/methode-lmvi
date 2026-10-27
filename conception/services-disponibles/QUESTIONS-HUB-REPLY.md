---
document: QUESTIONS-HUB-REPLY
version: 0.1.0
date: 2026-04-29
émetteur: SocleHub mainteneur (jm@henry.sh)
destinataire: Jean-Marc HENRY (équipe ApplicationEditors)
projet: ApplicationEditors v1.0.0
en-réponse-à: QuestionsSocle.md (2026-04-29)
---

# Réponses SocleHub pour intégration ApplicationEditors

> **Convention de réponse** :
> - ✅ **Existe** = endpoint/feature en place, valeurs concrètes ci-dessous
> - 🚧 **À développer** = pas implémenté, estimation fournie
> - 🤔 **À discuter** = choix d'architecture à arbitrer ensemble
>
> Toutes les valeurs sont vérifiées dans le code source à la date du
> 2026-04-29 (Hub v2.6.3 / framework socle-v005:5.5.1).

---

## Contexte rapide côté SocleHub

L'IAM du Hub utilise **deux régimes** qui co-existent et que vous pouvez utiliser
selon vos besoins :

1. **IAM "interne" SocleHub** (`/auth/login`, `/auth/refresh`, `/auth/logout`) —
   JWT custom RS256 émis par `IamService`. C'est le régime le plus simple et
   c'est celui que je recommande pour ApplicationEditors.
2. **OIDC complet** (`/.well-known/openid-configuration`, `/oidc/authorize`,
   `/oidc/token`, `/oidc/userinfo`, `/oidc/jwks`) — pour les apps tierces qui
   parlent OIDC standard. Disponible mais plus lourd à intégrer côté React.

ApplicationEditors étant un produit "maison", **option 1** est plus directe.
Toutes mes réponses ci-dessous décrivent l'option 1 en priorité, avec un
addendum OIDC quand c'est utile.

Note importante : **dans le modèle actuel SocleHub n'a pas de notion intrinsèque
de "liste de Socles" pour un user**. Le Hub *est* la Socle (admin). Si vous voulez
gérer N Socles distantes derrière un seul écran, il faut décider :

- (A) Le Hub = registre central qui connaît N Socles et leurs URLs → il faut
  ajouter un schéma `socles` côté Hub (schéma multi-tenant).
- (B) Chaque Socle est indépendante, le Hub ne fait que l'authentification, et
  ApplicationEditors connaît directement la liste des Socles via une autre source
  (config locale, env, autre service).

**Option (A)** demande un dev structurant côté Hub (~2-3 jours). **Option (B)** est
plus rapide à mettre en place mais déplace la complexité côté ApplicationEditors.
Voir Q-SOCLES.1 pour ma recommandation détaillée.

---

## 1. Authentification utilisateur

### Q-AUTH.1 — URL de login

✅ **Existe**

```
POST https://admin.thesocle.net/auth/login
Content-Type: application/json
```

(Remplacer `admin.thesocle.net` par le domaine du Hub réellement déployé.)

> **Note** : ce n'est PAS sous `/wp-json/lmvi/v1/...`. Cet espace de namespace
> est réservé au plugin WordPress côté éditeur LMVI (tracker bugs, registration
> license, etc.) — un service complètement distinct du Hub. Le Hub Spring Boot
> expose ses endpoints directement (`/auth`, `/api`, `/iam`, `/admin`, `/hub`).

**Référence code** : `eu.lmvi.soclehub.controller.AuthController:53`

---

### Q-AUTH.2 — Body de la requête de login

✅ **Existe**

```json
{
  "email": "user@example.com",
  "password": "secret",
  "device": "mobile"   // optionnel — "mobile" allonge le refresh à 30j (vs 7j)
}
```

Le champ **`email`** (pas `username`). Le champ `password` est en clair sur le
fil — TLS terminé côté Tomcat embedded, donc OK en HTTPS.

**Référence code** : `AuthController:53-90`

---

### Q-AUTH.3 — Format de la réponse de login

✅ **Existe** — JWT dans le body, pas de cookie HTTP-only.

```json
{
  "accessToken":  "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIs...",
  "expiresIn":        900,
  "refreshExpiresIn": 604800,
  "device": "mobile"     // présent uniquement si fourni à l'input
}
```

`expiresIn` est en secondes (15 min par défaut). `refreshExpiresIn` aussi (7
jours par défaut, 30 jours si `device=mobile`).

**Référence code** : `AuthController:166-175`

---

### Q-AUTH.4 — Algorithme de signature JWT

✅ **Existe** — `RS256` (RSA-2048-bit), clé publique exposée via JWKS.

**Endpoints JWKS disponibles (deux) — même clé publique servie aux deux URLs :**

```
GET https://admin.thesocle.net/iam/jwks.json     ← le plus simple
GET https://admin.thesocle.net/oidc/jwks         ← équivalent OIDC standard
```

Réponse JWKS standard :
```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "<UUID>",
      "n":   "<base64url modulus>",
      "e":   "AQAB"
    }
  ]
}
```

> ⚠️ **Caveat important** : aujourd'hui la `KeyPair` RSA est régénérée
> **à chaque démarrage** du Hub (cf `IamService.init()` → `generateKeyPair()`).
> Le `kid` change à chaque restart, et tous les JWT existants sont invalidés.
> Une persistance Vault est prévue (TODO ligne 60 du fichier). Ça veut dire
> qu'ApplicationEditors doit **refetcher le JWKS périodiquement** (ou faire un
> retry avec `refresh JWKS` si la signature échoue) pour gérer la rotation.
> Pour la prod, on figera la clé en Vault → la rotation deviendra explicite.

**Référence code** : `IamService:50-70` + `IamService:87-101` (signWith RS256).

---

### Q-AUTH.5 — Claims du JWT

✅ **Existe** — Voici un access token décodé typique :

```json
{
  "jti":        "f3a1b2c3-d4e5-6789-0abc-def012345678",
  "sub":        "<UUID user>",
  "iss":        "soclehub",
  "aud":        ["soclehub-apps"],
  "iat":        1714408800,
  "exp":        1714409700,
  "email":      "jmh@lmvi.eu",
  "first_name": "Jean-Marc",
  "last_name":  "HENRY",
  "scopes":     ["app:appdemo:user", "iam:user:read", "mcp:bugs:write"],
  "tenant":     "default",
  "token_type": "access"
}
```

- L'identifiant utilisateur principal est **`sub`** (UUID stable, lié à
  `iam.users.x_id`).
- L'**email** est dans le claim `email` (commodité).
- Expiration : claim **`exp`** (epoch seconds).
- **La liste des Socles n'est PAS dans le JWT** — il faut un appel séparé.
  Voir Q-SOCLES.1.
- `scopes` est la liste de permissions IAM — voir Q-DROITS pour la
  granularité.
- `iss` = `"soclehub"` (constante hardcodée dans `IamService:35`)
- `aud` = `"soclehub-apps"` (constante)

**Référence code** : `IamService.generateAccessToken:81-105`

---

### Q-AUTH.6 — TTL et refresh

✅ **Existe**

| Token         | Durée par défaut    | Configurable via                             |
|---------------|---------------------|----------------------------------------------|
| Access token  | **15 min** (900 s)  | env `JWT_ACCESS_TTL`                         |
| Refresh token | **7 jours** (web) ou **30 jours** (mobile) | env `JWT_REFRESH_TTL` (défaut 604800) |

**Endpoint refresh** :
```
POST https://admin.thesocle.net/auth/refresh
Content-Type: application/json

{ "refreshToken": "eyJhbGc..." }
```

Réponse :
```json
{
  "accessToken": "eyJ...",
  "expiresIn":   900
}
```

⚠️ Le refresh **ne fait pas de rotation** par défaut : le même refresh
token reste valide. Côté server, chaque session est tracée dans
`iam.sessions` (`x_id`, `id_users`, `refresh_token` jti, `expires_at`).
Un logout invalide la session → le refresh token associé n'est plus
réutilisable.

**Référence code** : `AuthController:189-307`

---

### Q-AUTH.7 — Header HTTP d'authentification

✅ **Existe** — `Authorization: Bearer <accessToken>`.

```http
GET /api/some-endpoint HTTP/1.1
Host: admin.thesocle.net
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

Pas de cookie automatique ni de header custom. C'est le standard OAuth 2.0
Bearer. Le `OidcMcpAuthFilter` côté Hub gère la validation de signature +
expiration via la même `KeyPair` qui a émis le token.

Pour valider côté ApplicationEditors backend (Spring Boot proxy) sans
appeler le Hub à chaque requête : `GET /iam/jwks.json` une fois (cache
~5 min), puis valider la signature localement avec une lib JWT (jjwt,
nimbus-jose-jwt, etc.).

Pour valider côté server (mais avec un appel réseau) :
```http
GET /iam/validate HTTP/1.1
Authorization: Bearer <token>
```
Renvoie 200 + claims si valide, 401 si pas.

**Référence code** : `IamPublicController:42-80`

---

### Q-AUTH.8 — Endpoint logout

✅ **Existe**

```
POST https://admin.thesocle.net/auth/logout
Authorization: Bearer <accessToken>
```

Body vide. Le Hub :
1. Valide le token
2. Trouve la session liée au `sub` du token (via `iam.sessions`)
3. Marque la session comme `revoked` (le refresh token devient inutilisable)
4. Renvoie 200

**Référence code** : `AuthController:309+`

> **Note pour SPA** : l'access token reste valide jusqu'à son `exp` (max 15 min).
> Pour invalider immédiatement côté client, supprimer le token de localStorage /
> sessionStorage. La révocation côté server affecte uniquement le refresh path.

---

### Q-AUTH.9 — CORS

🤔 **À discuter** — pas de configuration CORS globale aujourd'hui.

Aujourd'hui Spring Security n'a pas de `cors()` configuré dans
`SecurityConfig` → comportement par défaut Spring (refus cross-origin sauf
preflight implicite).

**Solution proposée** : ajouter une config CORS qui prend la liste des origines
autorisées en variable d'env.

```yaml
# application.yml (proposé)
socle:
  cors:
    allowed-origins:
      - https://editor.thesocle.net
      - https://editor-staging.thesocle.net
      - http://localhost:5173    # dev React
```

**Implémentation** : ~30 LOC dans `SecurityConfig` + un bean `CorsConfigurationSource`.

🚧 **À développer** — Délai estimé : ~30 min de dev + redéploiement Hub. Si tu
me confirmes l'URL définitive d'ApplicationEditors, je pousse le fix dans le
prochain pack v2.6.4 ou v2.7.0.

**Workaround temporaire pour le dev** : ApplicationEditors backend (Spring Boot)
proxifie tous les appels au Hub → pas de CORS à gérer côté navigateur (le SPA
React appelle son propre backend, qui appelle le Hub server-to-server).

---

## 2. Liste des Socles d'un utilisateur

### Q-SOCLES.1 — Endpoint

🚧 **À développer** — n'existe pas aujourd'hui.

**Pourquoi** : le modèle actuel du SocleHub est mono-instance. Il n'y a pas de
notion native de "Socle" comme entité enregistrée à laquelle un user a accès.
Ce qui existe :

- `iam.users` : utilisateurs locaux à *cette* instance Hub
- `iam.roles`, `iam.user_roles`, `iam.scopes`, `iam.role_scopes` : RBAC local
- `apps.application` / `apps.deployment` : applications **déployées sur ce Hub**
  (= ses propres apps, pas d'autres Socles distantes)
- `apps.repository_source` (depuis v2.5.0) : sources externes de **catalogues
  d'apps** signés Ed25519 — c'est le mécanisme de distribution Editor → Client,
  pas une liste de Socles éditables par un user.

**Recommandation** : avant de coder un endpoint, on doit décider l'architecture.
Trois options :

#### Option A — Le Hub devient registre central de N Socles

Ajouter un schéma `socles` côté Hub avec table `socles.instance`
(`x_id`, `label`, `url`, `version`, `environment`, `auth_strategy`, …) +
`socles.user_access` (qui peut éditer quoi). L'endpoint
`GET /iam/me/socles` lit cette jonction.

- ✅ Modèle propre, source de vérité unique côté Hub
- ❌ ~2-3 jours de dev structurant + UI admin pour gérer ces Socles + flow
  d'enrôlement (échange clés publiques, etc.)
- ❌ Le Hub devient un single point of failure pour ApplicationEditors

#### Option B — La liste vient d'ailleurs

ApplicationEditors a sa propre source de vérité (config locale, BDD, autre
service). Le Hub ne fait que l'auth user.

- ✅ Hub minimal, dev rapide
- ❌ Ré-implémentation côté ApplicationEditors d'un mini-IAM "qui peut quoi"
- ❌ Si vous avez 20 Socles, il faut maintenir cette liste à 20 endroits

#### Option C — Hybride : `apps.repository_source` réutilisée

On étend `apps.repository_source` (qui contient déjà `name`, `url`,
`enabled`, `priority`, `auth_vault_path`, `last_sync_at`…) pour aussi
porter les Socles éditables. L'endpoint `GET /iam/me/socles` ferait un
filtre par scopes de l'user (claim `scopes` JWT). Le delta côté Hub :
~½ journée + ajout colonnes `editable`, `editor_scopes`.

- ✅ Réutilise l'existant Repository Platform v2
- ✅ Le mécanisme de signature Ed25519 existant donne déjà la confiance
  Hub → Socle
- ⚠️ Sémantique mixte : `repository_source` était pensée pour des
  catalogues d'apps, pas pour des éditeurs. Risque de confusion.

**Ma recommandation** : **Option A** si le projet ApplicationEditors a une
durée de vie longue (> 6 mois) et plusieurs équipes. **Option C** si on est
sur du PoC / itération courte. Option B uniquement en attendant qu'on tranche.

**À ton retour, je peux commiter le fix dans une v2.7.0 (vu l'ampleur, pas en
v2.6.x).**

Format de réponse proposé pour `GET /iam/me/socles` (option A ou C) :

```json
{
  "count": 3,
  "socles": [
    {
      "id":          "appdemo-prod",
      "label":       "AppDemo Production",
      "url":         "https://appdemo.thesocle.io",
      "version":     "5.5.1",
      "environment": "production",
      "rights": {
        "read":  true,
        "write": true,
        "fileTypes": {
          "*.jdm.json": "rw",
          "*.java":     "ro",
          "*.md":       "rw"
        }
      },
      "publicKeyUrl": "https://appdemo.thesocle.io/iam/jwks.json"
    }
  ]
}
```

---

### Q-SOCLES.2 — Format de la réponse

Voir réponse intégrée dans Q-SOCLES.1 (format proposé).

---

### Q-SOCLES.3 — Pagination

🤔 **À discuter** — selon l'option choisie en Q-SOCLES.1.

Ma préférence : **pagination à partir de 50 entrées**, pas avant. Format :
```
GET /iam/me/socles?limit=50&offset=0
```
Tant qu'on est sous 50 Socles par user, on renvoie tout sans pagination —
ça simplifie le client.

---

## 3. Authentification ApplicationEditors → Socle cible

### Q-PROXY.1 — Mécanisme d'authentification

🤔 **À discuter** — les 3 options sont possibles, voici mon analyse :

#### (a) Federation (JWT du Hub validé par chaque Socle)

✅ **Le plus propre, faisable techniquement**

Chaque Socle valide le JWT en fetchant `https://admin.thesocle.net/iam/jwks.json`
(ou un mirror local de la clé publique). Le Hub a déjà l'endpoint JWKS.

- ✅ Pas de stockage de secret partagé côté ApplicationEditors
- ✅ Audit naturel : la Socle voit le `sub`/`email` du user dans le JWT
- ⚠️ Les Socles cibles doivent implémenter le côté validation → ce n'est PAS
  fait aujourd'hui dans la Socle V005 standard. Il faut ajouter un
  `OidcAuthFilter` côté V005 (pareil que celui du Hub mais en mode
  validation seule, pas émission).
- ⚠️ Couplage : si la clé du Hub tourne, toutes les Socles doivent
  refetcher le JWKS. Si le Hub est down, plus aucune Socle n'authentifie.

#### (b) Bridge keys

🤔 Possible mais lourd

Chaque Socle a une clé d'API distincte, stockée par ApplicationEditors. Pour
N Socles → N clés à gérer.

- ✅ Indépendance : si une clé est compromise, on régénère pour cette Socle
  uniquement
- ❌ ApplicationEditors devient un coffre de secrets — risque de fuite
- ❌ Pas de notion de "user" côté Socle (la clé est partagée entre tous les
  users d'ApplicationEditors qui ont accès à cette Socle)
- ❌ Audit dégradé (X-Editor-User devient le seul moyen de tracer qui a édité)

#### (c) Token court délégué — endpoint `/iam/socle-token`

✅ **Ma recommandation**

Le Hub émet à la demande un token spécifique à une Socle, scopé en
audience et durée courte.

Existence : 🚧 **N'existe pas aujourd'hui**, à développer.

Proposition d'endpoint :
```
POST https://admin.thesocle.net/iam/socle-token
Authorization: Bearer <Hub access token>
Content-Type: application/json

{ "socle_id": "appdemo-prod", "scope": "repository:write" }
```

Réponse :
```json
{
  "token":      "eyJhbGciOiJSUzI1NiIs...",
  "expiresAt":  "2026-04-29T13:35:00Z",
  "expiresIn":  300,
  "audience":   "appdemo-prod",
  "issuer":     "soclehub",
  "userSub":    "<UUID>",
  "userEmail":  "jmh@lmvi.eu"
}
```

Le token a `aud=appdemo-prod` (donc rejeté par les autres Socles). TTL 5 min
typiquement, l'app le refetch quand il expire.

- ✅ Audit complet (le token contient `userSub` + `userEmail`)
- ✅ Couplage léger : la Socle valide juste audience + signature, pas de
  state partagé
- ✅ Révocation : le Hub peut blacklister un user et tous ses futurs tokens
  (le Hub-side)
- ⚠️ Demande dev côté Hub (~½ jour) ET côté Socle V005 (`OidcAuthFilter`
  mode validation, ~½ jour). Mais c'est un investissement réutilisable.

**Délai estimé** :
- Côté Hub : 1 jour (endpoint `/iam/socle-token` + persistance audit)
- Côté Socle V005 (framework) : 1 jour (filter validation)
- ⇒ **2 jours total** à coordonner avec l'équipe framework V005.

---

### Q-PROXY.2 — Si option (b) bridge keys

Si on retient (b) malgré tout :
- Stockage côté Hub : Vault à `secret/soclehub/socles/{socle_id}/api_key`
- Récupération via une route admin `GET /admin/socles/{id}/api-key` (réservé
  ROLE_ADMIN)

Mais comme dit en Q-PROXY.1, je déconseille cette option.

---

### Q-PROXY.3 — Si option (c) token délégué

🚧 **N'existe pas** — voir détails dans Q-PROXY.1 ci-dessus.

**Délai pour l'avoir** : 2 jours dev (Hub + framework V005), à coordonner.

Si vous voulez démarrer ApplicationEditors immédiatement sans attendre :
**option (a) Federation** comme étape transitoire (le Hub a déjà JWKS, les
Socles V005 peuvent ajouter un filter trivial), avec passage à (c) plus
tard pour les tokens court-vie.

---

## 4. Droits granulaires

### Q-DROITS.1 — Granularité

🟡 **Partiellement** — granularité existe mais pas par-fichier.

Aujourd'hui :
- `iam.scopes` : liste plate de noms de permissions (ex `app:appdemo:user`,
  `app:appdemo:admin`, `repository:write`, `mcp:bugs:write`, etc.)
- `iam.role_scopes` : associe un rôle à des scopes
- `iam.user_roles` : associe un user à des rôles
- Les scopes finaux sont dans le JWT claim `scopes`

**Ce qu'on a** : oui/non global par Socle (via le scope `app:<socleId>:user`)
ou granularité par "rôle métier" (`admin` / `editor` / `viewer` / `user`).

**Ce qu'on n'a PAS** : "X peut écrire les .jdm.json mais lire seulement les
.java sur la Socle Y". C'est trop fin pour le modèle actuel.

**Recommandation** : déplacer cette granularité **côté Socle V005** elle-même.
Le Hub donne juste un scope général, et la Socle (où le Repository V005 vit
réellement) gère la matrice fileType×operation. Sinon le Hub doit dupliquer
toute la connaissance des structures internes des Socles, ce qui fragilise.

🚧 **À développer** côté Socle V005 si on veut cette granularité —
estimation 2-3 jours pour ajouter un `RepositoryAccessControl` qui mappe
(user, fileType, operation) → allow/deny.

---

### Q-DROITS.2 — Format

Si on décide de mettre la matrice côté Hub, format proposé pour
`GET /iam/me/socles` :

```json
{
  "id":    "appdemo-prod",
  "label": "AppDemo Production",
  "rights": {
    "default":  "ro",
    "fileTypes": {
      "*.jdm.json":  "rw",
      "scripts/**":  "rw",
      "**/*.java":   "ro",
      "**/.git/**":  "deny"
    }
  }
}
```

Convention : `default` s'applique aux fichiers qui ne matchent aucun pattern.
`fileTypes` est un dict glob → mode (`rw` / `ro` / `deny`).

---

## 5. Identité utilisateur côté Socle (audit)

### Q-AUDIT.1 — Header d'identité

🚧 **N'existe pas aujourd'hui** côté framework V005.

**Sans federation/délégation** (option (b) bridge keys), il FAUT un header
d'identité distinct, sinon la Socle ne sait pas qui édite. Ma proposition :

```http
X-Socle-User:    jmh@lmvi.eu
X-Socle-User-Id: <UUID>
X-Socle-Source:  ApplicationEditors/1.0
```

`X-Socle-User-Id` est plus fiable que l'email (les emails peuvent changer,
les UUIDs jamais).

**Avec option (a) Federation ou (c) Token délégué** : l'identité est dans le
JWT (`sub` + `email`). Pas besoin de header séparé. Le framework V005 doit
juste extraire ces claims pour les logger.

**Implémentation côté V005** :
- Si l'auth est par JWT : un `AuditFilter` qui lit les claims et pose un MDC
  Log4j2 (`%X{user}` dans le pattern).
- Si l'auth est par bridge key : le filter lit `X-Socle-User-*` et idem MDC.

🚧 **Délai** : ~1 jour dev framework V005.

> ⚠️ **Important pour la sécurité** : si vous utilisez le header
> `X-Socle-User` SANS auth JWT (option b bridge keys), la Socle doit traiter
> cet en-tête comme **hint d'audit non vérifié** (un attaquant peut le
> spoofer). L'auth d'autorité reste la bridge key. Le header est
> informationnel pour les logs, c'est tout.

---

## 6. Liens vers la documentation existante

| Sujet | URL / chemin |
|-------|--------------|
| Code source AuthController | `soclehub/src/main/java/eu/lmvi/soclehub/controller/AuthController.java` |
| Code source IamService | `soclehub/src/main/java/eu/lmvi/soclehub/service/IamService.java` |
| Code source OidcController | `soclehub/src/main/java/eu/lmvi/soclehub/controller/OidcController.java` |
| Code source IamPublicController | `soclehub/src/main/java/eu/lmvi/soclehub/controller/IamPublicController.java` |
| Repo GitHub | `git@github.com:jmlmvi/V005-HubTheSocle-Gateway.git` |
| Discovery OIDC | `GET https://admin.thesocle.net/.well-known/openid-configuration` |
| JWKS | `GET https://admin.thesocle.net/iam/jwks.json` |
| Validation token (debug) | `GET https://admin.thesocle.net/iam/validate` |
| Doc OpenAPI / Swagger Hub | `GET https://admin.thesocle.net/swagger-ui/index.html` |
| WhoAmI projet | `docs/WhoAmI/01-ARCHITECTURE.md` |
| Standards IAM internes | (pas de doc dédiée — à écrire) |

---

## Synthèse — décisions à prendre côté ApplicationEditors

Pour démarrer rapidement, voici les choix qui débloquent :

| Décision | Mes recommandations | Délai si recommandé |
|----------|---------------------|---------------------|
| Q-SOCLES.1 architecture | **Option C** (réutiliser `apps.repository_source` étendu) si PoC court ; **Option A** sinon | 0.5 jour (C) ou 2-3 jours (A) |
| Q-PROXY.1 auth Socle cible | **(c) Token délégué court** | 2 jours (Hub + V005 framework) |
| Q-AUTH.9 CORS | Ajouter `CorsConfigurationSource` config-driven | 30 min |
| Q-DROITS granularité | Garder global Socle pour v1, déplacer la matrice fileType côté Socle V005 plus tard | 0 jour pour v1 |
| Q-AUDIT.1 header | Pas de header custom — utiliser claims JWT du token délégué | 0 jour si Q-PROXY.1=c |

**Si vous validez ces choix, le delta côté Hub est ~3 jours de dev** pour livrer
v2.7.0 avec :
- CORS configurable
- Endpoint `GET /iam/me/socles`
- Endpoint `POST /iam/socle-token`
- Doc IAM dédiée

À ton signal et après confirmation des choix, je planifie ça.

---

**Contact** : équipe SocleHub — jm@henry.sh
**Version Hub testée** : v2.6.3 (framework socle-v005:5.5.1, build 2026-04-29)
