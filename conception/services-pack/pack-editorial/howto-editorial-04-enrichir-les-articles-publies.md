# HOWTO EDITORIAL-04 — Enrichir les articles publiés (corps complet, bibliographie, 5W1H, traduction, KEW, RAG)

**Niveau :** Confirmé
**Cible :** application V005 embarquant le pack — 2.2.0 sur Spring Boot 4.1.2 / socle 5.10-5.11 (2.1.0 idem ; 2.0.0 sur Boot 4.0.6, 1.0.0-SNAPSHOT sur Boot 3.2.1 : contenu identique)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-editorial:2.2.0`, `main` @ `1dbb5c4`, tag `v2.2.0`, construit contre socle 5.11.0 (minimum 5.10.0) (code identique à 2.1.0 — `1fb6c6a`, tag `v2.1.0` — et fonctionnellement identique à 2.0.0 — tag `v2.0.0` — et à `1.0.0-SNAPSHOT`, commit `fffd6f9`) —
`CurationWorker.buildEnrichment` / `tryIngestToRag`, `WebWorkerBodyFetcher`, `BibliographicExtractor`,
`KewClient`, `KewTextCleaner` ; migrations `V007`, `V008`, `V009`, `V999z`
**Prérequis :** [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03]] en place ;
[[howto-ai-01-integrer-le-pack|pack-ai]] avec `WebWorker`, `FiveW1HService`, `TranslationService`,
`RagWorker` selon les enrichissements voulus ; clé APIM pour KEW
**Temps estimé :** 45 min

---

## 1. Contexte

Quand `curation_worker` publie un article (`auto_published`), il peut l'enrichir avant de l'écrire
dans `tr_article`. Chaque enrichissement est **facultatif, dégradé et indépendant** : un échec est
journalisé en `WARN`, l'article est publié quand même.

| Enrichissement | Interrupteur | Service requis | Résultat |
|---|---|---|---|
| Corps complet de la page | `z_curation_config.fetch_full_content` | `WebWorker` (pack-ai, `fetch_smart`) | `tr_raw_item.content` remplacé |
| Métadonnées bibliographiques | **aucun** (toujours actif) | `BibliographicExtractor` (pack) | `tr_article.datas.bibliographic` |
| Résumé 5W1H + entités | `fivew1h_enabled` | `FiveW1HService` (pack-ai) | `datas.5w1h` |
| Traduction du corps | `translate_enabled` + `translate_target_lang` | `TranslationService` (pack-ai) | `datas.translation` |
| Mots-clés, entités Wikidata, taxonomie | `kew_enabled` + `socle.editorial.kew.api-key` | API KEW via APIM | `datas.kew` |
| Ingestion RAG | `auto_ingest_to_rag` + `socle.editorial.rag.ingest-enabled` | `RagWorker` (pack-ai) | `ingested_to_rag`, `rag_document_id` |

**État :** fonctionnel ; c'est la chaîne qui tournait en production chez RssArchiver avant sa
migration vers un pipeline DAG (qui réutilise `KewClient` et `BibliographicExtractor`). Testé par
`CurationEnrichmentTest`, `CurationRagIngestTest`, `KewClientTest`, `KewTextCleanerTest`.

**Portée :** ces enrichissements ne s'appliquent **que sur la voie automatique**. Un article accepté
en HITL ([[howto-editorial-05-valider-en-hitl|EDITORIAL-05]]) est publié sans `datas`, sans date de
publication et sans ingestion RAG.

---

## 2. Architecture

```
curateOne(item)
 ├─ [fetch_full_content] AVANT le score, pour tout article (publié ou non)
 │    si always-fetch-body OU len(content) < min-content-chars-for-fetch (500)
 │    WebWorker.executeAction("fetch_smart", {url, main_only:true})
 │    corps tronqué à 200 000 car. ; gardé seulement s'il est plus long ; UPDATE tr_raw_item.content
 ├─ score + résumé + routage (EDITORIAL-03)
 └─ auto_published → buildEnrichment
      1. bibliographic  GET HTML (OkHttp 20 s) → JSON-LD > OpenGraph > Twitter > <meta> + canonical
      2. 5w1h           FiveW1HService.summarize(partition, texte, translate_target_lang|fr)
      3. translation    TranslationService.translate par morceaux (translate_chunk_chars, ≥ 500)
                        seulement si translate_target_lang ≠ langue détectée
      4. kew            texte = traduction, sinon résumé ; KewTextCleaner.clean
                        POST {kew.base-url}/kew-{tier}/v1/extract, X-API-Key, cascade fast→std→eco
    → INSERT tr_article (…, published_at, datas)
    → [RAG] RagWorker.executeAction("ingest_document",
             {source_type:"rss", title, content, source_ref:url, language:french|english|simple})
```

---

## 3. Étape 1 — Activer les enrichissements

Sur la ligne de configuration lue par le worker (`content_type = 'rss'`), puis redémarrage
(cache, cf. [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03 §4]]) :

```sql
UPDATE schema_monapp.z_curation_config
SET fetch_full_content    = true,
    fivew1h_enabled       = true,
    translate_enabled     = true,
    translate_target_lang = 'fr',
    translate_chunk_chars = 4000,
    kew_enabled           = true,
    auto_ingest_to_rag    = true
WHERE x_partition IS NULL
  AND content_type = 'rss';
```

Propriétés de l'application qui complètent ces drapeaux :

```yaml
socle:
  editorial:
    rss:
      # Lire la page pour CHAQUE article et ne garder le résultat que s'il est plus long
      always-fetch-body: ${SOCLE_EDITORIAL_RSS_ALWAYS_FETCH_BODY:true}
      min-content-chars-for-fetch: ${SOCLE_EDITORIAL_RSS_MIN_CONTENT_CHARS_FOR_FETCH:500}
    rag:
      ingest-enabled: ${SOCLE_EDITORIAL_RAG_INGEST_ENABLED:true}
    kew:
      base-url: ${SOCLE_EDITORIAL_KEW_BASE_URL:https://api.thesocle.net}
      tiers: ${SOCLE_EDITORIAL_KEW_TIERS:fast,std,eco}
      api-key: ${SOCLE_EDITORIAL_KEW_API_KEY:}
      timeout-seconds: ${SOCLE_EDITORIAL_KEW_TIMEOUT_SECONDS:30}
      max-concurrent-per-host: ${SOCLE_EDITORIAL_KEW_MAX_CONCURRENT_PER_HOST:32}
      taxonomy-full: 5
      taxonomy-standard: 7
      taxonomy-simple: 13
```

`always-fetch-body: true` est le réglage de RssArchiver : un flux au chapô « généreux » (01net,
~1 300 caractères dont des balises d'image) passe au-dessus du seuil de 500 et n'était jamais lu en
entier. Contrepartie : un appel `fetch_smart` par article.

---

## 4. Étape 2 — Brancher KEW

KEW est une **API externe** publiée sur l'APIM du Hub, pas un worker. Il faut une clé APIM pour
l'application ([[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]]), posée en variable :

```bash
curl -s -X POST "$HUB/api/actions/docker_worker/set_env_var" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" \
  -d '{"app_id":"monapp","key":"SOCLE_EDITORIAL_KEW_API_KEY","value":"apim_prod_…"}'
curl -s -X POST "$HUB/api/actions/docker_worker/update_app" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" \
  -d '{"app_id":"monapp","new_tag":"1.0.0"}'
```

Sans clé, `KewClient.isConfigured()` rend `false` et l'étape est sautée en silence.

Contrôle direct de la cascade, hors application :

```bash
curl -s -X POST https://api.thesocle.net/kew-std/v1/extract \
  -H "X-API-Key: $SOCLE_EDITORIAL_KEW_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"La Commission européenne a présenté à Bruxelles son plan pour les semi-conducteurs.",
       "lang":"fr","title":"Plan européen des semi-conducteurs",
       "taxonomy_sizes":{"full":5,"standard":7,"simple":13}}' | jq '{ok, kewVersion, elapsedS}'
```

Une application qui veut des entités plus justes appelle `KewClient` elle-même avec un contexte
complet : `KewContext` porte onze champs (`rss_tags` ×5, `title` et `llm_hints.entities` ×3,
`description` ×2…), alors que `curation_worker` n'en transmet que trois. C'est ce que fait
RssArchiver dans `eu.lmvi.pipeline.CurationSteps` :

```java
package eu.lmvi.monapp.kew;

import eu.lmvi.socle.pack.editorial.kew.KewClient;
import eu.lmvi.socle.pack.editorial.kew.KewContext;
import eu.lmvi.socle.pack.editorial.kew.KewResult;
import eu.lmvi.socle.pack.editorial.kew.KewTextCleaner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

@Component
public class ArticleKewEnricher {

    private static final Logger log = LoggerFactory.getLogger(ArticleKewEnricher.class);
    private final KewClient kewClient;

    public ArticleKewEnricher(KewClient kewClient) {
        this.kewClient = kewClient;
    }

    public Optional<KewResult> enrich(String texte, String titre, String chapo, String langue,
                                      String url, String rubrique, String publieLeIso,
                                      String auteur, String editeur, List<String> tagsRss,
                                      List<String> entitesLlm, List<String> conceptsLlm) {
        KewContext ctx = new KewContext(titre, chapo, langue, url, rubrique, publieLeIso,
                auteur, editeur, tagsRss, entitesLlm, conceptsLlm);
        KewClient.KewTentative t = kewClient.extractDetaille(KewTextCleaner.clean(texte), ctx);
        if (!t.reussi()) {
            log.warn("[kew] enrichissement abandonné : {}", t.motif());   // ex. « fast 502, std 502, eco 502 »
        }
        return t.resultat();
    }
}
```

`extractDetaille` rend le **motif par palier** ; `extract` ne rend qu'un `Optional` vide.

---

## 5. Étape 3 — Préparer le RAG

L'ingestion passe par `RagWorker.ingest_document` de pack-ai (contrat inchangé de 2.3.3 à 2.9.0 :
`source_type`, `title`, `content`, `source_ref`, `language` → `document_id`), qui exige un fournisseur
d'embeddings configuré ([[howto-ai-01-integrer-le-pack|AI-01]]). Sans `RagWorker`, le journal de
démarrage l'annonce : `[worker:curation_worker] initialized — RAG ingestion available: false`.

Les trois conditions sont cumulatives : `z_curation_config.auto_ingest_to_rag = true`,
`socle.editorial.rag.ingest-enabled = true`, bean `RagWorker` présent. Un échec d'ingestion laisse
`ingested_to_rag = false` : c'est la colonne à surveiller pour une reprise.

---

## 6. Vérifier

```sql
SELECT x_id,
       left(title, 60)                               AS titre,
       datas ? 'bibliographic'                       AS biblio,
       datas ? '5w1h'                                AS w5h1,
       datas -> 'translation' ->> 'target_lang'      AS traduit_en,
       (datas -> 'translation' ->> 'partial')::bool  AS traduction_partielle,
       datas -> 'kew' ->> 'tier'                     AS palier_kew,
       jsonb_array_length(COALESCE(datas -> 'kew' -> 'qids', '[]'))  AS nb_qids,
       ingested_to_rag, rag_document_id
FROM schema_monapp.tr_article
ORDER BY x_id DESC
LIMIT 10;
```

Contenu attendu de `datas` (clés écrites par `buildEnrichment`) :

```json
{"bibliographic": {"author":"…","description":"…","image_url":"…","tags":["…"],"publisher_name":"…",
                   "canonical_url":"…","section":"…","lang_html":"fr","_provenance":{"author":"jsonld"}},
 "5w1h": {"summary":"…","who":"…","what":"…","when":"…","where":"…","why":"…","how":"…",
          "keywords":["…"],"primary_topic":"…","entities":["…"],"concepts":["…"],
          "provider":"agentia","model":"…","elapsed_s":4.2,"completion_tokens":380},
 "translation": {"target_lang":"fr","text":"…","prompt_id":"rss_translate_fr","provider":"…",
                 "model":"…","chunks":3,"partial":false},
 "kew": {"tier":"std","kew_version":"…","elapsed_s":1.8,"keywords":["…"],"qids":["Q458"],"taxonomy":{}}}
```

Journal : `[curation] item 1834 : corps enrichi via web_worker (412 → 6 931 chars)`,
`[kew] palier fast a renvoyé 502 — cascade`, `[curation] article 977 ingéré RAG (document_id=5120)`.

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Flux « chapô seul », `fetch_full_content=true` | `tr_raw_item.content` plus long après curation |
| 2 | Article anglais, `translate_enabled=true`, cible `fr` | `datas.translation.text` en français, `partial=false` |
| 3 | Article français, cible `fr` | pas de bloc `translation` |
| 4 | Palier `fast` en 502 | `datas.kew.tier = std` |
| 5 | Clé KEW vide | pas de bloc `kew`, aucun appel sortant |
| 6 | `RagWorker` présent, embeddings configurés | `ingested_to_rag = true`, `rag_document_id` non nul |
| 7 | Article accepté en HITL | publié **sans** `datas` (limite connue) |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `fetch_full_content` active le fetch **avant** le score | chaque article — y compris ceux qui seront rejetés — coûte un `fetch_smart` | accepter le coût, ou filtrer en amont |
| Extraction bibliographique sans interrupteur | un GET HTTP supplémentaire par article publié, User-Agent `RssArchiver/1.0` | c'est le comportement du code ; pas de drapeau pour la couper |
| Clé KEW sous `SOCLE_EDITORIAL_KEW_API_KEY` sans liaison explicite | KEW jamais appelé | relier `api-key: ${SOCLE_EDITORIAL_KEW_API_KEY:}` dans `application.yml` (§3) |
| `curation_worker` n'envoie à KEW que titre, résumé et langue | entités ambiguës mal résolues (homonymes Wikidata) | appeler `KewClient` avec un `KewContext` complet (§4) |
| Budget KEW ramené à 10 s | ancien défaut `readTimeout` d'OkHttp — **corrigé** : les trois délais suivent `timeout-seconds` | garder `timeout-seconds` ≥ 30 pour le palier `eco` |
| Lot d'articles qui expire avant d'émettre vers KEW | file du `Dispatcher` OkHttp (5 par hôte par défaut) — **corrigé** par `max-concurrent-per-host: 32` | ne pas descendre ce réglage sous le parallélisme réel |
| `rag.default-source-type` | sans effet : l'ingestion écrit toujours `source_type = "rss"` | filtrer côté RAG sur `rss` |
| Traduction d'un article très long | `partial: true` : des morceaux ont échoué | augmenter le timeout LLM de pack-ai ou baisser `translate_chunk_chars` |
| 5W1H toujours en français | la langue du résumé 5W1H suit `translate_target_lang` (défaut `fr`), même traduction désactivée | régler `translate_target_lang` |
| Enrichissements séquentiels dans la curation | un article enrichi = 4 à 7 appels réseau ; un lot de 50 dépasse facilement plusieurs minutes | lots courts (5 à 20) — [[howto-editorial-03-curer-et-router-les-articles\|EDITORIAL-03 §5]] |
| Corps de page géant | tronqué à 200 000 caractères (protection mémoire, OOM constaté sur 12,5 Mo) | normal ; journal `corps surdimensionné` |

---

## 9. Pour aller plus loin

- [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03 — Curer et router]]
- [[howto-editorial-06-envoyer-des-newsletters|EDITORIAL-06 — Envoyer des newsletters]]
- [[howto-ai-01-integrer-le-pack|pack-ai]] — `WebWorker`, 5W1H, traduction, RAG, embeddings
- [[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]] — clé APIM de l'application
- [[howto-45-classer-un-texte-avec-kev|HOWTO 45]] — classer un texte avec KEV (service voisin du Hub)
- [[howto-37-publier-des-messages-nats-depuis-une-app|HOWTO 37]] — diffuser `datas` enrichi (format `multipart` de RssArchiver)
