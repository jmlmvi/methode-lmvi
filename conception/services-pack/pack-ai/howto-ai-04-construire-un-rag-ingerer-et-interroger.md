# HOWTO AI-04 — Construire un RAG : ingérer un corpus et répondre avec citations

**Niveau :** Avancé
**Pack :** `eu.lmvi:socle-pack-ai:2.9.0` — tag `v2.9.0`, commit `8c771e8`, code identique à 2.8.0 (commit de code `f8d7dac`) (socle-v005 5.11.0, minimum 5.10.0 / Spring Boot 4.1.2) — vérifié au code le 2026-10-28 ; aucune action ni comportement ne change depuis 2.7.14 (`a357a95`)
**Composants :** `RagWorker` (`rag_worker`), `DocumentIngestionService`, `StrategyDetector` + 4 découpeurs, `HybridSearchService`, `RagAnswerService`, `CitationExtractor`, `RagSearchLogger`, `ReindexService` ; tables `tr_rag_document`, `tr_rag_chunk`, `tr_rag_search_log`
**Prérequis :** [[howto-ai-01-integrer-le-pack|AI-01]], [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02]] (rédaction), [[howto-ai-03-calculer-des-embeddings|AI-03]] (vecteurs)
**Temps estimé :** 1 h

---

## 1. Contexte

Le RAG du pack tient tout dans PostgreSQL : chaque document est découpé en morceaux, chaque
morceau est vectorisé (`vector(N)`) et indexé en plein texte (`tsv_content`), la recherche fusionne
les deux classements, et le `GenerationWorker` rédige une réponse qui cite ses sources `[N]`.

Cas de référence : **`APP-31-LeSachant`** (pack 2.7.13) — `MoissonWorker` appelle
`DocumentIngestionService.ingest(...)` pour chaque page de documentation d'un dépôt ; la question
de l'utilisateur part sur `rag_worker__search`. Les réglages de recherche de son `application.yml`
(`type-weights`, `answer-limit`, `voisins`) sont mesurés sur un banc de 30 questions.

---

## 2. Architecture

```
INGESTION                                              RECHERCHE + RÉPONSE
ingest(partition, user, sourceType, sourceRef,         search(partition, query, language, limit, mode, filters)
       title, content, language, strategy, meta)         │
  │ dédoublonnage : même content_hash + partition        ├─ mode "vector" : cosinus pgvector
  │   → "DUPLICATE" (doc vide = réingéré)                ├─ mode "bm25"   : ts_rank sur tsv_content
  │ découpe : SYMBOL_JAVA | STRUCTURAL | SEMANTIC |      └─ mode "hybrid" (défaut) : RRF k=60,
  │           FIXED_SIZE  (AUTO = détection)                  poids vecteur 0,6, poids par source_type
  │ INSERT tr_rag_document                                   │
  │ embeddings par lots (8 textes / 32 000 signes)          ├─ coupe à limit
  │   + cache tr_embedding_cache                             └─ + voisins (chunk_index ± n), marqués
  │ INSERT tr_rag_chunk (content, context_prefix,                 │
  │   embeddable_content, embedding, tsv_content)        RagAnswerService → prompt rag_answer_with_citations
  ▼                                                          {extraits} {query} {language}
PostgreSQL : <schema>.tr_rag_document 1──n tr_rag_chunk      temperature = llm.answer-temperature (0,2)
             (ON DELETE CASCADE)                             max_tokens  = llm.answer-max-tokens (1024)
                                                          → CitationExtractor : [N] valides ? + « Sources »
                                                          → tr_rag_search_log
```

---

## 3. Étape 1 — Configurer la recherche

```yaml
socle:
  ai:
    chunk:
      target-size: ${SOCLE_AI_CHUNK_TARGET_SIZE:500}     # en tokens estimés
      max-size: ${SOCLE_AI_CHUNK_MAX_SIZE:800}
      min-size: ${SOCLE_AI_CHUNK_MIN_SIZE:50}
      overlap: ${SOCLE_AI_CHUNK_OVERLAP:50}
      include-context: ${SOCLE_AI_CHUNK_INCLUDE_CONTEXT:true}   # titre/section préfixés au texte embarqué
      adressage-dans-le-contexte: false   # mesuré et écarté le 2026-10-12 (voir pièges)
    search:
      mode: ${SOCLE_AI_SEARCH_MODE:hybrid}                # hybrid | vector | bm25
      vector-weight: ${SOCLE_AI_SEARCH_VECTOR_WEIGHT:0.6}
      rrf-k: ${SOCLE_AI_SEARCH_RRF_K:60}
      # Poids par source_type du document (hybride seulement). Vide = tous égaux.
      type-weights: "${SOCLE_AI_SEARCH_TYPE_WEIGHTS:parcours:1.8,ensemble:1.6,ecran:1.5,unite:1.0,code:0.6}"
      answer-limit: ${SOCLE_AI_SEARCH_ANSWER_LIMIT:10}     # extraits donnés à la rédaction (défaut 5)
      voisins: ${SOCLE_AI_SEARCH_VOISINS:0}               # morceaux voisins ajoutés de chaque côté
      voisins-max: ${SOCLE_AI_SEARCH_VOISINS_MAX:0}       # plafond total des voisins, 0 = aucun plafond
    llm:
      answer-max-tokens: ${SOCLE_AI_LLM_ANSWER_MAX_TOKENS:3072}
      answer-temperature: ${SOCLE_AI_LLM_ANSWER_TEMPERATURE:0.2}   # 0.0 pour un banc
    citation-required: true
```

Stratégies de découpe (`chunking_strategy`) :

| Valeur | Classe | Détection automatique (`AUTO` ou absent) |
|---|---|---|
| `SYMBOL_JAVA` | `SymbolJavaChunker` | en-tête `package`/`import` **et** déclaration de type |
| `STRUCTURAL` | `StructuralChunker` (commonmark + tables GFM) | titres Markdown `#`/`##`/`###`, ou HTML `<h1-3>`, `<table>`, `<article>` |
| `SEMANTIC` | `SemanticChunker` | au moins 3 paragraphes |
| `FIXED_SIZE` | `FixedSizeChunker` | sinon |

---

## 4. Étape 2 — Ingérer depuis un worker de l'app

L'action MCP `ingest_document` ne prend **pas** de partition : elle la lit dans
`app.current_tenant_id`. L'API Java la prend en argument — c'est la voie d'une app qui range un
corpus sous une partition nommée.

```java
package eu.lmvi.monapp.corpus;

import eu.lmvi.socle.pack.ai.rag.DocumentIngestionService;
import eu.lmvi.socle.worker.Worker;
import eu.lmvi.socle.action.ActionProvider;
import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionMetadata;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.action.model.ExecutionMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** Ingère les pages Markdown d'un dossier sous une partition nommée. Piloté par MCP. */
@Component
public class CorpusWorker implements Worker, ActionProvider {

    private static final Logger log = LoggerFactory.getLogger(CorpusWorker.class);
    public static final String WORKER_NAME = "corpus_worker";
    private static final String PARTITION = "docs-monapp";

    private final DocumentIngestionService ingestion;
    private volatile long derniereIngestion = 0;

    public CorpusWorker(DocumentIngestionService ingestion) {
        this.ingestion = ingestion;
    }

    @Override public String getName() { return WORKER_NAME; }
    @Override public void initialize() { log.info("[worker:{}] initialized", WORKER_NAME); }
    @Override public void start() { }
    @Override public void doWork() { }
    @Override public void stop() { }
    @Override public String getSchedule() { return "PASSIVE"; }
    @Override public boolean isHealthy() { return true; }
    @Override public Map<String, Object> getStats() {
        return Map.of("worker", WORKER_NAME, "state", "running", "last_execution", derniereIngestion);
    }

    @Override
    public List<ActionMetadata> getActions() {
        return List.of(ActionMetadata.builder()
                .name("ingerer_dossier").mode(ExecutionMode.ASYNC).readOnly(false)
                .description("Ingère les .md d'un dossier. Paramètre : dossier (chemin absolu)")
                .build());
    }

    @Override
    public ActionResult executeAction(String name, ActionParameters params, ActionContext ctx) {
        if (!"ingerer_dossier".equals(name)) return ActionResult.ofFailure("Action inconnue : " + name);
        String dossier = params.getString("dossier");
        if (dossier == null || dossier.isBlank()) return ActionResult.ofFailure("'dossier' requis");
        int docs = 0, morceaux = 0, doublons = 0, echecs = 0;
        try (Stream<Path> fichiers = Files.walk(Path.of(dossier))) {
            for (Path f : fichiers.filter(p -> p.toString().endsWith(".md")).toList()) {
                try {
                    DocumentIngestionService.IngestionResult r = ingestion.ingest(
                            PARTITION, "corpus_worker",
                            "markdown",                    // source_type : sert aux type-weights
                            f.toString(),                  // source_ref
                            f.getFileName().toString(),    // title
                            Files.readString(f),
                            "french",                      // french | english | simple
                            "STRUCTURAL",
                            Map.of("chemin", f.toString()));
                    if ("DUPLICATE".equals(r.strategyUsed())) doublons++; else { docs++; morceaux += r.chunkCount(); }
                } catch (RuntimeException | IOException e) {
                    echecs++;
                    log.warn("[worker:{}] {} : {}", WORKER_NAME, f, e.getMessage());
                }
            }
        } catch (IOException e) {
            return ActionResult.ofFailure("Lecture impossible : " + e.getMessage());
        }
        derniereIngestion = System.currentTimeMillis();
        return ActionResult.ofSuccess(Map.of("documents", docs, "morceaux", morceaux,
                "doublons", doublons, "echecs", echecs));
    }
}
```

Réingérer un document **modifié** : son `content_hash` change, donc il entre comme un nouveau
document. Supprimer l'ancien d'abord : `ingestion.deleteDocument(idDocument)` (les morceaux
partent en cascade). LeSachant garde l'`id_document_rag` de chaque fichier dans sa propre table
pour cela.

---

## 5. Étape 3 — Interroger

**Par MCP** — `partition` est indispensable dès que le corpus a été rangé sous une partition
nommée (sinon la recherche ne voit que les morceaux à partition NULL) :

```bash
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rag_worker__search",
       "arguments":{"query":"combien de temps les données sont-elles conservées ?",
                    "partition":"docs-monapp","language":"french","limit":10}}}'
```

Champs rendus par `search` : `answer` (avec la section « Sources » ajoutée si les citations sont
valides), `citations` (numéros `[N]` employés), `citations_valid`, `chunks` (chacun :
`chunk_id`, `document_id`, `document_title`, `content`, `context_prefix`, `score`, `chunk_index`,
et `voisin` / `voisin_de` pour un morceau ajouté par l'élargissement), `provider`, `model`,
`tokens_input`, `tokens_output`, `latency_retrieval_ms`, `latency_generation_ms`, `search_log_id`.

`search_chunks` rend seulement `chunks` et `count`, **sans** appel LLM : c'est l'outil de mesure de
la remontée. `model` (facultatif) impose le modèle de rédaction pour comparer plusieurs modèles sur
les mêmes extraits.

**Depuis le code** :

```java
package eu.lmvi.monapp.corpus;

import eu.lmvi.socle.pack.ai.rag.HybridSearchService;
import eu.lmvi.socle.pack.ai.rag.RagAnswerService;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class QuestionService {

    private final RagAnswerService answers;
    private final HybridSearchService search;

    public QuestionService(RagAnswerService answers, HybridSearchService search) {
        this.answers = answers;
        this.search = search;
    }

    public RagAnswerService.RagAnswer repondre(String question) {
        // limit, mode, filtres, modèle : null/0 = réglages socle.ai.search.* et socle.ai.llm.*
        return answers.answer("docs-monapp", question, "french", 10, null, Map.of(), null);
    }

    /** Mesure de la remontée seule : aucun jeton consommé. */
    public List<HybridSearchService.ChunkHit> extraits(String question) {
        return search.search("docs-monapp", question, "french", 10, "hybrid", Map.of());
    }
}
```

`RagAnswer` : `text`, `chunks`, `citations`, `provider`, `model`, `tokensInput`, `tokensOutput`,
`latencyRetrievalMs`, `latencyGenerationMs`, `citationsValid`. Aucun morceau trouvé → réponse
fixe « Aucune information trouvée dans la base documentaire… », provider `none`, sans appel LLM.

**Adapter la rédaction** : poser une nouvelle version active du prompt
`rag_answer_with_citations` dans `z_config_ia` (placeholders `{extraits}`, `{query}`,
`{language}`), en désactivant `1.0.0` — procédure d'[[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02]].

---

## 6. Étape 4 — Entretenir l'index

| Besoin | Action MCP | API Java |
|---|---|---|
| Voir un document et ses morceaux | `get_document {document_id}` | — |
| Supprimer un document | `delete_document {document_id}` | `DocumentIngestionService.deleteDocument(id)` |
| Revectoriser après changement de modèle | `reindex_all {provider?}` | `ReindexService.reindexAll(partition, provider)` |
| Compter documents et morceaux actifs | `get_stats` | — |
| Lot de documents | `ingest_batch {documents:[{title,content,source_type,…}]}` | boucle sur `ingest` |

`reindex_all` rend `total_chunks`, `reindexed`, `failures`, `provider`, `model` ; il opère sur la
partition de `app.current_tenant_id`.

---

## 7. Vérifier

```sql
-- Aucun document creux (document sans morceau = ingestion interrompue)
SELECT d.x_id, d.title FROM schema_monapp.tr_rag_document d
 WHERE d.x_active AND NOT EXISTS (SELECT 1 FROM schema_monapp.tr_rag_chunk c WHERE c.id_rag_document = d.x_id);

-- Répartition par partition et par stratégie
SELECT x_partition, chunking_strategy, count(*) FROM schema_monapp.tr_rag_document GROUP BY 1,2;

-- Les dernières questions, leur réponse et leur coût
SELECT query_text, provider_llm, model_llm, tokens_used, latency_generation_ms, error
  FROM schema_monapp.tr_rag_search_log ORDER BY x_id DESC LIMIT 5;
```

```bash
docker logs monapp 2>&1 | grep -E '\[rag:(ingest|answer)\]'
#   [rag:ingest] strategy=STRUCTURAL produced 7 chunks for 'retention.md'
#   [rag:answer] LLM response has no valid citation (citations_required=true)   ← à surveiller
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Ingérer deux fois le même texte sous la même partition | 2e appel : `strategy_used = DUPLICATE`, même `document_id` |
| 2 | `search_chunks` 50 fois sur la même question | même classement à chaque fois (remontée déterministe) |
| 3 | `search` sans `partition` sur un corpus partitionné | « Aucune information trouvée » — preuve qu'il faut la passer |
| 4 | `voisins=1` au démarrage, même question | morceaux supplémentaires marqués `voisin: true`, aucun morceau touché perdu |
| 5 | Réponse sans `[N]` | `citations_valid=false`, WARN `[rag:answer]`, réponse rendue quand même |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Corpus ingéré sous une partition, recherche sans `partition` | « Aucune information trouvée » sans erreur (constaté sur LeSachant le 2026-10-03) | Passer `partition` à `search` / `search_chunks` |
| Compter sur `app.current_tenant_id` côté MCP | `TenantResolver` lit la variable sur une connexion du pool, hors de la transaction de l'appelant : rend `null` dans un appel MCP | Partition explicite ; `SET LOCAL` seulement dans une transaction qui appelle l'API Java |
| `filters` passé à `search` | Accepté puis **ignoré** : aucune requête ne le lit | Filtrer côté app sur `chunks[].document_id`, ou ranger par partition |
| `socle.ai.chunk.strategy` réglé | Lu nulle part : seule la détection automatique ou `chunking_strategy` par appel comptent | Passer `chunking_strategy` à l'ingestion |
| `socle.ai.search.bm25-languages` réglé | Lu nulle part : la langue vient du paramètre `language` (`french`, `english`, `simple`) | Passer `language` |
| `citation-required: true` | N'empêche pas une réponse sans citation : un WARN seulement | Contrôler `citations_valid` côté app |
| Ingestion interrompue (lignée 2.4.x et versions antérieures) | Documents sans morceau marqués « DUPLICATE » à jamais (357 sur 587 chez LeSachant) | 2.7.14 : un document sans morceau est supprimé puis réingéré |
| Lot d'embedding trop gros (lignée 2.4.x et versions antérieures) | 502/524 de l'edge sur un document de 40 morceaux de code | 2.7.14 : lots de `lot-max-textes` / `lot-max-caracteres` |
| Ingestion mono-tenant (partition NULL) | La requête de dédoublonnage porte `? IS NULL` sans `CAST` ; si PostgreSQL la refuse, l'erreur est avalée et un doublon entre | Préférer une partition nommée ; vérifier par le test de validation n° 1 |
| Bloc d'adressage (résumé/questions) en tête de page | Il gagne le classement et évince le corps de sa propre page | `voisins: 1` (élargissement à la requête, sans réindexer) ; `adressage-dans-le-contexte` a été mesuré **pire** (28,0 → 27,3 justes sur 30) |
| `type-weights` trop fort | Les pages factuelles disparaissent derrière les pages de parcours (3,0 mesuré trop fort, 1,8 retenu) | Mesurer sur un banc ; `search_chunks` pour comparer |
| Indexer du code brut | 11 justes sur 20, quel que soit le modèle : un extrait occupait 46 % du prompt | Indexer une documentation dérivée du code (`DocumentationGenerator`, AI-06) |
| `answer-max-tokens` à 1024 avec un modèle à raisonnement | Réponse vide, `finish_reason=length`, sans erreur | 3072 à 6144 ; MiniMax-M3 + `agentia-disable-thinking` |
| Comparer deux bancs à `answer-temperature` 0,2 | 13 questions sur 30 changent de nature entre deux passages identiques | Banc à `0.0` |
| `adressage-dans-le-contexte` basculé sur un corpus existant | Change tous les vecteurs : réindexation complète | Le laisser à `false` |

---

## 10. Pour aller plus loin

- [[howto-ai-03-calculer-des-embeddings|AI-03 — Embeddings]]
- [[howto-ai-06-resumer-traduire-transcrire-documenter|AI-06 — DocumentationGenerator]] : produire un corpus lisible
- [[howto-ai-07-lire-le-web-fetch-recherche-navigateur|AI-07 — Web]] : alimenter le corpus depuis des URL
- [[howto-ai-08-construire-un-agent-llm-gateway-et-sessions|AI-08 — Agents]] : `rag_worker__search` comme outil d'agent
- [[howto-16-storage-s3-quotas|HOWTO 16 — Stockage S3]] : ranger les originaux hors base
