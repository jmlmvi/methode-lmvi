# HOWTO CONNECTORS-06 — Google Drive : déposer, lister, exporter des fichiers

**Niveau :** Intermédiaire
**Cible :** app qui échange des fichiers avec un Drive Google via un Service Account
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:3.0.0` (Boot 4.0.6 ; code de ce périmètre identique à 2.0.0, dernière version Boot 3) — `GdriveWorker` (10 actions),
`GoogleAuthService` (JWT RS256, scope `https://www.googleapis.com/auth/drive`) ; Drive API v3
**Temps estimé :** 30 min

---

## 1. Contexte

`gdrive_worker` couvre les opérations de fichiers courantes. L'authentification est faite **sans
bibliothèque Google** : `GoogleAuthService` signe lui-même un JWT avec la clé privée du Service
Account, l'échange contre un `access_token` sur `https://oauth2.googleapis.com/token`, et le garde en
mémoire jusqu'à 5 min avant son expiration.

| Action | Mode | Paramètres | Appel Drive |
|---|---|---|---|
| `list_files` | SYNC | `folder_id?`, `query?`, `limit?` (100, max 1000) | `GET /files?q=… and trashed = false` |
| `get_file` | SYNC | `file_id` | `GET /files/{id}` |
| `download_file` | SYNC | `file_id` | `GET /files/{id}?alt=media` → `content_base64` |
| `upload_file` | **ASYNC** | `folder_id`, `file_name`, `content_base64`, `mime_type?` | `POST upload/…/files?uploadType=multipart` |
| `create_folder` | SYNC | `parent_id`, `name` | `POST /files` (mimeType dossier) |
| `move_file` | SYNC | `file_id`, `target_folder_id` | lit les parents puis `PATCH addParents/removeParents` |
| `delete_file` | SYNC | `file_id` | `PATCH {trashed:true}` — **corbeille**, pas suppression |
| `export_google_doc` | SYNC | `file_id`, `format` (`pdf`,`docx`,`txt`,`html`,`odt`) | `GET /files/{id}/export` → `content_base64` |
| `test_connection` | SYNC | — | `GET /about?fields=user,storageQuota` |
| `get_status` | SYNC | — | statistiques locales |

---

## 2. Architecture

```
GdriveWorker ──► GoogleAuthService.getAccessToken()   (synchronized, cache ~55 min)
   │               ├─ JWT {iss: client_email, scope: drive, aud: token URL, sub?: delegated-user}
   │               └─ POST oauth2.googleapis.com/token  grant_type=jwt-bearer
   │
   ├─ RateLimiter (socle.conn.gdrive.rate-limit-rps = 8)
   ├─ ResilienceFactory.execute("gdrive")
   └─ OkHttp ──► www.googleapis.com/drive/v3  ·  www.googleapis.com/upload/drive/v3
```

---

## 3. Étape 1 — Service Account et partage

1. Google Cloud : projet → activer **Google Drive API** → créer un Service Account → clé JSON.
2. Partager le dossier cible avec l'adresse `…@….iam.gserviceaccount.com` (rôle Éditeur).
   Sans délégation, le SA ne voit **que** ce qui lui est partagé (et son propre Drive, vide).
3. Option Workspace : domain-wide delegation pour agir *au nom* d'un utilisateur
   (`SOCLE_CONN_GDRIVE_DELEGATED_USER`).

```bash
SOCLE_CONN_GDRIVE_ENABLED=true
SOCLE_CONN_GDRIVE_CREDENTIALS_JSON='{"type":"service_account","client_email":"socle@proj.iam.gserviceaccount.com","private_key":"<clé privée PEM du compte de service, sauts de ligne en \\n>", …}'
```

---

## 4. Étape 2 — Déposer un PDF depuis le code de l'app

```java
package eu.lmvi.monapp.archives;

import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.connectors.GdriveWorker;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Map;

@Service
public class DriveArchiver {

    private final ObjectProvider<GdriveWorker> drive;

    public DriveArchiver(ObjectProvider<GdriveWorker> drive) {
        this.drive = drive;
    }

    public String deposer(Path pdf, String folderId) throws Exception {
        GdriveWorker w = drive.getIfAvailable();
        if (w == null) throw new IllegalStateException("gdrive_worker inactif");

        String b64 = Base64.getEncoder().encodeToString(Files.readAllBytes(pdf));
        ActionResult r = w.executeAction("upload_file",
                ActionParameters.fromMap(Map.of(
                        "folder_id", folderId,
                        "file_name", pdf.getFileName().toString(),
                        "mime_type", "application/pdf",
                        "content_base64", b64)),
                ActionContext.internal("drive_archiver"));
        if (!r.success()) throw new IllegalStateException("Drive : " + r.error());
        return r.getDataString("id");
    }
}
```

`executeAction` appelé directement est **synchrone**, quel que soit le mode déclaré : le mode
ASYNC ne joue que pour les appels passant par le socle (`…/async`, MCP).

---

## 5. Étape 3 — Les mêmes opérations en REST

```bash
W=http://localhost:8080/admin/workers/gdrive_worker/actions
H=(-H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json")

curl -s "${H[@]}" -X POST $W/create_folder -d '{"parent_id":"0AAbbbCCC","name":"2026-10"}'
curl -s "${H[@]}" -X POST $W/export_google_doc -d '{"file_id":"1xYz…","format":"pdf"}' \
  | jq -r '.data.content_base64' | base64 -d > contrat.pdf
curl -s "${H[@]}" -X POST $W/move_file -d '{"file_id":"1xYz…","target_folder_id":"0AAddd"}'
curl -s "${H[@]}" -X POST $W/upload_file/async -d "$(jq -cn --arg c "$(base64 -w0 rapport.pdf)" \
  '{folder_id:"0AAbbbCCC",file_name:"rapport.pdf",mime_type:"application/pdf",content_base64:$c}')"
```

---

## 6. Vérifier

```bash
curl -s "${H[@]}" -X POST $W/test_connection -d '{}'
# data : {"connected":true,"user_email":"socle@proj.iam.gserviceaccount.com","storage_used":…,"storage_limit":…}
```

```sql
SELECT action, status, latency_ms, error_message FROM schema_monapp.tr_connector_log
WHERE connector = 'gdrive' ORDER BY x_id DESC LIMIT 10;
```

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `test_connection` | `user_email` = adresse du SA (ou de l'utilisateur délégué) |
| 2 | `upload_file` d'un PDF de 1 Mo | `id`, `size` = 1 048 576 |
| 3 | `export_google_doc` format `docx` | `content_base64` décodable en .docx |
| 4 | `delete_file` | Fichier dans la corbeille Drive, restaurable |
| 5 | `export_google_doc` format `xlsx` | Échec `Unsupported format: xlsx` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **`list_files` quand tout tient sur une page** | Échec avec erreur **vide** : Drive n'envoie pas `nextPageToken`, le code construit `Map.of("next_page_token", null)` → `NullPointerException` | Lister via `get_file` connus, ou demander un `limit` inférieur au nombre de fichiers ; correction dans le pack : `LinkedHashMap` |
| Dossier non partagé avec le SA | `list_files` vide, `get_file` 404 | Partager le dossier avec `client_email` |
| Gros fichiers | `download_file` / `upload_file` tiennent **tout le fichier en mémoire**, en base64 (+33 %) dans la réponse | Rester sous quelques dizaines de Mo ; au-delà, upload résumable hors pack |
| `delete_file` pris pour une suppression | Le quota ne baisse pas | Corbeille seulement ; vider côté Drive |
| `export_google_doc` sur un PDF ou un .docx déposé | `Drive export HTTP 403` | Export réservé aux fichiers Google natifs ; utiliser `download_file` |
| Tableurs / présentations | Formats proposés = traitement de texte uniquement | Pas d'export `xlsx`/`pptx` dans le pack |
| `query` libre | Injection dans la requête Drive (`folder_id` et `query` concaténés tels quels) | Ne jamais y passer une saisie utilisateur brute |
| Délégation mal posée | `Google token HTTP 401 unauthorized_client` | Autoriser le client_id du SA sur le scope `drive` |
| Scope trop large | Le scope est `drive` complet, codé en dur | Restreindre par le partage de dossiers, pas par le scope |
| `x_partition`, `request_hash` utiles attendus | `datas = {}` et `request_hash` identique pour tous les appels d'une même action | Le worker passe `Map.of()` comme paramètres au journal ([[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10]]) |

---

## 9. Pour aller plus loin

- [[howto-16-storage-s3-quotas|HOWTO 16 — Stockage S3 du Hub]] — à préférer pour un stockage interne à la plateforme
- [[howto-connectors-03-gerer-les-identifiants|CONNECTORS-03 — Identifiants]]
- [[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10 — Résilience et journal]]
