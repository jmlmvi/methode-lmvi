# HOWTO CONNECTORS-01 — Intégrer `socle-pack-connectors` dans une app V005

**Niveau :** Intermédiaire
**Cible :** une APP-* V005 qui doit parler à Notion, Google Drive, Stripe ou HubSpot
**Versions vérifiées au code (2026-10-28) :** `eu.lmvi:socle-pack-connectors:3.1.0` — construit contre
`socle-v005:5.10.0` (provided) et `spring-boot-starter-parent:4.1.2` ; `main` @ `69da4ab`, tag `v3.1.0`.
**App socle 5.8.x-5.9.x / Boot 4.0.6 : rester sur `3.0.0`. App Boot 3 / socle ≤ 5.7.x : `2.0.0`**,
dernière version Boot 3 (Boot 3.2.1, socle 5.7.4).
**Temps estimé :** 30 min

> Fiche générique sur les packs : [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]].
> Activation connecteur par connecteur : [[howto-connectors-02-activer-un-connecteur|CONNECTORS-02]].

---

## 1. Contexte

`socle-pack-connectors` est une bibliothèque Maven qu'une app V005 embarque pour obtenir quatre
connecteurs SaaS prêts à l'emploi : **Notion, Google Drive, Stripe, HubSpot**. Chaque connecteur est
un Worker **PASSIVE** qui expose des actions MCP/REST « bas niveau » calquées sur l'API du
fournisseur. Le pack ne porte **aucune logique métier** : l'app orchestre.

Ce que le pack apporte à l'app :

| Élément | Classe / ressource |
|---|---|
| 4 workers passifs | `NotionWorker`, `GdriveWorker`, `StripeWorker`, `HubspotWorker` |
| Services Notion réutilisables sans worker | `NotionClient`, `NotionDatabaseService`, `PropertyConverter` |
| Récepteur webhook Stripe | `StripeWebhookController` → `POST /api/webhooks/stripe` |
| Résilience commune | `ResilienceFactory` (circuit breaker + retry), `RateLimiter` |
| Journal des appels | `ConnectorLogger` → table `tr_connector_log` |
| Migrations SQL | `PackMigrationRunner` (bean `connectorsPackMigrationRunner`) → `db/connectors/V000..V002` |
| Configuration | `ConnectorsProperties`, préfixe `socle.conn.*` |

**Depuis 2.0.0, aucun connecteur n'est actif par défaut** : il faut les allumer un par un.

---

## 2. Architecture

```
┌──────────────────────── APP-* (Spring Boot, socle V005) ────────────────────────┐
│  @SpringBootApplication  (package racine eu.lmvi → balaye eu.lmvi.socle.pack.*)  │
│                                                                                  │
│  ConnectorsProperties (socle.conn.*) ──► ConnectorsActivationReport (1 ligne log)│
│                                                                                  │
│  PackMigrationRunner @PostConstruct ──► <schema>.z_pack_migrations               │
│        │                                <schema>.tr_connector_log                │
│        │                                <schema>.tr_notion_import_job            │
│                                                                                  │
│  socle.conn.notion.enabled=true  ──► NotionWorker   (+ NotionClient toujours là) │
│  socle.conn.gdrive.enabled=true  ──► GdriveWorker + GoogleAuthService            │
│  socle.conn.stripe.enabled=true  ──► StripeWorker + StripeWebhookController      │
│  socle.conn.hubspot.enabled=true ──► HubspotWorker                               │
└──────────────┬───────────────────────────────────────────────┬───────────────────┘
               │ PostgreSQL (DataSource de l'app)              │ HTTPS sortant (OkHttp)
               ▼                                               ▼
        schéma SOCLE_CONN_SCHEMA                api.notion.com · googleapis.com
                                                api.stripe.com · api.hubapi.com
```

---

## 3. Étape 1 — Rendre l'artefact résolvable

L'artefact `3.1.0` est installé dans `~/.m2` de la box de build ; il n'est vendorisé dans **aucun**
`mvn-repo/` du dépôt au 2026-10-28. Le construire puis le vendoriser dans l'app :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-Connectors
mvn clean install -DskipTests

APP=/opt/2026-TheHub4TheSocle/APP-XX-MonApp
mkdir -p $APP/mvn-repo/eu/lmvi/socle-pack-connectors/3.1.0
cp target/socle-pack-connectors-3.1.0.jar pom.xml \
   $APP/mvn-repo/eu/lmvi/socle-pack-connectors/3.1.0/
mv $APP/mvn-repo/eu/lmvi/socle-pack-connectors/3.1.0/pom.xml \
   $APP/mvn-repo/eu/lmvi/socle-pack-connectors/3.1.0/socle-pack-connectors-3.1.0.pom
```

---

## 4. Étape 2 — `pom.xml` de l'app

```xml
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
        <version>5.10.0</version> <!-- ≥ 5.10.0 ; parent spring-boot-starter-parent 4.1.2 -->
    </dependency>

    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-connectors</artifactId>
        <version>3.1.0</version> <!-- 3.0.0 pour socle 5.8.x-5.9.x / Boot 4.0.6 ; 2.0.0 pour Boot 3 -->
    </dependency>

    <!-- Le pack les déclare en scope provided : l'app doit les fournir -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-jdbc</artifactId>
    </dependency>
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
        <scope>runtime</scope>
    </dependency>
    <!-- Jackson 2 (com.fasterxml) : celui qu'utilise le pack. Boot 4 sérialise le HTTP en Jackson 3
         (tools.jackson) mais la nomenclature 4.1.2 gère toujours jackson-databind 2 ; le déclarer
         rend la dépendance explicite. -->
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
    </dependency>
</dependencies>
```

Depuis 3.1.0 le pack n'a **aucune dépendance `compile`** : `socle-v005`, `okhttp-jvm` (OkHttp 5.5.1,
amené par le socle 5.10), `spring-boot-starter-web`, `spring-boot-starter-jdbc`, `postgresql`,
`jackson-databind`, `log4j2`, `disruptor` sont en scope `provided`. **Ne pas déclarer `okhttp` 4.x dans
l'app** : depuis OkHttp 5 la variante JVM s'appelle `okhttp-jvm`, Maven ne déduplique pas deux artefacts
aux coordonnées différentes, et deux copies de `okhttp3.*` se retrouvent sur le classpath. (Jusqu'à 3.0.0,
le pack apportait lui-même `okhttp` 4.12.0 en compile.)

---

## 5. Étape 3 — Faire balayer le package du pack

Le pack ne déclare **aucune auto-configuration** (`META-INF` ne contient que `socle-pack.json`). Ses
beans sont des `@Component` ordinaires : ils n'existent que si le scan Spring couvre
`eu.lmvi.socle.pack.connectors`.

```java
package eu.lmvi.monapp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {
        "eu.lmvi.socle",                     // framework + packs (dont eu.lmvi.socle.pack.connectors)
        "eu.lmvi.monapp"                     // l'app
})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

Une `Application` placée dans le package `eu.lmvi` (modèle du CLAUDE.md) couvre déjà tout.

---

## 6. Étape 4 — `application.yml`

```yaml
spring:
  datasource:
    url: ${DB_URL:jdbc:postgresql://soclehub-postgres:5432/soclehub}
    username: ${DB_USER}
    password: ${DB_PASSWORD}

socle:
  conn:
    schema: ${SOCLE_CONN_SCHEMA:schema_monapp}        # schéma qui reçoit les tables du pack
    http-timeout-seconds: ${SOCLE_CONN_HTTP_TIMEOUT_SECONDS:30}
    notion:
      enabled: ${SOCLE_CONN_NOTION_ENABLED:false}
      api-key: ${SOCLE_CONN_NOTION_API_KEY:}
    gdrive:
      enabled: ${SOCLE_CONN_GDRIVE_ENABLED:false}
      credentials-json: ${SOCLE_CONN_GDRIVE_CREDENTIALS_JSON:}
      delegated-user: ${SOCLE_CONN_GDRIVE_DELEGATED_USER:}
    stripe:
      enabled: ${SOCLE_CONN_STRIPE_ENABLED:false}
      secret-key: ${SOCLE_CONN_STRIPE_SECRET_KEY:}
      webhook-secret: ${SOCLE_CONN_STRIPE_WEBHOOK_SECRET:}
    hubspot:
      enabled: ${SOCLE_CONN_HUBSPOT_ENABLED:false}
      api-key: ${SOCLE_CONN_HUBSPOT_API_KEY:}
```

Les noms `SOCLE_CONN_*` fonctionnent aussi sans ce bloc, par le *relaxed binding* de Spring Boot
sur `@ConfigurationProperties(prefix = "socle.conn")`. Le bloc explicite rend la configuration
lisible et fixe les défauts.

---

## 7. Étape 5 — Le schéma PostgreSQL

Au démarrage, `PackMigrationRunner` (bean `connectorsPackMigrationRunner`, `@PostConstruct`) :

1. crée `<schema>.z_pack_migrations` (clé `pack_id, version`) ;
2. joue dans l'ordre `classpath*:db/connectors/V*.sql` en substituant `${connectors_schema}` ;
3. enregistre chaque version avec son SHA-256 ; un script déjà joué dont le checksum change est
   **ignoré** avec un `WARN`, jamais rejoué.

| Script | Contenu |
|---|---|
| `V000__init.sql` | fonctions `update_changed_fields()`, `z_after_insert/update/delete()` dans le schéma cible |
| `V001__create_connector_log.sql` | `tr_connector_log` + séquence + 4 index + 4 triggers |
| `V002__create_notion_import_job.sql` | `tr_notion_import_job` + séquence + 2 index + 4 triggers |

Le runner **ne crée pas le schéma**. Le créer avant le premier démarrage (ou laisser
`db_worker.create_app_schema` du Hub le faire) :

```sql
CREATE SCHEMA IF NOT EXISTS schema_monapp AUTHORIZATION monapp_user;
```

Les migrations tournent **même si aucun connecteur n'est activé**.

---

## 8. Étape 6 — Poser les secrets sur le conteneur

En 2.0.0, les identifiants sont lus dans les propriétés `socle.conn.*` — donc dans les variables
d'environnement du conteneur (détail et raison : [[howto-connectors-03-gerer-les-identifiants|CONNECTORS-03]]).
Sur le Hub, `docker_worker.set_env_var` les persiste (Vault `soclehub/apps/<appId>/env`) et les
réinjecte à chaque redémarrage :

```bash
HUB=https://admin.thesocle.net
for kv in "SOCLE_CONN_SCHEMA=schema_monapp" \
          "SOCLE_CONN_NOTION_ENABLED=true" \
          "SOCLE_CONN_NOTION_API_KEY=secret_xxxxxxxx"; do
  curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
    -X POST $HUB/api/actions/docker_worker/set_env_var \
    -d "{\"app_id\":\"monapp\",\"key\":\"${kv%%=*}\",\"value\":\"${kv#*=}\"}"
done
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST $HUB/api/actions/docker_worker/restart_app -d '{"app_id":"monapp"}'
```

---

## 9. Vérifier

**1. La ligne d'activation au démarrage** (`ConnectorsActivationReport`) :

```
[connectors] actifs : notion — inactifs : gdrive, stripe, hubspot (activer : socle.conn.<connecteur>.enabled=true)
```

**2. Les migrations :**

```
[worker:pack-migration] Found 3 DDL scripts for socle-pack-connectors
[worker:pack-migration] all migrations applied successfully
```

```sql
SELECT pack_id, version, script_name, executed_at
FROM schema_monapp.z_pack_migrations WHERE pack_id = 'socle-pack-connectors' ORDER BY version;
-- V000, V001, V002
```

**3. Le worker au dashboard et en REST** (routes `AdminRestApi` du socle, en-tête `X-Admin-Key`) :

```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:8080/admin/workers/notion_worker/actions
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/admin/workers/notion_worker/actions/test_connection -d '{}'
# → {"success":true,"data":{"connected":true,"bot_id":"…","bot_name":"…"}, …}
```

`http://localhost:8080/dashboard` affiche `notion_worker` ; `getStats()` y publie `worker`,
`configured`, `total_calls`.

---

## 10. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Démarrer sans aucune variable `SOCLE_CONN_*_ENABLED` | Ligne `actifs : aucun` ; aucun worker connecteur au dashboard ; tables créées |
| 2 | `SOCLE_CONN_NOTION_ENABLED=true` + clé | `notion_worker` présent, `configured=true` |
| 3 | Redémarrer | `z_pack_migrations` inchangée ; aucun script rejoué |
| 4 | Schéma absent | Échec au démarrage `Migration V000__init.sql failed` |
| 5 | `test_connection` | `connected: true` |

Tests du pack : `DemarrageContexteSpringTest` (vrai contexte Boot 4.1.2 + socle 5.10.0 + PostgreSQL
Testcontainers : les quatre workers, leurs actions, les tables et la version de Boot comparés au
manifeste), `ConnectorsActivationTest` (contrat d'activation, 5 cas), `NotionResultatJackson3Test`
(résultats Notion écrits en Jackson 3), `StripeWebhookBoot4Test` (webhook signé sous Boot 4) —
10 tests, 0 sauté, `mvn verify` vert (Docker requis).

---

## 11. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Monter de 1.x à 2.0.0 sans `enabled: true` | Les workers disparaissent sans erreur | `SOCLE_CONN_<CONNECTEUR>_ENABLED=true` pour chaque connecteur utilisé |
| Package du pack hors du scan | Aucune ligne `[connectors]`, aucune table créée | `scanBasePackages` couvrant `eu.lmvi.socle` |
| Schéma inexistant | `IllegalStateException: Migration V000__init.sql failed` — l'app ne démarre pas | `CREATE SCHEMA` avant le premier boot |
| DataSource absente ou H2 | Échec du runner (fonctions `plpgsql`, `TIMESTAMPTZ`, `JSONB`) | PostgreSQL ≥ 14 obligatoire |
| Modifier un `V00x` déjà joué | `checksum mismatch … skipping` : la modification n'est jamais appliquée | Nouveau script `V003__…` |
| Suivre les `curl` du README du pack | `POST /api/actions/notion_worker__…` rend 404 sur une app | `POST /admin/workers/<worker>/actions/<action>` (`X-Admin-Key`) ou `POST /mcp` |
| Prendre une version du pack bâtie sur un autre Boot que le socle de l'app | Compile, puis casse à l'exécution (classes Spring absentes ou déplacées) | Socle 5.10.x / Boot 4.1.2 → **3.1.0** ; socle 5.8.x-5.9.x / Boot 4.0.6 → **3.0.0** ; Boot 3 → **2.0.0**. Le manifeste dit vrai (`minSocleVersion`, `springBootVersion`), vérifié par `DemarrageContexteSpringTest` depuis 3.1.0 |
| Pack 3.0.0 (ou app déclarant `okhttp` 4.x) avec socle 5.10 | Deux copies de `okhttp3.*` / okio sur le classpath ; `NoSuchMethodError` ou comportement selon l'ordre du classpath | Pack **3.1.0** (OkHttp fourni par le socle, `okhttp-jvm` 5.5.1) ; retirer `okhttp` 4.x du pom de l'app |
| `@Qualifier("packMigrationRunner")`, `"vaultCredentialResolver"`, `"notionWorker"`… dans l'app | `NoSuchBeanDefinitionException` après passage en 3.1.0 | Noms préfixés `connectors*` depuis 3.1.0 (tableau dans le README du kit) ; mieux : injecter par type. Ce préfixe évite la collision avec les beans homonymes d'autres packs (`PackMigrationRunner` de pack-ai/comm/pipeline, `NotionWorker` d'APP-04) |
| Placer un `JsonNode` Jackson 2 (`com.fasterxml`) dans une réponse ou un `@RequestBody` côté app | `500` ou JSON méconnaissable : Boot 4 et le serveur MCP du socle écrivent en Jackson 3 | Lire le corps en `String`, rendre des `Map`/`List`. Le pack lui-même est conforme depuis 3.0.0 (en 2.0.0 sur socle ≥ 5.8, `get_page` et `get_database_full` sortaient faux) |
| Compter 53 actions (README avant 3.0.0) | Le code en expose **54** | Manifeste corrigé en 3.0.0 (`create_database` ajouté) ; `GET /admin/workers/notion_worker/actions` fait foi |

---

## 12. Pour aller plus loin

- [[howto-connectors-02-activer-un-connecteur|CONNECTORS-02 — Activer un connecteur]]
- [[howto-connectors-03-gerer-les-identifiants|CONNECTORS-03 — Identifiants : env, Vault]]
- [[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10 — Résilience et journal]]
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28 — Intégrer un socle-pack]]
- [[howto-04-mettre-a-jour-une-app|HOWTO 04 — Mettre à jour une app]] (`set_env_var`)
