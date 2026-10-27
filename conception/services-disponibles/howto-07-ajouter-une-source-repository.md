# HOWTO 07 — Ajouter une source de catalogue Repository

> **Niveau** : intermédiaire | **Prérequis** : SocleHub v2.5+ démarré, accès admin Hub, URL d'un manifest signé Ed25519, clé publique Ed25519 fournie par l'éditeur | **Temps estimé** : 5-10 min

Ce guide montre comment configurer un Hub SocleHub en mode **client** pour qu'il consomme un catalogue d'apps signé par un éditeur tiers (par exemple un autre Hub TheSocle, ou un partenaire). Une fois la source ajoutée, les apps publiées par l'éditeur apparaissent dans le wizard d'install, sont sélectionnables côté UI, et peuvent être déployées comme n'importe quelle app du catalogue local. La sécurité repose sur la **vérification Ed25519** du manifest via le [[32-catalog-sync-worker|CatalogSyncWorker]].

---

## 1. Contexte

Sur un parc de Hubs, tous les déploiements doivent rester cohérents : si TheSocle pousse une nouvelle version d'`office-suite`, tous les Hubs clients doivent pouvoir la voir et l'installer **sans mise à jour manuelle du catalogue local**. Inversement, un Hub client ne doit jamais installer une app provenant d'une source non-vérifiée. La signature Ed25519 garantit qu'un attaquant ne peut pas inject un `dockerImage` malveillant : la clé publique est stockée localement (TOFU — Trust On First Use), et le `CatalogSyncWorker` refuse tout manifest dont la signature ne match pas.

Le scope v1 est volontairement restreint : un Hub peut être `client`, `editor` ou les deux. Il n'y a pas d'auto-upgrade (le client doit déclencher l'install manuellement), pas de fenêtre de maintenance, pas de logique de fallback inter-source. Le cycle de sync est fixe à 6h. À chaque sync : fetch manifest + signature, verify Ed25519, stocke en cache (`apps.repository_catalog_caches`), update `apps.repository_sources.last_sync_status`. Côté UI, les apps externes sont mergées avec le catalog local et taguées par `_sourceName` (badge couleur).

Le Hub client doit :

- Avoir `SOCLEHUB_ROLE` qui inclut `client` (ou `client,editor`),
- Disposer de la clé publique Ed25519 de l'éditeur (TOFU manuel),
- Insérer une ligne dans `apps.repository_sources` (URL manifest, sig, public key, registry),
- Laisser le `CatalogSyncWorker` synchroniser au prochain cycle 6h ou forcer immédiatement,
- Voir les apps dans `/hub/apps/install` taguées par source.

---

## 2. Architecture

```
                     ┌────────────────────────────────────────┐
                     │      Hub client (SOCLEHUB_ROLE=client) │
                     └──────────────────┬─────────────────────┘
                                        │
        ┌───────────────────────────────┼─────────────────────────────────┐
        ▼                               ▼                                 ▼
┌───────────────────┐         ┌─────────────────────┐         ┌───────────────────┐
│ apps.repository_  │         │ CatalogSyncWorker   │         │ Portal            │
│   sources         │◄────────┤ cycle 6h            │         │ /hub/repository   │
│ (URL + Ed25519    │         │ - fetch manifest    │         │ /hub/repository/  │
│  TOFU public key) │         │ - verify signature  │         │   sources (CRUD)  │
└───────────────────┘         │ - upsert cache      │         └─────────┬─────────┘
                              └────────┬────────────┘                   │
                                       │                                │
                                       ▼                                │
                              ┌─────────────────────────┐               │
                              │ apps.repository_catalog │               │
                              │ _caches (manifest_json, │               │
                              │  signature_b64, valid)  │               │
                              └────────┬────────────────┘               │
                                       │                                │
                                       └──────────────┬─────────────────┘
                                                      ▼
                                          /hub/apps/install (wizard)
                                          → catalog local + apps externes
                                            mergés, badge "_sourceName"

Hop éditeur :
  https://admin.thesocle.net/repository/manifest.json
  https://admin.thesocle.net/repository/manifest.json.sig
  https://admin.thesocle.net/repository/publickey.pem
```

---

## 3. Étape 1 — Vérifier que le Hub est en mode client

Éditer `/opt/2026-TheHub4TheSocle/soclehub/docker/.env` :

```bash
# client : consomme uniquement / editor : publie / client,editor : les deux
SOCLEHUB_ROLE=client

# Optionnel : nom du Hub client (visible dans les logs/audit)
SOCLEHUB_INSTANCE_NAME=client-acme-prod
```

Si vous changez `SOCLEHUB_ROLE`, redémarrer :

```bash
docker compose -f /opt/2026-TheHub4TheSocle/soclehub/docker/docker-compose.yml \
  up -d soclehub
```

Vérifier :

```bash
docker exec soclehub printenv SOCLEHUB_ROLE
# Attendu : client (ou client,editor)
```

Le `CatalogSyncWorker` est actif quel que soit le rôle (il n'a pas de gate `isEnabled`). Le `RepositoryEditorWorker` est désactivé en mode pur client (cf. ligne 102-107 de `RepositoryEditorWorker.java`).

---

## 4. Étape 2 — Récupérer les coordonnées de la source

L'éditeur fournit 3 informations :

1. **URL du manifest** : `https://admin.thesocle.net/repository/manifest.json`
2. **URL de la signature** : `https://admin.thesocle.net/repository/manifest.json.sig`
3. **URL de la clé publique** : `https://admin.thesocle.net/repository/publickey.pem`

(Optionnellement, la `registry_url` si l'éditeur a un registry Docker associé : `https://repository.thesocle.net`)

Récupérer la clé publique manuellement (TOFU — première fois, vérifier hors-bande !) :

```bash
curl -s https://admin.thesocle.net/repository/publickey.pem
```

Sortie :

```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
-----END PUBLIC KEY-----
```

**Bonne pratique TOFU** : confirmer ce fingerprint via un canal indépendant (téléphone, mail signé, page web statique de l'éditeur). C'est la défense unique contre un MITM lors de la première connexion.

```bash
# Calculer le fingerprint local
curl -s https://admin.thesocle.net/repository/publickey.pem \
  | openssl pkey -pubin -outform DER \
  | sha256sum | head -c 32
# 4a8c2f1e9b6d3a5e7c1f8b2d4a6e9c0f
```

Comparer avec celui annoncé par l'éditeur (qui s'affiche dans son `/hub/repository/admin` :

```bash
curl -s -X POST http://admin.thesocle.net/api/actions/repository_editor_worker/get_status \
  -d '{}' | jq .data.publicKeyFingerprint
# "sha256:4a8c2f1e9b6d3a5e..."
```

Si match → ajouter la source.

---

## 5. Étape 3 — Ajouter la source via le portail (méthode recommandée)

Naviguer vers `https://<votre-hub>/hub/repository/sources` :

```
[Form: Ajouter une source]

Nom :              TheSocle officiel
URL manifest :     https://admin.thesocle.net/repository/manifest.json
URL signature :    (auto = manifest.json.sig)
URL publickey :    (auto = remplace /manifest.json par /publickey.pem)
URL registry :     https://repository.thesocle.net
Tags :             thesocle, official, office
Couleur :          #6366f1
Priorité :         70

[Bouton "Ajouter"]
```

Le contrôleur `PortalRepositoryController.createSource` (cf. ligne 167-202) insère :

```sql
INSERT INTO apps.repository_sources
(name, manifest_url, signature_url, publickey_url, registry_url,
 enabled, priority, tags, color, auth_vault_path)
VALUES (?, ?, ?, ?, ?, true, ?, ?, ?,
        'soclehub/repository/sources/' || lower(name_normalized));
```

Le `auth_vault_path` est créé même si pas d'auth nécessaire — il est utilisé plus tard si on souhaite ajouter des credentials registry pour pull les images privées.

---

## 6. Étape 4 — Ajouter la source via SQL (méthode batch / scripted)

Pour automatiser via Ansible / CI :

```sql
-- Sur le Hub client
INSERT INTO apps.repository_sources (
  x_dateCreated,
  name,
  manifest_url,
  signature_url,
  publickey_url,
  registry_url,
  public_key_pem,
  enabled,
  priority,
  tags,
  color,
  auth_vault_path
) VALUES (
  NOW(),
  'TheSocle officiel',
  'https://admin.thesocle.net/repository/manifest.json',
  'https://admin.thesocle.net/repository/manifest.json.sig',
  'https://admin.thesocle.net/repository/publickey.pem',
  'https://repository.thesocle.net',
  '-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
-----END PUBLIC KEY-----',
  true,
  70,
  ARRAY['thesocle', 'official', 'office'],
  '#6366f1',
  'soclehub/repository/sources/thesocle-officiel'
);
```

**Important** : la colonne `public_key_pem` doit contenir le PEM avec ses headers `BEGIN/END PUBLIC KEY`. C'est cette valeur qui est utilisée par `CatalogSyncWorker.verifyEd25519` (ligne 214-226). Si on la copie depuis `curl` sans préserver les sauts de ligne, la vérification échoue.

---

## 7. Étape 5 — Configurer les credentials registry (optionnel)

Si la source publie des images dans un registry **privé** (auth required), stocker les credentials dans Vault au path `auth_vault_path` :

```bash
SOURCE_NAME="thesocle-officiel"

curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d "{
    \"path\": \"soclehub/repository/sources/${SOURCE_NAME}\",
    \"key\": \"username\",
    \"value\": \"client-acme\"
  }"

curl -X POST http://localhost:8080/api/actions/vault_worker/set_secret \
  -H "Content-Type: application/json" \
  -d "{
    \"path\": \"soclehub/repository/sources/${SOURCE_NAME}\",
    \"key\": \"password\",
    \"value\": \"un-mot-de-passe-fort\"
  }"
```

Quand un user installe une app dont l'image vient de cette source, `AppInstallPipeline.resolveRegistryCredsForImage` lookup automatique :

```sql
SELECT auth_vault_path FROM apps.repository_sources
WHERE enabled = true AND registry_url = 'https://repository.thesocle.net' LIMIT 1;
```

Puis pull avec les credentials Vault (voir `AppInstallPipeline` ligne 883-917). Pas besoin de `docker login` manuel sur le Hub client.

---

## 8. Étape 6 — Forcer une synchronisation immédiate

Le worker tourne toutes les 6h, mais on peut forcer un sync :

### Via l'IHM portail

```
GET /hub/repository  →  bouton "Synchroniser"
ou
GET /hub/repository/sources  →  pour chaque source : bouton "Sync"
```

### Via REST

```bash
curl -X POST http://localhost:8080/api/actions/catalog_sync_worker/force_sync \
  -H "Content-Type: application/json" -d '{}'
```

Réponse :

```json
{
  "success": true,
  "data": {
    "sources_synced": 1
  }
}
```

### Logs de la sync

```bash
docker logs -f soclehub | grep catalog_sync_worker
```

```
[catalog_sync_worker] fetch source=TheSocle officiel manifest=https://admin.thesocle.net/repository/manifest.json
[catalog_sync_worker] source=TheSocle officiel synced, apps=12
[catalog_sync_worker] cycle OK — 1 source(s) syncées
```

---

## 9. Étape 7 — Comprendre le flux de validation côté worker

Référence : `/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/worker/CatalogSyncWorker.java` — voir aussi [[32-catalog-sync-worker|la fiche institutionnelle du CatalogSyncWorker]].

```java
// CatalogSyncWorker.syncSource (ligne 146-200)
private boolean syncSource(Map<String, Object> src) throws Exception {
    long sourceId = (long) src.get("x_id");
    String name = (String) src.get("name");
    String manifestUrl = (String) src.get("manifest_url");
    String signatureUrl = (String) src.get("signature_url");
    String publicKeyPem = (String) src.get("public_key_pem");

    // 1. Fetch manifest (HTTP GET)
    byte[] manifestBytes = fetch(manifestUrl);
    byte[] signatureBytes = fetch(signatureUrl);

    // 2. Vérification Ed25519
    boolean valid = verifyEd25519(manifestBytes, signatureBytes, publicKeyPem);
    if (!valid) {
        markSyncError(sourceId, "signature_invalid");
        throw new SecurityException("Signature Ed25519 invalide pour la source " + name);
    }

    // 3. Parse manifest pour metadata
    Map<String, Object> manifest = objectMapper.readValue(manifestBytes, Map.class);
    String expiresStr = (String) manifest.get("manifestExpiresAt");
    int appCount = ((List<?>) manifest.get("apps")).size();

    // 4. UPSERT cache (PostgreSQL ON CONFLICT)
    INSERT INTO apps.repository_catalog_caches
        (source_id, manifest_json, signature_b64, signature_valid, cached_at, manifest_expires_at, app_count)
    VALUES (?, ?::jsonb, ?, true, NOW(), ?, ?)
    ON CONFLICT (source_id) DO UPDATE SET ...

    // 5. Update last_sync_at + status
    markSyncOk(sourceId);
    return true;
}
```

L'algorithme `verifyEd25519` :

```java
private boolean verifyEd25519(byte[] data, byte[] signature, String publicKeyPem) throws Exception {
    String pemBody = publicKeyPem
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replaceAll("\\s", "");
    byte[] keyBytes = Base64.getDecoder().decode(pemBody);
    KeyFactory kf = KeyFactory.getInstance("Ed25519");
    PublicKey pub = kf.generatePublic(new X509EncodedKeySpec(keyBytes));
    Signature sig = Signature.getInstance("Ed25519");
    sig.initVerify(pub);
    sig.update(data);
    return sig.verify(signature);
}
```

Si `verify` retourne false → exception → le manifest n'est PAS stocké en cache, l'ancien cache reste actif (fail-safe — si l'éditeur subit un défaut de signature, le client reste sur le dernier manifest valide).

---

## 10. Étape 8 — Catalogage par tags + couleurs

Pour un Hub qui consomme plusieurs sources (TheSocle officiel + un partenaire métier + une source dev), le portail affiche chaque app avec un badge couleur correspondant à sa source. Les tags permettent un filtrage UI :

```
GET /hub/apps/install?source=thesocle-officiel
GET /hub/apps/install?tag=office
GET /hub/apps/install?q=wordpress
```

Implémentation : `PortalDashboardController.appsInstall` (ligne 341-450) merge `localCatalog` (badge gris "Catalog local") + `externalApps` chargées depuis `apps.repository_catalog_caches`. Chaque app reçoit `_sourceId`, `_sourceName`, `_sourceColor`, `_sourceTags`. Le filtre côté Java applique les params `source`, `tag`, `q`.

Mettre à jour les tags d'une source existante :

```sql
UPDATE apps.repository_sources
SET tags = ARRAY['thesocle', 'official', 'office', 'production'],
    color = '#10b981',
    x_dateUpdated = NOW()
WHERE name = 'TheSocle officiel';
```

---

## 11. Validation

### Vérifier que la source est bien synchronisée

```bash
curl -s -X POST http://localhost:8080/api/actions/catalog_sync_worker/get_sources \
  -H "Content-Type: application/json" -d '{}' | jq
```

Réponse :

```json
{
  "data": {
    "sources": [
      {
        "x_id": 1,
        "name": "TheSocle officiel",
        "manifest_url": "https://admin.thesocle.net/repository/manifest.json",
        "registry_url": "https://repository.thesocle.net",
        "enabled": true,
        "priority": 70,
        "last_sync_at": "2026-04-28 10:23:45",
        "last_sync_status": "ok",
        "last_sync_error": null
      }
    ],
    "count": 1
  }
}
```

### Vérifier le cache

```sql
SELECT
  s.name,
  c.app_count,
  c.signature_valid,
  c.cached_at,
  c.manifest_expires_at
FROM apps.repository_catalog_caches c
JOIN apps.repository_sources s ON s.x_id = c.source_id
ORDER BY c.cached_at DESC;
```

Sortie attendue :

```
TheSocle officiel | 12 | true | 2026-04-28 10:23:45 | 2026-04-30 10:23:45
```

### Vérifier que les apps apparaissent dans le catalog agrégé

```bash
curl -s http://localhost:8080/hub/repository/catalog.json | jq '.apps[] | {appId, _source}'
```

```json
{"appId": "office-suite", "_source": "TheSocle officiel"}
{"appId": "socle-dashboard", "_source": "TheSocle officiel"}
```

### Vérifier dans l'IHM install

```
Browser ──→ https://<votre-hub>/hub/apps/install
         ←── Liste des apps avec badge "TheSocle officiel" (couleur #6366f1)
```

### Stats du worker

```bash
curl -s -X POST http://localhost:8080/api/actions/catalog_sync_worker/get_status \
  -d '{}' | jq
```

```json
{
  "data": {
    "healthy": true,
    "cyclesTotal": 4,
    "cyclesOk": 4,
    "cyclesFailed": 0,
    "lastCycleAt": "2026-04-28T10:23:45Z"
  }
}
```

---

## 12. Pièges courants

### Piège 1 — `signature_invalid` au premier sync

**Symptôme** : `last_sync_status = error`, `last_sync_error = signature_invalid`. Aucune app dans le cache.

**Cause** : la clé publique stockée dans `public_key_pem` ne match pas la clé qui a signé le manifest. Causes possibles : copy-paste avec ajout de saut de ligne CRLF, clé d'un autre éditeur, clé rotée côté éditeur sans propagation.

**Résolution** :

```bash
# 1. Récupérer la clé courante de l'éditeur
curl -s https://admin.thesocle.net/repository/publickey.pem > /tmp/pubkey.pem
cat /tmp/pubkey.pem

# 2. Mettre à jour
docker exec -it soclehub-postgres psql -U socle_prod -d socle_prod
> UPDATE apps.repository_sources SET public_key_pem = E'-----BEGIN PUBLIC KEY-----\nMCowBQYD...\n-----END PUBLIC KEY-----\n' WHERE name = 'TheSocle officiel';

# 3. Relancer
curl -X POST http://localhost:8080/api/actions/catalog_sync_worker/force_sync -d '{}'
```

### Piège 2 — `HTTP 404 pour ...manifest.json`

**Symptôme** : `last_sync_error = sync_error: HTTP 404 pour https://...`.

**Cause** : URL manifest erronée (typo dans le sous-domaine, slash final manquant), ou éditeur qui n'a jamais publié de manifest (`/app/data/repository/manifest.json` n'existe pas côté éditeur).

**Résolution** : vérifier l'URL manuellement :

```bash
curl -I https://admin.thesocle.net/repository/manifest.json
# Attendu : HTTP/2 200, Content-Type: application/json
```

Si 404, contacter l'éditeur pour qu'il regénère son manifest (`POST /api/actions/repository_editor_worker/regenerate_manifest`).

### Piège 3 — `connect timeout` pendant fetch

**Symptôme** : `last_sync_error = sync_error: connect timeout`.

**Cause** : firewall sortant bloque, ou DNS du Hub client ne résout pas le FQDN éditeur, ou éditeur down.

**Résolution** :

```bash
# Sur le Hub client
docker exec soclehub curl -v https://admin.thesocle.net/repository/manifest.json
# Si "Could not resolve host" → fix DNS
# Si "Connection refused" → fix firewall
```

### Piège 4 — Source enabled mais aucune app dans `/hub/apps/install`

**Symptôme** : `apps.repository_sources.enabled = true`, mais le wizard d'install ne montre rien de cette source.

**Cause** : le cache est vide (aucun sync réussi) ou `signature_valid = false`. Le portail filtre `WHERE s.enabled = true AND c.signature_valid = true`.

**Résolution** :

```sql
SELECT s.name, c.signature_valid, s.last_sync_status, s.last_sync_error
FROM apps.repository_sources s
LEFT JOIN apps.repository_catalog_caches c ON c.source_id = s.x_id;
-- Si signature_valid = false → résoudre le piège 1
-- Si pas de ligne de cache → résoudre le piège 2 ou 3
```

### Piège 5 — `Public key not found` au démarrage

**Symptôme** : log `KeyFactory could not generate public key from PEM`.

**Cause** : la clé publique a un format inattendu (PKCS1 au lieu de X509, ou DER non base64).

**Résolution** : convertir en X509 PEM :

```bash
# Si vous avez du PKCS1
openssl pkey -in old-key.pem -pubin -pubout -out x509-key.pem
```

Le code attend strictement le format `-----BEGIN PUBLIC KEY-----` + base64 + `-----END PUBLIC KEY-----` (X509).

### Piège 6 — Duplication d'apps après ajout d'une 2e source

**Symptôme** : la même app `wordpress` apparait deux fois dans le wizard avec deux badges différents.

**Cause** : c'est attendu — chaque source a son propre catalogue, et une app peut exister dans plusieurs sources avec des configurations différentes.

**Résolution** : utiliser le filtre `?source=X` dans le wizard pour ne voir qu'une source à la fois. Ou désactiver la source dupliquée (`UPDATE apps.repository_sources SET enabled = false WHERE name = ?`).

### Piège 7 — Cache stale après désactivation d'une source

**Symptôme** : on a fait `enabled = false` mais les apps de cette source apparaissent encore.

**Cause** : le cache `repository_catalog_caches` reste, et le portail joint sur `enabled = true` — donc en théorie c'est filtré. Si vous voyez encore les apps, c'est un cache navigateur.

**Résolution** : clear cache navigateur ou hard refresh `Ctrl+Shift+R`. Pour purger le cache catalog :

```sql
DELETE FROM apps.repository_catalog_caches
WHERE source_id IN (SELECT x_id FROM apps.repository_sources WHERE enabled = false);
```

### Piège 8 — Manifest expiré (`manifestExpiresAt` dans le passé)

**Symptôme** : warning sur le portail, sync OK mais manifeste avec date d'expiration dépassée.

**Cause** : l'éditeur n'a pas regénéré son manifest depuis > 48h. Le scope v1 est non bloquant mais l'UI peut afficher un avertissement.

**Résolution** : contacter l'éditeur pour qu'il fasse `regenerate_manifest`. Côté client, on peut aussi forcer un sync manuel.

### Piège 9 — Pull image privée échoue (registry auth)

**Symptôme** : à l'install d'une app de la source, le pipeline log `Pull with auth — registry=...` mais le pull échoue avec 401.

**Cause** : `auth_vault_path` non rempli ou credentials Vault invalides.

**Résolution** :

```bash
# Vérifier l'auth_vault_path
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "SELECT name, auth_vault_path, registry_url FROM apps.repository_sources;"

# Vérifier les secrets
curl -X POST http://localhost:8080/api/actions/vault_worker/get_secret_keys \
  -d '{"path": "soclehub/repository/sources/thesocle-officiel"}'

# Si vide → set_secret (cf. §7)
```

### Piège 10 — Suppression d'une source ne supprime pas les apps installées

**Symptôme** : on a fait `DELETE FROM apps.repository_sources` mais des apps installées depuis cette source tournent encore.

**Cause** : c'est volontaire — supprimer une source ne désinstalle pas les apps. La source ne sert qu'à la **découverte** de nouvelles versions. Une fois installée, l'app vit indépendamment.

**Résolution** : pour désinstaller les apps de la source, énumérer puis appeler `uninstall_app` :

```bash
# Lister les apps qui viennent de cette source (par catalog_app_id ou par convention)
curl -X POST http://localhost:8080/api/actions/docker/list_apps -d '{}' \
  | jq '.data.apps[] | select(.catalog_app_id == "office-suite") | .app_id'

# Pour chacune
curl -X POST http://localhost:8080/api/actions/docker/uninstall_app \
  -d '{"app_id": "office-acme", "purge": false}'
```

---

## 13. Pour aller plus loin

- Voir [[32-catalog-sync-worker]] pour la référence complète du `CatalogSyncWorker` (sync, vérification Ed25519, cache),
- Voir [[33-repository-editor-worker]] pour comprendre comment l'éditeur signe et publie les manifests,
- Voir [[31-app-registry-worker]] pour le format `CatalogApp` agrégé côté Hub,
- Voir [[11-vault-worker]] pour le stockage des credentials registry au path `auth_vault_path`,
- Voir `howto-06-publier-une-app-editeur.md` pour le côté éditeur (publier vers ce manifest),
- Voir `howto-03-installer-une-app.md` pour installer une app depuis le catalogue agrégé.
