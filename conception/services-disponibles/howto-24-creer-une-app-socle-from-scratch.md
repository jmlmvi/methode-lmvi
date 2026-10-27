# HOWTO 24 — Créer une application Socle V005 de A à Z

> **Niveau** : intermédiaire | **Prérequis** : Java 21 GraalVM CE installé, Maven 3.9+, Docker & Docker Compose, accès au repo `git@github.com:jmlmvi/V005-packs.git` | **Temps estimé** : 2-4 h pour un MVP fonctionnel

Ce guide montre comment **créer une nouvelle application Socle V005 from scratch** côté développeur, du dossier vide jusqu'au tarball livrable déposé dans `livraison/`. Il couvre la structure de projet, le `pom.xml`, le squelette Java, le choix du template Worker, le `manifest.json`, le frontend React optionnel, le Dockerfile, le build et le packaging final. Une fois le tarball produit, l'installation côté Hub est traitée par `howto-03-installer-une-app.md`.

---

## 1. Contexte

Sur un Hub multi-tenant, chaque application métier (CNX2Notion, OfficeV2, Lanceur…) est un **projet Spring Boot autonome** qui dépend du framework `eu.lmvi:socle-v005`. L'app expose ses workers via REST/MCP, persiste ses données dans une base provisionnée par le Hub, écoute les bus internes, et se présente au navigateur via une UI Thymeleaf ou un SPA React. Le Hub fournit les briques transverses (SSO, IAM, DNS, TLS, Vault, proxy, cache) — l'app n'a pas à les ré-implémenter.

Pour qu'une app soit installable par le pipeline `docker_worker/install_app` (cf. howto-03), elle doit produire **un livrable au format tarball** contenant : le JAR exécutable, le `Dockerfile`, le `manifest.json`, les éventuelles migrations SQL et un `repository/` (scripts Janino + decisions JDM si utilisés). C'est ce livrable que l'admin Hub uploade ou que le `RepositoryEditorWorker` publie pour les Hubs clients.

L'objectif de ce HOWTO est de produire ce livrable sans rien oublier. La structure cible est :

```
APP-NN-NomApp/
├── nomapp/                   ← code source de l'application (modifiable)
│   ├── pom.xml
│   ├── manifest.json
│   ├── Dockerfile (dans docker/)
│   ├── src/main/java/eu/lmvi/...
│   ├── src/main/resources/   (application.yml, static/, templates/)
│   ├── frontend/             (Vite + React, optionnel)
│   ├── lib/                  (socle-v005-X.Y.Z.jar + drivers JDBC)
│   ├── sql/                  (init.sql, migrations)
│   ├── repository/           (scripts/java, decisions)
│   ├── templates/            (templates Java fournis par le framework)
│   └── target/               (sortie Maven, gitignored)
├── docs/                     (PLAN.md, SPEC.md, MIGRATION-*.md)
└── livraison/                ← cible des tarballs livrés (vide au départ)
```

---

## 2. Architecture

```
                ┌─────────────────────────────────────────────────────┐
                │             Développeur d'app (vous)                │
                │                                                     │
                │   1. crée APP-NN-NomApp/nomapp/                     │
                │   2. installe socle-v005-X.Y.Z.jar dans ~/.m2       │
                │   3. code Application.java + Workers + manifest     │
                │   4. mvn clean package -DskipTests                  │
                │   5. tar czf livraison/<app>-X.Y.Z.tar.gz ...       │
                └────────────────────────┬────────────────────────────┘
                                         │
                                         ▼
                ┌─────────────────────────────────────────────────────┐
                │   Tarball livrable — contenu requis par le Hub      │
                │                                                     │
                │   ├── manifest.json         (catalog Hub)           │
                │   ├── Dockerfile            (buildFromDockerfile)   │
                │   ├── target/<app>-X.Y.Z-exec.jar                   │
                │   ├── lib/drivers/*.jar     (PG/MariaDB/MySQL)      │
                │   ├── sql/init.sql          (DDL initial)           │
                │   └── repository/           (scripts + decisions)   │
                └────────────────────────┬────────────────────────────┘
                                         │
                                         ▼
                ┌─────────────────────────────────────────────────────┐
                │  Hub admin — pipeline docker_worker/install_app     │
                │  (cf. howto-03-installer-une-app.md, 6 stages)      │
                └─────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Créer l'arborescence

Choisir le numéro `NN` libre (suivant les `APP-XX-*` existants à la racine du repo) et le nom kebab-case de l'app (ex. `cnx2notion`, `office-v2`).

```bash
APP_DIR=/opt/2026-TheHub4TheSocle/APP-05-MonApp
APP_NAME=monapp

mkdir -p "$APP_DIR/$APP_NAME"/{src/main/java/eu/lmvi,src/main/resources,docker,sql,lib/drivers,repository/scripts/java,repository/decisions,templates}
mkdir -p "$APP_DIR"/{docs,livraison}

cd "$APP_DIR/$APP_NAME"
```

Récupérer le JAR + POM du framework depuis le repo `V005-packs` (ou un StarterPack récent) :

```bash
# Depuis V005-packs (toujours à jour)
SOCLE_VERSION=5.6.0
cp /opt/2026-TheHub4TheSocle/V005-packs/V005-StarterPack-v$SOCLE_VERSION/lib/socle-v005-$SOCLE_VERSION.jar lib/
cp /opt/2026-TheHub4TheSocle/V005-packs/V005-StarterPack-v$SOCLE_VERSION/lib/socle-v005-$SOCLE_VERSION.pom lib/

# Drivers JDBC standards
cp /opt/2026-TheHub4TheSocle/V005-packs/V005-StarterPack-v$SOCLE_VERSION/lib/drivers/*.jar lib/drivers/
```

Installer le JAR framework dans le repo Maven local (une seule fois par version) :

```bash
mvn install:install-file \
  -Dfile=lib/socle-v005-$SOCLE_VERSION.jar \
  -DpomFile=lib/socle-v005-$SOCLE_VERSION.pom \
  -DgroupId=eu.lmvi -DartifactId=socle-v005 \
  -Dversion=$SOCLE_VERSION -Dpackaging=jar
# → installe eu.lmvi:socle-v005:5.6.0 dans ~/.m2/
```

---

## 4. Étape 2 — `pom.xml`

Fichier `pom.xml` minimal, à adapter selon les besoins (DB, frontend, parsing markdown, etc.) :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>eu.lmvi</groupId>
    <artifactId>monapp</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.1</version>
        <relativePath/>
    </parent>

    <properties>
        <java.version>21</java.version>
        <maven.compiler.source>21</maven.compiler.source>
        <maven.compiler.target>21</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <socle.version>5.6.0</socle.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>eu.lmvi</groupId>
            <artifactId>socle-v005</artifactId>
            <version>${socle.version}</version>
        </dependency>

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
            <groupId>com.lmax</groupId>
            <artifactId>disruptor</artifactId>
            <version>3.4.4</version>
        </dependency>

        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
        </dependency>

        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-jdbc</artifactId>
        </dependency>

        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <version>42.7.1</version>
            <scope>provided</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <classifier>exec</classifier>
                    <mainClass>eu.lmvi.Application</mainClass>
                    <layout>ZIP</layout>
                </configuration>
                <executions>
                    <execution>
                        <goals><goal>repackage</goal></goals>
                    </execution>
                </executions>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <source>21</source>
                    <target>21</target>
                    <parameters>true</parameters>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

**Points clés** :

- `groupId` = `eu.lmvi` (convention projet — jamais `com.example`),
- `<layout>ZIP</layout>` active `PropertiesLauncher` → permet `-Dloader.path=/app/lib` pour les drivers JDBC externes,
- les drivers JDBC sont en `scope=provided` : pas dans le JAR, chargés à l'exécution depuis `lib/drivers/`,
- toujours exclure `spring-boot-starter-logging` (Logback) — V005 utilise Log4j2.

---

## 5. Étape 3 — `Application.java`

`src/main/java/eu/lmvi/Application.java` :

```java
package eu.lmvi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {
    "eu.lmvi.socle",  // framework — OBLIGATOIRE, sinon le MOP ne démarre pas
    "eu.lmvi"         // votre application
})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

**Sans `eu.lmvi.socle` dans `scanBasePackages`, le MOP ne se lance pas — aucun Worker n'apparaît, aucune erreur visible.** C'est le piège #1 historique.

`src/main/resources/application.yml` minimal :

```yaml
server:
  port: 8080

spring:
  application:
    name: monapp

socle:
  techdb:
    path: ${TECHDB_PATH:/app/data/techdb}
  repository:
    path: ${REPOSITORY_PATH:/app/repository}
  mcp:
    enabled: ${MCP_ENABLED:true}
    mode: ${MCP_MODE:http}

# Datasource — décommenter si l'app a besoin d'une DB
# spring:
#   datasource:
#     url: ${DATABASE_URL}
#     username: ${DATABASE_USER}
#     password: ${DATABASE_PASSWORD}
#     driver-class-name: org.postgresql.Driver
```

`src/main/resources/log4j2-spring.xml` : copier depuis n'importe quel StarterPack (`docs/01-docsV2/institutional/150-logging-log4j2.md` détaille les variantes).

---

## 6. Étape 4 — Choisir un template Worker

Le framework V005 fournit ~17 templates dans `templates/workers/`. Référence : `docs/01-docsV2/agent-guide/02-task-decision-tree.md`.

Arbre de décision rapide :

```
Mon Worker doit faire quoi ?
│
├─ Appeler une API externe (HTTP, DB distante)
│   └─> AbstractGatewayWorker (circuit breaker + retry inclus)
├─ Tâche répétée toutes les N ms
│   └─> SimplePollingWorker
├─ Tâche cron à heure fixe
│   └─> CronWorker
├─ Piloté UNIQUEMENT par appels MCP/REST
│   └─> AbstractPassiveWorker + ActionProvider
├─ Réagir à des événements internes (KvBus)
│   └─> AbstractEventDrivenWorker + take()
├─ Recevoir des webhooks HTTP
│   └─> @RestController + AbstractPassiveWorker
└─ Pages HTML servies sur port dédié
    └─> HtmlServerWorker
```

Exemple : un worker passif simple piloté par MCP/REST (`src/main/java/eu/lmvi/workers/MonAppWorker.java`) :

```java
package eu.lmvi.workers;

import eu.lmvi.socle.actions.ActionDescriptor;
import eu.lmvi.socle.actions.ActionParameters;
import eu.lmvi.socle.actions.ActionResult;
import eu.lmvi.socle.workers.AbstractPassiveWorker;
import org.springframework.stereotype.Component;
import java.util.List;
import java.util.Map;

@Component
public class MonAppWorker extends AbstractPassiveWorker {

    @Override
    public String getName() { return "monapp_worker"; }

    @Override
    public int getPriority() { return 50; }

    @Override
    public List<ActionDescriptor> getActionDescriptors() {
        return List.of(
            ActionDescriptor.builder()
                .name("ping")
                .description("Vérifie que le worker répond")
                .build()
        );
    }

    @Override
    public ActionResult executeAction(String name, ActionParameters params) {
        if ("ping".equals(name)) {
            return ActionResult.success(Map.of("pong", System.currentTimeMillis()));
        }
        return ActionResult.error("Unknown action: " + name);
    }
}
```

Règles **absolues** sur les Workers (cf. `agent-guide/03-regles-absolues.md`) :

1. **1 Worker = 1 fichier Java**,
2. `kvBus.sub()` **uniquement dans `initialize()`**, jamais ailleurs,
3. **Jamais** `new Thread()`, `while(true)`, `@Scheduled` dans un Worker,
4. **Jamais** `throws Exception` sur les méthodes de l'interface Worker,
5. **Toujours** `@Component` + injection par constructeur.

---

## 7. Étape 5 — `manifest.json`

C'est le fichier que le Hub lit pour cataloguer l'app, savoir quelle DB provisionner, quelles env vars injecter, quels rôles IAM créer. Il est **lu par `AppRegistryWorker.list_catalog`** côté Hub.

```json
{
  "manifestVersion": "1.0",
  "appId": "monapp",
  "name": "Mon Application V005",
  "description": "Description courte de l'app",
  "version": "1.0.0",
  "appType": "thesocle",
  "framework": "socle-v005",
  "docker": {
    "buildFromDockerfile": true,
    "portInternal": 8080,
    "healthCheckPath": "/admin/health",
    "minMemoryMb": 512,
    "volumes": [
      { "name": "data", "containerPath": "/app/data" }
    ]
  },
  "database": {
    "type": "postgres"
  },
  "sso": {
    "mode": "required",
    "authIntegration": "soclehub-jwt"
  },
  "iam": {
    "roles": [
      { "name": "app:monapp:user",  "description": "Utilisateur monapp" },
      { "name": "app:monapp:admin", "description": "Admin monapp" }
    ],
    "scopes": [
      { "name": "app:monapp", "description": "Accès à monapp", "assignToRole": "app:monapp:user" }
    ]
  },
  "mcp": {
    "enabled": true,
    "mode": "http",
    "endpoint": "/mcp"
  },
  "env": {
    "required": [],
    "optional": [
      { "name": "LOG_LEVEL", "description": "Niveau de log", "defaultValue": "INFO" }
    ],
    "injectedBySoclehub": [
      "DATABASE_URL", "DATABASE_USER", "DATABASE_PASSWORD",
      "VAULT_ADDR", "VAULT_TOKEN", "IAM_JWKS_URL",
      "APP_ID", "APP_BASE_URL", "SOCLEHUB_URL", "SOCLEHUB_API_KEY"
    ]
  },
  "categories": ["metier", "v005"],
  "subdomain": "monapp",
  "dbSchema": "schema_monapp",
  "initScript": "sql/init.sql",
  "postInstallMessage": "monapp déployée. Ouvrir https://monapp.thesocle.net pour configurer."
}
```

**Règles strictes** :

- `appId` : `^[a-z0-9-]+$` (devient `container_name`, schéma DB, path Vault),
- `database.type` ∈ `{ postgres, mysql, mariadb, none }`,
- `sso.mode` ∈ `{ none, optional, gate, required }`,
- les env vars listées dans `injectedBySoclehub` sont automatiquement remplies par le pipeline d'install (cf. howto-03 §7 sur l'autofill).

---

## 8. Étape 6 — Frontend (optionnel)

Si l'app a une UI métier complète, partir du **V005-FrontendShell** (vendoré V002 + 9 thèmes + Phosphor + Plus Jakarta Sans + ThemePalette) :

```bash
SHELL_VERSION=3.0.1
mkdir -p frontend && cd frontend
tar xzf /opt/2026-TheHub4TheSocle/V005-packs/V005-FrontendShell-v$SHELL_VERSION.tar.gz \
  --strip-components=1
cd ..
```

Build :

```bash
cd frontend
export NODE_OPTIONS="--max-old-space-size=4096"
npm install --legacy-peer-deps
npm run build
# → src/main/resources/static/ peuplé (le JAR final embarque le SPA)
cd ..
```

Côté Java, ajouter les 2 templates fournis :

- `src/main/java/eu/lmvi/SpaForwardController.java` — route les chemins frontend vers `index.html`,
- `src/main/java/eu/lmvi/SsoAuthFilter.java` — lit les headers `X-SSO-User` / `X-SSO-Email` injectés par le proxy Hub.

Règles frontend **non négociables** (cf. `frontend-guide/04-regles-absolues.md`) :

- Police : `var(--font-sans)` (Plus Jakarta Sans) — jamais Inter,
- Icônes : `@phosphor-icons/react` uniquement — jamais lucide-react,
- Couleurs : `var(--xxx)` uniquement — zéro hex dans les `.tsx`,
- `manualChunks` dans `vite.config.ts` **obligatoire** (sinon OOM au build),
- `--legacy-peer-deps` obligatoire à `npm install`.

Pour les apps avec UI simple (status, debug), préférer un `HtmlServerWorker` Thymeleaf — moins de complexité, pas de toolchain Node.

---

## 9. Étape 7 — Dockerfile + docker-compose

`docker/Dockerfile` :

```dockerfile
FROM container-registry.oracle.com/graalvm/community:21
# Alternative si Oracle registry indisponible :
# FROM ghcr.io/graalvm/graalvm-community:21.0.2

WORKDIR /app
RUN mkdir -p /app/data /app/repository/scripts/java /app/repository/decisions /app/lib

COPY target/monapp-1.0.0-exec.jar /app/app.jar
COPY lib/drivers/ /app/lib/
COPY repository/ /app/repository/

EXPOSE 8080 9374

ENV SOCLE_ENV=PROD
ENV TECHDB_PATH=/app/data/techdb
ENV REPOSITORY_PATH=/app/repository
ENV MCP_ENABLED=true
ENV MCP_MODE=http

ENTRYPOINT ["java", \
  "-Dloader.path=/app/lib", \
  "-XX:+UseG1GC", \
  "-XX:MaxGCPauseMillis=50", \
  "-Xms256m", "-Xmx1g", \
  "-jar", "/app/app.jar"]
```

`docker/docker-compose.dev.yml` (PostgreSQL local + pgAdmin pour le dev) :

```yaml
services:
  postgres-dev:
    image: postgres:17
    container_name: monapp-postgres-dev
    environment:
      POSTGRES_DB: monapp_dev
      POSTGRES_USER: devuser
      POSTGRES_PASSWORD: devpass
    ports:
      - "5432:5432"
    volumes:
      - monapp_pg:/var/lib/postgresql/data

  pgadmin-dev:
    image: dpage/pgadmin4
    container_name: monapp-pgadmin-dev
    environment:
      PGADMIN_DEFAULT_EMAIL: dev@localhost
      PGADMIN_DEFAULT_PASSWORD: dev
    ports:
      - "5050:80"

volumes:
  monapp_pg:
```

Le `docker/docker-compose.yml` de production n'est généralement pas embarqué dans le tarball (le Hub orchestre lui-même via `DockerWorker`).

---

## 10. Étape 8 — `sql/init.sql`

Si l'app a une DB Postgres provisionnée par le Hub, elle reçoit un schéma vide (ex. `schema_monapp`). Le script `sql/init.sql` est exécuté automatiquement au premier démarrage par le worker `postgresql_database` (cf. `institutional/191-postgresql-database-worker.md`).

```sql
-- sql/init.sql
SET search_path TO schema_monapp, public;

CREATE TABLE IF NOT EXISTS schema_monapp.tr_event (
    x_id          BIGSERIAL PRIMARY KEY,
    x_dateCreated TIMESTAMP NOT NULL DEFAULT now(),
    x_dateChanged TIMESTAMP NOT NULL DEFAULT now(),
    x_userCreated TEXT NOT NULL DEFAULT 'system',
    x_userChanged TEXT NOT NULL DEFAULT 'system',
    event_type    TEXT NOT NULL,
    payload       JSONB
);

CREATE INDEX IF NOT EXISTS idx_tr_event_type ON schema_monapp.tr_event (event_type);
```

Conventions THESOCLE des tables (cf. `feedback_postgresql_preferred.md`) :

- préfixes `z_` (référentiel), `db_` (config), `tr_` (transactionnel),
- colonnes `x_id`, `x_dateCreated`, `x_dateChanged`, `x_userCreated`, `x_userChanged` sur toutes les tables,
- triggers d'audit `x_after_*` standards (le bootstrap `bootstrap-thesocle-standard.sql` les fournit côté Hub).

---

## 11. Étape 9 — Build local

```bash
mvn clean package -DskipTests
# → target/monapp-1.0.0-exec.jar (~150-200 Mo selon dépendances)

# Test local sans DB (juste pour vérifier que ça démarre)
java -Dloader.path=./lib/drivers -jar target/monapp-1.0.0-exec.jar
# → http://localhost:9374 (Status Dashboard) doit afficher le worker en vert
# → http://localhost:8080/admin/health doit retourner 200
```

Vérifier les workers démarrés :

```bash
curl -s http://localhost:8080/admin/workers | jq '.workers[] | {name, priority, isHealthy}'
```

Le `monapp_worker` doit apparaître avec `isHealthy: true`.

---

## 12. Étape 10 — Packager pour livraison

Créer le tarball dans `livraison/` (à la racine `APP-NN-MonApp/`, **pas** dans le sous-dossier source) :

```bash
cd /opt/2026-TheHub4TheSocle/APP-05-MonApp

VERSION=$(grep -m1 '<version>' monapp/pom.xml | sed 's/.*>\(.*\)<.*/\1/')
TARBALL="livraison/monapp-${VERSION}.tar.gz"

tar czf "$TARBALL" \
  --transform "s|^monapp/|monapp-${VERSION}/|" \
  monapp/manifest.json \
  monapp/docker/Dockerfile \
  monapp/target/monapp-${VERSION}-exec.jar \
  monapp/lib/drivers/ \
  monapp/sql/ \
  monapp/repository/

ls -lh "$TARBALL"
tar tzf "$TARBALL" | head -20
```

Le tarball type doit faire 80-200 Mo (le JAR pèse l'essentiel).

**Convention de nommage** : `<appId>-<version>.tar.gz` (ex. `cnx2notion-1.0.0.tar.gz`, `monapp-1.0.0.tar.gz`). Pour une livraison sur un Hub de production, un suffixe d'horodatage `-YYYY-MM-DD` peut être ajouté.

---

## 13. Validation

### Vérifier le contenu du tarball

```bash
tar tzf livraison/monapp-1.0.0.tar.gz
# Doit contenir au minimum :
# monapp-1.0.0/manifest.json
# monapp-1.0.0/Dockerfile
# monapp-1.0.0/target/monapp-1.0.0-exec.jar
# monapp-1.0.0/lib/drivers/postgresql-42.7.1.jar
# monapp-1.0.0/sql/init.sql
# monapp-1.0.0/repository/scripts/...
```

### Valider le `manifest.json`

```bash
jq . monapp/manifest.json
# doit parser sans erreur

# Vérifier les champs obligatoires
jq -e '.manifestVersion, .appId, .version, .appType, .framework, .docker.portInternal' monapp/manifest.json
```

### Build Docker local

```bash
cd /tmp && rm -rf test-monapp
tar xzf /opt/2026-TheHub4TheSocle/APP-05-MonApp/livraison/monapp-1.0.0.tar.gz
cd monapp-1.0.0
docker build -t monapp:1.0.0-test -f Dockerfile .
docker run --rm -p 8080:8080 -p 9374:9374 monapp:1.0.0-test
```

http://localhost:9374 doit afficher le Status Dashboard. Si OK, le tarball est prêt à être livré au Hub via `howto-03-installer-une-app.md`.

---

## 14. Pièges courants

### Piège 1 — MOP ne démarre pas, aucun worker visible

**Symptôme** : `mvn ... && java -jar ...` démarre Spring Boot sans erreur, mais `/admin/workers` est vide et le Status Dashboard est vide.

**Cause** : `Application.java` n'a pas `eu.lmvi.socle` dans `scanBasePackages`. Spring Boot scanne uniquement `eu.lmvi`, donc les composants du framework ne sont jamais instanciés.

**Résolution** :

```java
@SpringBootApplication(scanBasePackages = {"eu.lmvi.socle", "eu.lmvi"})
```

### Piège 2 — `groupId=com.example` au lieu de `eu.lmvi`

**Symptôme** : compile OK mais code incohérent avec le reste du repo.

**Cause** : copie d'un template public ou auto-généré.

**Résolution** : `eu.lmvi` est la convention non négociable de tout le projet (cf. mémoire `feedback_package_convention.md`). Adapter `pom.xml` + le package Java + `mainClass` du build plugin.

### Piège 3 — `socle-v005-X.Y.Z.jar` introuvable au build

**Symptôme** : `mvn` échoue avec `Could not find artifact eu.lmvi:socle-v005:jar:5.6.0`.

**Cause** : le JAR framework n'a pas été installé dans `~/.m2/`. Le pom.xml référence `eu.lmvi:socle-v005` mais Maven ne sait pas où le trouver.

**Résolution** :

```bash
mvn install:install-file \
  -Dfile=lib/socle-v005-5.6.0.jar \
  -DpomFile=lib/socle-v005-5.6.0.pom \
  -DgroupId=eu.lmvi -DartifactId=socle-v005 \
  -Dversion=5.6.0 -Dpackaging=jar
```

### Piège 4 — `ClassNotFoundException: org.postgresql.Driver` au runtime

**Symptôme** : l'app démarre, mais à la première requête DB → exception driver introuvable.

**Cause** : le driver est en `scope=provided` (correct), mais l'app a été lancée sans `-Dloader.path=/app/lib` (ou `./lib/drivers` en local).

**Résolution** :

```bash
java -Dloader.path=./lib/drivers -jar target/monapp-1.0.0-exec.jar
```

Et dans le Dockerfile : `-Dloader.path=/app/lib` dans l'`ENTRYPOINT`.

### Piège 5 — `manifest.json` invalide rejeté par le Hub

**Symptôme** : `install_app` échoue dès stage 1 avec `manifest validation failed: missing field X`.

**Cause** : un champ obligatoire absent ou mal typé. Liste minimale : `manifestVersion`, `appId`, `version`, `appType`, `framework`, `docker.portInternal`, `docker.buildFromDockerfile`.

**Résolution** : valider avec `jq -e '.manifestVersion, .appId, ...'`. Comparer avec un manifest d'app installée fonctionnellement (ex. `APP-04-CNX2Notion/cnx2notion/manifest.json`).

### Piège 6 — Frontend buildé OOM

**Symptôme** : `npm run build` plante avec `JavaScript heap out of memory`.

**Cause** : le bundle Vite par défaut n'a pas de `manualChunks`, donc tout est dans un seul fichier — OOM dès quelques dépendances.

**Résolution** : le `vite.config.ts` du `V005-FrontendShell` configure déjà `manualChunks`. Et exporter `NODE_OPTIONS="--max-old-space-size=4096"` avant `npm run build`.

### Piège 7 — Logback s'initialise au lieu de Log4j2

**Symptôme** : log format différent de celui des autres apps Socle, propriétés `<AsyncLogger>` ignorées.

**Cause** : `spring-boot-starter-web` n'a pas exclu `spring-boot-starter-logging` (Logback) → conflit avec Log4j2, c'est Logback qui gagne.

**Résolution** : exclure systématiquement :

```xml
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
```

### Piège 8 — Tarball trop gros (> 500 Mo)

**Symptôme** : upload vers le Hub timeout, `repository_editor_worker.publish_version` échoue.

**Cause** : on a inclus `frontend/node_modules/`, `target/` complet (avec dossiers temp), `lib/socle-v005-X.Y.Z.jar` (déjà dans le JAR exec), ou `repository/scripts/` non nettoyés.

**Résolution** : `tar czf` ne doit inclure que les fichiers strictement nécessaires (cf. §12). Vérifier la taille avec `du -sh livraison/*.tar.gz`. Cible : 80-200 Mo. Si > 250 Mo, lister `tar tzf | sort -nrk5 | head` pour identifier les gros fichiers.

### Piège 9 — DB schema pas créé au premier démarrage

**Symptôme** : l'app démarre, mais les requêtes échouent avec `relation "schema_monapp.tr_event" does not exist`.

**Cause** : le `manifest.json` ne déclare pas `initScript: "sql/init.sql"`, ou le fichier SQL contient des erreurs (mauvais search_path, GRANT à un user non créé).

**Résolution** : valider le SQL en local :

```bash
docker exec -i monapp-postgres-dev psql -U devuser -d monapp_dev < sql/init.sql
\dt schema_monapp.*
```

Et toujours utiliser `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` pour rester idempotent (le pipeline peut rerunner le script en cas de retry).

### Piège 10 — `java.lang.OutOfMemoryError` au démarrage de l'app

**Symptôme** : container démarre puis crash après 30s avec OOM, `docker logs` montre `OutOfMemoryError: Java heap space`.

**Cause** : `Dockerfile` avec `-Xms256m -Xmx1g` mais `manifest.json` déclare `minMemoryMb: 512` → le Hub démarre le container avec mémoire mal calibrée. Ou un Worker fait du charger lourd au démarrage (chargement complet d'un fichier en mémoire).

**Résolution** : aligner les deux. `manifest.json` doit déclarer `minMemoryMb >= 1024` si `-Xmx1g`. Et faire un profiling au démarrage si suspicion de pathologie :

```bash
docker run --memory=1g --rm -it monapp:1.0.0 java -XX:+PrintFlagsFinal -version | grep MaxHeapSize
```

---

## 15. Pour aller plus loin

- Voir `howto-03-installer-une-app.md` pour la suite : déployer le tarball produit sur un Hub via le pipeline d'install — réf. [[60-pipeline-install|AppInstallPipeline 6 stages]],
- Voir `howto-25-upgrader-une-app-socle.md` pour upgrader une app existante vers une nouvelle version du framework,
- Voir `howto-06-publier-une-app-editeur.md` pour publier le tarball dans un registry signé Ed25519,
- Voir [[179-app-zz-template|app-zz-template]] pour le squelette d'app de référence,
- Voir [[200-build-maven|build Maven]] (profiles, classifiers, build natif GraalVM) et [[201-deploiement-docker|déploiement Docker]],
- Voir `agent-guide/02-task-decision-tree.md` pour l'arbre complet « quel template Worker choisir »,
- Voir `agent-guide/03-regles-absolues.md` pour les règles non-négociables des Workers V005.

### Propositions futures (non implémentées)

Le dossier `V2-Specs4Appli` (archivé) contient des évolutions proposées mais pas encore en prod :

- **Mode SSO `oidc`** — proxy transparent + l'app gère elle-même OAuth2 contre le Hub (requiert un provider OIDC complet côté Hub : `/oidc/authorize`, `/oidc/token`, `/oidc/userinfo`). En attendant, utiliser `gate` ou `none` pour les apps OIDC natives (Gitea, Grafana, Nextcloud).
- **Format `manifest.json` v2.0** — `envTemplate` enrichi avec `source` (`user/system/vault/database`) et `secret: true`, `persistentDirs` top-level, placeholders dans `postInstallMessage` (`{fqdn}`, `{appId}`, `{adminEmail}`). L'implémentation actuelle utilise toujours `manifestVersion: "1.0"` avec `env.required/optional/injectedBySoclehub`.
- **Résolution réseau par nom de container** — `target_host = "soclehub-<appId>"` au lieu de l'IP, pour survivre aux restarts Docker (l'IP change à chaque restart, le nom non). Aujourd'hui le proxy stocke l'IP du container : un restart casse la route jusqu'au prochain health-check.
