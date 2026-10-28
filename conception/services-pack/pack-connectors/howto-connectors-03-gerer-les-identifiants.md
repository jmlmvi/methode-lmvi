# HOWTO CONNECTORS-03 — Gérer les identifiants des connecteurs (env, Vault)

**Niveau :** Intermédiaire
**Cible :** exploitant ou développeur qui pose les clés Notion / Google / Stripe / HubSpot d'une app
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:3.2.0` (tag `v3.2.0`, commit `edac18b`, code identique à 3.1.0 `69da4ab` ; Boot 4.1.2, socle 5.11.0, minimum 5.10.0 ; code de ce périmètre identique depuis 2.0.0 hors noms de beans préfixés `connectors*` ; 3.0.0 = Boot 4.0.6, 2.0.0 = dernière Boot 3) — `VaultCredentialResolver`,
`ConnectorsProperties`, `NotionClient`, `GoogleAuthService`, `StripeWorker`, `HubspotWorker`
**Temps estimé :** 15 min

---

## 1. Contexte

Le README et le CLAUDE.md du pack annoncent « credentials Vault d'abord
(`apps/{appId}/connectors/{provider}`), fallback env ». **Le code 2.0.0 ne consulte jamais Vault** :
tous les appelants passent `appId = null`, et le résolveur court-circuite Vault dans ce cas.

```java
// VaultCredentialResolver.resolve — extrait exact
public String resolve(String appId, String provider, String field, String envFallback) {
    if (vaultWorker != null && appId != null) {        // appId est toujours null
        String fromVault = readVault(appId, provider, field);
        if (fromVault != null && !fromVault.isBlank()) return fromVault;
    }
    return envFallback;
}

// NotionClient.resolveApiKey — même motif dans GoogleAuthService, StripeWorker, HubspotWorker
return vault.resolve(null, PROVIDER, "api_key", props.getNotion().getApiKey());
```

**Conséquence pratique : la seule source d'identifiants est `socle.conn.*`**, c'est-à-dire les
variables d'environnement du conteneur ou l'`application.yml`. La voie propre sur le Hub est donc
de stocker ces variables par `docker_worker.set_env_var`, qui les conserve dans Vault
(`soclehub/apps/<appId>/env`) et les réinjecte au démarrage. Le secret vit bien dans Vault ; c'est
le Hub qui l'y lit, pas le pack.

---

## 2. Architecture

```
            ┌───────────────── Hub ─────────────────┐
 set_env_var│  Vault  soclehub/apps/<appId>/env     │
 ──────────►│    SOCLE_CONN_NOTION_API_KEY=secret_… │
            └──────────────────┬────────────────────┘
                               │ injecté à install_app / restart_app / update_app
                               ▼
┌──────────────────── conteneur de l'app ────────────────────┐
│  env SOCLE_CONN_* ──► ConnectorsProperties (socle.conn.*)   │
│                         │                                   │
│  VaultCredentialResolver.resolve(null, …, envFallback)      │
│     appId == null ──► renvoie envFallback (= la propriété)  │
│                         ▼                                   │
│  NotionClient / GoogleAuthService / Stripe / HubSpot        │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Obtenir chaque identifiant

| Connecteur | Identifiant | Où l'obtenir | Format attendu par le code |
|---|---|---|---|
| Notion | jeton d'intégration interne | notion.so/my-integrations ; partager chaque page/database avec l'intégration | chaîne, envoyée en `Authorization: Bearer` + `Notion-Version` |
| Google Drive | clé JSON d'un Service Account | Google Cloud Console, API Drive activée | JSON complet **sur une ligne** ; le code lit `client_email` et `private_key` (PKCS#8 PEM) |
| Google Drive (option) | utilisateur délégué | domain-wide delegation sur le scope `https://www.googleapis.com/auth/drive` | adresse mail, mise en claim `sub` du JWT |
| Stripe | clé secrète `sk_test_…` / `sk_live_…` | Dashboard Stripe → Developers | `Authorization: Bearer` |
| Stripe (webhooks) | `whsec_…` | renvoyé par `create_webhook_endpoint` | HMAC-SHA256 |
| HubSpot | jeton Private App `pat-…` | Settings → Integrations → Private Apps | `Authorization: Bearer` |

---

## 4. Étape 2 — Les poser sur le conteneur (voie Hub)

```bash
HUB=https://admin.thesocle.net
set_env() {
  curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
    -X POST $HUB/api/actions/docker_worker/set_env_var \
    -d "$(jq -cn --arg a monapp --arg k "$1" --arg v "$2" '{app_id:$a,key:$k,value:$v}')"
}

set_env SOCLE_CONN_NOTION_ENABLED  true
set_env SOCLE_CONN_NOTION_API_KEY  "secret_xxxxxxxx"

set_env SOCLE_CONN_GDRIVE_ENABLED  true
set_env SOCLE_CONN_GDRIVE_CREDENTIALS_JSON "$(jq -c . sa-socle.json)"   # une seule ligne

set_env SOCLE_CONN_STRIPE_ENABLED  true
set_env SOCLE_CONN_STRIPE_SECRET_KEY     "sk_test_xxxxxxxx"
set_env SOCLE_CONN_STRIPE_WEBHOOK_SECRET "whsec_xxxxxxxx"

curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST $HUB/api/actions/docker_worker/restart_app -d '{"app_id":"monapp"}'
```

`jq -c` produit le JSON sur une ligne en conservant les `\n` échappés de `private_key` :
`GoogleAuthService.parsePemPrivateKey` retire les en-têtes PEM et tous les blancs, puis décode.

En développement local, un fichier `.env` suffit :

```bash
SOCLE_CONN_NOTION_ENABLED=true
SOCLE_CONN_NOTION_API_KEY=secret_xxxxxxxx
```

---

## 5. Étape 3 — `SOCLE_CONN_VAULT_ENABLED` : ce qu'elle fait réellement

```yaml
socle:
  conn:
    vault:
      enabled: false                 # SOCLE_CONN_VAULT_ENABLED
      base-path: soclehub/apps       # SOCLE_CONN_VAULT_BASE_PATH
```

À `true`, le constructeur de `VaultCredentialResolver` parcourt les beans dont le nom contient
`vault` et retient le premier dont la classe contient `Vault` ; il loggue alors
`[vault-resolver] Vault integration enabled`. Ce bean serait interrogé par réflexion
(`getSecret(String path, String field)` sur `{base-path}/{appId}/connectors/{provider}`) — mais
jamais, puisque `appId` vaut toujours `null`. **Laisser `false`** : l'activer ne change aucun
comportement et ajoute une recherche de beans au démarrage.

---

## 6. Vérifier

```bash
# Le conteneur porte bien les variables
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST $HUB/api/actions/docker_worker/list_env_vars -d '{"app_id":"monapp"}'

# Chaque connecteur se déclare configuré
for w in notion_worker gdrive_worker stripe_worker hubspot_worker; do
  curl -s -H "X-Admin-Key: $ADMIN_API_KEY" -X POST \
    http://localhost:8080/admin/workers/$w/actions/test_connection -d '{}'; echo
done
```

| Connecteur | Ce que `test_connection` appelle | Succès |
|---|---|---|
| notion | `GET /v1/users/me` | `connected, bot_id, bot_name` |
| gdrive | jeton OAuth puis `GET /drive/v3/about` | `connected, user_email, storage_used, storage_limit` |
| stripe | `GET /v1/balance` | `connected, currencies_count` |
| hubspot | `GET /crm/v3/objects/contacts?limit=1` | `connected` |

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Clé Notion fausse | `test_connection` en échec `Notion GET /users/me HTTP 401: …` |
| 2 | JSON Google sur plusieurs lignes dans `.env` | `Google credentials JSON missing` ou erreur de parsing : remettre sur une ligne |
| 3 | Rotation : `set_env_var` + `restart_app` | Nouvelle clé active après redémarrage, sans rebuild |
| 4 | `SOCLE_CONN_VAULT_ENABLED=true` | Log `Vault integration enabled` ; identifiants toujours lus dans l'env |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Ranger les clés sous `apps/<appId>/connectors/<provider>` dans Vault, comme le dit le README | Connecteur `configured=false` | Le pack ne lit pas Vault : passer par `set_env_var` (Vault `…/env`) |
| `SOCLE_CONN_VAULT_ENABLED=true` en pensant activer Vault | Rien ne change | Laisser `false` |
| Clé posée mais app non redémarrée | Ancienne clé encore utilisée | `restart_app` : les propriétés sont lues au démarrage |
| JSON Google multi-lignes | `JsonParseException` dans `getAccessToken` | `jq -c` |
| Delegated user sans domain-wide delegation | `Google token HTTP 401/403` | Autoriser le client_id du SA sur le scope `drive` dans l'admin Workspace |
| Clé Stripe `sk_live_` en recette | Opérations réelles facturées | `sk_test_` hors production |
| Jeton du cache Google après rotation | Ancien jeton servi jusqu'à 55 min | Redémarrer l'app : `GoogleAuthService` garde l'`access_token` en mémoire jusqu'à 5 min avant expiration |
| Isolation par tenant attendue | `x_partition` vide dans `tr_connector_log` | Non implémenté en 2.0.0 : un jeu de clés par app, pas par tenant |

---

## 9. Pour aller plus loin

- [[howto-19-rotation-secrets|HOWTO 19 — Rotation des secrets]]
- [[howto-04-mettre-a-jour-une-app|HOWTO 04 — Mettre à jour une app]] (`set_env_var`)
- [[howto-connectors-02-activer-un-connecteur|CONNECTORS-02 — Activer un connecteur]]
- [[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10 — Journal des appels]]
