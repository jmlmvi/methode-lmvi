# HOWTO tenant-02 — Poser le tenant courant pour le pack (MDC `tenant_id`)

**Niveau :** Intermédiaire
**Cible :** `socle-pack-tenant` 0.6.0 (socle-v005 5.10.x) et 0.5.0 (socle 5.8.9 → 5.9.x) — même contrat MDC
**Vérifié au code :** 2026-10-28 (pack `FicheService.slugCourant()` ; JAR socle 5.9.5 **et 5.10.0** inspectés)
**Prérequis :** [[howto-tenant-01-integrer-le-pack|tenant-01]] ; l'app est derrière le proxy du Hub (SSO) et `TRUSTED_PROXIES` est réglé (`UC-SEC-06`)
**Temps estimé :** 20 min

---

## 1. Contexte

Toutes les méthodes « du tenant courant » du pack — `TenantProfile.fiche()`, `TenantBranding.*`,
`TenantMembres.membres()`, l'objet Thymeleaf `#tenant` — commencent par :

```java
TenantContext ctx = TenantContext.fromMdc();
return (ctx != null && ctx.isPresent()) ? ctx.tenantId() : null;
```

Le pack lit donc le tenant **dans le MDC SLF4J, clé `tenant_id`** (`TenantContext.MDC_KEY`). Il ne
lit ni l'en-tête `X-SSO-Tenant`, ni le JWT, ni l'`ActionContext`.

Et **aucune classe du socle ne pose cette clé** — **toujours pas en 5.10.0**. Vérifié dans les JAR
5.9.5 et 5.10.0 : aucun `MDC.put` du socle ne porte sur `tenant_id` ; seule `TenantContext` (la
constante `MDC_KEY` et `fromMdc()`) la lit. Les classes `TenantContextFilter` /
`TenantContextHolder`, longtemps citées par le `CLAUDE.md` du pack (corrigé en 0.6.0), n'existent pas. Le
socle définit le contrat MDC ; **c'est à l'application de le remplir**, à chaque point d'entrée.

C'est le point de couture avec les fiches `UC-SEC-05` (le tenant arrive par l'identité, jamais par
les paramètres) et `UC-SEC-06` (l'en-tête n'est cru que derrière un proxy de confiance).

Cas réel : `APP-24-TheSociety`, `ContexteAppelantFilter` + `ContexteAppelantFilterMdcTest`.

---

## 2. Architecture

```
 Navigateur ──► Proxy du Hub (SSO) ──► App
                 pose X-SSO-Tenant        │
                                          ▼
              ┌──────────── Point d'entrée de l'app ────────────┐
              │ HTTP  : filtre servlet   lit X-SSO-Tenant        │
              │ MCP/REST action : TenantContext.fromActionContext│
              │ Worker planifié : boucle explicite sur les slugs │
              │            MDC.put("tenant_id", slug)            │
              │            try { … } finally { MDC.remove(…) }   │
              └───────────────────────┬──────────────────────────┘
                                      ▼
                     socle-pack-tenant : TenantContext.fromMdc()
```

---

## 3. Étape 1 — Requêtes HTTP : un filtre servlet

```java
package eu.lmvi.identite;

import eu.lmvi.socle.tenant.TenantContext;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Pose le tenant de la requête dans le MDC, clé tenant_id : c'est là que socle-pack-tenant le lit.
 * Le socle ne le fait pas lui-même.
 */
@Component
@Order(2)
public class TenantMdcFilter implements Filter {

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest http = (HttpServletRequest) req;
        String tenant = vide(http.getHeader("X-SSO-Tenant"));
        if (tenant != null) {
            MDC.put(TenantContext.MDC_KEY, tenant);
        }
        try {
            chain.doFilter(req, res);
        } finally {
            // Les threads du serveur sont réutilisés : un MDC laissé en place ferait lire au pack
            // le tenant du requérant précédent.
            MDC.remove(TenantContext.MDC_KEY);
        }
    }

    private static String vide(String v) {
        return (v == null || v.isBlank()) ? null : v.trim();
    }
}
```

`X-SSO-Tenant` porte le **slug** du tenant (= sous-domaine = `x_partition`). C'est la valeur
attendue par `/api/iam/tenant/{slug}/fiche`.

---

## 4. Étape 2 — Actions MCP / REST

Une action reçoit son tenant dans l'`ActionContext`, pas dans le MDC. Deux façons correctes :

**A — désigner le tenant explicitement** (recommandé, rien à nettoyer) :

```java
package eu.lmvi.workers;

import eu.lmvi.socle.action.ActionProvider;
import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionMetadata;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.action.model.ExecutionMode;
import eu.lmvi.socle.pack.tenant.api.TenantProfile;
import eu.lmvi.socle.tenant.TenantContext;
import eu.lmvi.socle.worker.Worker;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
public class SocieteWorker implements Worker, ActionProvider {

    private final TenantProfile profil;
    private volatile boolean demarre;

    public SocieteWorker(TenantProfile profil) {
        this.profil = profil;
    }

    @Override public String getName() { return "societe_worker"; }
    @Override public void initialize() { }
    @Override public void start() { demarre = true; }
    @Override public void doWork() { }
    @Override public void stop() { demarre = false; }
    @Override public boolean isHealthy() { return demarre; }
    @Override public boolean isPassive() { return true; }
    @Override public Map<String, Object> getStats() { return Map.of("demarre", demarre); }

    @Override
    public List<ActionMetadata> getActions() {
        return List.of(ActionMetadata.builder()
                .name("ma_societe")
                .description("Raison sociale du tenant de l'appelant")
                .mode(ExecutionMode.SYNC)
                .readOnly(true)
                .build());
    }

    @Override
    public ActionResult executeAction(String action, ActionParameters params, ActionContext ctx) {
        TenantContext t = TenantContext.fromActionContext(ctx);
        if (t == null || !t.isPresent()) {
            return ActionResult.ofFailure("aucun tenant dans le contexte d'appel");
        }
        return profil.ficheDe(t.tenantId())
                .map(f -> ActionResult.ofSuccess(Map.of(
                        "slug", f.slug(),
                        "raison_sociale", f.raisonSociale())))
                .orElseGet(() -> ActionResult.ofFailure(
                        "aucune fiche servie pour « " + t.tenantId() + " »"));
    }
}
```

**B — poser le MDC le temps de l'action**, quand le code appelé utilise les méthodes « courantes »
(`fiche()`, `TenantBranding`, `TenantMembres.membres()`) :

```java
TenantContext t = TenantContext.fromActionContext(ctx);
if (t != null && t.isPresent()) {
    MDC.put(TenantContext.MDC_KEY, t.tenantId());
}
try {
    return ActionResult.ofSuccess(Map.of("nom", profil.fiche().nomAffiche()));
} finally {
    MDC.remove(TenantContext.MDC_KEY);
}
```

---

## 5. Étape 3 — Travail planifié (worker de cycle, cron)

Un worker planifié n'a **pas** de tenant : aucun appelant. Il itère sur les tenants qu'il sert et
pose le MDC **par itération** :

```java
for (String slug : depot.slugsActifs()) {
    MDC.put(TenantContext.MDC_KEY, slug);
    try {
        envoyerRapport(profil.fiche(), marque.logoBytes());
    } catch (TenantSansFiche e) {
        log.warn("[rapport][tenant:{}] sans fiche : {}", slug, e.getMessage());
    } finally {
        MDC.remove(TenantContext.MDC_KEY);
    }
}
```

---

## 6. Vérifier

```bash
# Avec tenant (le proxy du Hub pose X-SSO-Tenant)
curl -s https://monapp.thesocle.net/api/societe -b "soclehub_token=$JWT"
# → 200 {"slug":"atelier-des-parcours",…}

# En direct, sans proxy, en-tête absent
curl -s http://localhost:8080/api/societe
# → 503 {"erreur":"aucun tenant résolu : aucun tenant dans le contexte de l'appel"}
```

---

## 7. Validation

Test de non-fuite, à garder dans l'app (modèle : `ContexteAppelantFilterMdcTest` d'APP-24) :

```java
package eu.lmvi.identite;

import eu.lmvi.socle.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.*;

class TenantMdcFilterTest {

    private final TenantMdcFilter filtre = new TenantMdcFilter();

    @Test
    void leTenantEstVuPendantLaChaineEtRetireApres() throws Exception {
        var req = new MockHttpServletRequest();
        req.addHeader("X-SSO-Tenant", "altitude");
        String[] vu = new String[1];
        filtre.doFilter(req, new MockHttpServletResponse(),
                (q, r) -> vu[0] = MDC.get(TenantContext.MDC_KEY));
        assertEquals("altitude", vu[0]);
        assertNull(MDC.get(TenantContext.MDC_KEY));
    }

    @Test
    void leTenantEstRetireMemeQuandLaChaineLeve() {
        var req = new MockHttpServletRequest();
        req.addHeader("X-SSO-Tenant", "ancrage");
        assertThrows(IllegalStateException.class, () -> filtre.doFilter(req,
                new MockHttpServletResponse(), (q, r) -> { throw new IllegalStateException(); }));
        assertNull(MDC.get(TenantContext.MDC_KEY));
    }
}
```

| # | Test | Attendu |
|---|---|---|
| 1 | Deux requêtes successives, tenants différents, même thread | chaque réponse porte sa propre société |
| 2 | Chaîne qui lève | MDC vide après |
| 3 | Action MCP avec un appelant porteur d'un tenant | la société de ce tenant |
| 4 | Worker planifié sans boucle explicite | `TenantSansFiche` — jamais la fiche d'un tenant « au hasard » |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Croire que le socle pose le tenant | une route de l'app répond 200 (contexte propre de l'app), la route qui passe par le pack 500 | filtre §3 |
| Oublier le `finally` | la fiche d'une société servie à une autre, de façon intermittente | `MDC.remove` dans `finally`, test §7 |
| Lire le tenant dans un paramètre de requête ou un corps | falsifiable par l'appelant | identité seulement (`UC-SEC-05`) |
| Croire `X-SSO-Tenant` sans proxy de confiance | n'importe qui choisit son tenant | `TRUSTED_PROXIES` (`UC-SEC-06`) |
| Action qui appelle `profil.fiche()` sans MDC | `TenantSansFiche` dans une action pourtant authentifiée | `ficheDe(fromActionContext(ctx).tenantId())` ou §4-B |
| Poser le slug en majuscules ou le libellé du tenant | 404 côté Hub → `TenantSansFiche` | le slug exact (`atelier-des-parcours`) |

---

## 9. Pour aller plus loin

- `APP-ZZ-TEMPLATE/docs/use-cases/UC-SEC-05-transmettre-scopes-et-tenant.md`
- `APP-ZZ-TEMPLATE/docs/use-cases/UC-SEC-06-proxy-de-confiance.md`
- `APP-ZZ-TEMPLATE/docs/use-cases/UC-DB-09-isoler-par-tenant.md` — même `TenantContext` pour les données de l'app
- [[howto-09-configurer-sso-multi-app|HOWTO 09]] — le SSO qui pose `X-SSO-Tenant`
- [[howto-tenant-03-lire-la-fiche-societe|tenant-03]] — ce qu'on lit ensuite
