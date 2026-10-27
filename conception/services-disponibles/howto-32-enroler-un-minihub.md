# HOWTO 32 — Enrôler un mini-hub

> **Niveau** : avancé | **Prérequis** : SocleHub Hub 3.12.1 avec `socle.minihub.server.enabled=true`, Vault PKI `pki-minihub` provisionné (cf. [[145-minihub-cert-pki]]), un agent mini-hub déployé sur la box cible (autre serveur/box ARM ou x86), accès admin Hub | **Temps estimé** : 10-20 min

Ce guide montre comment **enrôler un mini-hub** auprès d'un Hub central SocleHub : générer un token d'enrôlement one-shot côté Hub, faire présenter par l'agent son CSR auto-généré sur `POST /api/minihub/enroll`, recevoir le certificat client signé par la CA Vault `pki-minihub`, puis vérifier que le mini-hub remonte ses heartbeats et passe `ACTIVE`. C'est le préalable à toute install distribuée (cf. [[howto-33-installer-une-app-sur-minihub|HOWTO 33]]).

---

## 1. Contexte

Un mini-hub est un agent léger qui tourne sur une box distante (Mac mini M4, VPS OVH, Raspberry, etc.) et ouvre un tunnel gRPC mTLS **sortant** vers le Hub central. Une fois enrôlé, le Hub peut lui déployer des apps, relayer son MCP, et collecter son observabilité — sans qu'aucun port entrant ne soit ouvert sur la box.

L'enrôlement matérialise une **racine de confiance** : le mini-hub génère localement une paire de clés + un CSR, et le Hub lui signe un certificat client via le moteur PKI de Vault. Ce certificat est ensuite présenté à chaque connexion du tunnel mTLS. Le flux est **one-shot et anti-rejeu** : le token d'enrôlement est aléatoire 256 bits, stocké hashé SHA-256, à TTL court (15 min), consommé atomiquement.

Le flux d'enrôlement doit :

- Générer un token côté Hub (slug/tenant/binding-IP optionnels), retourné en clair **une seule fois**,
- Recevoir le CSR du mini-hub sur `POST /api/minihub/enroll` (pas d'auth : le token EST l'authentification),
- Vérifier hash + TTL + binding IP, consommer le token atomiquement,
- Signer le CSR via Vault `sign-verbatim` (CA `pki-minihub`, TTL cert 2160 h = 90 j),
- Inscrire le mini-hub dans `iam.db_minihub` en statut `ACTIVE`,
- Renvoyer cert PEM + chaîne CA + bootstrap (endpoint gRPC, intervalle heartbeat).

---

## 2. Architecture

```
  ┌─────────────────────────────────────────────────────────────┐
  │ Étape A — Opérateur HUB génère un token d'enrôlement         │
  │   MiniHubEnrollmentService.createEnrollmentToken()           │
  │   → 256 bits random, hash SHA-256 → iam.tr_minihub_*_token   │
  │   → token brut retourné UNE seule fois (TTL 15 min)          │
  └─────────────────────────────┬───────────────────────────────┘
                                 │ token transmis hors-bande
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Agent mini-hub (box distante)                               │
  │   1. génère keypair + CSR PEM localement                    │
  │   2. POST /api/minihub/enroll {token, csrPem, slug, tenant} │
  └─────────────────────────────┬───────────────────────────────┘
                                 │ HTTPS (pas d'auth, token=auth)
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ MiniHubEnrollmentController  (POST /api/minihub/enroll)      │
  │            │                                                 │
  │            ▼                                                 │
  │  MiniHubEnrollmentService.enroll()                          │
  │   - sha256(token) → consumeTokenAtomic() (SELECT FOR UPDATE)│
  │   - MiniHubCertService.signCsr() ──► Vault PKI pki-minihub  │
  │   - repo.upsertMinihub() → iam.db_minihub status=ACTIVE     │
  │   - audit cert émis → iam.tr_*                              │
  │            │                                                 │
  │            ▼  réponse bootstrap                              │
  │   {minihubId, certPem, chainPem, certSerial,               │
  │    bootstrap:{hubGrpcEndpoint, heartbeatIntervalMs:30000}}  │
  └─────────────────────────────┬───────────────────────────────┘
                                 │ l'agent ouvre le tunnel mTLS
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Tunnel gRPC mTLS sortant → tunnel.thesocle.net:443         │
  │   heartbeat toutes les 30 s → onHeartbeatReceived()        │
  │   transitions ACTIVE → DEGRADED (90s) → UNREACHABLE (180s) │
  └─────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Générer un token d'enrôlement

Le token est généré côté Hub par `MiniHubEnrollmentService.createEnrollmentToken(expectedSlug, tenantId, bindingSourceIp, createdBy)` :

- `expectedSlug` (optionnel) : slug attendu du mini-hub (null = libre),
- `tenantId` (optionnel) : tenant cible,
- `bindingSourceIp` (optionnel) : si fourni, le token n'est utilisable que depuis cette IP,
- `createdBy` : identifiant de l'opérateur.

Le service insère le **hash SHA-256** du token dans `iam.tr_minihub_enrollment_token` et retourne le **token brut une seule fois** (à noter immédiatement — il n'est jamais réaffiché). Le TTL par défaut est 15 min (`socle.minihub.enrollment.token-ttl-minutes`).

> **Note de vérité (3.12.1)** : la génération du token est portée par `MiniHubEnrollmentService.createEnrollmentToken(...)` mais l'action MCP / endpoint qui l'expose à un opérateur externe n'est **pas encore câblée** dans le code (la Javadoc la décrit comme « via action MCP IamWorker », à intégrer V001.0 sprint 3 — rate-limit + audit). En attendant, le token se crée par l'opérateur Hub côté serveur (script/console interne), puis se transmet hors-bande au mini-hub. Vérifier la disponibilité réelle d'une action `create_enrollment_token` sur votre build avant d'industrialiser.

Vérifier que la ligne a bien été insérée (hash uniquement, jamais le token en clair) :

```sql
SELECT left(token_hash, 8) AS hash_prefix, expected_slug, tenant_id,
       expires_at, binding_source_ip, created_by, consumed_at
FROM iam.tr_minihub_enrollment_token
ORDER BY x_dateCreated DESC LIMIT 5;
```

---

## 4. Étape 2 — L'agent génère son CSR et appelle `/enroll`

Côté box distante, l'agent génère localement une paire de clés et un CSR (le Hub ne voit jamais la clé privée). Exemple de CSR généré à la main pour test :

```bash
# Sur la box mini-hub — génération keypair + CSR (CN = slug souhaité)
openssl req -new -newkey rsa:2048 -nodes \
  -keyout minihub-client.key \
  -out minihub-client.csr \
  -subj "/CN=minihub-ovh-rss/O=TheSocle/OU=minihub"
```

Puis l'agent POSTe le CSR + le token brut. Le payload est le record `EnrollRequest(token, csrPem, slug, tenantId)` :

```bash
CSR_PEM=$(awk 'NF{printf "%s\\n", $0}' minihub-client.csr)

curl -sS -X POST https://admin.thesocle.net/api/minihub/enroll \
  -H "Content-Type: application/json" \
  -d "{
    \"token\": \"<TOKEN_BRUT_64_HEX>\",
    \"csrPem\": \"${CSR_PEM}\",
    \"slug\": \"minihub-ovh-rss\",
    \"tenantId\": \"system\"
  }"
```

Réponse 200 OK (extrait — `BootstrapResponse` sérialisé par le controller) :

```json
{
  "minihubId": "18556e78-1b2c-4d3e-9f0a-aabbccddeeff",
  "certPem": "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----",
  "chainPem": "-----BEGIN CERTIFICATE-----\n...CA...\n-----END CERTIFICATE-----",
  "certSerial": "5a:3f:...:9c",
  "expirationEpoch": 1758585600,
  "bootstrap": {
    "hubGrpcEndpoint": "tunnel.thesocle.net:443",
    "heartbeatIntervalMs": 30000,
    "poolSize": 2,
    "maxConcurrentCalls": 1000
  }
}
```

L'agent persiste `certPem` + `chainPem` à côté de sa `minihub-client.key`, puis ouvre le tunnel mTLS vers `hubGrpcEndpoint`.

**Points clés** :

- **Aucune authentification** sur `/enroll` : le token EST l'authentification (vérification hash + TTL + binding IP côté service).
- `hubGrpcEndpoint` est **propre à ce Hub** (multi-Hub V002) : `socle.minihub.server.virtual-host` (défaut `tunnel.thesocle.net`) + `:443`. Un Hub `.io` renverra son propre vhost.
- Le certificat a un TTL de **2160 h (90 j)** par défaut (`socle.minihub.vault.cert-ttl`) — prévoir une rotation (réémission via réenrôlement ou renouvellement PKI).

---

## 5. Étape 3 — Le mini-hub remonte ses heartbeats

Une fois le tunnel mTLS ouvert, l'agent émet un heartbeat toutes les **30 s** (`heartbeatIntervalMs`). `MiniHubRegistryService.onHeartbeatReceived(...)` met à jour la projection mémoire et `iam.db_minihub.last_heartbeat_at`. Les transitions de statut sont calculées sur l'âge du dernier heartbeat :

| Statut | Condition | Seuil |
|--------|-----------|-------|
| `ACTIVE` | heartbeat récent | < 90 s |
| `DEGRADED` | heartbeat en retard | 90 s – 180 s |
| `UNREACHABLE` | plus de heartbeat | > 180 s |

**Important** : aucun scheduler n'est armé automatiquement — la détection de transitions doit être déclenchée par un appelant. Forcer un recalcul via l'action MCP :

```
minihub_registry_worker.tick_detect_transitions
```

---

## 6. Validation

### Lister les mini-hubs enrôlés (MCP)

```
minihub_registry_worker.list_minihubs
```

Réponse attendue (extrait) : chaque mini-hub avec `status`, `last_heartbeat`, `cert_expires_at`. Le mini-hub fraîchement enrôlé doit apparaître en `ACTIVE`.

### Vérifier en base

```sql
-- Le mini-hub est inscrit ACTIVE avec son cert
SELECT minihub_id, minihub_slug, tenant_id, status,
       cert_serial, cert_expires_at, enrolled_at, last_heartbeat_at, minihub_version
FROM iam.db_minihub
WHERE minihub_slug = 'minihub-ovh-rss';

-- Le token a bien été consommé (consumed_at non NULL, plus jamais réutilisable)
SELECT left(token_hash,8) AS h, consumed_at, consumed_by_minihub_id
FROM iam.tr_minihub_enrollment_token
WHERE expected_slug = 'minihub-ovh-rss';
```

### Stats de pool

```
minihub_registry_worker.pool_stats
```

### IHM Portail

Naviguer vers `https://admin.thesocle.net/hub/minihubs` :

- Liste des mini-hubs (`PortalMinihubController`, route `/hub/minihubs`),
- Détail `/hub/minihubs/{id}` : statut, cert, `last_heartbeat_at`, `uptime_seconds`,
- Vue graphe `/hub/minihubs/graph`.

---

## 7. Pièges courants

### Piège 1 — `enrollment_rejected: Token invalide ou expire`

**Symptôme** : `POST /api/minihub/enroll` renvoie 401 avec ce message générique.

**Cause** : token déjà consommé (one-shot), TTL 15 min dépassé, ou binding IP non respecté. Le message est **volontairement générique** (anti-timing attack, SS-SEC-02).

**Résolution** : regénérer un token frais. Vérifier `consumed_at IS NULL` et `expires_at > now()` :

```sql
SELECT consumed_at, expires_at, binding_source_ip
FROM iam.tr_minihub_enrollment_token WHERE token_hash = encode(sha256('<TOKEN>'::bytea),'hex');
```

Si binding IP : s'assurer que la box sort bien depuis l'IP attendue (attention au `X-Forwarded-For` derrière le proxy — le controller prend la 1ère IP du XFF).

### Piège 2 — `Erreur signature CSR`

**Symptôme** : enrôlement échoue avec `enrollment_rejected: Erreur signature CSR : ...`.

**Cause** : le moteur PKI Vault `pki-minihub` est inaccessible ou non provisionné pour ce Hub. Rappel : le PKI mount est **par Hub** et a été perdu à la bascule Vault dev→prod du 2026-06-07, re-provisionné `.net` + `.io` le 2026-06-19.

**Résolution** : vérifier que le mount existe et que le rôle `minihub` est configuré (cf. [[145-minihub-cert-pki]]) :

```bash
vault read pki-minihub-poc/roles/minihub
vault write pki-minihub-poc/sign-verbatim/minihub csr=@minihub-client.csr ttl=2160h
```

Vérifier la config `socle.minihub.vault.pki-mount` (défaut `pki-minihub-poc`) et `socle.minihub.vault.pki-role` (défaut `minihub`).

### Piège 3 — `CSR PEM invalide ou manquant` / `CSR PEM trop court`

**Symptôme** : rejet immédiat avant même l'appel Vault.

**Cause** : `validateCsr()` exige le préfixe `-----BEGIN CERTIFICATE REQUEST-----` et une longueur ≥ 200 chars. En général, le CSR a été mal échappé dans le JSON (sauts de ligne perdus).

**Résolution** : encoder les `\n` littéraux dans le JSON (cf. le `awk` de l'étape 2), ou envoyer le CSR via un fichier `--data-binary` avec un wrapper qui sérialise proprement.

### Piège 4 — Le mini-hub reste `UNREACHABLE` malgré l'enrôlement OK

**Symptôme** : `list_minihubs` montre le mini-hub mais en `UNREACHABLE` / `DEGRADED`, sans heartbeat.

**Cause** : le tunnel mTLS ne s'ouvre pas (cert mal monté côté agent, mauvais `hubGrpcEndpoint`, port 443 bloqué en sortie), OU aucun `tick_detect_transitions` n'a recalculé l'état, OU — après un restart du Hub — l'agent a reconnecté le heartbeat mais **pas le command stream** (bug connu).

**Résolution** :

1. Forcer le recalcul : action `tick_detect_transitions`.
2. Vérifier côté agent que le cert présenté correspond bien à la CA `pki-minihub` du Hub cible.
3. Si heartbeat OK mais command stream KO après restart Hub : `docker restart socle-minihub` sur la box.

### Piège 5 — Endpoints `/api/minihub/*` introuvables (404)

**Symptôme** : `POST /api/minihub/enroll` renvoie 404.

**Cause** : `socle.minihub.server.enabled` n'est pas à `true` — les controllers sont annotés `@ConditionalOnProperty(name = "socle.minihub.server.enabled", havingValue = "true")` et ne sont pas chargés sinon.

**Résolution** : activer la propriété (env `SOCLE_MINIHUB_SERVER_ENABLED=true`) puis recréer le container Hub (`update_app` même tag — un simple restart ne propage pas toujours la variable). Vérifier ensuite `GET /api/minihub/check-hostname?subdomain=test`.

### Piège 6 — Wrong Hub : le mini-hub se connecte au mauvais tunnel

**Symptôme** : enrôlé sur le Hub `.net` mais l'agent tente de joindre `.io` (ou l'inverse).

**Cause** : `hubGrpcEndpoint` est dérivé de `socle.minihub.server.virtual-host` **du Hub qui a signé l'enrôlement**. Si l'agent est réutilisé tel quel sur un autre Hub, le vhost ne correspond plus.

**Résolution** : ré-enrôler sur le Hub cible (nouveau token + nouveau CSR), ne pas recopier la config bootstrap d'un Hub à l'autre.

---

## 8. Pour aller plus loin

- [[141-minihub-registry-enrollment|Registre, transitions & enrôlement]] — détail du flux, state machine et seuils heartbeat,
- [[145-minihub-cert-pki|Certificats & Vault PKI]] — signature CSR `sign-verbatim`, CA `pki-minihub`, rotation,
- [[140-minihub-architecture-grpc|Architecture mini-hub & gRPC]] — vue d'ensemble du tunnel mTLS,
- [[howto-33-installer-une-app-sur-minihub|HOWTO 33 — Installer une app sur un mini-hub]] — étape suivante après enrôlement,
- [[144-minihub-console-observability|Console & observabilité]] — collecter logs et métriques du mini-hub.
