---
id: HOWTO-03
titre: "Installer une application depuis le catalogue, et comprendre les six étapes"
theme: "APP · Cycle de vie des applications"
surface: [docker_worker, AppInstallPipeline, InstallRequest, InstallState, app_registry_worker, catalog_sync_worker, SsoFilter, DockerService, PortalDashboardController]
tables: [apps.application, apps.deployment, apps.app_volume, apps.proxy_route, apps.repository_source, apps.repository_catalog_cache]
actions_mcp: 1
routes: ["/api/actions/docker_worker/install_app", "/api/actions/jobs/{jobId}", "/hub/apps/install"]
etat_verifie:
  hub: "3.70.3"
  socle: "5.9.4"
  le: "2026-10-16"
  comment: "relu au code ; noms de conteneurs, schéma d'action et amorçage SQL corrigés"
voisins: [HOWTO-04, HOWTO-05, HOWTO-07, HOWTO-43]
---

# HOWTO 03 — Installer une application depuis le catalogue

> **Niveau** : intermédiaire | **Prérequis** : SocleHub démarré, PostgreSQL et Vault opérationnels, zone DNS configurée, accès admin Hub | **Temps estimé** : 5-15 min selon l'app

État de référence : **Hub 3.70.3**, socle **5.9.4**, relu au code le **2026-10-16**.

Ce guide montre comment installer une application (WordPress, Gitea, MinIO Console, etc.) sur SocleHub en s'appuyant sur le **pipeline d'install à 6 stages** ([[60-pipeline-install]]) orchestré par l'action `install_app` du [[30-docker-worker|DockerWorker]]. Il couvre les deux sources possibles : le **catalogue local** (`catalog.json` embarqué dans l'image SocleHub) et les **catalogues distants** synchronisés via le [[32-catalog-sync-worker|CatalogSyncWorker]] depuis des sources Repository signées Ed25519.

---

## Questions auxquelles répond cette fiche

1. Comment lister les applications installables, et d'où viennent-elles ?
2. Quels paramètres `install_app` accepte-t-il réellement — et lesquels ne figurent pas dans son schéma MCP ?
3. Pourquoi mon appel renvoie-t-il un `jobId` au lieu du résultat de l'installation ?
4. Comment suivre une installation en cours, étape par étape ?
5. Quelles sont les six étapes du pipeline, et que défait chacune en cas d'échec ?
6. Comment s'appelle le conteneur créé pour mon application, et où sont ses logs ?
7. Qu'est-ce que l'autofill, et comment surcharger une valeur qu'il remplit ?
8. Quel mode SSO choisir entre `none`, `gate`, `optional` et `required` ?
9. À quoi sert le paramètre `tenant`, et que se passe-t-il si le quota est atteint ?
10. Pourquoi l'installation échoue-t-elle avec « Aucune IP serveur configurée » ?
11. Pourquoi un `app_id` est-il refusé alors que l'app n'apparaît nulle part ?
12. Pourquoi le conteneur démarre-t-il puis s'arrête-t-il aussitôt ?
13. Que faire quand le certificat TLS n'a pas été obtenu — est-ce bloquant ?
14. Pourquoi la table `apps.proxy_route` n'existe-t-elle pas sur une installation neuve ?
15. Pourquoi le cache HTTP reste-t-il inactif malgré `cache_enabled: true` ?
16. Que reste-t-il derrière une installation qui a échoué, et qu'il faut nettoyer soi-même ?

## Mots-clés

installer une app, `install_app`, catalogue, `catalog.json`, `list_catalog`, catalogue distant,
`apps.repository_catalog_cache`, source Repository, signature Ed25519, pipeline d'installation,
six étapes, `stageValidate`, `stageProvision`, `stageNetwork`, `stageDocker`, `stageRouting`,
`stageRegister`, compensation, rollback, `InstallState`, `[install:appId][stage:N/6]`,
mode asynchrone, `ExecutionMode.ASYNC`, 202 Accepted, `jobId`, `/api/actions/jobs/`,
autofill, `db.host`, `db.password`, `redis.url`, `vault.<clé>`, `envTemplate`, `env_vars`,
surcharge utilisateur, SSO, `none`, `gate`, `optional`, `required`, `SsoFilter`, cookie `sso_gate_`,
`sso_protected_paths`, tenant, quota `max_apps`, StrictMode P4, `TenantSuspendedException`,
provisionnement, Vault, schéma PostgreSQL, base MariaDB, Redis, DNS, certificat ACME,
route proxy, `tls_enabled`, cache HTTP, `cache_preset`, `performance`, `balanced`, `fresh`,
Flyway, `init-schemas.sql`, nom du conteneur, volume `soclehub-<app>-<volume>`,
`SERVER_IP`, `SOCLEHUB_SERVER_IP`, DNS orphelin, certificat orphelin

---

## 1. Contexte

L'opérateur Hub a besoin de déployer rapidement une application tierce sans écrire de Docker Compose, sans configurer manuellement DNS, certificat TLS, base de données, secrets Vault et route proxy. Sur un Hub multi-tenant typique, on installe entre 5 et 30 apps (WordPress clients, Gitea interne, OnlyOffice, MinIO, etc.) et chaque install représente plusieurs heures de travail si on enchaîne les commandes manuellement.

Le pipeline `AppInstallPipeline` automatise toute la chaîne : il valide l'unicité, provisionne la BDD et Vault, crée le record DNS Cloudflare, demande le certificat ACME, pull et démarre le container Docker, configure la route proxy avec le mode SSO choisi et persiste l'application en base. En cas d'échec à n'importe quel stage, il **compense automatiquement** les stages déjà complétés (rollback inverse). Le résultat est qu'une commande POST de 8 paramètres remplace une procédure de 30 minutes.

Le pipeline doit :

- Refuser les `app_id` ou subdomain déjà pris (validation),
- Provisionner DB + Vault + Redis (si requis par le catalog),
- Créer le record DNS et obtenir le certificat TLS via ACME,
- Pull l'image (avec auth si registry privé), créer + démarrer le container,
- Inscrire la route dans le proxy + activer le SSO si mode != none,
- Persister `apps.application` + `apps.deployment` + `apps.app_volume`,
- Rollback complet si un stage échoue.

---

## 2. Architecture

Le trajet d'une installation est linéaire et tient en quatre maillons. Un appel
`install_app` arrive par REST, par MCP ou par le wizard du portail, et atteint le `DockerWorker`,
qui ne fait presque rien lui-même : il assemble un `InstallRequest` et le confie à
l'`AppInstallPipeline`. Celui-ci enchaîne six étapes — valider, provisionner (Vault, PostgreSQL ou
MariaDB, Redis), réseau (enregistrement DNS et certificat), Docker (récupérer l'image, créer et
démarrer le conteneur), routage (table de routage en mémoire et `apps.proxy_route`), puis
enregistrement (`apps.application`, `apps.deployment`, `apps.app_volume`) — en défaisant en ordre
inverse les étapes déjà franchies si l'une échoue. Le `ProxyWorker` lit ensuite la table de routage
et dirige le trafic HTTPS du 443 vers l'adresse du conteneur sur le réseau `soclehub-net`.

```
                      ┌────────────────────────────────────────┐
                      │          POST /api/actions/            │
                      │    docker/install_app  (REST/MCP/IHM)  │
                      └───────────────────┬────────────────────┘
                                          │
                                          ▼
                  ┌──────────────────────────────────────────┐
                  │          DockerWorker (priorité 70)      │
                  │  handleInstallApp() construit            │
                  │  un InstallRequest puis délègue au       │
                  │  AppInstallPipeline                      │
                  └───────────────────┬──────────────────────┘
                                      │
                                      ▼
       ┌────────────────────────────────────────────────────────────┐
       │                  AppInstallPipeline (6 stages)             │
       │                                                            │
       │  1.validate ─→ 2.provision ─→ 3.network ─→ 4.docker ─→     │
       │              │             │            │                  │
       │              ▼             ▼            ▼                  │
       │            Vault       Cloudflare    pull+create+start     │
       │            Postgres    ACME (TLS)    +container_ip         │
       │            MariaDB                                         │
       │            Redis                                           │
       │                                                            │
       │           5.routing ─→ 6.register                          │
       │              │             │                               │
       │              ▼             ▼                               │
       │     ProxyRoutingTable  apps.application                    │
       │     IamWorker(role)    apps.deployment                     │
       │                        apps.app_volume                     │
       └────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
       ┌────────────────────────────────────────────────────────────┐
       │  ProxyWorker (priorité 80) lit ProxyRoutingTable et        │
       │  route le trafic HTTPS reçu sur :443 vers le container     │
       │  via son IP réseau soclehub-net (ex. 172.18.0.42:80)       │
       └────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Choisir l'app dans le catalogue

Le Hub agrège deux sources :

- **Catalog local** : `/opt/2026-TheHub4TheSocle/soclehub/catalog.json` (embarqué dans l'image, exposé par l'action `list_catalog` du [[31-app-registry-worker|AppRegistryWorker]], worker `app_registry_worker`),
- **Catalogues distants** : table `apps.repository_catalog_cache` remplie par le [[32-catalog-sync-worker|CatalogSyncWorker]] toutes les 6h depuis les sources `apps.repository_source`.

Lister les apps disponibles via REST (le `GET /api/actions` est public ; l'exécution d'action POST nécessite une clé API). Le worker est exposé sous son `getName()` = `app_registry_worker` :

```bash
curl -s -X POST -H "X-Api-Key: $API_KEY" http://localhost:8080/api/actions/app_registry_worker/list_catalog | jq '.data.apps[] | {appId, name, dockerImage}'
```

Filtrer le manifest distant :

```bash
curl -s http://localhost:8080/hub/repository/catalog.json | jq '.apps[] | select(.appId=="wordpress") | {appId, name, dockerImage}'
```

Lecture de la fiche `wordpress` dans `catalog.json` (extrait, format `CatalogApp`) :

```json
{
  "appId" : "wordpress",
  "name" : "WordPress",
  "description" : "CMS open-source",
  "dockerImage" : "wordpress",
  "dockerTags" : [ "latest", "6.7" ],
  "portInternal" : 80,
  "dbType" : "mysql",
  "volumes" : [ { "name" : "html", "containerPath" : "/var/www/html" } ],
  "ssoMode" : "gate",
  "envTemplate" : [
    { "name" : "WORDPRESS_DB_HOST", "autofill" : "db.host" },
    { "name" : "WORDPRESS_DB_NAME", "autofill" : "db.database" },
    { "name" : "WORDPRESS_DB_USER", "autofill" : "db.user" },
    { "name" : "WORDPRESS_DB_PASSWORD", "autofill" : "db.password" }
  ]
}
```

**Points clés** :

- `dbType: "mysql"` déclenche stage 2 → `databaseProvisioningService.createMariadbDatabase()`,
- `ssoMode: "gate"` → toutes les requêtes du subdomain seront forcées via OIDC,
- les `envTemplate` avec `autofill: "db.host"` sont remplis automatiquement par le pipeline (cf. `AppInstallPipeline.resolveAutofill`).

---

## 4. Étape 2 — Lancer l'install via REST

L'action est `ASYNC` : le serveur renvoie un `jobId` immédiatement, l'install tourne en arrière-plan.

```bash
curl -X POST http://localhost:8080/api/actions/docker_worker/install_app \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -d '{
    "app_id": "wp-acme",
    "catalog_app_id": "wordpress",
    "subdomain": "blog-acme",
    "docker_tag": "6.7",
    "sso_mode": "gate",
    "env_vars": {
      "WORDPRESS_TABLE_PREFIX": "acme_",
      "WORDPRESS_DEBUG": "0"
    },
    "cache_enabled": true,
    "cache_preset": "balanced"
  }'
```

Réponse 202 Accepted :

```json
{
  "status": "accepted",
  "jobId": "job-7f3a2b1e",
  "worker": "docker",
  "action": "install_app"
}
```

Suivre la progression :

```bash
curl -s http://localhost:8080/api/actions/jobs/job-7f3a2b1e | jq
```

Pendant l'exécution, les logs `[install:wp-acme][stage:N/6]` apparaissent dans les logs du Hub.
**Le conteneur du Hub s'appelle `soclehub`** — pas `soclehub-app` :

```bash
docker logs -f soclehub 2>&1 | grep "\[install:wp-acme\]"
```

**Paramètres acceptés par `install_app`** — la colonne « schéma » dit si le paramètre est **déclaré
dans les métadonnées de l'action**, donc visible dans `tools/list` et dans l'OpenAPI :

| Paramètre | Type | Requis | Schéma | Description |
|-----------|------|--------|--------|-------------|
| `app_id` | string | oui | ✅ | Identifiant unique kebab-case. **C'est le nom du conteneur tel quel** (`wp-acme`, pas `soclehub-wp-acme`), et la racine du schéma DB et du chemin Vault |
| `catalog_app_id` | string | oui | ✅ | Référence dans le catalogue agrégé |
| `subdomain` | string | oui | ✅ | Préfixe ou FQDN complet (ex. `blog` ou `blog.thesocle.net`) |
| `docker_tag` | string | non | ✅ | Tag Docker, défaut `latest` |
| `tenant` | string | non | ✅ | Tenant propriétaire. **Vérifié avant toute installation** : tenant actif et quota `max_apps` non atteint, sinon refus immédiat. Sans `tenant`, l'installation est « plateforme » et échappe au contrôle |
| `sso_mode` | string | non | 🔴 **non** | `none` / `optional` / `gate` / `required`. Défaut = valeur du catalogue |
| `env_vars` | object | non | 🔴 **non** | Surcharges de variables d'environnement (priorité sur l'autofill) |
| `cache_enabled` | bool | non | 🔴 **non** | Active le cache HTTP devant le proxy |
| `cache_preset` | string | non | 🔴 **non** | `performance` / `balanced` / `fresh` |
| `additional_subdomain_0..9` | string | non | 🔴 **non** | Sous-domaines additionnels (ex. S3 sur 9000 pour MinIO) |
| `sso_protected_paths` | string | non | 🔴 **non** | Surcharge des chemins protégés par le SSO |

🔴 **Les six derniers fonctionnent mais ne sont pas découvrables.** `handleInstallApp` les lit bien
(`params.getString("sso_mode")`, `params.get("env_vars")`, la boucle sur
`additional_subdomain_0..9`…), mais `ActionMetadata` n'en déclare que **cinq** paramètres. Un agent
qui lit le schéma MCP ne peut donc pas savoir qu'il a le droit de choisir le mode SSO ou de passer
des variables d'environnement : il installera tout au mode du catalogue, sans jamais voir l'option.
Même conséquence côté OpenAPI et côté validation — rien ne refuse un paramètre mal orthographié,
il est simplement ignoré en silence. Jusqu'à ce que les métadonnées soient complétées, **cette
table est la seule référence**.

---

## 5. Étape 3 — Variante IHM portail

Le portail Hub propose un wizard à `/hub/apps/install` qui pousse les mêmes paramètres :

```
Browser ──→ GET  https://admin.thesocle.net/hub/apps/install
         ←── HTML wizard (catalog filtrable + form)

Browser ──→ POST https://admin.thesocle.net/hub/apps/install
         (multipart : catalog_app_id, app_id, subdomain, ...)

PortalDashboardController.installApp(...) construit ActionParameters
  identiques au curl ci-dessus puis appelle dockerWorker.executeAction("install_app", ...)
```

L'UI affiche les champs `envTemplate.fieldType` (string / select / hidden) en respectant `autofill` (les champs marqués `hidden` ne sont pas demandés à l'utilisateur, ils sont remplis par le pipeline).

---

## 6. Étape 4 — Comprendre les 6 stages

Référence : `/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/pipeline/AppInstallPipeline.java`

### Stage 1 — Validate (`stageValidate`)

```sql
SELECT COUNT(*) FROM apps.application WHERE app_id = ? OR subdomain = ?;
```

Si `> 0`, jette `IllegalStateException`. Aucune compensation (rien créé).

### Stage 2 — Provision (`stageProvision`)

Provisionne Vault ([[11-vault-worker]]) et la base ([[44-db-worker]]) :

- `vaultService.createAppPath(appId)` → crée `soclehub/apps/<app_id>/` dans Vault,
- selon `dbType` :
  - `postgres` → `databaseProvisioningService.createPostgresSchema(appId)` retourne `{schema, user, password, jdbcUrl}`,
  - `mysql` / `mariadb` → `createMariadbDatabase(appId)` retourne `{database, user, password, jdbcUrl}`,
  - `none` → skip,
- si `redisRequired: true` → `redisProvisioningService.allocateRedisDb(appId)` retourne `{host, port, database, password}`.

Compensation : drop schema/database, deallocate Redis, delete Vault path.

### Stage 3 — Network (`stageNetwork`)

- résout l'IP serveur via `SOCLEHUB_SERVER_IP` env var ou `soclehub.server-ip` Spring property (fail-fast si aucune des deux),
- crée le record DNS A : `cloudflareService.createRecord(zoneId, "A", fqdn, serverIp, 300, true)` (proxied),
- demande le certificat ACME : `acmeService.requestCertificate(fqdn)` (échec → utilise le wildcard du Hub, log warning),
- pour chaque `additionalPort` du catalog : record DNS + certif additionnels.

Compensation : 🔴 **aucune, en pratique**. `compensateNetwork()` se contente de journaliser
`DNS record for <fqdn> should be manually removed` — il n'a pas conservé l'identifiant de
l'enregistrement, donc il ne peut pas le supprimer. Et le drapeau `tlsCertObtained` n'est consulté
par aucune compensation. **Un échec survenu après cette étape laisse donc un enregistrement DNS et
un certificat orphelins**, à nettoyer soi-même (cf. piège 11).

### Stage 4 — Docker (`stageDocker`)

- Construit `envVars` : `APP_ID`, `APP_BASE_URL`, credentials DB/Redis, `VAULT_ADDR`, `IAM_JWKS_URL` (si app type `thesocle`),
- Résolution **autofill data-driven** : pour chaque `EnvTemplate.autofill` (`db.host`, `db.password`, `redis.url`, `vault.<key>`...), résout depuis l'état pipeline,
- Mémoire : selon `runtime` (java/node/php/go), injecte `JAVA_OPTS=-Xmx{N}m -Xms{N/2}m -XX:+UseG1GC`, `NODE_OPTIONS=--max-old-space-size={N}`, etc.,
- `dockerService.pullImage(image, tag)` (avec auth si match dans `apps.repository_source.registry_url`),
- `dockerService.createContainer(...)` retourne containerId. **Si vide → throw** (fix BUG-2026-04-23 : sans cette vérif, image inexistante = faux succès),
- `dockerService.startContainer(containerId)`, récupère l'IP réseau soclehub-net.

Compensation : stop + remove container.

### Stage 5 — Routing (`stageRouting`)

- `routingTable.put(fqdn, ProxyRoute)` en mémoire (consommé par `ProxyWorker`),
- `INSERT INTO apps.proxy_route (...)` avec `proxy_protocol`, `tls_enabled=true`, `sso_enabled`, `sso_scope='app:<appId>'`,
- Si `cache_enabled` : sérialise `CachePolicy` dans `apps.proxy_route.datas` JSONB,
- Si `sso_mode != none` : `iamWorker.create_role("app:<appId>:user")` + `assign_scope_to_role("admin", "app:<appId>")`.

Compensation : remove from routingTable + DELETE FROM apps.proxy_route.

### Stage 6 — Register (`stageRegister`)

- `INSERT INTO apps.application (...) RETURNING x_id`,
- `INSERT INTO apps.deployment (action='install', to_version, status='success')`,
- `INSERT INTO apps.app_volume` (un par `volumes[]` du catalog).

Pas de compensation (dernier stage, succès garanti à ce point).

---

## 7. Étape 5 — Configuration data-driven (autofill)

Le pipeline résout 3 préfixes d'autofill (cf. `AppInstallPipeline.resolveAutofill`) :

```java
// Extrait — résolution autofill
if (autofill.startsWith("db.")) {
    Map<String, String> creds = state.getDbCredentials();
    String key = autofill.substring(3);
    switch (key) {
        case "host":     return "mariadb"; // ou "postgres"
        case "port":     return "3306";    // ou "5432"
        case "database": return creds.get("database");
        case "user":     return creds.get("user");
        case "password": return creds.get("password");
        case "url":      return creds.get("jdbcUrl");
    }
}
if (autofill.startsWith("redis.")) { /* host, port, database, password, url */ }
if (autofill.startsWith("vault.")) { /* lit soclehub/apps/<appId>/<key> */ }
```

**Le user peut surcharger** un autofill en passant `env_vars: { "WORDPRESS_DB_HOST": "external-db.example.com" }` dans la requête : `userEnvVars` est appliqué après autofill (cf. ligne 404 de `AppInstallPipeline`).

---

## 8. Étape 6 — Choix du mode SSO

Le `SsoFilter` du Hub implémente **4 modes** (référence : `soclehub/src/main/java/eu/lmvi/soclehub/filter/SsoFilter.java` ; vue d'ensemble du SSO/OIDC : [[71-sso-oidc]]) :

| Mode | Comportement | Usage typique |
|------|--------------|---------------|
| `none` | Bypass total — pas de validation, pas de cookie strip. Le proxy forward tel quel. L'app gère sa propre auth. | MinIO API S3, apps publiques |
| `gate` | Vérifie le SSO **une fois** à la première requête. Pose un cookie `sso_gate_<appId>` HMAC-signé (TTL 15 min). Toutes les requêtes suivantes (XHR, API, WebSocket) bypassent le filter pour ne pas casser les apps tierces avec auth interne. Le cookie `soclehub_token` est strip avant forward. | pgAdmin, n8n, WordPress, Uptime Kuma |
| `optional` | Valide le JWT s'il est présent (Bearer header ou cookie `soclehub_token`). Si absent ou invalide → laisse passer en anonyme. Si valide → injecte les claims dans `request.attributes` pour les controllers en aval. | Apps qui veulent connaître l'utilisateur sans imposer le login (ex. dashboard public + zone connectée) |
| `required` | Valide le JWT à **chaque requête**. Si absent ou invalide → redirect `/iam/login`. Vérifie aussi le scope `route.getSsoScope()` si défini → 403 si manquant. | Apps internes LMVI avec auth 100% Hub (SmartReach, CNX2Notion) |

Le mode peut être :

1. **Imposé par le catalog** (`catalog.ssoMode`),
2. **Surchargé par la requête** (`sso_mode` param),
3. **Affiné par chemin** (`sso_protected_paths`) : ex. `^/wp-admin.*` pour ne protéger que l'admin de WordPress.

Si `sso_mode != none`, le pipeline appelle `IamWorker.create_role("app:<appId>:user")` automatiquement (idempotent — log warning si role existe déjà).

**Note** : un 5ème mode `oidc` (proxy transparent + l'app gère elle-même OAuth2 contre le Hub) est proposé dans la spec V2-Specs4Appli mais **pas encore implémenté** — il dépend du provider OIDC complet du Hub (endpoints `/oidc/authorize`, `/oidc/token`, `/oidc/userinfo`). En attendant, les apps avec OIDC natif (Gitea, Grafana, Nextcloud) sont installées en mode `none` ou `gate`.

---

## 9. Validation

### Vérifier que l'install a réussi

```bash
# Statut applicatif
curl -s -X POST http://localhost:8080/api/actions/docker_worker/get_app \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -d '{"app_id": "wp-acme"}' | jq
```

Réponse attendue :

```json
{
  "success": true,
  "data": {
    "app_id": "wp-acme",
    "app_name": "WordPress",
    "subdomain": "blog-acme.thesocle.net",
    "container_id": "abc123def456...",
    "container_running": true,
    "status": "running",
    "db_type": "mysql",
    "sso_mode": "gate"
  }
}
```

### Vérifier la BDD

```sql
-- Application persistée
SELECT app_id, app_name, status, subdomain, container_id, sso_mode, x_dateCreated
FROM apps.application WHERE app_id = 'wp-acme';

-- Deployment log
SELECT action, to_version, status, x_dateCreated
FROM apps.deployment d
JOIN apps.application a ON a.x_id = d.id_application
WHERE a.app_id = 'wp-acme';

-- Route proxy
SELECT hostname, target_host, target_port, sso_mode, status
FROM apps.proxy_route WHERE app_id = 'wp-acme';

-- Volumes
SELECT volume_name, container_path FROM apps.app_volume WHERE app_id = 'wp-acme';
```

### Vérifier le proxy depuis le navigateur

```bash
# Health interne
curl -k -H "Host: blog-acme.thesocle.net" https://localhost/wp-login.php
# Attendu : 200 OK ou redirect SSO si mode=gate

# DNS
dig +short blog-acme.thesocle.net
# Attendu : IP du serveur SocleHub
```

### Dashboard

Naviguer vers `https://admin.thesocle.net/hub/apps/wp-acme` :

- Onglet "Container" : container_id, état (running), CPU/memory en temps réel,
- Onglet "Proxy" : hostname, target, sso_mode, cache,
- Onglet "Logs" : sortie stdout/stderr du container.

---

## 10. Pièges courants

### Piège 1 — `Aucune IP serveur configurée`

**Symptôme** : stage 3 échoue avec `IllegalStateException: Aucune IP serveur configurée (ni SOCLEHUB_SERVER_IP env var, ni soclehub.server-ip)`.

**Cause** : ni la variable d'environnement `SOCLEHUB_SERVER_IP` ni la propriété Spring `soclehub.server-ip` ne sont définies. Fix BUG-2026-04-23 — le pipeline refuse de créer un record DNS avec une IP inventée.

**Résolution** : ajouter dans `/opt/2026-TheHub4TheSocle/soclehub/docker/.env` :

```bash
SERVER_IP=51.255.205.19
```

Puis `docker compose -f soclehub/docker/docker-compose.yml up -d soclehub`.

### Piège 2 — `app_id 'X' or subdomain 'Y' already exists`

**Symptôme** : stage 1 (validate) échoue immédiatement.

**Cause** : un INSERT précédent partiellement rollbacké a laissé une trace, ou l'app_id est réellement déjà installé.

**Résolution** : vérifier `SELECT * FROM apps.application WHERE app_id = ? OR subdomain = ?`. Si trace orpheline → `DELETE FROM apps.application WHERE ...` puis nettoyer manuellement le Vault path et la route proxy. Préférable : utiliser `uninstall_app` même sur une install partielle.

### Piège 3 — `Docker stage failed: container not created`

**Symptôme** : stage 4 échoue avec ce message après 30-60s. Le pipeline rollback proprement.

**Cause** : l'image Docker n'existe pas dans le registry, le tag est invalide, ou le daemon Docker est inaccessible. Sans le fix BUG-2026-04-23, le pipeline déclarait à tort un succès.

**Résolution** : vérifier l'image manuellement :

```bash
docker pull wordpress:6.7  # ou le tag voulu
```

Si registry privé : `docker login registry.thesocle.net` avec les creds du Vault path `soclehub/repository/sources/<source-name>`.

### Piège 4 — Container démarre puis crashe immédiatement

**Symptôme** : install renvoie success mais 30s plus tard `get_app` montre `container_running: false`.

**Cause** : env vars manquantes, autofill non résolu (ex. `db.host` mais `dbType: "none"`), volume non monté en lecture-écriture, ou app refuse `JAVA_OPTS` injectés.

**Résolution** :

```bash
docker logs wp-acme --tail 100   # le conteneur porte l'app_id tel quel
# chercher "FATAL" / "could not connect" / "permission denied"
```

Si autofill incorrect, corriger le `catalog.json` ou passer `env_vars` explicites.

### Piège 5 — Certificat TLS pas obtenu

**Symptôme** : navigateur affiche "Certificat invalide" sur `https://blog-acme.thesocle.net`. Logs : `Certificate request failed for blog-acme.thesocle.net`.

**Cause** : ACME challenge HTTP-01 a échoué (DNS pas encore propagé, port 80 non ouvert, rate-limit Let's Encrypt atteint).

**Résolution** : non bloquant — le pipeline continue avec le wildcard du Hub. Pour forcer un retry :

```bash
curl -X POST http://localhost:8080/api/actions/acme_worker/request_certificate \
  -H "Content-Type: application/json" \
  -d '{"domain": "blog-acme.thesocle.net"}'
```

### Piège 6 — Erreur SQL `relation "apps.proxy_route" does not exist`

**Symptôme** : stage 5 (routing) échoue dès le premier INSERT.

**Cause** : le schéma n'a pas été amorcé. Il y a **deux mécanismes**, et c'est leur articulation
qu'il faut comprendre avant de lancer quoi que ce soit à la main :

| Mécanisme | Quand il joue | Ce qu'il pose |
|---|---|---|
| `sql/init-schemas.sql`, monté sur `/docker-entrypoint-initdb.d/01-schemas.sql` | **une seule fois**, à la première création du volume PostgreSQL | les schémas et tables de base |
| **Flyway** (`classpath:db/migration`, `V001__…` → `V051__…`) | à chaque démarrage du Hub | les migrations incrémentales |

Il n'existe **pas de `01-bootstrap.sql`**. Et `init-schemas.sql` n'est rejoué par aucun
redémarrage : si le volume `postgres-data` existait déjà, Docker ignore le répertoire d'init en
entier, ce qui est le cas le plus fréquent de cette erreur.

**Résolution** : d'abord regarder ce que Flyway a réellement appliqué, avant d'exécuter du SQL à la
main — Flyway est configuré avec `baseline-on-migrate: true` et `baseline-version: 1`, donc sur une
base qui n'a pas d'historique il **saute V001** en le supposant déjà posé. C'est exactement le
scénario « installation neuve dont le volume a été recréé » :

```bash
docker logs soclehub 2>&1 | grep -i flyway | head -20
docker exec -it soclehub-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 10;'
```

Si l'historique commence à V002, c'est le baseline qui a sauté V001 : appliquer `init-schemas.sql`
une fois, à la main, puis redémarrer le Hub pour que Flyway reprenne la suite.

```bash
docker exec -i soclehub-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < soclehub/sql/init-schemas.sql
```

Vérifier ensuite : `\dt apps.*` doit lister `application`, `proxy_route`, `deployment`, `app_volume`, `repository_source`, `repository_catalog_cache`.

### Piège 7 — `Cloudflare zone not found`

**Symptôme** : warning `No Cloudflare zone available — DNS record NOT created`. L'app s'installe quand même mais le DNS n'est pas créé.

**Cause** : `CLOUDFLARE_ZONE_ID` ou `CLOUDFLARE_DEFAULT_ZONE` non configurés, ou le token Cloudflare n'a pas les droits sur la zone.

**Résolution** : vérifier `.env` :

```bash
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ZONE_ID=abcdef1234567890
CLOUDFLARE_DEFAULT_ZONE=thesocle.net
```

Tester : `curl -X POST .../api/actions/dns_sync_worker/list_zones`. Si la zone est listée, le token est OK.

### Piège 8 — Autofill `vault.X` retourne null

**Symptôme** : env var `MY_API_KEY` définie avec `autofill: "vault.api_key"` mais le container reçoit chaîne vide.

**Cause** : le secret Vault `soclehub/apps/<appId>/api_key` n'existe pas au moment du stage 4. L'autofill Vault ne crée rien — il lit seulement.

**Résolution** : provisionner le secret AVANT l'install :

```bash
curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d '{"path": "soclehub/apps/wp-acme", "key": "api_key", "value": "sk-secret-1234"}'
```

Puis lancer `install_app`.

### Piège 9 — `IAM role creation failed (may already exist)`

**Symptôme** : warning lors du stage 5, mais install continue.

**Cause** : un role `app:<appId>:user` traîne d'une install précédente. Le pipeline est tolérant (warning seulement).

**Résolution** : aucune action requise — le role existant est réutilisé. Si on veut un état propre, désinstaller d'abord avec `uninstall_app` (qui supprime le role IAM associé).

### Piège 10 — Cache HTTP non actif malgré `cache_enabled: true`

**Symptôme** : pas de header `X-Cache: HIT` dans les réponses. `apps.proxy_route.datas` est NULL.

**Cause** : le `catalog.cachePolicy` est null pour cette app — le pipeline log `Cache enabled` mais ne persiste pas car aucune politique de référence.

**Résolution** : enrichir le `catalog.json` :

```json
"cachePolicy": {
  "enabled": true,
  "pageTtlSeconds": 60,
  "assetTtlSeconds": 86400,
  "excludePaths": ["/wp-admin", "/wp-login.php"],
  "includeExtensions": [".css", ".js", ".png", ".jpg", ".woff2"],
  "cacheAuthenticated": false,
  "respectCacheControl": true,
  "maxEntriesPerApp": 5000
}
```

Rebuild + redéployer le Hub, puis retenter l'install.

### Piège 11 — Croire que le rollback a tout nettoyé

**Symptôme** : une installation a échoué, le pipeline a journalisé ses compensations, et pourtant le
nom résout encore en DNS — voire un certificat a été émis pour lui.

**Cause** : la compensation de l'étape réseau ne supprime rien (cf. §6, stage 3). Deux ressources
survivent donc systématiquement à un échec survenu au stage 4, 5 ou 6 : **l'enregistrement DNS** et
**le certificat TLS**. Rien ne le signale à l'appelant d'`install_app`, qui voit un échec et en
déduit raisonnablement que tout a été défait.

**Résolution** : le vérifier à chaque échec, puis nettoyer.

```bash
# Ce que le pipeline a laissé derrière lui
docker logs soclehub 2>&1 | grep "should be manually removed"

# L'enregistrement est-il encore là ?
dig +short blog-acme.thesocle.net

# Le supprimer
curl -s -X POST -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"zone":"thesocle.net","name":"blog-acme","type":"A"}' \
  http://localhost:8080/api/actions/dns_sync_worker/delete_record | jq
```

⚠️ `delete_record` est connu pour **rendre un succès sans avoir supprimé** sur certaines zones OVH :
revérifier avec `dig` après l'appel, et ne pas se fier au seul code retour.

Et avant de relancer l'installation, préférer `uninstall_app` sur l'`app_id` partiel plutôt qu'un
`DELETE` manuel : il traverse les quatre étapes de désinstallation et supprime aussi le rôle IAM, le
chemin Vault et la route (cf. [[howto-05-desinstaller-une-app]]).

---

## 11. Pour aller plus loin

- Voir [[30-docker-worker]] pour la liste complète des actions du `DockerWorker`,
- Voir [[60-pipeline-install]] pour le détail des 6 stages et des compensations (rollback),
- Voir [[31-app-registry-worker]] pour le format `CatalogApp` et `EnvTemplate`,
- Voir [[43-proxy-worker]] (stage 5) et [[40-acme-worker]] / [[41-dns-sync-worker]] (stage 3) pour le réseau et le routage,
- Voir [[howto-04-mettre-a-jour-une-app]] pour mettre à jour vers un nouveau tag,
- Voir [[howto-05-desinstaller-une-app]] pour la procédure inverse,
- Voir [[howto-07-ajouter-une-source-repository]] pour étendre le catalogue avec des apps signées d'un éditeur tiers.
