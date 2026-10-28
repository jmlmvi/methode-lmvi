# HOWTO AI-01 — Intégrer socle-pack-ai dans une application V005

**Niveau :** Confirmé
**Pack :** `eu.lmvi:socle-pack-ai:2.7.14` — branche `main`, code au commit `a357a95` — vérifié au code le 2026-10-28
**Socle :** pack compilé contre `socle-v005` 5.8.8 / Spring Boot 4.0.6 ; l'app doit être en Boot 4.0.6
**Prérequis :** app V005 en Boot 4 ; schéma PostgreSQL de l'app créé par le Hub ; extension `vector` présente dans la base ; une clé APIM si l'app appelle AgentIA ou `embed-std`
**Temps estimé :** 45 min

> Mode d'emploi générique des packs : [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]] (daté : 2.3.5).
> Clé d'accès aux modèles : [[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]].
> App Boot 3.2.1 : [[howto-ai-09-lignee-2-4-x-pour-les-apps-boot-3|AI-09]].

---

## 1. Contexte

`socle-pack-ai` est une bibliothèque : ses classes sont des `@Component` balayés par Spring dans
l'app hôte. Dès qu'elles sont balayées :

- `PackMigrationRunner` (`@PostConstruct`) applique les 27 scripts `classpath*:db/ai/V*.sql` dans
  le schéma `socle.ai.schema`, en substituant `${ai_schema}` et `${embedding_dimension}` ;
- les 10 workers sont démarrés par le MOP et leurs actions publiées en MCP sous
  `<worker>__<action>` (`rag_worker__search`, `generation_worker__generate`…).

Deux modes d'intégration coexistent dans la flotte :

| Mode | Pour qui | Exemple réel |
|---|---|---|
| **A — pack balayé** | l'app utilise les workers et les tables (génération, RAG, classification) | `APP-26B-IdeaBoxDev`, `APP-31-LeSachant` |
| **B — fournisseurs seuls** | l'app appelle seulement un modèle (AgentIA) ou la transcription, sans table | `APP-25-UniqPersonnality`, `APP-16-REGIES` |

---

## 2. Architecture

```
┌────────────────────────── App V005 (Boot 4.0.6) ──────────────────────────┐
│  @ComponentScan("eu.lmvi")  ── balaie eu.lmvi.socle.pack.ai.*             │
│                                                                           │
│  @PostConstruct PackMigrationRunner ──► <schema>.z_pack_migrations         │
│        V000…V1111, V999 (tables tr_*, z_*, db_*, seeds de prompts)        │
│                                                                           │
│  MOP ──► generation_worker  embedding_worker  rag_worker  …  (10 workers) │
│              │                   │                                        │
│      AgentIaLlmProvider    HttpEmbeddingProvider                          │
└──────────────┼───────────────────┼────────────────────────────────────────┘
               ▼                   ▼
   https://api.thesocle.net/agentia/v1     https://api.thesocle.net/embed-std/v1/embeddings
   (edge APIM, clé apim_<env>_<40hex>)     (edge APIM, même famille de clé)
               │
   PostgreSQL du Hub ── schéma de l'app (schema_<app>) + extensions vector, pg_trgm, pgcrypto
```

---

## 3. Étape 1 — Dépendance Maven

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.0.6</version>
    <relativePath/>
</parent>

<dependencies>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-v005</artifactId>
        <version>${socle.version}</version>
    </dependency>

    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-ai</artifactId>
        <version>2.7.14</version>
        <exclusions>
            <exclusion>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-logging</artifactId>
            </exclusion>
            <!-- Pilote Playwright : ~200 Mo dans l'image. À retirer seulement si l'app
                 n'appelle jamais browser_worker ni fetch_playwright (cf. AI-07). -->
            <exclusion>
                <groupId>com.microsoft.playwright</groupId>
                <artifactId>driver-bundle</artifactId>
            </exclusion>
        </exclusions>
    </dependency>

    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
        <scope>provided</scope>
    </dependency>
</dependencies>
```

**Où trouver l'artefact.** Au 2026-10-28, le `~/.m2` de la box de build s'arrête à **2.7.13** :
la 2.7.14 se construit depuis `main` puis se **vendorise** dans l'app, comme IdéeBox le fait pour
la 2.7.5 :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-ai
git checkout main && mvn -q clean install -DskipTests
mkdir -p <app>/mvn-repo/eu/lmvi/socle-pack-ai/2.7.14
cp ~/.m2/repository/eu/lmvi/socle-pack-ai/2.7.14/socle-pack-ai-2.7.14.{jar,pom} \
   <app>/mvn-repo/eu/lmvi/socle-pack-ai/2.7.14/
```

```xml
<repositories>
    <repository>
        <id>project-local</id>
        <url>file://${project.basedir}/mvn-repo</url>
        <releases><enabled>true</enabled></releases>
    </repository>
</repositories>
```

---

## 4. Étape 2 — Balayer le pack une seule fois (mode A)

Le pack vit sous `eu.lmvi.socle.pack.ai`, donc sous `eu.lmvi.socle`. Un `@SpringBootApplication`
nu dans `eu.lmvi` ramasse aussi `eu.lmvi.socle.SocleApplication`, dont le scan implicite repasse
sur `eu.lmvi.socle` : chaque bean du pack est vu deux fois. Le patron d'IdéeBox l'écarte :

```java
package eu.lmvi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigurationExcludeFilter;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.context.TypeExcludeFilter;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;

@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan(
    basePackages = "eu.lmvi",
    excludeFilters = {
        @ComponentScan.Filter(type = FilterType.CUSTOM, classes = TypeExcludeFilter.class),
        @ComponentScan.Filter(type = FilterType.CUSTOM, classes = AutoConfigurationExcludeFilter.class),
        @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE,
                classes = eu.lmvi.socle.SocleApplication.class),
        // Plateforme d'agents : à exclure si l'app ne construit pas d'agent (cf. AI-08).
        @ComponentScan.Filter(type = FilterType.REGEX,
                pattern = "eu\\.lmvi\\.socle\\.pack\\.ai\\.agent\\..*")
    })
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

Variante LeSachant : code de l'app sous `eu.lmvi.lesachant`, scan des deux paquets **disjoints**
`eu.lmvi.socle` et `eu.lmvi.lesachant`, générateur `FullyQualifiedAnnotationBeanNameGenerator`
et un alias `mcpActionScanner` (voir `APP-31-LeSachant/lesachant/.../Application.java`).

Ce qu'on peut exclure sans casser le reste :

| Paquet / classe exclus | Conséquence | Dépendants à exclure aussi |
|---|---|---|
| `eu.lmvi.socle.pack.ai.agent.*` | plus de passerelle LLM, d'agents, de gRPC, de `tool_search` | aucun |
| `eu.lmvi.socle.pack.ai.ClassificationWorker` | plus de classification | aucun |
| `eu.lmvi.socle.pack.ai.GenerationWorker` | plus de génération | `ClassificationWorker`, `rag.RagAnswerService`, `RagWorker`, `summary.*`, `translate.*`, `doc.*` |

---

## 5. Étape 3 — Configuration `application.yml`

Toutes les clés sont lues par `AiProperties` (`@ConfigurationProperties(prefix = "socle.ai")`) ;
les variables `SOCLE_AI_*` s'y lient par relaxed binding.

```yaml
spring:
  datasource:
    url: ${DATABASE_URL}
    username: ${DATABASE_USER}
    password: ${DATABASE_PASSWORD}

socle:
  mcp:
    enabled: true
    mode: http
    api-key: ${MCP_API_KEY}          # socle 5.9.x : vide = /mcp fermé et refus de démarrer
  ai:
    # 1. Le schéma de l'APP. Défaut du pack = public, le schéma partagé du Hub.
    schema: ${SOCLE_AI_SCHEMA:schema_monapp}
    migrations:
      enabled: ${SOCLE_AI_MIGRATIONS_ENABLED:true}

    # 2. Embeddings — la dimension est FIGÉE dans les colonnes vector(N) à la première migration.
    embedding:
      provider: ${SOCLE_AI_EMBEDDING_PROVIDER:http}
      model: ${SOCLE_AI_EMBEDDING_MODEL:bge-m3}
      dimension: ${SOCLE_AI_EMBEDDING_DIMENSION:1024}
      http:
        url: ${SOCLE_AI_EMBEDDING_HTTP_URL:https://api.thesocle.net/embed-std/v1/embeddings}
        api-key: ${SOCLE_AI_EMBEDDING_HTTP_API_KEY:}
        format: ${SOCLE_AI_EMBEDDING_HTTP_FORMAT:openai}

    # 3. Génération — le défaut du pack est anthropic / claude-sonnet-4-6.
    llm:
      provider: ${SOCLE_AI_LLM_PROVIDER:agentia}

    providers:
      agentia-base-url: ${SOCLE_AI_PROVIDERS_AGENTIA_BASE_URL:https://api.thesocle.net/agentia/v1}
      agentia-api-key: ${SOCLE_AI_PROVIDERS_AGENTIA_API_KEY:}
      agentia-app-id: ${SOCLE_AI_PROVIDERS_AGENTIA_APP_ID:monapp}
      agentia-model: ${SOCLE_AI_PROVIDERS_AGENTIA_MODEL:MiniMax-M3}
      agentia-disable-thinking: ${SOCLE_AI_PROVIDERS_AGENTIA_DISABLE_THINKING:true}
      timeout-seconds: ${SOCLE_AI_PROVIDERS_TIMEOUT_SECONDS:120}

    # 4. Navigateur mutualisé du Hub — sans lui, un Chromium LOCAL est lancé au premier usage.
    browser:
      ws-url: ${SOCLE_AI_BROWSER_WS_URL:ws://playwright:3001/}
```

Toute valeur qui contient « : » se met entre guillemets (amorce de transcription, prompt) : un
YAML cassé fait redémarrer l'app en boucle sans une ligne de journal.

---

## 6. Étape 4 — Schéma, extensions et secrets côté Hub

1. **Schéma** : créé par le Hub (`db_worker__create_app_schema`). `PackMigrationRunner` crée
   `<schema>.z_pack_migrations` puis les tables ; il ne crée pas le schéma lui-même.
2. **Extensions** : `V000` teste `pg_extension` avant de créer `vector`, `pg_trgm`, `pgcrypto`, et
   teste `pg_proc` avant de créer les fonctions `public.update_changed_fields()`,
   `public.z_after_*()`, `public.trg_x_partition_default()`. Sur le Hub elles existent déjà : le
   compte de l'app n'a besoin d'aucun droit sur `public`. Sur une base neuve, un administrateur
   crée les extensions une fois.
3. **Secrets** : poser la clé dans le coffre et dans l'environnement du conteneur, puis recréer le
   conteneur (`restart_app` ne réinjecte pas l'environnement) :

```text
vault_worker.set_secret(path="apps/monapp/agentia", key="api_key", value="apim_prod_<40hex>")
docker_worker.set_env_var(app_id="monapp", key="SOCLE_AI_PROVIDERS_AGENTIA_API_KEY", value="apim_prod_<40hex>")
docker_worker.set_env_var(app_id="monapp", key="SOCLE_AI_EMBEDDING_HTTP_API_KEY",    value="apim_prod_<40hex>")
docker_worker.update_app(app_id="monapp", new_tag="<tag courant>")
```

Le pack lit ses clés **dans l'environnement** : `VaultCredentialResolver` sait interroger un
`VaultWorker` du contexte (chemin `<socle.ai.vault.base-path>/<appId>/ai/<provider>`), mais les
fournisseurs LLM et embedding l'appellent avec `appId = null`, ce qui court-circuite la lecture
du coffre. Seule la transcription passe un `appId`.

---

## 7. Étape 5 — Mode B : fournisseur AgentIA seul, sans table

Patron d'`APP-25-UniqPersonnality` (`PackAiConfig`) : le pack n'est **pas** balayé, l'app
instancie les beans nécessaires.

```java
package eu.lmvi.monapp.ia;

import eu.lmvi.socle.pack.ai.config.AiProperties;
import eu.lmvi.socle.pack.ai.llm.AgentIaLlmProvider;
import eu.lmvi.socle.pack.ai.service.ConfigReloadService;
import eu.lmvi.socle.pack.ai.service.ModelPricingService;
import eu.lmvi.socle.pack.ai.service.VaultCredentialResolver;
import eu.lmvi.socle.pack.ai.service.resilience.ResilienceFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(AiProperties.class)
public class PackAiConfig {

    @Bean
    public ConfigReloadService packAiConfigReloadService() {
        return new ConfigReloadService();
    }

    @Bean
    public VaultCredentialResolver packAiVaultCredentialResolver(AiProperties props, ApplicationContext ctx) {
        return new VaultCredentialResolver(props, ctx);
    }

    /** Lit db_model_pricing dans le schéma de l'app ; table absente = coût 0, sans erreur. */
    @Bean
    public ModelPricingService packAiModelPricingService(javax.sql.DataSource ds, AiProperties props,
                                                         ConfigReloadService reload) {
        return new ModelPricingService(ds, props, reload);
    }

    /** Retry 3 tentatives (500 ms → 10 s) + disjoncteur 5 échecs / 30 s, ouvert 60 s. */
    @Bean
    public ResilienceFactory packAiResilienceFactory() {
        return new ResilienceFactory();
    }

    @Bean
    public AgentIaLlmProvider packAiAgentIaLlmProvider(AiProperties props, VaultCredentialResolver resolver,
                                                      ModelPricingService pricing, ResilienceFactory resilience) {
        return new AgentIaLlmProvider(props, resolver, pricing, resilience);
    }
}
```

L'app scanne alors `eu.lmvi.socle` en excluant `eu\\.lmvi\\.socle\\.pack\\.ai\\..*`, et pose
`socle.ai.migrations.enabled=false`. Appel :
`agentIa.generate(systemPrompt, userPrompt, Map.of("max_tokens", 800))` → `LlmResponse`.

---

## 8. Vérifier

```bash
# 1. Migrations et prompts — dans les journaux
docker logs monapp 2>&1 | grep -E 'pack-migration|prompt-resolver' | head
#   [worker:pack-migration] Found 27 DDL scripts for pack socle-pack-ai
#   [worker:pack-migration] all migrations applied successfully
#   [prompt-resolver] loaded N active prompts          ← N ≥ 4 (seeds V999)

# 2. Les tables sont dans le schéma de l'app, pas dans public
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_catalog.pg_tables
                         WHERE schemaname='schema_monapp' AND tablename LIKE 'tr_rag%'"

# 3. Les actions sont publiées en MCP (une app s'invoque par /mcp, pas /api/actions)
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"embedding_worker__list_providers","arguments":{}}}'
```

Réponse attendue (la donnée est une chaîne JSON dans `content[0].text`) :

```json
{"content":[{"type":"text","text":"{\"providers\":[{\"name\":\"http\",\"model\":\"bge-m3\",\"dimension\":1024,\"available\":true,\"active\":true}, …]}"}],"isError":false}
```

Tableau de bord : `http://localhost:8080/dashboard` (en-tête `X-Admin-Key`) — les workers
`generation_worker`, `embedding_worker`, `rag_worker`… y sont listés et `healthy`.

Depuis le Hub : `mcp_proxy_worker.mcp_proxy_invoke` avec le nom complet
`monapp__embedding_worker__list_providers`.

---

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Premier démarrage sur schéma vide | 27 lignes dans `<schema>.z_pack_migrations` |
| 2 | Redémarrage | `skip … (already applied)` en DEBUG, aucune ré-application |
| 3 | `pg_tables` sur `public` | aucune table `tr_rag_*` créée par l'app |
| 4 | `tools/list` sur `/mcp` | outils `generation_worker__*`, `embedding_worker__*`, `rag_worker__*` présents |
| 5 | Clé AgentIA retirée, redémarrage | `generation_worker` passe `unhealthy` (voir pièges) |
| 6 | `SOCLE_AI_LLM_PROVIDER=inconnu` | `IllegalStateException: LLM provider not found` à l'initialisation |

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `@SpringBootApplication` nu dans `eu.lmvi` | « A bean with that name has already been defined » ; en 2.7.3, `noopSkillLoader … points back to the same bean definition` | Exclure `eu.lmvi.socle.SocleApplication` (§4) ; pack ≥ 2.7.4 |
| `socle.ai.schema` laissé à `public` | Tables du pack créées dans le schéma partagé du Hub, ou `permission denied` | `SOCLE_AI_SCHEMA=schema_<app>` |
| Dimension changée après la première migration | `checksum mismatch on V001… Skipping` en WARN ; les colonnes restent `vector(<ancienne>)` et toute insertion échoue | Choisir la dimension avant le premier démarrage ; sinon nouveau schéma, ou `ALTER` manuel + suppression des lignes du registre |
| Une migration échoue | `IllegalStateException: Migration Vxxx failed` dans un `@PostConstruct` : l'app ne démarre pas | Lire l'erreur SQL ; corriger droits ou extension |
| Pack ≤ 2.5.0 sur le Hub | `permission denied for schema public` (V000 réécrivait les fonctions de `public`) | ≥ 2.6.0 pour V000, ≥ 2.7.5 pour les six migrations qui écrivaient dans `public` |
| Clé AgentIA absente | `GenerationWorker.isHealthy()` rend `active.isAvailable()` = faux : le superviseur redémarre le worker en boucle (constaté sur SDR2 le 2026-09-04) | Fournir la clé, ou exclure `GenerationWorker` si l'app ne génère pas |
| Fournisseur inconnu | `IllegalStateException` à `initialize()` | LLM : `agentia`, `anthropic`, `openai`, `ollama` ; embedding : `http`, `openai`, `ollama` |
| Valeur YAML avec « : » non quotée | Redémarrage en boucle sans erreur dans les journaux | Guillemets |
| Workers du pack « stopped » au tableau de bord (socle ≤ 5.9.4) | Le worker tourne ; ses `getStats()` ne portent pas `running`/`state` | Lire `get_status` et les journaux |
| `MCP_API_KEY` vide en socle 5.9.x | `/mcp` rend 401, l'app refuse de démarrer | Poser la clé |
| `set_env_var` suivi de `restart_app` | La clé n'arrive pas dans le conteneur | `update_app` |
| Croire le `README.md` du pack | Commandes `/api/actions/...` en 404, 4 workers décrits sur 10 | Ce HOWTO et le code font foi |
| App en Spring Boot 3.2.1 | Échec au démarrage (classes Boot 4) | Lignée 2.4.x : [[howto-ai-09-lignee-2-4-x-pour-les-apps-boot-3\|AI-09]] |
| `socle.ai.browser.ws-url` vide | Chromium local au premier usage du navigateur : +1 Go, ou `playwright_error` dans une image GraalVM | `ws://playwright:3001/` |

---

## 11. Pour aller plus loin

- [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02 — Générer du texte]]
- [[howto-ai-03-calculer-des-embeddings|AI-03 — Embeddings]]
- [[howto-ai-04-construire-un-rag-ingerer-et-interroger|AI-04 — RAG]]
- [[howto-ai-09-lignee-2-4-x-pour-les-apps-boot-3|AI-09 — Lignée 2.4.x]]
- [[howto-27-configurer-agentia-gateway|HOWTO 27 — AgentIA Gateway côté Hub]]
- [[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39 — Clé APIM pour une app]]
- [[howto-04-mettre-a-jour-une-app|HOWTO 04 — Mettre à jour une app]]
