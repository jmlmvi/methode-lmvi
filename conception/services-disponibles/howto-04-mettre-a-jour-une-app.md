# HOWTO 04 — Mettre à jour une application

> **Niveau** : intermédiaire | **Prérequis** : avoir installé l'app via `howto-03`, accès admin Hub, image cible disponible dans le registry | **Temps estimé** : 2-10 min selon la taille de l'image

Ce guide montre comment passer une application installée à un nouveau tag Docker (par exemple `wordpress:6.7` → `wordpress:6.8`) en s'appuyant sur le **pipeline d'update** orchestré par `DockerWorker.update_app`. Le pipeline préserve les volumes Docker, la base de données, les credentials Vault et la route proxy : seule l'image change. En cas d'échec du nouveau container, un **rollback automatique** redémarre l'ancien.

---

## 1. Contexte

Une application en production tourne avec une version donnée (`docker_tag` dans `apps.applications`). Lorsqu'un correctif de sécurité, une nouvelle feature ou un patch est publié, l'opérateur doit basculer l'app vers la nouvelle image **sans perdre de données**, **sans casser les routes proxy**, et **sans demander à l'utilisateur de se reconnecter**. Sur un Hub multi-tenant, ce scénario se produit plusieurs fois par mois (Wordpress mineurs, Gitea security updates, OnlyOffice, etc.).

Le pipeline `AppUpdatePipeline` réalise un swap chirurgical : pull du nouveau tag, stop/remove de l'ancien container, recréation avec **les mêmes binds volumes** et **les mêmes env vars**, démarrage, vérification, persistance. Si la vérification échoue, le pipeline ré-instancie l'ancien container — l'utilisateur ne voit qu'une coupure de quelques secondes. Le rollback couvre le scénario `image présente mais bug runtime` ; il ne couvre pas une corruption de schéma DB introduite par les migrations de la nouvelle version (responsabilité de l'app elle-même).

L'update doit :

- Pull le nouveau tag avant de toucher au container existant,
- Préserver les volumes Docker nommés (`soclehub-<appId>-<volname>`),
- Préserver les env vars (lues depuis Vault `soclehub/apps/<appId>/env`),
- Vérifier que le nouveau container reste running après start,
- Persister `apps.applications.docker_tag` + `apps.deployments` (action='update'),
- Rollback automatique : recréer l'ancien container si le nouveau échoue.

Le pipeline d'update est piloté par le `DockerWorker` (cf. [[30-docker-worker]]) et détaillé dans [[61-pipeline-update]].

---

## 2. Architecture

```
                       ┌────────────────────────────────────────┐
                       │          POST /api/actions/            │
                       │    docker/update_app  (REST/MCP/IHM)   │
                       └───────────────────┬────────────────────┘
                                           │
                                           ▼
                  ┌──────────────────────────────────────────┐
                  │          DockerWorker.handleUpdateApp    │
                  │  (lookup app_id, fetch new_tag)          │
                  └───────────────────┬──────────────────────┘
                                      │
                                      ▼
        ┌─────────────────────────────────────────────────────────┐
        │              AppUpdatePipeline (7 stages)                │
        │                                                         │
        │  1.lookup ─→ 2.pull-new ─→ 3.stop-old ─→ 4.create-new   │
        │                            │                            │
        │                            │ rollback : restart oldId   │
        │                            ▼                            │
        │  5.start-new ─→ 6.verify ─→ 7.persist                   │
        │                                                         │
        └─────────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┴──────────────────────┐
              │                                              │
              ▼                                              ▼
     ┌────────────────┐                              ┌──────────────────┐
     │ Volumes Docker │                              │ apps.applications │
     │ (préservés)    │                              │    docker_tag     │
     │                │                              │ apps.deployments  │
     └────────────────┘                              └──────────────────┘
                                                              │
                                                              ▼
                                                     ProxyRoutingTable
                                                     (rebound sur new IP)
```

---

## 3. Étape 1 — Vérifier l'état avant update

Lister les apps et leur tag courant :

```bash
curl -s -X POST http://localhost:8080/api/actions/docker/list_apps \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: dev" \
  -d '{}' | jq '.data.apps[] | {app_id, docker_image, docker_tag, status, health_status}'
```

Sortie exemple :

```json
{
  "app_id": "wp-acme",
  "docker_image": "wordpress",
  "docker_tag": "6.7",
  "status": "running",
  "health_status": "healthy"
}
```

Vérifier que la nouvelle image est disponible :

```bash
docker pull wordpress:6.8
# Status: Image is up to date for wordpress:6.8
```

Si registry privé :

```bash
docker login repository.thesocle.net
docker pull repository.thesocle.net/soclehub-local/office-suite:1.2.0
```

---

## 4. Étape 2 — Lancer l'update via REST

L'action est `ASYNC` :

```bash
curl -X POST http://localhost:8080/api/actions/docker/update_app \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: dev" \
  -d '{
    "app_id": "wp-acme",
    "new_tag": "6.8"
  }'
```

Réponse 202 :

```json
{
  "status": "accepted",
  "jobId": "job-9c2b1f8a",
  "worker": "docker",
  "action": "update_app"
}
```

Suivre :

```bash
curl -s http://localhost:8080/api/actions/jobs/job-9c2b1f8a | jq
```

Logs en direct :

```bash
docker logs -f soclehub-app | grep "\[update:wp-acme\]"
```

Sortie attendue :

```
[update:wp-acme] Pulling new image wordpress:6.8
[update:wp-acme] Stopping old container abc123def456
[update:wp-acme] Removing old container abc123def456
[update:wp-acme] Creating new container tag=6.8
[update:wp-acme] Starting new container 7891abcd2345
[update:wp-acme] Update complete: 6.7 -> 6.8
```

---

## 5. Étape 3 — Comprendre les 7 stages

Référence : `/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/pipeline/AppUpdatePipeline.java`

### Stage 1 — Lookup

```sql
SELECT x_id, app_id, catalog_app_id, docker_image, docker_tag, container_id
FROM apps.applications WHERE app_id = ?
```

Charge l'app + résout `CatalogApp` via `appRegistryWorker.getCatalogApp(catalog_app_id)` pour récupérer les volumes et la commande à conserver. Si `app_id` non trouvé → `IllegalStateException`.

### Stage 2 — Pull-new

Pull du nouveau tag **avant** de toucher au container existant (c'est l'opération la plus longue et la plus susceptible d'échouer pour cause réseau). Si l'image vient d'un registry privé déclaré dans `apps.repository_source`, le pipeline résout les credentials via Vault (cf. `resolveRegistryCredsForImage`).

```java
// Extrait AppUpdatePipeline.java ligne 88-97
String[] creds = resolveRegistryCredsForImage(dockerImage);
if (creds != null) {
    log.info("[update:{}] Pull with auth — registry={} user={}", appId, creds[2], creds[0]);
    dockerService.pullImage(dockerImage, newTag, creds[0], creds[1], creds[2]);
} else {
    dockerService.pullImage(dockerImage, newTag);
}
```

### Stage 3 — Stop-old

```java
dockerService.stopContainer(oldContainerId);
oldStopped = true;  // marqueur pour rollback
dockerService.removeContainer(oldContainerId);
```

À ce moment, le proxy renvoie 502 Bad Gateway pour le subdomain. Durée typique : 2-5 secondes.

### Stage 4 — Create-new

Re-lit les env vars depuis Vault (`vaultService.readSecret("soclehub/apps/<appId>/env")`). **Fix BUG-045** : la lecture des env vars a lieu **avant** le stop de l'ancien container, et si le path Vault est vide (apps legacy installées avant que l'install persiste les env), le pipeline snapshot les env directement depuis l'ancien container (`dockerService.getContainerEnv(oldContainerId)`) puis ré-écrit ce snapshot dans Vault (heal-on-read). Il ré-injecte aussi la **gouvernance mémoire** (`JAVA_OPTS`/`NODE_OPTIONS`/`PHP_MEMORY_LIMIT`/`GOMEMLIMIT` selon `catalog.runtime`) pour ne pas perdre la limite mémoire à chaque update. Recrée enfin le container avec **les mêmes binds volumes** (récupérés depuis `catalogApp.getVolumes()`), la même commande et la même limite mémoire :

```java
List<Bind> binds = DockerService.buildBindsFromCatalog(appId, catalogApp.getVolumes());
newContainerId = dockerService.createContainer(
    appId, dockerImage, newTag, envVars, properties.getDocker().getNetwork(),
    binds, command, memoryMb);
```

> **Image locale** : `createContainer` instancie l'image `dockerImage:newTag` **telle qu'elle est présente localement** (le pull du stage 2 ne s'exécute que si l'image manque/diffère). Pour un déploiement « par image locale » (tag déjà présent, pas de registry), il faut donc que `dockerImage` corresponde **exactement** à `get_app.docker_image` et que le tag `newTag` soit déjà taggé localement — sinon le container ne démarre pas. Cf. piège 11.

### Stage 5 — Start-new

`dockerService.startContainer(newContainerId)`. À ce moment le container démarre et tente d'appliquer ses migrations (côté app — WordPress, par ex., met à jour la BDD au premier hit de wp-admin).

### Stage 6 — Verify

```java
boolean isRunning = dockerService.isContainerRunning(newContainerId);
if (!isRunning) {
    throw new IllegalStateException("New container " + newContainerId + " failed to start");
}
```

Vérification basique sur l'état Docker. Pour une vérif HTTP plus fine, utiliser `proxy_worker/health_check_all` après l'update.

### Stage 7 — Persist

```sql
UPDATE apps.applications
SET docker_tag = ?, container_id = ?, status = 'running', x_dateUpdated = now()
WHERE app_id = ?;

INSERT INTO apps.deployments (x_dateCreated, id_applications, action, from_version, to_version, triggered_by, status)
VALUES (now(), ?, 'update', ?, ?, 'update_pipeline', 'success');
```

---

## 6. Étape 4 — Préservation : ce qui change, ce qui ne change pas

| Élément | Comportement |
|---------|--------------|
| **Volumes Docker** | Préservés. `soclehub-<appId>-<volname>` est réutilisé. Les données de l'app (DB locale, uploads, configs) survivent |
| **Volumes binds catalog** | Re-attachés. Si le nouveau catalog ajoute un volume, il est créé (idempotent) |
| **Env vars** | Lues depuis Vault `soclehub/apps/<appId>/env`. Si le nouveau catalog en attend de nouvelles, elles ne sont **pas** auto-provisionnées (limitation v2.6) — passer par `set_env_var` après update si besoin |
| **Database (Postgres/MariaDB)** | Inchangée. Le schema/database et les credentials restent les mêmes |
| **Vault path** | Inchangé. `soclehub/apps/<appId>/` est conservé |
| **Route proxy** | Inchangée. `apps.proxy_routes` n'est pas modifié par le pipeline. Depuis le FIX routing, `target_host` est le **nom du container** (`= appId`), pas une IP : le proxy résout le backend via le DNS interne Docker, donc le changement d'IP du container est transparent (cf. [[43-proxy-worker]]). **Exception** : apps legacy dont `target_host` est encore une IP figée → voir piège 12 |
| **Cache HTTP** | Préservé (`apps.proxy_routes.datas`). Pour invalider les pages cachées, utiliser `cache_worker/cache_purge_app` |
| **DNS Cloudflare** | Inchangé (le record A pointe sur l'IP du Hub, pas du container) |
| **TLS Certificat** | Inchangé (rattaché au FQDN, pas au container) |
| **IAM role / SSO** | Inchangé (`app:<appId>:user` reste) |
| **Container ID** | **Change**. Nouveau ID persisté dans `apps.applications.container_id` |
| **Container IP** | **Change** (réseau Docker assigne une nouvelle IP). Le proxy se rebind |
| **docker_tag** | **Change**. Persisté en base |

---

## 7. Étape 5 — Rollback automatique

Si stage 4, 5 ou 6 échoue, le pipeline tente de restaurer l'ancien container :

```java
// Extrait AppUpdatePipeline.java ligne 163-184
} catch (Exception e) {
    log.error("[update:{}] Update failed, attempting rollback: {}", appId, e.getMessage(), e);

    // 1. Cleanup new container (s'il a été créé)
    if (newContainerId != null) {
        try { dockerService.stopContainer(newContainerId); } catch (Exception ignore) { }
        try { dockerService.removeContainer(newContainerId); } catch (Exception ignore) { }
    }

    // 2. Restart old container — MAIS ATTENTION : il a été stopped + removed au stage 3.
    //    Le rollback ne peut donc restaurer que si stage 3 n'a pas eu lieu.
    if (oldStopped && oldContainerId != null) {
        try {
            dockerService.startContainer(oldContainerId);
            log.info("[update:{}][rollback] Old container {} restarted", appId, oldContainerId);
        } catch (Exception rollbackErr) {
            log.error("[update:{}][rollback] Failed to restart old container: {}",
                    appId, rollbackErr.getMessage());
        }
    }
    throw e;
}
```

**Limitation** : si l'échec survient après `removeContainer(oldContainerId)`, le rollback échoue (le container a déjà disparu). Dans ce cas, l'admin doit refaire un `install_app` ou repull manuellement le tag précédent et rerunner.

**Best practice** : avant un update en production, toujours faire un test sur un app de staging en premier.

---

## 8. Étape 6 — Variante IHM portail

```
Browser ──→ GET  https://admin.thesocle.net/hub/apps/wp-acme
         ←── HTML détail (bouton "Mettre à jour")

Browser ──→ POST https://admin.thesocle.net/hub/apps/wp-acme/update
         (form: new_tag=6.8)

PortalDashboardController.updateApp(...) construit ActionParameters
  puis appelle dockerWorker.executeAction("update_app", ...)
```

Le portail liste les tags disponibles depuis `catalog.dockerTags` (ex. `["latest", "6.7", "6.8"]`) pour éviter de saisir un tag inexistant.

---

## 9. Validation post-update

### Vérifier le tag courant

```bash
curl -s -X POST http://localhost:8080/api/actions/docker/get_app \
  -H "Content-Type: application/json" \
  -d '{"app_id": "wp-acme"}' | jq '{docker_tag, container_id, status, container_running}'
```

Attendu :

```json
{
  "docker_tag": "6.8",
  "container_id": "7891abcd...",
  "status": "running",
  "container_running": true
}
```

### Vérifier l'historique

```sql
SELECT x_dateCreated, action, from_version, to_version, status, triggered_by
FROM apps.deployments d
JOIN apps.applications a ON a.x_id = d.id_applications
WHERE a.app_id = 'wp-acme'
ORDER BY x_dateCreated DESC
LIMIT 5;
```

Sortie attendue :

```
2026-04-28 10:23:41 | update  | wordpress:6.7 | wordpress:6.8 | success | update_pipeline
2026-04-28 09:15:02 | install | NULL          | wordpress:6.7 | success | install_pipeline
```

### Tester le service

```bash
# Le proxy doit rebinder sur la nouvelle IP. Si KO immédiat, attendre 30s (cycle de health-check)
curl -k https://blog-acme.thesocle.net/wp-login.php

# Forcer un health-check
curl -X POST http://localhost:8080/api/actions/proxy_worker/health_check_all -d '{}'
```

### Logs container

```bash
docker logs $(docker ps -qf name=soclehub-wp-acme) --tail 50
# Vérifier l'absence d'erreurs au démarrage
```

---

## 10. Pièges courants

### Piège 1 — `Application not found`

**Symptôme** : update renvoie 500 avec `Application not found: wp-acme`.

**Cause** : `app_id` typo ou app jamais installée par le pipeline (insertion manuelle en base).

**Résolution** : `SELECT app_id FROM apps.applications` pour lister les vrais identifiants. Préférer `list_apps` via REST.

### Piège 2 — `manifest unknown` lors du pull

**Symptôme** : stage 2 échoue avec `Error response from daemon: manifest for X:Y not found`.

**Cause** : le tag n'existe pas dans le registry. Soit erreur de saisie, soit le tag n'a pas encore été pushé par l'éditeur.

**Résolution** : vérifier les tags disponibles :

```bash
curl https://hub.docker.com/v2/repositories/library/wordpress/tags?page_size=10 | jq
# ou pour registry privé:
curl -u user:pass https://repository.thesocle.net/v2/soclehub-local/office-suite/tags/list
```

### Piège 3 — `Pull with auth` échoue avec 401

**Symptôme** : log `Pull with auth — registry=... user=...` puis `unauthorized: authentication required`.

**Cause** : credentials Vault dans `auth_vault_path` invalides ou expirés.

**Résolution** : refaire le set_secret :

```bash
curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d '{"path": "soclehub/repository/sources/my-source", "key": "username", "value": "..."}'
curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d '{"path": "soclehub/repository/sources/my-source", "key": "password", "value": "..."}'
```

### Piège 4 — Rollback failed, ancien container disparu

**Symptôme** : log `Failed to restart old container: No such container`. App down.

**Cause** : l'erreur est survenue après `removeContainer(oldContainerId)`. Le rollback ne peut pas recréer un container inexistant.

**Résolution** : relancer manuellement avec l'ancien tag :

```bash
curl -X POST http://localhost:8080/api/actions/docker/update_app \
  -H "Content-Type: application/json" \
  -d '{"app_id": "wp-acme", "new_tag": "6.7"}'
```

### Piège 5 — Volume non préservé

**Symptôme** : après update, l'app affiche un setup "first install" — toutes les données disparues.

**Cause** : le `catalogApp` lookup a échoué (`null` retourné), donc `binds = List.of()`. Le nouveau container est créé sans volume. Survient si `catalog_app_id` n'existe plus dans le catalog (app supprimée du `catalog.json`).

**Résolution** : restaurer la fiche dans `catalog.json` ou `repository.apps` puis relancer. Si déjà perdu, `docker volume ls | grep soclehub-<appId>` pour vérifier que le volume Docker existe encore — il suffit alors de désinstaller (sans purge) puis réinstaller (le pipeline d'install pré-crée les volumes idempotemment).

### Piège 6 — Env vars manquantes après update

**Symptôme** : nouveau container crashe avec `MISSING_ENV_X is required`.

**Cause** : la nouvelle version de l'app exige une env var qui n'existait pas avant. Le pipeline ne la provisionne pas automatiquement.

**Résolution** :

```bash
# Avant l'update, ajouter la nouvelle env var
curl -X POST http://localhost:8080/api/actions/docker/set_env_var \
  -H "Content-Type: application/json" \
  -d '{"app_id": "wp-acme", "key": "NEW_REQUIRED_VAR", "value": "..."}'
# Puis update
curl -X POST http://localhost:8080/api/actions/docker/update_app \
  -d '{"app_id": "wp-acme", "new_tag": "6.8"}'
```

### Piège 7 — Cache HTTP serve l'ancienne version

**Symptôme** : malgré l'update, les utilisateurs voient l'ancienne UI / les anciens assets.

**Cause** : le cache HTTP (`CacheWorker`) sert les assets cachés. Les TTLs typiques : 1h pour pages, 7 jours pour assets.

**Résolution** : purger le cache de l'app :

```bash
curl -X POST http://localhost:8080/api/actions/cache_worker/cache_purge_app \
  -H "Content-Type: application/json" \
  -d '{"app_id": "wp-acme"}'
```

### Piège 8 — Migrations DB échouent, app boucle

**Symptôme** : container démarre, fait `migrate`, échoue, redémarre... `docker logs` montre la même erreur en boucle.

**Cause** : la nouvelle version a des migrations DB incompatibles (ex. drop column qu'utilise encore une autre table).

**Résolution** : ce n'est **pas** un problème du pipeline. Rollback :

```bash
curl -X POST http://localhost:8080/api/actions/docker/update_app \
  -d '{"app_id": "wp-acme", "new_tag": "6.7"}'
```

Puis investiguer côté schéma DB.

### Piège 9 — Proxy renvoie 502 pendant 30s

**Symptôme** : entre stage 3 (stop-old) et stage 5 (start-new), le proxy renvoie 502 Bad Gateway.

**Cause** : c'est attendu — il n'y a pas de stratégie blue-green. Coupure typique : 2-10s. Si > 30s, problème de pull lent.

**Résolution** : pour minimiser, pré-pull l'image manuellement avant l'update :

```bash
docker exec soclehub-app docker pull wordpress:6.8
# Stage 2 sera quasi-instantané
curl -X POST http://localhost:8080/api/actions/docker/update_app -d '{...}'
```

### Piège 10 — `deployment_history` vs `apps.deployments`

**Symptôme** : on cherche la table `deployment_history` qui n'existe pas.

**Cause** : la table s'appelle `apps.deployments` (au pluriel), avec FK `id_applications`. Pas de schéma `deployment_history`. La doc historique mentionne parfois l'ancien nom au singulier.

**Résolution** : utiliser la requête correcte :

```sql
SELECT * FROM apps.deployments d JOIN apps.applications a ON a.x_id = d.id_applications
WHERE a.app_id = 'wp-acme' ORDER BY d.x_dateCreated DESC;
```

### Piège 11 — `update_app` recrée le container depuis l'image LOCALE manquante

**Symptôme** : on relance `update_app` avec un tag qu'on a buildé/poussé soi-même (image locale, pas un registry), et le container ne démarre pas / Docker répond `No such image`.

**Cause** : le stage 4 (`createContainer`) instancie `docker_image:new_tag` **tel qu'il est résolu localement**. Le stage 2 (pull) ne ramène rien si aucun registry ne sert ce tag. Le `docker_image` doit donc correspondre **exactement** à la valeur stockée (`get_app.docker_image`), préfixe de registre inclus, et le tag visé doit déjà exister en local.

**Résolution** : tagger localement l'image **avant** l'update, avec le nom exact attendu :

```bash
# Récupérer le nom d'image exact stocké
curl -s -X POST http://localhost:8080/api/actions/docker/get_app \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"app_id": "wp-acme"}' | jq -r '.data.docker_image'
# -> ex. "repository.thesocle.net/soclehub-local/office-suite"

# Tagger l'image buildée sous CE nom + le tag visé
docker tag office-suite:dev repository.thesocle.net/soclehub-local/office-suite:1.3.0

# Puis update_app sur ce tag
curl -X POST http://localhost:8080/api/actions/docker/update_app \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"app_id": "wp-acme", "new_tag": "1.3.0"}'
```

### Piège 12 — Proxy reste collé sur l'ancien container (apps legacy à `target_host` = IP)

**Symptôme** : après `update_app`, le subdomain renvoie 502 ou sert l'ancien backend, alors que le nouveau container tourne.

**Cause** : depuis le FIX routing, l'install stocke `apps.proxy_routes.target_host = nom du container (= appId)` ; le proxy résout alors le backend via le DNS Docker et suit le container quelle que soit son IP. **Mais** les apps installées **avant** ce fix ont un `target_host` figé à l'IP de l'ancien container — `update_app` ne réécrit pas la route, donc le proxy pointe vers une IP morte (cf. [[43-proxy-worker]]).

**Résolution** : vérifier la route, puis la repointer sur le nom du container via `update_route` :

```bash
# Diagnostic : target_host doit valoir l'app_id, pas une IP 172.x
curl -s -X POST http://localhost:8080/api/actions/proxy_worker/list_routes \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" -d '{}' \
  | jq '.data.routes[] | select(.app_id=="wp-acme") | {hostname, target_host, target_port}'

# Si target_host est une IP, la repointer sur le nom du container
curl -X POST http://localhost:8080/api/actions/proxy_worker/update_route \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"hostname": "blog-acme.thesocle.net", "target_host": "wp-acme", "target_port": 80}'
```

---

## 11. Pour aller plus loin

- [[61-pipeline-update|Pipeline d'update (7 stages)]] — référence interne stage par stage avec compensation/rollback,
- [[30-docker-worker|DockerWorker]] — liste complète des actions (`install_app`, `update_app`, `get_app`, `set_env_var`…) et leur sémantique,
- [[43-proxy-worker|ProxyWorker]] — résolution du backend via `target_host`, `update_route`, health-check,
- Voir `howto-03-installer-une-app.md` pour la procédure d'installation initiale,
- Voir `howto-05-desinstaller-une-app.md` pour le pipeline inverse,
- Voir `howto-06-publier-une-app-editeur.md` pour publier une nouvelle version dans le registry signé,
- Voir `agent-guide/02-task-decision-tree.md` pour l'arbre de décision "ai-je besoin d'un update ou d'un reinstall ?".
