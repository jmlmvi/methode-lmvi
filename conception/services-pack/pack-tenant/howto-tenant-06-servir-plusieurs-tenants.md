# HOWTO tenant-06 — Servir plusieurs tenants depuis une même application

**Niveau :** Confirmé
**Cible :** `socle-pack-tenant` ≥ 0.4.0 (propriété `envoyer-tenant-actif`) — documenté sur 0.5.0
**Hub :** ≥ 3.63.0 (`ApiAuthFilter` lit `X-Active-Tenant`, `iam.tr_user_tenant_access`)
**Vérifié au code :** 2026-10-28 (`HubTenantClient.requete()`, `EnteteTenantActifTest`)
**Prérequis :** [[howto-tenant-01-integrer-le-pack|tenant-01]] ; droits d'administration IAM sur le Hub
**Temps estimé :** 20 min

---

## 1. Contexte

Ce n'est pas l'utilisateur connecté qui s'authentifie auprès du Hub : c'est **l'application**, avec
sa clé APIM. Le Hub (`ApiAuthFilter`) pose alors `auth.tenant` depuis le tenant du **propriétaire
de la clé**, et `IamTenantFicheController.refusSiAutreTenant()` applique la règle « un appelant
porteur d'un tenant ne lit que le sien ».

Une app qui sert **un** tenant n'a rien à faire. Une app qui en sert **plusieurs**, un à la fois
selon qui se connecte, se heurte à un mur : tout tenant autre que celui de la clé répond
`403 tenant_access_denied`. Et **cela ne se voit pas** : le pack traite `401`/`403` comme une
indisponibilité, sert la fiche en cache ou lève `TenantSansFiche`, et en lecture double le compteur
`hub_muet` monte. La panne a l'apparence d'un Hub absent.

Cas réel : `APP-28-Your360`, quatre cabinets (`lmvi`, `altitude`, `ancrage`, `boussole`),
`envoyer-tenant-actif: true`.

| Ce que fait le Hub (IAM, [[howto-34-gerer-les-tenants-iam\|HOWTO 34]] §7) | Ce que fait le pack |
|---|---|
| tient `iam.tr_user_tenant_access` (`grant_tenant_access` / `revoke_tenant_access`) | joint `X-Active-Tenant: <slug>` à chaque appel `/fiche`, `/membres`, `/logo` |
| vérifie la ligne d'accès du propriétaire de la clé, pose `auth.tenant = <slug>` ou rend `403` | traite le `403` en indisponibilité |

---

## 2. Architecture

```
                  Utilisateur du cabinet « altitude »
                                │ X-SSO-Tenant: altitude
                                ▼
   App multi-tenant ── MDC tenant_id=altitude ── socle-pack-tenant
                                                  GET /api/iam/tenant/altitude/fiche
                                                  X-API-Key: apim_… (propriétaire : svc-your360)
                                                  X-Active-Tenant: altitude
                                │
                                ▼
   Hub — ApiAuthFilter
     ligne (svc-your360, altitude) dans iam.tr_user_tenant_access ?
        oui → auth.tenant = altitude → 200 + ETag
        non → 403 tenant_access_denied → mode dégradé côté pack
```

Deux voies existent ; une seule convient à une app métier :

| Voie | Principe | Portée | À retenir |
|---|---|---|---|
| **`X-Active-Tenant` + grants** (recommandée) | l'app annonce le tenant, le Hub vérifie le grant | tenant par tenant, révocable un à un | un `grant_tenant_access` par tenant servi |
| Clé de plateforme | le propriétaire de la clé **n'a aucun tenant** : `auth.tenant` vide, rien n'est refusé | **toutes** les fiches du Hub | pensée pour le portail et l'administration ; valeur brute en clair dans le journal des actions du Hub |

---

## 3. Étape 1 — Un utilisateur de service propriétaire de la clé

Les comptes humains `is_primary` sur un tenant (`jmh@lmvi.eu`, `jm@henry.sh` sur `lmvi`) ne
conviennent pas : `ApiAuthFilter` prend le tenant du propriétaire, quel que soit le paramètre
`tenant` passé à `create_api_key`. Créer un compte de service dédié à l'app
([[howto-08-creer-utilisateur-iam|HOWTO 08]]), puis sa clé APIM
([[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]]).

## 4. Étape 2 — Un grant par tenant servi

```bash
for t in lmvi altitude ancrage boussole; do
  curl -sk -X POST https://admin.thesocle.net/api/actions/iam_worker/grant_tenant_access \
    -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
    -d "{\"user_id\": \"$SVC_USER_ID\", \"tenant_slug\": \"$t\", \"role\": \"reader\"}"
done
```

`UPSERT` idempotent dans `iam.tr_user_tenant_access`. Ce que le contrôle de la fiche exige, d'après
le contrat du pack, c'est **la présence de la ligne** ; la valeur de `role` ci-dessus est celle de
l'exemple et n'a pas été vérifiée contre le code du Hub. Lister : `list_user_tenants`
(`user_id`). Retirer un tenant : `revoke_tenant_access` (avec `reason`).

## 5. Étape 3 — Activer l'en-tête dans l'app

```yaml
socle:
  tenant:
    hub-url: ${SOCLE_TENANT_HUB_URL:https://admin.thesocle.net}
    cle-apim: ${SOCLE_TENANT_CLE_APIM:}
    envoyer-tenant-actif: ${SOCLE_TENANT_ENVOYER_TENANT_ACTIF:true}
```

Le défaut du pack est `false`, et volontairement : une **clé de plateforme** qui enverrait l'en-tête
se verrait exiger un grant qu'elle n'a pas, et passerait de « lit tout » à « 403 ». Une app qui
utilise une clé de plateforme laisse donc la propriété à `false`.

Le code de l'app ne change pas : chaque appel du pack porte le slug demandé — celui du MDC pour
`fiche()`, celui passé en argument pour `ficheDe(slug)` / `membresDe(slug)`.

```java
// Supervision : la fiche de chaque cabinet servi
for (String slug : List.of("lmvi", "altitude", "ancrage", "boussole")) {
    profil.ficheDe(slug).ifPresentOrElse(
            f -> log.info("[supervision][tenant:{}] {}", slug, f.nomAffiche()),
            () -> log.warn("[supervision][tenant:{}] fiche non servie — grant manquant ?", slug));
}
```

---

## 6. Vérifier

```bash
# Avec l'en-tête et un grant : 200
curl -s -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $APIM_KEY" -H "X-Active-Tenant: altitude" \
  https://admin.thesocle.net/api/iam/tenant/altitude/fiche

# Sans l'en-tête, tenant ≠ propriétaire : 403
curl -s -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $APIM_KEY" \
  https://admin.thesocle.net/api/iam/tenant/altitude/fiche
```

Puis, côté app, `refresh_fiche` sur chaque slug (relais `mcp_proxy_invoke`, cf. tenant-01 §7) :
chacun doit rendre un `nom`, aucun ne doit rendre « absente ou injoignable ».

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `refresh_fiche` sur chaque tenant servi | succès ×N |
| 2 | `revoke_tenant_access` sur un tenant puis `refresh_fiche` | échec pour lui seul |
| 3 | `envoyer-tenant-actif=false` sur une clé ordinaire | seul le tenant du propriétaire répond |
| 4 | Tests du pack | `EnteteTenantActifTest` : 5 tests, vrai serveur HTTP du JDK — l'en-tête part sur fiche, membres et logo, et pas quand la propriété est éteinte |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| App multi-tenant, configuration par défaut | 3 cabinets sur 4 « Hub muet », aucune erreur ; fenêtre P4 vide sans explication | `envoyer-tenant-actif: true` + grants |
| Clé frappée par un compte humain primaire sur un tenant | les grants semblent posés, `403` persiste pour d'autres tenants | compte de service dédié |
| Grant oublié pour un nouveau cabinet | ce cabinet seul sert le mode dégradé | ajouter le grant à la procédure d'ouverture d'un tenant |
| `envoyer-tenant-actif: true` avec une clé de plateforme | tout passe en `403` | laisser `false` pour une clé de plateforme |
| Chercher un scope APIM pour `/api/iam/tenant/…` | `list_api_scopes` n'en porte aucun | la route n'est pas publiée sur l'APIM ; le contrôle est `ApiAuthFilter` |
| Croire qu'un `403` sera une erreur visible | le pack l'absorbe en mode dégradé | surveiller les WARN `[pack-tenant] Hub injoignable` |

---

## 9. Pour aller plus loin

- [[howto-34-gerer-les-tenants-iam|HOWTO 34]] §7 — accès multi-tenant côté IAM
- [[howto-tenant-07-fraicheur-cache-et-mode-degrade|tenant-07]] — comment un `403` devient un mode dégradé
- `socle-pack-tenant/docs/CONTRAT-REST.md` §1
