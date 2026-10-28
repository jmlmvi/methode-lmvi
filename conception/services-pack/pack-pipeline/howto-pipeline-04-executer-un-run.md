# HOWTO PIPELINE-04 — Exécuter un run : instancier, démarrer, piloter, clore

**Niveau :** Confirmé
**Cible :** application qui embarque `socle-pack-pipeline`, avec un template publié ([[howto-pipeline-02-declarer-valider-publier-un-dag|PIPELINE-02]])
**Versions vérifiées au code :** `socle-pack-pipeline` 0.3.0 @ `fef144d` (tag `v0.3.0`, `main` ; code fonctionnel identique à 0.2.0 et à 0.1.0-SNAPSHOT @ `5fa8f05`) · `socle-v005` 5.10.0 / Spring Boot 4.1.2 · date 2026-10-28
**Temps estimé :** 30 min

> Classes de référence : `runtime/PipelineRuntimeManager`, `engine/DagPipelineBuilder`, `engine/CompiledPipeline`

---

## 1. Contexte

Un **run** est une instance figée d'un template publié, identifiée par une clé choisie par l'app : le
`run_key`. Il existe à deux endroits :

- **en mémoire**, dans `PipelineRuntimeManager.active` : le pipeline compilé (files, executors, parking) ;
- **en base**, dans `tr_pipeline_run` : statut, mode, copie du graphe (`frozen_graph`), `context_params`.

Deux modes d'exécution partagent les mêmes files et les mêmes fonctions d'étape :

| | `batch` | `step` (pas-à-pas) |
|---|---|---|
| Exécution | executors V2 en vthreads, **asynchrone** | vagues claim/ack dans le thread appelant, **synchrone** |
| `run_start` rend | aussitôt, `status: running` + `v2ExecutionId` | après drainage complet, `status: completed` + `processed` |
| Exception d'un handler | V2 : relance puis DLQ de l'étape | remonte à l'appelant de `run_start` ; `nack(requeue=false)` : DLQ rangée sous l'étape `unknown` en `memory`, message abandonné en `nats` |
| Fin du run | **jamais automatique** : reste `running` jusqu'à `run_cancel` | `completed` dès que les files sont vides |
| Usage type | un run de longue durée alimenté au fil de l'eau (RssArchiver) | un run par élément traité (NotionSocle), essais, débogage |

Deux façons d'organiser ses runs se rencontrent dans la flotte :

- **un run long par version de DAG**, alimenté par `backfill` : **APP-12-RssArchiver**
  (`CurationPipelineFeeder.ensureRun`, `run_key = rss-editorial-<empreinte>`) ;
- **un run par dossier métier** : **APP-17-BilanSocle** (un run par bénéficiaire, mode batch, étapes
  humaines) et **APP-06-NotionSocle** (un run `step` par fichier, annulé aussitôt après).

---

## 2. Architecture

```
 instantiate(type, run_key, mode, context_params)
   ├─ run vivant en base pour cette clé ? ── oui → resume_run (branche, cf. §4.1)
   ├─ INSERT tr_pipeline_run (status=created, frozen_graph)
   └─ DagPipelineBuilder.build(dag, run_key, RunRecorder, repo, runId)
        ├─ 1 StageQueue  q.<run_key>.<stageId>    par étape   (techdb | memory | nats)
        ├─ 1 VThreadStageExecutor + DagStageFunction par étape
        ├─ StageRouter · HumanParkingService · DedupRegistry
        └─ DefaultPipelineV2 (entrée = première étape S)

 run_start(run_key, payload)
   batch : startBatch() → submit(msg) → status=running, v2_execution_id
   step  : inject(msg)  → runStepToCompletion(1000 vagues) → status=completed

 run_pause / run_resume : stop()/start() des executors   → paused / running
 run_cancel             : close() + retrait de la mémoire → cancelled, ended_at
```

---

## 3. Étape 1 — Instancier

| Paramètre | Requis | Rôle |
|---|---|---|
| `type_id` **ou** `code` | oui | template ; `code` = la **dernière ligne** de ce code, qui doit être `published` |
| `run_key` | oui | clé stable du run, **≤ 100 caractères** (`VARCHAR(100)`) |
| `execution_mode` | non | `batch` ou `step` ; défaut : `executionMode` du DAG, sinon `batch` |
| `context_params` | non | objet libre **rangé** dans `tr_pipeline_run.context_params` |

Réponse : `{ run_key, run_id, type_code }`.

`context_params` est stocké pour l'historique et la relecture par l'app. **Les handlers ne le reçoivent
pas** : ce dont une étape a besoin doit voyager dans le payload.

## 4. Étape 2 — Démarrer et piloter

| Action | Paramètres | Effet |
|---|---|---|
| `run_start` | `run_key`, `payload` (facultatif) | soumet **un** message à la Source. Sans `payload`, le message porte un payload `null` |
| `run_pause` | `run_key` | arrête les executors (batch), statut `paused` |
| `run_resume` | `run_key` | relance les executors s'ils sont arrêtés, statut `running` |
| `run_cancel` | `run_key` | ferme files et contexte, retire le run de la mémoire, statut `cancelled` |
| `run_status` | `run_key` | état persistant + état des files + messages parqués (§6) |
| `list_runs` | `limit` (défaut 50) | derniers runs, toutes clés confondues |

### 4.1 Après un redémarrage de l'app

La mémoire est perdue, la base reste. Sur la branche documentée, **`instantiate` est idempotent** : s'il
trouve en base un run non terminé (`created`, `running`, `paused`) pour cette clé, il le reconstruit par
`resume_run` et rend son `run_id`, au lieu d'insérer une ligne. La séquence `instantiate` puis
`run_start` reste donc valable à chaque démarrage. Le détail de la reprise est dans
[[howto-pipeline-05-human-in-the-loop-et-reprise|PIPELINE-05]].

Sur `main` (sans `V002`), chaque démarrage ajoutait une ligne : **164 lignes** pour une seule clé mesurées
en production RssArchiver le 2026-10-05.

## 5. Étape 3 — Le code

### 5.1 Run long, alimenté au fil de l'eau (modèle RssArchiver)

```java
package eu.lmvi.monapp.pipeline;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Un run batch par version du DAG ; les demandes y entrent par backfill. */
@Service
public class TriDemandesRunService {

    private static final Logger log = LoggerFactory.getLogger(TriDemandesRunService.class);

    private final PipelineWorker pipeline;
    private final Set<String> prets = ConcurrentHashMap.newKeySet();

    public TriDemandesRunService(PipelineWorker pipeline) {
        this.pipeline = pipeline;
    }

    /** Idempotent : instancie (ou reprend) puis démarre le run de cette version. */
    public void assurerRun(long typeId, String runKey) {
        if (prets.contains(runKey)) return;
        ActionResult inst = pipeline.executeAction("instantiate", ActionParameters.fromMap(Map.of(
                "type_id", typeId, "run_key", runKey, "execution_mode", "batch")), null);
        if (!inst.success() && !inst.error().contains("déjà actif")) {
            throw new IllegalStateException("instantiate " + runKey + " : " + inst.error());
        }
        // run_start soumet un message à la Source : avec un payload absent, il porte null.
        // Le premier vrai lot partira par backfill ; la Source par défaut (identity) le laisse passer
        // et normalise rejettera ce message vide (requiredIn) — il finit en échec tracé, sans effet.
        ActionResult start = pipeline.executeAction("run_start",
                ActionParameters.fromMap(Map.of("run_key", runKey)), null);
        if (!start.success()) {
            throw new IllegalStateException("run_start " + runKey + " : " + start.error());
        }
        prets.add(runKey);
        log.info("[tri] run {} prêt : {}", runKey, start.data());
    }

    /** Injecte un lot de demandes ; doublons exacts écartés par l'idempotence du pack. */
    public Map<String, Object> soumettre(String runKey, List<Map<String, Object>> demandes) {
        ActionResult r = pipeline.executeAction("backfill",
                ActionParameters.fromMap(Map.of("run_key", runKey, "payloads", demandes)), null);
        if (!r.success()) {
            throw new IllegalStateException("backfill " + runKey + " : " + r.error());
        }
        return r.data();   // { runKey, submitted, processed, mode }
    }
}
```

### 5.2 Un run par élément, synchrone (modèle NotionSocle)

```java
package eu.lmvi.monapp.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import eu.lmvi.socle.pack.pipeline.engine.StageHandlerRegistry;
import eu.lmvi.socle.pack.pipeline.model.PipelineMessage;
import eu.lmvi.socle.pack.pipeline.repo.PipelineRepository;
import eu.lmvi.socle.pack.pipeline.runtime.PipelineRuntimeManager;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Exécute un DAG en pas-à-pas sur un payload et rend ce qu'a reçu son puits `collect`. */
@Service
public class ExecutionUnitaire {

    private final PipelineRepository repo;
    private final PipelineRuntimeManager runtime;
    private final StageHandlerRegistry handlers;

    public ExecutionUnitaire(PipelineRepository repo, PipelineRuntimeManager runtime,
                             StageHandlerRegistry handlers) {
        this.repo = repo;
        this.runtime = runtime;
        this.handlers = handlers;
    }

    public JsonNode executer(String code, String stageCollect, JsonNode payload) {
        PipelineRepository.TypeRow type = repo.findLatestTypeByCode(code)
                .orElseThrow(() -> new IllegalStateException("pipeline introuvable : " + code));
        String runKey = "u-" + code + "-" + UUID.randomUUID().toString().substring(0, 8);

        runtime.instantiate(type, runKey, "step", null);
        try {
            Map<String, Object> r = runtime.start(runKey, payload);   // synchrone : drainé au retour
            List<PipelineMessage> sortie = handlers.collectSink().drainView(runKey, stageCollect);
            return sortie.isEmpty() ? payload : sortie.get(sortie.size() - 1).payload();
        } finally {
            // Libère la mémoire du run. Effet de bord : son statut passe de completed à cancelled.
            try { runtime.cancel(runKey); } catch (IllegalStateException deja) { /* déjà retiré */ }
            handlers.collectSink().forgetRun(runKey);
        }
    }
}
```

`PipelineRuntimeManager`, `PipelineRepository` et `StageHandlerRegistry` sont des beans publics : les
appeler directement évite la conversion en `ActionResult`, au prix d'un couplage aux classes du pack.

---

## 6. Étape 4 — Choisir le backend des files

`socle.pipeline.queue-backend` décide où vivent les messages **entre** deux étapes. Le métier (runs,
étapes, artefacts, messages parqués) est en PostgreSQL dans tous les cas.

| Backend | Files | Contexte V2 | Messages en vol après redémarrage | Constat en production |
|---|---|---|---|---|
| `techdb` (défaut) | `TechDbStageQueue` (H2 du framework) | `TechDbPipelineContext` | conservés | **`object is already closed`** sous charge : la TechDB H2 fichier ferme et rouvre sa connexion |
| `memory` | `InMemoryStageQueue` | `InMemoryPipelineContext` | **perdus** | choix de BilanSocle, NotionSocle, REGIES, TheDiffuseur |
| `nats` | `NatsStageQueue` (JetStream) | `InMemoryPipelineContext` | conservés dans JetStream | aucune app ; cf. [[howto-pipeline-09-backend-nats-jetstream\|PIPELINE-09]] |

Recommandation : **`memory`**, et une app qui se tient prête à réinjecter ce qui n'a pas abouti (une
colonne d'état dans sa propre table, comme `tr_raw_item.status` chez RssArchiver). RssArchiver reste en
`techdb` par sa configuration ; son contournement d'origine était `SOCLE_PIPELINE_QUEUE_BACKEND=memory`.

---

## 7. Vérifier

```bash
curl -s "$APP/mcp" -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pipeline_worker__run_status","arguments":{"run_key":"tri-demandes-a1b2c3d4"}}}' \
 | jq -r '.result.content[0].text' | jq
```

```json
{ "x_id": 7, "id_pipeline_type": 42, "run_key": "tri-demandes-a1b2c3d4", "status": "running",
  "execution_mode": "batch", "v2_execution_id": "…", "started_at": "…",
  "active": true, "running": true,
  "stages": { "src":  {"pending":0,"processing":0,"dlq":0,"totalProcessed":12,"totalFailed":0},
              "note": {"pending":3,"processing":2,"dlq":0,"totalProcessed":7,"totalFailed":0}, "…": {} },
  "drained": false,
  "parked": [] }
```

Les colonnes `NULL` (`ended_at`, `error_message` d'un run en cours) **n'apparaissent pas** : le
`ActionResult` du socle écarte les valeurs nulles (`toImmutableSkippingNulls`). Tester la présence de la
clé, pas sa valeur.

`active:false` signifie que le run n'est pas en mémoire de ce processus (redémarrage, ou annulé) : seuls
les champs persistants sont rendus.

`drained:true` (aucun message en attente ni en cours) est **le seul signal de fin** d'un run batch.

```sql
SELECT run_key, status, execution_mode, started_at, ended_at
  FROM schema_monapp.tr_pipeline_run ORDER BY x_id DESC LIMIT 10;
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `instantiate` + `run_start` en `step` avec un payload valide | `status: completed`, `processed ≥ nombre d'étapes traversées` |
| 2 | Même chose en `batch` | `status: running` ; `run_status.drained` passe à `true` |
| 3 | `run_pause` puis `run_status` | `running:false`, statut `paused` en base |
| 4 | `run_resume` | `running:true` |
| 5 | Redémarrer l'app puis `instantiate` avec la même clé | même `run_id`, **aucune** nouvelle ligne (branche) |
| 6 | `run_cancel` puis `instantiate` avec la même clé | nouveau `run_id` : un run clos libère sa clé |
| 7 | Deux `instantiate` de suite sans redémarrage | le second échoue `run déjà actif` |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Un run batch ne se termine jamais** | `status = running` à vie, même file vide | surveiller `run_status.drained`, puis `run_cancel` si le run doit se clore |
| **`step` marqué `completed` avec des messages parqués** | statut `completed` alors qu'une étape H attend | lire `run_status.parked`, pas `status` |
| Run `step` laissé en mémoire | mémoire qui grossit run après run : `start` ne retire pas le run de `active` | `run_cancel` après lecture (§5.2) ; le statut passe alors à `cancelled` |
| `run_start` sans payload | un message `null` traverse la Source et échoue à la première étape exigeante | Source qui tolère `null`, ou toujours un payload |
| `context_params` lu par un handler | absent : il n'est transmis à aucune étape | mettre la donnée dans le payload |
| `instantiate` qui échoue à la compilation (handler inconnu) | la ligne `created` reste en base et bloque la clé : `run_cancel` répond `run inconnu ou inactif` | corriger le handler puis `instantiate` (la reprise recompile), ou clore la ligne en SQL (`status='cancelled'`) |
| `run_key` > 100 caractères | `value too long for type character varying(100)` | clé courte : code + empreinte |
| `backend techdb` | `object is already closed` sous charge | `memory` (§6) |
| `backend memory` + redémarrage | messages en vol perdus ; les étapes H, elles, sont rechargées | l'app garde l'état de chaque élément et réinjecte |
| Deux runs batch de la même clé sur deux réplicas | traitements en double : `active` est local au processus | un seul réplica par run, ou des clés par réplica |
| Main sans `V002` | une ligne `tr_pipeline_run` de plus à chaque démarrage | embarquer la branche `feat/p1-p4-dag-engine` |
| Lire `status` sur un run d'une version précédente | `findRunRow` rend la ligne la plus récente de la clé | une clé par version de DAG (empreinte dans la clé) |

---

## 10. Pour aller plus loin

- [[howto-pipeline-05-human-in-the-loop-et-reprise|PIPELINE-05]] — étapes humaines et reprise après redémarrage
- [[howto-pipeline-06-idempotence-backfill-et-dlq|PIPELINE-06]] — `backfill`, `stage_retry`, limites de la dédup
- [[howto-pipeline-07-observer-lineage-et-metriques|PIPELINE-07]] — relire ce qui s'est passé
- [[howto-pipeline-09-backend-nats-jetstream|PIPELINE-09]] — files dans JetStream
