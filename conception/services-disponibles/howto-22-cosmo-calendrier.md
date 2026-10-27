# HOWTO 22 — Activer Cosmo CalDAV/CardDAV (calendriers et contacts partagés)

**Niveau :** Intermédiaire
**Hub :** SocleHub 3.12.1
**Prérequis :** container `soclehub-cosmo` déployé via docker-compose, `COSMO_ENABLED=true`, DNS `calendrier.<domaine>` configuré côté Cloudflare, route proxy enregistrée
**Temps estimé :** 30-45 min (provision initial) + 10 min par utilisateur

> Référence framework : [[23-cosmo-worker|CosmoWorker]] — worker PASSIVE exposant **15 actions** MCP/REST (status, comptes, calendriers, carnets d'adresses, événements). Le provisioning DAV passe par `CosmoAdminClient` (OkHttp + Basic Auth, verbes `MKCALENDAR`/`MKCOL`/`PROPFIND`/`PUT`). Voir aussi [[11-vault-worker|VaultWorker]] pour les credentials `soclehub/cosmo/users/<email>` et [[43-proxy-worker|ProxyWorker]] pour la route `calendrier.<domaine>`.

---

## 1. Contexte

Cosmo est un serveur CalDAV/CardDAV open-source (anciennement Open OSAF Chandler) qui permet à n'importe quel client (Thunderbird/Lightning, Apple Calendar, GNOME Calendar, DAVx5 sur Android) de synchroniser des calendriers et carnets d'adresses. Le Hub fournit le worker `cosmo_worker` qui orchestre la création de comptes, le provisionnement des calendriers par défaut, le stockage des credentials dans Vault, et la synchronisation avec les utilisateurs IAM.

Ce HOWTO décrit le déploiement bout-en-bout : du provisionnement du container Cosmo à la configuration d'un client Thunderbird, en passant par l'auto-provision des comptes pour tous les utilisateurs IAM.

Le service doit :

- Auto-provisionner un compte CalDAV pour chaque utilisateur IAM (sync à la demande).
- Stocker le mot de passe DAV dans Vault sous `soclehub/cosmo/users/<email>`.
- Exposer Cosmo derrière le reverse-proxy du Hub sur `calendrier.<domaine>` avec certificat Let's Encrypt.
- Permettre l'injection programmatique d'événements iCalendar (intégration apps métiers).

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                       SocleHub Hub (port 443)                          │
│                                                                        │
│   Browser/Client ──► HTTPS calendrier.thesocle.net                      │
│        │                                                               │
│        │ Basic Auth (user@thesocle.net / vault-password)                │
│        ▼                                                               │
│   ┌────────────────┐         ┌──────────────────────────────┐          │
│   │ ProxyWorker    │ ───────►│  soclehub-cosmo:8080/cosmo   │          │
│   │ (DynProxyFilter)│         │  Spring Boot (Open Cosmo)    │          │
│   └────────────────┘         │  /dav/{user}/                │          │
│        │                     │   ├── calendar/              │          │
│        │ MCP/REST            │   ├── addressbook/           │          │
│        │ actions             │   └── notes/                 │          │
│        ▼                     └──────┬───────────────────────┘          │
│   ┌────────────────┐                │                                   │
│   │ CosmoWorker    │                ▼                                   │
│   │ (PASSIVE,      │         ┌──────────────────────────────┐          │
│   │  priority 38)  │         │  PostgreSQL cosmo schema     │          │
│   │ 15 actions     │         │  (events, items, attributes) │          │
│   └────────┬───────┘         └──────────────────────────────┘          │
│            │                                                            │
│            │ creds                                                      │
│            ▼                                                            │
│   ┌────────────────┐                                                    │
│   │ Vault KV v2    │  secret/soclehub/cosmo/users/<email>               │
│   │  password=...  │                                                    │
│   └────────────────┘                                                    │
└────────────────────────────────────────────────────────────────────────┘
            │
            ▼
   Thunderbird / Apple Calendar / DAVx5
   URL : https://calendrier.thesocle.net/cosmo/dav/<email>/calendar
```

---

## 3. Étape 1 — Provisionner le container Cosmo

`soclehub/docker/docker-compose.yml` extrait :

```yaml
services:
  soclehub-cosmo:
    image: ghcr.io/openchoreo/cosmo:1.0.0
    container_name: soclehub-cosmo
    restart: unless-stopped
    environment:
      COSMO_DB_URL: jdbc:postgresql://soclehub-postgres:5432/cosmo_db
      COSMO_DB_USER: cosmo
      COSMO_DB_PASSWORD: ${COSMO_DB_PASSWORD}
      COSMO_BASE_URL: https://calendrier.${CLOUDFLARE_DEFAULT_ZONE}/cosmo
      COSMO_DEFAULT_TIMEZONE: Europe/Paris
    volumes:
      - cosmo-data:/var/cosmo/data
    networks:
      - soclehub-net
    depends_on:
      - soclehub-postgres
```

Démarrer :

```bash
cd /opt/soclehub/docker
docker compose up -d soclehub-cosmo

# Vérifier
docker logs soclehub-cosmo --tail=50 | grep "Started CosmoApplication"
```

---

## 4. Étape 2 — Créer la route proxy + DNS + cert

```bash
# 1. DNS Cloudflare — créer calendrier.thesocle.net → SERVER_IP
curl -sk -X POST https://thesocle.net/api/actions/dns_sync_worker/create_subdomain \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "calendrier",
    "type": "A",
    "content": "51.255.205.19",
    "proxied": "false"
  }'

# 2. Cert ACME
curl -sk -X POST https://thesocle.net/api/actions/acme_worker/request_certificate \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "hostname": "calendrier.thesocle.net" }'

# 3. Route proxy
curl -sk -X POST https://thesocle.net/api/actions/proxy_worker/add_route \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{
    "hostname": "calendrier.thesocle.net",
    "upstream_host": "soclehub-cosmo",
    "upstream_port": "8080",
    "app_id": "cosmo",
    "websocket": "false"
  }'
```

---

## 5. Étape 3 — Vérifier le worker Cosmo

```bash
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/get_status \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Attendu :
# {
#   "data": {
#     "connected": true,
#     "version": "Cosmo CalDAV",
#     "enabled": true,
#     "url": "http://soclehub-cosmo:8080/cosmo",
#     "external_hostname": "calendrier.thesocle.net"
#   }
# }
```

Si `connected: false` :

```bash
docker exec soclehub curl -fsS http://soclehub-cosmo:8080/cosmo/dav/
# Doit retourner 401 (auth required) — pas de connection refused
```

---

## 6. Étape 4 — Provisionner un compte utilisateur

L'action `create_account` :
1. Génère un mot de passe aléatoire 16 caractères.
2. Provisionne le user via DAV access (PROPFIND auth → Cosmo crée le user à la volée).
3. Crée un calendrier `calendar` par défaut (MKCALENDAR).
4. Stocke le mot de passe dans Vault `secret/soclehub/cosmo/users/<email>`.

```bash
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/create_account \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "email": "alice@thesocle.net" }'

# Réponse :
# {
#   "data": {
#     "email": "alice@thesocle.net",
#     "created": true,
#     "default_calendar": true,
#     "vault_path": "soclehub/cosmo/users/alice@thesocle.net"
#   }
# }
```

Récupérer le mot de passe (à transmettre à l'utilisateur de manière sécurisée) :

```bash
docker exec vault vault kv get -format=json \
  secret/soclehub/cosmo/users/alice@thesocle.net \
  | jq -r '.data.data.password'
```

---

## 7. Étape 5 — Synchroniser tous les utilisateurs IAM

Pour provisionner d'un coup tous les utilisateurs IAM qui n'ont pas encore de compte CalDAV :

```bash
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/sync_iam_users \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Réponse :
# {
#   "data": {
#     "total_iam_users": 47,
#     "already_provisioned": 12,
#     "newly_created": 35,
#     "failed": 0
#   }
# }
```

Le worker itère sur `iam.users` (status = active), vérifie présence dans Vault, et crée si manquant.

Lister les comptes éligibles :

```bash
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/list_accounts \
  -H "X-Api-Key: $MCP_API_KEY" | jq
```

---

## 8. Étape 6 — Récupérer les URLs CalDAV pour configurer un client

```bash
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/get_connection_info \
  -H "X-Api-Key: $MCP_API_KEY" | jq

# Réponse :
# {
#   "data": {
#     "caldav_url": "https://calendrier.thesocle.net/cosmo/dav/{email}",
#     "carddav_url": "https://calendrier.thesocle.net/cosmo/dav/{email}/addressbook",
#     "server_hostname": "calendrier.thesocle.net",
#     "auth_method": "Basic",
#     "auto_discovery": "https://calendrier.thesocle.net/.well-known/caldav"
#   }
# }
```

### 8.1 Configuration Thunderbird (Lightning)

1. Menu → Calendrier → Nouveau Calendrier → Sur le réseau.
2. Format : **CalDAV**.
3. URL : `https://calendrier.thesocle.net/cosmo/dav/alice@thesocle.net/calendar`
4. Identifiant : `alice@thesocle.net` / mot de passe Vault.

Pour les contacts :

1. Carnet d'adresses → Nouveau → CardDAV.
2. URL : `https://calendrier.thesocle.net/cosmo/dav/alice@thesocle.net/addressbook`

### 8.2 Configuration Apple Calendar (macOS)

1. Préférences → Comptes → Ajouter un compte → Autre compte CalDAV.
2. Type : **Manuel**.
3. Identifiant : `alice@thesocle.net`.
4. Mot de passe : Vault.
5. Adresse du serveur : `calendrier.thesocle.net`.

Apple détectera le port 443 + le chemin `/cosmo/dav/` automatiquement via l'URL `.well-known/caldav`.

### 8.3 Configuration DAVx5 (Android)

1. Ajouter un compte → Connexion avec URL et nom d'utilisateur.
2. URL : `https://calendrier.thesocle.net/cosmo/dav/alice@thesocle.net/`
3. User : `alice@thesocle.net`, Pwd : Vault.

---

## 9. Étape 7 — Créer un calendrier additionnel

```bash
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/create_calendar \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "email": "alice@thesocle.net", "name": "projets-2026" }'

# Lister
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/list_calendars \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "email": "alice@thesocle.net" }' | jq

# Réponse :
# { "data": { "calendars": [
#   { "id": "calendar", "name": "calendar", "url": ".../calendar/" },
#   { "id": "projets-2026", "name": "projets-2026", "url": ".../projets-2026/" }
# ] } }

# Carnet d'adresses
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/create_addressbook \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{ "email": "alice@thesocle.net", "name": "contacts-pro" }'
```

---

## 10. Étape 8 — Injecter un événement iCalendar (intégration apps)

Cas d'usage : une app de gestion de projet pousse les jalons dans le calendrier de chaque membre.

```bash
ICAL=$(cat <<'EOF'
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SocleHub//ProjectApp//FR
BEGIN:VEVENT
UID:20260515T100000Z-projet-X@thesocle.net
DTSTAMP:20260428T120000Z
DTSTART:20260515T100000Z
DTEND:20260515T120000Z
SUMMARY:Sprint Review Projet X
DESCRIPTION:Review du sprint 12 — démo + retro
LOCATION:Salle Olympe ou Visio https://meet.thesocle.net/sprint-x
ORGANIZER:CN=Bob:mailto:bob@thesocle.net
ATTENDEE;CN=Alice;RSVP=TRUE:mailto:alice@thesocle.net
END:VEVENT
END:VCALENDAR
EOF
)

curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/inject_ical_event \
  -H "X-Api-Key: $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "alice@thesocle.net" --arg ical "$ICAL" \
        '{email: $email, ical_data: $ical}')"
```

**Points clés :**

- `UID` doit être unique. Si l'événement existe (même UID), Cosmo le **met à jour** (idempotent).
- L'injection écrit directement via PUT WebDAV : `PUT /cosmo/dav/<email>/calendar/<uid>.ics`.

---

## 11. Étape 9 — Partage de calendrier (placeholder)

L'action `share_calendar` est actuellement un placeholder (Cosmo ACL via PROPPATCH non implémenté). Pour partager un agenda manuellement :

```bash
# 1. Créer un compte utilisateur "team-marketing" partagé
curl ... create_account -d '{"email":"team-marketing@thesocle.net"}'

# 2. Distribuer le mot de passe Vault aux membres concernés
docker exec vault vault kv get -field=password \
  secret/soclehub/cosmo/users/team-marketing@thesocle.net

# 3. Chaque membre ajoute le compte en CalDAV
```

---

## 12. Validation

```bash
# 1. Test connexion DAV directe
curl -sku alice@thesocle.net:<password> \
  https://calendrier.thesocle.net/cosmo/dav/alice@thesocle.net/ \
  -X PROPFIND -H "Depth: 1"
# Attendu : 207 Multi-Status XML

# 2. Vérifier les calendriers
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/list_calendars \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{"email":"alice@thesocle.net"}' | jq '.data.calendars | length'
# Attendu : >= 1

# 3. Test injection événement
curl -sk -X POST https://thesocle.net/api/actions/cosmo_worker/inject_ical_event \
  -H "X-Api-Key: $MCP_API_KEY" \
  -d '{"email":"alice@thesocle.net","ical_data":"BEGIN:VCALENDAR\\nVERSION:2.0\\nBEGIN:VEVENT\\nUID:test-001@thesocle.net\\nDTSTAMP:20260428T120000Z\\nDTSTART:20260429T100000Z\\nDTEND:20260429T110000Z\\nSUMMARY:Test\\nEND:VEVENT\\nEND:VCALENDAR"}'

# 4. Vérifier en SQL côté Cosmo
docker exec soclehub-postgres psql -U socle_prod -d cosmo_db -c \
  "SELECT uid, summary FROM cosmo.event WHERE uid='test-001@thesocle.net';"
```

---

## 13. Pièges courants

### Piège 1 — `create_account` retourne 401 « DAV access denied »

**Cause :** Cosmo refuse la création auto-provisionnée parce que la propriété `cosmo.security.allow.user.creation` est désactivée.
**Résolution :** définir dans `cosmo.properties` (mounted volume) :

```properties
cosmo.security.allow.user.creation=true
```

Puis `docker restart soclehub-cosmo`.

### Piège 2 — Thunderbird affiche « Calendrier introuvable » avec l'URL exacte

**Cause :** Thunderbird tente d'ajouter `/calendars/` automatiquement, ce qui produit un 404.
**Résolution :** utiliser l'URL **exacte** sans slash final, ou activer auto-discovery via `/.well-known/caldav` :

```bash
# Vérifier
curl -skI https://calendrier.thesocle.net/.well-known/caldav
# Attendu : 301 Location: /cosmo/dav/
```

### Piège 3 — Mot de passe Vault perdu

**Cause :** l'utilisateur a perdu son mdp DAV, le worker ne stocke qu'une copie unique.
**Résolution :** régénérer en supprimant + recréant le compte (les calendriers existants sont conservés en DB Cosmo) :

```bash
# 1. Supprimer Vault uniquement (pas le compte Cosmo)
docker exec vault vault kv delete secret/soclehub/cosmo/users/alice@thesocle.net

# 2. Recréer
curl ... create_account -d '{"email":"alice@thesocle.net"}'
```

ATTENTION : `create_account` essaie de re-provisionner le user côté Cosmo, ce qui peut échouer si le user existe déjà. À préférer : action custom `reset_password` (à implémenter).

### Piège 4 — `sync_iam_users` skip tous les utilisateurs « already provisioned » alors qu'ils ne le sont pas

**Cause :** la détection se base sur la présence d'une entrée Vault, pas sur l'existence côté Cosmo. Si Vault a été restoré depuis un backup mais Cosmo a été reset, la détection est fausse.
**Résolution :** lister les vrais comptes Cosmo en SQL et croiser :

```sql
SELECT u.email FROM iam.users u
LEFT JOIN cosmo.user cu ON cu.username = u.email
WHERE cu.username IS NULL AND u.status = 'active';
```

### Piège 5 — Apple Calendar refuse le certificat avec « Le serveur n'est pas digne de confiance »

**Cause :** le cert Let's Encrypt n'est pas encore propagé ou la chaîne intermédiaire manque.
**Résolution :**

```bash
# Vérifier
echo | openssl s_client -connect calendrier.thesocle.net:443 -servername calendrier.thesocle.net \
  -showcerts 2>/dev/null | grep -E '(subject|issuer)'
# Attendu : 2 lignes — leaf + intermediate (R3 Let's Encrypt)
```

Forcer le renouvellement :

```bash
curl ... acme_worker/force_renew -d '{"hostname":"calendrier.thesocle.net"}'
```

### Piège 6 — `inject_ical_event` réussit mais l'événement n'apparaît pas dans Thunderbird

**Cause :** Thunderbird met en cache et ne re-synchronise que toutes les 30 min par défaut.
**Résolution :** clic droit sur le calendrier → Synchroniser. Réduire l'intervalle dans Préférences.

### Piège 7 — DAVx5 (Android) consomme 100 % batterie

**Cause :** la sync est en push avec polling permanent par défaut.
**Résolution :** dans DAVx5 → paramètres calendrier → intervalle de sync = 1 h ou Manuel.

### Piège 8 — `create_calendar` retourne 405 Method Not Allowed

**Cause :** un calendrier du même nom existe déjà. Cosmo refuse MKCALENDAR sur un chemin occupé.
**Résolution :** lister les calendriers d'abord, choisir un nom unique, ou supprimer l'existant via `delete_calendar`.

### Piège 9 — Performance dégradée avec 200+ utilisateurs

**Cause :** Cosmo n'est pas conçu pour des déploiements massifs (la DB stocke des XML iCalendar, mauvaise indexation).
**Résolution :** envisager Radicale (plus léger) ou DAViCal pour > 500 users. Actuellement en accepting de la limite.

### Piège 10 — Container `soclehub-cosmo` redémarre en boucle

**Cause :** schéma DB `cosmo_db` non créé ou user `cosmo` sans droits.
**Résolution :**

```bash
docker exec -it soclehub-postgres psql -U socle_prod -c \
  "CREATE DATABASE cosmo_db;
   CREATE USER cosmo WITH PASSWORD '<pwd>';
   GRANT ALL PRIVILEGES ON DATABASE cosmo_db TO cosmo;"
```

Puis `docker restart soclehub-cosmo`.

---

## 14. Pour aller plus loin

- Voir [[23-cosmo-worker|fiche CosmoWorker]] pour les 15 actions `cosmo_worker/*` et le détail de `CosmoAdminClient`
- Voir `howto-19-rotation-secrets.md` (rotation `cosmo` users password)
- Voir source `eu.lmvi.soclehub.worker.CosmoWorker`
- Documentation Cosmo : https://github.com/openchoreo/cosmo/wiki
