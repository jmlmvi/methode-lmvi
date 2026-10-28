# HOWTO EDITORIAL-03 — Curer et router les articles avec `curation_worker`

**Niveau :** Confirmé
**Cible :** application V005 embarquant le pack — 2.2.0 sur Spring Boot 4.1.2 / socle 5.10-5.11 (2.1.0 idem ; 2.0.0 sur Boot 4.0.6, 1.0.0-SNAPSHOT sur Boot 3.2.1 : contenu identique)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-editorial:2.2.0`, `main` @ `1dbb5c4`, tag `v2.2.0`, construit contre socle 5.11.0 (minimum 5.10.0) (code identique à 2.1.0 — `1fb6c6a`, tag `v2.1.0` — et fonctionnellement identique à 2.0.0 — tag `v2.0.0` — et à `1.0.0-SNAPSHOT`, commit `fffd6f9`) —
classes `CurationWorker`, `CurationConfigService` ; migrations `V004`, `V006`, `V999`, `V999z` ;
prompts `classify_generic` / `generate_summary` seedés par `socle-pack-ai` (`db/ai/V999__seed_default_prompts.sql`, toujours présent en 2.7.13, 2.8.0 et 2.9.0)
**Prérequis :** [[howto-editorial-02-collecter-des-flux-rss|EDITORIAL-02]] alimente `tr_raw_item` ;
[[howto-ai-01-integrer-le-pack|pack-ai]] configuré avec un fournisseur LLM
**Temps estimé :** 40 min

---

## 1. Contexte

La curation transforme un article brut (`tr_raw_item.status = 'pending'`) en décision :

| Score final | Routage | Effet |
|---|---|---|
| ≥ `score_threshold_high` (70) | `auto_published` | ligne dans `tr_article` (`validated_by = 'auto'`), brut en `published` |
| ≤ `score_threshold_low` (30) | `rejected` | brut en `rejected` |
| entre les deux, `hitl_enabled = true` | `hitl` | ligne dans `tr_hitl_queue`, brut en `curated` — [[howto-editorial-05-valider-en-hitl\|EDITORIAL-05]] |
| entre les deux, `hitl_enabled = false` (défaut) | `auto_published` | pipeline 100 % automatique |

Le score vient d'un appel LLM, puis de bonus/malus par mots-clés : **+5** par mot-clé
`keywords_include` présent, **−10** par mot-clé `keywords_exclude`, borné 0..100.

**Point clé : le worker est PASSIF.** Rien ne déclenche `curate_pending` tout seul. L'application
appelle l'action — par MCP, ou depuis un worker à elle (§5). C'est le premier oubli constaté.

**État :** fonctionnel et testé (`CurationRoutingTest`, `CurationWorkerActivationTest`,
`CurationEnrichmentTest`, `CurationRagIngestTest`, verts). L'action `update_curation_config` est en
revanche **inutilisable depuis la migration `V999z`** (§4, §9). RssArchiver, l'application de
référence, n'utilise plus ce worker : elle cure par son propre pipeline DAG en réutilisant
`CurationConfigService`, `KewClient` et `BibliographicExtractor` du pack.

---

## 2. Architecture

```
curate_pending(limit ≤ 500, défaut 50)          curate_item(raw_item_id)
   │ SELECT … tr_raw_item WHERE status='pending' ORDER BY x_dateCreated ASC LIMIT ?
   ▼ pour chaque article (séquentiel)
 [fetch_full_content] corps complet via web_worker ─────────── EDITORIAL-04
   ▼
 1. score   GenerationWorker.generateOne(partition, scoring_prompt_id,
              {item_type:"article", content, context:{language, keywords_*, source_id}},
              {temperature:0.1, max_tokens:512})
            → JSON extrait entre la 1ʳᵉ « { » et la dernière « } » : score, tags, factors
            → applyKeywordBoosts
 2. résumé  GenerationWorker.generateOne(partition, summary_prompt_id,
              {content, max_sentences, language}, {temperature:0.3, max_tokens:512})
            (échec → le titre sert de résumé)
 3. routage decideRouting(score, cfg)
      auto_published → buildEnrichment (EDITORIAL-04) → INSERT tr_article → RAG (option)
      rejected       → tr_raw_item.status='rejected'
      hitl           → INSERT tr_hitl_queue
```

La configuration est lue dans un **cache mémoire** (`CurationConfigService`), chargé au démarrage et
après chaque `upsert`. Résolution : `(partition, 'rss')` → `(partition, 'default')` →
`(NULL, 'rss')` → `(NULL, 'default')`. `curation_worker` demande toujours le type **`rss`**.

---

## 3. Étape 1 — Lire la configuration effective

```bash
editorial curation_worker__get_curation_config '{}'
```

```json
{"score_threshold_high":70,"score_threshold_low":30,"keywords_include":[],"keywords_exclude":[],
 "languages":["fr","en"],"auto_publish":true,"auto_ingest_to_rag":true,"hitl_enabled":false,
 "fivew1h_enabled":false,"translate_enabled":false,"kew_enabled":false,"fetch_full_content":false,
 "scoring_prompt_id":"classify_generic","summary_prompt_id":"generate_summary","summary_max_sentences":3}
```

---

## 4. Étape 2 — Régler les seuils et les mots-clés

Modifier **la ligne `content_type = 'rss'`** (c'est elle que lit le worker), puis **redémarrer**
l'application : le cache n'a pas d'action de rechargement.

```sql
UPDATE schema_monapp.z_curation_config
SET score_threshold_high = 75,
    score_threshold_low  = 40,
    keywords_include     = '["intelligence artificielle", "souveraineté numérique"]'::jsonb,
    keywords_exclude     = '["cryptomonnaie", "bon plan"]'::jsonb,
    hitl_enabled         = false,
    auto_publish         = true,
    summary_max_sentences = 3
WHERE x_partition IS NULL
  AND content_type = 'rss';
```

```bash
curl -s -X POST "$HUB/api/actions/docker_worker/restart_app" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" -d '{"app_id":"monapp"}'
```

Le journal confirme au démarrage : `[curation-config] loaded 4 configs`.

Combinaisons `auto_publish` × `hitl_enabled` (lues dans `decideRouting`) :

| `auto_publish` | `hitl_enabled` | Comportement |
|---|---|---|
| true | false | seuils ; zone grise publiée (défaut) |
| true | true | seuils ; zone grise en HITL |
| false | true | **tout** part en HITL, quel que soit le score |
| false | false | équivaut à true/false : le mode manuel exige le HITL |

---

## 5. Étape 3 — Déclencher la curation périodiquement

Un worker de l'application, au modèle `SimplePollingWorker` : un tic fixe, un lot borné, des
compteurs dans `getStats()`.

```java
package eu.lmvi.monapp.curation;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.editorial.CurationWorker;
import eu.lmvi.socle.worker.Worker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** Déclenche curation_worker.curate_pending par lots, à cadence fixe. */
@Component
public class CurationCronWorker implements Worker {

    private static final Logger log = LoggerFactory.getLogger(CurationCronWorker.class);

    private final CurationWorker curationWorker;
    private final long intervalMs;
    private final int batch;

    private final AtomicLong executions = new AtomicLong();
    private final AtomicLong traites = new AtomicLong();
    private volatile long derniereExecution;
    private volatile boolean running;

    public CurationCronWorker(CurationWorker curationWorker,
                              @Value("${monapp.curation.interval-ms:180000}") long intervalMs,
                              @Value("${monapp.curation.batch:20}") int batch) {
        this.curationWorker = curationWorker;
        this.intervalMs = intervalMs;
        this.batch = batch;
    }

    @Override public String getName() { return "curation_cron_worker"; }
    @Override public long getCycleIntervalMs() { return intervalMs; }
    @Override public void initialize() { log.info("[worker:{}] lot={} toutes les {} ms", getName(), batch, intervalMs); }
    @Override public void start() { running = true; }
    @Override public void stop() { running = false; }
    @Override public boolean isHealthy() { return running; }

    @Override
    public void doWork() {
        try {
            ActionResult r = curationWorker.executeAction("curate_pending",
                    ActionParameters.fromMap(Map.of("limit", batch)), null);
            executions.incrementAndGet();
            derniereExecution = System.currentTimeMillis();
            if (r.success()) {
                Object n = r.getData("items_processed");
                if (n instanceof Number nb) traites.addAndGet(nb.longValue());
                log.info("[worker:{}] {}", getName(), r.data());
            } else {
                log.warn("[worker:{}] curate_pending en échec : {}", getName(), r.error());
            }
        } catch (Exception ex) {
            log.error("[worker:{}] cycle en erreur", getName(), ex);
        }
    }

    @Override
    public Map<String, Object> getStats() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("running", running);
        m.put("execution_count", executions.get());
        m.put("last_execution_time", derniereExecution);
        m.put("items_processed_total", traites.get());
        m.put("batch", batch);
        return m;
    }
}
```

Choisir le lot pour qu'un cycle tienne dans l'intervalle : **2 appels LLM par article** au minimum
(score + résumé), davantage avec les enrichissements. RssArchiver tournait à 5 articles toutes les
3 minutes avec enrichissements complets.

Appel ponctuel, par MCP :

```bash
editorial curation_worker__curate_pending '{"limit":20}'   # ASYNC : rend un jobId
editorial curation_worker__curate_item '{"raw_item_id":1834}'
```

```json
{"raw_item_id":1834,"routing":"auto_published","score":82,
 "summary":"…","tags":["IA","régulation","Europe"]}
```

---

## 6. Étape 4 — Remplacer les prompts de score et de résumé

Le prompt `classify_generic` de pack-ai rend `factors` sous forme de **liste** ; le worker attend un
**objet**, donc `tr_article.score_factors` reste `{}`. Un prompt dédié corrige cela. Dans pack-ai,
**la ligne active la plus ancienne gagne** pour un même `prompt_id` : on crée un nouvel identifiant
plutôt qu'une nouvelle version.

```sql
INSERT INTO schema_monapp.z_config_ia
    (prompt_id, version, content, active, provider, model, temperature, max_tokens, description, x_createdBy, datas)
VALUES
    ('editorial_scoring', '1.0.0',
$$Tu évalues la pertinence d'un {item_type} pour une veille sur l'IA et le numérique en Europe.
Retourne UNIQUEMENT ce JSON :
{"score": <entier 0-100>,
 "tags": ["2 à 5 tags courts"],
 "factors": {"pertinence": <0-100>, "fraicheur": <0-100>, "fiabilite_source": <0-100>},
 "explanation": "<une phrase>"}

Contexte : {context}

Contenu :
{content}$$,
     true, null, null, 0.1, 512, 'Score éditorial (factors en objet)', 'monapp', '{}'::jsonb)
ON CONFLICT (x_partition, prompt_id, version) DO NOTHING;

UPDATE schema_monapp.z_curation_config
SET scoring_prompt_id = 'editorial_scoring'
WHERE x_partition IS NULL AND content_type = 'rss';
```

Variables passées par le worker : score → `{item_type}`, `{content}`, `{context}` ; résumé →
`{content}`, `{max_sentences}`, `{language}`. Le rechargement du cache de prompts côté pack-ai est
décrit dans [[howto-ai-01-integrer-le-pack|AI-01]] ; le cache de curation, lui, demande un redémarrage.

---

## 7. Vérifier

```bash
editorial curation_worker__get_stats '{}'
```

```json
{"worker":"curation_worker","total_curated":120,"total_auto_published":41,"total_auto_rejected":63,
 "total_sent_to_hitl":16,"rag_ingest_available":true,"pending_items":1504,"hitl_pending":16}
```

```sql
-- Répartition des décisions sur 24 h
SELECT status, count(*) FROM schema_monapp.tr_raw_item
WHERE x_dateUpdated > now() - interval '24 hours'
GROUP BY status;

-- Derniers articles publiés et leur score
SELECT x_id, score, validated_by, left(title, 80) AS titre, tags
FROM schema_monapp.tr_article ORDER BY x_id DESC LIMIT 10;
```

Journal : `[curation] item=1834 score=82 → auto_published`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `curate_item` sur un article clairement hors sujet | `routing = rejected`, brut en `rejected` |
| 2 | Article contenant un mot de `keywords_include` | score +5 par mot présent |
| 3 | `hitl_enabled=true`, score 50 | ligne dans `tr_hitl_queue`, brut en `curated` |
| 4 | `auto_publish=false`, `hitl_enabled=true` | tout part en HITL, même à 95 |
| 5 | `curation-worker.enabled=false` | worker absent, `CurationConfigService` injectable |
| 6 | Fournisseur LLM coupé | articles laissés en `pending`, `[curation] item … failed` au journal |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **`update_curation_config` après `V999z`** | échec PostgreSQL « no unique or exclusion constraint matching the ON CONFLICT specification » : l'`upsert` vise `ON CONFLICT (x_partition)` alors que `V999z` a remplacé l'index par `(x_partition, content_type)` | modifier en SQL la ligne `content_type='rss'` (§4) puis redémarrer |
| Modifier la ligne `default` | aucun effet : `rss` existe et passe avant `default` | cibler `content_type = 'rss'` |
| SQL sans redémarrage | ancienne configuration toujours appliquée (cache chargé au `@PostConstruct`) | redémarrer l'app |
| Personne n'appelle `curate_pending` | `pending_items` croît, `tr_article` vide | worker applicatif §5 |
| Réponse LLM non-JSON | score 0 ⇒ article **rejeté** sans erreur visible | prompt JSON strict, `temperature` basse, contrôler la part de `rejected` |
| `classify_generic` par défaut | `score_factors = {}` partout (liste rendue, objet attendu) | prompt dédié §6 |
| `languages` de la configuration | aucun filtrage : la valeur n'est lue par aucun code de curation | filtrer en amont ou dans le prompt |
| Article en échec permanent | reste `pending`, retenté à chaque lot ; s'ils sont plus nombreux que `limit` en tête de file (tri par date de création), le lot ne progresse plus | surveiller les plus anciens `pending` ; les passer en `rejected` à la main |
| `curate_item` (SYNC) via MCP sur un article long | `Action timeout after 30000ms` (timeout par défaut du socle) | `curate_pending` (ASYNC) ou appel direct en Java |
| `ClassificationWorker` présenté comme le moteur de score (README, CLAUDE.md) | il est injecté mais pas appelé ; le score passe par `GenerationWorker` | régler le prompt `scoring_prompt_id` |
| Deux curations en parallèle | `curation_worker` actif à côté d'un autre moteur : routage concurrent sur les mêmes `pending` | `SOCLE_EDITORIAL_CURATION_WORKER_ENABLED=false` |
| `get_stats` à 0 après redémarrage | compteurs `total_*` en mémoire | lire `tr_raw_item` / `tr_article` |

---

## 10. Pour aller plus loin

- [[howto-editorial-04-enrichir-les-articles-publies|EDITORIAL-04 — Enrichir les articles publiés]] — corps complet, 5W1H, traduction, KEW, RAG
- [[howto-editorial-05-valider-en-hitl|EDITORIAL-05 — Valider en HITL]] — la zone grise
- [[howto-editorial-06-envoyer-des-newsletters|EDITORIAL-06 — Envoyer des newsletters]] — la sortie
- [[howto-ai-01-integrer-le-pack|pack-ai — fournisseurs LLM et prompts]]
- [[howto-27-configurer-agentia-gateway|HOWTO 27]] — passerelle LLM du Hub (fournisseur `agentia` de pack-ai)
