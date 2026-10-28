# HOWTO AI-03 — Calculer des embeddings (bge-m3 par l'APIM, OpenAI, Ollama)

**Niveau :** Confirmé
**Pack :** `eu.lmvi:socle-pack-ai:2.8.0` — tag `v2.8.0`, code au commit `f8d7dac` (socle-v005 5.10.0 / Spring Boot 4.1.2) — vérifié au code le 2026-10-28 ; aucune action ni comportement ne change depuis 2.7.14 (`a357a95`)
**Composants :** `EmbeddingWorker` (`embedding_worker`), `HttpEmbeddingProvider`, `OpenAiEmbeddingProvider`, `OllamaEmbeddingProvider`, `EmbeddingCacheService` (`tr_embedding_cache`), `MultiAxisEmbeddingService` (`tr_embedding_axis`)
**Prérequis :** [[howto-ai-01-integrer-le-pack|AI-01]] ; clé APIM pour `embed-std`
**Temps estimé :** 20 min

---

## 1. Contexte

Un embedding sert à la recherche sémantique ([[howto-ai-04-construire-un-rag-ingerer-et-interroger|AI-04]]),
au rapprochement d'items ou à la déduplication. Le pack choisit **un** fournisseur actif
(`socle.ai.embedding.provider`), met chaque vecteur en cache par empreinte SHA-256 du texte, et
ajuste la longueur du vecteur à `socle.ai.embedding.dimension` (bourrage par zéros ou troncature).

| `provider` | Classe | Cible | Dimension |
|---|---|---|---|
| `http` | `HttpEmbeddingProvider` | tout service REST : `embed-std` de l'APIM (bge-m3), vLLM, llama-server, Prehook | `socle.ai.embedding.dimension` |
| `openai` (défaut) | `OpenAiEmbeddingProvider` | `{openai-base-url}/embeddings` | table interne par modèle, sinon la dimension configurée |
| `ollama` | `OllamaEmbeddingProvider` | `{ollama-base-url}` | `nomic-embed-text` 768, `mxbai-embed-large` 1024, `all-minilm` 384 |

Exemples réels : `APP-31-LeSachant` (`http` + `embed-std`, 1024) ; `APP-18-SDR2` vectorise articles
et contacts par le même fournisseur (lignée 2.4.x).

---

## 2. Architecture

```
App ──embedOne(text, null)──────────────┐        MCP ──embedding_worker__embed_text / embed_batch
                                        ▼
                       EmbeddingWorker (provider actif résolu à initialize())
                                        │
            EmbeddingCacheService.lookup(sha256(text), provider, model)  ── tr_embedding_cache
                    hit → vecteur, tokens_used = 0
                    miss ↓
            ResilienceFactory.execute(provider)  (retry 3×, disjoncteur)
                                        ▼
            HttpEmbeddingProvider ── POST {http.url}  Authorization: Bearer <http.api-key>
               format openai : {"model": "...", "input": ["a","b"]}  → {"data":[{"embedding":[…]}]}
               format simple : {"texts": ["a","b"]}                  → {"embeddings":[[…],[…]]}
               format auto   : essaie simple puis openai, mémorise le premier qui répond
                                        │
            cache.store(...) + tr_consommation_tokens_ia (actions MCP seulement)
```

---

## 3. Étape 1 — Configurer le fournisseur

```yaml
socle:
  ai:
    embedding:
      provider: ${SOCLE_AI_EMBEDDING_PROVIDER:http}
      model: ${SOCLE_AI_EMBEDDING_MODEL:bge-m3}
      dimension: ${SOCLE_AI_EMBEDDING_DIMENSION:1024}     # figée dans vector(N) à la 1re migration
      # Découpage en lots — appliqué par l'ingestion RAG (DocumentIngestionService) :
      lot-max-textes: ${SOCLE_AI_EMBEDDING_LOT_MAX_TEXTES:8}
      lot-max-caracteres: ${SOCLE_AI_EMBEDDING_LOT_MAX_CARACTERES:32000}
      http:
        url: ${SOCLE_AI_EMBEDDING_HTTP_URL:https://api.thesocle.net/embed-std/v1/embeddings}
        api-key: ${SOCLE_AI_EMBEDDING_HTTP_API_KEY:}
        format: ${SOCLE_AI_EMBEDDING_HTTP_FORMAT:openai}   # auto | simple | openai
    providers:
      # Sert AUSSI de délai de lecture aux embeddings : un lot de morceaux de code peut
      # dépasser la minute sur embed-std (CPU).
      timeout-seconds: ${SOCLE_AI_PROVIDERS_TIMEOUT_SECONDS:180}
      connect-timeout-seconds: 10
```

Pour OpenAI : `provider: openai`, `model: text-embedding-3-small`, `dimension: 1536`,
`socle.ai.providers.openai-api-key`. Pour Ollama : `provider: ollama`,
`socle.ai.providers.ollama-base-url: http://ollama:11434`.

---

## 4. Étape 2 — Vectoriser depuis le code

```java
package eu.lmvi.monapp.vecteurs;

import eu.lmvi.socle.pack.ai.EmbeddingWorker;
import eu.lmvi.socle.pack.ai.embedding.EmbeddingResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.pgvector.PGvector;

@Service
public class VectorisationContact {

    private static final Logger log = LoggerFactory.getLogger(VectorisationContact.class);

    private final EmbeddingWorker embeddings;
    private final JdbcTemplate jdbc;

    public VectorisationContact(EmbeddingWorker embeddings, JdbcTemplate jdbc) {
        this.embeddings = embeddings;
        this.jdbc = jdbc;
    }

    /** Vectorise la fiche d'un contact et range le vecteur dans une table de l'app. */
    public void vectoriser(long idContact, String fiche) {
        // providerName null = fournisseur actif ; le cache tr_embedding_cache est consulté d'abord.
        EmbeddingResult r = embeddings.embedOne(fiche, null);
        jdbc.update("UPDATE schema_monapp.tr_contact SET embedding = ? WHERE x_id = ?",
                new PGvector(r.embedding()), idContact);
        log.info("[vectorisation] contact={} provider={} model={} dim={} tokens={}",
                idContact, r.provider(), r.model(), r.embedding().length, r.tokensUsed());
    }
}
```

La colonne de l'app se déclare à la même dimension que le pack :
`ALTER TABLE schema_monapp.tr_contact ADD COLUMN embedding vector(1024);` — `PGvector` vient de
`com.pgvector:pgvector`, déjà tiré par le pack.

---

## 5. Étape 3 — Vectoriser par MCP

```bash
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"embedding_worker__embed_batch",
       "arguments":{"texts":["contrat de travail","rupture conventionnelle"]}}}'
```

Rendu : `embeddings` (liste de vecteurs dans l'ordre des textes), `provider`, `model`,
`batch_size`, `cache_hits`, `cache_misses`. `embed_text` rend `embedding`, `tokens_used`,
`cost_usd`, `cached`. Le paramètre facultatif `provider` force un autre fournisseur pour l'appel.

---

## 6. Étape 4 — Embeddings multi-axes (5W1H)

`MultiAxisEmbeddingService` range un vecteur **par axe** d'un item dans `tr_embedding_axis`
(index HNSW cosinus) — utile pour chercher « qui » séparément de « quoi ».

```java
Map<String, String> axes = Map.of(
        "summary", fiveW1H.summary(),
        "who", fiveW1H.who(),
        "what", fiveW1H.what());
Map<String, Integer> dims = multiAxis.embedAxes(partition, "article", String.valueOf(idArticle), axes, null);

List<MultiAxisEmbeddingService.AxisHit> proches =
        multiAxis.search(partition, "who", "ministère du Travail", 10, null);
// AxisHit(sourceType, sourceId, axis, distance) — distance cosinus, plus petit = plus proche
```

Axes prédéfinis : `FIVE_W1H_AXES` (`who`, `what`, `when`, `where`, `why`, `how`), `summary`,
`designation`. Les valeurs vides sont ignorées.

---

## 7. Vérifier

```bash
docker logs monapp 2>&1 | grep -E 'worker:embedding_worker|http-embedding'
#   [worker:embedding_worker] initialized with provider=http, model=bge-m3, dimension=1024
#   [provider:http-embedding] auto-detected format=openai on …   (si format=auto)
psql "$DATABASE_URL" -c "SELECT provider, model, count(*) FROM schema_monapp.tr_embedding_cache GROUP BY 1,2"
```

Deux appels identiques à `embed_text` : le second rend `cached: true`, `tokens_used: 0`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `list_providers` | le fournisseur configuré porte `active: true`, `available: true` |
| 2 | `embed_text` deux fois sur le même texte | `cached:false` puis `cached:true` |
| 3 | Longueur du vecteur rendu | = `socle.ai.embedding.dimension` une fois rangé (bourrage/troncature au rangement RAG) |
| 4 | `embed-std` coupé | `Embedding failed: …` après 3 tentatives ; `embedding_worker` reste `healthy` |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Dimension par défaut (1536) avec bge-m3 | WARN `dimension mismatch` au démarrage, puis vecteurs bourrés de zéros, ou insertion refusée si la colonne a été créée à une autre taille | `dimension: 1024` **avant** la première migration |
| `embed_batch` MCP sur une grande liste | Tous les textes non cachés partent en **un seul** appel : 413 ou 502/524 sur `embed-std` (lot de 64 au plus côté service) | Découper côté appelant ; seule l'ingestion RAG découpe en lots (`lot-max-textes`) |
| `timeout-seconds` laissé à 60 | Moisson interrompue sur des lots lents (constaté sur SDR2 à 164 fichiers sur 595) | 180 s ; le plafond edge APIM est 120 s pour AgentIA, pas pour `embed-std` |
| Format `auto` | Première requête doublée (simple puis openai) | Fixer `format: openai` pour `embed-std` |
| Pack ≤ 2.7.2 (main) ou ≤ 2.4.7 (lignée 2.4.x) | Chaque lecture du cache échouait (`PGobject cannot be cast to PGvector`, avalé en WARN) : tout texte était re-embeddé | ≥ 2.7.3, ou 2.4.8 sur la lignée 2.4.x |
| Injecter `EmbeddingProvider` (interface) | `NoUniqueBeanDefinitionException` : trois implémentations, aucune `@Primary` | Injecter `EmbeddingWorker`, ou une classe concrète |
| `ObjectProvider<EmbeddingProvider>.getIfAvailable()` | Plantage différé au premier usage | `orderedStream()` + sélection par `getName()` |
| `embedOne` appelé en boucle | Aucune ligne dans `tr_consommation_tokens_ia` (seules les actions MCP l'écrivent) | `HardCapChecker.logUsage` côté app si le coût compte |
| Changer de modèle d'embedding | Les anciens vecteurs restent ; le cache est clé par `(hash, provider, model)` | `rag_worker__reindex_all` (AI-04) |

---

## 10. Pour aller plus loin

- [[howto-ai-04-construire-un-rag-ingerer-et-interroger|AI-04 — RAG]]
- [[howto-ai-06-resumer-traduire-transcrire-documenter|AI-06 — 5W1H]] (axes du multi-axe)
- [[howto-ai-08-construire-un-agent-llm-gateway-et-sessions|AI-08 — tool_search]] (utilise aussi un fournisseur d'embedding)
- [[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39 — Clé APIM]]
