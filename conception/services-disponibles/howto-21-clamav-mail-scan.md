# HOWTO 21 — Activer le scan antivirus des pièces jointes mail (ClamAV)

**Niveau :** Senior
**Hub :** SocleHub 3.12.1
**Prérequis :** James installé et boîtes mail provisionnées (cf. `howto-11-configurer-james-mail.md`), ClamAV running (`soclehub-clamav` container), bucket MinIO `attachments` existant, accès Vault avec credentials James par utilisateur (`secret/data/soclehub/james/users/<email>`)
**Temps estimé :** 30-60 min (selon volumétrie initiale)

> Référence framework : [[46-clamav-scanguard|ClamAvWorker + ScanGuardWorker]] — le `ClamAvWorker` (priorité 36) scanne le **contenu** (PJ mail, fichiers) via `clamd` TCP 3310 ; le `ScanGuardWorker` (priorité 10) bloque les **requêtes HTTP** de scan-bot, scope distinct. Voir aussi [[53-nats-worker|NatsWorker]] pour la notification `notify.alert.virus` et [[45-storage-worker|StorageWorker]] pour les buckets `attachments`/`quarantine`.

---

## 1. Contexte

Le Hub fournit un scan antivirus différé pour toutes les boîtes mail hébergées par James. Toutes les 60 secondes, `MailAttachmentWorker` polle chaque boîte active en IMAP READ_ONLY, extrait les pièces jointes des messages reçus depuis le dernier `last_uid` connu, les pousse sur MinIO (bucket `attachments`), les soumet à ClamAV (`soclehub-clamav:3310`), puis :

- **clean** → laisse l'objet S3 dans `attachments`, log dans `mail.av_scan_history`.
- **infected** → déplace l'objet vers le bucket `quarantine`, insère dans `mail.av_quarantine`, publie un message NATS sur `notify.alert.virus`, log un WARN.

Ce HOWTO explique comment activer/désactiver le scan par boîte, déclencher un scan manuel, consulter la quarantaine, et superviser les statistiques.

Le scan doit :

- Ne jamais bloquer la livraison du mail (scan asynchrone, READ_ONLY IMAP).
- Être idempotent : `last_uid` mémorisé en base, jamais re-scanner deux fois.
- Notifier l'utilisateur destinataire en temps réel via NATS (intégrable dans une UI de notifications).
- Tolérer ClamAV down → skip le cycle, retry au suivant.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                       SocleHub Hub (port 443)                          │
│                                                                        │
│   MailAttachmentWorker (polling 60s, priority 37)                      │
│        │                                                               │
│        │ 1. SELECT username,domain                                     │
│        │    FROM mail.mail_mailbox WHERE status='active'               │
│        ▼                                                               │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │  pour chaque mailbox :                                       │    │
│   │   2. read pwd from Vault soclehub/james/users/<user>         │    │
│   │   3. SELECT last_uid FROM mail.av_imap_scan_state            │    │
│   │   4. IMAP READ_ONLY connect to soclehub-james:993            │    │
│   │   5. fetch UIDs > last_uid                                   │    │
│   │   6. for each msg: extract attachments                       │    │
│   │      └► S3 upload to bucket "attachments"                    │    │
│   │      └► ClamAV scan (clamd protocol on tcp:3310)             │    │
│   │         ├─ clean   → INSERT mail.av_scan_history             │    │
│   │         └─ infected:                                         │    │
│   │            ├─ S3 move to bucket "quarantine"                 │    │
│   │            ├─ INSERT mail.av_quarantine                      │    │
│   │            ├─ NATS publish notify.alert.virus                │    │
│   │            └─ WARN log                                       │    │
│   │   7. UPDATE mail.av_imap_scan_state SET last_uid = max_uid   │    │
│   └──────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
       │                       │                       │
       ▼                       ▼                       ▼
   soclehub-james         soclehub-clamav        soclehub-minio
   (IMAPS 993)            (clamd 3310)           (S3 9000, buckets:
                                                  attachments,
                                                  quarantine)

NATS stream NOTIFICATIONS (notify.>) → consommable par notif worker frontend
```

---

## 3. Étape 1 — Pré-requis : ClamAV opérationnel

```bash
# 1. Vérifier le container
docker ps --filter name=soclehub-clamav --format '{{.Status}}'
# Attendu : Up X hours (healthy)

# 2. Test ping ClamAV via action MCP
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/get_status \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Attendu : "clamd_reachable": true, "signature_count": > 8000000

# 3. Test scan EICAR (signature de test universelle)
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/scan_test \
  -H "X-Api-Key: $MCP_API_KEY" | jq
# Attendu : { "data": { "clean": false, "virus_name": "Win.Test.EICAR_HDB-1" } }
```

Si `clamd_reachable: false` : `docker logs soclehub-clamav --tail=50` pour debug.

---

## 4. Étape 2 — Vérifier la configuration globale

`.env` (extrait) :

```dotenv
JAMES_ENABLED=true
JAMES_IMAP_HOST=soclehub-james
JAMES_IMAP_PORT=993
JAMES_ATTACHMENT_SCAN_ENABLED=true
JAMES_ATTACHMENT_SCAN_CYCLE_MS=60000
CLAMAV_HOST=soclehub-clamav
CLAMAV_PORT=3310
SOCLEHUB_CLAMAV_MAX_FILE_SIZE_MB=25
```

Vérifier le worker au boot :

```bash
docker logs soclehub --tail=200 2>&1 | grep mail_attachment_worker
# Attendu :
# [worker:mail_attachment_worker][step:initialize] Mail attachment worker initializing (enabled=true)
# [worker:mail_attachment_worker][step:start]
```

---

## 5. Étape 3 — Activer le scan pour une boîte

Le scan est piloté par `mail.mail_mailbox.status` :

- `status = 'active'` → scannée
- `status = 'disabled'` → ignorée
- `status = 'paused'` → ignorée

```bash
# 1. Activer
curl -sk -X POST https://thesocle.net/api/actions/mail_attachment_worker/set_enabled \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice@thesocle.net",
    "enabled": "true"
  }'

# Réponse :
# { "success": true, "data": { "username": "alice@...", "status": "active", "enabled": true } }

# 2. Désactiver (si suspect, problème de credentials, vacances)
curl -sk -X POST https://thesocle.net/api/actions/mail_attachment_worker/set_enabled \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "username": "alice@thesocle.net", "enabled": "false" }'
```

**Points clés :**

- L'action met simplement à jour `mail.mail_mailbox.status`. Le worker prend en compte au cycle suivant (≤ 60 s).
- Le mot de passe IMAP doit exister dans Vault à `soclehub/james/users/alice@thesocle.net` champ `password`. Sans cela le worker log `No Vault credentials, skipping`.

---

## 6. Étape 4 — Déclencher un scan immédiat

Pour tester ou rattraper après une coupure :

```bash
# Scan toutes les boîtes actives
curl -sk -X POST https://thesocle.net/api/actions/mail_attachment_worker/trigger_scan \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{}'

# Scan une seule boîte
curl -sk -X POST https://thesocle.net/api/actions/mail_attachment_worker/trigger_scan \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "username": "alice@thesocle.net" }'
```

Le worker crée une connexion IMAP, traite les nouveaux messages, et retourne synchrone (peut prendre quelques secondes pour une grosse boîte).

---

## 7. Étape 5 — Backlog (re-scanner historique)

Cas : nouvelles signatures ClamAV publiées, on veut re-scanner les pièces jointes des 30 derniers jours.

```bash
# 1. Identifier UID limite
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "SELECT username, last_uid FROM mail.av_imap_scan_state
   WHERE username='alice@thesocle.net';"

# 2. Reset à un UID antérieur (par ex. 10000 = il y a 30 jours sur une boîte active)
curl -sk -X POST https://thesocle.net/api/actions/mail_attachment_worker/scan_backlog \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "username": "alice@thesocle.net", "from_uid": "10000" }'
```

Cette action :
1. Met `last_uid = from_uid` dans `mail.av_imap_scan_state`.
2. Lance un scan immédiat.

**Attention :** scan complet = re-upload de toutes les pièces jointes sur S3 + scan ClamAV. Sur une boîte de 50 GB, ça peut durer une heure.

---

## 8. Étape 6 — Consulter la quarantaine

```bash
# Lister les fichiers en quarantaine
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/list_quarantine \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Réponse type :
# { "data": { "count": 3, "entries": [
#   { "id": "uuid", "filename": "facture.exe", "virus_name": "Win.Trojan.Generic-XYZ",
#     "source_user": "alice@thesocle.net", "quarantined_at": "2026-04-28T08:32:11Z",
#     "released": false }
# ] } }

# Récupérer le contenu d'un fichier en quarantaine (audit / forensics)
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/get_quarantine_file \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "id": "<uuid>" }' | jq -r '.data.download_url'
# → URL pré-signée S3 valide 5 min

# Faux positif : libérer (le fichier est replacé dans bucket "attachments")
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/release_quarantine \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "id": "<uuid>" }'

# Suppression définitive (90 jours après quarantaine)
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/delete_quarantine \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "id": "<uuid>" }'
```

---

## 9. Étape 7 — Notifications NATS

À chaque infection, le worker publie sur le sujet `notify.alert.virus` (stream `NOTIFICATIONS`) :

```json
{
  "type": "virus_detected",
  "username": "alice@thesocle.net",
  "filename": "facture.exe",
  "virus_name": "Win.Trojan.Generic-XYZ",
  "timestamp": "2026-04-28T08:32:11Z"
}
```

Pour consommer côté UI / Slack / autre :

```bash
# Consommer manuellement
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/peek_messages \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "NOTIFICATIONS", "count": "10" }' | jq
```

Pour intégrer dans une autre app :
- Créer un consumer pull sur le sujet `notify.alert.virus`.
- Voir `howto-23-nats-streams.md` §6.

---

## 10. Étape 8 — Statistiques et historique

```bash
# Stats globales
curl -sk -X POST https://thesocle.net/api/actions/mail_attachment_worker/get_status \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# {
#   "name": "mail_attachment_worker",
#   "running": true,
#   "clamav_reachable": true,
#   "total_scanned": 12473,
#   "total_infected": 7,
#   "scan_in_progress": false,
#   "attachment_scan_enabled": true,
#   "last_execution": "2026-04-28T09:14:02Z",
#   "cycle_interval_ms": 60000
# }

# État par boîte
curl -sk -X POST https://thesocle.net/api/actions/mail_attachment_worker/list_scan_state \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Historique de scan (toutes les pièces jointes scannées)
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/get_scan_history \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "limit": "100" }' | jq
```

Requêtes SQL utiles :

```sql
-- Top 10 destinataires de virus
SELECT source_user, COUNT(*) as virus_count
FROM mail.av_quarantine
WHERE quarantined_at > NOW() - INTERVAL '30 days'
GROUP BY source_user
ORDER BY virus_count DESC
LIMIT 10;

-- Volume scanné par jour
SELECT DATE(scanned_at) AS day, COUNT(*) AS scans, SUM(file_size) / 1024 / 1024 AS mb
FROM mail.av_scan_history
WHERE scanned_at > NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day DESC;
```

---

## 11. Validation

```bash
# 1. Envoyer un mail test EICAR à alice@
echo "X5O!P%@AP[4\PZX54(P^)7CC)7}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H+H*" \
  > /tmp/eicar.txt

curl -sk -X POST https://thesocle.net/api/actions/mail_worker/send_email \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "to": "alice@thesocle.net",
  "subject": "Test EICAR scan",
  "body": "Test pièce jointe",
  "attachments": [
    { "filename": "eicar.txt", "content_base64": "$(base64 -w0 /tmp/eicar.txt)" }
  ]
}
EOF
)"

# 2. Attendre 60 s + le cycle worker
sleep 90

# 3. Vérifier la quarantaine
curl -sk -X POST https://thesocle.net/api/actions/clamav_worker/list_quarantine \
  -H "X-Api-Key: $MCP_API_KEY" \
  | jq '.data.entries[] | select(.source_user=="alice@thesocle.net")'

# 4. Vérifier la notif NATS
curl -sk -X POST https://thesocle.net/api/actions/nats_worker/peek_messages \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "stream_name": "NOTIFICATIONS", "count": "5" }' \
  | jq '.data.messages[] | select(.subject=="notify.alert.virus")'
```

---

## 12. Pièges courants

### Piège 1 — `MailAttachmentWorker` log « ClamAV unreachable, skipping scan cycle »

**Cause :** le container `soclehub-clamav` est down, en cours de `freshclam` (mise à jour signatures), ou n'écoute pas sur 3310.
**Résolution :**

```bash
docker logs soclehub-clamav --tail=50
# Si "freshclam in progress" → attendre la fin (5 min)
# Si crash → docker restart soclehub-clamav
docker exec soclehub-clamav clamdscan --version
```

### Piège 2 — « No Vault credentials for alice@..., skipping »

**Cause :** la boîte a été créée par James mais le mot de passe n'a pas été poussé dans Vault.
**Résolution :** repush via `james_worker/sync_iam_users` ou manuellement :

```bash
docker exec vault vault kv put secret/soclehub/james/users/alice@thesocle.net \
  password='<imap-password>'
```

### Piège 3 — Scan infini d'un même UID

**Cause :** la mise à jour `last_uid` échoue (transaction rollback). Au cycle suivant, le worker re-scanne le même message.
**Résolution :** vérifier `mail.av_imap_scan_state.last_uid` :

```bash
docker exec soclehub-postgres psql -U socle_prod -c \
  "SELECT username, last_uid, updated_at FROM mail.av_imap_scan_state
   WHERE username='alice@thesocle.net';"
```

Forcer la mise à jour :

```bash
curl ... reset_scan_state -d '{"username":"alice@thesocle.net"}'
```

### Piège 4 — Pièce jointe > 25 MB jamais scannée

**Cause :** `SOCLEHUB_CLAMAV_MAX_FILE_SIZE_MB=25` et la pièce passe en `skipped_too_large` dans `av_scan_history`.
**Résolution :** augmenter la limite si nécessaire (impact RAM ClamAV) :

```dotenv
SOCLEHUB_CLAMAV_MAX_FILE_SIZE_MB=100
```

Et côté ClamAV `clamd.conf` : `MaxFileSize 100M`, `MaxScanSize 200M`.

### Piège 5 — IMAP `IMAPInputStream is closed` au milieu du scan

**Cause :** timeout IMAP (boîte de plusieurs GB). `mail.imaps.timeout=30000` (30 s) ne suffit pas.
**Résolution :** augmenter dans `MailAttachmentWorker.connectImap()` ou patcher pour traiter par lots de 100 messages.

### Piège 6 — Bucket `quarantine` n'existe pas → scan échoue silencieusement

**Cause :** S3 move vers un bucket inexistant retourne 404, le worker log un warning mais le fichier reste dans `attachments`.
**Résolution :** créer les 2 buckets au boot via `MinioProvisionWorker` (vérifier qu'il a tourné), ou manuellement :

```bash
docker exec soclehub-minio mc mb local/quarantine --ignore-existing
docker exec soclehub-minio mc mb local/attachments --ignore-existing
```

### Piège 7 — Hub redémarre, scan reprend au début → re-traite les mêmes messages

**Cause :** `last_uid` est persisté en DB, donc en théorie pas de rescan. Si rescan : la table `mail.av_imap_scan_state` a été tronquée ou n'est pas créée (migration manquante).
**Résolution :**

```bash
docker exec soclehub-postgres psql -U socle_prod -c \
  "\d mail.av_imap_scan_state"
# Si table absente : appliquer la migration
docker exec -i soclehub-postgres psql -U socle_prod < /opt/soclehub/sql/migration-mail-scan.sql
```

### Piège 8 — Faux positif libéré, mais l'utilisateur ne reçoit pas la pièce jointe en boîte

**Cause :** `release_quarantine` remet l'objet dans `attachments` mais ne réinjecte PAS le mail dans la INBOX (le worker IMAP est READ_ONLY).
**Résolution :** envoyer manuellement la pièce jointe à l'utilisateur via `mail_worker/send_email` avec un nouveau message annonçant la libération.

### Piège 9 — Volume MinIO `attachments` saturé après 6 mois

**Cause :** aucune purge automatique sur le bucket `attachments`.
**Résolution :** configurer une lifecycle policy MinIO pour expiration à 90 j :

```bash
docker exec soclehub-minio mc ilm add local/attachments \
  --expiry-days 90
```

### Piège 10 — `total_infected` augmente mais `notify.alert.virus` reste vide

**Cause :** `natsConnection` est null (NATS down au boot). `publishVirusAlert` log un warning mais ne plante pas.
**Résolution :** vérifier au boot du Hub : `docker logs soclehub | grep "NATS connected"`. Si absent : `docker restart soclehub-nats` puis `docker restart soclehub`.

---

## 13. Pour aller plus loin

- Voir [[53-nats-worker|NatsWorker]] / `howto-23-nats-streams.md` pour consommer `notify.alert.virus`
- Voir `howto-19-rotation-secrets.md` (rotation password James par utilisateur)
- Voir [[46-clamav-scanguard|fiche ClamAvWorker + ScanGuardWorker]] pour la liste exhaustive des 12 actions `clamav_worker/*` et des 13 actions `scan_guard_worker/*`
- Voir source `eu.lmvi.soclehub.worker.ClamAvWorker` et `eu.lmvi.soclehub.worker.MailAttachmentWorker` (intégralité du flux de scan différé)
