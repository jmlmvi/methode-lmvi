# HOWTO 26 — Publier une app TheFront signée Ed25519

> **Niveau** : avancé | **Cible** : SocleHub Hub 3.12.1 | **Endpoints vérifiés** : `TheFrontAppsController` (`/api/apps`), `TheFrontPublisherKeysController` (`/api/publishers`), `TheFrontScriptHashesController` (`/api/script-hashes`)

**Audience** : développeur côté éditeur (publisher) qui doit publier une app dans le catalogue TheFront du Hub. Aussi utile à un opérateur Hub pour valider qu'un manifest entrant est correct.

**Préalable** : avoir un compte avec scope `apps:publish` sur le tenant cible. Avoir lu [[90-thefront-overview|TheFront — overview]] et [[91-thefront-manifest-ed25519|TheFront — manifest Ed25519]].

---

## Vue d'ensemble du workflow

```
1. Générer un keypair Ed25519 (côté éditeur, hors Hub)
2. Enregistrer la clé publique dans le Hub (POST /api/publishers/{id}/keys)
3. Construire le manifest JSON de l'app
4. Signer le manifest avec la clé privée (RFC 8032)
5. POSTer le manifest signé (POST /api/apps/{appId}/manifest/publish)
6. Vérifier la publication
```

---

## Étape 1 — Générer un keypair Ed25519

Côté éditeur, **dans un environnement sécurisé** (pas le Hub) :

```bash
# Génère privkey.pem (clé privée) et pubkey.raw (32 octets bruts)
openssl genpkey -algorithm Ed25519 -out privkey.pem

# Extrait la clé publique au format raw (32 octets)
openssl pkey -in privkey.pem -pubout -outform DER | tail -c 32 > pubkey.raw

# Encode la clé publique en base64 (format attendu par TheFront)
PUBKEY_B64=$(base64 -w0 < pubkey.raw)
echo "Public key (base64) : $PUBKEY_B64"
```

**Gardez `privkey.pem` secret**. Elle ne doit jamais quitter votre environnement éditeur.

---

## Étape 2 — Enregistrer la clé publique dans le Hub

```bash
JWT="eyJhbGc..."           # Bearer JWT avec scope publishers:manage
PUBLISHER_ID="editorx"      # votre identifiant éditeur
KEY_ID="editorx-2026-05"    # identifiant unique de cette clé (pour la rotation future)

curl -sk -X POST "https://admin.thesocle.net/api/publishers/$PUBLISHER_ID/keys" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d "{
       \"key_id\":    \"$KEY_ID\",
       \"alg\":       \"Ed25519\",
       \"public_key\": \"$PUBKEY_B64\"
     }" | jq .
```

Réponse attendue (201 ou 200) :

```json
{
  "key_id":    "editorx-2026-05",
  "alg":       "Ed25519",
  "public_key": "...",
  "status":    "active",
  "added_at":  "2026-05-14T08:00:00Z",
  "rotation_grace_until": null
}
```

Lister les clés actives pour vérifier :

```bash
curl -sk "https://admin.thesocle.net/api/publishers/$PUBLISHER_ID/keys" \
     -H "Authorization: Bearer $JWT" | jq .
```

---

## Étape 3 — Construire le manifest JSON

Exemple de `manifest.json` minimaliste :

```json
{
  "appId":       "my-cool-app",
  "appVersion":  "1.0.0",
  "name":        "My Cool App",
  "publisher":   "editorx",
  "description": "Une app qui fait des trucs cool",
  "entryPoint":  "https://cdn.example.com/my-cool-app/index.html",
  "scripts": [
    {
      "url":  "https://cdn.example.com/my-cool-app/app.js",
      "hash": "3a7bd3e2360a3d8e9f3f1d5b2c8b8d6c3a7bd3e2360a3d8e9f3f1d5b2c8b8d6c"
    }
  ],
  "capabilities": [
    { "name": "read_documents", "description": "Lit les documents" }
  ]
}
```

**Important** : le manifest doit être **canonicalisé** avant signature (JSON sans whitespace, ordre des clés déterministe). Recommandation : utiliser une lib qui produit une JSON canonical form (RFC 8785) pour garantir que le serveur reconstitue exactement le même bytestream.

Calcul du hash SHA-256 (informatif — c'est le serveur qui le recalculera) :

```bash
sha256sum manifest.json
# ex. 9f8e2a30b4c5d6e7f8a9b0c1d2e3f4a5...
```

---

## Étape 4 — Signer le manifest avec la clé privée

```bash
# Signer le manifest canonicalisé
SIGNATURE_B64=$(openssl pkeyutl -sign -inkey privkey.pem -rawin -in manifest.json | base64 -w0)
echo "Signature : $SIGNATURE_B64"
```

`openssl pkeyutl -sign -rawin` utilise Ed25519 sans pré-hashing (mode `Ed25519` pur, conforme RFC 8032).

Pour vérifier localement avant d'envoyer :

```bash
openssl pkeyutl -verify -pubin -inkey <(openssl pkey -in privkey.pem -pubout) \
                -rawin -in manifest.json -sigfile <(echo -n "$SIGNATURE_B64" | base64 -d)
# → "Signature Verified Successfully"
```

---

## Étape 5 — POSTer le manifest signé au Hub

```bash
APP_ID="my-cool-app"

curl -sk -X POST "https://admin.thesocle.net/api/apps/$APP_ID/manifest/publish" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d "{
       \"manifest\":  $(cat manifest.json),
       \"signature\": \"$SIGNATURE_B64\",
       \"key_id\":    \"$KEY_ID\"
     }" | jq .
```

Réponse succès (200) :

```json
{
  "app_id":         "my-cool-app",
  "app_version":    "1.0.0",
  "manifest_hash":  "9f8e2a30b4c5d6e7...",
  "key_id":         "editorx-2026-05",
  "published_at":   "2026-05-14T08:05:00Z",
  "users_granted":  42
}
```

Le Hub a :
- Vérifié la signature Ed25519 (sinon 409 `conflict` avec `code: invalid_signature`).
- Calculé le hash SHA-256 du manifest.
- INSERT dans 5 tables : `z_thefront_known_manifest_versions`, `z_thefront_app_versions`, `z_thefront_app_publications`, `z_thefront_known_script_hashes` (pour chaque hash de script), `z_thefront_manifest_publications` (audit).
- Auto-grant tous les users du tenant (entrée `z_thefront_app_users_grants` avec `group_id="*"`).
- Émis un event audit dans `z_thefront_audit_events`.

---

## Étape 6 — Vérifier la publication

```bash
# Récupérer le manifest publié
curl -sk "https://admin.thesocle.net/api/apps/$APP_ID/manifest" \
     -H "Authorization: Bearer $JWT" | jq .

# Vérifier qu'un hash de script est connu
SCRIPT_HASH="3a7bd3e2360a3d8e9f3f1d5b2c8b8d6c3a7bd3e2360a3d8e9f3f1d5b2c8b8d6c"
curl -sk "https://admin.thesocle.net/api/script-hashes/$SCRIPT_HASH" \
     -H "Authorization: Bearer $JWT" | jq .
# → {"hash":"...","status":"known","revoked_at":null}
```

Côté DB (debug admin) :

```sql
-- Dernière version publiée
SELECT app_version, manifest_hash, published_at
FROM thefront.z_thefront_app_versions
WHERE app_id = 'my-cool-app'
ORDER BY published_at DESC LIMIT 1;

-- Audit
SELECT event_type, occurred_at, payload->>'manifest_hash'
FROM thefront.z_thefront_audit_events
WHERE app_id = 'my-cool-app'
ORDER BY occurred_at DESC LIMIT 5;
```

---

## Mettre à jour le manifest (nouvelle version)

Refaire les étapes 3 → 5 avec un nouveau `appVersion`. Le hash sera différent. Le nouveau devient la version courante. L'ancien reste accessible via `/api/apps/{id}/manifest?version=X.Y.Z` (lookup explicite).

---

## Révoquer un manifest publié

Si une faille ou un bug bloquant est trouvé :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/apps/$APP_ID/revoke" \
     -H "Authorization: Bearer $JWT" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{
       "reason": "security: XSS in app.js"
     }' | jq .
```

Le statut du manifest passe à `revoked`. Les clients TheFront refuseront de charger l'app.

---

## Pièges courants

1. **Manifest non canonicalisé** : si vous signez `manifest.json` avec un parser qui réordonne les clés ou ajoute des espaces, le serveur ne reconstituera pas le même bytestream → vérification Ed25519 échoue avec **409 `invalid_signature`**. Utiliser une lib RFC 8785 ou s'assurer que la sérialisation JSON est strictement déterministe entre client et serveur.

2. **Clé publique en format X.509 plutôt que raw** : TheFront attend les 32 octets bruts encodés base64, **pas** la clé au format SPKI/PEM complet. Si vous avez une clé au format PEM, extrayez les 32 derniers octets de la DER comme dans l'étape 1.

3. **Algorithme `Ed25519` non précisé** : `alg` doit valoir exactement `"Ed25519"` (D-TF-IMPL-04 / DEC-031 validation LMVI). Autres valeurs (`EdDSA`, `ed25519`) → 422 `unprocessable`.

4. **Idempotency-Key réutilisée pour un manifest différent** : 409 `conflict`. Toujours générer un nouveau UUID v4 par requête mutante.

5. **Rotation publisher key oubliée** : si vous changez la clé sans démarrer la rotation 90 j (`DEL /api/publishers/{id}/keys/{keyId}`), les anciens manifests signés deviennent invalides instantanément. Toujours démarrer la rotation **avant** de générer un nouveau keypair.

6. **`Idempotency-Key` absent** sur un POST/PUT TheFront mutant : non bloquant (le call passe), mais si l'appel échoue côté réseau et que vous retentez, vous risquez de créer un doublon (publication double avec deux hashes différents). Toujours envoyer `Idempotency-Key`.

7. **Scope `apps:publish` manquant** : 403 `forbidden`. Vérifier le scope du JWT via `GET /iam/me` ou demander à l'admin tenant de l'attribuer.

8. **Hash de script absent** dans `scripts[].hash` : le manifest est accepté mais les clients TheFront refuseront de charger ce script (`/api/script-hashes/<hash>` retournera 404). Toujours calculer le SHA-256 de chaque script avant publication.

---

## Pour aller plus loin

- **Architecture Ed25519** : [[91-thefront-manifest-ed25519|TheFront — manifest Ed25519]]
- **TheFront overview** : [[90-thefront-overview|TheFront — overview]]
- **Isolation tenant (RLS)** : [[92-thefront-tenant-rls|TheFront — tenant RLS]]
- **Audit & idempotency** : [[93-thefront-audit-idempotency|TheFront — audit & idempotency]]
- **Rotation 90 jours** : [HOWTO 29 — Rotation publisher keys TheFront](howto-29-rotation-publisher-keys-thefront.md)
- **Décisions D-TF-06** (JDK natif) : `soclehub/docs/UpdatePlans/V005-TheFront-Foundation/DECISIONS.md`
- **Specs API** : `/api/swagger-ui.html` sur le Hub
