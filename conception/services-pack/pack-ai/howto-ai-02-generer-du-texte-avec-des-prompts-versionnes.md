# HOWTO AI-02 — Générer du texte avec des prompts versionnés

**Niveau :** Confirmé
**Pack :** `eu.lmvi:socle-pack-ai:2.7.14` — branche `main`, code au commit `a357a95` — vérifié au code le 2026-10-28
**Composants :** `GenerationWorker` (`generation_worker`), `PromptResolverService`, `PromptRenderer`, `AgentIaLlmProvider`, `LlmCascadeSource`, `HardCapChecker`, table `z_config_ia`
**Prérequis :** [[howto-ai-01-integrer-le-pack|AI-01]] fait ; clé APIM `api:agentia:*` ([[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]])
**Temps estimé :** 30 min

---

## 1. Contexte

L'app ne porte **aucun client de modèle** (règle PACK FIRST du pack). Elle range son prompt dans
`<schema>.z_config_ia`, avec des `{placeholders}`, et demande au `GenerationWorker` de le rendre
puis de l'envoyer au fournisseur configuré. Le prompt vit en base : on le versionne, on l'A/B-teste
et on revient en arrière sans reconstruire l'image.

Cas de référence : **`APP-26B-IdeaBoxDev`** — `AnalyseService` appelle
`GenerationWorker.generateOne(null, "analyse_idee", …)` avec `response_format=json_object`, et
`PromptAnalyseSeed` pose le prompt au démarrage.

Fournisseurs du `GenerationWorker` (beans `eu.lmvi.socle.pack.ai.llm.LlmProvider`) :

| `socle.ai.llm.provider` | Classe | Modèle lu dans | Clé lue dans |
|---|---|---|---|
| `agentia` | `AgentIaLlmProvider` (edge APIM, OpenAI-compatible) | `socle.ai.providers.agentia-model` | `socle.ai.providers.agentia-api-key` |
| `anthropic` (défaut) | `AnthropicLlmProvider` | `socle.ai.llm.model` | `socle.ai.providers.anthropic-api-key` |
| `openai` | `OpenAiLlmProvider` (base URL modifiable : vLLM, llama-server) | `socle.ai.llm.model` | `socle.ai.providers.openai-api-key` |
| `ollama` | `OllamaLlmProvider` | `socle.ai.llm.model` | — |

---

## 2. Architecture

```
App ──generateOne(partition, "analyse_idee", ctx, options)──► GenerationWorker
                                                                │
   PromptResolverService (cache mémoire, chargé au @PostConstruct)
     z_config_ia WHERE active AND x_active ORDER BY x_id   → PromptDef(content, model, temperature, max_tokens)
                                                                │
   PromptRenderer : {titre} {texte} {context.nested} ; clé absente → ""
                                                                │
   cascade ? (LlmCascadeSource bean, sinon socle.ai.llm.cascade)
     oui → essaie chaque étape, réponse vide ou exception → étape suivante
     non → provider unique : options.provider > PromptDef.provider > socle.ai.llm.provider
                                                                │
   ResilienceFactory.execute(provider) : retry 3× (500 ms→10 s) dans un disjoncteur 5 échecs/30 s
                                                                ▼
   AgentIaLlmProvider ── POST {agentia-base-url}/chat/completions  (X-App-Id, Bearer apim_…)
                                                                ▼
   LlmResponse(text, provider, model, tokensInput, tokensOutput, costUsd, finishReason, latencyMs)
```

Le prompt part **entier en message `user`** : `generateOne` passe `systemPrompt = null`.

---

## 3. Étape 1 — Configurer le fournisseur

```yaml
socle:
  ai:
    llm:
      provider: agentia
      # Cascade statique facultative : "provider:modèle,provider:modèle"
      cascade: ${SOCLE_AI_LLM_CASCADE:}
    providers:
      agentia-base-url: ${SOCLE_AI_PROVIDERS_AGENTIA_BASE_URL:https://api.thesocle.net/agentia/v1}
      agentia-api-key: ${SOCLE_AI_PROVIDERS_AGENTIA_API_KEY:}
      agentia-app-id: ${SOCLE_AI_PROVIDERS_AGENTIA_APP_ID:monapp}
      # La casse choisit la route AgentIA : MiniMax-M3 = compte MiniMax de TheSocle,
      # minimax-m3 = Ollama Cloud.
      agentia-model: ${SOCLE_AI_PROVIDERS_AGENTIA_MODEL:MiniMax-M3}
      # Envoie chat_template_kwargs.enable_thinking=false ET thinking.type=disabled.
      agentia-disable-thinking: ${SOCLE_AI_PROVIDERS_AGENTIA_DISABLE_THINKING:true}
      timeout-seconds: ${SOCLE_AI_PROVIDERS_TIMEOUT_SECONDS:120}   # plafond edge APIM = 120 s
      connect-timeout-seconds: 10
```

---

## 4. Étape 2 — Poser le prompt

Colonnes utiles de `z_config_ia` : `prompt_id`, `version`, `content`, `active`, `provider`,
`model`, `temperature`, `max_tokens`, `ab_test_group`, `x_partition` (NULL = global).
Les index uniques `(x_partition, prompt_id, version)` et `(x_partition, prompt_id) WHERE active`
sont en `NULLS NOT DISTINCT` depuis la V1105.

```java
package eu.lmvi.monapp.analyse;

import eu.lmvi.socle.pack.ai.config.AiProperties;
import eu.lmvi.socle.pack.ai.service.ConfigReloadService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Pose le prompt une fois, puis recharge le cache du résolveur. Rejouable. */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class PromptResumeSeed implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PromptResumeSeed.class);
    public static final String PROMPT_ID = "resume_ticket";
    private static final String VERSION = "1.0.0";
    private static final String CONTENU = """
            Résume le ticket ci-dessous en trois phrases, en français, sans rien inventer.

            Titre : {titre}
            Texte :
            {texte}

            Rends UNIQUEMENT un objet JSON : {"resume": "...", "urgence": 1..5}
            """;

    private final JdbcTemplate jdbc;
    private final String schema;
    private final ConfigReloadService reload;

    public PromptResumeSeed(JdbcTemplate jdbc, AiProperties props, ConfigReloadService reload) {
        this.jdbc = jdbc;
        this.schema = props.getSchema();
        this.reload = reload;
    }

    @Override
    public void run(ApplicationArguments args) {
        Integer present = jdbc.queryForObject(
                "SELECT CASE WHEN to_regclass(?) IS NULL THEN 0 ELSE 1 END", Integer.class,
                schema + ".z_config_ia");
        if (present == null || present == 0) {
            log.error("[prompt-seed] {}.z_config_ia absente : migrations du pack non jouées", schema);
            return;
        }
        int pose = jdbc.update("""
                INSERT INTO %s.z_config_ia
                    (prompt_id, version, content, active, temperature, max_tokens, description, x_createdBy)
                VALUES (?, ?, ?, TRUE, 0.20, 700, ?, 'monapp')
                ON CONFLICT (x_partition, prompt_id, version) DO NOTHING
                """.formatted(schema), PROMPT_ID, VERSION, CONTENU, "Résumé de ticket + urgence");
        // Le cache du résolveur a été chargé AVANT ce runner (@PostConstruct) : on le recharge.
        reload.reloadAll();
        log.info("[prompt-seed] {} v{} {}", PROMPT_ID, VERSION, pose == 1 ? "posé" : "déjà en place");
    }
}
```

**Changer de version** se fait en deux gestes, dans cet ordre, sinon l'ancienne continue de
servir (à égalité, la ligne active la plus ancienne gagne) :

```sql
UPDATE schema_monapp.z_config_ia SET active = false
 WHERE prompt_id = 'resume_ticket' AND version = '1.0.0' AND x_partition IS NULL;
INSERT INTO schema_monapp.z_config_ia (prompt_id, version, content, active, temperature, max_tokens, x_createdBy)
VALUES ('resume_ticket', '1.1.0', '…nouveau texte avec {titre} et {texte}…', true, 0.2, 700, 'monapp');
```

**A/B** : poser `ab_test_group = 20` sur la ligne active ; une ligne `active = false`,
`ab_test_group IS NOT NULL` du même `prompt_id` est alors servie à 20 % des appels.

---

## 5. Étape 3 — Appeler la génération depuis le code

`generateOne` est l'API Java. Elle **ne vérifie pas** les plafonds et **n'écrit pas** dans
`tr_consommation_tokens_ia` : ces deux gestes sont faits par l'action MCP `generate`. Le service
ci-dessous les refait, pour qu'un appel Java soit compté comme un appel MCP.

```java
package eu.lmvi.monapp.analyse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.lmvi.socle.pack.ai.GenerationWorker;
import eu.lmvi.socle.pack.ai.llm.LlmResponse;
import eu.lmvi.socle.pack.ai.service.HardCapChecker;
import eu.lmvi.socle.pack.ai.tenant.TenantResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@Service
public class ResumeService {

    private static final Logger log = LoggerFactory.getLogger(ResumeService.class);

    private final GenerationWorker generation;
    private final HardCapChecker hardCap;
    private final TenantResolver tenants;
    private final ObjectMapper mapper = new ObjectMapper();

    public ResumeService(GenerationWorker generation, HardCapChecker hardCap, TenantResolver tenants) {
        this.generation = generation;
        this.hardCap = hardCap;
        this.tenants = tenants;
    }

    public record Resume(String texte, int urgence) {}

    /** Rend un résumé, ou vide : jamais un résultat partiel. */
    public Optional<Resume> resumer(String titre, String texte, String userId) {
        String partition = tenants.currentTenant();                 // null en mono-tenant
        HardCapChecker.CapCheckResult cap = hardCap.check(partition, userId);
        if (!cap.allowed()) {
            log.warn("[resume] plafond atteint : {}", cap.reason());
            return Optional.empty();
        }

        Map<String, Object> contexte = new LinkedHashMap<>();
        contexte.put("titre", titre);
        contexte.put("texte", texte);

        Map<String, Object> options = new LinkedHashMap<>();
        options.put("max_tokens", 700);                               // surcharge PromptDef.max_tokens
        options.put("response_format", Map.of("type", "json_object")); // passe-plat vers le backend

        try {
            LlmResponse r = generation.generateOne(partition, PromptResumeSeed.PROMPT_ID, contexte, options);
            hardCap.logUsage(partition, userId, "resume_service", r.provider(), r.model(), "resume",
                    r.tokensInput(), r.tokensOutput(), r.costUsd(), (int) r.latencyMs(), "ok");
            if ("length".equals(r.finishReason())) {
                log.warn("[resume] sortie tronquée à max_tokens (modèle à raisonnement ?)");
                return Optional.empty();
            }
            JsonNode json = mapper.readTree(r.text());
            return Optional.of(new Resume(json.path("resume").asText(), json.path("urgence").asInt(0)));
        } catch (Exception e) {
            hardCap.logUsage(partition, userId, "resume_service", "agentia", null, "resume",
                    0, 0, BigDecimal.ZERO, 0, "error");
            log.warn("[resume] échec : {}", e.toString());
            return Optional.empty();
        }
    }
}
```

**Forcer un modèle pour un appel** (comparaison de modèles, relance ciblée) — court-circuite la
cascade :

```java
LlmResponse r = generation.generateOneWithModel(partition, "resume_ticket", contexte, options,
        "agentia", "gpt-oss:120b");
```

**Cascade dynamique** (par tenant, depuis une table de l'app) : déclarer un bean `LlmCascadeSource`.
Dès qu'il rend une liste non vide, `generateOne` l'emploie à la place de `socle.ai.llm.cascade`, et
le modèle de chaque étape remplace celui des options.

```java
package eu.lmvi.monapp.analyse;

import eu.lmvi.socle.pack.ai.llm.LlmCascadeSource;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class CascadeAgentia implements LlmCascadeSource {
    @Override
    public List<Step> cascade(String partition) {
        return List.of(
                new Step("agentia", "MiniMax-M3", null, null),
                new Step("agentia", "gpt-oss:120b", null, null));   // baseUrl / apiKey : défaut du provider
    }
}
```

---

## 6. Étape 4 — Appeler par MCP

```bash
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"generation_worker__generate",
       "arguments":{"prompt_id":"resume_ticket",
                    "context":{"titre":"Imprimante","texte":"Bourrage papier au 3e étage depuis lundi"},
                    "options":{"max_tokens":400,"explain":true}}}}'
```

Champs rendus : `text`, `provider`, `model`, `tokens_input`, `tokens_output`, `cost_usd`,
`prompt_id`, `finish_reason`, `latency_ms`, et `explanation` si `options.explain=true` (second
appel LLM sur le prompt `generate_explanation`).

`generation_worker__preview` rend le prompt rendu **sans** appel LLM : c'est le premier test à
faire après avoir posé un prompt.

---

## 7. Vérifier

```bash
docker logs monapp 2>&1 | grep -E 'prompt-resolver|config-reload|worker:generation_worker'
#   [worker:generation_worker] initialized with provider=agentia, model=MiniMax-M3
#   [config-reload] triggering N listeners
#   [prompt-resolver] loaded 5 active prompts        ← 4 seeds V999 + le vôtre
psql "$DATABASE_URL" -c "SELECT prompt_id, count(*) FROM schema_monapp.z_config_ia
                         WHERE active AND x_active GROUP BY prompt_id HAVING count(*) > 1"   # attendu : 0 ligne
psql "$DATABASE_URL" -c "SELECT provider, model, tokens_input, tokens_output, cost_usd, status
                         FROM schema_monapp.tr_consommation_tokens_ia ORDER BY x_id DESC LIMIT 5"
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `preview` sur le prompt | `rendered` contient titre et texte, `version` = 1.0.0 |
| 2 | `generate` | `text` non vide, `finish_reason` = `stop` |
| 3 | Insérer 1.1.0 active sans désactiver 1.0.0, recharger | WARN `deux prompts actifs … x_id gardé` ; 1.0.0 sert toujours |
| 4 | Plafond `CUTOFF` `GLOBAL_DAY` à 0,01 USD activé | `generate` rend `Hard cap reached: GLOBAL_DAY …` |
| 5 | Clé AgentIA invalide | 3 tentatives journalisées `[retry:agentia] attempt n/3` puis échec |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Seed de prompt posé par un `ApplicationRunner` sans recharger | `Prompt not found: <id>` jusqu'au prochain redémarrage : le cache est chargé au `@PostConstruct` du résolveur | `ConfigReloadService.reloadAll()` après l'INSERT (§4) |
| Premier démarrage sur schéma vide | `[prompt-resolver] reload failed` puis `loaded 0` si le résolveur s'initialise avant `PackMigrationRunner` (rien n'impose cet ordre) | Vérifier la ligne `loaded N` ; sinon `reloadAll()` ou redémarrer |
| Nouvelle version insérée sans désactiver l'ancienne | Rien ne change ; un WARN seulement | `UPDATE … active=false` **puis** `INSERT` |
| `socle.ai.llm.model` réglé pour `agentia` | Ignoré : `AgentIaLlmProvider` lit `socle.ai.providers.agentia-model` | Régler `agentia-model` |
| `socle.ai.llm.disable-thinking` réglé pour `agentia` | Ignoré : ne vaut que pour `openai` | `socle.ai.providers.agentia-disable-thinking` |
| Modèle à raisonnement, `max_tokens` bas | `text` vide ou tronqué, `finish_reason=length`, aucune erreur | Monter `max_tokens` ; couper le raisonnement (MiniMax-M3 + balise) |
| `<think>…</think>` dans la réponse | Retiré par `AgentIaLlmProvider` s'il ouvre la réponse et se ferme ; laissé sinon | Parseur qui coupe sur `</think>` avant de chercher `{` |
| Appel Java `generateOne` | Aucun contrôle de plafond, aucune ligne de consommation | Refaire `check` + `logUsage` (§5) ou passer par l'action MCP |
| `action_on_breach` dans `z_hard_cap_ia` | `EMAIL_ADMIN`, `SUSPEND_IA_*` ne déclenchent rien : seul `level=CUTOFF` bloque | Traiter l'alerte côté app |
| Plafonds par défaut | Les 4 lignes seedées par V999 sont `enabled=false` | Les activer et ajuster les seuils |
| `cost_usd` à 0 | `ModelPricingService` ne trouve pas `(provider, model)` dans `db_model_pricing` | Renseigner la table ; le calcul applique `input/output_per_million` |
| Passage par le `GenerationWorker` vers `agentia` | Le provider applique déjà `ResilienceFactory`, le worker l'applique encore : jusqu'à 9 tentatives HTTP pour un échec persistant | Le savoir pour dimensionner un timeout global |
| Cascade configurée | `options.model` et `options.provider` d'un appel sont ignorés | `generateOneWithModel` |
| Modèle par défaut `glm47` de la passerelle | 502 à 120 s au-delà de ~1 600 jetons de sortie | Nommer le modèle |
| Lot de générations simultanées | Appels expirés avant émission (OkHttp : 5 requêtes simultanées par hôte) | Limiter le parallélisme côté app |
| Prompt modifié en base pendant le service | Pris en compte au prochain `reloadAll()` ou redémarrage : le pack ne l'appelle jamais lui-même | Appeler `ConfigReloadService.reloadAll()` |

---

## 10. Pour aller plus loin

- [[howto-ai-05-classifier-avec-retour-utilisateur|AI-05 — Classification]] (s'appuie sur ce worker)
- [[howto-ai-06-resumer-traduire-transcrire-documenter|AI-06 — 5W1H, traduction, documentation]]
- [[howto-ai-08-construire-un-agent-llm-gateway-et-sessions|AI-08 — Passerelle LLM en flux]]
- [[howto-27-configurer-agentia-gateway|HOWTO 27 — AgentIA côté Hub]]
- [[howto-45-classer-un-texte-avec-kev|HOWTO 45 — KEV]] : classer sans LLM quand les options sont fermées
