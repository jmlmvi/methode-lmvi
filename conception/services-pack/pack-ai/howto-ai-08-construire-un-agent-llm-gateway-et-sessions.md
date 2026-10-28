# HOWTO AI-08 — Construire un agent : passerelle LLM, boucle d'outils, sessions

**Niveau :** Expert
**Pack :** `eu.lmvi:socle-pack-ai:2.8.0` — tag `v2.8.0`, code au commit `f8d7dac` (socle-v005 5.10.0 / Spring Boot 4.1.2) — vérifié au code le 2026-10-28 ; aucune action ni comportement ne change depuis 2.7.14 (`a357a95`)
**Composants :** `LlmGatewayWorker` (`llm_gateway_worker`), `LlmProviderRegistry`, `LlmModelRegistry`, `LlmRouter`, 4 `LlmStreamProvider`, `AgentRuntime`, `AbstractAgentWorker`, `AgentToolBridge`, `AgentSessionStore`, `OrphanSessionResolver` (bean `aiOrphanSessionResolver` depuis 2.8.0), `AgentToolsetWorker` (`agent_toolset`), `WorkspaceManagerWorker`, `WorkspaceGcWorker`, `AgentGrpcService` ; tables `db_model_pricing`, `tr_llm_call_audit`, `tr_circuit_breaker_state`, `tr_rate_limit_state`, `tr_agent_session`, `tr_agent_message`, `tr_tool_call_audit`, `tr_tool_index`, `tr_workspace_session_meta`
**Statut :** plateforme **partielle** (jalon V003.0 de la spec `docs/AgentIA/SPEC-AGENT-IA-V003-PHASED.md`) — voir §2
**Prérequis :** [[howto-ai-01-integrer-le-pack|AI-01]] sans exclure `eu.lmvi.socle.pack.ai.agent.*`
**Temps estimé :** 2 h

---

## 1. Contexte

Un agent reçoit un objectif, appelle un modèle, exécute les outils que le modèle demande, réinjecte
les résultats, et recommence jusqu'à la fin du tour. Dans le pack :

- les **outils** sont des **actions MCP de l'app elle-même** (`worker__action`), enveloppées par
  `AgentToolBridge` ;
- le **modèle** passe par la passerelle `LlmGatewayWorker`, en flux (`Flow.Publisher<LlmStreamEvent>`) ;
- chaque **session** et chaque message sont persistés (`tr_agent_session`, `tr_agent_message`),
  avec fork et reprise.

Exemple réel : **`APP-08-AgentIA`** — `DemoAgentWorker extends AbstractAgentWorker` et
`LiveRunController` (pack 2.3.5, Boot 3.2.1 ; l'API d'`AbstractAgentWorker` est inchangée en 2.7.14).

---

## 2. Ce qui est branché, ce qui ne l'est pas (2.7.14)

| Élément | État |
|---|---|
| 13 fournisseurs (`anthropic`, `openai`, `mistral`, `ollama`, `openrouter`, `minimax`, `groq`, `cerebras`, `nvidia_nim`, `vllm_local`, `llamacpp_local`, `google`, `socle_gateway`) | déclarés ; activés par `SOCLE_AI_LLM_PROVIDERS` |
| Décodeurs de flux | **4** : Anthropic Messages, OpenAI Chat Completions, Mistral, Google GenerativeAI. L'API OpenAI **Responses** n'en a pas (`no_stream_provider`) |
| Modèles | **aucun livré** : `db_model_pricing` n'a pas de seed, le registre est vide tant que l'app ne l'a pas remplie |
| `stream_complete`, `complete_blocking`, `list_*`, `model_info`, `model_pricing` | branchés |
| `test_provider` | **stub** : rend `not_implemented` (tâche T-S1-006) |
| `AgentRuntime` (boucle externe/interne, outils en parallèle, interruptions douces, hooks) | branché |
| `AgentToolBridge` | branché ; corrigé en 2.7.14 (registre résolu à l'usage) |
| Sessions : 10 états (`SPAWNED`, `READY`, `RUNNING`, `BLOCKED`, `COMPLETED`, `FAILED`, `STOPPED`, `CRASHED`, `ABORTED_BY_USER`, `ABORTED_BY_BUDGET`), fork, reprise des orphelines | branché |
| `SkillLoader` | **`NoopSkillLoader` par défaut** : aucune compétence chargée tant que l'app ne fournit pas son bean `SkillLoader` |
| `z_agent_toolset`, `z_agent_tool_policy` | tables créées, **lues par aucun code** : le jeu d'outils vient de `getDefaultToolset()` |
| `tool_search` (`tr_tool_index`) | branché ; indexation au démarrage |
| gRPC-Web `AgentService` (7 RPC), `SkillService` (3 RPC) | branchés |
| gRPC `MemoryService` | **`UNIMPLEMENTED`** (mémoire prévue au jalon V003.1) |
| Workspace | **méta-données seules** (`tr_workspace_session_meta`) ; aucun fichier physique géré |
| Jalons V003.1 / V003.2 (mémoire, sûreté, cron, voix, ACP…) | **non livrés** : specs dans `docs/AgentIA/sous-specs/` |

---

## 3. Architecture

```
App ── startSession(objectif, ctx) ──► AbstractAgentWorker (votre sous-classe @Component)
        (transaction + SET LOCAL app.current_tenant_id)       │ modèle : ctx.llm_model ou getDefaultModelId()
                                                             │   → LlmModelRegistry (db_model_pricing)
                                                             ▼
                                  AgentSessionStore.createSession → tr_agent_session (RUNNING)
App ── runExistingSession(uuid, …, consumer) ─────────────────┐
                                                             ▼
   SkillLoader (Noop) → SystemPromptBuilder → AgentToolBridge.buildTools(getDefaultToolset())
                                                             ▼
   AgentRuntime.run ── tour ── LlmGatewayWorker.streamComplete(LlmRequest)
                          │        └ LlmRouter → LlmStreamProvider(api du modèle) → HTTP SSE
                          │            clé : socle.ai.<provider>.api-key ; URL : socle.ai.<provider>.base-url
                          ├── tool_use → ActionExecutor.executeSync(worker, action) → tr_tool_call_audit
                          └── AgentEvent → votre AgentEventConsumer (SSE, KvBus, gRPC…)
   fin : statut terminal + aggregateCostFromAudit (tr_llm_call_audit)
```

---

## 4. Étape 1 — Activer les fournisseurs et déclarer les modèles

La passerelle a **son propre espace de clés**, distinct de `socle.ai.providers.*` (AI-02) :
`socle.ai.<provider>.api-key`, `.base-url`, `.app-id`.

```yaml
socle:
  ai:
    llm:
      providers: ${SOCLE_AI_LLM_PROVIDERS:socle_gateway}     # CSV ; défaut = les 13
      http:
        timeout-ms: 120000
      circuit-breaker:
        failure-threshold: 5
        open-timeout-sec: 60
      audit:
        truncate-bytes: 8192
    socle_gateway:
      # AgentIA par l'edge APIM ; le pack ajoute /v1/chat/completions.
      # Le défaut codé (admin.thesocle.net/api/agentia) contourne l'APIM : le remplacer.
      base-url: ${SOCLE_AI_SOCLE_GATEWAY_BASE_URL:https://api.thesocle.net/agentia}
      api-key: ${SOCLE_AI_SOCLE_GATEWAY_API_KEY:}
      app-id: ${SOCLE_AI_SOCLE_GATEWAY_APP_ID:monapp}
    agent:
      max-concurrent-sessions: 20
      turn-max-duration-sec: 600
      inner-loop-max-iterations: 100
      tool-default-timeout-sec: 120
      system-prompt-soft-cap-chars: 32000
      system-prompt-hard-cap-chars: 64000
      tool-bridge-audit: true
      session:
        resume-on-startup: true
        orphan-threshold-min: 5
      workspace:
        ttl-days: 7
        quota-mb: 500
        quota-files: 1000
        gc-cron: "0 30 3 * * *"
        gc-enabled: true
    tool-index:
      enabled: true
  grpcweb:
    enabled: true          # expose AgentService / SkillService en gRPC-Web (socle ≥ 5.7.1)
```

Le modèle par défaut d'un agent se règle par **variable d'environnement** (lue par
`System.getenv`, pas par Spring) : `SOCLE_AI_AGENT_DEFAULT_MODEL` (défaut `claude-sonnet-4-6`).

Déclarer chaque modèle dans `db_model_pricing` — un modèle absent n'existe pas pour la passerelle :

```sql
-- Tarifs : reporter ceux d'AgentIA (agentia_worker__list_pricing côté Hub) ; 0 = coût non calculé.
INSERT INTO schema_monapp.db_model_pricing
    (provider, model_id, input_per_million, output_per_million, currency, valid_from,
     context_window, max_tokens, reasoning, x_createdBy)
VALUES
    ('socle_gateway', 'MiniMax-M3',   0, 0, 'EUR', CURRENT_DATE, 131072, 32768, true,  'monapp'),
    ('socle_gateway', 'gpt-oss:120b', 0, 0, 'EUR', CURRENT_DATE, 131072, 16384, false, 'monapp')
ON CONFLICT (provider, model_id, valid_from) DO NOTHING;
```

`max_tokens` : laisser NULL donne un budget trop court aux modèles à raisonnement (réponses vides
constatées sur APP-08 jusqu'à ce que la table porte 32 768).

Le registre est chargé à `initialize()` du `llm_gateway_worker` : redémarrer après l'INSERT.

---

## 5. Étape 2 — Écrire l'agent

```java
package eu.lmvi.monapp.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.lmvi.socle.pack.ai.agent.llm.LlmGatewayWorker;
import eu.lmvi.socle.pack.ai.agent.llm.registry.LlmModelRegistry;
import eu.lmvi.socle.pack.ai.agent.runtime.AgentRuntime;
import eu.lmvi.socle.pack.ai.agent.session.AgentSessionStore;
import eu.lmvi.socle.pack.ai.agent.worker.AbstractAgentWorker;
import eu.lmvi.socle.pack.ai.agent.worker.bridge.AgentToolBridge;
import eu.lmvi.socle.pack.ai.agent.worker.prompt.SystemPromptBuilder;
import eu.lmvi.socle.pack.ai.agent.worker.skill.SkillLoader;
import org.springframework.stereotype.Component;

import java.util.List;

/** Agent de veille : cherche, lit, interroge le corpus, puis répond. */
@Component
public class VeilleAgentWorker extends AbstractAgentWorker {

    public VeilleAgentWorker(AgentRuntime runtime, AgentToolBridge tools, AgentSessionStore sessions,
                             SkillLoader skills, SystemPromptBuilder prompts, LlmGatewayWorker gateway,
                             LlmModelRegistry models, ObjectMapper mapper) {
        super(runtime, tools, sessions, skills, prompts, gateway, models, mapper);
    }

    @Override public String getName() { return "veille_agent_worker"; }   // nom MOP
    @Override public String getAgentId() { return "veille"; }             // clé logique (gRPC, sessions)

    /** Actions MCP de CETTE app que le modèle peut appeler. */
    @Override
    protected List<String> getDefaultToolset() {
        return List.of(
                "web_worker__search",
                "web_worker__fetch_smart",
                "rag_worker__search_chunks",
                "agent_toolset__tool_search");     // découvre les autres actions à la demande
    }

    @Override
    protected String getDefaultSystemPrompt() {
        return """
                Tu es un assistant de veille. Tu cites toujours l'URL ou le document source.
                Tu n'inventes rien : sans source, tu dis que tu ne sais pas.
                """;
    }

    @Override protected String getDefaultModelId() { return "MiniMax-M3"; }  // doit exister dans db_model_pricing
    @Override protected Integer getMaxInnerIterations() { return 12; }
}
```

Hooks facultatifs : `onBeforeAgentStart`, `onBeforeToolCall` (bloquer un appel),
`onAfterToolCall`, `onShouldStopAfterTurn`, `transformContext` (compaction, injection RAG),
`convertToLlm` (format des messages, Anthropic par défaut), `getSteeringMessages`,
`getFollowUpMessages`.

---

## 6. Étape 3 — Lancer une session dans une transaction tenant

`tr_agent_session.x_partition` est `NOT NULL` et se remplit par trigger depuis
`app.current_tenant_id` : la création **doit** se faire dans une transaction qui pose la variable.
Patron de `LiveRunController` (APP-08) : créer et committer la session, puis exécuter la boucle
dans un fil virtuel, dans une seconde transaction.

```java
package eu.lmvi.monapp.agent;

import eu.lmvi.socle.pack.ai.agent.session.SessionRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class VeilleService {

    private static final Logger log = LoggerFactory.getLogger(VeilleService.class);

    private final VeilleAgentWorker agent;
    private final TransactionTemplate tx;
    private final JdbcTemplate jdbc;

    public VeilleService(VeilleAgentWorker agent, TransactionTemplate tx, JdbcTemplate jdbc) {
        this.agent = agent;
        this.tx = tx;
        this.jdbc = jdbc;
    }

    /** Rend l'UUID durable de la session (généré par la base) ; la boucle tourne en arrière-plan. */
    public UUID lancer(String tenant, String userId, String objectif) {
        String t = tenant.replaceAll("[^a-zA-Z0-9_-]", "");          // valeur injectée dans un SET
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("tenant_id", t);
        ctx.put("user_id", userId);

        SessionRecord session = tx.execute(s -> {
            jdbc.execute("SET LOCAL app.current_tenant_id = '" + t + "'");
            return agent.startSession(objectif, ctx);
        });
        UUID id = session.sessionUuid();

        Thread.ofVirtual().name("veille-" + id).start(() -> tx.executeWithoutResult(s -> {
            jdbc.execute("SET LOCAL app.current_tenant_id = '" + t + "'");
            SessionRecord fin = agent.runExistingSession(id, objectif, ctx,
                    ev -> log.debug("[veille:{}] {}", id, ev.getClass().getSimpleName()));
            log.info("[veille:{}] terminé → {} ({} / {} jetons)", id, fin.status(),
                    fin.cumulativeInputTokens(), fin.cumulativeOutputTokens());
        }));
        return id;
    }
}
```

Relance avec un message de suivi : `agent.continueSession(id, "et en Belgique ?", ctx, consumer)`,
dans la même forme de transaction.

---

## 7. Vérifier

```bash
docker logs monapp 2>&1 | grep -E 'LlmProviderRegistry|LlmModelRegistry|AgentGrpcService|ToolIndexer|veille_agent'
#   [LlmProviderRegistry] 1 providers chargés : [socle_gateway]
#   [LlmModelRegistry] 2 modèles chargés depuis schema_monapp.db_model_pricing : [MiniMax-M3, gpt-oss:120b]
#   [AgentGrpcService] initialized — 1 agents enregistrés : [veille]
#   [ToolIndexer] indexation terminée : N actions indexées

mcp() { curl -s -X POST http://localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1"; }
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"llm_gateway_worker__complete_blocking",
     "arguments":{"model":"MiniMax-M3","messages":[{"role":"user","content":"Réponds OK."}],"maxTokens":64}}}'
```

```sql
SELECT session_uuid, agent_id, status, cumulative_input_tokens, cumulative_output_tokens
  FROM schema_monapp.tr_agent_session ORDER BY x_dateCreated DESC LIMIT 5;
SELECT session_uuid, action_name, status, latency_ms, error_message
  FROM schema_monapp.tr_tool_call_audit ORDER BY x_id DESC LIMIT 10;   -- status : OK | ERROR | BLOCKED | TIMEOUT
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `complete_blocking` sur un modèle déclaré | `status: success`, `text` non vide, `usage` renseigné |
| 2 | `complete_blocking` sur un modèle absent de `db_model_pricing` | `model_not_found` |
| 3 | `startSession` hors transaction tenant | violation `NOT NULL` sur `x_partition` |
| 4 | Session lancée, outil `web_worker__search` appelé | ligne dans `tr_tool_call_audit` avec `session_uuid` |
| 5 | Redémarrage pendant une session `RUNNING` | reprise ou passage `CRASHED` par `OrphanSessionResolver` après 5 min |
| 6 | `test_provider` | `not_implemented` (stub connu) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `db_model_pricing` vide | `Modèle '…' introuvable dans LlmModelRegistry` ; l'agent est `unhealthy` (son `isHealthy` teste le modèle par défaut) | Seeder la table (§4) et redémarrer |
| Clé posée en `SOCLE_AI_PROVIDERS_*` | La passerelle ne la lit pas : elle lit `socle.ai.<provider>.api-key` (`SOCLE_AI_SOCLE_GATEWAY_API_KEY`, `SOCLE_AI_ANTHROPIC_API_KEY`…) | Deux espaces de clés : `providers.*` pour AI-02, `<provider>.*` pour la passerelle |
| `socle_gateway` laissé sur son URL codée | Appels vers `admin.thesocle.net/api/agentia` : contournement de l'APIM (ni quota, ni imputation) | `SOCLE_AI_SOCLE_GATEWAY_BASE_URL=https://api.thesocle.net/agentia` |
| Outil d'un worker du **Hub** dans `getDefaultToolset()` (`mail_worker__send_email`…) | WARN `action MCP introuvable … skip` : le pont ne voit que le registre de l'app | Écrire un worker de l'app qui relaie l'appel au Hub |
| Socle ≤ 5.9.2 et pack ≤ 2.7.13 | Les actions du worker agent n'apparaissent pas en MCP, sans erreur | Pack 2.7.14 (registre résolu à l'usage) ; socle ≥ 5.9.4 |
| `AgentGrpcService.startSession` | Ne pose pas `app.current_tenant_id` avant `agent.run(...)` : en mono-tenant, la création de session viole `NOT NULL` | Passer par un service applicatif transactionnel (§6), ou poser la variable au niveau de la connexion |
| UUID de session généré par le contrôleur | `session inconnue` au suivi | Utiliser l'UUID rendu par `startSession` |
| `SOCLE_AI_AGENT_DEFAULT_MODEL` en propriété Spring | Ignorée : lue par `System.getenv` à la construction de la classe | Variable d'environnement, ou surcharger `getDefaultModelId()` |
| Compétences attendues | Aucune n'est chargée (`NoopSkillLoader`) | Fournir un bean `SkillLoader` (ex. adossé à `SkillRepository`) |
| `ToolIndexer` et fournisseur d'embedding | Il prend le **premier** `EmbeddingProvider` de la liste, pas `socle.ai.embedding.provider` | Le vérifier dans `[ToolIndexer] embedding provider …` ; `tool-index.enabled=false` sinon |
| Indexation des outils au démarrage | Un appel d'embedding par action à chaque démarrage | Accepté (fil virtuel) ; désactivable |
| `stream_complete` par MCP | Rend toute la trace d'événements dans la réponse | `complete_blocking` pour un test ; le flux réel passe par `streamComplete()` en Java ou gRPC-Web |
| Modèle d'API OpenAI Responses | `no_stream_provider` | Employer un fournisseur à API Chat Completions |
| `MemoryService` gRPC | `UNIMPLEMENTED` (code 12) | Fonctionnalité non livrée |
| Workspace | Seules les méta-données existent ; aucun fichier n'est écrit ni purgé physiquement | Gérer les fichiers côté app (`storage_worker` du Hub) |

---

## 10. Pour aller plus loin

- [[howto-ai-07-lire-le-web-fetch-recherche-navigateur|AI-07 — Web]] : les outils web
- [[howto-ai-04-construire-un-rag-ingerer-et-interroger|AI-04 — RAG]] : `rag_worker__search_chunks` comme outil
- [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02 — Génération]] : la voie simple, sans boucle d'outils
- [[howto-27-configurer-agentia-gateway|HOWTO 27 — AgentIA Gateway]]
- [[howto-42-alfred-automatiser-une-tache|HOWTO 42 — Alfred]] : l'agent du Hub, avec garde-fous
