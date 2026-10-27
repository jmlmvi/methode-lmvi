---
id: HOWTO-01
titre: "Ajouter une fonctionnalité au Hub"
theme: "META · Travailler sur le Hub"
surface: [ActionProvider, ActionMetadata, ParameterMetadata, ExecutionMode, Worker, SocleHubProperties, SecurityConfig]
actions_mcp: 0
etat_verifie:
  hub: "3.70.3"
  socle: "5.9.4"
  le: "2026-10-16"
  comment: "API du socle relue au bytecode de socle-v005-5.9.4.jar — cinq ruptures corrigées, voir piège 11"
voisins: [HOWTO-02, HOWTO-24, HOWTO-28]
---

# HOWTO 01 — Ajouter une fonctionnalité au Hub

> **Niveau** : intermédiaire | **Prérequis** : avoir lu [[03-patterns-fondamentaux|les patterns fondamentaux]] | **Temps estimé** : 30-90 min selon la fonctionnalité
>
> Vérifié contre **SocleHub 3.70.3** (`eu.lmvi:socle-v005:5.9.4`), API relue au bytecode le 2026-10-16.
>
> ⚠️ **Cette fiche annonçait « SocleHub 3.12.1 / socle-v005 5.8.0 » et ses exemples ne compilaient
> plus.** Cinq ruptures d'API, toutes corrigées ci-dessous et expliquées au **piège 11** —
> `ActionMode` et `ActionParameter` n'existent plus, les classes de modèle ont changé de paquet,
> `.scope()` s'appelle `.requiredScope()`, et `getStats()` est obligatoire.

Ce guide montre comment ajouter une fonctionnalité au Hub **sans casser ce qui existe** et **en restant prévisible** pour les futurs lecteurs. Il couvre les 5 cas les plus fréquents :

1. Ajouter une **action** à un worker existant.
2. Ajouter un **nouveau worker** (avec son service et ses actions).
3. Ajouter un **endpoint REST** custom (hors action).
4. Ajouter un **nouvel écran** dans le portail (Thymeleaf).
5. Ajouter un **filtre servlet** (sécurité, métrique, transformation).

---

## Questions auxquelles répond cette fiche

1. Où ranger une nouvelle fonctionnalité : action, worker, endpoint REST, écran ou filtre ?
2. Comment ajouter une action à un worker existant, de bout en bout ?
3. Quels sont les imports et les noms de classes exacts de l'API d'actions du socle ?
4. Comment déclarer les paramètres d'une action, et lesquels sont obligatoires ?
5. Comment déclarer le scope OAuth exigé par une action ?
6. Quelles méthodes faut-il obligatoirement implémenter sur l'interface `Worker` ?
7. Comment créer un worker qui n'est piloté que par appels MCP ou REST ?
8. Comment étendre la configuration du Hub avec une nouvelle clé `application.yml` ?
9. Comment ajouter un écran d'administration dans le portail Thymeleaf ?
10. Comment ajouter un filtre servlet, et où le placer dans l'ordre existant ?
11. Comment écrire une migration SQL qui ne casse pas un déploiement rejoué ?
12. Que faut-il mettre à jour dans la documentation pour chaque type d'ajout ?
13. Pourquoi mon worker ne figure-t-il pas dans `/admin/workers` ?
14. Pourquoi mon action apparaît-elle dans la liste MCP mais échoue à l'exécution ?

## Mots-clés

ajouter une action, nouveau worker, `ActionProvider`, `ActionMetadata`, `ParameterMetadata`,
`ExecutionMode`, `ActionResult`, `ActionParameters`, `ActionContext`, `getActions`, `executeAction`,
`requiredScope`, scope OAuth, `readOnly`, `since`, `deprecated`, `timeoutMs`, `sensitive`,
interface `Worker`, `getName`, `initialize`, `start`, `doWork`, `stop`, `isHealthy`, `getStats`,
`getStartPriority`, `getSchedule`, `PASSIVE`, `getCycleIntervalMs`, `@Component`,
injection par constructeur, endpoint REST, `@RestController`, écran portail, Thymeleaf,
`@Controller`, sidebar, filtre servlet, `@Order`, `HIGHEST_PRECEDENCE`, `SecurityConfig`,
`ApiAuthFilter`, migration SQL idempotente, `IF NOT EXISTS`, `x_dateupdated`,
`SocleHubProperties`, rupture d'API, `ActionMode` supprimé, `ActionParameter` supprimé

---

## 1. Décider où ranger la fonctionnalité

```
Mon besoin = ?
│
├─ Exposer une nouvelle capacité métier d'un worker existant
│   → §2 — Ajouter une action
│
├─ Encapsuler une nouvelle source/cible externe (autre service Docker, API tierce…)
│   → §3 — Ajouter un nouveau worker
│
├─ Endpoint HTTP qui ne ressemble pas à une action (callback, webhook, OAuth flow, fichier statique custom…)
│   → §4 — Ajouter un endpoint REST custom
│
├─ Nouvelle page d'administration dans le Hub
│   → §5 — Ajouter un écran portal
│
└─ Logique transverse (auth, throttling, audit, transform request)
    → §6 — Ajouter un filtre servlet
```

> **Règle d'or** : si la fonctionnalité s'invoque comme « faire X sur le Hub », c'est une **action**. Si c'est « le Hub réagit à un événement externe », c'est un **endpoint** ou un **filtre**.

---

## 2. Ajouter une action à un worker existant

Cas d'école : ajouter `archive_user` au [[10-iam-worker|IamWorker]] qui marque un user comme archivé sans le supprimer.

### 2.1 Modifier le worker

`/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/worker/IamWorker.java` (worker enregistré sous le nom `iam_worker`)

#### a) Ajouter l'action dans `getActions()`

```java
@Override
public List<ActionMetadata> getActions() {
    return List.of(
        // ... actions existantes ...
        ActionMetadata.builder()
            .name("archive_user")
            .description("Archive un utilisateur (le rend non-actif sans le supprimer)")
            .mode(ExecutionMode.SYNC)
            .parameters(List.of(
                ParameterMetadata.builder()
                    .name("user_id").type(ParameterType.STRING)
                    .required(true).description("Identifiant de l'utilisateur").build(),
                ParameterMetadata.builder()
                    .name("reason").type(ParameterType.STRING)
                    .required(false).description("Raison de l'archivage (audit)").build()
            ))
            .readOnly(false)
            .requiredScope("iam:write")
            .since("3.71.0")
            .build()
    );
}
```

Les imports, qui sont la première chose qui casse :

```java
import eu.lmvi.socle.action.ActionProvider;            // reste dans .action
import eu.lmvi.socle.action.model.ActionContext;       // les MODÈLES sont dans .action.model
import eu.lmvi.socle.action.model.ActionMetadata;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.action.model.ExecutionMode;
import eu.lmvi.socle.action.model.ParameterMetadata;
import eu.lmvi.socle.action.model.ParameterType;
import eu.lmvi.socle.worker.Worker;
```

#### b) Ajouter le `case` dans `executeAction()`

```java
@Override
public ActionResult executeAction(String actionName, ActionParameters params, ActionContext ctx) {
    actionCount.incrementAndGet();
    long start = System.currentTimeMillis();
    try {
        return switch (actionName) {
            // ... cases existants ...
            case "archive_user" -> handleArchiveUser(params, ctx);
            default -> ActionResult.ofFailure("Action inconnue : " + actionName);
        };
    } catch (Exception e) {
        errorCount.incrementAndGet();
        logger.error("[worker:{}][step:action_error][action:{}] {}", getName(), actionName, e.getMessage(), e);
        return ActionResult.ofFailure("Erreur : " + e.getMessage());
    } finally {
        totalDurationMs.addAndGet(System.currentTimeMillis() - start);
    }
}
```

#### c) Implémenter le handler privé

```java
private ActionResult handleArchiveUser(ActionParameters params, ActionContext ctx) {
    String userId = params.getString("user_id");
    if (userId == null || userId.isBlank()) {
        return ActionResult.ofFailure("user_id requis");
    }
    String reason = params.getString("reason");

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(
             "UPDATE iam.db_users " +
             "SET archived = true, archived_at = now(), archived_reason = ?, x_dateupdated = now() " +
             "WHERE x_id = ?::uuid AND archived = false")) {
        ps.setString(1, reason);
        ps.setString(2, userId);
        int updated = ps.executeUpdate();
        if (updated == 0) {
            return ActionResult.ofFailure("User introuvable ou déjà archivé : " + userId);
        }
        logger.info("[worker:{}][step:archive_user] userId={} reason={} caller={}",
                    getName(), userId, reason, ctx.callerId());
        return ActionResult.ofSuccess(Map.of("user_id", userId, "archived", true));
    } catch (SQLException e) {
        logger.error("[worker:{}][step:archive_user_error] {}", getName(), e.getMessage(), e);
        return ActionResult.ofFailure("Erreur SQL : " + e.getMessage());
    }
}
```

### 2.2 Ajouter la migration SQL

`/opt/2026-TheHub4TheSocle/soclehub/sql/migration-vk-iam-archive.sql`

```sql
-- 2026-XX-XX : ajout flag archive sur iam.db_users
ALTER TABLE iam.db_users
    ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_iam_users_archived ON iam.db_users (archived) WHERE archived = false;
```

Appliquer la migration sur l'instance cible :

```bash
docker exec -i soclehub-postgres psql -U socle_prod -d socle_prod < soclehub/sql/migration-vk-iam-archive.sql
```

### 2.3 Mettre à jour la doc et la suite

- Ajouter l'action dans `institutional/10-iam-worker.md` section « Actions ».
- Mettre à jour `agent-guide/04-mcp-interaction.md` si la convention de scope change.
- Si l'IHM doit afficher un bouton « Archiver » : voir §5.

### 2.4 Tester

```bash
# Build
cd /opt/2026-TheHub4TheSocle/soclehub
mvn clean package -DskipTests

# Restart container
docker-compose -f docker/docker-compose.yml restart soclehub

# Vérifier que l'action est exposée (le worker est exposé sous son getName() = iam_worker)
curl -s -H "X-Api-Key: $API_KEY" \
     http://localhost:8080/api/actions/iam_worker | jq '.actions[] | select(.name=="archive_user")'

# Invoquer (POST /api/actions/{worker}/{action})
curl -s -X POST -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"user_id":"550e8400-e29b-41d4-a716-446655440000","reason":"Demande RGPD"}' \
     http://localhost:8080/api/actions/iam_worker/archive_user | jq

# Vérifier en DB
docker exec -i soclehub-postgres psql -U socle_prod -d socle_prod -c \
    "SELECT x_id, email, archived, archived_at, archived_reason FROM iam.db_users WHERE archived = true;"
```

---

## 3. Ajouter un nouveau worker

Cas d'école : créer un `WeatherWorker` qui interroge OpenWeatherMap et expose 3 actions (`get_current`, `get_forecast`, `get_status`).

> Le cycle de vie d'un worker (`getStartPriority` → `initialize` → `start` → `doWork` → `stop`) est décrit dans [[04-cycle-de-vie|le cycle de vie]] ; pour un squelette complet d'app/worker neuf, voir [[179-app-zz-template|le template d'app]].

### 3.1 Créer le service (couche client externe)

`/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/service/OpenWeatherClient.java`

```java
package eu.lmvi.soclehub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;

@Service
public class OpenWeatherClient {
    private static final Logger logger = LoggerFactory.getLogger(OpenWeatherClient.class);

    private final OkHttpClient httpClient;
    private final ObjectMapper mapper = new ObjectMapper();
    private final String apiKey;

    public OpenWeatherClient(eu.lmvi.soclehub.config.SocleHubProperties props) {
        this.apiKey = props.getOpenWeather() != null ? props.getOpenWeather().getApiKey() : null;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(5))
            .readTimeout(Duration.ofSeconds(10))
            .build();
    }

    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    public Optional<Map<String, Object>> currentByCity(String city) {
        if (!isAvailable()) return Optional.empty();
        String url = "https://api.openweathermap.org/data/2.5/weather"
                   + "?q=" + city + "&appid=" + apiKey + "&units=metric";
        try (Response resp = httpClient.newCall(new Request.Builder().url(url).build()).execute()) {
            if (!resp.isSuccessful()) return Optional.empty();
            JsonNode body = mapper.readTree(resp.body().string());
            return Optional.of(Map.of(
                "city", city,
                "temperature", body.path("main").path("temp").asDouble(),
                "description", body.path("weather").get(0).path("description").asText(),
                "humidity", body.path("main").path("humidity").asInt()
            ));
        } catch (IOException e) {
            logger.warn("[openweather] error fetching {} : {}", city, e.getMessage());
            return Optional.empty();
        }
    }
}
```

### 3.2 Étendre `SocleHubProperties` pour la config

`/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/config/SocleHubProperties.java`

Ajouter une inner class :

```java
public static class OpenWeather {
    private String apiKey;
    private boolean enabled = false;
    public String getApiKey() { return apiKey; }
    public void setApiKey(String k) { this.apiKey = k; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean e) { this.enabled = e; }
}
private OpenWeather openWeather = new OpenWeather();
public OpenWeather getOpenWeather() { return openWeather; }
public void setOpenWeather(OpenWeather o) { this.openWeather = o; }
```

`application.yml` :

```yaml
soclehub:
  open-weather:
    enabled: ${OPENWEATHER_ENABLED:false}
    api-key: ${OPENWEATHER_API_KEY:}
```

### 3.3 Créer le worker

`/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/worker/WeatherWorker.java`

```java
package eu.lmvi.soclehub.worker;

import eu.lmvi.socle.action.ActionProvider;
import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionMetadata;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.action.model.ExecutionMode;
import eu.lmvi.socle.action.model.ParameterMetadata;
import eu.lmvi.socle.action.model.ParameterType;
import eu.lmvi.socle.worker.Worker;
import eu.lmvi.soclehub.service.OpenWeatherClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class WeatherWorker implements Worker, ActionProvider {

    private static final Logger logger = LoggerFactory.getLogger(WeatherWorker.class);

    private final OpenWeatherClient client;
    private final AtomicLong actionCount = new AtomicLong();
    private final AtomicLong errorCount = new AtomicLong();
    private volatile boolean running = false;

    public WeatherWorker(OpenWeatherClient client) {
        this.client = client;
    }

    @Override public String getName() { return "weather_worker"; }
    @Override public int getStartPriority() { return 70; }
    @Override public String getSchedule() { return "PASSIVE"; }
    @Override public long getCycleIntervalMs() { return 0; }

    @Override
    public void initialize() {
        logger.info("[worker:{}][step:init] available={}", getName(), client.isAvailable());
    }

    @Override public void start() { running = true; }

    @Override public void doWork() { /* PASSIVE — never called */ }

    @Override
    public void stop() {
        running = false;
        logger.info("[worker:{}][step:stop]", getName());
    }

    @Override public boolean isHealthy() { return running; }

    // getStats() est ABSTRAITE sur l'interface Worker : sans elle, ça ne compile pas.
    @Override
    public Map<String, Object> getStats() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("name", getName());
        s.put("state", running ? "running" : "stopped");
        s.put("execution_count", actionCount.get());
        s.put("errors_count", errorCount.get());
        s.put("schedule", getSchedule());
        return s;
    }

    @Override
    public List<ActionMetadata> getActions() {
        return List.of(
            ActionMetadata.builder()
                .name("get_current")
                .description("Retourne la météo actuelle pour une ville")
                .mode(ExecutionMode.SYNC)
                .parameters(List.of(
                    ParameterMetadata.builder()
                        .name("city").type(ParameterType.STRING)
                        .required(true).description("Nom de la ville").build()
                ))
                .readOnly(true)
                .requiredScope("weather:read")
                .build(),
            ActionMetadata.builder()
                .name("get_status")
                .description("Statut du worker météo")
                .mode(ExecutionMode.SYNC)
                .readOnly(true)
                .build()
        );
    }

    @Override
    public ActionResult executeAction(String actionName, ActionParameters params, ActionContext ctx) {
        actionCount.incrementAndGet();
        try {
            return switch (actionName) {
                case "get_current" -> handleGetCurrent(params);
                case "get_status"  -> handleGetStatus();
                default            -> ActionResult.ofFailure("Action inconnue : " + actionName);
            };
        } catch (Exception e) {
            errorCount.incrementAndGet();
            logger.error("[worker:{}][step:action_error][action:{}] {}", getName(), actionName, e.getMessage(), e);
            return ActionResult.ofFailure("Erreur : " + e.getMessage());
        }
    }

    private ActionResult handleGetCurrent(ActionParameters params) {
        String city = params.getString("city");
        if (city == null || city.isBlank()) return ActionResult.ofFailure("city requis");
        Optional<Map<String, Object>> data = client.currentByCity(city);
        return data.map(ActionResult::ofSuccess)
                   .orElse(ActionResult.ofFailure("Météo indisponible pour : " + city));
    }

    private ActionResult handleGetStatus() {
        return ActionResult.ofSuccess(Map.of(
            "running", running,
            "available", client.isAvailable(),
            "actionCount", actionCount.get(),
            "errorCount", errorCount.get()
        ));
    }
}
```

### 3.4 Tester

```bash
mvn clean package -DskipTests
docker-compose -f docker/docker-compose.yml restart soclehub

# Le worker doit apparaître dans /admin/workers
curl -s http://localhost:8080/admin/workers | jq '.workers[] | select(.name=="weather_worker")'

# Action exposée dans /api/actions
curl -s -H "X-Api-Key: $API_KEY" \
     http://localhost:8080/api/actions/weather_worker | jq

# Invoquer (POST /api/actions/{worker}/{action})
curl -s -X POST -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"city":"Paris"}' \
     http://localhost:8080/api/actions/weather_worker/get_current | jq
```

---

## 4. Ajouter un endpoint REST custom

Cas d'école : `GET /api/health/db` qui ping toutes les DB et renvoie un JSON détaillé.

### 4.1 Créer (ou étendre) un controller

`/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/controller/HealthController.java`

Ajouter une méthode :

```java
@GetMapping("/health/db")
public ResponseEntity<Map<String, Object>> dbHealth() {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("postgres", pingPostgres());
    result.put("redis", pingRedis());
    result.put("vault", vaultService.isAvailable() ? "UP" : "DOWN");
    boolean allUp = result.values().stream().allMatch(v -> "UP".equals(v));
    return ResponseEntity.status(allUp ? 200 : 503).body(result);
}

private String pingPostgres() {
    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement("SELECT 1")) {
        ps.executeQuery();
        return "UP";
    } catch (SQLException e) {
        return "DOWN: " + e.getMessage();
    }
}

private String pingRedis() {
    try (Jedis j = jedisPool.getResource()) {
        return "PONG".equalsIgnoreCase(j.ping()) ? "UP" : "DOWN";
    } catch (Exception e) {
        return "DOWN: " + e.getMessage();
    }
}
```

### 4.2 Authentification

`HealthController` est sous `/admin/health` qui est public dans `SecurityConfig`. Si tu veux le protéger : changer le chemin (ex: `/api/health/db` qui passe par `ApiAuthFilter`) ou ajouter une vérif manuelle.

### 4.3 Tester

```bash
curl -s http://localhost:8080/api/health/db | jq
```

---

## 5. Ajouter un écran dans le portail Thymeleaf

Cas d'école : page `/hub/weather` qui affiche la météo de la ville préférée du user.

### 5.1 Créer le controller portal

`/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/controller/portal/PortalWeatherController.java`

```java
package eu.lmvi.soclehub.controller.portal;

import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.soclehub.worker.WeatherWorker;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
@RequestMapping("/hub/weather")
public class PortalWeatherController {

    private final WeatherWorker weatherWorker;

    public PortalWeatherController(WeatherWorker weatherWorker) {
        this.weatherWorker = weatherWorker;
    }

    @GetMapping
    public String dashboard(@RequestParam(defaultValue = "Paris") String city, Model model) {
        ActionResult result = weatherWorker.executeAction(
            "get_current",
            ActionParameters.of("city", city),
            ActionContext.forTest()
        );
        model.addAttribute("city", city);
        if (result.success()) {
            model.addAttribute("weather", result.data());
        } else {
            model.addAttribute("error", result.error());
        }
        return "weather/dashboard";  // résolu vers templates/weather/dashboard.html
    }
}
```

### 5.2 Créer le template

`/opt/2026-TheHub4TheSocle/soclehub/src/main/resources/templates/weather/dashboard.html`

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org" xmlns:layout="http://www.ultraq.net.nz/thymeleaf/layout"
      layout:decorate="~{layout/base}">
<head>
    <title>Météo</title>
</head>
<body>
<section layout:fragment="content">
    <h1 class="text-2xl font-bold mb-4">Météo — <span th:text="${city}"></span></h1>

    <form method="get" class="mb-6">
        <label>
            Ville :
            <input type="text" name="city" th:value="${city}" class="border rounded px-2 py-1"/>
        </label>
        <button type="submit" class="bg-blue-500 text-white px-3 py-1 rounded">Voir</button>
    </form>

    <div th:if="${error}" class="bg-red-100 text-red-800 p-3 rounded">
        <span th:text="${error}"></span>
    </div>

    <div th:if="${weather}" class="bg-white shadow rounded p-4">
        <p>Température : <strong th:text="${weather.temperature}"></strong> °C</p>
        <p>Humidité : <strong th:text="${weather.humidity}"></strong> %</p>
        <p>Description : <span th:text="${weather.description}"></span></p>
    </div>
</section>
</body>
</html>
```

### 5.3 Lien dans la sidebar

Éditer `/opt/2026-TheHub4TheSocle/soclehub/src/main/resources/templates/layout/fragments/sidebar.html` pour ajouter une entrée `<li><a href="/hub/weather">Météo</a></li>` dans le menu.

### 5.4 Tester

```bash
mvn clean package -DskipTests
docker-compose -f docker/docker-compose.yml restart soclehub

# Login dans le portail puis naviguer
open https://admin.thesocle.net/hub/weather?city=Lyon
```

---

## 6. Ajouter un filtre servlet

Cas d'école : `RequestLatencyFilter` qui mesure le temps de réponse et le log si > 1s. L'ordre des filtres et la chaîne de sécurité sont documentés dans [[70-securite-filtres|sécurité & filtres]].

### 6.1 Créer le filtre

`/opt/2026-TheHub4TheSocle/soclehub/src/main/java/eu/lmvi/soclehub/filter/RequestLatencyFilter.java`

```java
package eu.lmvi.soclehub.filter;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)  // juste après HttpsRedirect
public class RequestLatencyFilter implements Filter {

    private static final Logger logger = LoggerFactory.getLogger(RequestLatencyFilter.class);
    private static final long THRESHOLD_MS = 1000;

    @Override
    public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain)
            throws IOException, ServletException {
        long start = System.currentTimeMillis();
        try {
            chain.doFilter(req, resp);
        } finally {
            long elapsed = System.currentTimeMillis() - start;
            if (elapsed > THRESHOLD_MS && req instanceof HttpServletRequest httpReq) {
                logger.warn("[request-latency] slow uri={} method={} duration={}ms",
                            httpReq.getRequestURI(), httpReq.getMethod(), elapsed);
            }
        }
    }
}
```

### 6.2 Tester

Pas de test unitaire spécifique — le filtre s'enregistre automatiquement (`@Component` + `@Order`). Vérifier dans les logs :

```bash
docker logs soclehub | grep request-latency
```

---

## 7. Mettre à jour la documentation

Toute fonctionnalité ajoutée **doit** être documentée. Le code seul n'est pas suffisant.

| Type d'ajout | Fichier(s) à mettre à jour |
|---|---|
| Action sur un worker existant | la fiche `institutional/<XX-worker>.md` du worker (ex. [[10-iam-worker]]) § Actions |
| Nouveau worker | Nouvelle fiche `institutional/XX-<nom-worker>.md` + [[00-index]] |
| Endpoint REST | [[80-controllers-rest|controllers REST]] |
| Écran portal | [[81-controllers-portal|controllers portal]] + entrée `templates/` recensée |
| Filtre servlet | [[70-securite-filtres|sécurité & filtres]] (mise à jour de l'ordre) |
| Clé `application.yml` | [[160-configuration-reference|référence de configuration]] |

> **Règle** : si un développeur arrive demain sans contexte, peut-il comprendre la nouvelle fonctionnalité en lisant uniquement la doc ? Si non, la doc est incomplète.

---

## 8. Pièges courants

### Piège 1 — Oublier `@Component` sur le worker
**Symptôme** : `NoSuchBeanDefinitionException` au démarrage, ou pire : démarrage silencieux mais worker absent de `/admin/workers`.
**Résolution** : ajouter `@Component` (ou `@Service` mais préférer `@Component` pour la consistance Hub).

### Piège 2 — Injection sur champ au lieu de constructeur
**Symptôme** : test unitaire impossible sans Spring, dépendance `null` en mode standalone.
**Résolution** : injection par constructeur. Ne **jamais** utiliser `@Autowired` sur un champ.

### Piège 3 — Action déclarée dans `getActions()` sans handler
**Symptôme** : l'action apparaît dans la liste MCP/Swagger mais retourne `ofFailure("Action inconnue")` à l'exécution.
**Résolution** : toujours synchroniser `getActions()` ↔ switch dans `executeAction()`. Voir [[03-patterns-fondamentaux]] §2.

### Piège 4 — Pas de `default` dans le switch
**Symptôme** : `MatchException` au runtime sur une action inconnue.
**Résolution** : toujours `default -> ActionResult.ofFailure(...)`.

### Piège 5 — `kvBus.sub()` ailleurs que dans `initialize()`
**Symptôme** : si tu ajoutes un `kvBus.sub(...)` dans `doWork()`, le handler s'enregistre N fois → OOM en quelques heures.
**Résolution** : tout `kvBus.sub(...)` doit être dans `initialize()`. Voir `agent-guide/03-regles-absolues.md`.

### Piège 6 — `getXxx()` au lieu de `xxx()` sur les records Action
**Symptôme** : compilation échoue ou — pire — l'IDE génère le getter qui ne correspond pas à l'API record.
**Résolution** : `result.success()`, `params.getString("k")`, `ctx.callerId()`. Pas de `result.getSuccess()`.

### Piège 7 — Migration SQL non idempotente
**Symptôme** : `mvn clean package` réussit en local mais le déploiement échoue parce que la migration a déjà été appliquée.
**Résolution** : toujours `IF NOT EXISTS` / `CREATE OR REPLACE` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### Piège 8 — Modifier `SecurityConfig` sans réfléchir à `.anyRequest().permitAll()`
**Symptôme** : un nouvel endpoint est par défaut public — la sécurité repose sur `ApiAuthFilter`.
**Résolution** : si l'endpoint est sensible et hors `/api/**`, ajouter une règle explicite dans `SecurityConfig.filterChain()` ou s'assurer que `ApiAuthFilter` couvre le préfixe.

### Piège 9 — Oublier de relancer le container
**Symptôme** : tes changements compilent en local mais le Hub déployé continue d'utiliser l'ancien JAR.
**Résolution** : `docker-compose restart soclehub` après chaque build, ou builder l'image (`docker-compose build` puis `up -d`).

### Piège 10 — Ne pas mettre à jour la doc
**Symptôme** : 6 mois plus tard, personne ne sait à quoi sert la fonctionnalité, le code paraît douteux et finit par être supprimé.
**Résolution** : doc en même temps que code. Voir §7.

### Piège 11 — 🔴 Recopier l'API d'actions d'une fiche antérieure au socle 5.9
**Symptôme** : le code copié depuis une fiche ou un worker ancien ne compile pas —
`cannot find symbol: class ActionMode`, `cannot find symbol: class ActionParameter`,
`cannot find symbol: method scope(String)`, ou `WeatherWorker is not abstract and does not
override abstract method getStats()`.

**Cause** : **cinq ruptures**, vérifiées au bytecode de `socle-v005-5.9.4.jar` le 2026-10-16.
Les exemples de cette fiche les portaient tous les cinq jusqu'à cette date.

| Ce qu'on lit encore | Ce qui existe en 5.9.4 |
|---|---|
| `ActionMode.SYNC` | **`ExecutionMode.SYNC`** — la classe `ActionMode` n'existe plus |
| `ActionParameter.required("x","string")` | **`ParameterMetadata.builder().name("x").type(ParameterType.STRING).required(true).build()`** — la classe `ActionParameter` n'existe plus |
| `import eu.lmvi.socle.action.ActionMetadata` | **`eu.lmvi.socle.action.model.ActionMetadata`** — tous les modèles ont migré dans `.model` ; seul `ActionProvider` reste dans `.action` |
| `.scope("iam:write")` | **`.requiredScope("iam:write")`** |
| un `Worker` sans `getStats()` | **`getStats()` est abstraite** sur l'interface — obligatoire |

**Résolution** : copier l'API depuis un worker **récent du Hub** (`ScanGuardWorker`,
`SalonWorker`) et non depuis une fiche, et vérifier au besoin au bytecode :

```bash
cd /opt/2026-TheHub4TheSocle/soclehub
unzip -o -q mvn-repo/eu/lmvi/socle-v005/5.9.4/socle-v005-5.9.4.jar 'eu/lmvi/socle/action/*' -d /tmp/jar
javap -p '/tmp/jar/eu/lmvi/socle/action/model/ActionMetadata$Builder.class'   # les 18 méthodes réelles
javap -p /tmp/jar/eu/lmvi/socle/worker/Worker.class                            # ce qui est abstrait
```

Les autres méthodes du builder, souvent ignorées et utiles : `requiresConfirmation`, `tags`,
`examples`, `responseFields`, `group`, `deprecated`, `deprecationMessage`, `since`,
`exampleRequest`, `exampleResponse`, `timeoutMs`, `sensitive`.

---

## 9. Checklist avant push

- [ ] Code compile : `mvn clean package -DskipTests`.
- [ ] `@Component` sur worker, injection constructeur uniquement.
- [ ] Si nouvelle action : déclaration cohérente getActions/case + scope OAuth approprié.
- [ ] Si migration SQL : idempotente (`IF NOT EXISTS`).
- [ ] Tests manuels passés (curl + IHM si applicable).
- [ ] Docs mises à jour (`institutional/`, `agent-guide/`).
- [ ] Logs au format `[worker:{name}][step:{step}]`.
- [ ] Pas de secret hardcodé (passer par Vault ou `${VAR_ENV}` dans `application.yml`).
- [ ] `git status` propre, commit message descriptif (`feat: …` ou `chore: …`).
