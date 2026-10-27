# HOWTO 14 — Éditer un document Office collaboratif via OnlyOffice

**Niveau :** Senior
**Prérequis :** SocleHub 3.12+ avec service `soclehub-onlyoffice` démarré, MinIO accessible avec un bucket S3 contenant des fichiers .docx/.xlsx/.pptx, `ONLYOFFICE_JWT_SECRET` configuré, un sous-domaine `onlyoffice.<DOMAIN>` avec certificat ACME valide.
**Temps estimé :** 1 heure

---

## 1. Contexte

Le besoin est classique : permettre à un utilisateur de cliquer sur un document `quotation-2026.docx` stocké dans MinIO et l'ouvrir dans un éditeur web collaboratif, avec sauvegarde automatique vers S3 et support de l'édition concurrente. Le standard de l'industrie pour la suite Office libre est OnlyOffice Document Server, qui implémente le protocole **WOPI** (Web Application Open Platform Interface, originellement Microsoft) pour récupérer et sauvegarder les fichiers depuis un backend tiers.

L'intégration côté SocleHub doit :

- Générer une URL d'édition signée que le navigateur peut consommer directement
- Servir les bytes du fichier au container OnlyOffice via WOPI (`GET /wopi/files/{id}/contents`)
- Recevoir et persister les modifications via le callback OnlyOffice (status 2 = save, status 6 = forcesave)
- Authentifier toutes les requêtes WOPI avec un JWT court (1 h par défaut)
- Distinguer Internal Docker URL (OnlyOffice ↔ Hub) et Public URL (browser ↔ OnlyOffice) pour éviter le hairpin DNS et le rejet de cert auto-signé

L'identifiant de fichier (`fileId`) est calculé en `Base64Url("bucket:s3key")` afin que le contrôleur WOPI sache, sans état serveur, où aller chercher le contenu. Le token signe ce `fileId`, l'`userId`, et la `permission` (`view`/`edit`).

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Navigateur                                  │
│                                                                          │
│  1. POST /api/v1/office/open  { s3Bucket, s3Key, permission }            │
│  2. Reçoit { editorUrl, token, fileId, config }                          │
│  3. Charge https://onlyoffice.thesocle.net/web-apps/.../index.html       │
│  4. JS DocsAPI.DocEditor("placeholder", config)                          │
└────────────────────────┬─────────────────────────────────────────────────┘
                         │ HTTPS                          ▲
                         ▼                                │ WOPI calls
┌──────────────────────────────────────────────────────┐ │
│  SocleHub (port 80/443)                              │ │
│                                                      │ │
│  OfficeApiController     ─── POST /api/v1/office/open│ │
│       │                                              │ │
│       │ generateToken(fileId, userId, permission)    │ │
│       │ generateOnlyOfficeToken(config)              │ │
│       ▼                                              │ │
│  WopiTokenService (HS256, ttl 3600s)                │ │
│                                                      │ │
│  WopiController          ─── GET /wopi/files/{id}    │◄┘
│                          ─── GET /wopi/files/{id}/contents
│                          ─── POST /wopi/files/{id}/contents
│                          ─── POST /wopi/callback (status 2/6)
│       │                                              │
│       ▼                                              │
│  S3AttachmentService ────► MinIO (bucket+key)        │
└──────────────────────────────────────────────────────┘
                         ▲                                │
                         │ Internal Docker URL            │ Server-to-server
                         │ http://soclehub:80/wopi/...    │
                         │                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  soclehub-onlyoffice (Document Server, port interne 80)                  │
│  Public URL: https://onlyoffice.thesocle.net                             │
│  - Reçoit la config signée par ONLYOFFICE_JWT_SECRET                     │
│  - Télécharge le doc via WOPI GetFile (URL interne)                      │
│  - Pousse le doc modifié via WOPI callback (URL interne)                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Vérifier le pré-requis OnlyOffice

OnlyOffice Document Server tourne dans son propre container `soclehub-onlyoffice` sur le réseau `docker_soclehub-net`. Il est exposé publiquement via un sous-domaine `onlyoffice.<DOMAIN>` configuré par le `ProxyWorker` du Hub. Le monitoring côté Hub passe par `onlyoffice_worker`, qui expose **5 actions** : `get_status`, `get_connections`, `test_health`, `get_conversion_queue` et `force_disconnect` (réf [[52-onlyoffice-worker|onlyoffice_worker]]).

```bash
# 1. Container up ?
docker ps | grep soclehub-onlyoffice
# Attendu : soclehub-onlyoffice ... Up X minutes ... 0.0.0.0:9981->80/tcp

# 2. Healthcheck interne
docker exec soclehub curl -s http://soclehub-onlyoffice/healthcheck
# Attendu : true

# 3. Healthcheck via le worker
curl -s https://admin.thesocle.net/admin/workers/onlyoffice_worker/actions/test_health \
  -H "Authorization: Bearer gateway-mcp-2026" | jq
```

Réponse attendue :

```json
{
  "healthcheck_ok": true,
  "healthcheck_response": "true",
  "jwt_secret_configured": true,
  "url": "http://soclehub-onlyoffice",
  "version": "running",
  "overall_status": "healthy",
  "message": "OnlyOffice is reachable and JWT is configured"
}
```

**Points clés :**

- `ONLYOFFICE_JWT_SECRET` doit être identique côté Hub et côté container OnlyOffice (`JWT_SECRET` env du container).
- Le Hub appelle OnlyOffice par le **nom du service Docker** (`http://soclehub-onlyoffice`). Pas de DNS public, pas de TLS interne.

---

## 4. Étape 2 — Demander l'ouverture d'un document

Le client (front, agent, ou autre app) appelle :

```bash
curl -s -X POST https://admin.thesocle.net/api/v1/office/open \
  -H "Content-Type: application/json" \
  -d '{
        "s3Bucket": "user-files",
        "s3Key": "jmh/documents/quotation-2026.docx",
        "permission": "edit"
      }' | jq
```

Réponse :

```json
{
  "editorUrl": "https://onlyoffice.thesocle.net/web-apps/apps/documenteditor/main/index.html",
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "fileId": "dXNlci1maWxlczpqbWgvZG9jdW1lbnRzL3F1b3RhdGlvbi0yMDI2LmRvY3g",
  "config": {
    "documentType": "word",
    "document": {
      "fileType": "docx",
      "key": "a3f9c2e1b9d76543",
      "title": "quotation-2026.docx",
      "url": "http://soclehub:80/wopi/files/dXNlci1maWxlcz.../contents?access_token=eyJhbGc..."
    },
    "editorConfig": {
      "callbackUrl": "http://soclehub:80/wopi/callback?access_token=eyJhbGc...",
      "lang": "fr",
      "mode": "edit",
      "user": { "id": "portal-user", "name": "portal-user" },
      "customization": {
        "forcesave": true,
        "autosave": true,
        "plugins": false,
        "compactHeader": true
      }
    },
    "token": "eyJhbGc..."
  }
}
```

Le contrôleur (`OfficeApiController.openDocument`) :

1. Encode `bucket:s3Key` en Base64Url → `fileId`.
2. Génère un `wopiToken` (`WopiTokenService.generateToken(fileId, userId, permission, 3600)`).
3. Construit le `documentKey` (SHA-256 tronqué de `fileId + timestamp`) — change à chaque appel pour invalider le cache d'OnlyOffice et forcer un fresh load.
4. Met l'URL **interne** Docker (`http://soclehub:80/wopi/...`) dans `document.url` et `editorConfig.callbackUrl`. C'est OnlyOffice DS qui appelle ces URLs depuis son container, pas le navigateur.
5. Signe la config complète avec `ONLYOFFICE_JWT_SECRET` (`generateOnlyOfficeToken`) et l'inclut dans `config.token`. OnlyOffice DS rejette toute config non signée.

---

## 5. Étape 3 — Charger l'éditeur côté navigateur

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Edit quotation-2026.docx</title>
  <script src="https://onlyoffice.thesocle.net/web-apps/apps/api/documents/api.js"></script>
</head>
<body>
  <div id="editor-placeholder" style="height:100vh;width:100%;"></div>
  <script>
    // 1. Demander la config au Hub
    fetch('/api/v1/office/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s3Bucket: 'user-files',
        s3Key: 'jmh/documents/quotation-2026.docx',
        permission: 'edit'
      })
    })
    .then(r => r.json())
    .then(data => {
      // 2. Instancier l'éditeur OnlyOffice avec la config reçue
      new DocsAPI.DocEditor('editor-placeholder', {
        documentType: data.config.documentType,
        document: data.config.document,
        editorConfig: data.config.editorConfig,
        token: data.config.token,
        events: {
          onDocumentReady: () => console.log('[onlyoffice] document ready'),
          onError: (e) => console.error('[onlyoffice] error', e),
          onRequestSaveAs: (e) => console.log('[onlyoffice] save-as requested', e)
        }
      });
    });
  </script>
</body>
</html>
```

**Points clés :**

- `api.js` est servi par le serveur OnlyOffice public, pas par le Hub.
- Le navigateur ne voit jamais les URLs internes Docker — il ne fait que charger l'éditeur et passer la config.
- L'éditeur OnlyOffice fait alors deux choses côté Document Server : (1) un GetFile pour télécharger les bytes, (2) un POST callback à chaque ctrl+S ou autosave.

---

## 6. Étape 4 — Le flux WOPI côté Hub

`WopiController` expose 4 endpoints. Tous valident l'`access_token` via `WopiTokenService.validateToken()`.

### CheckFileInfo

```
GET /wopi/files/{fileId}?access_token=<jwt>
→ 200 { BaseFileName, Size, OwnerId, UserId, UserCanWrite, SHA256, Version }
→ 401 si token invalide
```

OnlyOffice DS l'appelle pour récupérer la métadonnée. `Size` doit matcher exactement le nombre de bytes que retournera `GetFile`, sinon OnlyOffice corrompt le fichier.

### GetFile

```
GET /wopi/files/{fileId}/contents?access_token=<jwt>
→ 200 application/octet-stream <bytes>
```

`S3AttachmentService.download(bucket, s3Key)` ramène les bytes depuis MinIO (cf. [[45-storage-worker|storage_worker]]). Aucun streaming ici — on charge tout en mémoire (acceptable pour des Office docs ~50 MB max).

### PutFile

```
POST /wopi/files/{fileId}/contents?access_token=<jwt>
Body: <bytes>
→ 200 si edit permission
→ 403 si view permission
```

Utilisé en flux WOPI standard (Office Online style). En pratique avec OnlyOffice, on utilise plutôt le **callback** ci-dessous.

### Callback OnlyOffice

```
POST /wopi/callback?access_token=<jwt>
Body: { "status": 2, "url": "http://soclehub-onlyoffice/cache/files/.../output.docx", "key": "..." }
→ 200 { "error": 0 }
```

Codes status :
- `1` : édition en cours, pas de save
- `2` : document prêt à sauver, `url` contient le doc consolidé
- `4` : éditeur fermé sans changement
- `6` : forcesave (Ctrl+S explicite, `customization.forcesave=true`)

Le contrôleur télécharge `documentUrl` (URL interne Docker du cache OnlyOffice), récupère `bucket+s3Key` via `decodeFileId(claims.get("fileId"))`, et appelle `S3AttachmentService.upload(bucket, s3Key, savedDocument, contentType)`.

---

## 7. Étape 5 — Tracer une session complète

```bash
# Dans un terminal :
docker logs -f soclehub | grep -E "office-api|wopi|wopi-callback"

# Dans le browser : ouvrir le document, taper qq chose, Ctrl+S, fermer.

# Logs attendus, dans l'ordre :
[office-api] Opened document bucket=user-files key=jmh/documents/quotation-2026.docx permission=edit fileId=dXNlci1maWxlcz... callbackUrl=http://soclehub:80/wopi/callback?access_token=...
[wopi] CheckFileInfo fileId=dXNlci1maWxlcz... bucket=user-files key=jmh/documents/quotation-2026.docx size=18432
[wopi] GetFile fileId=dXNlci1maWxlcz... size=18432
[wopi-callback] Received callback: status=1 key=a3f9c2e1b9d76543 hasUrl=false
[wopi-callback] Received callback: status=6 key=a3f9c2e1b9d76543 hasUrl=true
[wopi-callback] Document saved: bucket=user-files key=jmh/documents/quotation-2026.docx size=18567 status=6
[wopi-callback] Received callback: status=4 key=a3f9c2e1b9d76543 hasUrl=false
```

---

## 8. Étape 6 — Validation par script

```bash
#!/bin/bash
set -e

DOMAIN="admin.thesocle.net"
BUCKET="user-files"
KEY="test/$(date +%s)-validation.docx"

# 1. Uploader un .docx de test dans MinIO via storage_worker
DOCX_BASE64=$(base64 -w0 /tmp/test.docx)
curl -s -X POST https://$DOMAIN/admin/workers/storage_worker/actions/storage_upload \
  -H "Authorization: Bearer gateway-mcp-2026" \
  -H "Content-Type: application/json" \
  -d "{\"bucket\":\"$BUCKET\",\"key\":\"$KEY\",\"content_base64\":\"$DOCX_BASE64\",\"content_type\":\"application/vnd.openxmlformats-officedocument.wordprocessingml.document\"}"

# 2. Demander l'ouverture
RESP=$(curl -s -X POST https://$DOMAIN/api/v1/office/open \
  -H "Content-Type: application/json" \
  -d "{\"s3Bucket\":\"$BUCKET\",\"s3Key\":\"$KEY\",\"permission\":\"edit\"}")

FILE_ID=$(echo "$RESP" | jq -r '.fileId')
TOKEN=$(echo "$RESP" | jq -r '.token')
EDITOR_URL=$(echo "$RESP" | jq -r '.editorUrl')

echo "fileId=$FILE_ID"
echo "token (extrait)=${TOKEN:0:30}..."
echo "editorUrl=$EDITOR_URL"

# 3. Simuler ce que ferait OnlyOffice : CheckFileInfo
curl -s "https://$DOMAIN/wopi/files/$FILE_ID?access_token=$TOKEN" | jq
# Attendu : { "BaseFileName": "...validation.docx", "Size": <size>, "UserCanWrite": true, ... }

# 4. Simuler GetFile
curl -s -o /tmp/roundtrip.docx "https://$DOMAIN/wopi/files/$FILE_ID/contents?access_token=$TOKEN"
ls -la /tmp/roundtrip.docx
# Attendu : taille identique au fichier original

# 5. Test 401 avec token invalide
curl -s -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/wopi/files/$FILE_ID?access_token=invalid"
# Attendu : 401
```

---

## 9. Pièges courants

### Piège 1 — OnlyOffice ne charge pas le doc, "Download error"

**Symptôme :** L'éditeur affiche "Download failed" et reste blanc.
**Cause :** OnlyOffice a essayé `https://admin.thesocle.net/wopi/files/.../contents` (URL publique) avec un cert auto-signé ou DNS hairpin (le container ne sait pas résoudre son propre domaine public).
**Résolution :** `OfficeApiController` met **toujours** l'URL interne `http://soclehub:80/wopi/...` dans `document.url` et `editorConfig.callbackUrl`. Si quelqu'un a "amélioré" en passant l'URL publique, restaurer le code original (lignes 93-114 du contrôleur).

### Piège 2 — Callback rejeté avec `error: 1`

**Symptôme :** Le doc ne se sauvegarde pas malgré Ctrl+S. Logs : `[wopi-callback] Token does not have edit permission`.
**Cause :** Le token initial a été généré avec `permission: "view"` puis `customization.mode = "edit"` côté front. Le token reste view-only, le callback PutFile est refusé.
**Résolution :** Toujours générer le token avec la permission cible. Pas d'override côté front.

### Piège 3 — `Size` mismatch entre CheckFileInfo et GetFile

**Symptôme :** OnlyOffice affiche "Document corrupted".
**Cause :** Le fichier S3 a été modifié entre les deux appels (upload concurrent). `CheckFileInfo` retourne X bytes, `GetFile` Y bytes.
**Résolution :** Verrouiller le fichier pendant l'édition côté apps.shared_folders ou implémenter un versioning S3. À défaut, les deux appels sont rapprochés (~1 s) donc rare en pratique.

### Piège 4 — `documentKey` ne change pas, OnlyOffice cache une vieille version

**Symptôme :** Vous remplacez le fichier dans S3 mais l'éditeur réaffiche l'ancien contenu.
**Cause :** OnlyOffice cache les documents par `key`. Si la même clé est réutilisée, il ne recharge pas.
**Résolution :** `OfficeApiController.generateDocumentKey()` mixe `fileId + timestamp(ms)`. Vérifier que la valeur change à chaque `/api/v1/office/open`.

### Piège 5 — Token expiré pendant l'édition

**Symptôme :** Au bout de 60 minutes, l'éditeur perd la connexion et affiche "Session expired".
**Cause :** Le `wopiToken` a un TTL de 3600 s (`DEFAULT_TOKEN_TTL_SECONDS`).
**Résolution :** Allonger le TTL dans `OfficeApiController` ou implémenter un refresh côté front (re-call `/api/v1/office/open` puis `editor.refreshHistory()`). Pour un usage très long, descendre `forcesave=true` à `autosave: 60s`.

### Piège 6 — JWT secret OnlyOffice mismatch

**Symptôme :** Logs OnlyOffice : `Token validation failed`. L'éditeur ne se charge pas.
**Cause :** `ONLYOFFICE_JWT_SECRET` côté Hub ≠ `JWT_SECRET` côté container OnlyOffice.
**Résolution :** Une seule variable dans `.env`, propagée via `docker-compose.yml` aux deux containers. Redémarrer après changement.

### Piège 7 — Bucket sans permission read pour MinIO admin

**Symptôme :** `[wopi] CheckFileInfo failed: Access Denied`.
**Cause :** Le bucket MinIO a une policy restrictive ou le credential `MINIO_ROOT_USER`/`PASSWORD` n'a pas accès.
**Résolution :** `mc alias set local http://localhost:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc anonymous get-json local/user-files`. Au pire `mc admin policy attach local readwrite --user $MINIO_ROOT_USER`.

### Piège 8 — fileId trop long (> 254 chars) rejeté

**Symptôme :** 404 sur `/wopi/files/{fileId}` car le path dépasse la limite de Tomcat.
**Cause :** Une `s3Key` très profonde + bucket long → Base64 résultant > 254 caractères.
**Résolution :** Limiter la profondeur des clés S3 (rare en pratique). Ou augmenter `server.tomcat.max-http-form-post-size` et `max-http-header-size` à 16 KB.

### Piège 9 — Callback en HTTPS alors qu'il devrait être en HTTP interne

**Symptôme :** OnlyOffice timeout sur le callback. Logs container OnlyOffice : `unable to verify the first certificate`.
**Cause :** Quelqu'un a passé `callbackUrl` en `https://admin.thesocle.net/wopi/callback` dans le body de `/api/v1/office/open`. Le contrôleur respecte ce paramètre s'il est non-blank (lignes 112-114).
**Résolution :** Ne **pas** passer `callbackUrl` dans la requête, laisser le défaut interne. Sinon, fournir une URL **interne Docker** uniquement.

### Piège 10 — Édition concurrente perd les modifications

**Symptôme :** User A et user B éditent en même temps, à la fermeture, certaines modifications de A sont perdues.
**Cause :** Chaque session ouvre l'éditeur avec un `documentKey` différent (timestamp-based). OnlyOffice ne sait pas qu'il s'agit du même doc → pas de co-édition.
**Résolution :** Pour la co-édition, utiliser un `documentKey` **stable** (ex: hash du `fileId` sans timestamp). Convention : tous les utilisateurs qui ouvrent ce `fileId` reçoivent la même `key` pendant les 24 h suivant l'ouverture initiale. Modifier `OfficeApiController.generateDocumentKey` accordingly.

### Piège 11 — Fichier .pdf : éditeur s'ouvre en lecture seule même avec `permission: edit`

**Symptôme :** Pas d'erreur, mais OnlyOffice n'autorise pas l'édition du PDF.
**Cause :** OnlyOffice Community ne supporte l'édition PDF qu'à partir de la v8. Edition Standard requise.
**Résolution :** Vérifier l'image Docker : `docker exec soclehub-onlyoffice cat /var/www/onlyoffice/documentserver/server/Common/sources/license.js | grep "edition"`. Sinon convertir le PDF en docx via `OnlyOffice ConvertService API` (worker à étendre).

### Piège 12 — Polices manquantes pour DOCX d'origine Windows

**Symptôme :** Le rendu casse, "Calibri" est remplacée par une fonte par défaut, layout cassé.
**Cause :** Container OnlyOffice n'a pas les polices propriétaires Microsoft.
**Résolution :** Monter `/usr/share/fonts/truetype/msttcorefonts/` en volume dans `soclehub-onlyoffice`, ou utiliser une image avec les polices pré-installées (`onlyoffice/documentserver:latest-msttf`).

---

## 10. Pour aller plus loin

- [[52-onlyoffice-worker]] — référence complète du worker et des actions de monitoring.
- [[45-storage-worker]] — gestion des fichiers, buckets MinIO et `S3AttachmentService`.
- Voir `howto-16-storage-s3-quotas.md` pour gérer les quotas et corbeilles utilisateur.
- Voir `agent-guide/05-diagnostic-systematique.md` pour le diagnostic réseau Docker.
