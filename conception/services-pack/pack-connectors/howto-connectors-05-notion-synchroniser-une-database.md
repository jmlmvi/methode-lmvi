# HOWTO CONNECTORS-05 — Notion : synchroniser une database depuis le code de l'app

**Niveau :** Confirmé
**Cible :** app qui importe une database Notion dans ses tables, ou y pousse ses propres lignes
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:3.0.0` (Boot 4.0.6 ; code de ce périmètre identique à 2.0.0, dernière version Boot 3) — `NotionDatabaseService`
(`getDatabaseFull`, `createDatabase`, `upsertDatabaseRow`), `PropertyConverter`, `NotionClient`
**Temps estimé :** 45 min

---

## 1. Contexte

Le pack ne contient **aucun worker de synchronisation** : pas de polling, pas de curseur persistant,
pas de suivi des modifications. La table `tr_notion_import_job` (curseur, compteurs, statut) est
créée par `V002` mais **aucune classe n'y écrit** en 2.0.0.

Ce qu'il fournit, ce sont des briques réutilisables, disponibles **même si `notion_worker` est
éteint** (pas de `@ConditionalOnProperty`) :

| Bean | Méthode | Ce qu'elle fait |
|---|---|---|
| `NotionDatabaseService` | `getDatabaseFull(databaseId)` | schéma + **toutes** les lignes (pagination 100), propriétés simplifiées, `cover_url`, `icon` |
| | `createDatabase(parentPageId, title, JsonNode schema)` | `POST /v1/databases` sous une page |
| | `upsertDatabaseRow(databaseId, props, Map<String,String> schema, existingPageId)` | `POST /v1/pages` si `existingPageId` nul, sinon `PATCH /v1/pages/{id}` |
| `PropertyConverter` | `toNotion(map, schema)` / `fromNotion(json)` | conversion simplifié ↔ Notion |
| `NotionClient` | `get/post/patch/delete(path…)` | appel brut, avec rate limit + retry + circuit breaker |

La synchronisation périodique s'écrit donc **dans l'app**, avec un Worker V005 conforme
(1 fichier, pas de `@Scheduled`, pas de `while(true)`).

---

## 2. Architecture

```
┌──────────────────────── APP-* ─────────────────────────┐
│ NotionSyncWorker (SimplePollingWorker, cycle 15 min)    │
│   doWork()                                              │
│     ├─ pull : NotionDatabaseService.getDatabaseFull ──► upsert schema_monapp.tr_projet
│     └─ push : lignes locales modifiées ──► upsertDatabaseRow(…, SCHEMA, notion_page_id)
└─────────────────────────────┬───────────────────────────┘
                              │ NotionClient (2 req/s, retry, CB "notion")
                              ▼
                     api.notion.com/v1
```

---

## 3. Étape 1 — Table locale de l'app

```sql
CREATE TABLE IF NOT EXISTS schema_monapp.tr_projet (
    x_id              BIGSERIAL PRIMARY KEY,
    x_dateCreated     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    x_dateChanged     TIMESTAMPTZ,
    notion_page_id    VARCHAR(64) UNIQUE,
    nom               TEXT NOT NULL,
    etat              VARCHAR(50),
    debut             DATE,
    notion_edited_at  TIMESTAMPTZ,
    dirty             BOOLEAN NOT NULL DEFAULT FALSE,
    datas             JSONB
);
```

---

## 4. Étape 2 — Le worker de synchronisation

```java
package eu.lmvi.monapp.workers;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.lmvi.socle.pack.connectors.notion.NotionDatabaseService;
import eu.lmvi.socle.worker.Worker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Date;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class NotionSyncWorker implements Worker {

    private static final Logger log = LoggerFactory.getLogger(NotionSyncWorker.class);

    /** Types Notion des colonnes poussées : sans lui, "Nom" partirait en rich_text et serait refusé. */
    private static final Map<String, String> SCHEMA = Map.of(
            "Nom", "title",
            "État", "select",
            "Début", "date");

    private final NotionDatabaseService notion;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();
    private final String databaseId;
    private final AtomicLong pulled = new AtomicLong();
    private final AtomicLong pushed = new AtomicLong();
    private volatile String lastError = "";

    public NotionSyncWorker(NotionDatabaseService notion, JdbcTemplate jdbc,
                            @Value("${monapp.notion.projets-db-id}") String databaseId) {
        this.notion = notion;
        this.jdbc = jdbc;
        this.databaseId = databaseId;
    }

    @Override public String getName() { return "notion_sync_worker"; }
    @Override public void initialize() { log.info("[worker:notion_sync_worker] db={}", databaseId); }
    @Override public void start() { }
    @Override public void stop() { }
    @Override public boolean isPassive() { return false; }
    @Override public long getCycleIntervalMs() { return 15 * 60_000L; }
    @Override public boolean isHealthy() { return lastError.isEmpty(); }

    @Override
    public Map<String, Object> getStats() {
        return Map.of("pulled", pulled.get(), "pushed", pushed.get(), "last_error", lastError);
    }

    @Override
    public void doWork() {
        try {
            pull();
            push();
            lastError = "";
        } catch (Exception e) {
            lastError = String.valueOf(e.getMessage());
            log.warn("[worker:notion_sync_worker] cycle en échec : {}", lastError);
        }
    }

    @SuppressWarnings("unchecked")
    private void pull() throws Exception {
        Map<String, Object> db = notion.getDatabaseFull(databaseId);
        for (Map<String, Object> row : (List<Map<String, Object>>) db.get("rows")) {
            Map<String, Object> p = (Map<String, Object>) row.get("properties");
            Object debut = p.get("Début");                       // "2026-10-28" ou "a → b"
            String jour = debut == null ? null : debut.toString().substring(0, 10);
            jdbc.update("""
                    INSERT INTO schema_monapp.tr_projet
                      (notion_page_id, nom, etat, debut, notion_edited_at, datas)
                    VALUES (?, ?, ?, ?, ?::timestamptz, ?::jsonb)
                    ON CONFLICT (notion_page_id) DO UPDATE
                      SET nom = EXCLUDED.nom, etat = EXCLUDED.etat, debut = EXCLUDED.debut,
                          notion_edited_at = EXCLUDED.notion_edited_at, datas = EXCLUDED.datas,
                          x_dateChanged = NOW()
                    WHERE tr_projet.dirty = FALSE
                    """,
                    row.get("id"), String.valueOf(p.getOrDefault("Nom", "")), p.get("État"),
                    jour == null ? null : Date.valueOf(jour),
                    row.get("last_edited_time"), mapper.writeValueAsString(p));
            pulled.incrementAndGet();
        }
    }

    private void push() throws Exception {
        List<Map<String, Object>> dirty = jdbc.queryForList(
                "SELECT x_id, notion_page_id, nom, etat, debut FROM schema_monapp.tr_projet WHERE dirty");
        for (Map<String, Object> r : dirty) {
            Map<String, Object> props = new LinkedHashMap<>();
            props.put("Nom", r.get("nom"));
            if (r.get("etat") != null) props.put("État", r.get("etat"));
            if (r.get("debut") != null) props.put("Début", r.get("debut").toString());
            String pageId = notion.upsertDatabaseRow(databaseId, props, SCHEMA,
                    (String) r.get("notion_page_id"));
            jdbc.update("UPDATE schema_monapp.tr_projet SET notion_page_id = ?, dirty = FALSE, "
                    + "notion_edited_at = ?::timestamptz WHERE x_id = ?",
                    pageId, OffsetDateTime.now().toString(), r.get("x_id"));
            pushed.incrementAndGet();
        }
    }
}
```

`application.yml` :

```yaml
monapp:
  notion:
    projets-db-id: ${MONAPP_NOTION_PROJETS_DB_ID}
socle:
  conn:
    notion:
      api-key: ${SOCLE_CONN_NOTION_API_KEY}
      # enabled peut rester à false : NotionDatabaseService n'en dépend pas
```

---

## 5. Étape 3 — Créer la database cible une fois (option)

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.lmvi.socle.pack.connectors.notion.NotionDatabaseService;

String schemaJson = """
    { "Nom":   {"title": {}},
      "État":  {"select": {"options": [{"name":"À faire"},{"name":"En cours"},{"name":"Fait"}]}},
      "Début": {"date": {}} }
    """;
String dbId = notionDatabaseService.createDatabase(
        "5e4d3c2b-…-page-parent", "Projets", new ObjectMapper().readTree(schemaJson));
```

---

## 6. Vérifier

```
[notion-db] getDatabaseFull(1f2e…): 74 rows
```

```sql
SELECT count(*) FILTER (WHERE dirty) AS a_pousser, count(*) AS total FROM schema_monapp.tr_projet;
```

Au dashboard, `notion_sync_worker` publie `pulled`, `pushed`, `last_error`.

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Premier cycle sur une base de 250 lignes | 250 lignes locales ; ≈ 3 appels `query` + 1 `GET database` |
| 2 | Modifier `État` dans Notion | Valeur à jour au cycle suivant |
| 3 | Modifier une ligne locale (`dirty=true`) | Poussée, `notion_page_id` conservé, `dirty=false` |
| 4 | Ligne locale nouvelle | Page créée, `notion_page_id` renseigné |
| 5 | Couper le réseau | `last_error` renseigné ; cycle suivant reprend |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Pousser sans schéma | `HTTP 400` sur la colonne titre ou `select` | Passer `Map<String,String> schema` à `upsertDatabaseRow` |
| Attendre une reprise sur `tr_notion_import_job` | Table vide, aucun curseur | Non implémenté : la reprise se gère dans l'app (curseur ou `last_edited_time`) |
| Relire une `date` comme `LocalDate` | `"2026-10-01 → 2026-10-28"` pour une plage | `fromNotion` aplatit les plages en texte ; découper ou lire `datas` brut via `NotionClient` |
| `people` lu en noms | Impossible de réécrire (le push attend des **UUID**) | Pour un aller-retour, lire `/pages/{id}` en brut via `NotionClient.get` |
| `getDatabaseFull` sur une très grosse base | Tout en mémoire, minutes à 2 req/s | Paginer soi-même avec `NotionClient.post("/databases/{id}/query", body)` et `start_cursor` |
| Conflit d'écriture | Une modification Notion écrase une modification locale | `WHERE dirty = FALSE` dans l'upsert (ci-dessus) ; arbitrer sur `last_edited_time` |
| `@Scheduled` dans le worker | Interdit par les règles V005 | `getCycleIntervalMs()` |
| Isolation par tenant | `x_partition` toujours `NULL` dans `tr_connector_log` | Non porté par le pack en 2.0.0 ; isoler dans les tables de l'app |

---

## 9. Pour aller plus loin

- [[howto-connectors-04-notion-pages-et-databases|CONNECTORS-04 — Notion par actions]]
- [[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10 — Résilience et journal]]
- [[howto-24-creer-une-app-socle-from-scratch|HOWTO 24 — Créer une app socle]]
