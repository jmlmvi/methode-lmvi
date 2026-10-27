# HOWTO 05 — Désinstaller une application proprement

> **Niveau** : intermédiaire | **Prérequis** : application installée via `howto-03`, accès admin Hub, décision sur `purge=true/false` | **Temps estimé** : 1-3 min

Ce guide montre comment désinstaller une application en supprimant tous ses artefacts (container Docker, route proxy, record DNS Cloudflare, base de données, secrets Vault). Le pipeline d'uninstall (cf. [[62-pipeline-uninstall]]) est orchestré par le `DockerWorker` (cf. [[30-docker-worker]]). L'option `purge=true` supprime en plus les volumes Docker — à utiliser avec précaution car elle est **irréversible**.

> ⚠️ **Historique de déploiement** : contrairement aux versions antérieures, la FK `fk_deployments_applications` est désormais en `ON DELETE CASCADE`. Supprimer la ligne `apps.applications` (stage 4) **supprime aussi** les lignes `apps.deployments` associées. L'historique d'install/update n'est donc **pas conservé** après un uninstall dans le schéma 3.12.1 — si vous avez besoin de l'audit a posteriori, exportez `apps.deployments` AVANT la désinstallation (cf. §6).

---

## 1. Contexte

Une application n'est plus utilisée (client parti, app dépréciée, test terminé). Si on se contente de `docker stop + docker rm`, il reste des miettes : routes proxy actives qui renvoient 502, records DNS qui pointent dans le vide, schémas PostgreSQL qui occupent de l'espace, secrets Vault, role IAM. Sur un Hub avec des dizaines d'apps installées et désinstallées au fil des mois, ces miettes deviennent un cauchemar de maintenance.

Le pipeline `AppUninstallPipeline` réalise un cleanup en 4 stages dans l'ordre **inverse** d'install : il arrête le container, supprime la routing-table, drop le schéma DB, deallocate Redis, supprime le path Vault, supprime les records DNS de Cloudflare ET de la table `dns.records`, optionnellement purge les volumes Docker, puis supprime la ligne `apps.applications`. Le DELETE final cascade sur `apps.deployments` (FK `ON DELETE CASCADE`), donc l'historique disparaît avec l'app.

L'uninstall doit :

- Stop + remove le container Docker,
- Supprimer la route proxy (table + mémoire),
- Supprimer les records DNS (Cloudflare + DB),
- Drop le schema PostgreSQL ou la database MariaDB,
- Deallocate la database Redis,
- Supprimer le path Vault `soclehub/apps/<appId>/`,
- Optionnellement purger les volumes Docker (`purge=true`),
- Supprimer la ligne `apps.applications` (cascade sur `apps.deployments`),
- Tolérer les erreurs partielles : un cleanup raté ne bloque pas les suivants.

---

## 2. Architecture

```
                       ┌────────────────────────────────────────┐
                       │          POST /api/actions/            │
                       │   docker/uninstall_app  (REST/MCP/IHM) │
                       └───────────────────┬────────────────────┘
                                           │
                                           ▼
                  ┌──────────────────────────────────────────┐
                  │       DockerWorker.handleUninstallApp    │
                  │  (lookup app_id, fetch purge flag)       │
                  └───────────────────┬──────────────────────┘
                                      │
                                      ▼
        ┌──────────────────────────────────────────────────────────┐
        │              AppUninstallPipeline (4 stages)             │
        │                                                          │
        │  1. stop-container ──→ DockerService.stop+remove         │
        │  2. remove-routing ──→ ProxyRoutingTable.remove()        │
        │                       cleanupDnsRecords (CF + DB)        │
        │                       DELETE FROM apps.proxy_routes      │
        │  3. cleanup-resources ──→ drop DB schema/database        │
        │                          deallocate Redis                │
        │                          delete Vault path               │
        │                          optional: purge volumes Docker  │
        │                          DELETE FROM apps.app_volumes    │
        │  4. delete-records ──→ DELETE FROM apps.applications     │
        │                       (cascade → apps.deployments)       │
        │                                                          │
        └──────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Décider du mode de suppression

Deux variantes :

### Mode soft (`purge=false`, défaut)

- Container supprimé, route supprimée, DNS supprimé, Vault supprimé, BDD supprimée
- **Volumes Docker conservés** : si on réinstalle plus tard avec le même `app_id`, les données sont récupérées (les volumes nommés `soclehub-<appId>-<volname>` survivent et sont réattachés)
- Recommandé pour une désinstallation temporaire ou réversible

### Mode hard (`purge=true`)

- **Tout** est supprimé, y compris les volumes Docker
- Les fichiers persistants de l'app (uploads, BDD locale type SQLite, configs) sont définitivement perdus
- Recommandé uniquement si on est certain de ne plus jamais réinstaller l'app

**Décision rapide** :

```
A-t-on besoin des données plus tard ?
├─ Oui  → purge=false  (peut revenir en arrière par réinstallation)
├─ Non  → backup d'abord, puis purge=true
└─ Inconnu → toujours purge=false par défaut
```

Backup avant purge :

```bash
# Pour l'app wp-acme avec MariaDB
curl -X POST http://localhost:8080/api/actions/db_worker/backup_app_db \
  -H "Content-Type: application/json" \
  -d '{"app_id": "wp-acme"}'

# Pour les fichiers du volume
docker run --rm -v soclehub-wp-acme-html:/data \
  -v $(pwd):/backup ubuntu tar czf /backup/wp-acme-html-backup.tar.gz /data
```

---

## 4. Étape 2 — Lancer la désinstallation

Mode soft :

```bash
curl -X POST http://localhost:8080/api/actions/docker/uninstall_app \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: dev" \
  -d '{
    "app_id": "wp-acme",
    "purge": false
  }'
```

Mode hard :

```bash
curl -X POST http://localhost:8080/api/actions/docker/uninstall_app \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: dev" \
  -d '{
    "app_id": "wp-acme",
    "purge": true
  }'
```

Réponse 202 :

```json
{
  "status": "accepted",
  "jobId": "job-uninst-1234",
  "worker": "docker",
  "action": "uninstall_app"
}
```

Logs en direct :

```bash
docker logs -f soclehub-app | grep "\[uninstall:wp-acme\]"
```

Sortie attendue :

```
[uninstall:wp-acme][stage:1/4] Looking up application (purge=false)
[uninstall:wp-acme][stage:1/4] Stopping and removing container
[uninstall:wp-acme][stage:2/4] Removing proxy routing and DNS records
[uninstall:wp-acme] Deleted DNS record blog-acme.thesocle.net from Cloudflare
[uninstall:wp-acme][stage:3/4] Cleaning up resources
[uninstall:wp-acme] Failed to drop MariaDB database: ... (ignored — best effort)
[uninstall:wp-acme] Redis database flushed and deallocated
[uninstall:wp-acme] Keeping 1 Docker volume(s) (purge=false)
[uninstall:wp-acme][stage:4/4] Deleting database records
[uninstall:wp-acme] Uninstallation complete (purge=false)
```

Résultat :

```json
{
  "app_id": "wp-acme",
  "status": "uninstalled",
  "volumes_purged": false,
  "volumes_count": 1
}
```

---

## 5. Étape 3 — Comprendre les 4 stages

Référence : `/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/pipeline/AppUninstallPipeline.java`

### Stage 1 — Stop container

```java
String containerId = (String) appRow.get("container_id");
if (containerId != null && !containerId.isEmpty()) {
    try {
        dockerService.stopContainer(containerId);
    } catch (Exception e) {
        log.warn("[uninstall:{}] Failed to stop container: {}", appId, e.getMessage());
    }
    try {
        dockerService.removeContainer(containerId);
    } catch (Exception e) {
        log.warn("[uninstall:{}] Failed to remove container: {}", appId, e.getMessage());
    }
}
```

**Tolérance d'erreur** : `try/catch` séparés. Si stop échoue (container déjà mort), remove est tenté. Si remove échoue (container disparu), on continue.

### Stage 2 — Remove routing + DNS

```java
routingTable.remove(fqdn);  // mémoire

// DNS — supprime depuis Cloudflare ET dns.records
cleanupDnsRecords(appId, fqdn);

// proxy_routes en BDD
DELETE FROM apps.proxy_routes WHERE app_id = ?;
```

`cleanupDnsRecords` matche tout record `record_name = fqdn` ou `record_name LIKE %.fqdn` (pour attraper les sub-subdomains comme `api-minio.thesocle.net`).

### Stage 3 — Cleanup resources

Dans cet ordre (best-effort indépendants) :

1. **Drop database** :
   - `dbType=postgres` → `databaseProvisioningService.dropPostgresSchema(appId)` exécute `DROP SCHEMA app_<appId> CASCADE`,
   - `dbType=mysql/mariadb` → `dropMariadbDatabase(appId)` exécute `DROP DATABASE app_<appId>` + `DROP USER`,
2. **Deallocate Redis** : `redisProvisioningService.deallocateRedisDb(appId)` flush la DB Redis assignée et libère l'index dans `apps.redis_allocation`,
3. **Delete Vault path** : `vaultService.deleteAppPath(appId)` supprime tout sous `soclehub/apps/<appId>/`,
4. **Lecture des volumes** depuis `apps.app_volumes` :
   ```sql
   SELECT volume_name FROM apps.app_volumes WHERE app_id = ?;
   ```
5. **Si purge=true** : pour chaque `volume_name`, `dockerService.removeVolume(volName)`. Sinon, log "Keeping N Docker volume(s)",
6. **DELETE FROM apps.app_volumes** dans tous les cas (les volumes Docker peuvent persister sans avoir besoin du record applicatif).

### Stage 4 — Delete application record

```sql
DELETE FROM apps.applications WHERE app_id = ?;
```

**Note importante** : la FK `fk_deployments_applications` est en `ON DELETE CASCADE` (`id_applications bigint NOT NULL`). Ce DELETE **supprime donc aussi** toutes les lignes `apps.deployments` rattachées. L'historique d'install/update n'est **pas conservé** après uninstall — exporter `apps.deployments` avant si besoin d'audit (cf. §6).

---

## 6. Étape 4 — Exporter `apps.deployments` AVANT uninstall

Comme la FK est en `ON DELETE CASCADE`, l'historique disparaît au stage 4. Pour le conserver (audit "quelle version tournait quand telle anomalie est survenue"), exportez-le **avant** la désinstallation :

```sql
-- Snapshot CSV de l'historique avant uninstall
COPY (
  SELECT
    d.x_dateCreated,
    d.action,
    d.from_version,
    d.to_version,
    d.status,
    d.triggered_by,
    a.app_id
  FROM apps.deployments d
  JOIN apps.applications a ON a.x_id = d.id_applications
  WHERE a.app_id = 'wp-acme'
  ORDER BY d.x_dateCreated DESC
) TO '/tmp/wp-acme-deployments.csv' WITH CSV HEADER;
```

Après l'uninstall, la requête ci-dessus renvoie 0 ligne (cascade). Si vous voulez conserver l'historique en base, l'alternative est de **ne pas désinstaller** (laisser l'app en `status=stopped`) ou de copier les lignes voulues dans une table d'archive maison avant de lancer `uninstall_app`.

---

## 7. Étape 5 — Variante IHM portail

```
Browser ──→ GET  https://admin.thesocle.net/hub/apps/wp-acme
         ←── HTML détail (bouton "Désinstaller" rouge)

Browser ──→ click "Désinstaller"
         ←── Modal confirmation : checkbox "Purger les volumes (irréversible)"

Browser ──→ POST https://admin.thesocle.net/hub/apps/wp-acme/uninstall?purge=false

PortalDashboardController.uninstallApp(...) appelle dockerWorker.executeAction("uninstall_app", ...)
```

Le portail ne propose `purge=true` que si l'admin coche explicitement la case (anti-UX-erreur).

---

## 8. Validation

### Vérifier la suppression

```bash
# get_app doit renvoyer "Application not found"
curl -s -X POST http://localhost:8080/api/actions/docker/get_app \
  -H "Content-Type: application/json" \
  -d '{"app_id": "wp-acme"}' | jq
# Attendu : {"success": false, "error": "Application not found: wp-acme"}
```

### Orphan check : ne reste-t-il rien ?

```bash
#!/bin/bash
APP_ID="wp-acme"

echo "=== Container ==="
docker ps -a --filter name=soclehub-${APP_ID}
# Attendu : vide

echo "=== Image ==="
docker images | grep soclehub-${APP_ID}
# Attendu : vide (les images publiques restent)

echo "=== Volumes ==="
docker volume ls | grep soclehub-${APP_ID}
# Attendu (purge=false) : volumes encore présents
# Attendu (purge=true) : vide

echo "=== apps.applications ==="
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "SELECT app_id FROM apps.applications WHERE app_id = '${APP_ID}';"
# Attendu : 0 rows

echo "=== apps.proxy_routes ==="
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "SELECT hostname FROM apps.proxy_routes WHERE app_id = '${APP_ID}';"
# Attendu : 0 rows

echo "=== dns.records ==="
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "SELECT record_name FROM dns.records WHERE record_name LIKE '%${APP_ID}%';"
# Attendu : 0 rows

echo "=== Vault path ==="
curl -s http://localhost:8080/api/actions/vault_worker/get_secret_keys \
  -X POST -H "Content-Type: application/json" \
  -d "{\"path\": \"soclehub/apps/${APP_ID}\"}" | jq
# Attendu : {"success": false} ou liste vide

echo "=== Schema PostgreSQL (si dbType=postgres) ==="
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "\dn" | grep "app_${APP_ID}"
# Attendu : vide

echo "=== Database MariaDB (si dbType=mysql) ==="
docker exec soclehub-mariadb mariadb -uroot -p${MARIADB_ROOT_PASSWORD} -e \
  "SHOW DATABASES LIKE 'app_${APP_ID}%';"
# Attendu : vide

echo "=== Cloudflare DNS ==="
# Vérifier en API ou dans le dashboard CF
dig +short blog-acme.thesocle.net
# Attendu : pas de réponse ou ancien TTL puis vide

echo "=== apps.deployments (cascade : supprimés avec l'app) ==="
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "SELECT count(*) FROM apps.deployments d
   JOIN apps.applications a ON a.x_id = d.id_applications
   WHERE a.app_id = '${APP_ID}';"
# Attendu : 0 (la FK ON DELETE CASCADE a supprimé les deployments de cette app)
```

### Tester l'absence côté proxy

```bash
curl -k https://blog-acme.thesocle.net/
# Attendu : 404 Not Found (route inconnue) ou page d'accueil par défaut
```

---

## 9. Pièges courants

### Piège 1 — `Application not found`

**Symptôme** : uninstall renvoie 500 avec ce message.

**Cause** : `app_id` typo ou app déjà désinstallée.

**Résolution** : `SELECT app_id FROM apps.applications` pour vérifier. Si l'app n'existe plus mais qu'il reste des miettes (volume, DNS, etc.), nettoyer manuellement.

### Piège 2 — Volume non purgé malgré `purge=true`

**Symptôme** : `docker volume ls | grep soclehub-wp-acme` retourne encore des volumes après uninstall.

**Cause** : un autre container utilise encore le volume (race condition), ou la table `apps.app_volumes` était vide (volumes pas enregistrés à l'install).

**Résolution** : forcer le remove :

```bash
docker volume rm soclehub-wp-acme-html
# Si "volume in use" :
docker ps -a --filter volume=soclehub-wp-acme-html
docker rm <container-id>
docker volume rm soclehub-wp-acme-html
```

### Piège 3 — DNS ne disparait pas de Cloudflare

**Symptôme** : log `CF delete failed for blog-acme.thesocle.net`. Le record reste dans CF.

**Cause** : `cloudflare_record_id` était NULL en base (record créé hors pipeline), ou token CF expiré, ou record déjà supprimé manuellement.

**Résolution** : supprimer manuellement via dashboard CF, ou via API :

```bash
curl -X DELETE -H "Authorization: Bearer ${CF_TOKEN}" \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}"
```

### Piège 4 — Schema PostgreSQL pas droppé

**Symptôme** : log `Failed to drop PostgreSQL schema: ...`. Le schema reste.

**Cause** : connexions actives sur le schema (utilisateur connecté à l'IDE pgAdmin) bloquent le DROP, ou le user `socle_prod` n'a pas le privilège DROP SCHEMA.

**Résolution** :

```sql
-- Tuer les connexions actives
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'socle_prod' AND pid <> pg_backend_pid()
  AND query LIKE '%app_wp_acme%';

-- Drop manuel
DROP SCHEMA app_wp_acme CASCADE;
```

### Piège 5 — Vault path orphelin

**Symptôme** : `vault list soclehub/apps/wp-acme/` renvoie encore des secrets.

**Cause** : `vaultService.deleteAppPath` ne fait qu'un soft delete (sur Vault KV v2), les versions historiques restent.

**Résolution** :

```bash
# Connect dans le container Vault
docker exec -it soclehub-vault sh
# Destroy toutes les versions
vault kv metadata delete soclehub/apps/wp-acme
```

### Piège 6 — Container reste running

**Symptôme** : `docker ps` montre encore `soclehub-wp-acme`.

**Cause** : stop a échoué (container hung), remove a fail aussi.

**Résolution** :

```bash
# Force kill
docker kill $(docker ps -qf name=soclehub-wp-acme)
docker rm -f $(docker ps -aqf name=soclehub-wp-acme)
```

### Piège 7 — Route proxy fantôme

**Symptôme** : `curl -k https://blog-acme.thesocle.net` renvoie 502 au lieu de 404.

**Cause** : la routing-table en mémoire n'a pas été synchronisée. Le DELETE en base est passé mais le `ProxyWorker` n'a pas reloadé.

**Résolution** :

```bash
curl -X POST http://localhost:8080/api/actions/proxy_worker/health_check_all
# ou redémarrer le worker
curl -X POST http://localhost:8080/api/actions/control_worker/set_mode \
  -d '{"worker": "proxy_worker", "mode": "running"}'
```

### Piège 8 — Redis allocation pas libérée

**Symptôme** : `list_redis_allocations` montre encore l'app.

**Cause** : la deallocation a échoué silencieusement (Redis indisponible au moment de l'uninstall).

**Résolution** :

```bash
curl -X POST http://localhost:8080/api/actions/db_worker/flush_redis_db \
  -H "Content-Type: application/json" \
  -d '{"app_id": "wp-acme"}'
```

Ou directement :

```bash
docker exec soclehub-redis redis-cli SELECT 5
docker exec soclehub-redis redis-cli FLUSHDB
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "DELETE FROM apps.redis_allocation WHERE app_id = 'wp-acme';"
```

### Piège 9 — IAM role `app:wp-acme:user` non supprimé

**Symptôme** : `iam_worker/list_roles` montre encore le role.

**Cause** : le pipeline d'uninstall **ne supprime pas** la définition du role IAM (volontaire — peut être référencé par d'autres apps en cas de partage de scope). À noter : l'action MCP `iam_worker/revoke_role` (params `user_id` + `role_name`) ne fait que **retirer un role à un utilisateur**, elle ne supprime pas la définition du role (cf. [[10-iam-worker]]).

**Résolution** : retirer le role des utilisateurs concernés, puis supprimer la définition orpheline en SQL si vraiment plus utilisée :

```bash
# Retirer le role d'un utilisateur
curl -X POST http://localhost:8080/api/actions/iam_worker/revoke_role \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"user_id": "<uuid-user>", "role_name": "app:wp-acme:user"}'
```

```sql
-- Suppression manuelle de la définition du role (aucune autre app ne doit le référencer)
DELETE FROM iam.db_roles WHERE name = 'app:wp-acme:user';
```

### Piège 10 — Réinstaller donne `app_id already exists`

**Symptôme** : après uninstall (`purge=false`), un `install_app` avec le même `app_id` échoue au stage 1.

**Cause** : un cleanup partiel a laissé une trace en base (ligne `apps.applications` non supprimée). Survient si le stage 4 a échoué (verrou foreign key).

**Résolution** :

```sql
-- Nettoyage manuel (le DELETE sur applications cascade sur deployments)
DELETE FROM apps.proxy_routes WHERE app_id = 'wp-acme';
DELETE FROM apps.app_volumes WHERE app_id = 'wp-acme';
DELETE FROM apps.applications WHERE app_id = 'wp-acme';
```

Puis relancer `install_app`.

---

## 10. Pour aller plus loin

- [[62-pipeline-uninstall|Pipeline d'uninstall (4 stages)]] — référence interne stage par stage et tolérance d'erreur best-effort,
- [[30-docker-worker|DockerWorker]] — liste complète des actions (`uninstall_app`, `get_app`, `list_apps`…),
- [[41-dns-sync-worker|DnsSyncWorker]] — gestion des records DNS Cloudflare et de la table `dns.records`,
- [[11-vault-worker|VaultWorker]] — `deleteAppPath` et soft-delete KV v2 (cf. piège 5),
- Voir `howto-03-installer-une-app.md` pour la procédure d'installation,
- Voir `howto-04-mettre-a-jour-une-app.md` pour mettre à jour une app au lieu de la réinstaller,
- Voir `agent-guide/02-task-decision-tree.md` tâche "Désinstaller proprement" pour le diagramme de décision purge / soft.
