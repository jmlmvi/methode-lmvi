# HOWTO PIPELINE-07 — Observer un run : lineage, métriques, artefacts

**Niveau :** Intermédiaire
**Cible :** application qui embarque `socle-pack-pipeline`
**Versions vérifiées au code :** `socle-pack-pipeline` 0.1.0-SNAPSHOT @ `5fa8f05` · `socle-v005` 5.8.0 · date 2026-10-28
**Temps estimé :** 30 min

> Classes de référence : `runtime/RunRecorder`, `engine/StageObserver`, `repo/PipelineRepository`
> (`stageRunsForRun`, `artifactsForRun`, `metricsForRun`), `engine/handlers/CollectSinkHandler`

---

## 1. Contexte

Chaque passage d'un message dans une étape laisse une trace en PostgreSQL, écrite par `RunRecorder` sans
code côté app. C'est ce qui distingue le pack du Pipeline V2 du framework, dont l'état vit en TechDB et
disparaît avec le run. Trois questions trouvent ainsi leur réponse :

- **qu'est-il arrivé à ce run ?** → `tr_pipeline_stage_run` (une ligne par exécution d'étape) ;
- **qu'a-t-il produit ?** → `tr_pipeline_artifact` (une ligne par passage dans un Sink, payload + lineage) ;
- **combien de temps ?** → `tr_pipeline_metric` (`stage_duration_ms` par exécution).

Un quatrième outil, **en mémoire**, sert à relire la sortie d'un run synchrone : le puits `collect`.

Cas de référence : **APP-06-NotionSocle** relit le résultat de chaque workflow dans le puits `collect`
(`WorkflowRunner.lastPayload`) puis l'oublie (`forgetRun`) — l'oubli manquant a saturé un tas de 3 Go en
cinq jours (~109 000 runs, 2026-09-22).

---

## 2. Architecture

```
 DagStageFunction ── succès ──► RunRecorder.onStageSuccess
                   │              ├ INSERT tr_pipeline_stage_run  (status=completed, attempts=1, started_at, ended_at)
                   │              ├ INSERT tr_pipeline_metric     (stage_duration_ms, ms décimales)
                   │              └ si K : INSERT tr_pipeline_artifact (kind=payload, lineage, datas=payload)
                   └─ échec ───► RunRecorder.onStageFailure
                                  └ INSERT tr_pipeline_stage_run  (status=failed, error_message)
 étape H ────────────────────► HumanParkingService : stage_run status=parked → resolved

 Écritures « best-effort » : un échec d'INSERT est journalisé en WARN et n'arrête pas le run.

 tr_pipeline_run 1─┬─* tr_pipeline_stage_run 1─* tr_pipeline_metric
                   │                         1─* tr_pipeline_artifact
                   └─ ON DELETE CASCADE sur les trois tables filles
```

---

## 3. Étape 1 — Les actions de lecture

| Action | Paramètres | Rend |
|---|---|---|
| `lineage` | `run_key` | `stage_runs[]` : `x_id, stage_id, stage_type, status, attempts, started_at, ended_at, error_message` ; `artifacts[]` : `x_id, id_stage_run, artifact_kind, content_ref, lineage, content_hash, x_dateCreated` |
| `metrics` | `run_key` | `metrics[]` : `id_stage_run, metric_name, metric_value, labels, x_dateCreated` |
| `run_status` | `run_key` | compteurs **en direct** des files par étape (cf. [[howto-pipeline-04-executer-un-run\|PIPELINE-04]] §7) |
| `list_runs` | `limit` | derniers runs : `x_id, id_pipeline_type, run_key, status, execution_mode, started_at, ended_at` |

`lineage` et `metrics` lisent le run **le plus récent** portant cette clé. Les artefacts rendus n'incluent
pas le payload : il est dans la colonne `datas`, à lire en SQL.

Le `lineage` d'un artefact est la liste `[{stageId, messageId}]` des étapes qui ont **transformé** le
message. Les built-ins `set-field`, `merge-fields` et `composite` y ajoutent un maillon ; `identity`,
`log` et `collect` n'en ajoutent pas. Un handler d'app en ajoute un s'il utilise
`in.withPayload(…, new LineageEntry(…))`.

---

## 4. Étape 2 — Exposer l'historique dans l'app

```java
package eu.lmvi.monapp.pipeline;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Historique d'un run pour l'écran de suivi : étapes, durées, sorties. */
@RestController
@RequestMapping("/api/runs")
public class HistoriqueRunController {

    private final JdbcTemplate jdbc;
    private final String schema;

    public HistoriqueRunController(JdbcTemplate jdbc, @Value("${socle.pipeline.schema}") String schema) {
        this.jdbc = jdbc;
        this.schema = schema;
    }

    @GetMapping("/{runKey}")
    public Map<String, Object> historique(@PathVariable String runKey) {
        Long runId = jdbc.query("SELECT x_id FROM " + schema + ".tr_pipeline_run WHERE run_key = ? "
                        + "ORDER BY x_id DESC LIMIT 1", rs -> rs.next() ? rs.getLong(1) : null, runKey);
        if (runId == null) {
            return Map.of("run_key", runKey, "trouve", false);
        }
        List<Map<String, Object>> etapes = jdbc.queryForList(
                "SELECT sr.stage_id, sr.stage_type, sr.status, count(*) AS passages, "
                        + "       round(avg(m.metric_value)::numeric, 1) AS duree_moy_ms, "
                        + "       round(max(m.metric_value)::numeric, 1) AS duree_max_ms, "
                        + "       max(sr.error_message) FILTER (WHERE sr.status = 'failed') AS derniere_erreur "
                        + "FROM " + schema + ".tr_pipeline_stage_run sr "
                        + "LEFT JOIN " + schema + ".tr_pipeline_metric m "
                        + "       ON m.id_stage_run = sr.x_id AND m.metric_name = 'stage_duration_ms' "
                        + "WHERE sr.id_pipeline_run = ? GROUP BY 1, 2, 3 ORDER BY min(sr.x_id)", runId);
        List<Map<String, Object>> sorties = jdbc.queryForList(
                "SELECT a.x_id, sr.stage_id, a.lineage::text AS lineage, a.datas::text AS payload, a.x_dateCreated "
                        + "FROM " + schema + ".tr_pipeline_artifact a "
                        + "LEFT JOIN " + schema + ".tr_pipeline_stage_run sr ON sr.x_id = a.id_stage_run "
                        + "WHERE a.id_pipeline_run = ? ORDER BY a.x_id DESC LIMIT 100", runId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run_key", runKey);
        out.put("run_id", runId);
        out.put("etapes", etapes);
        out.put("sorties", sorties);
        return out;
    }
}
```

La route `/api/runs/**` est une route de l'app : la protéger par le SSO du Hub ou les filtres du socle
comme les autres écrans.

---

## 5. Étape 3 — Borner la croissance des tables

Le pack **ne purge rien**. Un run long reçoit, par message, une ligne `tr_pipeline_stage_run` et une ligne
`tr_pipeline_metric` **par étape traversée**, plus un artefact par Sink. Une purge par âge des runs clos
suffit : la suppression d'un run emporte ses lignes filles (`ON DELETE CASCADE`). Pour un run long qui ne
se clôt jamais, la purge vise ses lignes filles par date.

```java
package eu.lmvi.monapp.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import eu.lmvi.socle.worker.Worker;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** CronWorker : purge chaque nuit l'historique du pack au-delà de la rétention. */
@Component
public class PurgeHistoriquePipelineWorker implements Worker {

    private static final Logger log = LoggerFactory.getLogger(PurgeHistoriquePipelineWorker.class);

    private final JdbcTemplate jdbc;
    private final String schema;
    private final int retentionJours;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong executions = new AtomicLong();
    private volatile String derniere = "";

    public PurgeHistoriquePipelineWorker(JdbcTemplate jdbc,
                                         @Value("${socle.pipeline.schema}") String schema,
                                         @Value("${MONAPP_PIPELINE_RETENTION_DAYS:30}") int retentionJours) {
        this.jdbc = jdbc;
        this.schema = schema;
        this.retentionJours = retentionJours;
    }

    @Override public String getName() { return "pipeline_purge_worker"; }
    @Override public void initialize() { log.info("[worker:pipeline_purge_worker] rétention {} j", retentionJours); }
    @Override public void start() { running.set(true); }
    @Override public void stop() { running.set(false); }
    @Override public boolean isHealthy() { return true; }
    @Override public String getSchedule() { return "15 3 * * *"; }   // cron V005 : CINQ champs

    @Override
    public void doWork() {
        int runs = jdbc.update("DELETE FROM " + schema + ".tr_pipeline_run "
                + "WHERE status IN ('completed','failed','cancelled') "
                + "AND COALESCE(ended_at, x_dateCreated) < now() - make_interval(days => ?)", retentionJours);
        int metriques = jdbc.update("DELETE FROM " + schema + ".tr_pipeline_metric "
                + "WHERE x_dateCreated < now() - make_interval(days => ?)", retentionJours);
        int artefacts = jdbc.update("DELETE FROM " + schema + ".tr_pipeline_artifact "
                + "WHERE x_dateCreated < now() - make_interval(days => ?)", retentionJours);
        int etapes = jdbc.update("DELETE FROM " + schema + ".tr_pipeline_stage_run "
                + "WHERE status <> 'parked' AND x_dateCreated < now() - make_interval(days => ?)", retentionJours);
        executions.incrementAndGet();
        derniere = java.time.Instant.now().toString();
        log.info("[worker:pipeline_purge_worker] runs={} metriques={} artefacts={} etapes={}",
                runs, metriques, artefacts, etapes);
    }

    @Override
    public Map<String, Object> getStats() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("running", running.get());            // clés lues par le Status Dashboard (socle ≤ 5.9.4)
        m.put("execution_count", executions.get());
        m.put("last_execution", derniere);
        m.put("retention_days", retentionJours);
        return m;
    }
}
```

Les lignes `parked` sont conservées : `resume_run` en a besoin pour recharger les étapes humaines.

---

## 6. Étape 4 — Le puits `collect` (mémoire)

`CollectSinkHandler` (`handler: "collect"` sur une étape K) retient chaque message reçu, indexé par
`(runId, stageId)`. Il n'écrit rien en base au-delà de l'artefact standard.

| Méthode (`StageHandlerRegistry.collectSink()`) | Rôle |
|---|---|
| `drainView(runId, stageId)` | copie des messages reçus (les laisse en place) |
| `countForRun(runId)` | total des messages retenus pour un run |
| `forgetRun(runId)` | **libère** tout ce qui concerne le run |
| `retainedKeys()` | nombre de couples `(run, étape)` retenus : à surveiller |
| `clear()` | vide tout |

Règle : tout `drainView` est suivi d'un `forgetRun` dans un `finally` (exemple complet dans
[[howto-pipeline-04-executer-un-run|PIPELINE-04]] §5.2).

---

## 7. Vérifier

```bash
curl -s "$APP/mcp" -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pipeline_worker__lineage","arguments":{"run_key":"tri-demandes-a1b2c3d4"}}}' \
 | jq -r '.result.content[0].text' | jq '{etapes: (.stage_runs | length), sorties: (.artifacts | length)}'
```

```sql
-- Volume par table, pour dimensionner la rétention
SELECT 'stage_run' t, count(*) FROM schema_monapp.tr_pipeline_stage_run
UNION ALL SELECT 'metric',   count(*) FROM schema_monapp.tr_pipeline_metric
UNION ALL SELECT 'artifact', count(*) FROM schema_monapp.tr_pipeline_artifact;
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Run `src → normalise → note → gate → auto` avec un message | 5 lignes `completed` dans `stage_runs`, 5 métriques, 1 artefact (`auto`) |
| 2 | Étape en échec | ligne `failed` avec `error_message` |
| 3 | `lineage` de l'artefact | maillon `normalise` (handler `set-field`) présent |
| 4 | Run `step` avec puits `collect` puis `forgetRun` | `retainedKeys()` revient à sa valeur d'avant |
| 5 | Purge avec rétention 0 sur une base d'essai | runs clos et lignes filles supprimés ; lignes `parked` intactes |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **`drainView` sans `forgetRun`** | tas saturé en quelques jours (NotionSocle : 3 Go, ~109 000 runs) | `forgetRun` dans un `finally` |
| **Aucune purge** | tables `tr_pipeline_*` qui grossissent sans borne, une ligne par étape et par message | worker de purge (§5) |
| Purger les lignes `parked` | `resume_run` ne recharge plus les étapes humaines en attente | exclure `status = 'parked'` |
| Chercher le payload dans la réponse `lineage` | absent | `tr_pipeline_artifact.datas` en SQL |
| `attempts` lu comme un nombre de relances | toujours `1` : une ligne par exécution | compter les lignes d'une étape |
| Relances jetées par la dédup | aucune ligne `failed` alors que l'élément n'aboutit pas | cf. [[howto-pipeline-06-idempotence-backfill-et-dlq\|PIPELINE-06]] §7 |
| `x_partition` attendu pour filtrer par tenant | `NULL` : le pack ne pose pas `app.current_tenant_id` et ne filtre aucune requête | une clé de run par tenant, filtrage dans l'app |
| Sous-pipelines (étape C) cherchés dans l'historique | absents : ils tournent avec un observateur de capture, sans écriture en base | tracer dans le handler appelant si nécessaire |
| WARN `persistance lineage échouée` ignoré | trous dans l'historique, le run continue | surveiller ce WARN (droits, disque) |
| `lineage` d'une clé réutilisée | seul le run le plus récent est lu | une clé par run, ou SQL par `x_id` |

---

## 10. Pour aller plus loin

- [[howto-pipeline-04-executer-un-run|PIPELINE-04]] — `run_status`, compteurs en direct
- [[howto-pipeline-06-idempotence-backfill-et-dlq|PIPELINE-06]] — lire les écarts entre étapes
- `socle-pack-pipeline/src/main/resources/db/pipeline/V001__core.sql` — définition des six tables
