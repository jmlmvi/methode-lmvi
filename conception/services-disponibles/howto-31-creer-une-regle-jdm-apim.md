# HOWTO 31 — Créer et publier une règle JDM pour l'APIM

> **Niveau** : avancé | **Prérequis** : SocleHub Hub 3.12.1 démarré, au moins une API publiée (cf. [[howto-30-publier-une-api-apim|HOWTO 30]]), notions de tables de décision GoRules/JDM, accès admin APIM | **Temps estimé** : 15-30 min

Ce guide montre comment personnaliser le comportement runtime de l'APIM **sans recompiler**, à l'aide des **règles JDM** (graphes GoRules : decision tables + expressions) évaluées par `ApimJdmService` aux **points de décision** du pipeline. On couvre : les points de décision, le cycle de vie `draft → published → archived`, le clonage depuis un **template** prêt à l'emploi, et le test d'évaluation.

> ⚠️ Ne pas confondre avec le `rule_engine_worker` générique du Socle : l'APIM intègre directement `JdmEngine` (`socle-jdm-core`) et stocke ses règles dans `apim.tr_jdm_rule`.

---

## 1. Contexte

L'opérateur veut, par exemple : facturer au token LLM, basculer sur un backend de secours quand le primaire est dégradé, bloquer un tenant pendant une fenêtre de maintenance, ou booster le quota d'un plan Enterprise. Tout cela se fait par une règle JDM appliquée à un point précis du pipeline, par portée (`global` / `per_api` / `per_tenant` / `per_api_per_tenant`) et par priorité.

La règle doit :

- Cibler un **point de décision** parmi les 5 points cœur,
- Produire des sorties interprétées par `applyOutput` (rejet, coût, quota, routage…),
- Suivre un cycle `draft → published → archived` (seules les `published` + `x_active` tournent),
- Idéalement être **clonée depuis un template** (12 seeds prêts à l'emploi) puis publiée.

---

## 2. Architecture

```
   Pipeline APIM (préprocess/postprocess)
        │ jdmService.evaluate(point, ctx)
        ▼
   ┌──────────────────────────────────────────────┐
   │            ApimJdmService                     │
   │  byDecisionPoint: Map<point, List<rule>>      │  ← reload @Scheduled 5 min
   │  filterApplicable : global → per_api →         │     (SELECT WHERE status='published'
   │     per_tenant → per_api_per_tenant            │      AND x_active, ORDER BY priority)
   │  engine.evaluateJson(rule.jdmJson, input)     │
   │  applyOutput → ctx.{rejected, costEurCents,   │
   │     quotaMultiplier, routingTarget, ...}      │
   └──────────────────────┬───────────────────────┘
                          │ jdmInputs construit par
                          ▼ ApimJdmEnricher.enrich(ctx)
   (primary_healthy, calls_last_minute, errors_5xx, calls_this_month,
    tenant_blocked_until, client_country, tokens_in/out, model)

   ┌──────────────────────────────────────────────┐
   │  ApimJdmTemplateService.cloneIntoRule         │
   │  apim.tr_jdm_template (12 seeds) ──► draft    │
   │     pricing / routing / access / quota         │
   └──────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Choisir le point de décision

Les **5 points cœur** normalisés (`JdmRuleRecord`) et leur position dans le pipeline :

| Point de décision | Moment | Usage typique |
|-------------------|--------|---------------|
| `apim_pre_auth` | avant l'auth | filtre IP, blacklist user-agent |
| `apim_post_auth` | après l'auth (tenant connu) | restrictions tenant : path, méthode |
| `apim_pre_route` | avant le forward | override backend, transform du path |
| `apim_post_route` | après le forward | transform de la réponse |
| `apim_pricing` | post-forward | calcul custom du coût (`cost_eur_cents`) |
| `apim_forward` **[3.20.0]** | **à la place** du forward | repli / cascade sur l'appel sortant — **scripts Janino uniquement** |

> La contrainte CHECK du schéma `apim.tr_jdm_rule.decision_point` autorise un sur-ensemble historique (`apim_pre_request`, `apim_quota`, `apim_routing`, `apim_access`, `apim_post_response`…) effectivement évalués par le pipeline (cf. les hooks `apim_quota`, `apim_routing` dans [[120-apim-architecture-pipeline]]). Les **cinq points documentés** ci-dessus sont ceux normalisés par le code. **[3.20.0]** la migration `V012` porte la liste à 11 valeurs et ajoute `apim_forward`.

### Graphe ou script ? **[3.20.0]**

Une règle porte désormais un `kind` :

| Choisir | Quand |
|---------|-------|
| **`jdm`** (défaut) | La politique se décide **avant** l'appel, sans boucle : filtres, tarifs, quotas, choix de backend. Déclaratif, auditable, sans code. **À préférer dès qu'il suffit.** |
| **`janino`** | La politique doit **rappeler le réseau** : rejouer sur 429, cascade multi-modèles, dégradation progressive. Impossible à exprimer dans un graphe. |

Un script reçoit et rend la **même Map** qu'un graphe : les deux sont interchangeables sur les points existants. Seul `apim_forward` est réservé aux scripts — une règle `jdm` qui y serait montée est ignorée avec un avertissement.

### Sorties de règle interprétées (`applyOutput`)

| Clé de sortie JDM | Effet sur `ApimContext` |
|-------------------|-------------------------|
| `rejected=true` / `allow=false` | rejet (403 par défaut) |
| `rejection_status` | override du statut HTTP de rejet |
| `rejection_reason` / `message` | raison du rejet |
| `retry_after_seconds` | pose `Retry-After` |
| `cost_eur_cents` | `ctx.costEurCents` (consommé par le wallet, cf. [[124-apim-pricing-wallet-billing]]) |
| `quota_multiplier` | `ctx.quotaMultiplier` (appliqué avant le rate-limit) |
| `routing_target` / `target_backend_override` / `use_backup` / region | `ctx.routingTarget` → backend nommé `apim.tr_api_backend` |

---

## 4. Étape 2 (recommandée) — Partir d'un template

`JdmTemplateSeed` sème **12 templates** au démarrage, par catégorie :

- **pricing** : `pricing-tokens-llm`, `pricing-degressive`, `pricing-free-tier-sliding`, `pricing-tier-by-plan`,
- **routing** : `routing-failover`, `routing-ab-testing`, `routing-region-based`,
- **access** : `access-maintenance-window`, `access-ip-whitelist`, `access-tenant-blacklist-hourly`,
- **quota** : `quota-boost-enterprise`, `quota-spike-protection`.

Lister les templates (filtres `category`, `complexity`) :

```bash
curl -s -H "X-Internal-Auth: dev" \
  "http://localhost:8080/api/apim/admin/jdm-templates?category=pricing" | jq '.[] | {x_id, slug, decision_point, complexity}'
```

Détail d'un template :

```bash
curl -s -H "X-Internal-Auth: dev" \
  http://localhost:8080/api/apim/admin/jdm-templates/3 | jq
```

Cloner le template vers une règle `draft` rattachée à l'API 42 (portée `per_api`) :

```bash
curl -s -X POST http://localhost:8080/api/apim/admin/jdm-templates/3/clone \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{
    "id_published_api": 42,
    "id_tenant": null,
    "scope": "per_api",
    "custom_slug": "data-items-pricing-tokens"
  }' | jq
```

> Le clone insère une règle `status='draft'` portant `source_template_id`, **sans synchronisation ultérieure** (le template est un modèle statique). Le clone **ne déclenche pas** de reload : il faut publier pour entrer en moteur.

---

## 5. Étape 3 (alternative) — Créer une règle à la main

```bash
curl -s -X POST http://localhost:8080/api/apim/admin/jdm-rules \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{
    "slug": "data-items-maintenance",
    "display_name": "Fenêtre de maintenance DataApp",
    "scope": "per_api",
    "id_published_api": 42,
    "id_tenant": null,
    "decision_point": "apim_pre_auth",
    "priority": 10,
    "jdm_json": {
      "nodes": [
        {"id": "in",  "type": "inputNode",  "name": "request"},
        {"id": "exp", "type": "expressionNode", "name": "deny",
         "content": {"expressions": [
           {"key": "rejected", "value": "true"},
           {"key": "rejection_status", "value": "503"},
           {"key": "message", "value": "\"Maintenance en cours\""}
         ]}},
        {"id": "out", "type": "outputNode", "name": "decision"}
      ],
      "edges": [
        {"sourceId": "in", "targetId": "exp"},
        {"sourceId": "exp", "targetId": "out"}
      ]
    }
  }' | jq
```

La règle est créée en `status='draft'` (`ApimAdminApiController`). Les portées possibles : `global`, `per_api`, `per_tenant`, `per_api_per_tenant` (ordre d'application : `global` → `per_api` → `per_tenant` → `per_api_per_tenant`, puis `priority` ASC).

---

## 6. Étape 4 — Tester avant publication

L'endpoint `evaluate` exécute la règle sur un contexte simulé **sans** l'activer en production :

```bash
curl -s -X POST http://localhost:8080/api/apim/admin/jdm-rules/57/evaluate \
  -H "Content-Type: application/json" -H "X-Internal-Auth: dev" \
  -d '{
    "input": {
      "request": {"path": "/items", "method": "GET"},
      "tenant": {"plan": "free"},
      "tokens_in": 1200, "tokens_out": 800, "model": "glm47"
    }
  }' | jq
```

> Pour les règles `apim_pricing` LLM, `ApimJdmEnricher.enrichPostForward` extrait `tokens_in`/`tokens_out`/`model` du corps de réponse OpenAI : reproduire ces clés dans l'input de test.

---

## 7. Étape 5 — Publier (entrée en moteur)

```bash
curl -s -X POST http://localhost:8080/api/apim/admin/jdm-rules/57/publish \
  -H "X-Internal-Auth: dev" | jq
```

La publication :

1. archive automatiquement l'ancienne règle `published` portant le **même slug**,
2. passe la règle ciblée en `status='published'`,
3. la règle entre en cache au prochain `reload()` (planifié toutes les 5 min, ou immédiat selon l'implémentation de publish).

Cycle de vie complet :

```
(création) ──► draft ──publish──► published ──archive──► archived
                ▲                    │
                └──── PUT (édition) ─┘   (l'édition jdm_json repasse en draft)
```

Pour retirer une règle de production : `POST /api/apim/admin/jdm-rules/57/archive`.

---

## 8. Validation

### Règle en base

```sql
SELECT x_id, slug, decision_point, scope, id_published_api, id_tenant,
       priority, status, version, source_template_id
FROM apim.tr_jdm_rule WHERE slug = 'data-items-maintenance';
-- status doit être 'published' et x_active=TRUE pour entrer en cache
```

### Règles actives via MCP

Le worker générique `rule_engine_worker` ne gère pas ces règles APIM ; pour vérifier le **cache JDM APIM**, lire les métriques :

```bash
curl -s -H "X-Internal-Auth: dev" \
  http://localhost:8080/api/apim/admin/metrics | jq '{active_jdm_rules}'
```

`active_jdm_rules` = `COUNT(*) … status='published'`. Les compteurs `total_evaluations` / `total_rejections` reflètent l'activité du moteur.

### Effet observable

Appeler l'API ciblée et constater le comportement de la règle :

```bash
curl -s -i https://data-items.thesocle.net/items \
  -H "X-API-Key: sk_prod_xxxx"
# règle de maintenance publiée → HTTP/1.1 503 + {"message":"Maintenance en cours"}
```

L'audit conserve la trace de la décision dans `apim.tr_api_call_audit.jdm_pre_decisions` / `jdm_post_decisions`.

---

## 9. Pièges courants

### Piège 1 — La règle ne s'applique pas après publication

**Symptôme** : la règle est `published` mais le comportement ne change pas.

**Cause** : le cache `byDecisionPoint` n'a pas encore rechargé (reload planifié toutes les 5 min) **ou** `x_active=FALSE`. Seules les règles `published` ET `x_active=TRUE` entrent en cache.

**Résolution** : attendre/forcer un reload, vérifier `x_active`, re-publier la règle.

### Piège 2 — Clone publié mais sans effet

**Symptôme** : après `clone`, rien ne se passe.

**Cause** : `cloneIntoRule` crée une règle en `draft` et **ne déclenche pas** de reload. Le clone n'entre jamais en moteur tant qu'il n'est pas publié.

**Résolution** : `POST /api/apim/admin/jdm-rules/{id}/publish` sur la règle clonée.

### Piège 3 — Mauvais point de décision

**Symptôme** : une règle de pricing en `apim_pre_auth` n'a aucun effet sur le coût.

**Cause** : `cost_eur_cents` n'est lu qu'au point `apim_pricing` (post-forward) ; `routing_target` n'est consommé qu'aux points de routage (`apim_pre_route`/`apim_routing`).

**Résolution** : aligner `decision_point` sur la sortie produite (voir tableau §3).

### Piège 4 — Deux règles `published` même slug

**Symptôme** : surprise de comportement après publish.

**Cause** : la publication archive l'ancienne `published` **de même slug uniquement**. Deux slugs différents sur le même point/portée cohabitent et s'appliquent toutes deux (ordre portée puis priorité).

**Résolution** : raisonner par slug + priorité ; archiver explicitement les règles obsolètes.

### Piège 5 — `jdm_json` invalide

**Symptôme** : `evaluate` renvoie une erreur du moteur, ou la règle ne produit rien.

**Cause** : graphe GoRules mal formé (node `inputNode`/`outputNode` manquant, edges incohérents). Le moteur est instancié sans cache de compilation (`new JdmEngine(false)`).

**Résolution** : valider le graphe via `/evaluate` avant publication ; partir d'un template clonable plutôt que d'écrire le JSON à la main.

### Piège 6 — Routage vers un backend inexistant

**Symptôme** : `routing_target` posé mais la requête part quand même vers le primaire.

**Cause** : `ApiBackendCatalog.find(apiId, name)` retourne vide pour `name` nul/vide/`"primary"`, ou le backend nommé n'existe pas dans `apim.tr_api_backend`.

**Résolution** : créer le backend nommé (`apim.tr_api_backend`, `x_active=TRUE`) avant de référencer son nom dans la règle.

---

## 9 bis. Écrire une règle Janino **[3.20.0]**

**Quand** : uniquement si la politique doit rappeler le réseau (repli sur 429/5xx). Sinon, un graphe fait l'affaire — voir le tableau « Graphe ou script ? ».

**Marche à suivre**

1. **Cloner le template** `script-cascade-retry` (catégorie `script`, point `apim_forward`) plutôt que d'écrire de zéro :
   `POST /api/apim/admin/jdm-templates/{id}/clone` avec `id_published_api` et `scope`.
2. **Adapter les deux tableaux** en tête du script :
   - `BACKENDS[]` — chaque nom doit exister dans `apim.tr_api_backend` pour cette API (`x_active=TRUE`) ;
   - `MODELS[]` — modèle écrit dans le champ `model` du corps JSON ; `null` = corps inchangé. **Indispensable** quand le rang de repli sert un autre modèle, sinon il répond `model_not_found`.
3. **Publier** (`POST /jdm-rules/{id}/publish`) — comme pour un graphe, seules les règles `published` entrent en moteur.

**Contrat du script**

| Élément | Valeur |
|---------|--------|
| Interface | `Executable` (`scriptInterface='executable'`), méthode `Object execute(Map input)` |
| Émetteur | `input.get("forward")` → `ApimForwardHelper`, méthode `int send(backendName, modelOverride)` |
| Sortie attendue | `forward_handled=true` si le script a émis l'appel ; `reason` pour la trace d'audit |
| Stockage | `tr_jdm_rule.script_source` (**pas** un fichier : `/app/repository` n'est monté sur aucun volume) |

**Trois règles à ne pas transgresser**

- **Ne jamais ouvrir une connexion** : `java.net` et `java.io` sont bloqués par le bac à sable. Tout appel sortant passe par `forward.send(...)`.
- **Ne pas rejouer une 4xx** (hors 429) : un autre rang la refuserait pareil, on ne fait qu'ajouter de la latence.
- **Recompilation automatique** : le cache est indexé par `id + version` de la règle ; éditer la source suffit, aucune purge manuelle.

**En cas d'erreur** : compilation ou exécution en échec ⇒ sortie vide, journalisation, et **forward par défaut**. Un script fautif dégrade la politique, il ne coupe jamais le trafic. C'est l'invariant qui rend la fonctionnalité sûre à essayer en production.

---

## 10. Pour aller plus loin

- [[125-apim-jdm-rules-engine]] — moteur JDM **et scripts Janino**, `applyOutput`, enrichissement, les 13 templates,
- [[120-apim-architecture-pipeline]] — ordre exact des hooks JDM dans le pipeline,
- [[124-apim-pricing-wallet-billing]] — consommation de `cost_eur_cents` par le wallet,
- [[121-apim-published-apis-catalog]] — backends nommés (`tr_api_backend`) ciblés par `routing_target`,
- [[howto-30-publier-une-api-apim|HOWTO 30]] — publier l'API sur laquelle s'appliquent les règles.
