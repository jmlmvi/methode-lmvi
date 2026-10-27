# HOWTO 17 — Déployer SocleHub en production depuis zéro

**Niveau :** Senior
**Prérequis :** un serveur Linux (Ubuntu 22.04+ recommandé, 4 vCPU / 8 GB RAM minimum, 100 GB disque), accès SSH root, un domaine DNS (ex: `thesocle.net`) avec accès au panel Cloudflare (ou équivalent capable de servir un proxy DNS et d'auto-renouveler des CNAME), un compte SMTP transactionnel (Brevo, SendGrid, Mailgun…), et l'archive `SocleHub-StarterPack-vX.Y.Z.tar.gz`.
**Temps estimé :** 1h30

> ⚠️ **Portée : installation d'un Hub NEUF depuis un StarterPack, écrite pour la 3.12.1.**
> Ce HOWTO ne couvre **pas** la montée de version d'un Hub qui tourne : pour cela, la procédure de
> référence est la skill `devops` (`.claude/skills/devops/SKILL.md` +
> `references/runbook-hub.md`), qui porte le rayon de souffle, la sauvegarde de la config cible, le
> canary, la vérification post-bascule et le rollback.
> Deux détails de cette page ont vieilli : depuis la 3.13.0 le Hub n'est plus livré par JAR dans un
> pack mais par **image tirée de `repository.thesocle.net/soclehub`**, et depuis la 3.72.0 les routes
> `/admin/*` sont **fermées par clé** — les `curl` ci-dessous veulent un en-tête `X-Admin-Key:
> $ADMIN_API_KEY`, l'`Authorization: Bearer` ne suffit plus.

---

## 1. Contexte

La procédure complète de packaging et de mise en service est décrite côté framework dans [[201-deploiement-docker|Déploiement Docker]] ; ce HOWTO en est la déclinaison opérationnelle pas-à-pas pour Hub 3.12.1.

Déployer SocleHub from scratch installe en une fois : (1) le hub orchestrateur (un seul JAR Spring Boot V005), (2) PostgreSQL + MariaDB + Redis (datastores), (3) MinIO (S3-compatible), (4) Vault (secrets), (5) NATS (event bus), (6) ClamAV (scan antivirus), (7) James (mail server SMTP/IMAP), (8) Cosmo (CalDAV/CardDAV), (9) DocuSeal (signatures), (10) OnlyOffice (édition Office), (11) ttyd (terminal web admin). Tout est packagé dans un `StarterPack.tar.gz` qui contient un JAR pré-compilé, un `docker-compose.yml`, des scripts shell d'orchestration, et un template `.env.example` à compléter.

L'objectif est qu'un opérateur, après avoir loué une VM et configuré son DNS, ait un environnement SocleHub fonctionnel en moins de 30 minutes, avec :

- Certificats TLS Let's Encrypt actifs sur `admin.<DOMAIN>` (ACME-DNS via Cloudflare)
- Compte admin bootstrap utilisable
- Tous les workers Hub `running` et `healthy`
- Backup PostgreSQL programmé quotidiennement
- Possibilité d'installer une première app de démonstration (`appdemo`)

Les exigences :

- **Aucun build Maven** sur le serveur (le JAR est pré-construit dans le pack)
- **Aucune Java install** requise (tout tourne en container)
- **Idempotence** : `./scripts/deploy.sh` peut être ré-exécuté safely

---

## 2. Architecture

```
                 ┌──────────────────┐
                 │  Cloudflare DNS  │
                 │  zone thesocle.net│
                 └────────┬─────────┘
                          │ A admin.thesocle.net → 51.255.205.19
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Serveur Ubuntu 22.04                                               │
│  Docker + Docker Compose v2                                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Network: docker_soclehub-net (bridge)                      │    │
│  │                                                             │    │
│  │  soclehub:80,443  ◄── Cloudflare proxified                  │    │
│  │  ├── ProxyWorker  → routes admin.<DOMAIN>, *.thesocle.net   │    │
│  │  ├── AcmeWorker   → cert Let's Encrypt via DNS-01 CF        │    │
│  │  └── 26 workers métier + filtres                            │    │
│  │                                                             │    │
│  │  postgres:5432         vault:8200       mariadb:3306        │    │
│  │  redis:6379            minio:9000/9001  nats:4222           │    │
│  │  clamav:3310           james:25/143     cosmo:8181          │    │
│  │  docuseal:3000         onlyoffice:80    ttyd:7681           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Volumes persistants :                                              │
│    docker_postgres-data  docker_mariadb-data  docker_redis-data     │
│    docker_minio-data     docker_vault-data    docker_clamav-db      │
│    docker_james-data     docker_cosmo-data    docker_docuseal-data  │
│    docker_soclehub-data  (TechDB H2 + keystore + logs)              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Préparer le serveur

```bash
# 1. SSH root
ssh root@51.255.205.19

# 2. Installer Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 3. Vérifier
docker --version          # >= 24.0
docker compose version    # >= 2.20

# 4. Ouvrir les ports nécessaires (firewall ufw / iptables / cloud security group)
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (ACME http-01 + redirect)
ufw allow 443/tcp    # HTTPS
ufw allow 25/tcp     # SMTP entrant (mail)
ufw allow 587/tcp    # SMTP submission
ufw allow 143/tcp    # IMAP
ufw enable

# 5. Créer un user non-root pour les opérations courantes
adduser ubuntu
usermod -aG docker,sudo ubuntu
```

Vérifier le DNS depuis le serveur :

```bash
dig +short admin.thesocle.net
# Attendu : 51.255.205.19 (l'IP du serveur)
```

---

## 4. Étape 2 — Récupérer et extraire le StarterPack

```bash
# Sur la machine de l'opérateur, scp le pack
scp /chemin/vers/SocleHub-StarterPack-v3.12.1.tar.gz ubuntu@51.255.205.19:/opt/

# Sur le serveur
ssh ubuntu@51.255.205.19
cd /opt
tar -xzf SocleHub-StarterPack-v3.12.1.tar.gz
mv SocleHub-StarterPack-v3.12.1 thesocle
cd thesocle

ls
# CLAUDE.md  README.md  app/  docker/  docs/  infos/  lib/  repository/  scripts/  sql/

# Le JAR doit être présent
ls -la app/
# soclehub-3.12.1-exec.jar  ~110 MB
```

---

## 5. Étape 3 — Configurer le `.env`

```bash
cp docker/.env.example docker/.env

# Générer les secrets aléatoires (mots de passe DB, tokens internes)
./scripts/generate-secrets.sh
# Le script remplace tous les CHANGEZ_MOI "secrets internes" par des valeurs aléatoires (openssl rand -base64 24)
# Ne touche PAS à : SERVER_IP, DOMAIN, CLOUDFLARE_*, BOOTSTRAP_ADMIN_*, MAIL_*

# Ouvrir et remplir manuellement le reste
$EDITOR docker/.env
```

Variables à remplir manuellement :

```bash
# Serveur
SERVER_IP=51.255.205.19
DOMAIN=admin.thesocle.net

# Cloudflare — créer un API token avec scope Zone.DNS.Edit sur la zone visée
# https://dash.cloudflare.com/profile/api-tokens
CLOUDFLARE_API_TOKEN=ABC...30+chars
CLOUDFLARE_ZONE_ID=86456e1a0b630a8007a917b3c7c9c3ad   # visible sur la page d'accueil de la zone CF
CLOUDFLARE_DEFAULT_ZONE=thesocle.net

# Admin bootstrap (créé au premier démarrage si BOOTSTRAP_ENABLED=true)
BOOTSTRAP_ENABLED=true
BOOTSTRAP_ADMIN_EMAIL=admin@thesocle.net
BOOTSTRAP_ADMIN_PASSWORD=ChooseAStrongPasswordHere!
BOOTSTRAP_ADMIN_FIRSTNAME=Admin
BOOTSTRAP_ADMIN_LASTNAME=SocleHub

# SMTP sortant (Brevo / SendGrid / etc.)
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_USERNAME=xxxx@smtp-brevo.com
MAIL_PASSWORD=xsmtpsib-...
MAIL_FROM=admin@thesocle.net

# JWT issuer (utilisé pour signer les tokens IAM internes)
JWT_ISSUER=www.thesocle.net
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800

# MCP API key — pour bracher les agents IA (voir howto-13)
MCP_ENABLED=true
MCP_MODE=http
MCP_API_KEY=$(openssl rand -base64 24 | tr -d '=+/' | head -c 32)
```

Vérifier qu'aucun `CHANGEZ_MOI` ne reste :

```bash
grep -v '^#' docker/.env | grep CHANGEZ_MOI && echo "ERREUR: variables non remplies" || echo "OK"
```

---

## 6. Étape 4 — Lancer le déploiement

```bash
./scripts/deploy.sh
```

Ce que fait le script (extrait des étapes du `deploy.sh`) :

1. **[1/6]** Vérifie Docker et Docker Compose v2
2. **[2/6]** Vérifie le JAR `app/soclehub-*-exec.jar`
3. **[3/6]** Vérifie que `.env` est rempli (rejet si `CHANGEZ_MOI`)
4. **[4/6]** Crée le record DNS A `admin.<DOMAIN>` → `<SERVER_IP>` via Cloudflare API (idempotent)
5. **[5/6]** `docker compose -f docker/docker-compose.yml up -d` (lance les 14+ containers)
6. **[6/6]** Attend que `/admin/health` réponde 200 (timeout 5 min)

Sortie attendue :

```
============================================
 SocleHub — Deploiement automatique
============================================

[1/6] Verification des prerequis...
  Docker 26.1.4 — OK
[2/6] Verification du JAR pre-build...
  JAR present (soclehub-3.12.1-exec.jar, 113M) — OK
[3/6] Verification de la configuration...
  Configuration OK
[4/6] Configuration DNS Cloudflare...
  Record A admin.thesocle.net → 51.255.205.19 créé
[5/6] Démarrage des containers...
  [+] Running 15/15
  ✔ Network docker_soclehub-net      Created
  ✔ Container soclehub-postgres      Started
  ✔ Container soclehub-mariadb       Started
  ✔ Container soclehub-redis         Started
  ✔ Container soclehub-vault         Started
  ✔ Container soclehub-minio         Started
  ✔ Container soclehub-nats          Started
  ✔ Container soclehub-clamav        Started
  ✔ Container soclehub-james         Started
  ✔ Container soclehub-cosmo         Started
  ✔ Container soclehub-docuseal      Started
  ✔ Container soclehub-onlyoffice    Started
  ✔ Container soclehub-ttyd          Started
  ✔ Container soclehub              Started
[6/6] Attente du healthcheck SocleHub...
  Healthcheck OK après 47s
============================================
 SocleHub déployé avec succès !
 Portail admin : https://admin.thesocle.net
 Login        : admin@thesocle.net
============================================
```

---

## 7. Étape 5 — Premier login et configuration Cloudflare

Ouvrir `https://admin.thesocle.net` dans un navigateur. Au premier accès, le navigateur va probablement rejeter le certificat (auto-signé, ACME pas encore obtenu). Accepter temporairement.

1. Page de login → email `admin@thesocle.net` + password configuré
2. Redirection vers `/portal` → menu **Hub → Settings**
3. Section **Cloudflare** : vérifier que `CLOUDFLARE_API_TOKEN` est présent (lu depuis `.env`). Sinon le saisir et cliquer **Save**.
4. Section **DNS** : vérifier que la zone `thesocle.net` est listée et que SocleHub voit les records existants.

```bash
# Test API
curl -s https://admin.thesocle.net/admin/workers/dns_sync_worker/actions/list_zones \
  -H "Authorization: Bearer $MCP_API_KEY" | jq
```

---

## 8. Étape 6 — Émettre le certificat ACME

Le `AcmeWorker` peut émettre des certs Let's Encrypt en DNS-01 challenge via Cloudflare API. Les certs sont stockés dans la TechDB et appliqués au reverse proxy interne.

```bash
# Demander un cert pour admin.thesocle.net
curl -s -X POST https://admin.thesocle.net/admin/workers/acme_worker/actions/request_certificate \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "admin.thesocle.net",
    "challenge_type": "dns-01"
  }' | jq
```

Réponse attendue :

```json
{
  "domain": "admin.thesocle.net",
  "status": "issued",
  "challenge_type": "dns-01",
  "expires_at": "2026-07-27T10:23:00Z",
  "fingerprint_sha256": "AB:CD:EF:..."
}
```

Le `AcmeWorker` :

1. Génère une CSR
2. Demande un challenge DNS-01 à Let's Encrypt
3. Crée un record TXT `_acme-challenge.admin.thesocle.net` via Cloudflare API
4. Attend la propagation (~30 s)
5. Récupère le cert + chaîne intermédiaire
6. Stocke dans `acme.certificates` table
7. Notifie le `ProxyWorker` qui recharge le keystore SSL

Redémarrer le hub pour que NIO/Tomcat pick up le keystore mis à jour :

```bash
docker compose -f docker/docker-compose.yml restart soclehub
sleep 30
curl -sI https://admin.thesocle.net | head -5
# HTTP/2 200
# server: SocleHub
# (cert valide Let's Encrypt)
```

Vérifier dans le navigateur : cadenas vert, certificat valide jusqu'à `expires_at + 90 jours`. Le `AcmeWorker` renouvelle automatiquement à T-30 jours.

---

## 9. Étape 7 — Installer une première app de démonstration

Le pack inclut un catalogue d'apps prêtes à déployer. La plus simple est `appdemo` qui démontre meteo + DB + MCP.

```bash
# Lister le catalogue
curl -s -X POST https://admin.thesocle.net/admin/workers/app_registry_worker/actions/list_catalog \
  -H "Authorization: Bearer $MCP_API_KEY" | jq '.catalog[].app_id'

# Installer appdemo
curl -s -X POST https://admin.thesocle.net/admin/workers/docker_worker/actions/install_app \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"appdemo"}' | jq

# Démarrer
curl -s -X POST https://admin.thesocle.net/admin/workers/docker_worker/actions/start_app \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"appdemo"}' | jq

# Attendre 20s puis lister
sleep 20
curl -s -X POST https://admin.thesocle.net/admin/workers/docker_worker/actions/list_apps \
  -H "Authorization: Bearer $MCP_API_KEY" | jq '.apps'
```

Réponse attendue :

```json
[
  {
    "app_id": "appdemo",
    "container_name": "appdemo",
    "status": "running",
    "port_internal": 8080,
    "port_external": 9091,
    "version": "1.0.0"
  }
]
```

Tester l'app :

```bash
# Healthcheck app
docker exec soclehub curl -s http://appdemo:8080/admin/health
# {"status":"UP"}

# Forcer le refresh du proxy MCP pour exposer les outils de l'app via le Hub
curl -X POST https://admin.thesocle.net/admin/workers/mcp_proxy_worker/actions/mcp_proxy_refresh \
  -H "Authorization: Bearer $MCP_API_KEY"
```

---

## 10. Étape 8 — Configurer le backup quotidien

```bash
# Créer un cron pour le backup quotidien à 3h du matin
crontab -e
# Ajouter :
0 3 * * * /opt/thesocle/scripts/backup.sh /opt/backups >> /var/log/soclehub-backup.log 2>&1

mkdir -p /opt/backups
```

Tester immédiatement :

```bash
./scripts/backup.sh /opt/backups
ls -lh /opt/backups/
# soclehub-backup-2026-04-28_1023.tar.gz   85M
```

Le script :

1. `pg_dumpall` PostgreSQL
2. `mariadb-dump --all-databases`
3. Copie de `docker/.env` et `catalog.json`
4. `docker cp soclehub:/app/data ./app-data` (TechDB H2 + keystore)
5. Tar.gz dans le dossier de destination

---

## 11. Étape 9 — Déclencher backup app DB via le Hub

```bash
curl -s -X POST https://admin.thesocle.net/admin/workers/db_worker/actions/backup_app_db \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"appdemo"}' | jq
```

Réponse :

```json
{ "appId": "appdemo", "status": "backup_started", "note": "stub implementation" }
```

---

## 12. Validation

### Healthcheck global

```bash
curl -s https://admin.thesocle.net/admin/health | jq
```

Attendu :

```json
{
  "status": "UP",
  "components": {
    "db":          { "status": "UP" },
    "mariadb":     { "status": "UP" },
    "redis":       { "status": "UP" },
    "vault":       { "status": "UP" },
    "minio":       { "status": "UP" },
    "techdb":      { "status": "UP" }
  }
}
```

### Status dashboard

```bash
curl -s https://admin.thesocle.net/admin/status \
  -H "Authorization: Bearer $MCP_API_KEY" | jq '.workers | keys | length'
# Attendu : 26+ workers
```

Ouvrir `https://admin.thesocle.net/portal` dans un navigateur, vérifier les widgets verts.

### Test login + session

```bash
LOGIN_RESP=$(curl -s -X POST https://admin.thesocle.net/api/v1/iam/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@thesocle.net","password":"YourBootstrapPassword"}')
echo "$LOGIN_RESP" | jq
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.access_token')

# Appel authenticated
curl -s https://admin.thesocle.net/api/v1/iam/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Test envoi email admin (reset password)

```bash
curl -s -X POST https://admin.thesocle.net/api/v1/iam/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@thesocle.net"}'

# Vérifier dans l'inbox
```

---

## 13. Pièges courants

### Piège 1 — `[4/6] Configuration DNS Cloudflare ÉCHEC`

**Symptôme :** `deploy.sh` plante : `Cloudflare API error: 6003 (Invalid request headers)`.
**Cause :** `CLOUDFLARE_API_TOKEN` mal formé (espaces, retours à la ligne) ou permissions insuffisantes (token type "Edit zone DNS" requis).
**Résolution :** Recréer un token Cloudflare avec **uniquement** `Zone.DNS.Edit` sur la zone visée. Tester `curl -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify`.

### Piège 2 — Certificat ACME bloqué en `pending` plus de 5 minutes

**Symptôme :** `acme_worker/get_status` retourne `status: pending` indéfiniment.
**Cause :** Le record DNS TXT `_acme-challenge.admin.thesocle.net` n'est pas propagé. Cloudflare a un cache TTL de 5 min sur les TXT.
**Résolution :** Vérifier le record : `dig TXT _acme-challenge.admin.thesocle.net`. Si absent, c'est un problème d'API Cloudflare. Si présent mais Let's Encrypt ne le voit pas, attendre 10 min puis `force_renew`.

### Piège 3 — `BOOTSTRAP_ADMIN_PASSWORD` trop faible refusé

**Symptôme :** Login impossible, logs Hub : `Bootstrap user creation failed: password too weak`.
**Cause :** Politique de password (10 chars, 1 maj, 1 chiffre, 1 spécial). Activée par défaut.
**Résolution :** Utiliser un mot de passe complexe. Régénérer le bootstrap : couper le Hub, `BOOTSTRAP_ENABLED=true`, supprimer la ligne user existante en DB, redémarrer.

### Piège 4 — Mail bootstrap pas reçu

**Symptôme :** Aucun email d'activation reçu sur `BOOTSTRAP_ADMIN_EMAIL`.
**Cause :** SMTP SendGrid/Brevo non vérifié pour l'adresse FROM, ou `MAIL_FROM` ≠ domaine vérifié chez le provider.
**Résolution :** Vérifier que `MAIL_FROM` est dans le domaine vérifié (SPF/DKIM passants chez Brevo). Tester via :

```bash
curl -X POST https://admin.thesocle.net/admin/workers/mail_worker/actions/test_smtp \
  -H "Authorization: Bearer $MCP_API_KEY"
```

### Piège 5 — Ports 80/443 déjà occupés

**Symptôme :** `docker compose up` : `port already allocated`.
**Cause :** Apache/Nginx déjà installé sur l'hôte.
**Résolution :** `systemctl stop nginx apache2 && systemctl disable nginx apache2`. Vérifier avec `ss -tlnp | grep ':80\|:443'`.

### Piège 6 — `soclehub-postgres` boucle de crash

**Symptôme :** `docker logs soclehub-postgres` : `PANIC: could not initialize transaction log`.
**Cause :** Volume précédent corrompu (mauvais arrêt), ou `POSTGRES_PASSWORD` changé sans wiper le volume.
**Résolution :** Si déploiement neuf, supprimer le volume : `docker volume rm docker_postgres-data` puis re-deploy. Sinon restore depuis backup (voir `howto-18`).

### Piège 7 — `appdemo` ne démarre pas, pas de port external

**Symptôme :** `list_apps` retourne `appdemo` en `created` mais pas `running`.
**Cause :** L'image Docker de l'app n'est pas pré-build dans le pack (catalogue minimal). Le `DockerWorker` la pull depuis le registry distant (Docker Hub ou GHCR) au moment de l'install.
**Résolution :** Vérifier la connectivité sortante depuis le serveur (`curl https://hub.docker.com`). Si registry privé, configurer `~/.docker/config.json` avec les credentials.

### Piège 8 — Cloudflare proxy "orange cloud" casse les WebSocket SSO

**Symptôme :** Login passe, mais l'UI portal coupe la session toutes les 30 s.
**Cause :** Cloudflare proxy avec mode "Orange cloud" terminate les WebSocket. SocleHub utilise une WS pour le keep-alive de session.
**Résolution :** Soit désactiver le proxy (DNS Only), soit activer "WebSocket Support" dans Cloudflare Network settings. Recommandé : DNS Only sauf si vous voulez le DDoS shield CF.

### Piège 9 — Disk full après quelques semaines

**Symptôme :** Le serveur passe en read-only, Docker incapable d'écrire.
**Cause :** Logs `/var/lib/docker/containers/.../*-json.log` non rotatés. Ou `backups/` jamais purgé.
**Résolution :** Configurer Docker daemon `/etc/docker/daemon.json` :

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "100m", "max-file": "5" }
}
```

Plus un cron de purge `find /opt/backups -mtime +30 -delete`.

### Piège 10 — Containers infra (postgres, vault) démarrent dans le mauvais ordre

**Symptôme :** Hub crash au boot : `connection refused to vault:8200`.
**Cause :** `depends_on` sans `condition: service_healthy` lance Hub avant que Vault soit prêt.
**Résolution :** Le `docker-compose.yml` du pack utilise `depends_on: { vault: { condition: service_healthy } }`. Vérifier qu'il est bien là. Sinon ajouter manuellement.

### Piège 11 — Session admin perdue après redémarrage docker

**Symptôme :** Après `docker compose restart`, faut se relogger.
**Cause :** Sessions stockées en mémoire (Spring HttpSession default). Pas un bug, comportement normal.
**Résolution :** Pour de la persistance, configurer `spring.session.store-type=redis` dans `application.yml`. Le pack 3.12.1 ne le fait pas par défaut.

### Piège 12 — `BOOTSTRAP_ENABLED=true` ignoré au 2e déploiement

**Symptôme :** Re-deploy ne recrée pas l'admin.
**Cause :** Le bootstrap ne s'exécute que si la table `iam.users` est vide.
**Résolution :** Comportement attendu (sécurité). Pour réinitialiser, `DELETE FROM iam.users WHERE email='admin@...'` puis restart Hub.

### Piège 13 — VM trop petite, OOM killer tue James / OnlyOffice

**Symptôme :** `docker ps` montre des restart toutes les heures sur les containers lourds.
**Cause :** James (~512 MB) + OnlyOffice (~1 GB) + Postgres (~256 MB) + Hub (~512 MB) → 4 GB serré.
**Résolution :** VM avec 8 GB RAM minimum. Ou désactiver les profils `infra-james`, `infra-onlyoffice` si non utilisés (`COMPOSE_PROFILES=core` dans `.env`).

### Piège 14 — `JWT_ISSUER` mal configuré, tokens invalidés

**Symptôme :** Le hub redémarre, plus aucun JWT existant n'est accepté.
**Cause :** `JWT_ISSUER` modifié → tous les tokens signés sous l'ancien issuer sont rejetés.
**Résolution :** Choisir `JWT_ISSUER` (généralement `www.<DOMAIN>`) et **ne plus le changer**. Il fait partie de la signature du token. En cas de change forcé, prévenir les agents IA et regénérer les API keys.

---

## 14. Pour aller plus loin

- Voir [[201-deploiement-docker|Déploiement Docker]] pour le détail du `docker-compose.yml`, des profils Compose, des volumes persistants et du build du JAR.
- Voir [[40-acme-worker|AcmeWorker]] pour la mécanique complète ACME et les renouvellements automatiques.
- Voir `howto-18-restaurer-backup.md` pour la procédure de restore.
