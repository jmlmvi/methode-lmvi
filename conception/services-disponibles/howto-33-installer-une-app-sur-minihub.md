# HOWTO 33 — Installer une app sur un mini-hub

> **Niveau** : avancé | **Prérequis** : SocleHub Hub 3.12.1 avec `socle.minihub.server.enabled=true`, un mini-hub enrôlé et `ACTIVE` (cf. [[howto-32-enroler-un-minihub|HOWTO 32]]), command stream du mini-hub connecté, accès admin Hub | **Temps estimé** : 5-10 min

Ce guide montre comment **déployer une application sur un mini-hub distant** depuis le Hub central, via l'install distribuée (`POST /api/minihub/install` → `DistributedInstallService`). Contrairement à l'install locale du Hub (cf. [[howto-03-installer-une-app|HOWTO 03]]), l'install distribuée **pousse une commande sur le command stream mTLS** du mini-hub : c'est le DockerWorker du mini-hub qui exécute le pull/run localement.

---

## 1. Contexte

Un opérateur veut faire tourner une app **sur la box du mini-hub** (proximité données, souveraineté, GPU local, etc.) tout en pilotant le déploiement depuis le Hub central. L'install distribuée évite de se connecter en SSH à chaque box : une requête REST sur le Hub suffit, la commande voyage dans le tunnel mTLS existant.

`DistributedInstallService` (MVP S2) ne rejoue pas le pipeline 6-stages complet avec compensation : il **alloue une version de config monotone** (anti-rejeu), persiste l'état du run dans `iam.tr_distributed_install_state`, puis pousse une `InstallAppCommand` sur le command stream du mini-hub via `MiniHubConsoleRegistry.sendCommand`. Le mini-hub la reçoit via son flux `PollCommand`, l'exécute (DockerWorker local) et republie le résultat.

Trois **modes cible** (`target_mode`) :

- `internal_only` (défaut) : l'app n'est accessible que localement sur le mini-hub,
- `published_only` : enchaîne DNS Cloudflare + cert ACME + route proxy `target_type='minihub'` côté Hub (l'app est exposée sur `{subdomain}.thesocle.net`),
- `dual` : les deux.

L'action est **async** : la réponse retourne un `run_id` immédiatement, le déploiement réel suit sur le mini-hub.

---

## 2. Architecture

```
  ┌─────────────────────────────────────────────────────────────┐
  │ POST /api/minihub/install   (REST / MCP / scripts / E2E)    │
  │   {minihub_id, app_id, docker_image, target_mode,          │
  │    env_vars, ports, subdomain?}                            │
  └─────────────────────────────┬───────────────────────────────┘
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ MiniHubInstallApiController                                 │
  │   - valide minihub_id (UUID) + app_id + docker_image       │
  │   - lookup slug si absent (iam.db_minihub)                  │
  │   - route selon target_mode :                              │
  │       published_only + subdomain → installPublicWithSubdomain│
  │       published_only             → installPublic           │
  │       internal_only / dual       → install                 │
  └─────────────────────────────┬───────────────────────────────┘
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ DistributedInstallService                                  │
  │   1. ConfigVersionService.next()  (config_version monotone)│
  │   2. INSERT iam.tr_distributed_install_state (run)         │
  │   3. lookupRegistryCreds() si image registry privé (Vault) │
  │   4. MiniHubConsoleRegistry.sendCommand(InstallAppCommand) │
  │      sur le command stream mTLS du mini-hub                │
  │   (publish_*) + DNS Cloudflare + ACME + apps.proxy_routes  │
  │                target_type='minihub'                       │
  └─────────────────────────────┬───────────────────────────────┘
                                 │ command stream (tunnel mTLS)
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Mini-hub (box distante) : PollCommand reçoit la commande   │
  │   → DockerWorker local pull + create + start               │
  │   → republie résultat (NATS local → Hub)                   │
  └─────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Récupérer l'ID du mini-hub cible

```
minihub_registry_worker.list_minihubs
```

Noter le `minihub_id` (UUID) du mini-hub `ACTIVE` voulu. En SQL :

```sql
SELECT minihub_id, minihub_slug, status, last_heartbeat_at
FROM iam.db_minihub
WHERE status = 'ACTIVE' ORDER BY enrolled_at DESC;
```

---

## 4. Étape 2 — (optionnel) Vérifier la disponibilité d'un sous-domaine

Uniquement pour `target_mode = published_only`/`dual` avec un sous-domaine custom. Le Hub valide la regex `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` et l'unicité dans `apps.proxy_routes` :

```bash
curl -s "https://admin.thesocle.net/api/minihub/check-hostname?subdomain=rss-archiver" | jq
```

```json
{ "available": true, "hostname": "rss-archiver.thesocle.net" }
```

---

## 5. Étape 3 — Lancer l'install distribuée

Le payload est le record `InstallApiRequest`. Champs requis : `minihub_id`, `app_id`, `docker_image`.

### Install interne (mode par défaut)

```bash
curl -sS -X POST https://admin.thesocle.net/api/minihub/install \
  -H "Content-Type: application/json" \
  -d '{
    "minihub_id": "18556e78-1b2c-4d3e-9f0a-aabbccddeeff",
    "app_id": "rss-archiver",
    "app_version": "1.12.0",
    "docker_image": "repository.thesocle.net/soclehub-local/rssarchiver:1.12.0",
    "target_mode": "internal_only",
    "env_vars": {
      "RSS_BACKEND_QUEUE": "memory",
      "LOG_LEVEL": "INFO"
    },
    "ports": [8080],
    "requested_by": "jm@henry.sh"
  }'
```

### Install publiée (avec sous-domaine)

```bash
curl -sS -X POST https://admin.thesocle.net/api/minihub/install \
  -H "Content-Type: application/json" \
  -d '{
    "minihub_id": "18556e78-1b2c-4d3e-9f0a-aabbccddeeff",
    "app_id": "rss-archiver",
    "docker_image": "repository.thesocle.net/soclehub-local/rssarchiver:1.12.0",
    "target_mode": "published_only",
    "subdomain": "rss-archiver",
    "ports": [8080],
    "requested_by": "jm@henry.sh"
  }'
```

Réponse 200 OK (`InstallResult`) :

```json
{
  "run_id": "9c1f0a2b-...-deadbeef",
  "correlation_id": "corr-7f3a2b1e",
  "config_version": 42,
  "status": "SENT",
  "message": "Commande envoyée au mini-hub via command stream"
}
```

**Statuts possibles** : `SENT` (commande poussée sur le stream), `REJECTED_NO_STREAM` (le mini-hub n'a pas de command stream actif), `FAILED`.

**Paramètres acceptés par `/install`** :

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `minihub_id` | string (UUID) | oui | Mini-hub cible |
| `app_id` | string | oui | Identifiant logique de l'app sur le mini-hub |
| `docker_image` | string | oui | Image complète (avec host registry si privé) |
| `app_version` | string | non | Défaut `latest` |
| `target_mode` | string | non | `internal_only` (défaut) / `published_only` / `dual` |
| `env_vars` | object | non | Variables d'environnement du container |
| `ports` | array<int> | non | Ports exposés par le container |
| `subdomain` | string | non | Sous-domaine souhaité (sans `.thesocle.net`) pour `published_only` ; sinon auto |
| `minihub_slug` | string | non | Sinon résolu par lookup sur `minihub_id` |
| `requested_by` | string | non | Traçabilité, défaut `api` |

**Registry privé** : si `docker_image` commence par un host (contient `.` ou `:` avant le 1er `/`), le service cherche les creds dans Vault `soclehub/registry/<host_avec_underscores>` (ex. `repository.thesocle.net` → `soclehub/registry/repository_thesocle_net`).

---

## 6. Validation

### Suivre l'état du run

```sql
SELECT run_id, minihub_id, app_id, config_version, status, stage,
       message, x_dateCreated, x_dateUpdated
FROM iam.tr_distributed_install_state
WHERE run_id = '9c1f0a2b-...-deadbeef';
```

Le `status` évolue à mesure que le mini-hub exécute et republie le résultat.

### Vérifier la route proxy (mode publié)

```sql
SELECT hostname, target_type, target_host, target_port, tls_enabled, status
FROM apps.proxy_routes
WHERE hostname = 'rss-archiver.thesocle.net';
-- target_type doit valoir 'minihub'
```

### Tester l'app publiée

```bash
dig +short rss-archiver.thesocle.net          # IP du Hub
curl -kI https://rss-archiver.thesocle.net/    # 200 ou redirect SSO
```

### IHM Portail

`https://admin.thesocle.net/hub/minihubs/{id}/deploy` (page Deploy, `PortalMinihubController`) affiche le formulaire de déploiement et l'historique des runs. La désinstallation passe par `POST /hub/minihubs/{id}/deploy/uninstall`.

---

## 7. Pièges courants

### Piège 1 — `status: REJECTED_NO_STREAM`

**Symptôme** : la réponse retourne immédiatement `REJECTED_NO_STREAM`, rien ne se déploie.

**Cause** : le mini-hub n'a **pas de command stream actif**. Le heartbeat peut être OK (mini-hub `ACTIVE`) alors que le `PollCommand` ne s'est pas reconnecté — typiquement après un restart du Hub.

**Résolution** : `docker restart socle-minihub` sur la box du mini-hub pour rétablir le command stream, puis relancer l'install.

### Piège 2 — `error: minihub_id pas un UUID`

**Symptôme** : 400 Bad Request.

**Cause** : `minihub_id` mal formé (slug passé à la place de l'UUID).

**Résolution** : passer l'UUID exact de `iam.db_minihub.minihub_id` (le slug va dans `minihub_slug`, optionnel).

### Piège 3 — `error: minihub_id + app_id + docker_image requis`

**Symptôme** : 400 même avec les champs apparemment présents.

**Cause** : champ vide/null, ou JSON mal formé (clé en camelCase au lieu du snake_case attendu — le record `InstallApiRequest` utilise `minihub_id`, `docker_image`, `target_mode`, etc.).

**Résolution** : respecter strictement le snake_case des champs.

### Piège 4 — `subdomain invalide`

**Symptôme** : 400 avec `"expected": "regex ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$"`.

**Cause** : majuscules, underscore, point, ou tiret en début/fin dans le sous-domaine.

**Résolution** : n'utiliser que `a-z`, `0-9` et `-` (≤ 63 chars, ne pas commencer/finir par `-`). Valider d'abord via `/api/minihub/check-hostname`.

### Piège 5 — Pull d'image registry privé échoue sur le mini-hub

**Symptôme** : le run reste bloqué / le mini-hub log un `unauthorized` au pull.

**Cause** : pas de creds registry, ou secret Vault absent au chemin attendu `soclehub/registry/<host>`.

**Résolution** : provisionner le secret côté Hub (username/password/url) avant l'install :

```bash
curl -X POST https://admin.thesocle.net/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d '{"path":"soclehub/registry/repository_thesocle_net","key":"username","value":"<user>"}'
```

(idem pour `password`). Cf. [[howto-19-rotation-secrets|HOWTO 19]] pour la gestion Vault.

### Piège 6 — `404` sur `/api/minihub/install`

**Symptôme** : endpoint introuvable.

**Cause** : `socle.minihub.server.enabled` non actif (controller `@ConditionalOnProperty`).

**Résolution** : activer la propriété et recréer le container Hub (cf. [[howto-32-enroler-un-minihub|HOWTO 32]], piège 5).

### Piège 7 — App installée mais snapshot mini-hub en 504

**Symptôme** : install OK mais l'observabilité du mini-hub renvoie 504.

**Cause** : schéma `apps_local` manquant dans le PG **local** du mini-hub (pas un problème du Hub).

**Résolution** : rejouer la migration `V20260601` sur le PG de la box, pas un restart.

---

## 8. Pour aller plus loin

- [[142-minihub-distributed-install|Install distribué & versionnage config]] — détail des stages, `ConfigVersionService`, `tr_distributed_install_state`,
- [[howto-32-enroler-un-minihub|HOWTO 32 — Enrôler un mini-hub]] — préalable indispensable,
- [[143-minihub-tunnel-mcp|Tunnel MCP mini-hub]] — comment le command stream et le MCP transitent dans le tunnel,
- [[howto-03-installer-une-app|HOWTO 03 — Installer une app (locale)]] — pipeline 6-stages côté Hub central,
- [[144-minihub-console-observability|Console & observabilité]] — suivre logs/métriques du déploiement distant.
