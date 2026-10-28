# HOWTO EDITORIAL-01 — Intégrer `socle-pack-editorial` dans une application

**Niveau :** Confirmé
**Cible :** application V005 sur la **lignée Spring Boot 3.2.1** (socle 5.7.x)
**Versions vérifiées au code (2026-10-28) :** `eu.lmvi:socle-pack-editorial:1.0.0-SNAPSHOT`, dépôt
`socle-pack-Editorial`, branche `main` @ `fffd6f9` (2026-10-10) — compilé contre `socle-v005:5.7.4`,
`socle-pack-ai:2.3.3`, `socle-pack-comm:1.0.0-SNAPSHOT`, Spring Boot 3.2.1
**Prérequis :** PostgreSQL ≥ 14 ; [[howto-ai-01-integrer-le-pack|pack-ai intégré]] ;
[[howto-com-01-integrer-le-pack|pack-comm intégré]]
**Temps estimé :** 45 min

> Fiche générique d'intégration d'un pack : [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]].
> Cette fiche-ci la précise pour Editorial et **la corrige sur deux points** (voir §9).

---

## 1. Contexte

`socle-pack-editorial` apporte à une application un pipeline de veille éditoriale complet, en
quatre workers et huit tables PostgreSQL :

| Worker | Rôle | Actions | HOWTO |
|---|---|---|---|
| `rss_collect_worker` | collecte RSS/Atom, poller interne 60 s | 8 | [[howto-editorial-02-collecter-des-flux-rss\|EDITORIAL-02]] |
| `curation_worker` | score + résumé LLM, routage par seuils | 6 | [[howto-editorial-03-curer-et-router-les-articles\|EDITORIAL-03]] / [[howto-editorial-04-enrichir-les-articles-publies\|04]] |
| `hitl_worker` | file de validation humaine, poller 15 min | 8 | [[howto-editorial-05-valider-en-hitl\|EDITORIAL-05]] |
| `newsletter_worker` | newsletters HTML, envoi par pack-comm | 9 | [[howto-editorial-06-envoyer-des-newsletters\|EDITORIAL-06]] |

Soit **31 actions** (le README du pack en annonce 35).

**Le pack n'est pas autonome.** Ses classes importent directement celles de `socle-pack-ai`
(`GenerationWorker`, `ClassificationWorker`, `RagWorker`, `FiveW1HService`, `TranslationService`,
`WebWorker`) et de `socle-pack-comm` (`NotifyWorker`). Les deux jars doivent donc être **présents sur
le classpath** ; seuls certains beans sont facultatifs (§9).

**Statut : SNAPSHOT, non publié.** Aucune version n'est publiée sur `maven.thesocle.net` ni vendorisée
dans un `mvn-repo/`. Une application l'obtient en construisant le pack elle-même (§3).

Application de référence : **APP-12-RssArchiver** (`APP-12-RssArchiver/rssarchiver/pom.xml`), qui
l'embarque avec la collecte, l'enrichissement et la configuration de curation — mais coupe
`curation_worker` au profit de son propre pipeline DAG.

---

## 2. Architecture

```
┌──────────────────────── Application hôte (Boot 3.2.1, socle 5.7.x) ────────────────────────┐
│  @ComponentScan("eu.lmvi.socle","eu.lmvi") + FullyQualifiedAnnotationBeanNameGenerator      │
│                                                                                             │
│  socle-pack-editorial                 socle-pack-ai                 socle-pack-comm         │
│  ├ rss_collect_worker ──────────────┐ ├ GenerationWorker ◄─ requis  ├ NotifyWorker ◄─ opt.  │
│  ├ curation_worker ── generateOne ──┼►├ RagWorker / FiveW1H / …     │   (HITL, newsletter)  │
│  ├ hitl_worker ───── sendNotification ─────────────────────────────►│                       │
│  ├ newsletter_worker ───────────────┘ └ WebWorker (fetch_smart)     └                       │
│  ├ KewClient ── HTTPS X-API-Key ──► api.thesocle.net/kew-{fast|std|eco}/v1/extract (APIM)    │
│  └ PackMigrationRunner (@PostConstruct) ── db/editorial/V*.sql                              │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               ▼
                 PostgreSQL : <SOCLE_EDITORIAL_SCHEMA>.db_source_rss, tr_raw_item, tr_article,
                 tr_hitl_queue, tr_newsletter_envoi, z_curation_config, z_hitl_config,
                 z_newsletter_config  +  public.z_pack_migrations (registre partagé des packs)
```

---

## 3. Étape 1 — Construire les trois packs

Le pack est compilé contre `socle-pack-ai:2.3.3` et `socle-pack-comm:1.0.0-SNAPSHOT` en scope
`provided`. L'application choisit ensuite ses propres versions de ai et comm (§4).

```bash
# Framework de la lignée du pack (5.7.4) dans ~/.m2 — cf. CLAUDE.md, voie vendorisée ou install-file
mvn install:install-file \
  -Dfile=lib/socle-v005-5.7.4.jar -DpomFile=lib/socle-v005-5.7.4.pom \
  -DgroupId=eu.lmvi -DartifactId=socle-v005 -Dversion=5.7.4 -Dpackaging=jar

# Editorial, depuis la branche main
cd /opt/2026-TheHub4TheSocle/socle-pack-Editorial
git checkout main && git pull
mvn clean install -DskipTests
# → ~/.m2/repository/eu/lmvi/socle-pack-editorial/1.0.0-SNAPSHOT/socle-pack-editorial-1.0.0-SNAPSHOT.jar
```

Pour que l'application compile sur une autre machine (CI, poste neuf), **vendoriser** le jar et le
pom dans le dépôt de l'application, comme le framework :

```bash
APP=/opt/2026-TheHub4TheSocle/APP-XX-MonApp/monapp
V=1.0.0-SNAPSHOT
mkdir -p $APP/mvn-repo/eu/lmvi/socle-pack-editorial/$V
cp ~/.m2/repository/eu/lmvi/socle-pack-editorial/$V/socle-pack-editorial-$V.jar \
   ~/.m2/repository/eu/lmvi/socle-pack-editorial/$V/socle-pack-editorial-$V.pom \
   $APP/mvn-repo/eu/lmvi/socle-pack-editorial/$V/
```

---

## 4. Étape 2 — `pom.xml` de l'application

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.1</version>
    <relativePath/>
</parent>

<properties>
    <java.version>21</java.version>
    <socle.version>5.7.4</socle.version>
</properties>

<repositories>
    <repository>
        <id>project-local</id>
        <name>Dépôt Maven vendorisé (in-repo)</name>
        <url>file://${project.basedir}/mvn-repo</url>
        <releases><enabled>true</enabled></releases>
        <snapshots><enabled>true</enabled></snapshots>
    </repository>
</repositories>

<dependencies>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-v005</artifactId>
        <version>${socle.version}</version>
    </dependency>

    <!-- Les trois packs : ai et comm sont OBLIGATOIRES sur le classpath -->
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-ai</artifactId>
        <version>2.4.8</version>   <!-- dernière de la lignée Boot 3.2.1 -->
    </dependency>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-comm</artifactId>
        <version>1.0.0-SNAPSHOT</version>
    </dependency>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-editorial</artifactId>
        <version>1.0.0-SNAPSHOT</version>
    </dependency>

    <!-- Fournis par l'app (le pack les déclare en provided) -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <exclusions>
            <exclusion>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-logging</artifactId>
            </exclusion>
        </exclusions>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-log4j2</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-jdbc</artifactId>
    </dependency>
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
    </dependency>
    <dependency>
        <groupId>com.lmax</groupId>
        <artifactId>disruptor</artifactId>
        <version>3.4.4</version>
    </dependency>
</dependencies>
```

`okhttp 4.12.0`, `jsoup 1.17.2` et `rome 2.1.0` arrivent transitivement avec le pack (scope compile).

> Versions de ai/comm : le pack a été compilé contre ai **2.3.3**. RssArchiver tourne avec ai
> `2.7.7` et comm `1.0.0-SNAPSHOT` ; les signatures utilisées (`GenerationWorker.generateOne(partition,
> promptId, context, options)`, `NotifyWorker.sendNotification(…)`) y sont présentes. Toute autre
> combinaison se vérifie par `mvn compile` **et** par un démarrage réel — une signature changée ne
> se voit qu'au premier appel (`NoSuchMethodError`).

---

## 5. Étape 3 — `Application.java` : balayage et nommage des beans

Les packs ai, comm et editorial déclarent chacun des `@Component` **de même nom simple**
(`TenantResolver`, `PackMigrationRunner`, …). Sans générateur de noms qualifiés, le démarrage échoue
en `ConflictingBeanDefinitionException`.

```java
package eu.lmvi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FullyQualifiedAnnotationBeanNameGenerator;

@SpringBootApplication
@ComponentScan(basePackages = {
        "eu.lmvi.socle",   // framework + les trois packs — NE PAS SUPPRIMER
        "eu.lmvi"          // application
})
public class Application {
    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(Application.class);
        app.setBeanNameGenerator(new FullyQualifiedAnnotationBeanNameGenerator());
        app.run(args);
    }
}
```

C'est la configuration de `APP-12-RssArchiver/rssarchiver/src/main/java/eu/lmvi/Application.java`.

---

## 6. Étape 4 — Schéma PostgreSQL et migrations

`PackMigrationRunner` (bean du pack) s'exécute en `@PostConstruct` : il lit
`classpath*:db/editorial/V*.sql`, substitue `${editorial_schema}` par `socle.editorial.schema`
(nettoyé en `[a-z0-9_]`), et inscrit chaque version dans `public.z_pack_migrations`
(`pack_id = 'socle-pack-editorial'`). Une migration en échec **arrête le démarrage**
(`IllegalStateException("Migration … failed")`).

Ordre appliqué : `V000` … `V011`, puis `V999` (seeds), puis `V999z` (curation par type).

Ce que le runner **ne fait pas**, et que l'application prépare avant le premier démarrage :

```sql
-- 1. Le schéma : aucune migration ne fait CREATE SCHEMA
CREATE SCHEMA IF NOT EXISTS schema_monapp AUTHORIZATION monapp;

-- 2. V000 exécute CREATE EXTENSION IF NOT EXISTS pgcrypto : droit requis sur la base
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3. V000 crée des fonctions dans public (update_changed_fields, z_after_*, trg_x_partition_default)
GRANT CREATE ON SCHEMA public TO monapp;
```

Sur le Hub, un schéma d'app se crée par `db_worker.create_app_schema` (voir
[[howto-03-installer-une-app|HOWTO 03]]) ; l'extension `pgcrypto` se pose une fois par un compte
propriétaire.

---

## 7. Étape 5 — `application.yml`

Bloc complet des propriétés réellement lues par `EditorialProperties` (préfixe `socle.editorial`),
avec leurs défauts au code :

```yaml
socle:
  editorial:
    schema: ${DB_SCHEMA:schema_monapp}
    app-name: ${SOCLE_EDITORIAL_APP_NAME:MonApp}
    default-language: ${SOCLE_EDITORIAL_DEFAULT_LANGUAGE:fr}

    # Interrupteur lu par @ConditionalOnProperty sur CurationWorker (défaut : actif)
    curation-worker:
      enabled: ${SOCLE_EDITORIAL_CURATION_WORKER_ENABLED:true}

    rss:
      http-timeout-seconds: ${SOCLE_EDITORIAL_RSS_HTTP_TIMEOUT_SECONDS:30}
      fetch-retries: ${SOCLE_EDITORIAL_RSS_FETCH_RETRIES:3}
      max-error-count: ${SOCLE_EDITORIAL_RSS_MAX_ERROR_COUNT:10}
      error-retry-hours: ${SOCLE_EDITORIAL_RSS_ERROR_RETRY_HOURS:24}
      collect-interval-seconds: ${SOCLE_EDITORIAL_RSS_COLLECT_INTERVAL_SECONDS:60}
      parallel-fetches: ${SOCLE_EDITORIAL_RSS_PARALLEL_FETCHES:3}
      polite-ms: ${SOCLE_EDITORIAL_RSS_POLITE_MS:1500}
      min-content-chars-for-fetch: ${SOCLE_EDITORIAL_RSS_MIN_CONTENT_CHARS_FOR_FETCH:500}
      always-fetch-body: ${SOCLE_EDITORIAL_RSS_ALWAYS_FETCH_BODY:false}

    hitl:
      timeout-check-interval-minutes: ${SOCLE_EDITORIAL_HITL_TIMEOUT_CHECK_INTERVAL_MINUTES:15}

    newsletter:
      base-url: ${APP_BASE_URL:https://monapp.thesocle.net}
      unsubscribe-url-pattern: ${SOCLE_EDITORIAL_NEWSLETTER_UNSUBSCRIBE_URL_PATTERN:{base_url}/unsubscribe?token={token}}
      unsubscribe-secret: ${SOCLE_EDITORIAL_NEWSLETTER_UNSUBSCRIBE_SECRET:}
      intro-prompt-id: ${SOCLE_EDITORIAL_NEWSLETTER_INTRO_PROMPT_ID:newsletter_intro}
      notify-type: ${SOCLE_EDITORIAL_NEWSLETTER_NOTIFY_TYPE:NEWSLETTER}
      scheduler-enabled: ${SOCLE_EDITORIAL_NEWSLETTER_SCHEDULER_ENABLED:false}
      scheduler-interval-seconds: ${SOCLE_EDITORIAL_NEWSLETTER_SCHEDULER_INTERVAL_SECONDS:3600}

    rag:
      ingest-enabled: ${SOCLE_EDITORIAL_RAG_INGEST_ENABLED:true}

    kew:
      base-url: ${SOCLE_EDITORIAL_KEW_BASE_URL:https://api.thesocle.net}
      tiers: ${SOCLE_EDITORIAL_KEW_TIERS:fast,std,eco}
      api-key: ${SOCLE_EDITORIAL_KEW_API_KEY:}
      timeout-seconds: ${SOCLE_EDITORIAL_KEW_TIMEOUT_SECONDS:30}
      max-concurrent-per-host: ${SOCLE_EDITORIAL_KEW_MAX_CONCURRENT_PER_HOST:32}
```

Chaque propriété est **reliée explicitement** à sa variable d'environnement. C'est le choix de
RssArchiver, et il évite toute question de liaison relâchée (`curation-worker.enabled`, `kew.api-key`
contiennent des tirets que la convention `SOCLE_EDITORIAL_*` ne reproduit pas à l'identique).

Les blocs `socle.ai.*` et `socle.comm.*` (schéma, fournisseurs LLM et e-mail) se configurent selon
[[howto-ai-01-integrer-le-pack|AI-01]] et [[howto-com-01-integrer-le-pack|COM-01]]. Les trois
packs peuvent partager le schéma de l'application, comme chez RssArchiver
(`schema: ${DB_SCHEMA:schema_rssarchiver}` pour ai, comm et editorial).

---

## 8. Étape 6 — Secrets et variables d'environnement

| Variable | Rôle | Source recommandée |
|---|---|---|
| `SOCLE_EDITORIAL_KEW_API_KEY` | clé APIM `X-API-Key` vers KEW (enrichissement, [[howto-editorial-04-enrichir-les-articles-publies\|EDITORIAL-04]]) | clé APIM provisionnée pour l'app — [[howto-39-provisionner-une-cle-apim-pour-une-app\|HOWTO 39]] |
| `SOCLE_EDITORIAL_NEWSLETTER_UNSUBSCRIBE_SECRET` | secret HMAC-SHA256 des jetons de désabonnement | Vault, chemin de l'app |
| `APP_BASE_URL` | URL publique, injectée dans le lien de désabonnement | manifeste |
| clés LLM / e-mail | pack-ai, pack-comm | voir leurs HOWTO 01 |

Pose sur le Hub, puis propagation au conteneur :

```bash
HUB=https://admin.thesocle.net
CLE_IAM=...   # clé d'API IAM (iam_worker.create_api_key)

curl -s -X POST "$HUB/api/actions/vault_worker/set_secret" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" \
  -d '{"path":"apps/monapp/editorial","key":"unsubscribe_secret","value":"'"$(openssl rand -hex 32)"'"}'

curl -s -X POST "$HUB/api/actions/docker_worker/set_env_var" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" \
  -d '{"app_id":"monapp","key":"SOCLE_EDITORIAL_KEW_API_KEY","value":"apim_prod_…"}'

# Les variables ne se propagent qu'à la recréation du conteneur
curl -s -X POST "$HUB/api/actions/docker_worker/update_app" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" \
  -d '{"app_id":"monapp","new_tag":"1.0.0"}'
```

---

## 9. Étape 7 — Ce qui est obligatoire, ce qui est facultatif

Lu dans les constructeurs (`@Autowired(required = false)` = facultatif) :

| Bean | Utilisé par | Absent ⇒ |
|---|---|---|
| `GenerationWorker` (ai) | `CurationWorker` (**requis**), `NewsletterWorker` (facultatif) | **échec du démarrage** si `curation-worker.enabled=true` ; newsletter sans intro IA |
| `ClassificationWorker` (ai) | `CurationWorker` | rien : le score passe par `GenerationWorker` |
| `RagWorker`, `FiveW1HService`, `TranslationService`, `WebWorker` (ai) | curation | l'enrichissement correspondant est sauté |
| `NotifyWorker` (comm) | `HitlWorker`, `NewsletterWorker` | aucune relance HITL ; `send_test`/`send_now` en échec ; `newsletter_worker` **unhealthy** |

Deux corrections à [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]] :
- l'absence du **jar** ai ou comm ne donne pas un « mode dégradé silencieux » : c'est un
  `NoClassDefFoundError` au démarrage, les classes du pack les importent ;
- le message « `Editorial: dependencies OK (ai, com)` » n'existe pas dans le code. Le signal réel est
  la ligne `initialize` de chaque worker (§10).

---

## 10. Vérifier

**Journal de démarrage** (`docker_worker.get_logs`) — lignes émises par le pack :

```
[worker:pack-migration] Found 14 DDL scripts for socle-pack-editorial
[worker:pack-migration] all migrations applied successfully
[curation-config] loaded 4 configs
[hitl-config] loaded 1 configs
[worker:rss_collect_worker] poller started (interval=60s, 3 fils de collecte, politesse 1500 ms/hôte)
[worker:curation_worker] initialized — RAG ingestion available: true
[worker:hitl_worker] initialized (timeout check every 15min, notify=true)
[worker:newsletter_worker] initialized — intro AI available: true, email available: true
```

`loaded 4 configs` = les lignes `default`, `rss`, `newsletter`, `communique` de `z_curation_config`
créées par `V999` + `V999z`.

**Migrations en base :**

```sql
SELECT version, script_name, executed_at
FROM public.z_pack_migrations
WHERE pack_id = 'socle-pack-editorial'
ORDER BY version;
-- 14 lignes : V000 … V011, V999, V999z
```

**Actions joignables depuis le Hub** (fonctionne quelle que soit la version de socle de l'app) :

```bash
curl -s -X POST "$HUB/api/actions/mcp_proxy_worker/mcp_proxy_refresh" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" -d '{}'

curl -s -X POST "$HUB/api/actions/mcp_proxy_worker/mcp_proxy_invoke" \
  -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" \
  -d '{"tool":"monapp__rss_collect_worker__get_stats","params":"{}"}'
```

`params` est une **chaîne JSON**, et `tool` le nom complet `<app>__<worker>__<action>`. Les HOWTO
suivants utilisent cette fonction shell :

```bash
editorial() {   # editorial <worker>__<action> '<json>'
  local args; args=$(printf '%s' "$2" | jq -Rs .)
  curl -s -X POST "$HUB/api/actions/mcp_proxy_worker/mcp_proxy_invoke" \
    -H "X-Api-Key: $CLE_IAM" -H "Content-Type: application/json" \
    -d "{\"tool\":\"monapp__$1\",\"params\":$args}"
}
editorial rss_collect_worker__get_status '{}'
```

**Status Dashboard** : `/dashboard` de l'app, en-tête `X-Admin-Key`. Les quatre workers y figurent.

---

## 11. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Premier démarrage sur schéma vide | 14 lignes dans `z_pack_migrations`, 8 tables dans le schéma |
| 2 | Redémarrage | aucune migration rejouée ; pas de `checksum mismatch` |
| 3 | `rss_collect_worker__get_status` | `{"worker":"rss_collect_worker","running":true}` |
| 4 | `curation_worker__get_curation_config` | seuils `70` / `30`, `scoring_prompt_id = classify_generic` |
| 5 | `curation-worker.enabled=false` puis redémarrage | `curation_worker` absent des actions ; `CurationConfigService` toujours injectable |
| 6 | Retirer le jar pack-comm du build | démarrage en échec `NoClassDefFoundError: eu/lmvi/socle/pack/comm/NotifyWorker` |

---

## 12. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| App sur Spring Boot 4 / socle 5.8+ | incompatibilités au démarrage : le pack est bâti sur Boot 3.2.1 / socle 5.7.4 | rester sur la lignée Boot 3.2.1 ; une version Boot 4 du pack n'existe pas encore |
| Chercher le pack sur `maven.thesocle.net` | `Could not find artifact eu.lmvi:socle-pack-editorial:1.0.0-SNAPSHOT` | `mvn install` depuis `main`, puis vendoriser dans `mvn-repo/` (§3) |
| Branche `master` du dépôt | code différent : `master` porte 28 commits absents de `main` | construire depuis `main` (`fffd6f9`) |
| Homonyme `APP-RAG-INDEPENDANT/02-sources/domain-pack-editorial` | **mêmes coordonnées Maven**, code plus ancien (socle 5.2.0) : un `mvn install` depuis ce dossier écrase le bon jar dans `~/.m2` | n'installer que depuis `socle-pack-Editorial` |
| Pas de `FullyQualifiedAnnotationBeanNameGenerator` | `ConflictingBeanDefinitionException` sur `tenantResolver` / `packMigrationRunner` | §5 |
| Schéma absent | `Migration V001__create_source_and_raw_item.sql failed` | `CREATE SCHEMA` avant le démarrage |
| Pas de droit sur `pgcrypto` ou sur `public` | échec de `V000__init.sql` | §6 |
| `GenerationWorker` non instancié (pack-ai mal configuré) | `UnsatisfiedDependencyException` sur `CurationWorker` | configurer pack-ai, ou `curation-worker.enabled=false` |
| `curation_worker` gardé alors que l'app cure autrement | `total_curated = 0` lu comme une panne ; `curate_pending` encore appelable par MCP | `SOCLE_EDITORIAL_CURATION_WORKER_ENABLED=false` (cas RssArchiver) |
| Dashboard « stopped » pour `curation_worker` et `newsletter_worker` | leurs `getStats()` n'écrivent pas de clé `running` ; le tableau de bord du socle ≤ 5.9.4 n'affiche « running » que sur cette clé | lire `get_status` / les journaux ; ce n'est pas un arrêt |
| `newsletter_worker` unhealthy sans `NotifyWorker` | redémarrages répétés par le superviseur, journaux bruyants | intégrer pack-comm avec `NotifyWorker` actif |
| README : « 35 actions », version `1.0.0` dans `socle-pack.json` | écarts avec le code | le code fait foi : 31 actions, artefact `1.0.0-SNAPSHOT` |
| Appeler `/api/actions/<worker>/<action>` **sur l'app** (exemples du README) | 404 sur les apps récentes : c'est une porte du Hub | passer par `mcp_proxy_invoke` du Hub, ou `POST /mcp` sur l'app |

---

## 13. Pour aller plus loin

- [[howto-editorial-02-collecter-des-flux-rss|EDITORIAL-02 — Collecter des flux RSS]]
- [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03 — Curer et router les articles]]
- [[howto-editorial-04-enrichir-les-articles-publies|EDITORIAL-04 — Enrichir les articles publiés]]
- [[howto-editorial-05-valider-en-hitl|EDITORIAL-05 — Valider en HITL]]
- [[howto-editorial-06-envoyer-des-newsletters|EDITORIAL-06 — Envoyer des newsletters]]
- [[howto-ai-01-integrer-le-pack|pack-ai — intégrer le pack]] · [[howto-com-01-integrer-le-pack|pack-comm — intégrer le pack]]
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]] · [[howto-03-installer-une-app|HOWTO 03]] · [[howto-04-mettre-a-jour-une-app|HOWTO 04]] · [[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]]
