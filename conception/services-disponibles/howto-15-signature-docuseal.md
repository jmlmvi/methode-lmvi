# HOWTO 15 — Demander une signature électronique via DocuSeal

**Niveau :** Senior
**Prérequis :** SocleHub 3.12+, container `soclehub-docuseal` démarré (profile `infra`), au moins un template DocuSeal créé via le portail DocuSeal, accès SMTP fonctionnel pour l'envoi d'invitations, bucket S3 `signatures-archive` existant si archivage activé.
**Temps estimé :** 1 heure

---

## 1. Contexte

Faire signer un contrat électroniquement implique trois acteurs : (1) une plateforme de signature qui génère les liens uniques par signataire et trace le consentement, (2) un système qui orchestre l'envoi (via email) et le suivi des statuts, (3) un service d'horodatage RFC 3161 qui scelle l'instant de la signature pour qu'elle soit opposable. SocleHub combine ces trois rôles : le `SignatureWorker` parle à DocuSeal (open-source self-hosted, réf [[50-signature-worker|signature_worker]]), le `MailWorker` envoie les invitations, le `TsaWorker` horodate l'empreinte SHA-256 du document signé via une autorité TSA (FreeTSA, Apple, etc.) et optionnellement ancre l'empreinte dans la blockchain Bitcoin Layer 1 (`OP_RETURN`) pour preuve éternelle (réf [[51-tsa-worker|tsa_worker]]).

> `signature_worker` expose **11 actions** : `get_status`, `signature_create`, `signature_list`, `signature_get`, `signature_cancel`, `signature_resend`, `signature_download`, `signature_verify`, `signature_templates` et `signature_stats`. (`signature_resend` relance l'invitation d'un signataire — params `id` + `email`.)

Le `SignatureWorker` doit :

- Permettre à un agent IA (via MCP) ou à une app métier (via REST) de créer une demande de signature en passant un `template_id` DocuSeal et la liste des signataires
- Lister les soumissions, leur statut (`pending`/`completed`/`expired`), et fournir des stats agrégées
- Permettre le téléchargement du document signé final et sa vérification d'intégrité
- Archiver le document signé dans S3 pendant `LINK_TTL_DAYS` (défaut 90) avec horodatage TSA
- Optionnellement ancrer la preuve de signature dans la blockchain (`blockchain_anchor: true`)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Demandeur (API client / Agent IA via MCP / App métier)                 │
│                                                                         │
│  curl POST /admin/workers/signature_worker/actions/signature_create     │
│       { template_id, submitters_json }                                  │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SocleHub                                                               │
│                                                                         │
│  SignatureWorker (priority=40, PASSIVE)                                 │
│  ├── DocuSealClient ────► HTTP API DocuSeal (token X-Auth-Token)        │
│  │       /api/templates                                                 │
│  │       /api/submissions   (POST: createSubmission)                    │
│  │       /api/submissions   (GET : listSubmissions)                     │
│  │       /api/submissions/{id} (GET, DELETE)                            │
│  │                                                                      │
│  ├── TsaClient ──────────► RFC 3161 TSA (FreeTSA, Apple, GlobalSign)   │
│  │       Sceau temporel sur SHA-256(documentSigne)                     │
│  │                                                                      │
│  ├── S3AttachmentService ► MinIO bucket "signatures-archive"            │
│  │       Stockage du PDF signé + .tsr (timestamp response)             │
│  │                                                                      │
│  └── DataSource (Postgres) ► table apps.signatures (audit, traçabilité) │
│                                                                         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  soclehub-docuseal (port interne 3000)                                  │
│  ├── Génère URL signature unique par submitter (envoi par email)        │
│  ├── UI signature dans le navigateur                                    │
│  ├── Webhook back vers SocleHub (optionnel) sur événement signing.completed
│  └── Stocke le PDF final + audit trail                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Préparer DocuSeal et le template

DocuSeal expose une UI sur `https://docuseal.<DOMAIN>` (route configurée par `ProxyWorker`). Premier setup :

```bash
# 1. Container actif ?
docker ps | grep soclehub-docuseal
# soclehub-docuseal ... Up X min ... 3000/tcp

# 2. Healthcheck depuis le Hub
curl -s https://admin.thesocle.net/admin/workers/signature_worker/actions/get_status \
  -H "Authorization: Bearer gateway-mcp-2026" | jq
```

Réponse :

```json
{
  "name": "signature_worker",
  "running": true,
  "online": true,
  "docuseal_url": "http://soclehub-docuseal:3000",
  "sign_domain": "docuseal.thesocle.net",
  "archive_bucket": "signatures-archive",
  "link_ttl_days": 90,
  "blockchain_anchor": false,
  "action_count": 0
}
```

Connexion à l'UI DocuSeal pour créer un template :

1. Ouvrir `https://docuseal.thesocle.net`
2. Login admin (configuré via `DOCUSEAL_SECRET_KEY` au premier boot)
3. Onglet **Templates** → **Upload Document** → choisir le PDF de référence
4. Drag&drop des champs `Signature`, `Date`, `Initials`, `Text` aux bons endroits
5. Définir les rôles `Client`, `Vendor`, etc. (ce sont les `roles` que les submitters référenceront)
6. **Save** → noter le `template_id` (UUID visible dans l'URL)

Lister les templates depuis le Hub :

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_templates \
  -H "Authorization: Bearer gateway-mcp-2026" | jq '.templates'
```

---

## 4. Étape 2 — Créer une demande de signature

```bash
TEMPLATE_ID="42a3f9c2-8b1e-4c7a-9f5d-1a2b3c4d5e6f"

# Liste des signataires en JSON. Chaque entrée doit avoir au minimum email + name.
# DocuSeal supporte aussi "role" pour matcher les rôles du template.
SUBMITTERS=$(jq -n '[
  {email: "client@example.com",  name: "Acme Corp",      role: "Client"},
  {email: "jmh@thesocle.net",    name: "Jean-Marc HENRY", role: "Vendor"}
]')

curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_create \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d "{
    \"template_id\": \"$TEMPLATE_ID\",
    \"submitters_json\": $(echo "$SUBMITTERS" | jq -Rs .)
  }" | jq
```

Réponse :

```json
{
  "status": "created",
  "template_id": "42a3f9c2-8b1e-4c7a-9f5d-1a2b3c4d5e6f",
  "submitters_count": 2,
  "id": "1827463",
  "slug": "abcDEF123",
  "url": "https://docuseal.thesocle.net/s/abcDEF123",
  "created_at": "2026-04-28T10:23:11Z",
  "submitters": "[{\"id\":7831,\"email\":\"client@example.com\",\"slug\":\"slug-client\",...}]"
}
```

Le worker (`SignatureWorker.handleSignatureCreate`) :

1. Parse `submitters_json` en `List<Map<String,String>>` via Jackson `TypeReference`.
2. Appelle `DocuSealClient.createSubmission(templateId, submitters)` qui POST `/api/submissions` avec header `X-Auth-Token: <DOCUSEAL_SECRET_KEY>`.
3. DocuSeal crée la soumission, génère les URLs uniques par signataire, et **envoie les emails d'invitation** automatiquement (via le SMTP configuré dans son propre `.env`).
4. Le worker propage la réponse DocuSeal sanitized (les `null` deviennent `""` pour éviter les `NullPointerException` côté MCP).

---

## 5. Étape 3 — Suivre les soumissions

```bash
# Toutes les soumissions
curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_list \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.submissions | length, .submissions[0]'

# Filtrer par statut
curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_list \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"status_filter":"pending"}' | jq

# Détails d'une soumission précise
curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_get \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"id":"1827463"}' | jq
```

Statuts DocuSeal courants :
- `pending` / `awaiting` : envoyé, en attente de signature
- `partially_completed` : au moins un signataire a signé
- `completed` / `signed` : tous les signataires ont signé
- `expired` : TTL atteint sans signature complète
- `declined` : un signataire a refusé

---

## 6. Étape 4 — Récupérer le document signé final

Une fois `status = completed`, télécharger le PDF signé :

```bash
RESP=$(curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_download \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"id":"1827463"}')

DOWNLOAD_URL=$(echo "$RESP" | jq -r '.download_url')
echo "URL de téléchargement (expires 1h) : $DOWNLOAD_URL"

curl -s -L "$DOWNLOAD_URL" -o /tmp/contract-signed.pdf
ls -la /tmp/contract-signed.pdf

# Vérifier que c'est bien un PDF
file /tmp/contract-signed.pdf
# Attendu : PDF document, version 1.7
```

L'URL retournée pointe vers `${DOCUSEAL_URL}/api/submissions/{id}/documents`. Si vous activez l'archivage S3 (configuration `signature.archive-bucket`), le worker copie le PDF dans `signatures-archive/{submission_id}/contract.pdf` et retourne plutôt une URL pré-signée S3 valide 1 h.

---

## 7. Étape 5 — Vérifier la signature et horodater

```bash
# Vérification d'intégrité
curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_verify \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"id":"1827463"}' | jq
```

Réponse :

```json
{
  "id": "1827463",
  "verified": true,
  "tsa_verified": false,
  "message": "Verification ok — signature SHA-256 matches DocuSeal audit trail"
}
```

Pour ajouter un horodatage RFC 3161 indépendant (preuve "à telle date, ce document existait avec ce contenu") :

```bash
# Calculer le SHA-256 du PDF signé
SHA256=$(sha256sum /tmp/contract-signed.pdf | awk '{print $1}')
echo "SHA-256 = $SHA256"

# Demander un timestamp TSA via le tsa_worker (le paramètre est hash_hex, SHA-256 attendu)
curl -s -X POST https://admin.thesocle.net/admin/workers/tsa_worker/actions/tsa_timestamp \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d "{\"hash_hex\":\"$SHA256\"}" | jq
```

Réponse (extrait) :

```json
{
  "status": "timestamped",
  "hash_hex": "a3f9c2e1b9d76543...",
  "tsa_provider": "freetsa",
  "tsr_base64": "MIIIqDCCBpAwgYG6CqQDAg...",
  "tsa_time": "2026-04-28T10:35:00Z",
  "blockchain_anchored": false
}
```

Si `blockchain_anchor: true` est activé dans `SocleHubProperties.signature`, le `TsaWorker` pousse également l'empreinte dans la blockchain Bitcoin (provider OpenTimestamps par défaut), avec un délai de confirmation de ~10 min à plusieurs heures.

---

## 8. Étape 6 — Statistiques agrégées

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/signature_worker/actions/signature_stats \
  -H "Authorization: Bearer gateway-mcp-2026" | jq
```

Réponse :

```json
{
  "total": 47,
  "pending": 8,
  "completed": 35,
  "expired": 4,
  "this_week": 12
}
```

Ce json est calculé en mémoire à chaque appel (pas de cache). `this_week` parse `created_at` ISO-8601 et compte les soumissions des 7 derniers jours glissants.

---

## 9. Étape 7 — Configuration `application.yml`

Section pertinente, lue par `SocleHubProperties.Signature` :

```yaml
soclehub:
  signature:
    docuseal-url: ${DOCUSEAL_URL:http://soclehub-docuseal:3000}
    docuseal-token: ${DOCUSEAL_SECRET_KEY}    # X-Auth-Token pour appels API
    sign-domain: ${SIGN_DOMAIN:docuseal.${DOMAIN}}
    archive-bucket: signatures-archive
    link-ttl-days: 90
    blockchain-anchor: ${SIGN_BLOCKCHAIN:false}
    tsa-providers:
      - name: freetsa
        url: https://freetsa.org/tsr
        priority: 1
      - name: apple
        url: http://timestamp.apple.com/ts01
        priority: 2
```

Variables `.env` correspondantes :

```bash
DOCUSEAL_URL=http://soclehub-docuseal:3000
DOCUSEAL_SECRET_KEY=a3f8c2e1b9d7654321fedcba0987654321abcdef0123456789abcdef01234567
SIGN_DOMAIN=docuseal.thesocle.net
SIGN_BLOCKCHAIN=false
```

---

## 10. Validation

### Healthcheck end-to-end

```bash
# 1. SignatureWorker reachable
curl -s https://admin.thesocle.net/admin/workers/signature_worker/stats \
  -H "Authorization: Bearer gateway-mcp-2026" | jq '.state, .reachable'
# Attendu : "running", true

# 2. TsaWorker
curl -s -X POST https://admin.thesocle.net/admin/workers/tsa_worker/actions/tsa_providers \
  -H "Authorization: Bearer gateway-mcp-2026" | jq

# 3. Bucket d'archive (via storage_worker — réf [[45-storage-worker]])
curl -s -X POST https://admin.thesocle.net/admin/workers/storage_worker/actions/storage_browse \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"signatures-archive","prefix":""}' | jq '.count'
```

### Test fonctionnel complet

```bash
#!/bin/bash
set -e

# Crée une soumission, vérifie l'envoi, simule la signature, télécharge.
TEMPLATE_ID="42a3f9c2-8b1e-4c7a-9f5d-1a2b3c4d5e6f"

# 1. Créer
RESP=$(curl -s -X POST .../signature_worker/actions/signature_create \
  -d '{"template_id":"'$TEMPLATE_ID'","submitters_json":"[{\"email\":\"test@example.com\",\"name\":\"Test\"}]"}')
SID=$(echo "$RESP" | jq -r '.id')

# 2. Lister
curl -s .../signature_list | jq '.submissions[] | select(.id=="'$SID'")'

# 3. Vérifier email reçu (manuellement) puis signer dans le navigateur
read -p "Sign in browser then press enter..."

# 4. Récupérer
curl -s .../signature_download -d '{"id":"'$SID'"}' | jq -r '.download_url' | xargs curl -L -o signed.pdf
ls -la signed.pdf
```

---

## 11. Pièges courants

### Piège 1 — `DocuSeal returned no data for submission creation`

**Symptôme :** `signature_create` retourne `Failed to create submission: DocuSeal returned no data`.
**Cause :** `DOCUSEAL_SECRET_KEY` invalide ou DocuSeal pas encore démarré (boot ~30 s).
**Résolution :** `docker logs soclehub-docuseal | tail -50` pour voir si l'app est up. `curl http://soclehub-docuseal:3000/health` depuis le Hub. Vérifier que `DOCUSEAL_SECRET_KEY` est bien le master token de DocuSeal (visible dans son UI **Settings → API**).

### Piège 2 — Email d'invitation jamais reçu

**Symptôme :** Soumission créée, mais le signataire n'a rien dans sa boîte.
**Cause :** SMTP de DocuSeal mal configuré (DocuSeal a ses propres variables `SMTP_*` distinctes du Hub).
**Résolution :** Dans `docker-compose.yml`, propager `MAIL_HOST`/`MAIL_PORT`/`MAIL_USERNAME`/`MAIL_PASSWORD` au container DocuSeal sous les noms `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER_NAME`/`SMTP_PASSWORD`. Vérifier dans les logs DocuSeal le `Sending mail to ...`.

### Piège 3 — `submitters_json` rejeté avec "Invalid JSON"

**Symptôme :** `Failed to create submission: Unrecognized token`.
**Cause :** Le client a passé un objet JSON natif au lieu d'une string JSON-encoded. La signature de l'action attend un STRING.
**Résolution :** Toujours `JSON.stringify` côté JS, ou `jq -Rs .` côté shell. Exemple :

```bash
# INCORRECT — l'API recevra un JSON nested
-d '{"submitters_json": [{"email":"x@y.com"}]}'
# CORRECT — le tableau est encodé en string
-d '{"submitters_json": "[{\"email\":\"x@y.com\"}]"}'
```

### Piège 4 — Cancel renvoie "placeholder"

**Symptôme :** `signature_cancel` retourne `cancel_requested` mais la soumission reste active.
**Cause :** Cette action est intentionnellement un stub dans v2.6 (voir `SignatureWorker.handleSignatureCancel` ligne 380). DocuSeal n'expose pas encore d'endpoint cancel public.
**Résolution :** Annuler manuellement via l'UI DocuSeal (Submission → Archive). Ou implémenter `DELETE /api/submissions/{id}` côté `DocuSealClient` quand DocuSeal le supportera (>= v1.5).

### Piège 5 — `signature_download` URL retourne 401

**Symptôme :** Le `download_url` est rejeté en 401.
**Cause :** L'URL pointe vers `/api/submissions/{id}/documents` qui requiert le header `X-Auth-Token`. Le client ne l'envoie pas.
**Résolution :** Soit télécharger via le worker en lui faisant streamer (méthode prochaine), soit pré-signer une URL S3 si l'archive bucket est activé. Évolution future : remplacer le placeholder par un appel `S3AttachmentService.presignedDownloadUrl(...)`.

### Piège 6 — TSA timestamp lent (>30 s)

**Symptôme :** `tsa_timestamp` met 30+ secondes.
**Cause :** FreeTSA en surcharge. Le `TsaClient` retry avec timeout 30 s par provider.
**Résolution :** Configurer plusieurs providers dans `application.yml` (`apple`, `globalsign`). Le worker bascule sur le suivant en cas d'échec.

### Piège 7 — Blockchain anchor "pending" pendant des heures

**Symptôme :** `blockchain_anchored: false` même après 2 h.
**Cause :** OpenTimestamps a besoin d'une confirmation blockchain (~10 min). Sans réseau Bitcoin actif côté server, ça ne progressera jamais.
**Résolution :** Vérifier que le serveur a accès Internet sortant. Pour test, `curl https://opentimestamps.org/api/v1/info`. Sinon désactiver `blockchain_anchor: false`.

### Piège 8 — `submitters_count` à 0 sur réponse alors que soumis 2

**Symptôme :** Réponse JSON dit `submitters_count: 0`.
**Cause :** Le `submitters_json` était une string vide ou un tableau vide. Le worker incrémente sur la liste effective parsée.
**Résolution :** Valider en amont :

```java
// CORRECT
if (submitters.isEmpty()) {
    return ActionResult.ofFailure("Au moins un signataire est requis");
}
```

### Piège 9 — Stats `this_week` à 0 alors qu'il y a des soumissions récentes

**Symptôme :** `this_week: 0` malgré une création il y a 2 h.
**Cause :** `created_at` n'est pas en ISO-8601 (DocuSeal renvoie parfois `2026-04-28 10:23:11 UTC`). `Instant.parse` lève une exception, le filtre retourne `false`.
**Résolution :** Étendre `countThisWeek` pour parser plusieurs formats. Quick-fix : `OffsetDateTime.parse(s, DateTimeFormatter.ISO_DATE_TIME)`.

### Piège 10 — Templates disparaissent de `signature_templates`

**Symptôme :** Templates récents non listés.
**Cause :** Pagination DocuSeal — par défaut limite à 10. `DocuSealClient.listTemplates()` ne paginate pas (v2.6).
**Résolution :** Pour des volumes >10 templates, paginer côté client en passant `page=N&per_page=50`. Filer un PR sur `DocuSealClient`.

### Piège 11 — Doublon de soumission si retry réseau

**Symptôme :** Deux soumissions identiques créées suite à un timeout réseau côté client.
**Cause :** `signature_create` n'est pas idempotent. DocuSeal ne supporte pas l'`Idempotency-Key`.
**Résolution :** Côté demandeur, persister en base un `request_id` UUID et vérifier qu'aucune soumission n'existe déjà avec cet ID dans le metadata DocuSeal (champ `external_id`).

### Piège 12 — Audit trail incomplet — pas de date d'envoi de l'email

**Symptôme :** `signature_get` ne montre que `created_at`, pas de timestamp d'envoi mail / open / etc.
**Cause :** DocuSeal expose un endpoint dédié `/api/submitters/{id}` plus riche, mais `SignatureWorker.handleSignatureGet` n'agrège que la submission top-level.
**Résolution :** Étendre l'action pour faire un second appel et fusionner. Ou utiliser le webhook DocuSeal `submission.completed` pour pousser l'audit trail dans la table `apps.signatures` côté Hub.

---

## 12. Pour aller plus loin

- [[50-signature-worker]] — les 11 actions complètes et le contrat `DocuSealClient`.
- [[51-tsa-worker]] — les providers TSA, l'horodatage RFC 3161 et l'algorithme de fallback.
- [[45-storage-worker]] — gestion du bucket d'archive `signatures-archive` (MinIO/S3).
- Voir `howto-16-storage-s3-quotas.md` pour gérer le bucket d'archive.
- Voir `agent-guide/02-task-decision-tree.md` tâche n°7 pour l'arbre décisionnel signature/non-signature.
