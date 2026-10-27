# HOWTO 12 — Émettre un certificat TLS Let's Encrypt automatique via ACME + Cloudflare DNS-01

**Niveau :** Senior
**Prérequis :** SocleHub V005 démarré, `vault_worker` initialisé, `cloudflare` configuré (zone ID + API token avec scope `Zone:DNS:Edit`), domaine déjà routé sur le serveur (record A en place ou non — le challenge DNS-01 ne nécessite **pas** que le domaine pointe sur le serveur)
**Temps estimé :** 20 minutes (dont 1-2 min de propagation DNS)

---

## 1. Contexte

SocleHub gère **automatiquement** les certificats TLS pour son domaine principal et tous les sous-domaines des apps déployées. L'implémentation utilise **acme4j** côté Java + **Let's Encrypt** comme CA (l'URL de directory est paramétrable, on peut basculer sur ZeroSSL ou un Pebble local pour les tests).

La méthode de validation est **DNS-01** uniquement (pas HTTP-01) : le worker crée un record TXT `_acme-challenge.<domain>` via l'API Cloudflare, attend la propagation, déclenche le challenge ACME, attend le verdict, puis génère un CSR, finalise l'ordre, télécharge le certificat et le charge à chaud dans le `SslManager` Tomcat.

L'avantage du DNS-01 :

- Pas besoin que le domaine **résolve** vers ce serveur (utile pour des certs wildcard ou des certs émis avant migration).
- Compatible avec les certificats wildcard (`*.thesocle.net`).
- Aucune ouverture de port 80 nécessaire.

Toute l'opération est cyclée toutes les 24h par `AcmeWorker.doWork()` qui détecte les certs expirant à < 30 jours et les renouvelle automatiquement. La paire privée + chaîne PEM est stockée dans Vault à `soclehub/certs/<domain>` (clés `private_key` et `chain`), via le [[11-vault-worker|vault_worker]]. Les records DNS du challenge passent par Cloudflare (cf. [[41-dns-sync-worker|dns_sync_worker]]).

Vous devez : émettre un cert pour `app2.thesocle.net`, vérifier que Tomcat l'a chargé et le sert, déclencher un renouvellement forcé pour valider la chaîne, et inspecter le cycle de vie automatique.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              SocleHub                                    │
│                                                                          │
│  ┌──────────────────┐  request_certificate(domain)                       │
│  │  acme_worker     │ ─────────────────────────┐                         │
│  │ (cycle 24h)      │                          │                         │
│  └──────┬───────────┘                          │                         │
│         │                                      ▼                         │
│         │                          ┌──────────────────────┐              │
│         │                          │  AcmeService         │              │
│         │                          │  - newOrder          │              │
│         │                          │  - getDigest         │              │
│         │                          │  - createTxtRecord   │              │
│         │                          │  - waitForDnsProp    │              │
│         │                          │  - triggerChallenge  │              │
│         │                          │  - pollAuthorization │              │
│         │                          │  - generateCsr       │              │
│         │                          │  - executeOrder      │              │
│         │                          │  - downloadCert      │              │
│         │                          └──┬─────┬─────────┬───┘              │
│         │                             │     │         │                  │
│         │      ┌──────────────────────┘     │         └─────────┐        │
│         │      ▼                            ▼                   ▼        │
│         │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│         │  │ Cloudflare API │  │ Vault          │  │ SslManager     │    │
│         │  │ TXT _acme-ch.. │  │ certs/<domain> │  │ (live reload   │    │
│         │  └────────────────┘  │  - private_key │  │  Tomcat ssl)   │    │
│         │           │          │  - chain.pem   │  └────────────────┘    │
│         │           ▼          └────────────────┘                        │
│         │   ┌────────────────┐                                           │
│         │   │ Cloudflare DNS │                                           │
│         │   │ zone           │                                           │
│         │   └────────────────┘                                           │
│         │           │                                                    │
│         │           ▼                                                    │
│         │   ┌────────────────┐                                           │
│         └──►│ Let's Encrypt  │  validates _acme-challenge TXT            │
│             │ ACME directory │  → returns signed certificate             │
│             └────────────────┘                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Pré-requis Cloudflare

### 3.1 Créer un API Token avec les bonnes permissions

Dans le dashboard Cloudflare → My Profile → API Tokens → Create Token → "Custom token" :

- Permissions :
  - `Zone:DNS:Edit` — pour créer/modifier les TXT records
  - `Zone:Zone:Read` — pour lister les zones (utile au registre DNS)
- Zone Resources : Include → Specific zone → `thesocle.net`
- TTL : 1 an minimum (le rotation manuel se fait via `vault_worker`)

Le token ressemble à : `1234567890abcdef1234567890abcdef12345678`

### 3.2 Configurer `.env`

```bash
# soclehub/docker/.env
DOMAIN=thesocle.net
SERVER_IP=51.255.205.19

CLOUDFLARE_API_TOKEN=1234567890abcdef1234567890abcdef12345678
CLOUDFLARE_ZONE_ID=ab12cd34ef56gh78ij90kl12mn34op56
CLOUDFLARE_DEFAULT_ZONE=thesocle.net

# Email du compte ACME = email admin bootstrap du Hub
BOOTSTRAP_ADMIN_EMAIL=acme@thesocle.net
```

> **Note (3.12.1)** : les variables n'ont **pas** de préfixe `SOCLEHUB_` (cf. `application.yml` : `${DOMAIN}`, `${SERVER_IP}`, `${CLOUDFLARE_API_TOKEN}`, `${CLOUDFLARE_ZONE_ID}`, `${CLOUDFLARE_DEFAULT_ZONE}`). L'email du compte ACME provient de `${BOOTSTRAP_ADMIN_EMAIL}` (propriété `soclehub.acme.account-email`). L'URL de directory est **fixée en dur** à `acme://letsencrypt.org` dans `application.yml` (clé `soclehub.acme.directory-url`) — pour basculer en staging, surcharger cette propriété Spring (pas d'env var dédiée par défaut).

Redémarrer le hub :

```bash
docker compose -f soclehub/docker/docker-compose.yml restart soclehub-hub
```

Vérifier que le worker a démarré (référence complète : [[40-acme-worker|40-acme-worker]]) :

> **Convention REST (3.12.1)** : les actions s'invoquent en `POST /api/actions/<worker>/<action>` (corps JSON, `{}` si pas de paramètre). Le préfixe `/admin/workers/...` ne sert qu'au statut agrégé en GET.

```bash
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/get_status \
  -H "Content-Type: application/json" -d '{}' | jq
# {
#   "name":            "acme_worker",
#   "running":         true,
#   "cycleCount":      0,
#   "actionCount":     0,
#   "certificateCount": 1
# }
```

---

## 4. Étape 2 — Émettre un certificat (action `request_certificate`)

```bash
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/request_certificate \
  -H "Content-Type: application/json" \
  -d '{"domain": "app2.thesocle.net"}'

# Réponse (asynchrone — le certificat est émis en background) :
# {
#   "success": true,
#   "data": {
#     "domain": "app2.thesocle.net",
#     "status": "certificate_requested",
#     "ssl_loaded": true
#   }
# }
```

Le code Java exécuté côté Worker :

```java
package eu.lmvi.soclehub.worker;

private ActionResult handleRequestCertificate(ActionParameters params) {
    String domain = params.getString("domain");
    logger.info("[worker:{}][step:request_cert] Requesting certificate for domain={}",
            getName(), domain);

    try {
        boolean success = acmeService.requestCertificate(domain);
        if (success) {
            sslManager.addCertificate(domain);  // hot-reload Tomcat
            return ActionResult.ofSuccess(Map.of(
                    "domain",     domain,
                    "status",     "certificate_requested",
                    "ssl_loaded", true
            ));
        }
        return ActionResult.ofFailure("Certificate request failed for domain: " + domain);
    } catch (Exception e) {
        return ActionResult.ofFailure("Error requesting certificate: " + e.getMessage());
    }
}
```

Et l'orchestration côté `AcmeService.requestCertificate()` (extrait simplifié de la version réelle ~200 lignes) :

```java
package eu.lmvi.soclehub.service;

public boolean requestCertificate(String domain) {
    if (accountKeyPair == null) return false;

    String directoryUrl  = getDirectoryUrl();         // acme://letsencrypt.org
    String accountEmail  = getAccountEmail();         // acme@thesocle.net
    String acmeRecordName = "_acme-challenge." + domain;
    String txtRecordId   = null;
    String zoneId        = null;

    try {
        // 1) Open ACME session, register/login account
        Session session = new Session(directoryUrl);
        Login   login   = new AccountBuilder()
                .agreeToTermsOfService()
                .addEmail(accountEmail)
                .useKeyPair(accountKeyPair)
                .createLogin(session);
        Account account = login.getAccount();

        // 2) New order for the domain
        Order order = account.newOrder().domain(domain).create();

        // 3) Process each authorization (one per domain in the SAN)
        for (Authorization auth : order.getAuthorizations()) {
            if (auth.getStatus() == Status.VALID) continue;

            // 3a) Pick the DNS-01 challenge
            Dns01Challenge dnsChallenge = auth.findChallenge(Dns01Challenge.class)
                    .orElseThrow(() -> new IllegalStateException("No DNS-01 challenge"));
            String digest = dnsChallenge.getDigest();

            // 3b) Resolve the Cloudflare zone for this domain (table dns.zones)
            zoneId = resolveZoneId(domain);

            // 3c) Create the TXT record _acme-challenge.<domain> = digest
            txtRecordId = cloudflareService.createTxtRecord(zoneId, acmeRecordName, digest);

            // 3d) Wait for DNS propagation (poll resolver up to 60s)
            waitForDnsPropagation();

            // 3e) Tell ACME server "the record is ready"
            dnsChallenge.trigger();

            // 3f) Poll authorization status until VALID or FAILED (up to 2 min)
            if (!pollAuthorization(auth)) {
                cloudflareService.deleteRecord(zoneId, txtRecordId);
                return false;
            }
        }

        // 4) Generate the domain key pair (RSA 2048 by default)
        KeyPair domainKeyPair = generateDomainKeyPair(domain);

        // 5) Build the CSR
        CSRBuilder csrBuilder = new CSRBuilder();
        csrBuilder.addDomain(domain);
        csrBuilder.sign(domainKeyPair);

        // 6) Finalize the order with the CSR
        order.execute(csrBuilder.getEncoded());

        // 7) Poll order status until VALID
        pollOrderStatus(order);

        // 8) Download certificate + intermediaries
        Certificate cert = order.getCertificate();
        StringWriter pemWriter = new StringWriter();
        cert.writeCertificate(pemWriter);
        String chainPem = pemWriter.toString();

        // 9) Persist private key + chain in Vault
        vaultService.writeSecret("soclehub/certs/" + domain, Map.of(
            "private_key", encodePemPrivateKey(domainKeyPair.getPrivate()),
            "chain",       chainPem,
            "issued_at",   Instant.now().toString(),
            "issuer",      "Let's Encrypt"
        ));

        // 10) Cleanup challenge TXT record
        if (txtRecordId != null) {
            cloudflareService.deleteRecord(zoneId, txtRecordId);
        }

        // 11) Update DB metadata
        updateCertDb(domain, cert);
        return true;
    } catch (Exception e) {
        log.error("requestCertificate: failed for domain={}", domain, e);
        if (txtRecordId != null && zoneId != null) {
            cloudflareService.deleteRecord(zoneId, txtRecordId);
        }
        return false;
    }
}
```

**Points clés :**

- Acme4j **gère** automatiquement le retry du polling et le throttling Let's Encrypt.
- `waitForDnsPropagation()` poll un resolveur public (Google `8.8.8.8`) toutes les 5s, max 12 tentatives (1 min). Si la prop est plus lente, on continue quand même : LE peut quand même valider si son resolver perso voit le record.
- Le record TXT est **toujours** supprimé à la fin (succès ou échec) pour éviter d'accumuler des records orphelins.

---

## 5. Étape 3 — Vérifier le certificat

### 5.1 Lister les certs gérés

```bash
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/list_certificates \
  -H "Content-Type: application/json" -d '{}' | jq
# {
#   "success": true,
#   "data": {
#     "certificates": [
#       {
#         "domain":         "thesocle.net",
#         "issuedAt":       "2026-04-15T10:23:45Z",
#         "expiresAt":      "2026-07-14T10:23:45Z",
#         "issuer":         "Let's Encrypt",
#         "daysRemaining":  77,
#         "expiringSoon":   false
#       },
#       {
#         "domain":         "app2.thesocle.net",
#         "issuedAt":       "2026-04-28T14:30:01Z",
#         "expiresAt":      "2026-07-27T14:30:01Z",
#         "issuer":         "Let's Encrypt",
#         "daysRemaining":  90,
#         "expiringSoon":   false
#       }
#     ],
#     "count": 2
#   }
# }
```

### 5.2 Vérifier l'expiration d'un cert spécifique

```bash
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/check_expiry \
  -H "Content-Type: application/json" \
  -d '{"domain": "app2.thesocle.net"}'
```

### 5.3 Inspecter le cert servi en TLS

```bash
echo | openssl s_client -servername app2.thesocle.net \
                        -connect app2.thesocle.net:443 2>/dev/null \
       | openssl x509 -noout -subject -issuer -dates -fingerprint

# Sortie attendue :
# subject=CN = app2.thesocle.net
# issuer=C = US, O = Let's Encrypt, CN = R3
# notBefore=Apr 28 14:30:01 2026 GMT
# notAfter=Jul 27 14:30:01 2026 GMT
# SHA1 Fingerprint=...
```

### 5.4 Inspecter le contenu Vault

```bash
docker exec soclehub-vault vault kv get -format=json soclehub/certs/app2.thesocle.net | jq
# {
#   "data": {
#     "data": {
#       "private_key": "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----",
#       "chain":       "-----BEGIN CERTIFICATE-----\nMIIF...",
#       "issued_at":   "2026-04-28T14:30:01Z",
#       "issuer":      "Let's Encrypt"
#     }
#   }
# }
```

---

## 6. Étape 4 — Tester le renouvellement forcé

L'action `force_renew` régénère le cert immédiatement (utile pour tester ou pour rotation manuelle après une fuite suspectée).

```bash
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/force_renew \
  -H "Content-Type: application/json" \
  -d '{"domain": "app2.thesocle.net"}'

# Réponse :
# {"success":true,"data":{"domain":"app2.thesocle.net","status":"certificate_renewed","ssl_reloaded":true}}
```

Vérifier que le `notBefore` est mis à jour :

```bash
echo | openssl s_client -servername app2.thesocle.net \
                        -connect app2.thesocle.net:443 2>/dev/null \
       | openssl x509 -noout -dates
```

---

## 7. Étape 5 — Vérifier le cycle automatique 24h

Le worker tourne avec `getCycleIntervalMs() = 86_400_000` (24h). À chaque cycle :

1. Liste tous les certs.
2. Pour chacun, calcule `daysRemaining` (à partir de `notAfter`).
3. Si `daysRemaining < 30` → renouvellement automatique.

```java
// Extrait AcmeWorker.doWork()
public void doWork() {
    long cycle = cycleCount.incrementAndGet();
    try {
        List<CertInfo> certs = acmeService.listCertificates();
        for (CertInfo cert : certs) {
            if (cert.isExpiringSoon()) {  // < 30 days
                logger.info("Certificate expiring soon: domain={} daysRemaining={}. Renewing...",
                        cert.getDomain(), cert.getDaysRemaining());
                boolean renewed = acmeService.requestCertificate(cert.getDomain());
                if (renewed) {
                    sslManager.addCertificate(cert.getDomain());
                }
            }
        }
    } catch (Exception e) {
        logger.error("Error during certificate renewal check", e);
    }
}
```

L'action `force_check_all` permet de forcer manuellement ce cycle :

```bash
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/force_check_all \
  -d '{}'
```

---

## 8. Étape 6 — Cas particulier : initial cert au démarrage

Au démarrage, `AcmeWorker.initialize()` vérifie si un certificat existe pour `properties.domain`. Sinon, il en demande un en background (Virtual Thread) pour ne pas bloquer le MOP supervisor :

```java
public void initialize() {
    this.hubDomain = properties.getDomain();
    if (hubDomain == null || hubDomain.isBlank()) return;

    try {
        List<CertInfo> existingCerts = acmeService.listCertificates();
        boolean hasCert = existingCerts.stream()
                .anyMatch(c -> hubDomain.equals(c.getDomain()));
        if (hasCert) {
            sslManager.addCertificate(hubDomain);
            initialCertRequested = true;
            return;
        }
    } catch (Exception ignored) {}

    // Background thread — non-blocking
    Thread.ofVirtual().name("acme-initial-cert").start(() -> {
        boolean success = acmeService.requestCertificate(hubDomain);
        if (success) {
            sslManager.addCertificate(hubDomain);
            initialCertRequested = true;
        }
    });
}
```

Cette logique signifie :

- Premier démarrage du Hub : un cert auto-signé est généré pour permettre TLS, puis un cert Let's Encrypt arrive ~60s plus tard et remplace.
- Si le premier appel échoue (DNS pas propagé, quota Let's Encrypt atteint, etc.), le prochain cycle 24h retentera (`if (!initialCertRequested)` dans `doWork()`).

---

## 9. Validation

### 9.1 Source de vérité — Vault (pas de table SQL des certificats)

En 3.12.1 il n'existe **pas** de table `acme.certificates`. La liste des certificats est dérivée directement de Vault par `AcmeService.listCertificates()` (lecture de `soclehub/certs/<domain>`). Seul `acme.account` existe côté SQL (clé de compte ACME). Pour inventorier les certs, passer par l'action `list_certificates` ou Vault :

```bash
# Action worker (source de vérité)
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/list_certificates \
  -H "Content-Type: application/json" -d '{}' | jq '.data.certificates'

# Ou directement en Vault
docker exec soclehub-vault vault kv list soclehub/certs
```

### 9.2 Vault — les clés privées

```bash
# Lister les certs en Vault
docker exec soclehub-vault vault kv list soclehub/certs

# Inspecter un cert sans dump du secret
docker exec soclehub-vault vault kv metadata get soclehub/certs/app2.thesocle.net
```

### 9.3 OpenSSL — le cert vivant

```bash
# Dates
echo | openssl s_client -servername app2.thesocle.net -connect app2.thesocle.net:443 2>/dev/null \
       | openssl x509 -noout -dates

# Subject Alternative Names (pour cert wildcard)
echo | openssl s_client -servername app2.thesocle.net -connect app2.thesocle.net:443 2>/dev/null \
       | openssl x509 -noout -text | grep -A 1 "Subject Alternative Name"
```

### 9.4 SSL Labs (online)

Ouvrir : https://www.ssllabs.com/ssltest/analyze.html?d=app2.thesocle.net

Score attendu : A ou A+ avec :

- TLS 1.2 + 1.3
- HSTS activé (à configurer côté Tomcat ou via le proxy)
- Pas de cipher faible

### 9.5 Logs

```bash
docker logs soclehub-hub --since 5m | grep -E "\[worker:acme_worker\]|requestCertificate"
```

---

## 10. Pièges courants

### Piège 1 — `ACME account email not configured (soclehub.acme.account-email)`

**Cause :** Variable `BOOTSTRAP_ADMIN_EMAIL` absente du `.env` (elle alimente `soclehub.acme.account-email`).
**Résolution :** Ajouter `BOOTSTRAP_ADMIN_EMAIL=acme@thesocle.net` et redémarrer. Let's Encrypt envoie des notifications d'expiration sur cet email — utiliser une vraie boîte monitorée.

### Piège 2 — `Could not resolve Cloudflare zone ID for domain=...`

**Cause :** Le domaine n'a pas de zone enregistrée dans `dns.zones`. Cette table est peuplée par le `dns_sync_worker` (cf. [[41-dns-sync-worker|41-dns-sync-worker]]), ou manuellement.
**Résolution :** le paramètre de l'ID Cloudflare s'appelle `zone_id` (et non `cloudflare_zone_id`, qui est le nom de la colonne en base) :

```bash
curl -sS -X POST http://localhost:8080/api/actions/dns_sync_worker/register_zone \
  -H "Content-Type: application/json" \
  -d '{"zone_name":"thesocle.net","zone_id":"ab12cd34..."}'
```

### Piège 3 — `Failed to create TXT record for _acme-challenge.<domain>`

**Cause possible 1 :** API Token Cloudflare manque le scope `Zone:DNS:Edit`.
**Cause possible 2 :** Le token est associé à une zone différente.
**Cause possible 3 :** Cloudflare rate-limit (max ~1200 req/5min sur l'API).
**Résolution :** Re-générer un token avec les bonnes permissions, vérifier dans Cloudflare → Audit Logs.

### Piège 4 — Challenge timeout : `challenge failed or timed out for domain=...`

**Cause :** La propagation DNS a pris > 2 min OU Let's Encrypt n'a pas vu le record. Souvent dû à un TTL DNS hérité (Cloudflare en proxied=true mettrait du temps).
**Résolution :** Vérifier que la TXT record est bien posée avec `dig +short TXT _acme-challenge.app2.thesocle.net @1.1.1.1`. Si le record est posé mais LE ne le voit pas, retenter (les serveurs LE polent sur plusieurs résolveurs).

### Piège 5 — Quota Let's Encrypt dépassé : `urn:ietf:params:acme:error:rateLimited`

**Cause :** Plus de 50 certs/semaine pour le même domaine OU plus de 5 échecs consécutifs.
**Résolution :** Basculer sur staging pour les tests. L'URL de directory est la propriété Spring `soclehub.acme.directory-url` (fixée à `acme://letsencrypt.org` dans `application.yml`) — la surcharger via une property/arg JVM ou en éditant `application.yml` :

```yaml
soclehub:
  acme:
    directory-url: acme://letsencrypt.org/staging
```

Les certs staging ne sont pas valides (issuer "(STAGING) Fake LE Intermediate") mais ne consomment pas le quota prod. Repasser en prod après debug.

### Piège 6 — Le cert est émis mais Tomcat continue de servir l'ancien

**Cause :** `SslManager.addCertificate()` n'a pas été appelé ou a échoué. Le hot-reload Tomcat dépend de la version embedded.
**Résolution :** Restart le Hub pour forcer le rechargement TLS :

```bash
docker compose -f soclehub/docker/docker-compose.yml restart soclehub-hub
```

### Piège 7 — `Account does not exist on server` après plusieurs heures

**Cause :** L'account key pair en mémoire ne matche plus celle enregistrée chez Let's Encrypt — typiquement après une régénération de la KeyPair côté Hub (perte de Vault).
**Résolution :** Persister la key pair de l'account dans Vault `soclehub/acme/account_key`. Au reboot, recharger plutôt que régénérer. Si déjà régénérée, accepter de créer un nouvel account (pas de risque, juste un changement d'identité ACME).

### Piège 8 — Cert wildcard non émis : `Wildcard certificates require DNS-01 challenge`

**Cause :** La requête est faite avec `domain="*.thesocle.net"` mais l'implémentation actuelle ne gère pas explicitement le caractère `*` (passé tel quel à acme4j qui le supporte).
**Résolution :** Test :

```bash
curl -sS -X POST http://localhost:8080/api/actions/acme_worker/request_certificate \
  -d '{"domain":"*.thesocle.net"}'
```

Si erreur, faire un cert SAN multi-domaine (`thesocle.net,*.thesocle.net`) — non supporté par l'API actuelle, prévu en V6.

### Piège 9 — Le cert renouvelé n'est pas pris en compte sur les apps `*.thesocle.net`

**Cause :** Le cert est chargé pour le domaine principal, mais les routes proxy utilisent le SNI matching. Si l'app a son propre cert ou utilise `default`, ça peut diverger.
**Résolution :** Vérifier les certs chargés :

```bash
echo | openssl s_client -servername app2.thesocle.net \
                        -connect localhost:443 2>/dev/null \
       | openssl x509 -noout -subject -dates
```

### Piège 10 — `KeyPair generation failed: Provider BC not installed`

**Cause :** BouncyCastle nécessaire à acme4j n'est pas dans le classpath.
**Résolution :** Le pom.xml SocleHub embarque `bcpkix-jdk18on`. Vérifier la version et la cohabitation avec d'autres deps (Spring Security peut tirer une vieille version).

### Piège 11 — Renouvellement sur un domaine qui n'est plus utilisé

**Cause :** Le worker renouvelle TOUS les certs en base, même ceux d'apps désinstallées. Coût : 1 appel Let's Encrypt par domaine.
**Résolution :** Il n'y a pas d'action `delete_certificate` en 3.12.1 ni de table SQL des certs. La liste vient de Vault — supprimer le secret suffit pour que le worker cesse de renouveler ce domaine :

```bash
docker exec soclehub-vault vault kv delete soclehub/certs/old.thesocle.net
```

### Piège 12 — `connect: connection refused` sur port 443

**Cause :** Tomcat n'écoute pas sur 443 (mauvaise config server.xml ou port mappé sur un autre).
**Résolution :** Vérifier le port `application.yml`/`server.port` et le mapping Docker (`-p 443:8443` typiquement).

```bash
docker port soclehub-hub
# 8080/tcp -> 0.0.0.0:8080
# 8443/tcp -> 0.0.0.0:443
```

---

## 11. Pour aller plus loin

- [[40-acme-worker|40-acme-worker]] — référence complète du worker (actions, paramètres, lifecycle DNS-01, cycle 24h).
- [[41-dns-sync-worker|41-dns-sync-worker]] — gestion des zones et records Cloudflare (`dns.zones`, `dns.records`).
- [[11-vault-worker|11-vault-worker]] — stockage clés privées + chaîne PEM des certs et clé de compte ACME.
- [[howto-11-configurer-james-mail|HOWTO 11]] — utiliser ces certs sur `mail.<domain>` (IMAPS/SMTPS).
- Spec ACME (RFC 8555) : https://datatracker.ietf.org/doc/html/rfc8555
- acme4j docs : https://shredzone.org/maven/acme4j/
- Let's Encrypt rate limits : https://letsencrypt.org/docs/rate-limits/
