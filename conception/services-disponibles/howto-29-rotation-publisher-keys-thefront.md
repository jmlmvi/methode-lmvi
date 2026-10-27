# HOWTO 29 — Rotation des publisher keys TheFront (grâce 90 jours)

> **Niveau** : avancé | **Cible** : SocleHub Hub 3.12.1 | **Vérifié** : `TheFrontPublisherKeysController` (`/api/publishers/{id}/keys`), `PublisherKeyExpiryJob` (`@Scheduled(cron = "0 0 2 * * *", zone = "UTC")`)

**Audience** : éditeur (publisher) qui doit changer sa clé de signature Ed25519 sans casser ses manifests publiés. Admin SocleHub qui supervise la rotation.

**Préalable** : avoir lu [[91-thefront-manifest-ed25519|TheFront — manifest Ed25519]] (la rotation et les publisher keys y sont décrites) et avoir publié au moins une fois (voir [HOWTO 26 — Publier une app TheFront signée Ed25519](howto-26-publier-une-app-thefront.md)).

---

## Vue d'ensemble — pourquoi la rotation

Une clé Ed25519 reste cryptographiquement solide indéfiniment, mais en pratique vous voulez la faire tourner :
- Régulièrement (tous les 6-12 mois) — bonne hygiène cryptographique.
- En cas de compromission soupçonnée — rotation **immédiate** (grace 0).
- Lors du changement d'équipe — un nouvel éditeur ne devrait pas hériter de l'ancienne clé.

TheFront gère deux modes de rotation :
- **Avec grâce** (recommandé, défaut 90 j) : pendant 90 jours, l'ancienne et la nouvelle clé sont **toutes deux valides**. Les manifests signés par l'ancienne continuent d'être vérifiés.
- **Immédiate** (`grace_days: 0`) : l'ancienne clé est révoquée sur-le-champ. Tous les manifests signés par elle deviennent invalides.

---

## Workflow standard (rotation planifiée avec grâce)

```
1. Démarrer la rotation de l'ancienne clé (grace 90j)
2. Générer un nouveau keypair
3. Enregistrer la nouvelle clé publique côté Hub
4. Publier les nouveaux manifests avec la nouvelle clé
5. Attendre la fin de la période de grâce
6. PublisherKeyExpiryJob révoque automatiquement l'ancienne (cron 02:00 UTC)
```

---

## Étape 1 — Démarrer la rotation de l'ancienne clé

Indique au Hub que l'ancienne clé doit être révoquée dans 90 jours :

```bash
JWT="..."
PUBLISHER_ID="editorx"
OLD_KEY_ID="editorx-2025-12"

curl -sk -X DELETE "https://admin.thesocle.net/api/publishers/$PUBLISHER_ID/keys/$OLD_KEY_ID" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{
       "grace_days": 90,
       "reason":     "scheduled rotation Q2 2026"
     }'
```

Réponse :

```json
{
  "publisher":            "editorx",
  "key_id":               "editorx-2025-12",
  "status":               "active",
  "rotation_grace_until": "2026-08-12T08:00:00Z",
  "reason":               "scheduled rotation Q2 2026"
}
```

L'ancienne clé est **toujours active** — elle reste dans la liste retournée par `GET /api/publishers/{id}/keys` jusqu'à expiration. Les manifests qu'elle signe continuent d'être vérifiés OK.

---

## Étape 2 — Générer un nouveau keypair (côté éditeur)

```bash
# Hors Hub, environnement sécurisé
openssl genpkey -algorithm Ed25519 -out privkey-2026-05.pem
openssl pkey -in privkey-2026-05.pem -pubout -outform DER | tail -c 32 > pubkey-2026-05.raw
NEW_PUBKEY_B64=$(base64 -w0 < pubkey-2026-05.raw)
```

**Garder `privkey-2026-05.pem` en sécurité maximale.** Sauvegarder, accès strict.

---

## Étape 3 — Enregistrer la nouvelle clé publique dans le Hub

```bash
NEW_KEY_ID="editorx-2026-05"

curl -sk -X POST "https://admin.thesocle.net/api/publishers/$PUBLISHER_ID/keys" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d "{
       \"key_id\":     \"$NEW_KEY_ID\",
       \"alg\":        \"Ed25519\",
       \"public_key\": \"$NEW_PUBKEY_B64\"
     }"
```

À ce stade, **les deux clés sont actives** :

```bash
curl -sk "https://admin.thesocle.net/api/publishers/$PUBLISHER_ID/keys" \
     -H "Authorization: Bearer $JWT" | jq .
```

```json
[
  {
    "key_id": "editorx-2025-12",
    "status": "active",
    "rotation_grace_until": "2026-08-12T08:00:00Z"
  },
  {
    "key_id": "editorx-2026-05",
    "status": "active",
    "rotation_grace_until": null
  }
]
```

---

## Étape 4 — Publier les nouveaux manifests avec la nouvelle clé

Tous les nouveaux manifests doivent être signés avec `privkey-2026-05.pem` et indiquer `key_id: "editorx-2026-05"` dans la requête publish. Voir [HOWTO 26 — Publier une app TheFront](howto-26-publier-une-app-thefront.md) pour les détails.

**Important** : les manifests **déjà publiés** signés par `editorx-2025-12` restent valides. Le serveur les sert tel quels (`GET /api/apps/{id}/manifest` retourne le manifest + signature + key_id original). Le client TheFront vérifie la signature avec la clé indiquée par `key_id`, qui reste dans la liste des clés actives jusqu'au 2026-08-12.

---

## Étape 5 — Attendre la fin de la période de grâce

Pendant 90 jours, aucune action requise. Optionnellement, suivre l'évolution :

```sql
-- Clés en grâce, à révoquer prochainement
SELECT publisher_id, key_id, rotation_grace_until,
       (rotation_grace_until - now()) AS time_left
FROM thefront.z_thefront_publisher_keys
WHERE status = 'active' AND rotation_grace_until IS NOT NULL
ORDER BY rotation_grace_until ASC;
```

---

## Étape 6 — Révocation automatique par `PublisherKeyExpiryJob`

Le job `PublisherKeyExpiryJob` (`@Scheduled(cron = "0 0 2 * * *")`) tourne tous les jours à 02:00 UTC. Le 2026-08-13 à 02:00 UTC (lendemain de l'expiration), il exécute :

```sql
UPDATE thefront.z_thefront_publisher_keys
SET status         = 'revoked',
    revoked_at     = now(),
    revoked_reason = 'rotation_grace_expired'
WHERE status = 'active'
  AND rotation_grace_until < now();
```

À partir de là, tout manifest signé par `editorx-2025-12` est rejeté à la vérification avec **409 `invalid_signature`** (la clé n'apparaît plus dans `listActiveKeys`).

Logs SocleHub à surveiller (par exemple via `docker_worker.get_logs(appId="soclehub")`) :

```
PublisherKeyExpiryJob: revoked 1 key(s) (publisher=editorx, key_id=editorx-2025-12)
```

---

## Cas spécial — rotation immédiate (clé compromise)

Si vous suspectez que votre clé privée a été compromise (fuite, accès non autorisé) :

```bash
curl -sk -X DELETE "https://admin.thesocle.net/api/publishers/$PUBLISHER_ID/keys/$OLD_KEY_ID" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{
       "grace_days": 0,
       "reason":     "COMPROMISED — immediate revoke 2026-05-14"
     }'
```

Réponse :

```json
{
  "publisher":            "editorx",
  "key_id":               "editorx-2025-12",
  "status":               "revoked",
  "revoked_at":           "2026-05-14T10:15:00Z",
  "rotation_grace_until": null,
  "reason":               "COMPROMISED — immediate revoke 2026-05-14"
}
```

**Conséquence immédiate** : **tous** les manifests signés par cette clé sont invalidés. Les clients TheFront refuseront de charger les apps concernées jusqu'à ce que vous republiez avec une nouvelle clé.

**Plan d'action immédiat** :
1. Faire la rotation immédiate (`grace_days: 0`).
2. Générer un nouveau keypair (étape 2).
3. Enregistrer la nouvelle clé (étape 3).
4. **Republier tous les manifests actifs** avec la nouvelle clé, par ordre de criticité.
5. Notifier les utilisateurs (les apps ne chargeront pas tant que les manifests ne sont pas republiés).

---

## Vérifier le statut courant des clés

```bash
# Toutes les clés (active + revoked) d'un publisher
curl -sk "https://admin.thesocle.net/api/publishers/$PUBLISHER_ID/keys?include_revoked=true" \
     -H "Authorization: Bearer $JWT" | jq .
```

Côté DB :

```sql
SELECT key_id, status, added_at, revoked_at, revoked_reason, rotation_grace_until
FROM thefront.z_thefront_publisher_keys
WHERE publisher_id = 'editorx'
ORDER BY added_at DESC;
```

---

## Pièges courants

1. **Oubli de la rotation 90 j** : si vous générez directement une nouvelle clé et abandonnez l'ancienne sans démarrer la rotation, **les manifests existants signés par l'ancienne continuent d'être vérifiés OK** (la clé reste `active` indéfiniment). Vous accumulez des clés zombies. Toujours démarrer la rotation explicitement.

2. **`grace_days: 0` par erreur** : un appel `DELETE` sans body envoie potentiellement `grace_days: 0` selon implémentation. Toujours envoyer un body JSON explicite avec `grace_days` désiré.

3. **Republier avec l'ancien `key_id`** : si vous indiquez `key_id: "editorx-2025-12"` dans le body de `publish` alors que cette clé est en grâce ou révoquée, le serveur recherche d'abord si elle est `active` (incluant grâce) :
   - En grâce : vérification OK, mais c'est un anti-pattern (vous prolongez l'usage de l'ancienne clé).
   - Révoquée : 409 `invalid_signature`.

4. **Cron pas exécuté à l'heure** : si `PublisherKeyExpiryJob` est désactivé (ex. `@Scheduled` cassé, hook gov, container redémarré récemment), les clés en grâce ne sont pas révoquées automatiquement. Vérifier :
   ```bash
   # Logs SocleHub pour le job
   curl -sk -X POST "https://admin.thesocle.net/api/actions/docker_worker/get_logs" \
        -H "Authorization: Bearer $JWT" \
        -d '{ "app_id": "soclehub", "lines": 200 }' | jq -r '.logs' | grep PublisherKeyExpiry
   ```

5. **PG `BYPASSRLS` perdu** : le job utilise un rôle PG `socle_prod` configuré `BYPASSRLS` pour traiter tous les tenants. Si la config est perdue (rôle altéré), le job échoue silencieusement avec `unrecognized configuration parameter "app.current_tenant"`. Vérifier :
   ```sql
   SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'socle_prod';
   -- → doit retourner rolbypassrls = t
   ```

6. **Clé compromise sans rotation immédiate** : si vous attendez les 90 jours de grâce alors que la clé est compromise, un attaquant peut signer des manifests malveillants pendant 90 jours. Toujours `grace_days: 0` en cas de compromission.

---

## Pour aller plus loin

- **Architecture Ed25519 + grace** : [[91-thefront-manifest-ed25519|TheFront — manifest Ed25519]]
- **Préférences & layouts utilisateur (même périmètre TheFront)** : [[94-thefront-user-prefs-layouts|TheFront — user prefs & layouts]]
- **Audit & idempotency** : [[93-thefront-audit-idempotency|TheFront — audit & idempotency]]
- **HOWTO publication initiale** : [howto-26-publier-une-app-thefront.md](howto-26-publier-une-app-thefront.md)
- **TheFront overview** : [[90-thefront-overview|TheFront — overview]]
- **Spec D-TF-06** (Ed25519 JDK natif) : `soclehub/docs/UpdatePlans/V005-TheFront-Foundation/DECISIONS.md`
