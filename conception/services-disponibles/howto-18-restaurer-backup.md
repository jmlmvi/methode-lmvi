# HOWTO 18 — Restaurer un backup SocleHub (DB d'app, ou environnement complet)

**Niveau :** Senior
**Prérequis :** SocleHub Hub 3.12.1 déployé (existant ou neuf), accès SSH root au serveur, le fichier `soclehub-backup-YYYY-MM-DD_HHMM.tar.gz` produit par `./scripts/backup.sh` ou un volume Docker à restaurer, accès au DNS Cloudflare si l'IP serveur change.
**Temps estimé :** 30 min (DB d'app) à 2h (environnement complet)

---

## 1. Contexte

> **Note 3.12.1 — système de sauvegarde managé.** Depuis Hub 3.x, le système de sauvegarde de référence n'est plus l'ancien couple `db_worker/list_backups` + `restore_backup` (stubs historiques), mais le [[47-backup-worker|`BackupWorker`]] qui pilote un daemon Go `socle-backup` (conteneur `soclehub-backup:8090`). Les destinations S3, schedules cron et runs sont persistés sous le schéma PostgreSQL `backup.*` (`backup.z_s3_destinations`, `backup.z_schedules`, `backup.z_runs`, `backup.z_run_items`), les credentials S3 vivant dans Vault sous `backup/destination-<name>`. Pour la sauvegarde managée et l'historique des runs, préférer les actions `backup_worker/run_now`, `list_runs`, `get_run` et `purge_old_runs` (cf. [[47-backup-worker]]). Les scénarios ci-dessous couvrent la restauration "à froid" via les dumps/volumes Docker, qui reste valable quel que soit le mode de sauvegarde.

Deux niveaux de restauration cohabitent :

1. **Restore de la DB d'une app spécifique** (ex: `appdemo` corrompue après une mauvaise migration). On veut juste rejouer un dump pgsql/mysql d'il y a 24 h sans toucher au reste. C'est le rôle du `db_worker/list_backups` + `db_worker/restore_backup`. Volumétrie : quelques MB à quelques GB. Durée : minutes.

2. **Restore complet du Hub** (panne disque, corruption volume Docker, migration de serveur). On reconstruit tout l'environnement depuis le backup `tar.gz` produit par `./scripts/backup.sh` : PostgreSQL, MariaDB, données applicatives Hub (TechDB H2 + keystores + logs), config `.env`, catalogue d'apps. Volumétrie : 100 MB à plusieurs GB. Durée : 1-2 h selon volumes.

Les exigences communes :

- **Idempotence** — restorer deux fois le même backup donne le même résultat.
- **No data loss** — si le serveur a évolué entre le backup et le restore (ex: nouvelles users), avertir avant écrasement.
- **TLS continuity** — après restore, le cert ACME doit toujours être valide ou être réémis sans downtime.
- **App downtime** — pendant la restauration, les apps métier sont inaccessibles. Acceptable car le scénario est exceptionnel.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SCÉNARIO 1 : RESTORE DB D'APP                │
│                                                                      │
│   Admin ──MCP──► db_worker/list_backups                              │
│                  └► retourne [{id, app_id, size, created_at}]        │
│   Admin ──MCP──► db_worker/restore_backup {app_id, backup_id}        │
│                  └► DatabaseProvisioningService :                    │
│                       1. DROP SCHEMA app_<id> CASCADE                │
│                       2. psql -f /backups/<backup_id>.sql            │
│                       3. UPDATE apps.application SET schema_version  │
│                  └► ASYNC : retourne immédiatement                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                  SCÉNARIO 2 : RESTORE COMPLET DU HUB                 │
│                                                                      │
│  ./scripts/restore.sh /chemin/soclehub-backup-2026-04-28_0300.tar.gz │
│       │                                                              │
│       ├── 1. Stop tous les containers : docker compose down          │
│       ├── 2. Restore volumes :                                       │
│       │     postgres-data ◄── pg_restore                             │
│       │     mariadb-data  ◄── mariadb-import                         │
│       │     vault-data    ◄── tar -xzf                               │
│       │     minio-data    ◄── tar -xzf                               │
│       │     soclehub-data ◄── tar -xzf (TechDB, keystores, logs)     │
│       ├── 3. Restore .env (préserve l'ancien si différent)           │
│       ├── 4. docker compose up -d                                    │
│       ├── 5. Vérification healthcheck                                │
│       └── 6. Refresh cert ACME si IP a changé                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. SCÉNARIO 1 — Restaurer la DB d'une seule app

### 3.1 Lister les backups disponibles

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/db_worker/actions/list_backups \
  -H "Authorization: Bearer $MCP_API_KEY" | jq
```

Réponse :

```json
{
  "backups": [
    {
      "id": "bk-20260427-030001-appdemo",
      "app_id": "appdemo",
      "schema_name": "app_appdemo",
      "size_bytes": 4523678,
      "size_formatted": "4.3 MB",
      "created_at": "2026-04-27T03:00:01Z",
      "engine": "postgresql",
      "file_path": "/backups/bk-20260427-030001-appdemo.sql.gz"
    },
    {
      "id": "bk-20260426-030002-appdemo",
      "app_id": "appdemo",
      "schema_name": "app_appdemo",
      "size_bytes": 4498211,
      "size_formatted": "4.3 MB",
      "created_at": "2026-04-26T03:00:02Z",
      "engine": "postgresql",
      "file_path": "/backups/bk-20260426-030002-appdemo.sql.gz"
    }
  ],
  "count": 2
}
```

Note : `db_worker/list_backups` est resté un stub historique (liste vide). En 3.12.1, le listing de référence passe par le [[47-backup-worker|`BackupWorker`]] (`backup_worker/list_runs`) ou directement par le bucket S3 `backups` via le `StorageWorker` :

```bash
# Lister les backups directement via storage_worker (méthode robuste)
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_browse \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"backups","prefix":"appdemo/"}' | jq
```

### 3.2 Lancer le restore

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/db_worker/actions/restore_backup \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "appdemo",
    "backup_id": "bk-20260427-030001-appdemo"
  }' | jq
```

Réponse :

```json
{
  "appId": "appdemo",
  "backupId": "bk-20260427-030001-appdemo",
  "status": "restore_started",
  "note": "stub implementation"
}
```

### 3.3 Suivre la progression et redémarrer l'app

Le restore est `ASYNC` : l'API retourne immédiatement, mais le job tourne en arrière-plan. Suivre dans les logs du Hub :

```bash
docker logs -f soclehub | grep "step:restore"
# [worker:db_worker][step:restore_backup] Restoring app=appdemo from backup=bk-20260427-030001-appdemo
# [worker:db_worker][step:restore_drop_schema] Dropping schema app_appdemo
# [worker:db_worker][step:restore_psql_start] Loading 4.3 MB from /backups/bk-20260427-030001-appdemo.sql.gz
# [worker:db_worker][step:restore_done] Restored in 23 seconds, 87 tables, 14523 rows
```

Une fois le restore terminé, redémarrer l'app pour qu'elle re-pool les connections :

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/docker_worker/actions/restart_app \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"appdemo"}' | jq
```

### 3.4 Validation

```bash
# 1. Schéma présent
curl -s -X POST https://admin.thesocle.net/admin/workers/db_worker/actions/list_schemas \
  -H "Authorization: Bearer $MCP_API_KEY" | jq '.schemas[] | select(. == "app_appdemo")'

# 2. Stats du schéma
curl -s -X POST https://admin.thesocle.net/admin/workers/db_worker/actions/get_schema_stats \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"appdemo"}' | jq

# 3. App fonctionne
docker exec soclehub curl -s http://appdemo:8080/admin/health
```

---

## 4. SCÉNARIO 2 — Restore complet du Hub sur le même serveur

### 4.1 Pré-restore : geler l'environnement

```bash
ssh ubuntu@51.255.205.19
cd /opt/thesocle

# 1. Avertir les utilisateurs (downtime ~30 min)
# 2. Backup courant pour rollback safety net
./scripts/backup.sh /opt/backups
# soclehub-backup-2026-04-28_pre-restore.tar.gz

# 3. Stopper proprement
docker compose -f docker/docker-compose.yml down
```

### 4.2 Lancer le script de restore

```bash
./scripts/restore.sh /opt/backups/soclehub-backup-2026-04-27_0300.tar.gz
```

Le script (extrait du `restore.sh`) :

1. Demande confirmation `(oui/non)` — toujours `oui` pour continuer
2. **[1/4]** `tar -xzf` dans `/tmp/soclehub-restore-$$`
3. **[2/4]** Restore PostgreSQL :
   ```bash
   docker exec -i soclehub-postgres psql -U $POSTGRES_USER -d postgres < $RESTORE_DIR/postgresql-dump.sql
   ```
4. **[3/4]** Restore MariaDB :
   ```bash
   docker exec -i soclehub-mariadb mariadb -u root -p"$MARIADB_ROOT_PASSWORD" < $RESTORE_DIR/mariadb-dump.sql
   ```
5. **[4/4]** Copie des données applicatives Hub :
   ```bash
   docker cp $RESTORE_DIR/app-data/. soclehub:/app/data/
   ```
6. Cleanup `/tmp/soclehub-restore-$$`

Sortie attendue :

```
=== SocleHub Restore ===
  Source : /opt/backups/soclehub-backup-2026-04-27_0300.tar.gz

ATTENTION : Cela va ecraser les donnees actuelles. Continuer ? (oui/non) oui

[1/4] Extraction du backup...
[2/4] Restauration PostgreSQL...
  PostgreSQL restaure
[3/4] Restauration MariaDB...
  MariaDB restaure
[4/4] Restauration donnees applicatives...
  Donnees restaurees

=== Restauration terminee ===
Redemarrez SocleHub pour appliquer :
  docker compose -f docker/docker-compose.yml restart soclehub
```

### 4.3 Redémarrer et vérifier

```bash
# Si les containers sont déjà up (backup hot)
docker compose -f docker/docker-compose.yml restart soclehub

# Sinon (cold restore)
docker compose -f docker/docker-compose.yml up -d

# Attendre le healthcheck
sleep 60
curl -sI https://admin.thesocle.net/admin/health
# HTTP/2 200
```

---

## 5. SCÉNARIO 3 — Restore manuel des volumes Docker

Cas où `restore.sh` n'est pas adapté (backup partiel, restore sélectif, migration de serveur).

### 5.1 Stopper proprement

```bash
docker compose -f docker/docker-compose.yml down
```

### 5.2 Restore volume par volume

```bash
# Trouver le chemin Docker du volume cible
docker volume inspect docker_postgres-data | jq -r '.[0].Mountpoint'
# /var/lib/docker/volumes/docker_postgres-data/_data

# Extraire le tarball ailleurs et copier
mkdir -p /tmp/restore && cd /tmp/restore
tar -xzf /opt/backups/soclehub-backup-2026-04-27_0300.tar.gz
ls
# soclehub-backup-2026-04-27_0300/

cd soclehub-backup-2026-04-27_0300/
ls
# app-data/  catalog.json  env-backup  mariadb-dump.sql  postgresql-dump.sql

# Pour PostgreSQL : utiliser psql (le dump est un SQL pas un dump binaire)
docker compose -f /opt/thesocle/docker/docker-compose.yml up -d postgres
sleep 15
docker exec -i soclehub-postgres psql -U socle_prod -d postgres < postgresql-dump.sql

# Pour les volumes binaires (MinIO, Vault) : tar
# Si vous avez sauvé les volumes via tar dans /var/lib/docker/volumes :
# (le scripts/backup.sh par défaut ne les inclut pas — ajouter manuellement si besoin)
sudo systemctl stop docker
sudo tar -xzf minio-data-snapshot.tar.gz -C /var/lib/docker/volumes/docker_minio-data/_data
sudo systemctl start docker
```

### 5.3 Restore .env (avec précaution)

```bash
# Comparer l'ancien et le nouveau
diff /tmp/restore/soclehub-backup-2026-04-27_0300/env-backup /opt/thesocle/docker/.env

# Si écrasement souhaité (passer à la config exacte de l'instant T du backup)
cp /tmp/restore/soclehub-backup-2026-04-27_0300/env-backup /opt/thesocle/docker/.env

# Sinon, ne reprendre que les variables critiques (mots de passe DB)
```

---

## 6. SCÉNARIO 4 — Migration de serveur (IP différente)

L'IP serveur change → le DNS A doit être mis à jour ET le cert ACME peut nécessiter un re-issue.

### 6.1 Sur le nouveau serveur

```bash
# 1. Provisionner Docker (cf howto-17 étape 1)
# 2. Récupérer le pack et le backup
scp ubuntu@old-server:/opt/thesocle/* /opt/thesocle/
scp ubuntu@old-server:/opt/backups/soclehub-backup-LATEST.tar.gz /opt/backups/

# 3. Restaurer (sans démarrer)
cd /opt/thesocle
docker compose -f docker/docker-compose.yml up -d postgres mariadb
./scripts/restore.sh /opt/backups/soclehub-backup-LATEST.tar.gz

# 4. Mettre à jour SERVER_IP dans .env
sed -i "s/^SERVER_IP=.*/SERVER_IP=$(curl -s ifconfig.me)/" docker/.env

# 5. Démarrer le hub
docker compose -f docker/docker-compose.yml up -d
```

### 6.2 Mettre à jour le DNS Cloudflare

```bash
# Soit via la UI Cloudflare (DNS → modifier le record A)
# Soit via API
NEW_IP=$(curl -s ifconfig.me)
ZONE_ID="86456e1a0b630a8007a917b3c7c9c3ad"
RECORD_NAME="admin.thesocle.net"

# Trouver l'ID du record
RECORD_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$RECORD_NAME" \
  | jq -r '.result[0].id')

# Update
curl -s -X PUT \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"A\",\"name\":\"$RECORD_NAME\",\"content\":\"$NEW_IP\",\"ttl\":120}" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" | jq
```

### 6.3 Vérifier le cert ACME

```bash
# Le cert reste valide tant qu'il n'a pas expiré (validité 90 jours).
# Mais le DNS-01 challenge nouvelle émission marchera dès que le DNS est propagé.
curl -s -X POST https://admin.thesocle.net/admin/workers/acme_worker/actions/check_expiry \
  -H "Authorization: Bearer $MCP_API_KEY" | jq
```

Si le cert est encore valide (< 90 jours) : aucun action. L'AcmeWorker renouvellera automatiquement à T-30 jours.

Si le cert a expiré pendant la migration :

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/acme_worker/actions/force_renew \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domain":"admin.thesocle.net"}' | jq

docker compose -f docker/docker-compose.yml restart soclehub
```

---

## 7. Validation post-restore

```bash
#!/bin/bash
set -e
DOMAIN="admin.thesocle.net"
TOKEN="$MCP_API_KEY"

echo "=== 1. Healthcheck ==="
curl -s https://$DOMAIN/admin/health | jq '.status'

echo "=== 2. Login admin ==="
LOGIN=$(curl -s -X POST https://$DOMAIN/api/v1/iam/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$BOOTSTRAP_ADMIN_EMAIL\",\"password\":\"$BOOTSTRAP_ADMIN_PASSWORD\"}")
JWT=$(echo "$LOGIN" | jq -r '.access_token')
echo "JWT obtenu: ${JWT:0:30}..."

echo "=== 3. Liste utilisateurs préservée ==="
curl -s https://$DOMAIN/api/v1/iam/users -H "Authorization: Bearer $JWT" | jq '.users | length'

echo "=== 4. Apps installées listées ==="
curl -s -X POST https://$DOMAIN/admin/workers/docker_worker/actions/list_apps \
  -H "Authorization: Bearer $TOKEN" | jq '.apps[] | .app_id'

echo "=== 5. Storage MinIO accessible ==="
curl -s -X POST https://$DOMAIN/admin/workers/storage_worker/actions/storage_stats \
  -H "Authorization: Bearer $TOKEN" | jq '.totalSizeFormatted, .totalFiles'

echo "=== 6. Vault déchiffré ==="
curl -s https://$DOMAIN/admin/workers/vault_worker/stats \
  -H "Authorization: Bearer $TOKEN" | jq '.sealed'
# Attendu : false

echo "=== 7. Cert TLS valide ==="
echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null \
  | openssl x509 -noout -dates
```

---

## 8. Pièges courants

### Piège 1 — `restore_backup` retourne `note: stub implementation`

**Symptôme :** Le restore ne semble rien faire.
**Cause :** `db_worker/restore_backup` est resté un stub. En 3.12.1, la restauration n'est pas exposée comme action MCP one-shot — elle s'effectue à froid via les dumps/volumes (scénarios 2 à 4) ou en rejouant un run S3 produit par le [[47-backup-worker|`BackupWorker`]].
**Résolution :** Vérifier la version Hub : `curl -s admin.../admin/info | jq .version`. Restaurer manuellement :

```bash
docker exec -i soclehub-postgres psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "DROP SCHEMA app_appdemo CASCADE;"
gunzip -c /opt/backups/bk-20260427-030001-appdemo.sql.gz \
  | docker exec -i soclehub-postgres psql -U $POSTGRES_USER -d $POSTGRES_DB
```

### Piège 2 — `psql: connection to server failed: FATAL: password authentication failed`

**Symptôme :** Restore échoue dès le début.
**Cause :** `POSTGRES_PASSWORD` du `.env` actuel ≠ celui du backup. Le volume restoré contient l'ancien hash du mot de passe.
**Résolution :** Soit restaurer aussi `env-backup` du tarball, soit forcer le password via single-user mode :

```bash
docker exec -it soclehub-postgres psql -U postgres -c "ALTER USER socle_prod WITH PASSWORD '$NEW_PASSWORD';"
```

### Piège 3 — MariaDB restore : "ERROR 1227 (42000): Access denied"

**Symptôme :** `mariadb-dump --all-databases` contient des `CREATE USER` mais le user courant n'a pas le `CREATE USER` privilege.
**Cause :** Le dump contient des grants qui requièrent SUPER privilege.
**Résolution :** Restorer en root direct :

```bash
docker exec -i soclehub-mariadb mariadb -u root -p"$MARIADB_ROOT_PASSWORD" < dump.sql
# Si erreur "GRANT", filtrer :
grep -v "^GRANT\|^REVOKE\|^CREATE USER" dump.sql > dump-filtered.sql
docker exec -i soclehub-mariadb mariadb -u root -p"$MARIADB_ROOT_PASSWORD" < dump-filtered.sql
```

### Piège 4 — `docker cp` skip silencieux

**Symptôme :** `restore.sh` dit "Donnees restaurees" mais `/app/data` reste vide dans le container.
**Cause :** Le container `soclehub` n'est pas démarré au moment du `docker cp`.
**Résolution :** Démarrer d'abord le container, puis restorer :

```bash
docker compose up -d soclehub
sleep 5
docker cp /tmp/restore/soclehub-backup-.../app-data/. soclehub:/app/data/
docker compose restart soclehub
```

### Piège 5 — Cert ACME perdu après restore

**Symptôme :** Après restore, navigateur affiche cert auto-signé.
**Cause :** Le cert est stocké dans la TechDB (volume `soclehub-data`). Si le backup ne l'a pas inclus, perte.
**Résolution :** Le `backup.sh` 3.12.1 inclut bien `/app/data` (TechDB H2). Vérifier `tar -tzf backup.tar.gz | grep keystore`. Sinon, force renew via `acme_worker/force_renew`.

### Piège 6 — Volumes Vault sealed après restore

**Symptôme :** Les apps n'arrivent plus à lire leurs secrets.
**Cause :** Vault en dev mode (token simple) re-seal à chaque restart si le storage ne contient pas la `seal config`.
**Résolution :** Dans le `.env`, vérifier que `VAULT_TOKEN` est cohérent. En dev mode (`VAULT_DEV_TOKEN`), Vault re-init à chaque démarrage avec ce token, donc rejouer les `vault_worker/set_secret` après restore.

### Piège 7 — Cluster split-brain après restore d'une moitié

**Symptôme :** PostgreSQL tourne mais les workers du Hub voient un schema vide.
**Cause :** Restore de Postgres OK, mais MariaDB skipped (fichier dump absent), et certains workers ont besoin des deux.
**Résolution :** Toujours restaurer atomiquement les deux DB. Vérifier `tar -tzf | grep dump`.

### Piège 8 — Trop d'apps dans `apps.application` mais containers absents

**Symptôme :** Le portail liste 5 apps mais `docker ps` n'en montre que 2.
**Cause :** Le backup contient l'état logique des apps (table `apps.application`) mais les images Docker n'ont pas été pull.
**Résolution :** Pour chaque app `not running`, soit la réinstaller (`docker_worker/install_app`), soit la supprimer du registre.

### Piège 9 — Backup tar.gz corrompu (stocke `.gz` non-lisible)

**Symptôme :** `tar: Unexpected EOF in archive`.
**Cause :** Backup interrompu (out of disk, kill du process).
**Résolution :** Toujours valider le backup juste après création :

```bash
tar -tzf /opt/backups/soclehub-backup-LATEST.tar.gz > /dev/null && echo "OK" || echo "CORRUPTED"
```

Garder N-1 et N-2 backups en plus du dernier. Supprimer les corrompus pour ne pas miser dessus.

### Piège 10 — `scripts/restore.sh` ne demande pas confirmation et écrase tout

**Symptôme :** Tout l'environnement est écrasé sans warning.
**Cause :** Le script 3.12.1 a `read -p "ATTENTION..."` mais en mode non-interactif (cron, CI), `read` consume immédiatement.
**Résolution :** Pour automatiser, exporter `CONFIRM=oui` avant le call ou modifier le script. Mais surtout, **ne jamais lancer restore.sh en cron**.

### Piège 11 — Différence d'horloge UTC vs local cause confusion sur backup_id

**Symptôme :** Le timestamp `2026-04-27_0300` du backup est en UTC mais l'admin pense en heure locale.
**Cause :** `date +%Y-%m-%d_%H%M` dans `backup.sh` utilise le TZ du container.
**Résolution :** Forcer UTC dans le script : `TZ=UTC date +%Y-%m-%dT%H%M%SZ`. Convention recommandée.

### Piège 12 — Backup `mariadb-dump --all-databases` inclut `mysql` system DB

**Symptôme :** Restore plante avec `Cannot drop database 'mysql'`.
**Cause :** Le dump contient les tables système MariaDB (`mysql.*`), conflit avec le dump cible déjà créé.
**Résolution :** Filtrer côté backup : `--databases db1 db2 db3` au lieu de `--all-databases`. Ou côté restore :

```bash
sed '/^USE `mysql`/,/^USE `/d' dump.sql > dump-clean.sql
```

### Piège 13 — Volumes MinIO contiennent les anciens .data MinIO MD5 mismatch

**Symptôme :** MinIO logs : `corrupted object metadata`.
**Cause :** Backup MinIO incomplet (data sans metadata, ou inversement).
**Résolution :** MinIO se restaure mieux via `mc mirror` qu'via tar. Pour un restore propre :

```bash
mc mirror --remove backup-source/user-files local/user-files
```

### Piège 14 — Le restore prend 10x plus de temps prévu

**Symptôme :** Annoncé 30 min, en cours depuis 5 h.
**Cause :** Disk lent (HDD au lieu de SSD), CPU saturé par autres charges, ou réindexation Postgres après restore (`REINDEX DATABASE`).
**Résolution :** Sur un volume Postgres important, ajouter `--no-create-indexes` au dump et reconstruire les index a posteriori. Monitoring : `iostat -x 5` pour voir le bottleneck disque.

### Piège 15 — Login admin échoue après restore — "user not found"

**Symptôme :** Le BOOTSTRAP_ADMIN_EMAIL n'existe plus.
**Cause :** Le restore a chargé un dump où l'admin avait été supprimé (ou jamais créé).
**Résolution :** Réactiver le bootstrap : couper Hub, mettre `BOOTSTRAP_ENABLED=true`, vérifier que `iam.users WHERE email='admin@...'` est vide, redémarrer. Le bootstrap recrée le user.

---

## 9. Pour aller plus loin

- Voir [[47-backup-worker|BackupWorker]] pour le système de sauvegarde managé (destinations S3, schedules cron, runs, daemon `socle-backup`, schéma `backup.*`).
- Voir [[44-db-worker|DbWorker]] pour le provisioning des schémas/bases et les actions DB associées.
- Voir [[45-storage-worker|StorageWorker]] pour parcourir le bucket S3 `backups`.
- Voir `howto-17-deployer-en-production.md` pour l'installation initiale (référence des `.env`).
