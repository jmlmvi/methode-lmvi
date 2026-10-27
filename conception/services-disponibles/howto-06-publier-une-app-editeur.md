# HOWTO 06 — Publier une application en mode éditeur

> **Niveau** : avancé | **Prérequis** : SocleHub v2.5+ déployé, compte admin Hub, image Docker prête, accès à un nom de domaine pour le registry, clé Ed25519 disponible | **Temps estimé** : 30-60 min (initial) puis 5 min par publication

Ce guide montre comment activer le **mode éditeur** d'un Hub SocleHub et publier une nouvelle version d'une app dans le **registry Docker privé** intégré, signée par une clé Ed25519. Le manifest généré est consommé par les Hubs **clients** (cf. `howto-07`) qui ajoutent ce Hub comme source de catalogue. C'est la mécanique qui permet à TheSocle de distribuer des apps personnalisées (`office-suite`, `socle-dashboard`, etc.) à ses Hubs clients en garantissant l'intégrité (Ed25519) et l'authenticité (digest registry vérifié).

---

## 1. Contexte

Un éditeur d'apps SocleHub (par ex. TheSocle officiel) doit pouvoir publier des apps maison à destination d'un parc de Hubs clients. Le besoin :

- Pousser une image Docker dans un registry contrôlé,
- Annoncer la disponibilité d'une nouvelle version dans un manifest signé,
- Permettre aux Hubs clients de découvrir et installer l'app sans configuration manuelle,
- Garantir qu'une image push n'est pas falsifiée entre l'éditeur et le client.

Le mode éditeur active deux composants : (1) un service `registry:2.8` Docker (tournant dans `docker-compose.yml` sous le profil `editor`) qui héberge les images, et (2) un `RepositoryEditorWorker` (cf. [[33-repository-editor-worker]]) qui régénère un `manifest.json` depuis les tables `repository.apps` + `repository.versions`, signe le manifest avec une clé Ed25519 stockée en Vault (cf. [[11-vault-worker]] et [[91-thefront-manifest-ed25519]] pour le format de signature), et expose le tout sur `/repository/manifest.json`, `/repository/manifest.json.sig`, `/repository/publickey.pem`. Quand un digest est fourni, le worker **vérifie le digest annoncé** contre le registry réel via l'API Docker Registry v2 — impossible donc de publier un digest qui ne correspond pas à l'image effectivement présente ; si le digest est omis, le worker le **résout automatiquement** depuis le registry.

L'éditeur doit :

- Activer `SOCLEHUB_ROLE=editor` (ou `client,editor`) + `COMPOSE_PROFILES=editor`,
- Démarrer le service `registry:2.8` avec auth htpasswd,
- Provisionner la clé Ed25519 dans Vault `soclehub/repository/signing-key`,
- Push une image dans `repository.<domain>/<namespace>/<image>:<tag>`,
- Récupérer le digest exact depuis le registry (optionnel : auto-résolu sinon),
- Appeler `repository_editor_worker/publish_version` qui INSERT dans `repository.versions` (auto-crée l'app dans `repository.apps` si absente),
- Voir le manifest régénéré et signé en automatique,
- Valider que les Hubs clients récupèrent la nouvelle version au prochain cycle 6h.

---

## 2. Architecture

```
                      ┌─────────────────────────────────────┐
                      │       Éditeur (SocleHub Hub)        │
                      │     SOCLEHUB_ROLE = editor          │
                      └──────────────────┬──────────────────┘
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            │                            │                            │
            ▼                            ▼                            ▼
  ┌───────────────────┐        ┌───────────────────┐       ┌───────────────────┐
  │ registry:2.8      │        │ RepositoryEditor  │       │ Vault             │
  │ (profile=editor)  │        │ Worker            │       │ soclehub/         │
  │ port 5000 interne │◄──────►│ - publish_version │◄─────►│   repository/     │
  │ htpasswd auth     │        │ - regen manifest  │       │     signing-key   │
  │ FQDN: repository  │        │ - sign Ed25519    │       │     publisher     │
  │  .thesocle.net    │        └─────────┬─────────┘       └───────────────────┘
  └───────────────────┘                  │
            │                            ▼
            │                  ┌────────────────────────┐
            │                  │ /app/data/repository/  │
            │                  │   manifest.json        │
            │                  │   manifest.json.sig    │
            │                  │   publickey.pem        │
            │                  └─────────┬──────────────┘
            │                            │
            │                            ▼
            │                  ┌────────────────────────┐
            │                  │ SocleRepositoryControl │
            │                  │ GET /repository/*.*    │
            │                  │ (public, no auth)      │
            │                  └─────────┬──────────────┘
            │                            │
   ┌────────┴─────────┬──────────────────┴────────────────┐
   ▼                  ▼                                   ▼
docker pull      manifest fetch                  Hub client (CatalogSyncWorker)
docker push      via HTTPS public                cycle 6h fetch + verify Ed25519
                                                 puis store apps.repository_catalog_caches
```

---

## 3. Étape 1 — Activer le rôle éditeur

Éditer `/opt/2026-TheHub4TheSocle/soclehub/docker/.env` :

```bash
# Rôle Hub : client = consomme uniquement / editor = publie / client,editor = les deux
SOCLEHUB_ROLE=client,editor

# Active le profil Docker compose qui démarre le registry
COMPOSE_PROFILES=editor

# Identité éditeur (visible dans le manifest publié)
SOCLEHUB_EDITOR_ID=thesocle-official
SOCLEHUB_EDITOR_NAME=TheSocle
SOCLEHUB_EDITOR_WEBSITE=https://thesocle.net

# Domaine du registry (doit pointer vers le Hub via DNS A)
CLOUDFLARE_DEFAULT_ZONE=thesocle.net
```

L'env var `SOCLEHUB_ROLE` est lue par `RepositoryEditorWorker.isEnabled()` :

```java
@Override
public boolean isEnabled() {
    // Active uniquement si le rôle Hub inclut "editor"
    String role = System.getenv("SOCLEHUB_ROLE");
    if (role == null) role = "client";
    return role.contains("editor");
}
```

Si le worker n'est pas activé, l'endpoint `POST /repository/apps/{appId}/versions` renvoie 503 `editor_disabled`.

---

## 4. Étape 2 — Démarrer le service registry

```bash
cd /opt/2026-TheHub4TheSocle/soclehub/docker
docker compose --profile editor up -d registry
```

Bloc `docker-compose.yml` correspondant (service `registry`, profil `editor`) :

```yaml
registry:
  image: registry:2.8
  container_name: soclehub-registry
  profiles: ["editor"]
  restart: unless-stopped
  environment:
    REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY: /var/lib/registry
    REGISTRY_STORAGE_DELETE_ENABLED: "true"
    REGISTRY_HTTP_ADDR: "0.0.0.0:5000"
    REGISTRY_AUTH: "htpasswd"
    REGISTRY_AUTH_HTPASSWD_REALM: "repository.${CLOUDFLARE_DEFAULT_ZONE:-thesocle.net}"
    REGISTRY_AUTH_HTPASSWD_PATH: "/auth/htpasswd"
    REGISTRY_HTTP_HEADERS_X-Content-Type-Options: "[nosniff]"
  volumes:
    - registry-data:/var/lib/registry
    - registry-auth:/auth
  networks:
    - soclehub-net
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://localhost:5000/v2/"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 10s
```

Vérifier :

```bash
docker ps | grep soclehub-registry
docker compose --profile editor logs -f registry
# Attendu : "listening on [::]:5000"
```

---

## 5. Étape 3 — Configurer l'auth htpasswd

Créer le fichier `htpasswd` (le format standard nginx/apache) :

```bash
docker run --rm --entrypoint htpasswd \
  httpd:2 -Bbn publisher MonMotDePasseTresFort > /tmp/htpasswd
docker cp /tmp/htpasswd soclehub-registry:/auth/htpasswd
docker restart soclehub-registry
```

Stocker les credentials dans Vault (le worker les lit pour vérifier les digests) :

```bash
curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d '{"path": "soclehub/repository/publisher", "key": "username", "value": "publisher"}'

curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d '{"path": "soclehub/repository/publisher", "key": "password", "value": "MonMotDePasseTresFort"}'
```

Tester l'auth :

```bash
docker login repository.thesocle.net
# Username: publisher
# Password: MonMotDePasseTresFort
# Login Succeeded
```

---

## 6. Étape 4 — Provisionner la clé Ed25519 de signature

La clé est stockée en Vault sous `soclehub/repository/signing-key` avec deux entrées :

- `private_key_b64` : PEM PKCS8 encodé en base64,
- `public_key_b64` : PEM X509 encodé en base64.

Génération :

```bash
# Generate Ed25519 keypair via openssl
openssl genpkey -algorithm Ed25519 -out /tmp/repo-priv.pem
openssl pkey -in /tmp/repo-priv.pem -pubout -out /tmp/repo-pub.pem

# Base64 encode (single-line)
PRIV_B64=$(base64 -w0 /tmp/repo-priv.pem)
PUB_B64=$(base64 -w0 /tmp/repo-pub.pem)

# Push to Vault
curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"soclehub/repository/signing-key\", \"key\": \"private_key_b64\", \"value\": \"${PRIV_B64}\"}"

curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"soclehub/repository/signing-key\", \"key\": \"public_key_b64\", \"value\": \"${PUB_B64}\"}"

# Cleanup local
rm /tmp/repo-priv.pem /tmp/repo-pub.pem
```

**Important** : la clé privée ne doit jamais sortir du Vault. Le `RepositoryEditorWorker` la lit en mémoire à chaque signature mais ne l'écrit nulle part sur disque.

---

## 7. Étape 5 — Push une image dans le registry

```bash
# Tagger une image existante
docker tag office-suite:1.2.0 repository.thesocle.net/soclehub-local/office-suite:1.2.0

# Push (auth via docker login précédent)
docker push repository.thesocle.net/soclehub-local/office-suite:1.2.0

# Sortie attendue :
# 1.2.0: digest: sha256:abc123def456... size: 2345
```

**Récupérer le digest exact** (optionnel — à passer à `publish_version`, sinon le worker le résout automatiquement depuis le registry) :

```bash
DIGEST=$(curl -s -u publisher:MonMotDePasseTresFort \
  -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  -I "https://repository.thesocle.net/v2/soclehub-local/office-suite/manifests/1.2.0" \
  | grep -i docker-content-digest | awk '{print $2}' | tr -d '\r')

echo $DIGEST
# sha256:abc123def4567890...
```

---

## 8. Étape 6 — Créer l'app dans `repository.apps` (optionnel)

> **Depuis v2.8.0, `publish_version` auto-crée l'app** dans `repository.apps` si elle n'existe pas (`ON CONFLICT (app_id) DO NOTHING`), à partir des champs `appId`, `displayName`, `description`, `categories`, `appType`, `sourceRegistry`. Cette étape n'est donc plus obligatoire — elle reste utile pour fixer des métadonnées riches (visibilité `licensed`, catégories) avant la 1ʳᵉ publication.

Pour créer l'app explicitement : soit via le portail (`POST /hub/repository/admin/apps` avec un manifest JSON), soit en SQL direct :

```sql
INSERT INTO repository.apps (app_id, display_name, description, categories, app_type, source_registry, visibility)
VALUES (
  'office-suite',
  'Office Suite TheSocle',
  'Suite bureautique intégrée OnlyOffice + Cosmo + Storage',
  '["office", "collaboration"]'::jsonb,
  'internal',
  '',
  'licensed'
);
```

Ou via REST :

```bash
curl -X POST http://localhost:8080/hub/repository/admin/apps \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'manifestJson={"appId":"office-suite","name":"Office Suite TheSocle","description":"Suite bureautique","categories":["office"],"appType":"thesocle","ssoMode":"gate"}'
```

---

## 9. Étape 7 — Publier la version

L'action `publish_version` du `RepositoryEditorWorker` valide + insère + régénère le manifest. Endpoint :

```bash
curl -X POST http://localhost:8080/repository/apps/office-suite/versions \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: dev" \
  -d '{
    "version": "1.2.0",
    "channel": "stable",
    "dockerImage": "repository.thesocle.net/soclehub-local/office-suite",
    "dockerTag": "1.2.0",
    "dockerDigest": "sha256:abc123def4567890...",
    "minHubVersion": "2.5.0",
    "breakingChanges": false,
    "changelogUrl": "https://thesocle.net/changelogs/office-suite-1.2.0",
    "catalogMetadata": {
      "portInternal": 8080,
      "ssoMode": "gate",
      "volumes": [{"name": "data", "containerPath": "/data"}]
    }
  }'
```

Réponse 201 :

```json
{
  "appId": "office-suite",
  "version": "1.2.0",
  "channel": "stable",
  "dockerDigest": "sha256:abc123def4567890...",
  "verified": true,
  "manifestRegenerated": true,
  "publishedAt": "2026-04-28T10:23:45Z"
}
```

**Que se passe-t-il en interne** (cf. `RepositoryEditorWorker.publishVersion`) :

1. Validation des champs requis : `appId`, `version`, `dockerImage`, `dockerTag` (le `dockerDigest` n'est **pas** requis). Validation de `appType` ∈ {`internal`, `thirdparty`},
2. **Auto-création** de l'app dans `repository.apps` si absente (`ON CONFLICT (app_id) DO NOTHING`),
3. Check `repository.versions` (la version n'existe pas déjà — `UNIQUE (app_id, version)`),
4. **Digest** :
   - si `dockerDigest` est **omis** → auto-résolution via `registryClient.fetchManifestInfo(...)` (pour `thirdparty`, résolution du registry source + strip du préfixe),
   - si `dockerDigest` est **fourni** → vérification contre le registry (`verifyDigestInRegistry` pour `internal`, `registryClient.verifyDigest` pour `thirdparty`). Si mismatch → `SecurityException`,
5. INSERT dans `repository.versions` avec `verified=true`, `validation_status='ok'`, `published_at=NOW()` (+ `promoted_to_stable_at=NOW()` si `channel='stable'`),
6. Régénération + signature Ed25519 du manifest,
7. INSERT dans `repository.access_logs` (audit).

---

## 10. Étape 8 — Variante via portail admin

Le portail expose `/hub/repository/admin` (visible si `editorActive`) :

```
Browser ──→ GET https://admin.thesocle.net/hub/repository/admin
         ←── HTML : liste apps + form publish

Form fields :
  - appId          : office-suite
  - version        : 1.2.0
  - channel        : stable / beta / dev
  - dockerImage    : repository.thesocle.net/soclehub-local/office-suite
  - dockerTag      : 1.2.0
  - dockerDigest   : sha256:abc123...
  - changelogUrl   : (optionnel)
  - breakingChanges: checkbox

Browser ──→ POST https://admin.thesocle.net/hub/repository/admin/publish
PortalRepositoryController.adminPublish appelle editorWorker.publishVersion(...)
```

---

## 11. Étape 9 — Vérifier la signature et le digest

### Récupérer le manifest et la signature

```bash
curl -s https://admin.thesocle.net/repository/manifest.json | jq .
curl -s -o /tmp/manifest.json https://admin.thesocle.net/repository/manifest.json
curl -s -o /tmp/manifest.json.sig https://admin.thesocle.net/repository/manifest.json.sig
curl -s -o /tmp/publickey.pem https://admin.thesocle.net/repository/publickey.pem
```

### Vérifier la signature avec openssl

```bash
openssl pkeyutl -verify \
  -pubin -inkey /tmp/publickey.pem \
  -rawin -in /tmp/manifest.json \
  -sigfile /tmp/manifest.json.sig
# Attendu : "Signature Verified Successfully"
```

### Vérifier le digest dans le manifest

```bash
jq '.apps[] | select(.appId=="office-suite") | .versions[] | {version, dockerDigest}' /tmp/manifest.json
# Doit afficher la nouvelle version avec son digest
```

### Statut côté worker

```bash
curl -s -X POST http://localhost:8080/api/actions/repository_editor_worker/get_status \
  -H "Content-Type: application/json" -d '{}' | jq
```

```json
{
  "data": {
    "healthy": true,
    "editorEnabled": true,
    "publishCount": 5,
    "regenerateCount": 12,
    "lastRegenAt": "2026-04-28T10:23:46.123Z",
    "publicKeyFingerprint": "sha256:a4b8c2e1d6f7..."
  }
}
```

---

## 12. Étape 10 — Régénérer le manifest manuellement

Le manifest est régénéré automatiquement à chaque `publish_version` et toutes les 24h (cycle worker). On peut forcer :

```bash
curl -X POST http://localhost:8080/api/actions/repository_editor_worker/regenerate_manifest \
  -H "Content-Type: application/json" -d '{}'
```

Cas d'usage : on a édité directement les tables `repository.versions` (ex. UPDATE pour deprecated_at) et on veut que le manifest reflète immédiatement.

---

## 12 bis. Apps tierces (thirdparty) — import et revalidation

En plus de la publication d'apps `internal`, le `RepositoryEditorWorker` expose deux actions dédiées aux apps `thirdparty` (images publiques type Docker Hub) :

```bash
# Migration one-shot : importe toutes les entrées appType=thirdparty du /app/catalog.json
# dans repository.apps + repository.versions (digest auto-fetch). Idempotent.
curl -X POST http://localhost:8080/api/actions/repository_editor_worker/import_thirdparty_from_catalog \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"catalog_path": "/app/catalog.json"}'

# Re-vérifie le digest courant de chaque version thirdparty et met à jour validation_status.
# Idempotent — à lancer périodiquement (les tags publics peuvent bouger).
curl -X POST http://localhost:8080/api/actions/repository_editor_worker/validate_thirdparty_images \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{"max_age_hours": 24}'
```

Détails dans [[33-repository-editor-worker]].

---

## 13. Validation — distribution aux Hubs clients

Côté Hub client (cf. `howto-07`), une source pointe vers `https://admin.thesocle.net/repository/manifest.json`. Le `CatalogSyncWorker` du client synchronise toutes les 6h. Pour forcer une sync immédiate :

```bash
# Sur le Hub client
curl -X POST http://localhost:8080/api/actions/catalog_sync_worker/force_sync \
  -H "Content-Type: application/json" -d '{}'
```

Côté éditeur, audit des accès :

```sql
SELECT x_dateCreated, actor_email, action, app_id, version, result, denial_reason
FROM repository.access_logs
ORDER BY x_dateCreated DESC LIMIT 20;
```

> Plus simple : l'action MCP dédiée `repository_editor_worker/get_access_log` (param `limit`) retourne les N dernières entrées sans SQL.

---

## 14. Pièges courants

### Piège 1 — `editor_disabled` (503)

**Symptôme** : `POST /repository/apps/X/versions` renvoie 503 `Ce Hub n'est pas en mode éditeur`.

**Cause** : `SOCLEHUB_ROLE` n'inclut pas `editor`, ou la variable n'est pas exportée dans le container.

**Résolution** :

```bash
# Vérifier ce que voit le container
docker exec soclehub-app printenv SOCLEHUB_ROLE
# Si vide ou "client" → corriger .env puis docker compose up -d soclehub-app
```

### Piège 2 — `Digest mismatch` (SecurityException)

**Symptôme** : publish renvoie 400 avec `Digest mismatch: annoncé=... ne correspond pas à l'image réelle`.

**Cause** : le digest passé en paramètre ne matche pas le `Docker-Content-Digest` du registry. Soit erreur de copy-paste, soit l'image a été repushée avec un contenu différent entre le `docker push` et le `publish_version`.

**Résolution** : refaire le `curl -I .../v2/.../manifests/...` pour récupérer le digest courant, puis renvoyer le publish.

### Piège 3 — `unauthorized: authentication required` (registry)

**Symptôme** : la vérification digest échoue avec `registry HEAD returned 401`.

**Cause** : Vault path `soclehub/repository/publisher` vide ou credentials incorrects.

**Résolution** :

```bash
# Vérifier les creds
curl -s -X POST http://localhost:8080/api/actions/vault_worker/get_secret_keys \
  -d '{"path": "soclehub/repository/publisher"}'

# Doit lister username + password. Si vide, refaire les set_secret du §5.
```

### Piège 4 — `No private_key_b64 in Vault path`

**Symptôme** : la régénération échoue avec `IllegalStateException: No private_key_b64 in Vault path soclehub/repository/signing-key`.

**Cause** : la clé Ed25519 n'a pas été provisionnée (cf. §6) ou la clé `private_key_b64` est manquante.

**Résolution** : refaire le set_secret en s'assurant du nom de clé exact (`private_key_b64`, pas `private_key` ni `priv_key_b64`).

### Piège 5 — Signature ne vérifie pas côté client

**Symptôme** : sur le Hub client, log `Signature Ed25519 invalide pour la source X`.

**Cause** : le client a stocké une ancienne clé publique (TOFU — Trust On First Use), et l'éditeur a régénéré sa clé. Ou bien la clé client a été collée avec un saut de ligne / espace en trop.

**Résolution** : sur le Hub client, supprimer puis recréer la source (cf. `howto-07`). Pour éviter le re-add, mettre à jour la colonne `apps.repository_sources.public_key_pem` directement avec la PEM valide.

### Piège 6 — Métadonnées d'app pauvres après auto-création

**Symptôme** : l'app apparaît dans le manifest avec un `display_name` égal à l'`appId` et sans catégories.

**Cause** : depuis v2.8.0, `publish_version` **auto-crée** l'app si elle est absente, mais avec les seules métadonnées passées dans le payload (`displayName`, `description`, `categories` par défaut vides). Le message historique « App does not exist. Create it first » n'apparaît plus.

**Résolution** : soit fournir `displayName`/`description`/`categories` dans le payload de `publish_version`, soit créer l'app d'abord via `/hub/repository/admin/apps` (cf. §8), soit corriger après coup en SQL puis `regenerate_manifest` :

```sql
UPDATE repository.apps
SET display_name = 'Office Suite TheSocle', categories = '["office","collaboration"]'::jsonb
WHERE app_id = 'office-suite';
```

### Piège 7 — `Version 1.2.0 already exists`

**Symptôme** : publish renvoie 400.

**Cause** : la version existe déjà (`UNIQUE (app_id, version)` enforced).

**Résolution** : pour republier, soit incrémenter la version (`1.2.1`), soit supprimer la version précédente :

```sql
DELETE FROM repository.versions WHERE app_id = 'office-suite' AND version = '1.2.0';
```

Puis relancer publish.

### Piège 8 — Registry plein, publish échoue silencieusement

**Symptôme** : `docker push` reste figé puis timeout. Pas d'erreur côté worker (push hors workflow).

**Cause** : volume `registry-data` plein.

**Résolution** :

```bash
docker exec soclehub-registry du -sh /var/lib/registry
# Si > capacité disque, lancer la GC
docker exec soclehub-registry registry garbage-collect /etc/docker/registry/config.yml
```

### Piège 9 — Cert TLS du registry expiré

**Symptôme** : `docker push` renvoie `x509: certificate has expired`.

**Cause** : le wildcard ACME du Hub a expiré ou le proxy ne renvoie plus le bon cert.

**Résolution** :

```bash
curl -X POST http://localhost:8080/api/actions/acme_worker/force_renew \
  -H "Content-Type: application/json" \
  -d '{"domain": "thesocle.net"}'
```

### Piège 10 — `manifestExpiresAt` dépassé côté client

**Symptôme** : Hub client refuse le manifest avec une erreur `expired` (peu probable car non bloquant en v1, mais log warning).

**Cause** : éditeur n'a pas resigné depuis > 48h. La régénération auto a un cycle de 24h mais peut être skip si le worker n'a pas tourné.

**Résolution** : forcer une régénération :

```bash
curl -X POST http://localhost:8080/api/actions/repository_editor_worker/regenerate_manifest \
  -H "Content-Type: application/json" -d '{}'
```

---

## 15. Pour aller plus loin

- [[33-repository-editor-worker|RepositoryEditorWorker]] — référence complète du worker éditeur (`publish_version`, `regenerate_manifest`, `import_thirdparty_from_catalog`, `validate_thirdparty_images`, `get_access_log`),
- [[32-catalog-sync-worker|CatalogSyncWorker]] — comment les Hubs clients consomment et vérifient le manifest signé,
- [[91-thefront-manifest-ed25519|Manifest signé Ed25519]] — format de signature et vérification TOFU,
- [[11-vault-worker|VaultWorker]] — stockage de la clé de signature et des credentials publisher,
- [[40-acme-worker|AcmeWorker]] — certificat TLS du registry (cf. piège 9),
- Voir `howto-07-ajouter-une-source-repository.md` pour ajouter ce Hub éditeur comme source côté client,
- Voir `howto-03-installer-une-app.md` pour installer une app publiée par un éditeur tiers.
