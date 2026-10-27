# HOWTO 34 — Gérer les tenants IAM

> **Niveau** : intermédiaire | **Prérequis** : SocleHub Hub 3.12.1 (chantier StrictMode P4, 3.11.0), schéma PostgreSQL `iam` migré (`iam.db_tenants` au pluriel), accès admin Hub | **Temps estimé** : 10-15 min

Ce guide montre comment gérer le cycle de vie d'un **tenant** SocleHub : le créer, l'activer, le suspendre, le restaurer/supprimer, ajuster ses quotas, accorder un accès multi-tenant, et auditer la cohérence inter-schémas. Il explique aussi le **StrictMode** (`auto-create=false`) introduit en 3.11.0 et l'enforcement des quotas (`max_apps`, `max_users`).

---

## 1. Contexte

Un **tenant** matérialise un client/organisation : il porte un sous-domaine `{slug}.thesocle.net`, le claim JWT `tenant`, le header `X-SSO-Tenant` et la colonne `x_partition` PostgreSQL. `IamTenantService` est la **source de vérité** des tenants (`iam.db_tenants`), exposée via le `IamWorker` (façade `ActionProvider`) et l'IHM `/hub/iam/tenants`.

Avant le chantier StrictMode P4 (Hub 3.11.0), un `tenant_id` inconnu dans un JWT était **auto-créé** silencieusement (permissif). Désormais `soclehub.iam.tenant.auto-create=false` par défaut : un tenant non enregistré est **rejeté en 403** (`tenant_not_registered`). Les tenants doivent donc être créés explicitement avant usage.

Le service gère :

- Le cycle de vie `pending → active → suspended → deleted` avec **optimistic locking** (`x_version`),
- L'enforcement des quotas `max_users` / `max_apps` (`assertCanCreateUser`, `assertCanInstallApp`),
- L'accès multi-tenant N..N (`iam.tr_user_tenant_access`),
- Un **audit de cohérence** inter-schémas (`tenant_consistency_audit`),
- Le tenant `system` **immutable** et exempté des quotas.

---

## 2. Architecture

```
  ┌──────────────────────────────────────────────────────────┐
  │ MCP / REST  +  PortalTenantController (/hub/iam/tenants)  │
  │  14 actions tenant exposées via IamWorker                │
  └────────────────────────────┬─────────────────────────────┘
                               │ executeAction
                  ┌────────────▼────────────┐
                  │        IamWorker        │
                  │  handle*Tenant(...)     │
                  └────────────┬────────────┘
                               │ délègue
                  ┌────────────▼────────────┐
                  │     IamTenantService    │
                  │  cache ConcurrentMap    │
                  │  optimistic lock x_version│
                  │  quotas + audit cohérence│
                  └────────────┬────────────┘
                               │ JDBC
  ┌────────────────────────────▼─────────────────────────────┐
  │ PostgreSQL iam.* :                                        │
  │  db_tenants (référentiel)   tr_tenant_audit (journal)    │
  │  tr_user_tenant_access (lien user↔tenant N..N)          │
  └──────────────────────────────────────────────────────────┘
        ▲ audit cohérence read-only (assertTenantActive → 403)
  ┌─────┴────────────────────────────────────────────────────┐
  │ Satellites : iam.db_users.tenant_id · apps.applications  │
  │  .x_partition · thefront.z_thefront_tenants · agentia    │
  └──────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Créer un tenant

Le tenant est créé en statut `pending`. Action `create_tenant` (`slug` + `name` requis) :

```bash
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/create_tenant \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "acme-corp",
    "name": "ACME Corporation",
    "contact_email": "ops@acme.example",
    "plan": "pro"
  }'
```

Ou en MCP :

```
iam_worker.create_tenant  { "slug": "acme-corp", "name": "ACME Corporation", "plan": "pro" }
```

| Paramètre | Requis | Défaut | Description |
|-----------|--------|--------|-------------|
| `slug` | oui | — | 2-100 chars lowercase + `-_`. Sous-domaine, claim JWT, `x_partition` |
| `name` | oui | — | Nom commercial |
| `contact_email` | non | — | Contact principal |
| `owner_user_id` | non | — | UUID/x_id du user owner |
| `plan` | non | `free` | `free` / `pro` / `enterprise` / `custom` |
| `expires_at` | non | — | Expiration ISO-8601 |

La création est **idempotente** via `tenant_slug UNIQUE`. Quotas par défaut à la création : `max_users=50`, `max_apps=10`, `max_storage_gb=100`.

---

## 4. Étape 2 — Activer le tenant

Un tenant `pending` n'est pas utilisable tant qu'il n'est pas activé :

```bash
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/activate_tenant \
  -H "Content-Type: application/json" \
  -d '{"slug": "acme-corp"}'
```

`status → active`, audit `activate`. Le tenant est désormais accepté par `assertTenantActive` (sinon 403).

---

## 5. Étape 3 — Ajuster les quotas (optimistic locking)

`update_tenant` exige `expected_version` (la valeur `x_version` actuelle) — verrouillage optimiste applicatif, **pas de trigger PG**.

Récupérer la version courante :

```bash
curl -s -X POST https://admin.thesocle.net/api/actions/iam_worker/get_tenant \
  -H "Content-Type: application/json" -d '{"slug":"acme-corp"}' | jq '.data | {x_version, max_apps, max_users}'
```

Puis mettre à jour (ex. relever `max_apps` à 25) :

```bash
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/update_tenant \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "acme-corp",
    "expected_version": 3,
    "max_apps": 25,
    "max_users": 100,
    "plan": "enterprise"
  }'
```

Si `expected_version` ne correspond plus (quelqu'un a modifié entre-temps) → `OptimisticLockException` (relire `x_version` et réessayer).

**Enforcement** : `max_apps` est vérifié par `assertCanInstallApp` (count sur `apps.applications WHERE x_partition = ? AND x_active = TRUE`) — appelé par `install_app` (cf. [[howto-03-installer-une-app|HOWTO 03]]). `max_users` par `assertCanCreateUser` au `create_user`. Dépassement → `quota_exceeded_apps` / `quota_exceeded_users`.

---

## 6. Étape 4 — Suspendre / restaurer / supprimer

### Suspendre (raison obligatoire)

```bash
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/suspend_tenant \
  -H "Content-Type: application/json" \
  -d '{"slug": "acme-corp", "reason": "impayés facture 2026-06"}'
```

`status → suspended`, `suspended_at=now()`, audit `suspend`. Toute requête authentifiée du tenant retourne alors **403** (`tenant_suspended`). Refusé sur le tenant `system` (409).

### Restaurer

```bash
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/restore_tenant \
  -H "Content-Type: application/json" -d '{"slug": "acme-corp"}'
```

`status → active`, reset des champs `suspended_*`.

### Supprimer (soft par défaut)

```bash
# soft : status=deleted, données conservées
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/delete_tenant \
  -H "Content-Type: application/json" -d '{"slug": "acme-corp"}'

# hard : DELETE physique — refusé s'il reste des users attachés
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/delete_tenant \
  -H "Content-Type: application/json" -d '{"slug": "acme-corp", "hard": true}'
```

---

## 7. Étape 5 — Accès multi-tenant

Un user peut accéder à plusieurs tenants. Accorder un accès secondaire :

```bash
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/grant_tenant_access \
  -H "Content-Type: application/json" \
  -d '{"user_id": "42", "tenant_slug": "acme-corp", "role": "admin"}'
```

UPSERT dans `iam.tr_user_tenant_access` (`is_primary=FALSE`), idempotent via `UNIQUE(id_users, tenant_slug)`. Révoquer (soft) — refuse de révoquer le tenant **primaire** :

```bash
curl -X POST https://admin.thesocle.net/api/actions/iam_worker/revoke_tenant_access \
  -H "Content-Type: application/json" \
  -d '{"user_id": "42", "tenant_slug": "acme-corp", "reason": "fin de mission"}'
```

Lister les accès : `list_user_tenants` (`user_id`) et `list_tenant_users` (`tenant_slug`).

---

## 8. Étape 6 — Auditer la cohérence inter-schémas

L'audit read-only compare `iam.db_tenants` aux satellites :

```bash
curl -s -X POST https://admin.thesocle.net/api/actions/iam_worker/tenant_consistency_audit \
  -H "Content-Type: application/json" -d '{}' | jq
```

Réponse :

```json
{
  "success": true,
  "data": {
    "registered_tenants": 12,
    "total_divergences": 2,
    "by_category": { "orphan": 1, "thefront_missing_mapping": 1 },
    "divergences": [
      {"category":"orphan","source":"apps.applications.x_partition","slug":"legacy-x","severity":"high"},
      {"category":"thefront_missing_mapping","slug":"acme-corp","severity":"low"}
    ],
    "errors": [],
    "consistent": false
  }
}
```

- **`orphan`** : un satellite (`iam.db_users.tenant_id`, `apps.applications.x_partition`, `thefront.z_thefront_tenants`, `agentia.z_tenant_users`) référence un slug absent de `iam.db_tenants`,
- **`thefront_missing_mapping`** : tenant actif sans UUID dans `z_thefront_tenants` (low — auto-créé au 1er accès).

**Post-migration** : pour rattraper les tenants présents dans `iam.db_users.tenant_id` mais absents du référentiel, utiliser `bootstrap_tenants_from_users` (`dry_run: true` d'abord pour simuler).

---

## 9. Validation

### En base

```sql
-- État du tenant + quotas + version
SELECT tenant_slug, name, status, plan, max_users, max_apps, max_storage_gb,
       x_version, suspended_at, suspended_reason, x_dateCreated
FROM iam.db_tenants WHERE tenant_slug = 'acme-corp';

-- Journal d'audit (append-only)
SELECT action, actor_user_ref, actor_ip, payload, x_dateCreated
FROM iam.tr_tenant_audit
WHERE tenant_slug = 'acme-corp' ORDER BY x_dateCreated DESC;

-- Accès multi-tenant
SELECT id_users, tenant_slug, role, is_primary, granted_by, revoked_at, x_active
FROM iam.tr_user_tenant_access WHERE tenant_slug = 'acme-corp';
```

### Vérifier le StrictMode

```sql
-- Doit valoir false en 3.12.1
SHOW soclehub.iam.tenant.auto-create;  -- (propriété Spring, sinon vérifier la config)
```

Tester l'enforcement : un JWT portant `tenant: "inconnu"` doit recevoir **403 `tenant_not_registered`** (mappé par `ApiAuthFilter`).

### IHM Portail

`https://admin.thesocle.net/hub/iam/tenants` (`PortalTenantController`) — liste, détail `/hub/iam/tenants/{slug}`, actions create/activate/suspend/restore/delete/update/grant/revoke/bootstrap.

---

## 10. Pièges courants

### Piège 1 — `tenant_not_registered` (403) après migration

**Symptôme** : des users qui fonctionnaient avant reçoivent 403 depuis le passage 3.11.0+.

**Cause** : StrictMode `auto-create=false` — leur `tenant_id` n'est pas dans `iam.db_tenants` (avant, il était auto-créé).

**Résolution** : `bootstrap_tenants_from_users` (`dry_run` d'abord) pour créer les tenants manquants. En urgence/rollback temporaire, repasser `IAM_TENANT_AUTO_CREATE=true` (legacy permissif) puis recréer le container Hub — mais l'objectif est StrictMode.

### Piège 2 — `OptimisticLockException` sur `update_tenant`

**Symptôme** : l'update échoue alors que les valeurs semblent bonnes.

**Cause** : `expected_version` ≠ `x_version` actuel (modification concurrente, ou version lue trop tôt).

**Résolution** : relire `get_tenant` pour obtenir le `x_version` à jour, puis renvoyer l'update avec ce nouveau `expected_version`.

### Piège 3 — Mutation refusée sur le tenant `system` (409)

**Symptôme** : suspend/delete/update sur `system` → 409 Conflict.

**Cause** : le tenant `system` est **immutable** (`assertNotSystem`) et exempté des quotas.

**Résolution** : ne jamais cibler `system` pour ces opérations — c'est volontaire.

### Piège 4 — `reason` manquante au `suspend_tenant`

**Symptôme** : l'action échoue / refuse.

**Cause** : `reason` est obligatoire (audit forcé).

**Résolution** : toujours fournir `reason` (apparaît dans `tr_tenant_audit` et `suspended_reason`).

### Piège 5 — `delete_tenant hard=true` refusé

**Symptôme** : suppression physique rejetée.

**Cause** : il reste des users attachés au tenant (FK `ON DELETE RESTRICT` sur `tr_user_tenant_access.id_users`).

**Résolution** : réaffecter/supprimer les users d'abord, ou rester en soft delete (`status=deleted`).

### Piège 6 — Quota `max_apps` non appliqué comme attendu

**Symptôme** : une install passe alors que le quota semble atteint, ou inversement.

**Cause** : `assertCanInstallApp` compte `apps.applications WHERE x_partition = <slug> AND x_active = TRUE` — les apps soft-deleted (`x_active=FALSE`) ne comptent pas, et le compte est par **slug** (= `x_partition`), pas global.

**Résolution** : vérifier le compte réel :

```sql
SELECT count(*) FROM apps.applications WHERE x_partition = 'acme-corp' AND x_active = TRUE;
```

### Piège 7 — Tenant `orphan` détecté par l'audit mais introuvable côté référentiel

**Symptôme** : `tenant_consistency_audit` liste un `orphan` `high`.

**Cause** : un satellite (souvent `apps.applications.x_partition`) référence un slug jamais créé dans `iam.db_tenants` (install historique avant StrictMode).

**Résolution** : créer le tenant manquant (`create_tenant` + `activate_tenant`) ou corriger/migrer le `x_partition` de l'app concernée. Ne **jamais** poser de FK dure : l'invariant du système est l'absence de FK entre `db_users.tenant_id`/`x_partition` et `db_tenants.tenant_slug` (compat + future fédération IDP).

---

## 11. Pour aller plus loin

- [[13-iam-tenant-management|IAM Tenant Management]] — fiche de référence : state machine, quotas, audit cohérence, tables `iam.*`,
- [[10-iam-worker|IamWorker]] — users, rôles, scopes, API keys, JWT RS256/JWKS,
- [[92-thefront-tenant-rls|TheFront — tenant RLS]] — `z_thefront_tenants` (mapping slug → UUID), RLS PostgreSQL,
- [[71-sso-oidc|SSO / OIDC]] — claim `tenant`, header `X-SSO-Tenant`,
- [[70-securite-filtres|Sécurité & filtres]] — `ApiAuthFilter` et l'enforcement `assertTenantActive` (403),
- [[howto-08-creer-utilisateur-iam|HOWTO 08 — Créer un utilisateur IAM]] — créer des users dans un tenant.
