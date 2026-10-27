# HOWTO 16 — Administrer le stockage MinIO (browse, upload, quotas, partages, corbeille)

**Niveau :** Junior+
**Prérequis :** SocleHub Hub 3.12.1 déployé, container `soclehub-minio` up et accessible (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` dans `.env`), tables `apps.file_quotas`, `apps.shared_folders`, `apps.shared_members` créées (migrations standards), permissions admin sur le bucket cible.
**Temps estimé :** 45 minutes

---

## 1. Contexte

Une instance SocleHub multi-app stocke typiquement plusieurs téraoctets de fichiers : pièces jointes mail (`attachments`), documents utilisateur (`user-files`), backups DB (`backups`), uploads en attente de scan antivirus (`uploads`), fichiers en quarantaine (`quarantine`), dossiers partagés (`shared-files`). Plutôt que de demander aux utilisateurs de jongler avec `mc` (MinIO client CLI) ou avec la console MinIO, le [[45-storage-worker|`StorageWorker`]] expose **10 actions REST/MCP** (dont `get_status`) qui couvrent tous les cas d'usage admin courants : navigation, upload/download, quotas par utilisateur, partage de dossiers, purge de corbeille (`.trash/`), statistiques globales.

Concrètement, l'admin doit pouvoir :

- Voir d'un coup d'œil l'occupation par bucket et le total
- Naviguer dans l'arborescence d'un bucket comme dans un explorateur de fichiers
- Donner un lien de téléchargement temporaire (1 h) à un tiers sans exposer les credentials S3
- Limiter la consommation disque d'un utilisateur abusif (quota en bytes)
- Lister tous les partages actifs et révoquer un membre
- Vider la corbeille d'un utilisateur (préfixe `{userId}/.trash/` dans `user-files`)

L'authentification passe par `MCP_API_KEY` ou JWT IAM avec scope `storage:admin`.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Admin (Portail Hub UI / agent IA via MCP / curl direct)             │
└─────────────────────┬────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SocleHub                                                            │
│                                                                      │
│  StorageWorker (priority=42, PASSIVE)                                │
│  ├── 9 actions :                                                     │
│  │     get_status / storage_stats                                    │
│  │     storage_browse / storage_download_url                         │
│  │     storage_upload / storage_delete                               │
│  │     storage_set_quota                                             │
│  │     storage_list_shares / storage_revoke_share                    │
│  │     storage_purge_trash                                           │
│  │                                                                   │
│  ├── MinioClient (Java SDK, S3 v4 sigv4)                             │
│  │     listBuckets, listObjects, putObject, removeObject,            │
│  │     getPresignedObjectUrl                                         │
│  │                                                                   │
│  └── DataSource (Postgres) :                                         │
│        apps.file_quotas (user_id, max_bytes, updated_at)             │
│        apps.shared_folders (folder_id, owner_id, bucket, prefix)     │
│        apps.shared_members (folder_id, user_id, permission)          │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ S3 API
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  soclehub-minio (port interne 9000, console 9001)                    │
│                                                                      │
│  Buckets standards :                                                 │
│    attachments   — pièces jointes mail (signature.archive si activé) │
│    quarantine    — fichiers ClamAV positifs                          │
│    backups       — dumps DB (90 jours)                               │
│    uploads       — staging avant scan antivirus                      │
│    user-files    — espace utilisateur (incluant {user}/.trash/)      │
│    shared-files  — dossiers collaboratifs                            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Lister tous les buckets

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/get_status \
  -H "Authorization: Bearer gateway-mcp-2026" | jq
```

Réponse :

```json
{
  "endpoint": "http://soclehub-minio:9000",
  "reachable": true,
  "buckets": [
    {
      "name": "attachments",
      "creationDate": "2026-03-15T08:12:34+00:00",
      "objects": 2387,
      "size": 543210987,
      "sizeFormatted": "518.0 MB"
    },
    { "name": "user-files",  "objects": 12871, "size": 8721098765, "sizeFormatted": "8.12 GB" },
    { "name": "backups",     "objects": 90, "size": 1923456789, "sizeFormatted": "1.79 GB" },
    { "name": "quarantine",  "objects": 4, "size": 12345, "sizeFormatted": "12.1 KB" },
    { "name": "shared-files","objects": 432, "size": 234567890, "sizeFormatted": "223.7 MB" },
    { "name": "uploads",     "objects": 0, "size": 0, "sizeFormatted": "0 B" }
  ],
  "bucketCount": 6
}
```

**Points clés :**

- `objects` et `size` sont calculés à la volée par `listObjects(recursive=true)` — opération O(N) sur le bucket. Sur un bucket de plusieurs millions d'objets, cet appel peut prendre 30+ secondes. Préférer `storage_stats` qui ne traverse que les `KNOWN_BUCKETS`.
- Si MinIO est down, retourne `reachable: false` plutôt que de planter.

---

## 4. Étape 2 — Statistiques globales

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_stats \
  -H "Authorization: Bearer gateway-mcp-2026" | jq
```

Réponse :

```json
{
  "totalSize": 11434328776,
  "totalSizeFormatted": "10.65 GB",
  "totalFiles": 15784,
  "bucketCount": 6,
  "buckets": [
    { "name": "attachments", "exists": true, "objects": 2387, "size": 543210987, "sizeFormatted": "518.0 MB" },
    { "name": "quarantine",  "exists": true, "objects": 4,     "size": 12345,     "sizeFormatted": "12.1 KB" },
    ...
  ]
}
```

`KNOWN_BUCKETS` (codé dans `StorageWorker`, ligne 64) liste explicitement : `attachments, quarantine, backups, uploads, user-files, shared-files`. Tout bucket additionnel (custom, créé par une app) est ajouté en queue de la liste sous le label "extra".

---

## 5. Étape 3 — Naviguer dans un bucket

`storage_browse` agit comme un `ls` filesystem-like grâce au paramètre `delimiter="/"` côté S3 : seul le contenu **direct** du préfixe est retourné, les sous-dossiers apparaissent comme `isDir: true`.

```bash
# Racine du bucket user-files
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_browse \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files"}' | jq

# Sous-dossier d'un user
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_browse \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","prefix":"jmh/documents/"}' | jq
```

Réponse :

```json
{
  "bucket": "user-files",
  "prefix": "jmh/documents/",
  "items": [
    { "key": "jmh/documents/contracts/", "size": 0,    "isDir": true,  "displayName": "contracts", "lastModified": "" },
    { "key": "jmh/documents/cv.pdf",     "size": 234567, "isDir": false, "displayName": "cv.pdf",
      "lastModified": "2026-04-12T14:23:01+00:00", "sizeFormatted": "229.1 KB" },
    { "key": "jmh/documents/quotation-2026.docx", "size": 18432, "isDir": false,
      "displayName": "quotation-2026.docx", "sizeFormatted": "18.0 KB",
      "lastModified": "2026-04-28T10:35:00+00:00" }
  ],
  "count": 3
}
```

Le `displayName` est extrait du dernier segment du `key` — utile pour rendre une UI sans avoir à parser côté client.

---

## 6. Étape 4 — Uploader un fichier

```bash
# Encoder un fichier en base64
CONTENT=$(base64 -w0 /tmp/rapport.pdf)

curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_upload \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d "{
    \"bucket\": \"user-files\",
    \"key\": \"jmh/documents/rapport-2026-Q1.pdf\",
    \"content_base64\": \"$CONTENT\",
    \"content_type\": \"application/pdf\"
  }" | jq
```

Réponse :

```json
{
  "bucket": "user-files",
  "key": "jmh/documents/rapport-2026-Q1.pdf",
  "size": 1287456,
  "status": "uploaded"
}
```

**Limite pratique :** body HTTP < 100 MB (limite Tomcat par défaut). Pour des gros fichiers, utiliser plutôt une URL pré-signée PUT ou un upload multipart côté client direct vers MinIO.

---

## 7. Étape 5 — URL de téléchargement temporaire

`storage_download_url` génère une URL **pré-signée S3 v4** avec TTL 1 h. L'utilisateur final peut télécharger sans authentification SocleHub.

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_download_url \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","key":"jmh/documents/rapport-2026-Q1.pdf"}' | jq
```

Réponse :

```json
{
  "bucket": "user-files",
  "key": "jmh/documents/rapport-2026-Q1.pdf",
  "url": "http://soclehub-minio:9000/user-files/jmh/documents/rapport-2026-Q1.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=soclehub-admin%2F20260428%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260428T103500Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=...",
  "expiresIn": "1 hour"
}
```

**Attention :** l'URL retournée pointe sur l'endpoint **interne** Docker (`http://soclehub-minio:9000`). Pour un usage externe (envoi par mail, lien public), il faut soit :

1. Configurer MinIO derrière un reverse proxy public (`s3.<DOMAIN>` → `soclehub-minio:9000`) et adapter le `signing_endpoint` dans `MinioClient`.
2. Ou retourner l'URL publique en remplaçant le hostname côté worker (à customiser).

---

## 8. Étape 6 — Supprimer un objet

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_delete \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","key":"jmh/documents/old.pdf"}' | jq
```

Réponse :

```json
{ "bucket": "user-files", "key": "jmh/documents/old.pdf", "status": "deleted" }
```

`removeObject` est **immédiat** — pas de soft-delete. Pour un comportement type "corbeille", déplacer d'abord vers `{userId}/.trash/{originalKey}` côté apps métier, puis purger via `storage_purge_trash` (étape 10).

---

## 9. Étape 7 — Quotas utilisateur

Les quotas sont stockés dans `apps.file_quotas` (table Hub Postgres). Le worker fait un upsert :

```sql
INSERT INTO apps.file_quotas (user_id, max_bytes, updated_at)
VALUES (?, ?, NOW())
ON CONFLICT (user_id) DO UPDATE SET max_bytes = EXCLUDED.max_bytes, updated_at = NOW();
```

```bash
# Limiter user "jmh" à 10 GB
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_set_quota \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"jmh","max_bytes":"10737418240"}' | jq
```

Réponse :

```json
{
  "user_id": "jmh",
  "max_bytes": 10737418240,
  "max_bytes_formatted": "10.00 GB",
  "status": "updated"
}
```

**Note importante :** le worker **enregistre** le quota mais **ne l'enforce pas automatiquement**. C'est aux apps métier de vérifier `current_usage(user_id) + new_file_size <= max_bytes` avant tout upload. Une évolution future pourrait ajouter un middleware d'interception côté `S3AttachmentService`.

---

## 10. Étape 8 — Lister et révoquer des partages

```bash
# Lister tous les partages actifs
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_list_shares \
  -H "Authorization: Bearer gateway-mcp-2026" | jq
```

Réponse :

```json
{
  "shares": [
    {
      "folder_id": "f1a2b3c4-...",
      "folder_name": "Projet Acme 2026",
      "owner_id": "jmh",
      "bucket": "shared-files",
      "prefix": "projects/acme-2026/",
      "member_id": "alice",
      "permission": "write",
      "granted_at": "2026-04-12T09:23:11Z"
    },
    {
      "folder_id": "f1a2b3c4-...",
      "folder_name": "Projet Acme 2026",
      "owner_id": "jmh",
      "bucket": "shared-files",
      "prefix": "projects/acme-2026/",
      "member_id": "bob",
      "permission": "read",
      "granted_at": "2026-04-15T14:01:00Z"
    }
  ],
  "count": 2
}
```

Plusieurs lignes par folder si plusieurs membres (LEFT JOIN sur `shared_members`).

```bash
# Révoquer alice du dossier f1a2b3c4-...
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_revoke_share \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"folder_id":"f1a2b3c4-...","user_id":"alice"}' | jq
```

Réponse :

```json
{ "folder_id": "f1a2b3c4-...", "user_id": "alice", "deleted": 1, "status": "revoked" }
```

`status: "not_found"` si la combinaison n'existe pas (pas une erreur, juste un noop).

---

## 11. Étape 9 — Purger la corbeille d'un user

Convention : tout objet `user-files/{userId}/.trash/...` est considéré comme corbeille. `storage_purge_trash` énumère ce préfixe et supprime tout en O(N).

```bash
# Purger la corbeille du user "jmh"
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_purge_trash \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"jmh"}' | jq
```

Réponse :

```json
{
  "user_id": "jmh",
  "purged_count": 23,
  "purged_size": 487293821,
  "purged_size_formatted": "464.7 MB",
  "status": "purged"
}
```

**Workflow recommandé** côté apps métier :

1. User "supprime" un fichier → l'app fait `storage_browse` source, puis copie via `mc cp` ou `s3.copyObject` vers `user-files/{userId}/.trash/{timestamp}-{originalKey}`, puis `storage_delete` source.
2. User "vide la corbeille" → appel `storage_purge_trash`.
3. Cron quotidien : auto-purge des trashes > 30 jours.

---

## 12. Validation

### Test fonctionnel complet

```bash
#!/bin/bash
set -e
TOKEN="gateway-mcp-2026"
BASE="https://admin.thesocle.net/admin/workers/storage_worker/actions"

echo "=== 1. Stats avant ==="
curl -s -X POST $BASE/storage_stats -H "Authorization: Bearer $TOKEN" | jq '.totalSizeFormatted, .totalFiles'

echo "=== 2. Upload test file ==="
echo "Hello, SocleHub" > /tmp/test.txt
B64=$(base64 -w0 /tmp/test.txt)
curl -s -X POST $BASE/storage_upload -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bucket\":\"user-files\",\"key\":\"test/howto-16.txt\",\"content_base64\":\"$B64\"}" | jq

echo "=== 3. Browse ==="
curl -s -X POST $BASE/storage_browse -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","prefix":"test/"}' | jq '.items'

echo "=== 4. Download URL ==="
URL=$(curl -s -X POST $BASE/storage_download_url -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","key":"test/howto-16.txt"}' | jq -r '.url')
echo "URL = $URL"
docker exec soclehub curl -s "$URL"  # depuis le container, l'URL interne fonctionne

echo "=== 5. Set quota ==="
curl -s -X POST $BASE/storage_set_quota -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test-user","max_bytes":"1073741824"}' | jq

echo "=== 6. Cleanup ==="
curl -s -X POST $BASE/storage_delete -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"user-files","key":"test/howto-16.txt"}' | jq
```

### Vérifier en base la persistance des quotas

```sql
-- En psql, dans le container soclehub-postgres
SELECT user_id, max_bytes, pg_size_pretty(max_bytes) AS quota,
       updated_at FROM apps.file_quotas ORDER BY updated_at DESC LIMIT 10;
```

---

## 13. Pièges courants

### Piège 1 — `Browse failed: bucket does not exist`

**Symptôme :** `storage_browse` retourne `Browse failed: ...NoSuchBucket`.
**Cause :** Bucket pas créé. MinIO ne crée pas automatiquement les buckets référencés.
**Résolution :** Création via `mc mb local/user-files` ou via `MinIO console`. Le `MinioProvisionWorker` provisionne automatiquement les buckets `KNOWN_BUCKETS` au boot — vérifier ses logs si certains manquent.

### Piège 2 — Upload base64 corrompt le fichier

**Symptôme :** Le fichier uploadé via `storage_upload` est plus gros que l'original ou ne s'ouvre pas.
**Cause :** Encodage avec retours à la ligne (`base64` sans `-w0` sur GNU coreutils).
**Résolution :** **Toujours** `base64 -w0` (Linux) ou `base64 -i file -o out.b64` (macOS). Côté JS : `btoa(binary)` après lecture en `ArrayBuffer`.

### Piège 3 — `storage_download_url` valide mais le download depuis Internet échoue

**Symptôme :** L'URL fonctionne via `docker exec`, mais Forbidden depuis le navigateur public.
**Cause :** L'URL pointe sur `soclehub-minio:9000` (DNS Docker interne). Le navigateur ne sait pas résoudre ce hostname.
**Résolution :** Reverse-proxifier MinIO sur `s3.<DOMAIN>` via le `ProxyWorker`, et configurer `MinioClient` avec `endpoint("https://s3.thesocle.net")` qui sera utilisé pour signer. Note : le signing AWS v4 inclut le hostname dans la signature.

### Piège 4 — `storage_set_quota` retourne `Set quota failed: relation "apps.file_quotas" does not exist`

**Symptôme :** Erreur SQL au premier appel quota.
**Cause :** La migration créant `apps.file_quotas` n'a pas été appliquée.
**Résolution :** Vérifier `\dt apps.file_quotas` dans psql. Si manquante, lancer la migration : `docker exec soclehub-postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /migrations/apps-file-quotas.sql`. La structure attendue est `(user_id TEXT PRIMARY KEY, max_bytes BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`.

### Piège 5 — `storage_purge_trash` supprime des fichiers hors de `.trash/`

**Symptôme :** Des fichiers utilisateur disparaissent.
**Cause :** Bug pre-v2.5 où le préfixe était `userId + ".trash/"` (sans `/` séparateur), matchant `userIdfoo/...`.
**Résolution :** Le code 3.12.1 (`StorageWorker.handlePurgeTrash`) construit `String trashPrefix = userId + "/.trash/";` ce qui est correct. Vérifier la version. Test unitaire : `userId="jm"` ne doit jamais matcher `key="jmh/document.pdf"`.

### Piège 6 — Liste partages très lente (>5 s)

**Symptôme :** `storage_list_shares` met 5+ secondes.
**Cause :** LEFT JOIN sans index sur `shared_members.folder_id`.
**Résolution :** `CREATE INDEX idx_shared_members_folder ON apps.shared_members(folder_id);`. Vérifier le plan via `EXPLAIN ANALYZE` directement.

### Piège 7 — `storage_revoke_share` retourne 0 deleted alors que le partage existe

**Symptôme :** `deleted: 0, status: "not_found"`.
**Cause :** Mismatch de typage `user_id` (UUID vs TEXT) entre la table et le param string.
**Résolution :** S'assurer que `apps.shared_members.user_id` est `TEXT` (cohérent avec ce que `IamWorker` insère). Sinon caster côté SQL : `WHERE user_id = ?::uuid`.

### Piège 8 — Sizes inconsistants entre `get_status` et `storage_stats`

**Symptôme :** Les deux endpoints donnent des chiffres différents pour le même bucket.
**Cause :** `get_status` itère **tous** les buckets MinIO (y compris ceux non standards), `storage_stats` n'itère que `KNOWN_BUCKETS` + extras. Si on appelle pendant qu'un upload est en cours, les snapshots diffèrent.
**Résolution :** Pour un dashboard cohérent, utiliser un seul endpoint. `storage_stats` est plus rapide car il connaît a priori la liste.

### Piège 9 — Upload réussi mais `lastModified` vide dans browse

**Symptôme :** Item visible mais `lastModified: ""`.
**Cause :** Certains directory markers MinIO (créés à la main par `mc mb`) n'ont pas de `lastModified`. Le worker catch `null` et retourne `""`.
**Résolution :** Pas un bug. Si le client a besoin d'une date, fallback sur `new Date()` côté UI.

### Piège 10 — `storage_purge_trash` en cours bloque les autres actions storage

**Symptôme :** Pendant un purge de 50 GB, `storage_browse` met 30 s.
**Cause :** Le worker n'utilise pas de pool dédié — il partage le thread d'exécution des actions du framework. Une boucle de delete séquentielle bloque.
**Résolution :** Pour de gros volumes, faire le purge hors heures de pointe ou re-implémenter `handlePurgeTrash` en async (ExecutionMode.ASYNC + thread pool dédié + retour immédiat avec `job_id`).

### Piège 11 — Buckets "fantômes" dans `storage_stats`

**Symptôme :** Bucket listé avec `exists: false, objects: 0`.
**Cause :** `KNOWN_BUCKETS` contient des buckets qui n'ont pas encore été créés (ex: `quarantine` si ClamAV jamais provisionné).
**Résolution :** Cosmétique. Pour cacher : filtrer côté UI les `exists: false`. Pour les créer : `MinioProvisionWorker` au démarrage du Hub.

### Piège 12 — MinIO crash et `endpoint reachable: false` permanent

**Symptôme :** Toutes les actions storage échouent.
**Cause :** Container `soclehub-minio` crashé (OOM, disk full, corruption metadata).
**Résolution :** `docker logs soclehub-minio --tail 100`. Pour disk full, `df -h /var/lib/docker/volumes/docker_minio-data`. Restaurer depuis `backups` (voir `howto-18-restaurer-backup.md`).

### Piège 13 — Quota `max_bytes: 0` enregistré par erreur

**Symptôme :** L'utilisateur ne peut plus rien uploader.
**Cause :** Mauvais cast du paramètre `max_bytes` (string "0" parsé incorrectement).
**Résolution :** Le worker valide via `Long.parseLong(maxBytesStr)`. Côté UI, refuser les valeurs négatives ou < 1 MB. Mettre un floor minimum métier dans `handleSetQuota`.

---

## 14. Pour aller plus loin

- Voir [[45-storage-worker|StorageWorker]] pour la référence exhaustive des 10 actions, des `KNOWN_BUCKETS` et de la structure `apps.file_quotas` / `apps.shared_folders` / `apps.shared_members`.
- Voir [[46-clamav-scanguard|ClamAV / ScanGuard]] pour le scan antivirus des objets `uploads` avant promotion.
- Voir [[47-backup-worker|BackupWorker]] pour la sauvegarde S3 du bucket `backups`.
- Voir `howto-14-onlyoffice-edition.md` pour l'usage S3 derrière l'éditeur Office.
