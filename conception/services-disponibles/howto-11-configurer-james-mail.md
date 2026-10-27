# HOWTO 11 — Configurer Apache James pour envoyer et recevoir des mails

**Niveau :** Senior
**Prérequis :** SocleHub V005 démarré, `docker_worker` opérationnel, `vault_worker` initialisé, `cloudflare` configuré (zone + API token), un domaine déjà routé sur le serveur (DNS A vers serverIp), `iam_worker` avec quelques users
**Temps estimé :** 90 minutes (dont propagation DNS ~10 min)

---

## 1. Contexte

SocleHub embarque un **serveur mail complet** basé sur **Apache James 3.9** (image `apache/james:jpa-3.9.0`), provisionné et piloté par `james_worker` (voir [[20-james-worker|20-james-worker]] pour la référence complète). Il fournit SMTP/IMAP/Webmail et gère :

- DKIM (signature sortante, clé RSA 2048 stockée dans Vault, publication TXT via Cloudflare)
- SPF/DMARC (recommandations DNS)
- MX direct (votre IP) ou relay (Brevo, AWS SES, etc.)
- Provisioning automatique des boîtes mails sur les utilisateurs IAM
- Quotas par boîte/domaine
- Warm-up progressif IP pour préserver la réputation
- Scan antivirus ClamAV des pièces jointes (cf. `mail_attachment_worker`)
- Synchronisation IAM ↔ mailboxes

Vous devez : provisionner James si pas encore fait, ajouter le domaine `thesocle.net`, configurer DKIM, configurer le MX (mode direct), créer une boîte `alice@thesocle.net`, tester un envoi sortant, vérifier le score de réputation, et synchroniser les utilisateurs IAM en boîtes mail.

L'ensemble du flow est idempotent : chaque action peut être rejouée sans casser l'existant. James persiste dans le schéma PostgreSQL `mail` (tables `mail.mail_domain`, `mail.mail_mailbox`, `mail.mail_blacklist_check`, etc.) en parallèle de son propre stockage interne JPA.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              SocleHub                                    │
│                                                                          │
│  ┌─────────────────┐    Actions MCP/REST    ┌──────────────────┐         │
│  │  Operator       │ ──────────────────────►│  james_worker    │         │
│  └─────────────────┘                        └────────┬─────────┘         │
│                                                      │                   │
│              ┌───────────────────────────────────────┼─────────┐         │
│              │                                       │         │         │
│              ▼                                       ▼         ▼         │
│   ┌──────────────────┐                     ┌──────────────┐  ┌────────┐  │
│   │ JamesAdminClient │ ──HTTP 8000───►     │   Vault      │  │  PG    │  │
│   │ /domains, /users │                     │  - DKIM keys │  │ schema │  │
│   │ /quota, /events  │                     │  - mailbox pw│  │  mail  │  │
│   └────────┬─────────┘                     └──────────────┘  └────────┘  │
│            │                                                             │
│            │   ┌──────────────────────┐                                  │
│            └──►│  Container apache    │                                  │
│                │  /james:jpa-3.9.0    │                                  │
│                │   ports 25,143,465,  │                                  │
│                │         587,993,     │                                  │
│                │         8000 (admin) │                                  │
│                └──────────────────────┘                                  │
│                                                                          │
│   ┌──────────────────┐    creates DNS records       ┌──────────────┐     │
│   │ CloudflareService│ ──────────────────────────►  │ Cloudflare   │     │
│   │  - A mail.<dom>  │                               │  DNS zone   │     │
│   │  - MX 10 mail.   │                               │              │     │
│   │  - TXT _domainkey│                               └──────────────┘     │
│   │  - TXT SPF/DMARC │                                                    │
│   └──────────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────────┘
                                                                            
        ▲                  ▲                   ▲                            
        │ SMTP 25          │ SMTP submit 587   │ IMAP 993                   
        │                  │ (auth + TLS)      │ (clients lisent)           
   Internet              Mail clients       Mail clients                    
   (autres MTA)
```

---

## 3. Étape 1 — Provisionner Apache James (one-shot)

L'action `provision_james` télécharge l'image, crée le container sur le réseau Docker SocleHub, et le démarre.

> **Convention REST (3.12.1)** : toutes les actions des Workers s'invoquent en `POST /api/actions/<worker>/<action>` avec un corps JSON (même vide `{}` pour les actions sans paramètre). Le préfixe historique `/admin/workers/<worker>/actions/<action>` n'existe plus pour exécuter une action — `/admin/workers` (GET) ne sert qu'au statut agrégé.

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/provision_james \
  -H "Content-Type: application/json" \
  -d '{}'

# Réponse :
# {
#   "success": true,
#   "data": {
#     "status":      "provisioned",
#     "containerId": "a3f8e1...",
#     "image":       "apache/james:jpa-3.9.0"
#   }
# }
```

Code Java (`JamesWorker.handleProvisionJames()`) :

```java
package eu.lmvi.soclehub.worker;

private ActionResult handleProvisionJames(ActionParameters params) {
    try {
        logger.info("[worker:james_worker][step:provision] Provisioning Apache James container");
        String image = "apache/james";
        String tag   = "jpa-3.9.0";
        dockerService.pullImage(image, tag);

        Map<String, String> env = new LinkedHashMap<>();
        env.put("JAMES_ADMIN_API_PORT", "8000");
        String network = properties.getDocker().getNetwork();

        String containerId = dockerService.createContainer(
                "soclehub-james", image, tag, env, network);

        if (containerId != null && !containerId.isEmpty()) {
            dockerService.startContainer(containerId);
            return ActionResult.ofSuccess(Map.of(
                    "status",      "provisioned",
                    "containerId", containerId,
                    "image",       image + ":" + tag
            ));
        }
        return ActionResult.ofFailure("Failed to create James container");
    } catch (Exception e) {
        return ActionResult.ofFailure("Provisioning failed: " + e.getMessage());
    }
}
```

**Points clés :**

- L'image `jpa-3.9.0` utilise une persistence JPA (H2 par défaut côté James). Pour la prod, on configure James pour utiliser PostgreSQL (variables d'env supplémentaires dans la charte de déploiement).
- Le container expose les ports 25, 143, 465, 587, 993, 8000 sur le réseau Docker `soclehub_default`. Pour exposer sur Internet, il faut publier 25, 587, 993 via le `docker-compose.yml`.
- L'action est idempotente : si le container existe déjà, `dockerService.createContainer()` retourne l'ID existant. Pour repartir from scratch, faire un `docker rm -f soclehub-james` au préalable.

Vérifier :

```bash
docker ps | grep soclehub-james
# CONTAINER ID  IMAGE                     STATUS    PORTS                NAMES
# a3f8e1...     apache/james:jpa-3.9.0    Up 30s    25/tcp, 143/tcp,...  soclehub-james

curl -sS -X POST http://localhost:8080/api/actions/james_worker/get_status \
  -H "Content-Type: application/json" -d '{}' | jq
# {
#   "name":             "james_worker",
#   "running":          true,
#   "jamesReachable":   true,
#   "jamesVersion":     "3.9.0",
#   "activeMailboxes":  0,
#   "reputationScore":  20,
#   "smtpMode":         "direct"
# }
```

---

## 4. Étape 2 — Ajouter un domaine

Cette action fait 4 choses : ajoute le domaine dans James, persiste en DB, crée les records DNS Cloudflare (A `mail.<dom>`, CNAMEs `smtp.`/`imap.`, MX), demande un cert TLS pour `mail.<dom>`.

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/add_domain \
  -H "Content-Type: application/json" \
  -d '{"domain": "thesocle.net"}'

# Réponse :
# {
#   "success": true,
#   "data": {
#     "domain": "thesocle.net",
#     "status": "added",
#     "steps": [
#       "james_domain_added",
#       "db_persisted",
#       "dns_a_mail_created",
#       "dns_cname_smtp_created",
#       "dns_cname_imap_created",
#       "dns_mx_created"
#     ]
#   }
# }
```

Code de référence (extrait `JamesWorker.handleAddDomain()`) :

```java
private ActionResult handleAddDomain(ActionParameters params) {
    String domain   = params.getString("domain");
    String serverIp = properties.getServerIp();
    String zoneId   = properties.getCloudflare().getZoneId();
    List<String> steps = new ArrayList<>();
    try {
        // Step 1: Add domain to James via REST admin API
        boolean added = jamesAdminClient.addDomain(domain);
        if (!added) {
            return ActionResult.ofFailure("James API refused to add domain: " + domain);
        }
        steps.add("james_domain_added");

        // Step 2: Persist in mail.mail_domain (idempotent ON CONFLICT)
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                 "INSERT INTO mail.mail_domain (domain, smtp_mode, max_message_size_mb) " +
                 "VALUES (?, ?, ?) ON CONFLICT (domain) DO NOTHING")) {
            ps.setString(1, domain);
            ps.setString(2, properties.getJames().getSmtpMode());
            ps.setInt(3, properties.getJames().getDefaultMaxMessageSizeMb());
            ps.executeUpdate();
        }
        steps.add("db_persisted");

        // Step 3: Auto-provision DNS records (A, CNAME, MX) + TLS cert (best-effort)
        if (zoneId != null && !zoneId.isBlank() && serverIp != null && !serverIp.isBlank()) {
            provisionMailDns(domain, serverIp, zoneId, steps);
        } else {
            steps.add("dns_skipped_no_config");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("domain", domain);
        result.put("status", "added");
        result.put("steps",  steps);
        return ActionResult.ofSuccess(result);
    } catch (Exception e) {
        return ActionResult.ofFailure("Add domain failed: " + e.getMessage());
    }
}
```

**Points clés :**

- L'ordre est crucial : James **doit** connaître le domaine avant qu'on crée des mailboxes dessus, sinon `PUT /users/<email>` renvoie HTTP 400 "Domain does not exist in DomainList" (cf. BUG-2026-04-23 jamesadminclient-put-usersemail-400-ordre-provision).
- DNS provisioning best-effort : si Cloudflare répond mal ou le record existe déjà, on log un warning et on continue.
- Le record A `mail.thesocle.net` est créé en `proxied=false` (DNS-only, pas de proxy Cloudflare) — sinon Cloudflare bloquerait le port 25.

Vérifier la propagation DNS :

```bash
dig +short MX thesocle.net
# 10 mail.thesocle.net.

dig +short A mail.thesocle.net
# 51.255.205.19   (votre serverIp)
```

---

## 5. Étape 3 — Configurer DKIM

DKIM signe les mails sortants avec une clé RSA 2048. La clé privée est stockée dans Vault à `soclehub/james/dkim/<domain>` (cf. [[11-vault-worker|11-vault-worker]]). La clé publique est publiée en TXT DNS sur `<selector>._domainkey.<domain>` via Cloudflare (cf. [[41-dns-sync-worker|41-dns-sync-worker]]).

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/configure_dkim \
  -H "Content-Type: application/json" \
  -d '{
        "domain": "thesocle.net",
        "selector": "default"
      }'

# Réponse :
# {
#   "success": true,
#   "data": {
#     "domain":           "thesocle.net",
#     "dkim_enabled":     true,
#     "selector":         "default",
#     "dns_record_name":  "default._domainkey.thesocle.net",
#     "dns_record_content": "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOC..."
#   }
# }
```

Code (extrait `JamesWorker.handleConfigureDkim()`) :

```java
String dkimSelector  = "default";
String dkimRecordName = dkimSelector + "._domainkey." + domain;

// 1. Generate RSA 2048 keypair
java.security.KeyPairGenerator kpg = java.security.KeyPairGenerator.getInstance("RSA");
kpg.initialize(2048);
java.security.KeyPair kp = kpg.generateKeyPair();

// 2. Store private key in Vault (PEM format)
String privKeyPem = "-----BEGIN PRIVATE KEY-----\n"
        + java.util.Base64.getMimeEncoder(64, "\n".getBytes())
                .encodeToString(kp.getPrivate().getEncoded())
        + "\n-----END PRIVATE KEY-----";
vaultService.writeSecret("soclehub/james/dkim/" + domain,
        Map.of("private_key", privKeyPem, "selector", dkimSelector,
               "created_at", Instant.now().toString()));

// 3. Publish public key as TXT record on DNS
String pubKeyBase64 = java.util.Base64.getEncoder().encodeToString(kp.getPublic().getEncoded());
String dkimValue    = "v=DKIM1; k=rsa; p=" + pubKeyBase64;
String cfId = cloudflareService.createRecord(zoneId, "TXT", dkimRecordName, dkimValue, 1, false);
// → 1 = TTL Auto, false = not proxied

// 4. Persist in DB (mail.mail_domain.dkim_enabled, dkim_selector)
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(
         "UPDATE mail.mail_domain SET dkim_enabled = TRUE, dkim_selector = ?, " +
         "updated_at = NOW() WHERE domain = ?")) {
    ps.setString(1, dkimSelector);
    ps.setString(2, domain);
    ps.executeUpdate();
}
```

**Points clés :**

- Selector recommandé : `default` ou `s1`/`s2024` pour faciliter la rotation. Le selector est libre mais doit matcher la conf James.
- La clé privée n'est **jamais** sortie de Vault. James lit Vault au démarrage et configure son module DKIM.
- Vérifier la TXT record après ~30 secondes :

```bash
dig +short TXT default._domainkey.thesocle.net
# "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOC..."
```

Ajouter manuellement les SPF et DMARC (le worker ne les pose pas automatiquement) :

```bash
# SPF — autoriser ce serveur à envoyer pour le domaine
curl -sS -X POST http://localhost:8080/api/actions/dns_sync_worker/create_record \
  -H "Content-Type: application/json" \
  -d '{
        "zone_name": "thesocle.net",
        "type":      "TXT",
        "name":      "thesocle.net",
        "content":   "v=spf1 mx ~all",
        "ttl":       3600
      }'

# DMARC — politique relaxe + reporting
curl -sS -X POST http://localhost:8080/api/actions/dns_sync_worker/create_record \
  -H "Content-Type: application/json" \
  -d '{
        "zone_name": "thesocle.net",
        "type":      "TXT",
        "name":      "_dmarc.thesocle.net",
        "content":   "v=DMARC1; p=quarantine; rua=mailto:dmarc@thesocle.net; pct=100",
        "ttl":       3600
      }'
```

---

## 6. Étape 4 — Configurer le MX

Deux modes possibles : direct (votre serveur reçoit les mails) ou relay (un relais externe livre via James).

### 6.1 Mode direct

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/configure_mx_direct \
  -H "Content-Type: application/json" \
  -d '{
        "domain":   "thesocle.net",
        "priority": 10
      }'
```

Cela crée (ou vérifie) le record MX `thesocle.net IN MX 10 mail.thesocle.net.` côté Cloudflare.

### 6.2 Mode relay (Brevo, SES, Mailgun, etc.)

Si vous ne voulez pas exposer le port 25 sur Internet (recommandé pour les serveurs résidentiels ou IPs avec mauvaise réputation), passer par un relay.

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/configure_mx_relay \
  -H "Content-Type: application/json" \
  -d '{
        "domain":      "thesocle.net",
        "relay_host":  "smtp-relay.brevo.com",
        "relay_port":  587,
        "relay_user":  "smtp@thesocle.net",
        "relay_pass":  "votre-mot-de-passe-brevo"
      }'
```

Le worker :

- Met à jour `mail.mail_domain.smtp_mode = 'relay'` et stocke `relay_host`, `relay_port`.
- Stocke `relay_user`/`relay_pass` dans Vault `soclehub/james/relay/<domain>`.
- Configure James pour acheminer les mails sortants via ce relay (mailetcontainer.xml).
- Pour la **réception**, vous devez configurer le relay externe pour forwarder vers vous (ou continuer en MX direct pour la partie réception).

---

## 7. Étape 5 — Créer une boîte mail

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/create_mailbox \
  -H "Content-Type: application/json" \
  -d '{
        "user":        "alice",
        "domain":      "thesocle.net",
        "iam_user_id": "9c4f1e2a-7b3d-4e1f-8c0a-1234567890ab",
        "quota_mb":    1024,
        "forward_to":  null
      }'

# Réponse :
# {
#   "success": true,
#   "data": {
#     "username":    "alice@thesocle.net",
#     "domain":      "thesocle.net",
#     "quota_mb":    1024,
#     "iam_user_id": "9c4f1e2a-...",
#     "status":      "created"
#   }
# }
```

Code (extrait `JamesWorker.handleCreateMailbox()`) :

```java
private ActionResult handleCreateMailbox(ActionParameters params) {
    String user      = params.getString("user");
    String domain    = params.getString("domain");
    String username  = user + "@" + domain;
    String iamUserId = params.getString("iam_user_id");
    String forwardTo = params.getString("forward_to");
    int quotaMb = params.getInteger("quota_mb") != null
            ? params.getInteger("quota_mb")
            : properties.getJames().getDefaultQuotaMb();
    try {
        // S'assurer que le domaine est connu de James (auto-register sinon)
        try {
            List<String> knownDomains = jamesAdminClient.listDomains();
            if (knownDomains == null || !knownDomains.contains(domain)) {
                jamesAdminClient.addDomain(domain);
            }
        } catch (Exception ignored) { /* continue best-effort */ }

        // Generate a random 16-char password and create the user via James admin API
        String password = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        boolean created = jamesAdminClient.createUser(username, password);
        if (!created) {
            return ActionResult.ofFailure("James API refused to create user: " + username);
        }

        // Set quota in James (in bytes)
        jamesAdminClient.setQuota(username, (long) quotaMb * 1024 * 1024);

        // Stocker le password en Vault
        vaultService.writeSecret("soclehub/james/users/" + username,
                Map.of("password",   password,
                       "created_at", Instant.now().toString()));

        // Persist in DB with optional IAM link and forward
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                 "INSERT INTO mail.mail_mailbox " +
                 "(username, domain, iam_user_id, quota_mb, forward_to, status) " +
                 "VALUES (?, ?, ?::uuid, ?, ?, 'active') " +
                 "ON CONFLICT (username) DO NOTHING")) {
            ps.setString(1, username);
            ps.setString(2, domain);
            if (iamUserId != null && !iamUserId.isBlank()) ps.setString(3, iamUserId);
            else ps.setNull(3, java.sql.Types.OTHER);
            ps.setInt(4, quotaMb);
            if (forwardTo != null && !forwardTo.isBlank()) ps.setString(5, forwardTo);
            else ps.setNull(5, java.sql.Types.VARCHAR);
            ps.executeUpdate();
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("username",    username);
        result.put("domain",      domain);
        result.put("quota_mb",    quotaMb);
        result.put("iam_user_id", Objects.toString(iamUserId, ""));
        result.put("status",      "created");
        return ActionResult.ofSuccess(result);
    } catch (Exception e) {
        return ActionResult.ofFailure("Create mailbox failed: " + e.getMessage());
    }
}
```

**Points clés :**

- Le mot de passe est généré aléatoirement et stocké en Vault — l'utilisateur final n'en a pas besoin si son client mail utilise le SSO IAM (à venir).
- `iam_user_id` lie la boîte à un user IAM : si ce user est supprimé, on peut auto-supprimer la boîte (action `unsync_user`).
- `forward_to` définit un alias (ex : `alice@thesocle.net` forward vers `alice.martin@gmail.com`).

Récupérer le mot de passe pour configurer un client IMAP/SMTP :

```bash
docker exec soclehub-vault vault kv get -field=password \
  soclehub/james/users/alice@thesocle.net
```

---

## 8. Étape 6 — Tester un envoi sortant

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/test_outbound \
  -H "Content-Type: application/json" \
  -d '{"to": "yourname+test@gmail.com"}'

# Réponse :
# {"success":true,"data":{"to":"yourname+test@gmail.com","status":"test_sent","subject":"SocleHub James Test Email"}}
```

Pour un envoi **réel** (pas le test factice), utiliser `send_via_james` :

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/send_via_james \
  -H "Content-Type: application/json" \
  -d '{
        "from":    "alice@thesocle.net",
        "to":      "yourname+test@gmail.com",
        "subject": "Test depuis SocleHub",
        "body":    "Ceci est un test."
      }'
```

Vérifier la livraison :

1. Dans la boîte de réception Gmail, ouvrir le mail et "Voir l'original".
2. Vérifier les headers :
   - `Received-SPF: pass`
   - `Authentication-Results: ...; dkim=pass header.d=thesocle.net`
   - `Authentication-Results: ...; dmarc=pass`

Si `dkim=fail`, vérifier le TXT record DKIM (Étape 3) et que James a bien chargé la clé.

---

## 9. Étape 7 — Vérifier la réputation

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/get_reputation_report \
  -H "Content-Type: application/json" \
  -d '{"domain": "thesocle.net"}'

# Réponse :
# {
#   "success": true,
#   "data": {
#     "domain":            "thesocle.net",
#     "dkim_enabled":      true,
#     "spf_configured":    true,
#     "dmarc_configured":  true,
#     "warmup_enabled":    false,
#     "warmup_week":       0,
#     "reputation_score":  100   // 30 DKIM + 30 SPF + 20 DMARC + 20 base
#   }
# }
```

Score breakdown :

- DKIM activé → +30
- SPF configuré → +30
- DMARC configuré → +20
- Base (domaine connu de James) → +20

Vérifier les blacklists IP (manuel) :

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/check_blacklist \
  -H "Content-Type: application/json" \
  -d '{"ip": "51.255.205.19"}'
```

---

## 10. Étape 8 — Synchroniser les utilisateurs IAM en boîtes mail

Pour provisionner automatiquement une boîte par user IAM :

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/sync_iam_users \
  -H "Content-Type: application/json" \
  -d '{
        "domain":         "thesocle.net",
        "tenant_filter":  "thesocle",
        "default_quota_mb": 1024
      }'

# Réponse :
# {
#   "success": true,
#   "data": {
#     "synced":   12,
#     "skipped":  3,
#     "errors":   0,
#     "domain":   "thesocle.net"
#   }
# }
```

Le worker SELECT tous les `iam.db_users` (filtrés par `tenant_id` si fourni), pour chaque user :

- Si une mailbox existe déjà avec `iam_user_id = user.x_id` → skip.
- Sinon → appel `create_mailbox` avec `user = local-part de l'email`.

---

## 11. Validation

### 11.1 SQL

```sql
-- Domaines configurés
SELECT domain, smtp_mode, dkim_enabled, dkim_selector,
       spf_configured, dmarc_configured, max_message_size_mb
FROM mail.mail_domain;

-- Boîtes mail existantes
SELECT username, domain, quota_mb, iam_user_id, forward_to, status, created_at
FROM mail.mail_mailbox
ORDER BY created_at DESC;
```

### 11.2 SMTP test

```bash
# Avec swaks (apt install swaks)
swaks --to test@gmail.com \
      --from alice@thesocle.net \
      --server mail.thesocle.net:587 \
      --auth LOGIN \
      --auth-user alice@thesocle.net \
      --auth-password "$(docker exec soclehub-vault vault kv get -field=password soclehub/james/users/alice@thesocle.net)" \
      --tls
```

### 11.3 IMAP test

```bash
# openssl s_client connect direct, puis LOGIN
openssl s_client -connect mail.thesocle.net:993 -crlf
# A LOGIN alice@thesocle.net <password>
# A LIST "" "*"
# A LOGOUT
```

### 11.4 DNS records

```bash
for record in "MX thesocle.net" "A mail.thesocle.net" "TXT default._domainkey.thesocle.net" "TXT thesocle.net" "TXT _dmarc.thesocle.net"; do
    echo "=== ${record} ==="
    dig +short ${record}
done
```

### 11.5 Test DKIM/SPF/DMARC en ligne

Envoyer un mail à `check-auth@verifier.port25.com` depuis `alice@thesocle.net` — la réponse automatique détaille SPF/DKIM/DMARC.

---

## 12. Pièges courants

### Piège 1 — `James container not found. Run provision_james first.`

**Cause :** Le container n'existe pas (jamais provisionné, ou supprimé manuellement).
**Résolution :** `provision_james` puis `start_james`. Si ça échoue, vérifier le réseau Docker :

```bash
docker network inspect soclehub_default | jq '.[].Containers'
```

### Piège 2 — `James API refused to create user: alice@thesocle.net (vérifier que le domaine 'thesocle.net' est enregistré...)`

**Cause :** Le domaine n'est pas dans la DomainList de James. C'est le bug BUG-2026-04-23 jamesadminclient-put-usersemail-400-ordre-provision : il faut **toujours** ajouter le domaine avant la mailbox.
**Résolution :** Le worker auto-register depuis V005 (`handleCreateMailbox` vérifie via `jamesAdminClient.listDomains()`). Si ça échoue quand même, faire `add_domain` manuellement.

### Piège 3 — Mails envoyés finissent en spam

**Cause possible 1 :** SPF non configuré → autoriser l'IP du serveur dans le SPF.
**Cause possible 2 :** DKIM non configuré OU TXT record mal copié.
**Cause possible 3 :** Pas de DMARC.
**Cause possible 4 :** IP du serveur sur une blacklist.
**Cause possible 5 :** Pas de reverse DNS (PTR) qui matche le HELO.
**Résolution :** Test sur https://www.mail-tester.com (envoyer un mail depuis `alice@thesocle.net`, viser score > 9/10). Configurer le PTR chez l'hébergeur.

### Piège 4 — `dkim=fail` dans les headers du mail reçu

**Cause :** La TXT record DKIM ne s'est pas propagée OU contient des espaces parasites OU le selector ne matche pas la conf James.
**Résolution :**

```bash
dig +short TXT default._domainkey.thesocle.net | tr -d '"'
# Doit afficher exactement v=DKIM1; k=rsa; p=<base64 sans espaces>
```

Si la valeur a des espaces ou retours chariot, recréer la record manuellement via Cloudflare UI.

### Piège 5 — Port 25 bloqué par le FAI/cloud provider

**Cause :** AWS, OVH, Hetzner et la majorité des fournisseurs bloquent le port 25 par défaut (anti-spam).
**Résolution :** Soit demander l'ouverture (justificatif requis), soit passer en `configure_mx_relay` avec un relay externe (Brevo, SES, Mailgun).

### Piège 6 — `Failed to create James container: container name already in use`

**Cause :** Un container `soclehub-james` existe déjà (peut-être en état `Exited`).
**Résolution :** `docker rm -f soclehub-james` puis retenter `provision_james`. Ou utiliser `start_james` qui ne recrée pas mais démarre l'existant.

### Piège 7 — La boîte est créée mais l'utilisateur ne peut pas se connecter en IMAP

**Cause :** Le mot de passe en Vault diffère de celui réellement set dans James (race condition rare entre `createUser` et `setQuota`).
**Résolution :** Reset le password :

```bash
NEW_PW=$(openssl rand -hex 12)
docker exec soclehub-james curl -X PUT \
    "http://localhost:8000/users/alice@thesocle.net" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"${NEW_PW}\"}"
docker exec soclehub-vault vault kv put \
    soclehub/james/users/alice@thesocle.net password="${NEW_PW}"
```

### Piège 8 — `quota_mb` ignoré, la boîte accepte des mails sans limite

**Cause :** `setQuota()` côté James s'attend aux **bytes** (pas MB). Le worker convertit (`quotaMb * 1024 * 1024`) mais une mauvaise valeur (par exemple négative ou 0) est interprétée comme "unlimited".
**Résolution :** Vérifier `get_mailbox_quota` :

```bash
curl -sS -X POST http://localhost:8080/api/actions/james_worker/get_mailbox_quota \
  -d '{"username":"alice@thesocle.net"}'
```

### Piège 9 — `Cloudflare TXT record creation failed for default._domainkey.thesocle.net`

**Cause :** Le record dépasse 255 caractères et Cloudflare le refuse en single string. Le valeur DKIM (clé publique RSA 2048) fait ~390 chars.
**Résolution :** Cloudflare gère cela automatiquement en split-string si on passe la valeur dans des quotes. Si l'erreur persiste, créer manuellement le record en split :

```
"v=DKIM1; k=rsa; p=MIIBIjANB...partie1" "...partie2"
```

### Piège 10 — `add_domain` retourne `dns_skipped_no_config`

**Cause :** `CLOUDFLARE_ZONE_ID` ou `SERVER_IP` ne sont pas configurés dans `.env` (noms sans préfixe `SOCLEHUB_` en 3.12.1).
**Résolution :** Renseigner ces variables, redémarrer le hub :

```bash
SERVER_IP=51.255.205.19
CLOUDFLARE_ZONE_ID=ab12cd34ef56...
CLOUDFLARE_API_TOKEN=tok_xxxxx
```

### Piège 11 — Synchronisation IAM crée des doublons

**Cause :** L'utilisateur a un email `alice@gmail.com` mais le domaine cible est `thesocle.net`. Le worker prend le local-part `alice` et crée `alice@thesocle.net`. Si un autre user avait `alice@autre.com`, on aurait deux mailboxes pour la même local-part.
**Résolution :** Filtrer par `tenant_id` qui matche le domaine. Ou pré-filtrer côté SQL :

```sql
-- Lister les users qui auraient une collision
SELECT split_part(email, '@', 1) AS local_part, count(*)
FROM iam.db_users WHERE tenant_id = 'thesocle'
GROUP BY 1 HAVING count(*) > 1;
```

### Piège 12 — Mail entrant non délivré (PORT 25 ouvert mais aucun mail ne rentre)

**Cause possible 1 :** MX pointe vers un mauvais host (par exemple Cloudflare proxy).
**Cause possible 2 :** Firewall bloque INPUT 25 (UFW, iptables).
**Cause possible 3 :** James n'écoute pas sur 0.0.0.0:25 mais seulement sur 127.0.0.1:25 (config par défaut sur certaines images).
**Résolution :**

```bash
# Vérifier l'écoute
docker exec soclehub-james netstat -tlnp | grep :25
# Doit afficher 0.0.0.0:25 et pas seulement 127.0.0.1:25

# Vérifier le firewall hôte
sudo ufw status numbered | grep 25/tcp

# Tester depuis l'extérieur
telnet mail.thesocle.net 25
# 220 mail.thesocle.net SMTP James 3.9.0 ready
```

---

## 13. Pour aller plus loin

- [[20-james-worker|20-james-worker]] — référence complète des actions du `james_worker` (provisioning, domaines, DKIM, MX, mailboxes, réputation, warm-up, sync IAM).
- [[21-mail-worker|21-mail-worker]] — l'autre canal d'envoi (SMTP applicatif / templates), à distinguer de l'envoi via James.
- [[41-dns-sync-worker|41-dns-sync-worker]] — gestion des records DNS (A, MX, TXT SPF/DKIM/DMARC).
- [[40-acme-worker|40-acme-worker]] — certs TLS de `mail.<domain>` qui sécurisent IMAPS/SMTPS.
- [[11-vault-worker|11-vault-worker]] — stockage des clés DKIM, mots de passe mailbox et creds de relais.
- [[howto-08-creer-utilisateur-iam|HOWTO 08]] — créer les users IAM avant `sync_iam_users`.
- [[howto-12-configurer-acme-cloudflare|HOWTO 12]] — cert TLS + zone Cloudflare.
- Spec DKIM (RFC 6376) : https://datatracker.ietf.org/doc/html/rfc6376
- Spec DMARC (RFC 7489) : https://datatracker.ietf.org/doc/html/rfc7489
