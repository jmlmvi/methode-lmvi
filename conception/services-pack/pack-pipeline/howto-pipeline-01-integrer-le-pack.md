# HOWTO PIPELINE-01 — Intégrer socle-pack-pipeline dans une application

**Niveau :** Confirmé
**Cible :** application V005 **Spring Boot 4.1.2** (socle ≥ 5.10.0) avec un PostgreSQL applicatif — une app en Boot 4.0.6 (socle 5.8.4 → 5.9.x) prend `0.2.0`, une app restée en Boot 3.2.1 (socle ≤ 5.8.0) prend `0.1.0-SNAPSHOT`, cf. §4
**Versions vérifiées au code :** `socle-pack-pipeline` **0.5.0**, branche `feat/0.5.0`, non commitée au 2026-11-12 (0.4.0 : `main` @ `2e477c2`, tag `v0.4.0`) · compilé contre `socle-v005` 5.11.0 (minimum 5.10.0), parent `eu.lmvi:socle-v005-parent` 5.11.0 / Spring Boot 4.1.2 · 33 tests verts · date 2026-11-12
**Temps estimé :** 30 min

> Vue d'ensemble du pack : [[README|socle-pack-pipeline]]
> Méthode générale d'intégration d'un pack : [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]]

---

## 1. Contexte

Le framework V005 sait déjà exécuter des pipelines. Le pack en ajoute **la forme graphe et la gouvernance**.
Avant d'intégrer quoi que ce soit, il faut savoir lequel des trois mécanismes répond au besoin.

| | Pipeline **V1** du framework | Pipeline **V2** du framework | **socle-pack-pipeline** |
|---|---|---|---|
| Doc | `docs-socleV005/01-docsV2/institutional/70-pipeline-v1.md` | `71-pipeline-v2.md`, `72-pipeline-patterns.md` | ce dossier |
| Classe d'entrée | `PipelineEngine` | `PipelineBuilderV2`, `DefaultPipelineV2`, `PipelineStageWorker` | `PipelineWorker` (`pipeline_worker`) |
| Définition | YAML + scripts BeanShell/JS | **code Java**, builder fluent | **JSON** stocké en base, versionné |
| Forme | linéaire | **linéaire** (`DynamicPipelineBuilder`) | **DAG** : fan-out, fan-in, branchement conditionnel |
| Typage | `Object` | `<I,O>` à la compilation | enveloppe unique `PipelineMessage` (payload JSON) |
| Exécution | pool de threads | `VThreadStageExecutor` (vthreads, retry, timeout, DLQ) | **la même** : le pack réutilise V2 |
| Persistance métier | — | état technique en TechDB H2 | runs, étapes, lineage, métriques **en PostgreSQL** |
| Validation humaine | — | — | étape **H** + `human_resolve` |
| Modifiable sans recompiler | oui (YAML) | non | **oui** : `define` → `publish` à chaud |
| Pilotage | Java | Java | 35 actions MCP/REST + Java (24 jusqu'en 0.4.0) |

**Règle de choix :**

- Une suite fixe d'étapes typées, écrite une fois en Java → **Pipeline V2 du framework** (template
  `PipelineV2OrchestratorWorker` ou `PipelineEngineWorker` dans `templates/workers/`). Rien à ajouter.
- Un graphe avec des **branches** selon le contenu, une étape **humaine**, un **historique** des runs à
  consulter, ou un pipeline qu'on veut **modifier sans redéployer** → **le pack**.
- Un pipeline qui doit **partir tout seul** (événement de l'app, webhook, cron), appeler une adresse HTTP
  ou une action MCP avec un secret → **le pack 0.5.0** ([[howto-pipeline-11-declencheurs-et-file-dediee|PIPELINE-11]],
  [[howto-pipeline-10-credentials-http-et-actions|PIPELINE-10]]).
- Le pack ne remplace pas V2, il s'appuie dessus. Ses étapes héritent de la concurrence, du timeout et de
  la DLQ de V2. Les réglages s'écrivent dans le JSON, au bloc `config` de chaque étape.

Cas de référence : **APP-12-RssArchiver**, dont toute la curation éditoriale passe par ce pack depuis le
2026-06-15, et **APP-17-BilanSocle**, qui s'en sert pour des parcours rythmés par des validations humaines.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Application V005                                                    │
│                                                                      │
│   Vos StageHandler (@Component) ──┐     Votre service / worker       │
│                                   │     pipelineWorker.executeAction │
│                                   ▼              │                   │
│  ┌─────────────── socle-pack-pipeline ───────────┼─────────────────┐ │
│  │ PipelineWorker (PASSIVE, 35 actions) ◄────────┘    /mcp, REST   │ │
│  │   ├ DagValidator (V1–V7)                                        │ │
│  │   ├ PipelineRuntimeManager ── runs actifs (mémoire)             │ │
│  │   │     └ DagPipelineBuilder ── 1 queue + 1 executor par étape  │ │
│  │   ├ StageHandlerRegistry ── built-ins + vos handlers            │ │
│  │   ├ PipelineRepository (JdbcTemplate)                           │ │
│  │   ├ (0.5.0) CredentialService + SPI CredentialResolver          │ │
│  │   ├ (0.5.0) PipelineTriggerService → TriggerDispatcher          │ │
│  │   │     └ 1 file dédiée trig.<tenant>.<code> par pipeline       │ │
│  │   ├ (0.5.0) PipelineScheduleWorker (POLLING, échéances cron)    │ │
│  │   ├ (0.5.0) PipelineWebhookController (si webhook-enabled)      │ │
│  │   └ PackMigrationRunner ("pipelinePackMigrationRunner")         │ │
│  └───────────┬──────────────────────────────┬──────────────────────┘ │
│              │ exécution (framework V2)     │ métier + lineage       │
│              ▼                              ▼                        │
│   queues : techdb (H2) | memory | nats    PostgreSQL de l'app        │
│                                           <schema>.db_pipeline_type  │
│                                           <schema>.tr_pipeline_run   │
│                                           <schema>.tr_pipeline_*     │
│                                           <schema>.z_pack_migrations │
└──────────────────────────────────────────────────────────────────────┘
```

Frontière de persistance : PostgreSQL porte **ce que le métier veut relire** (templates, runs, étapes,
artefacts, métriques). L'état des files d'attente reste chez V2, dans le backend choisi. Les deux sont
reliés par `tr_pipeline_run.v2_execution_id`.

---

## 3. Étape 1 — Rendre le JAR disponible

Le pack n'est publié sur **aucun** dépôt distant. Il vit dans le `~/.m2` de la box de build
(`v005.thesocle.net`). Deux voies :

**Voie recommandée — vendoriser dans l'app** (comme le framework, cf. `CLAUDE.md` racine) :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-pipeline
git checkout feat/0.5.0               # 0.5.0 : pas encore de tag au 2026-11-12 — 0.4.0 : v0.4.0 — Boot 4.0.6 : v0.2.0 — Boot 3 : feat/p1-p4-dag-engine
mvn -q clean install -DskipTests      # compile aussi les tests : ils doivent compiler

V=0.5.0
APP=/opt/2026-TheHub4TheSocle/APP-XX-MonApp/monapp
D=$APP/mvn-repo/eu/lmvi/socle-pack-pipeline/$V
mkdir -p "$D"
cp ~/.m2/repository/eu/lmvi/socle-pack-pipeline/$V/socle-pack-pipeline-$V.jar "$D/"
cp ~/.m2/repository/eu/lmvi/socle-pack-pipeline/$V/socle-pack-pipeline-$V.pom "$D/"
```

Le pom du pack a pour parent `eu.lmvi:socle-v005-parent` 5.11.0 : ce parent et `eu.lmvi:socle-v005-bom`
5.11.0 doivent être résolvables aussi (vendoriser leurs `.pom` sous `mvn-repo/eu/lmvi/socle-v005-parent/5.11.0/`
et `mvn-repo/eu/lmvi/socle-v005-bom/5.11.0/`).

**Voie de secours** : `mvn install` du pack sur la machine qui construit l'app. Un artefact installé
ainsi n'existe que sur cette machine.

---

## 4. Étape 2 — `pom.xml` de l'application

Parent recommandé : **`eu.lmvi:socle-v005-parent`** 5.11.0, fils de `spring-boot-starter-parent` 4.1.2. Il
fournit `${socle.version}` (5.11.0), importe `eu.lmvi:socle-v005-bom` (gRPC 1.85.1, Testcontainers 1.21.4,
H2 2.5.252, Jedis 8.0.2, kafka-clients 4.4.0, mysql-connector-j 26.10.0, mariadb-java-client 4.0.0) et
pose la règle enforcer `socle-versions-testees` (phase `validate`) : le build échoue si une de ces
bibliothèques, ou `grpc-core`, retombe sous la version testée, ou si `socle-v005` est résolu dans une
autre version que `${socle.version}`.

```xml
<parent>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-v005-parent</artifactId>
    <version>5.11.0</version> <!-- fils de spring-boot-starter-parent 4.1.2 ; fournit ${socle.version} -->
    <relativePath/>
</parent>

<!-- pas de <socle.version> dans <properties> : le parent la fournit -->

<repositories>
    <repository>
        <id>project-local</id>
        <name>Dépôt Maven vendorisé (in-repo)</name>
        <url>file://${project.basedir}/mvn-repo</url>
        <releases><enabled>true</enabled></releases>
    </repository>
</repositories>

<dependencies>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-v005</artifactId>
        <version>${socle.version}</version>
    </dependency>

    <!-- Moteur de pipelines DAG -->
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-pipeline</artifactId>
        <version>0.5.0</version>   <!-- déclencheurs, http/mcp_action, credentials ; 0.4.0 sans eux ; app Boot 4.0.6 : 0.2.0 ; app Boot 3.2.1 : 0.1.0-SNAPSHOT -->
    </dependency>

    <!-- Jackson 2 : le pack l'emploie (provided), comme le socle. Le parent Boot 4.1.2 en gère la version
         (com.fasterxml.jackson.core:jackson-databind) ; le socle la tire déjà, la déclarer ne coûte rien. -->
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
    </dependency>

    <!-- PostgreSQL : le pack le déclare provided, l'app doit l'apporter -->
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
    </dependency>

    <!-- OBLIGATOIRE QUEL QUE SOIT LE BACKEND : DagPipelineBuilder référence io.nats.client.Connection
         dans ses signatures et le pack déclare jnats en provided. Sans lui : NoClassDefFoundError au boot,
         même en queue-backend=memory ou techdb (constaté par APP-16-REGIES et APP-17-BilanSocle). -->
    <dependency>
        <groupId>io.nats</groupId>
        <artifactId>jnats</artifactId>
        <version>2.19.1</version>
        <scope>runtime</scope>
    </dependency>
</dependencies>
```

| Version du pack | Parent Spring Boot de l'app | socle-v005 de l'app |
|---|---|---|
| **0.5.0** | **4.1.2** (parent `socle-v005-parent` 5.11.0) | ≥ 5.10.0 (construit contre 5.11.0) |
| 0.4.0 | 4.1.2 (parent `socle-v005-parent` 5.11.0) | ≥ 5.10.0 (construit contre 5.11.0) |
| 0.3.0 | 4.1.2 | ≥ 5.10.0 |
| 0.2.0 (dernière Boot 4.0.6) | 4.0.6 | 5.8.4 → 5.9.x |
| 0.1.0-SNAPSHOT (dernière Boot 3) | 3.2.1 | 5.7.4 → 5.8.0 |

Le Spring Boot de l'app doit être **celui du socle** et donc celui du pack — le parent `socle-v005-parent`
l'assure : un pack bâti sur un autre Boot compile, puis casse à l'exécution. Une app qui reste en
`0.1.0-SNAPSHOT` garde `<snapshots><enabled>true</enabled></snapshots>` sur son dépôt `project-local`.

**Jackson** : Boot 4 sérialise les requêtes et réponses HTTP en Jackson 3 (`tools.jackson.*`). Le pack, lui,
reste en Jackson 2 (`com.fasterxml`). Son seul contrôleur (0.5.0, désactivé par défaut) est
`POST /pipeline/webhook/{jeton}`, qui lit son corps en texte et l'analyse en Jackson 2. Si l'app rend dans **son** contrôleur un
`JsonNode` venu du pack (`graph`, `payload`, `lineage`…), le convertir d'abord en `Map`/`List`
(`PipelineJson.mapper().convertValue(n, Object.class)`) ; un `com.fasterxml…JsonNode` en `@RequestBody`
échoue (500) — lire le corps en `String` puis `PipelineJson.mapper().readTree(...)`.

Les cinq apps consommatrices déclarent toutes `jnats` ; 0.3.0 et 0.4.0 ne changent rien à ce point (jnats 2.19.1, non
géré par la nomenclature Boot 4.1.2).

**Journalisation (0.3.0)** : le pack n'apporte plus Logback. Jusqu'en 0.2.0, `spring-boot-starter-jdbc` tirait
`spring-boot-starter-logging` en portée compile ; une app qui comptait sur l'exclusion faite chez elle n'a rien
à changer, une app qui l'avait oubliée voyait Logback et Log4j2 se disputer SLF4J.

**OkHttp** : le pack n'en dépend pas. Le socle (5.10.0 et 5.11.0) apporte `com.squareup.okhttp3:okhttp-jvm` 5.5.1 (et non
plus `okhttp`) : une app qui déclare encore `okhttp` 4.x aura deux copies de `okhttp3.*`.

**Disruptor (0.4.0)** : le pack n'en déclare plus. Jusqu'en 0.3.0, `com.lmax:disruptor:3.4.4` en portée
compile passait dans l'app et y battait la 4.0.0 du socle (règle du plus proche). Une app restée en 0.3.0
déclare `com.lmax:disruptor:4.0.0` elle-même.

**Versions transitives du socle** : avec le parent `socle-v005-parent` 5.11.0, l'app reçoit les versions du
socle (gRPC 1.85.1, H2 2.5.252, Jedis 8.0.2…). Le défaut « parent Boot 4.1.2 → gRPC 1.84.1, H2 2.4.240,
Jedis 7.4.1 » relevé sur le socle 5.10.0 est corrigé côté socle par `socle-v005-bom` 5.10.1 et le parent
5.11.0.

**App qui garde son propre parent** (`spring-boot-starter-parent` 4.1.2 ou un parent maison) : voie
supportée. Déclarer `<socle.version>5.11.0</socle.version>`, importer `eu.lmvi:socle-v005-bom:5.11.0` en
`<type>pom</type><scope>import</scope>` dans `<dependencyManagement>`, **et** surcharger cinq propriétés
— un BOM importé ne bat pas les entrées directes de `spring-boot-dependencies` : `h2.version` 2.5.252,
`jedis.version` 8.0.2, `kafka.version` 4.4.0, `mysql.version` 26.10.0, `mariadb.version` 4.0.0. Cette
voie n'a pas la règle enforcer du parent.

---

## 5. Étape 3 — `application.yml`

```yaml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_USER}
    password: ${DB_PASSWORD}

socle:
  pipeline:
    # OBLIGATOIRE : le défaut est `public`. Sans cette ligne, les 9 tables (0.5.0) et le registre de
    # migrations du pack atterrissent dans le schéma partagé de la base.
    schema: ${PIPELINE_SCHEMA:schema_monapp}
    # techdb (défaut) | memory | nats — cf. HOWTO PIPELINE-04 §6 pour le choix
    queue-backend: ${PIPELINE_QUEUE_BACKEND:memory}
    # seulement si queue-backend=nats
    nats-url: ${PIPELINE_NATS_URL:nats://soclehub-nats:4222}
    # 0.5.0 — clé AES-256 (base64, 32 octets) des credentials ; vide = credential_set refusé
    credentials:
      key: ${SOCLE_PIPELINE_CREDENTIALS_KEY:}
    http:                          # handler http : garde SSRF du client par défaut
      allow-private: false
      allowed-hosts: []            # vide = tout hôte public ; ".exemple.fr" admet les sous-domaines
      timeout-ms: 15000
      max-response-bytes: 2000000
    trigger:                       # déclencheurs et files dédiées
      enabled: true
      max-depth: 5
      concurrency: 2
      max-retries: 0
      run-timeout-seconds: 300
      schedule-interval-ms: 30000
      webhook-enabled: false       # true expose POST /pipeline/webhook/{jeton}
```

Classe liée : `eu.lmvi.socle.pack.pipeline.config.PipelineProperties`. Les variables
d'environnement relâchées fonctionnent aussi : `SOCLE_PIPELINE_SCHEMA`, `SOCLE_PIPELINE_QUEUE_BACKEND`,
`SOCLE_PIPELINE_NATS_URL`.

Le préfixe `socle.pipeline` est **partagé avec le framework**, qui y range les réglages du Pipeline V1
(`enabled`, `core-workers`, `max-workers`, `queue-capacity`…). Les deux jeux de clés coexistent sans conflit
dans le même bloc.

| Variable | Défaut | Rôle |
|---|---|---|
| `socle.pipeline.schema` | `public` | schéma PostgreSQL des tables du pack et de son registre `z_pack_migrations` |
| `socle.pipeline.queue-backend` | `techdb` | où vivent les files d'attente entre étapes |
| `socle.pipeline.nats-url` | `nats://localhost:4222` | serveur JetStream, si `nats` ; en 0.5.0 aussi les files dédiées des déclencheurs |
| `socle.pipeline.credentials.key` | *(vide)* | clé du résolveur de credentials par défaut ([[howto-pipeline-10-credentials-http-et-actions\|PIPELINE-10]]) |
| `socle.pipeline.http.*` | cf. ci-dessus | handler `http` ([[howto-pipeline-10-credentials-http-et-actions\|PIPELINE-10]] §5.1) |
| `socle.pipeline.trigger.*` | cf. ci-dessus | déclencheurs ([[howto-pipeline-11-declencheurs-et-file-dediee\|PIPELINE-11]] §3) |

---

## 6. Étape 4 — Noms de beans : rien à faire depuis 0.2.0

À partir de **socle 5.8.6**, le framework déclare `eu.lmvi.socle.config.PipelineProperties` (préfixe
`socle.pipeline`, réglages du Pipeline V1). Jusqu'à 0.1.0-SNAPSHOT, le pack déclarait
`eu.lmvi.socle.pack.pipeline.config.PipelineProperties` sans nom explicite : Spring nommait les deux beans
`pipelineProperties` et l'application **refusait de démarrer** (`ConflictingBeanDefinitionException`).

**Corrigé en 0.2.0** : tous les beans du pack ont un nom explicite préfixé `pipelinePack`.

| Classe | Nom de bean (0.2.0) |
|---|---|
| `config.PipelineProperties` | `pipelinePackProperties` |
| `PipelineWorker` | `pipelinePackWorker` (le worker garde son nom MOP `pipeline_worker`) |
| `repo.PipelineRepository` | `pipelinePackRepository` |
| `engine.DagPipelineBuilder` | `pipelinePackDagBuilder` |
| `engine.StageHandlerRegistry` | `pipelinePackStageHandlerRegistry` |
| `engine.handlers.CompositeHandler` | `pipelinePackCompositeHandler` |
| `runtime.PipelineRuntimeManager` | `pipelinePackRuntimeManager` |
| `runtime.SubPipelineRunner` | `pipelinePackSubPipelineRunner` |
| `validation.DagValidator` | `pipelinePackDagValidator` |
| `service.ConfigReloadService` | `pipelinePackConfigReloadService` |
| `service.PackMigrationRunner` | `pipelinePackMigrationRunner` (inchangé) |
| (0.5.0) `engine.handlers.HttpHandler` / `McpActionHandler` | `pipelinePackHttpHandler` / `pipelinePackMcpActionHandler` |
| (0.5.0) `credential.CredentialService` / `CredentialRepository` / `DbCredentialResolver` | `pipelinePackCredentialService` / `pipelinePackCredentialRepository` / `pipelinePackDbCredentialResolver` |
| (0.5.0) `spi.JdkPipelineHttpClient` / `LocalActionInvoker` | `pipelinePackJdkHttpClient` / `pipelinePackLocalActionInvoker` |
| (0.5.0) `trigger.PipelineTriggerService` / `TriggerDispatcher` / `TriggerRepository` | `pipelinePackTriggerService` / `pipelinePackTriggerDispatcher` / `pipelinePackTriggerRepository` |
| (0.5.0) `trigger.PipelineScheduleWorker` | `pipelinePackScheduleWorker` (nom MOP `pipeline_schedule_worker`) |

Les deux `PipelineProperties` coexistent : types distincts, l'injection **par type** n'est pas ambiguë, et
chacune lit ses propres clés du bloc `socle.pipeline`. Le test `PackContexteSocleTest` du pack le prouve sur
un contexte Spring avec le socle 5.11.0 / Boot 4.1.2 (0.4.0 ; 5.10.0 en 0.3.0 ; 5.9.0 et 5.8.8 en 0.2.0) ; il échoue si le nom explicite est retiré. Ni le socle 5.10.0 ni le 5.11.0 n'introduisent de nouvelle collision.

Conséquences pour l'app :

- Une app qui ne fait que l'injection par type (`PipelineWorker`, `PipelineRepository`…) n'a rien à changer.
- Le générateur `PackQualifiedBeanNameGenerator` + `NomsDesPacks` (TheDiffuseur 1.7.0) **n'est plus requis
  pour ce pack**. Le garder est sans effet sur lui : un nom explicite prime sur le générateur. Le retirer
  seulement si aucun autre pack n'en a besoin.
- Une app qui cherchait un bean du pack **par son nom** (`getBean("pipelineWorker")`, `@Qualifier`) doit
  prendre le nouveau nom — aucune des cinq apps consommatrices ne le fait (vérifié le 2026-10-28).

L'`Application.java` reste standard : le `@SpringBootApplication` du package `eu.lmvi` balaie
`eu.lmvi.socle.pack.pipeline.*`, sans `@ComponentScan` supplémentaire.

---

## 7. Étape 5 — Préparer PostgreSQL

Au démarrage, `PackMigrationRunner` (bean `pipelinePackMigrationRunner`, `@PostConstruct`) :

1. tente `CREATE SCHEMA IF NOT EXISTS <schema>` (l'échec est avalé si le rôle n'a pas le droit) ;
2. crée `<schema>.z_pack_migrations` (registre **local au schéma** depuis le 2026-08-08) ;
3. applique dans l'ordre `classpath*:db/pipeline/V*.sql` en substituant `${pipeline_schema}` ;
4. **lève une exception et bloque le démarrage** si un script échoue.

| Script | Contenu |
|---|---|
| `V000__init.sql` | schéma, fonctions `fn_touch_datechanged()` et `fn_x_partition_default()` locales au schéma |
| `V001__core.sql` | `db_pipeline_type`, `tr_pipeline_run`, `tr_pipeline_stage_run`, `tr_pipeline_artifact`, `tr_pipeline_metric`, `db_pipeline_catalogue` + triggers |
| `V002__run_key_unique.sql` | *(branche)* clôt les runs en double puis pose `uq_tr_pipeline_run_runkey_vivant … NULLS NOT DISTINCT` |
| `V003__credentials_triggers.sql` | (0.5.0) `db_pipeline_credential`, `tr_pipeline_trigger`, `tr_pipeline_trigger_event` + triggers ; `tr_pipeline_run.run_key` porté à 400 caractères (`<code>:<eventId>`) |

Sur le Hub, le schéma s'obtient par `db_worker.create_app_schema` à l'installation. Le rôle applicatif
doit **posséder** le schéma (ou y avoir `CREATE`) : les scripts créent séquences, tables, fonctions et
triggers.

**PostgreSQL 15 minimum** : `NULLS NOT DISTINCT` n'existe pas avant. Sur un PG 14, `V002` échoue et l'app
ne démarre pas.

---

## 8. Étape 6 — Premier appel depuis le code

`PipelineWorker` est un bean ordinaire : on l'injecte et on appelle `executeAction`. C'est la voie
retenue par RssArchiver et BilanSocle. Le `ActionContext` peut être `null`. Depuis 0.5.0, le worker en lit le
tenant (`tenantId()`) et l'auteur (`callerId()`) : `instantiate` les inscrit dans le run (credentials du
tenant, `{{ $run.tenant }}`, contexte des appels sortants), et les actions `credential_*` / `trigger_*`
travaillent dans ce tenant. `null` = tenant `null`.

```java
package eu.lmvi.monapp.pipeline;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Contrôle de démarrage : le pack répond et voit les handlers de l'app. */
@Component
public class PipelineSmokeCheck implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PipelineSmokeCheck.class);
    private final PipelineWorker pipeline;

    public PipelineSmokeCheck(PipelineWorker pipeline) {
        this.pipeline = pipeline;
    }

    @Override
    public void run(ApplicationArguments args) {
        ActionResult handlers = pipeline.executeAction("list_handlers", ActionParameters.fromMap(Map.of()), null);
        ActionResult types = pipeline.executeAction("list_types", ActionParameters.fromMap(Map.of()), null);
        if (!handlers.success() || !types.success()) {
            log.error("[pipeline] pack injoignable : {} / {}", handlers.error(), types.error());
            return;
        }
        log.info("[pipeline] handlers={} templates={}",
                handlers.data().get("handlers"), ((java.util.List<?>) types.data().get("types")).size());
    }
}
```

---

## 9. Vérifier

**Au démarrage, dans les journaux :**

```
[worker:pack-migration] Found 4 DDL scripts for pack socle-pack-pipeline (schéma schema_monapp)
[worker:pack-migration] all migrations applied successfully
[pipeline] StageHandlerRegistry initialisé — 8 handlers: [identity, set-field, merge-fields, log, collect, composite, http, mcp_action]
[pipeline] credentials : résolveur actif 'db-aes-gcm' (écriture possible)
[worker:pipeline_worker] initialized
[worker:pipeline_schedule_worker] initialized
[pipeline-trigger] 0 file(s) dédiée(s) ouverte(s) — backend memory
```

Huit handlers sans aucun handler d'app (0.5.0) : les cinq built-ins plus `composite`, `http` et `mcp_action`,
déclarés en beans (six jusqu'en 0.4.0). L'ordre de la liste varie d'un démarrage à l'autre (table de hachage).
Sans clé de credentials, la deuxième ligne dit `écriture impossible — credentials en base indisponibles : …`.

**En base :**

```sql
SELECT version, script_name, executed_at
  FROM schema_monapp.z_pack_migrations
 WHERE pack_id = 'socle-pack-pipeline' ORDER BY version;

SELECT c.relname FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'schema_monapp' AND c.relname LIKE '%pipeline%' AND c.relkind = 'r';
```

Attendu : `V000` à `V003` ; 9 tables (6 jusqu'en 0.4.0). La requête passe par `pg_catalog` : `information_schema`
ne montre que les objets sur lesquels le rôle a des droits et peut rendre un faux « absent ».

**Par MCP, sur l'app :**

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pipeline_worker__list_handlers","arguments":{}}}'
```

La donnée est une **chaîne JSON** dans `result.content[0].text` : `{"handlers":["collect","composite",…],"descriptors":[…]}`.

---

## 10. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Démarrer l'app sur une base vierge | 9 tables + `z_pack_migrations` dans `socle.pipeline.schema`, rien dans `public` |
| 2 | Redémarrer | `skip … (already applied)` en DEBUG, aucune ré-exécution |
| 3 | Socle ≥ 5.8.6, pack ≥ 0.2.0, **sans** générateur de noms dans l'app | démarrage normal, `pipeline_worker` (et en 0.5.0 `pipeline_schedule_worker`) visibles sur `/dashboard` |
| 4 | Dans le contexte : `getBeanNamesForType(eu.lmvi.socle.pack.pipeline.config.PipelineProperties)` | `[pipelinePackProperties]` ; `pipelineProperties` reste celui du socle |
| 5 | `list_handlers` | contient vos handlers en plus des 8 du pack (0.5.0) |
| 6 | Deux apps avec le pack sur la même base, schémas distincts | chacune a ses 9 tables et son registre |
| 7 | (0.5.0) `credential_types` | `resolver: db-aes-gcm`, `writable: true` si la clé est posée |

---

## 11. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Socle ≥ 5.8.6 + pack **0.1.0-SNAPSHOT** (app Boot 4 pas encore montée) | l'app ne démarre pas : deux beans `pipelineProperties` | passer au pack **0.2.0** (§6) ; à défaut, le générateur `NomsDesPacks` de TheDiffuseur 1.7.0 |
| Pack 0.2.0 dans une app **Boot 3.2.1** | compile, puis `NoSuchMethodError`/`ClassNotFoundException` Spring à l'exécution | une app Boot 3 reste en `0.1.0-SNAPSHOT` |
| Pack 0.4.0 / 0.3.0 dans une app Boot 4.0.6 (socle ≤ 5.9.x), ou 0.2.0 dans une app socle 5.10.x-5.11.x | Boot du pack ≠ Boot de l'app : risque d'erreur Spring à l'exécution | aligner : socle 5.10-5.11 / Boot 4.1.2 → 0.5.0 (ou 0.4.0) ; socle 5.8.4–5.9.x / Boot 4.0.6 → 0.2.0 |
| App sur pack **≤ 0.3.0** | `disruptor` 3.4.4 dans l'app au lieu de la 4.0.0 du socle (`mvn dependency:tree`) ; Log4j2 du socle attend la 4.x | prendre **0.4.0**, ou déclarer `com.lmax:disruptor:4.0.0` dans l'app |
| App en socle 5.10.x-5.11.x qui déclare encore `com.squareup.okhttp3:okhttp` 4.x | deux copies de `okhttp3.*` sur le classpath | passer à `okhttp-jvm` 5.5.1 (celui du socle) ou ne rien déclarer |
| `JsonNode` du pack rendu tel quel par un contrôleur de l'app (Boot 4) | JSON mal écrit ou 500 (Jackson 3 côté HTTP) | convertir en `Map`/`List` avant de rendre (§4) |
| `socle.pipeline.schema` oublié | tables du pack dans `public`, mêlées aux autres apps | toujours fixer le schéma de l'app |
| PostgreSQL 14 ou moins | `V002` échoue : `syntax error at or near "NULLS"`, l'app ne démarre pas | PostgreSQL ≥ 15 |
| Rôle sans droit de création dans le schéma | `failed to apply V001…`, démarrage bloqué | provisionner le schéma au nom du rôle applicatif |
| Checksum modifié d'un script déjà appliqué | `checksum mismatch … Skipping` : la migration n'est **pas** rejouée | ne jamais modifier un `V*.sql` publié ; écrire un `V00n` |
| Dépôt vendorisé sans `<snapshots>` (app restée en 0.1.0-SNAPSHOT) | `Could not find artifact …0.1.0-SNAPSHOT` | activer les snapshots sur le dépôt `project-local` ; 0.2.0, 0.3.0 et 0.4.0 sont des releases |
| `mvn install -DskipTests` du pack après avoir modifié le constructeur de `PipelineWorker` | échec de compilation des tests | `-DskipTests` compile les tests ; mettre à jour les `new PipelineWorker(...)` des tests |
| `queue-backend` laissé à `techdb` | `object is already closed` sous charge (RssArchiver, BilanSocle, NotionSocle) | `memory`, cf. [[howto-pipeline-04-executer-un-run\|PIPELINE-04]] §6 |
| (0.5.0) `SOCLE_PIPELINE_CREDENTIALS_KEY` absente | l'app démarre ; `credential_set` échoue `aucune clé de chiffrement` | poser la clé (32 octets base64), ou un bean `CredentialResolver` de l'app |
| (0.5.0) `trigger.webhook-enabled=true` derrière une authentification de l'app ou du Hub | les appels entrants reçoivent 401/302 | laisser passer `/pipeline/webhook/**` sans authentification, et rien d'autre ([[howto-pipeline-11-declencheurs-et-file-dediee\|PIPELINE-11]] §7) |
| (0.5.0) Déclencheurs avec `queue-backend` à `memory` | événements en file perdus au redémarrage | `nats` en production (décision D1) |
| **`jnats` absent** (quel que soit le backend) | `NoClassDefFoundError: io/nats/client/Connection` au démarrage, à la création de `DagPipelineBuilder` | ajouter `io.nats:jnats:2.19.1` (scope `runtime` suffit) |
| Déclarer une `<configuration>` sur `maven-enforcer-plugin` dans le pom de l'app (liste `bannedDependencies/excludes`, `combine.self="override"`, `<skip>true</skip>`) | aucun message : la liste redéclarée **remplace** celle du parent, ou la règle est coupée — les bornes de `socle-versions-testees` disparaissent | Ne jamais configurer le plugin dans l'app. Une règle de plus = une autre `<execution>` avec son propre `<id>` |
| Redéclarer `h2.version`, `jedis.version`, `kafka.version`, `mysql.version` ou `mariadb.version` sous la version du socle dans une app au parent `socle-v005-parent` | build en échec à `validate` (règle `socle-versions-testees`) | Voulu : retirer la surcharge, la version vient du parent |
| App au parent `spring-boot-starter-parent` sans `socle-v005-bom` (ou avec le BOM sans les cinq propriétés) | l'app reçoit gRPC 1.84.1, H2 2.4.240, Jedis 7.4.1 de Boot au lieu des versions du socle | Parent `socle-v005-parent` 5.11.0 ; sinon BOM + cinq propriétés (§4) — corrigé côté socle en 5.10.1 (BOM étendu) et 5.11.0 (parent) |

---

## 12. Pour aller plus loin

- [[howto-pipeline-02-declarer-valider-publier-un-dag|PIPELINE-02]] — écrire et publier son premier DAG
- [[howto-pipeline-03-ecrire-un-stage-handler|PIPELINE-03]] — brancher sa logique métier
- [[howto-pipeline-10-credentials-http-et-actions|PIPELINE-10]] — credentials, `http`, `mcp_action` (0.5.0)
- [[howto-pipeline-11-declencheurs-et-file-dediee|PIPELINE-11]] — déclencheurs et file dédiée (0.5.0)
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]] — intégration générique d'un pack
- `docs-socleV005/01-docsV2/institutional/71-pipeline-v2.md` — le moteur V2 sur lequel le pack s'appuie
