# HOWTO 19 — Roter les secrets en production sans coupure

**Niveau :** Senior
**Prérequis :** SocleHub Hub 3.12.1, accès SSH au serveur Hub, `VAULT_TOKEN` root, accès console Cloudflare, accès SendGrid (ou fournisseur SMTP), connaissance du [[11-vault-worker|VaultWorker]]
**Temps estimé :** 30 min (rotation simple, ex. MAIL_PASSWORD) à 2 h (rotation JWT keypair avec re-login utilisateurs)

---

## 1. Contexte

Le Hub SocleHub V005 (Hub 3.12.1) conserve plusieurs catégories de secrets — pilotées via le [[11-vault-worker|`VaultWorker`]] (KV v2 HashiCorp Vault) — dont la rotation périodique est imposée par la politique de sécurité (90 j pour les API keys, 180 j pour les passwords admin, 12 mois pour le keypair JWT). Une rotation mal exécutée provoque soit un incident utilisateur (déconnexions massives), soit une indisponibilité d'une intégration tierce (mail bloqué, certificats non renouvelés, DNS Cloudflare gelé). Ce HOWTO décrit la procédure exacte pour chaque catégorie de secret, l'ordre des opérations, et les vérifications post-rotation.

Le Hub doit pouvoir :

- Roter `VAULT_TOKEN`, `BCrypt admin password`, `MCP_API_KEY`, `JWT_KEYPAIR`, `MAIL_PASSWORD`, `CLOUDFLARE_API_TOKEN`, secrets applicatifs (`secret/data/soclehub/<app>/...`) sans interruption durable.
- Préserver les sessions utilisateurs si possible (ou prévenir les utilisateurs avant invalidation).
- Garder une traçabilité dans la table `iam.audit_log` et un fallback en cas d'échec de la rotation.

---

## 2. Architecture des secrets

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         SocleHub Hub (port 443)                          │
│                                                                          │
│  ┌─────────────────────────┐         ┌────────────────────────────────┐  │
│  │ docker/.env (lu au boot)│         │ HashiCorp Vault (KV v2)        │  │
│  │  VAULT_TOKEN            │ token ─►│  /v1/secret/data/soclehub/...  │  │
│  │  CLOUDFLARE_API_TOKEN   │         │   ├─ iam/jwt   (keypair RSA)   │  │
│  │  MAIL_PASSWORD          │         │   ├─ acme/account              │  │
│  │  MCP_API_KEY            │         │   ├─ certs/<host>              │  │
│  │  POSTGRES_PASSWORD      │         │   ├─ james/users/<user>        │  │
│  │  BOOTSTRAP_ADMIN_PWD    │         │   ├─ cosmo/users/<user>        │  │
│  └─────────┬───────────────┘         │   └─ <app_id>/...              │  │
│            │                          └────────────────────────────────┘  │
│            ▼                                                              │
│  ┌─────────────────────────┐         ┌────────────────────────────────┐  │
│  │ PostgreSQL (iam schema) │         │ Filtres servlet                │  │
│  │  iam.users              │         │  ApiAuthFilter (BCrypt+SHA-256)│  │
│  │  iam.api_keys (SHA-256) │ ◄───────│  OidcMcpAuthFilter (JWT)       │  │
│  │  iam.audit_log          │         │  SsoFilter (cookie soclehub_..)│  │
│  └─────────────────────────┘         └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
       │                        │                         │
       ▼                        ▼                         ▼
  Cloudflare API         SendGrid SMTP          Let's Encrypt ACME
```

Catégories de secrets :

| Secret | Stockage | Sensibilité | Rotation | Restart Hub ? |
|---|---|---|---|---|
| `VAULT_TOKEN` | `.env` + variable d'env conteneur | Critique | 90 j | Oui |
| `JWT keypair` (RSA 2048) | Vault `soclehub/iam/jwt` | Critique | 12 mois | Non (chargé à la volée), mais re-login users |
| BCrypt admin password (`iam.users.password_hash`) | PostgreSQL | Élevée | 180 j | Non |
| API key (`iam.api_keys.key_hash` SHA-256) | PostgreSQL | Élevée | 90 j | Non |
| `MCP_API_KEY` (statique fallback) | `.env` | Moyenne | 90 j | Oui |
| `MAIL_PASSWORD` (SendGrid API key) | `.env` + Spring Mail | Moyenne | 180 j | Oui (Spring Mail config bind au boot) |
| `CLOUDFLARE_API_TOKEN` | `.env` | Élevée | 365 j | Oui |
| `POSTGRES_PASSWORD` | `.env` + container Postgres | Critique | 365 j | Oui (Hub + Postgres) |
| `ONLYOFFICE_JWT_SECRET` | `.env` + container OnlyOffice | Moyenne | 180 j | Oui |
| `JAMES_ADMIN_PASSWORD` | `.env` | Élevée | 180 j | Oui (Hub + James) |
| Secrets applicatifs (`secret/data/soclehub/<app>/...`) | Vault | Variable | Selon app | Restart container app |

---

## 3. Étape 1 — Préparer la rotation (toutes catégories)

Toujours faire une snapshot avant rotation. La snapshot doit couvrir Vault et la base.

```bash
# Sur le serveur Hub
SERVER=ubuntu@51.255.205.19
ssh $SERVER

# 1. Backup PostgreSQL (iam + apps)
docker exec soclehub-postgres pg_dump -U socle_prod -d socle_prod \
  --schema=iam --schema=apps \
  -f /tmp/iam-apps-$(date +%Y%m%d-%H%M%S).sql
docker cp soclehub-postgres:/tmp/iam-apps-*.sql ~/backups/

# 2. Backup Vault (snapshot binaire)
docker exec vault vault operator raft snapshot save /tmp/vault-snap.snap
docker cp vault:/tmp/vault-snap.snap ~/backups/vault-snap-$(date +%Y%m%d).snap

# 3. Sauvegarder le .env actuel
cp /opt/soclehub/docker/.env /opt/soclehub/docker/.env.backup-$(date +%Y%m%d)

# 4. Vérifier l'état du Hub
curl -sk https://thesocle.net/admin/health | jq .
```

**Points clés :**

- Si `pg_dump` échoue, **arrêter la procédure** immédiatement.
- La snapshot Vault inclut la totalité du KV — la conserver sur un disque chiffré séparé.
- Le `.env.backup-*` permet un rollback en 30 s.

---

## 4. Étape 2 — Roter `VAULT_TOKEN`

Le Hub lit `VAULT_TOKEN` au boot via `VaultService.init()`. Il renouvelle automatiquement le token toutes les heures via `VaultWorker` (cycle 3 600 000 ms). Roter le token implique de générer un nouveau token avec la même policy, l'injecter, puis restart le Hub.

```bash
# 1. Générer un nouveau token avec la policy soclehub
docker exec vault vault token create \
  -policy=soclehub-app \
  -ttl=8760h \
  -renewable=true \
  -format=json | jq -r '.auth.client_token' > /tmp/new-vault-token.txt

NEW_TOKEN=$(cat /tmp/new-vault-token.txt)
echo "Nouveau token : $NEW_TOKEN"

# 2. Test que le nouveau token marche
docker exec -e VAULT_TOKEN=$NEW_TOKEN vault vault kv get secret/soclehub/iam/jwt

# 3. Mettre à jour .env
sed -i "s|^VAULT_TOKEN=.*|VAULT_TOKEN=$NEW_TOKEN|" /opt/soclehub/docker/.env

# 4. Restart Hub
cd /opt/soclehub/docker
docker compose up -d soclehub

# 5. Vérifier le log de boot
docker logs soclehub --tail=200 2>&1 | grep -i "Vault connected"
# Attendu : "Vault connected at http://vault:8200 -- live mode enabled"

# 6. Révoquer l'ancien token
OLD_TOKEN="<ancien token>"
docker exec -e VAULT_TOKEN=$OLD_TOKEN vault vault token revoke -self
```

**Points clés :**

- L'ancien token doit être révoqué **après** validation que le nouveau marche, jamais avant.
- Si le Hub log `Running in STUB mode` au boot après rotation, restaurer `.env.backup-*` immédiatement.

---

## 5. Étape 3 — Roter le mot de passe BCrypt d'un compte admin

L'admin se connecte via `/hub/login` (form login Spring Security). Le hash BCrypt est stocké dans `iam.users.password_hash`. Aucun restart nécessaire — `UserDetailsService` recharge à chaque login.

```bash
# 1. Générer un nouveau hash BCrypt côté Hub
docker exec -it soclehub java -cp /app/app.jar \
  -Dloader.main=org.springframework.security.crypto.bcrypt.BCrypt \
  org.springframework.boot.loader.PropertiesLauncher \
  hashpw "MonNouveauMotDePasse2026!"

# Alternative en Python
python3 -c "import bcrypt; print(bcrypt.hashpw(b'MonNouveauMotDePasse2026!', bcrypt.gensalt()).decode())"

# 2. Mettre à jour la base
docker exec -it soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "UPDATE iam.users
     SET password_hash = '\$2a\$10\$NEW_HASH_HERE',
         updated_at = NOW()
   WHERE email = 'admin@thesocle.net';"

# 3. Test login
curl -sk -X POST https://thesocle.net/hub/login \
  -d "email=admin@thesocle.net&password=MonNouveauMotDePasse2026!" \
  -L -c /tmp/cookies.txt
grep "JSESSIONID" /tmp/cookies.txt
```

**Points clés :**

- Le préfixe `$2a$10$` (cost 10) doit être présent — sinon `BCryptPasswordEncoder` rejette.
- Pour invalider toutes les sessions : `DELETE FROM SPRING_SESSION;` (si activé) ou redémarrer Tomcat (`docker restart soclehub`).

---

## 6. Étape 4 — Roter une API key (SHA-256)

Les API keys sont en hash SHA-256 dans `iam.api_keys.key_hash`. La rotation se fait via l'action MCP `iam_worker/create_api_key` puis révocation de l'ancienne.

```bash
# 1. Créer une nouvelle API key
curl -sk -X POST https://thesocle.net/api/actions/iam_worker/create_api_key \
  -H "X-Api-Key: $CURRENT_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "ops@thesocle.net",
    "name": "ops-key-2026Q2",
    "expires_at": "2026-08-01T00:00:00Z"
  }' | jq

# Réponse :
# { "data": { "api_key": "sk-abc123...", "key_id": "uuid", "warning": "Save the api_key, it will never be shown again" } }

# 2. Mettre à jour les consommateurs (CI, scripts, etc.)
#    avec la nouvelle clé, par ex. :
echo "MCP_API_KEY=sk-abc123..." >> ~/.bashrc

# 3. Tester
curl -sk -H "X-Api-Key: sk-abc123..." https://thesocle.net/api/actions/iam_worker | jq

# 4. Révoquer l'ancienne
curl -sk -X POST https://thesocle.net/api/actions/iam_worker/revoke_api_key \
  -H "X-Api-Key: sk-abc123..." \
  -d '{ "key_id": "<UUID-de-l-ancienne-key>" }' | jq
```

**Points clés :**

- L'API key brute n'est **jamais** stockée — seulement son hash SHA-256. La perte de la clé brute est définitive.
- `revoke_api_key` met `revoked = true` mais ne supprime pas la ligne (audit).

---

## 7. Étape 5 — Roter le keypair JWT (RSA 2048)

Le keypair JWT est dans Vault à `soclehub/iam/jwt` (champs `private_key`, `public_key`, `kid`). Il signe les tokens d'access (15 min) et refresh (7 j). Roter le keypair invalide tous les tokens existants → **les utilisateurs doivent se reconnecter**.

### 7.1 Génération du nouveau keypair

```bash
# Sur une machine locale (jamais en production)
openssl genrsa -out new-jwt-private.pem 2048
openssl rsa -in new-jwt-private.pem -pubout -out new-jwt-public.pem

NEW_KID=$(date +%Y%m%d)-rotated
PRIVATE_KEY=$(cat new-jwt-private.pem)
PUBLIC_KEY=$(cat new-jwt-public.pem)
```

### 7.2 Communication aux utilisateurs (J-1)

Envoyer un mail 24 h avant la rotation, via l'action `mail_worker/send_email` :

```bash
curl -sk -X POST https://thesocle.net/api/actions/mail_worker/send_email \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "tous-les-users@thesocle.net",
    "subject": "Maintenance sécurité — reconnexion requise demain 02:00",
    "body": "Une rotation de la clé de signature JWT aura lieu demain à 02:00 UTC. Vous serez déconnecté(e) automatiquement et devrez vous reconnecter à https://thesocle.net/hub/login. Aucune donnée ne sera perdue."
  }'
```

### 7.3 Rotation effective

```bash
# 1. Écrire le nouveau keypair dans Vault
docker exec vault vault kv put secret/soclehub/iam/jwt \
  private_key="$PRIVATE_KEY" \
  public_key="$PUBLIC_KEY" \
  kid="$NEW_KID" \
  rotated_at="$(date -Iseconds)"

# 2. Restart le Hub pour que IamService recharge le keypair
cd /opt/soclehub/docker && docker compose restart soclehub

# 3. Vérifier que JWKS expose la nouvelle clé
curl -sk https://thesocle.net/iam/jwks.json | jq
# Attendu : { "keys": [ { "kid": "20260428-rotated", "kty": "RSA", ... } ] }

# 4. Forcer expiration des refresh tokens existants
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "UPDATE iam.refresh_tokens SET revoked = true WHERE revoked = false;"
```

### 7.4 Vérification

```bash
# Tenter une requête avec un ancien token → doit retourner 401
curl -sk -H "Authorization: Bearer $OLD_JWT" https://thesocle.net/api/actions/iam_worker
# Attendu : 401 Unauthorized
```

**Points clés :**

- Garder l'ancien keypair en lecture pendant 15 min (TTL access token) si l'on veut une rotation 0 downtime — non implémenté par défaut, demande un patch `IamService` pour gérer 2 `kid` simultanés.
- Communiquer **avant** la rotation, jamais après.

---

## 8. Étape 6 — Roter `MAIL_PASSWORD` (SendGrid)

```bash
# 1. Sur le dashboard SendGrid : créer une nouvelle API key, scope "Mail Send"
NEW_SG_KEY="SG.xxxxx..."

# 2. Test de la nouvelle clé en local
docker exec soclehub bash -c "
echo 'EHLO test
AUTH PLAIN $(printf '\0apikey\0$NEW_SG_KEY' | base64)
QUIT' | openssl s_client -connect smtp.sendgrid.net:587 -starttls smtp -quiet 2>&1 | head -20
"

# 3. Mettre à jour .env
sed -i "s|^MAIL_PASSWORD=.*|MAIL_PASSWORD=$NEW_SG_KEY|" /opt/soclehub/docker/.env

# 4. Restart Hub (Spring Mail bind au boot)
cd /opt/soclehub/docker && docker compose up -d soclehub

# 5. Test SMTP via action MCP
curl -sk -X POST https://thesocle.net/api/actions/mail_worker/test_smtp \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "to": "ops@thesocle.net" }'

# 6. Désactiver l'ancienne API key sur SendGrid
```

---

## 9. Étape 7 — Roter `CLOUDFLARE_API_TOKEN`

```bash
# 1. Dashboard Cloudflare → My Profile → API Tokens → Create Token
#    Permissions : Zone:DNS:Edit (zone thesocle.net), Zone:Read

NEW_CF_TOKEN="cf_xxxxx..."

# 2. Test
curl -s -H "Authorization: Bearer $NEW_CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" | jq '.success'
# Attendu : true

# 3. Mettre à jour .env et restart
sed -i "s|^CLOUDFLARE_API_TOKEN=.*|CLOUDFLARE_API_TOKEN=$NEW_CF_TOKEN|" /opt/soclehub/docker/.env
docker compose -f /opt/soclehub/docker/docker-compose.yml up -d soclehub

# 4. Vérifier que DnsSyncWorker fonctionne
curl -sk -X POST https://thesocle.net/api/actions/dns_sync_worker/force_sync \
  -H "X-Api-Key: $MCP_API_KEY"

# 5. Révoquer l'ancien token sur Cloudflare
```

---

## 10. Étape 8 — Roter un secret applicatif (Vault `soclehub/<app_id>/...`)

Ex. roter `soclehub/wordpress-corporate/db-password` :

```bash
# 1. Générer
NEW_PWD=$(openssl rand -base64 32)

# 2. Mettre à jour la base de l'app
docker exec wordpress-corporate-db mariadb -u root -p$ROOT_PWD \
  -e "ALTER USER 'wp_user'@'%' IDENTIFIED BY '$NEW_PWD'; FLUSH PRIVILEGES;"

# 3. Mettre à jour Vault via action MCP
curl -sk -X POST https://thesocle.net/api/actions/vault_worker/set_secret \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d "{ \"path\": \"soclehub/wordpress-corporate/db\",
        \"key\": \"password\",
        \"value\": \"$NEW_PWD\" }"

# 4. Restart le container app
curl -sk -X POST https://thesocle.net/api/actions/docker_worker/restart_app \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "app_id": "wordpress-corporate" }'
```

---

## 11. Validation post-rotation (commune à tous les cas)

```bash
# 1. Healthcheck global
curl -sk https://thesocle.net/admin/health | jq '.status'
# Attendu : "UP"

# 2. Tous les workers running
curl -sk -H "X-Api-Key: $MCP_API_KEY" \
  https://thesocle.net/api/actions/status_dashboard_worker/get_all_workers_status \
  | jq '.data.workers[] | select(.state != "running") | .name'
# Attendu : (vide)

# 3. Audit log
docker exec soclehub-postgres psql -U socle_prod -d socle_prod -c \
  "SELECT action, actor_email, created_at FROM iam.audit_log
   WHERE created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC LIMIT 20;"
```

---

## 12. Pièges courants

### Piège 1 — `Hub log : Running in STUB mode` après rotation `VAULT_TOKEN`

**Cause :** le nouveau token a une policy insuffisante ou est expiré (`-ttl=...` mal calculé).
**Résolution :** vérifier `vault token lookup <token>` → champs `policies`, `ttl`, `renewable: true`. Régénérer avec `-policy=soclehub-app -renewable=true`.

```bash
# INCORRECT — token non renouvelable, Hub crash après 1h
vault token create -policy=soclehub-app

# CORRECT
vault token create -policy=soclehub-app -ttl=8760h -renewable=true
```

### Piège 2 — Tous les utilisateurs reçoivent 401 après rotation JWT keypair, mais ne sont pas reconnectés au login

**Cause :** le navigateur conserve l'ancien `soclehub_token` cookie. `SsoFilter` voit le cookie, tente de valider avec le **nouveau** keypair, échoue, retourne 401 silencieux.
**Résolution :** ajouter dans la communication utilisateur : « Si vous voyez une page blanche, faites Ctrl-Shift-Suppr → cookies du domaine thesocle.net → effacer ». Côté Hub : étendre `SsoLoginSuccessHandler` pour invalider explicitement les cookies expirés.

### Piège 3 — `pg_dump` échoue silencieusement (table corrompue)

**Cause :** une table `iam.audit_log` peut grossir indéfiniment et bloquer pg_dump par OOM.
**Résolution :** purger l'audit log avant la snapshot :

```sql
DELETE FROM iam.audit_log WHERE created_at < NOW() - INTERVAL '1 year';
VACUUM FULL iam.audit_log;
```

### Piège 4 — Restart Hub après rotation `MAIL_PASSWORD` ne prend pas effet

**Cause :** `docker compose restart` ne relit pas `.env`. Spring Mail garde le mot de passe ancien.
**Résolution :** toujours `docker compose up -d soclehub` (recreate) après modif `.env`.

```bash
# INCORRECT
docker compose restart soclehub

# CORRECT
docker compose up -d soclehub
```

### Piège 5 — Nouvelle API key fonctionne en CLI mais 403 dans le portal

**Cause :** la création d'API key via `iam_worker/create_api_key` n'attribue pas automatiquement les scopes OIDC nécessaires aux endpoints `/hub/**`. Les API keys passent `ApiAuthFilter` (`/api/**`) uniquement.
**Résolution :** attribuer un rôle via `iam_worker/assign_role` à l'utilisateur propriétaire de la clé, et l'utiliser via Bearer JWT (pas X-Api-Key) pour `/hub/**`.

### Piège 6 — Ancien `VAULT_TOKEN` jamais révoqué

**Cause :** procédure interrompue après le restart Hub mais avant `vault token revoke`. Le token reste actif.
**Résolution :** noter dans un fichier `~/rotations.log` chaque token rotaté, scripter le revoke en fin de procédure :

```bash
# CORRECT — script complet
NEW_TOKEN=$(vault token create -policy=soclehub-app -ttl=8760h -renewable=true -format=json | jq -r '.auth.client_token')
OLD_TOKEN=$(grep '^VAULT_TOKEN=' /opt/soclehub/docker/.env | cut -d= -f2)
sed -i "s|^VAULT_TOKEN=.*|VAULT_TOKEN=$NEW_TOKEN|" /opt/soclehub/docker/.env
docker compose -f /opt/soclehub/docker/docker-compose.yml up -d soclehub
sleep 30
curl -fsk https://thesocle.net/admin/health || { echo "BOOT KO"; exit 1; }
VAULT_TOKEN=$OLD_TOKEN docker exec -i vault vault token revoke -self
echo "$(date -Iseconds) rotated VAULT_TOKEN OLD=$OLD_TOKEN" >> ~/rotations.log
```

### Piège 7 — `JAMES_ADMIN_PASSWORD` rotation casse le sync IAM users

**Cause :** James utilise basic auth sur l'API admin (port 8000). Le Hub lit `JAMES_ADMIN_PASSWORD` au boot dans `JamesAdminClient`. Si on change uniquement `.env` Hub sans changer côté James, plus aucun appel admin ne marche.
**Résolution :** rotation simultanée :

```bash
NEW_JAMES_PWD=$(openssl rand -base64 24)
# 1. Mettre à jour côté James (commande james-cli)
docker exec soclehub-james bash -c \
  "james-cli SetPassword james-admin '$NEW_JAMES_PWD'"
# 2. Mettre à jour .env
sed -i "s|^JAMES_ADMIN_PASSWORD=.*|JAMES_ADMIN_PASSWORD=$NEW_JAMES_PWD|" /opt/soclehub/docker/.env
# 3. Restart Hub
docker compose up -d soclehub
```

### Piège 8 — `BCryptPasswordEncoder` rejette le hash collé manuellement

**Cause :** le hash a été tronqué au copier-coller (BCrypt attend exactement 60 caractères ASCII).
**Résolution :** vérifier `SELECT length(password_hash) FROM iam.users WHERE email = '...';` → doit retourner 60.

### Piège 9 — Rotation `POSTGRES_PASSWORD` casse le Hub définitivement

**Cause :** modifier `.env` ne change pas le mot de passe dans le container Postgres. La Hub redémarre, ne peut plus se connecter à la DB.
**Résolution :** rotation Postgres en 2 phases avec un nouvel utilisateur temporaire :

```bash
# 1. Créer un user temporaire
docker exec soclehub-postgres psql -U socle_prod -c \
  "CREATE USER socle_prod_new WITH PASSWORD '$NEW_PWD' SUPERUSER;"

# 2. Mettre à jour .env (POSTGRES_USER + POSTGRES_PASSWORD) et restart Hub
# 3. Vérifier que tout marche, puis :
docker exec soclehub-postgres psql -U socle_prod_new -c \
  "ALTER USER socle_prod WITH PASSWORD '$NEW_PWD';"
# 4. Revenir au user d'origine
```

### Piège 10 — Cron de rotation laisse des tokens orphelins dans Vault

**Cause :** un script automatisé crée des tokens mais ne révoque pas les anciens, et `vault token list` accumule des centaines d'orphelins.
**Résolution :** purge périodique :

```bash
docker exec vault vault list -format=json auth/token/accessors \
  | jq -r '.[]' \
  | while read accessor; do
      info=$(docker exec vault vault token lookup -accessor "$accessor" -format=json)
      ttl=$(echo "$info" | jq -r '.data.ttl')
      [ "$ttl" -lt 3600 ] && docker exec vault vault token revoke -accessor "$accessor"
    done
```

---

## 13. Pour aller plus loin

- Voir [[11-vault-worker|VaultWorker]] pour la référence des 8 actions (`get_secret`, `set_secret`, `delete_secret`, `get_secret_keys`, `create_app_path`, `delete_app_path`, `renew_token`, `get_status`), la convention de chemins `soclehub/...` (KV v2 → `secret/data/soclehub/...`) et le renouvellement automatique du token.
- Voir `howto-21-clamav-mail-scan.md` pour la gestion des credentials James par utilisateur (Vault).
