# HOWTO AI-06 — Résumer en 5W1H, traduire, transcrire un audio, rédiger une documentation

**Niveau :** Intermédiaire
**Pack :** `eu.lmvi:socle-pack-ai:2.9.0` — tag `v2.9.0`, commit `8c771e8`, code identique à 2.8.0 (commit de code `f8d7dac`) (socle-v005 5.11.0, minimum 5.10.0 / Spring Boot 4.1.2) — vérifié au code le 2026-10-28 ; aucune action ni comportement ne change depuis 2.7.14 (`a357a95`)
**Composants :** `FiveW1HService`, `TranslationService`, `HttpTranscriptionProvider` (`TranscriptionProvider`), `DocumentationGenerator` — services Java, **sans action MCP**
**Prérequis :** [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02]] ; pour la transcription, une clé APIM `api:transcription:*`
**Temps estimé :** 30 min

---

## 1. Contexte

Quatre capacités prêtes, appelées par injection dans le code de l'app. Les trois premières
passent par le `GenerationWorker` et ses prompts versionnés ; la transcription appelle le service
auto-hébergé `APP-M002-Transcription` par l'edge APIM.

| Service | Prompt(s) seedé(s) | Rend | Consommateur réel |
|---|---|---|---|
| `FiveW1HService.summarize(partition, content, language, options)` | `rss_summary_5w1h` (V1102) | `FiveW1H` (summary, who, what, when, where, why, how, keywords…) | `APP-12-RssArchiver` |
| `TranslationService.translate(partition, content, targetLang, options)` | `rss_translate_<lang>` puis `rss_translate` (V1103 : `fr`, `en`, générique) | `TranslationResult` | `APP-12-RssArchiver` |
| `TranscriptionProvider.transcribe(audio, filename[, language, prompt])` | — | `TranscriptionResult` | `APP-17-BilanSocle` (dictée) |
| `DocumentationGenerator.pageUnite / pageEcran / pageSujet / blocAdressage` | `doc_page_unite`, `doc_page_ecran`, `doc_page_sujet`, `doc_page_adressage` (V1107–V1111) | `Page(markdown, modele, tokensEntree, tokensSortie, dureeMs)` | `APP-31-LeSachant` (`RedactionWorker`) |

---

## 2. Architecture

```
FiveW1HService ──generateOne(rss_summary_5w1h, {content, language})──► GenerationWorker
     └─ JSON illisible → un seul re-prompt à température 0 → sinon IllegalStateException

TranslationService ──generateOne(rss_translate_<lang>)──► « Prompt not found » ? ──► rss_translate {target_language}

DocumentationGenerator ──generateOne / generateOneWithModel(doc_page_*)──► corps de page
     └─ en-tête de provenance (chemins + SHA git des sources) écrit en Java, jamais par le modèle

HttpTranscriptionProvider ── POST {base-url}/audio/transcriptions (multipart, format OpenAI audio)
     https://api.thesocle.net/transcription/v1  ── edge APIM ── APP-M002 (faster-whisper)
     en-têtes : Authorization: Bearer apim_…, X-App-Id: <app-id>
```

---

## 3. Étape 1 — Configurer la transcription

```yaml
socle:
  ai:
    transcription:
      base-url: ${SOCLE_AI_TRANSCRIPTION_BASE_URL:https://api.thesocle.net/transcription/v1}  # sans /audio/transcriptions
      api-key: ${SOCLE_AI_TRANSCRIPTION_API_KEY:}       # apim_<env>_<40hex>, scope api:transcription:*
      app-id: ${SOCLE_AI_TRANSCRIPTION_APP_ID:monapp}   # X-App-Id : quota et audit côté service
      model: whisper-1
      language: fr                                      # vide = détection automatique
      # L'amorce : le levier le moins cher sur la qualité. Guillemets obligatoires (« : »).
      prompt: "Vocabulaire : RIASEC, bilan de compétences, VAE, CPF, OPCO."
      timeout-seconds: 900                              # ~0,7 × durée de l'audio ; plafond edge 900 s
```

Les trois autres services n'ont besoin que du `GenerationWorker` configuré (AI-02).

---

## 4. Étape 2 — Le code

```java
package eu.lmvi.monapp.contenu;

import eu.lmvi.socle.pack.ai.summary.FiveW1H;
import eu.lmvi.socle.pack.ai.summary.FiveW1HService;
import eu.lmvi.socle.pack.ai.transcription.HttpTranscriptionProvider;
import eu.lmvi.socle.pack.ai.transcription.TranscriptionResult;
import eu.lmvi.socle.pack.ai.translate.TranslationResult;
import eu.lmvi.socle.pack.ai.translate.TranslationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;

@Service
public class EnrichissementService {

    private static final Logger log = LoggerFactory.getLogger(EnrichissementService.class);

    private final FiveW1HService fiveW1H;
    private final TranslationService traduction;
    // Classe concrète : TranscriptionProvider n'a qu'une implémentation aujourd'hui,
    // mais l'interface est faite pour en accueillir d'autres.
    private final HttpTranscriptionProvider transcription;

    public EnrichissementService(FiveW1HService fiveW1H, TranslationService traduction,
                                 HttpTranscriptionProvider transcription) {
        this.fiveW1H = fiveW1H;
        this.traduction = traduction;
        this.transcription = transcription;
    }

    public Optional<FiveW1H> resumer(String article) {
        try {
            FiveW1H r = fiveW1H.summarize(null, article, "fr", Map.of("max_tokens", 1200));
            log.info("[5w1h] {} mots-clés, {} ms, modèle {}", r.keywords().size(), r.latencyMs(), r.model());
            return Optional.of(r);
        } catch (IllegalStateException e) {        // deux réponses inexploitables
            log.warn("[5w1h] échec : {}", e.getMessage());
            return Optional.empty();
        }
    }

    public String traduire(String texte, String langueCible) {
        TranslationResult r = traduction.translate(null, texte, langueCible, Map.of());
        log.info("[traduction] prompt={} modèle={}", r.promptId(), r.model());
        return r.text();
    }

    public Optional<String> transcrire(byte[] audio, String nomFichier) {
        if (!transcription.isAvailable()) {        // base-url + clé présentes, sans appel réseau
            return Optional.empty();
        }
        TranscriptionResult r = transcription.transcribe(audio, nomFichier);
        log.info("[dictée] {} s d'audio, ×{} temps réel, langue {}",
                r.audioSeconds(), String.format("%.1f", r.realtimeFactor()), r.language());
        return Optional.of(r.text());
    }
}
```

**Documentation dérivée du code** (patron `RedactionWorker` de LeSachant) :

```java
DocumentationGenerator.Page page = documentation.pageUnite(
        "docs-monapp",                                  // partition (prompts et quotas)
        "FactureService",                               // titre de la page
        "classe",                                       // classe | table | worker | migration | route
        List.of(new DocumentationGenerator.Source("src/main/java/…/FactureService.java", shaBlobGit)),
        contenuSource,                                  // texte des sources, concaténé
        null);                                          // modèle imposé, null = configuration
Files.writeString(Path.of(depot, "docs/User&Rag-Documentation/unites/FactureService.md"), page.markdown());
```

Sans au moins une `Source`, la page est refusée (`exigerProvenance`) : c'est le SHA écrit en Java
qui permet de savoir qu'une page est périmée.

---

## 5. Vérifier

```bash
docker logs monapp 2>&1 | grep -E '\[5w1h\]|\[translate\]|\[dictée\]|transcription'
psql "$DATABASE_URL" -c "SELECT prompt_id, version FROM schema_monapp.z_config_ia
                         WHERE active AND (prompt_id LIKE 'rss_%' OR prompt_id LIKE 'doc_page_%') ORDER BY 1"
```

---

## 6. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `summarize` sur un article de presse | `summary` non vide ; `who`/`what` renseignés |
| 2 | `translate(…, "de")` sans prompt `rss_translate_de` | `promptId = rss_translate` (repli générique) |
| 3 | `translate(…, "en")` | `promptId = rss_translate_en` |
| 4 | `transcribe` d'une dictée de 20 s | `audioSeconds ≈ 20`, `realtimeFactor > 1` |
| 5 | Clé de transcription absente | `IllegalStateException` « aucune transcription simulée » — jamais de texte inventé |

---

## 7. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Seeds de prompts doublés à une montée de pack ≤ 2.4.5 (partition NULL hors index unique) | 5W1H privé d'entités pendant des jours, aucune erreur | ≥ 2.4.6 (V1105) ; contrôle `GROUP BY prompt_id HAVING count(*) > 1` |
| Enrichir `rss_summary_5w1h` dans l'app sans désactiver le seed | La version la plus ancienne continue de servir | `UPDATE … active=false` puis `INSERT` (AI-02) |
| Exclure `GenerationWorker` du scan | `FiveW1HService`, `TranslationService`, `DocumentationGenerator` ne se construisent plus | Les exclure aussi (`summary.*`, `translate.*`, `doc.*`) |
| Transcription sans retry | Une 520 passagère de l'edge devient un échec : le provider n'applique pas `ResilienceFactory` et aucun worker ne l'enveloppe | `ResilienceFactory.execute("transcription", () -> transcription.transcribe(…))` côté app |
| `base-url` pointée sur le conteneur APP-M002 | Ni quota, ni audit tenant, ni facturation au volume d'audio | Toujours l'edge APIM |
| Amorce YAML non quotée | Redémarrage en boucle sans journal | Guillemets |
| `timeout-seconds` réduit au défaut LLM | Coupure des audios longs | 900 s (budget calculé sur l'audio le plus long) |
| `DocumentationGenerator` employé pour un écran avec `pageUnite` | Réponses justes mais techniques (« stocké dans `tr_mail_propose` ») | `pageEcran` : son prompt interdit le vocabulaire technique |
| Résumé de page qui aplatit « voulu » et « constaté » | L'assistant cite une règle du cahier des charges que le code n'applique pas | Prompt `doc_page_adressage` ≥ 1.1 (V1111) ; contrôle lexical côté app |

---

## 8. Pour aller plus loin

- [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02 — Prompts versionnés]]
- [[howto-ai-03-calculer-des-embeddings|AI-03 — Embeddings multi-axes]] (un vecteur par axe 5W1H)
- [[howto-ai-04-construire-un-rag-ingerer-et-interroger|AI-04 — RAG]] (indexer les pages rédigées)
- [[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39 — Clé APIM]] (`api:transcription:*`)
