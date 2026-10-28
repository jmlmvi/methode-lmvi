# HOWTO PIPELINE-05 — Human-in-the-loop et reprise après redémarrage

**Niveau :** Confirmé
**Cible :** application qui embarque `socle-pack-pipeline`
**Versions vérifiées au code :** `socle-pack-pipeline` 0.1.0-SNAPSHOT @ `5fa8f05` · `socle-v005` 5.8.0 · date 2026-10-28
**Temps estimé :** 40 min

> Classes de référence : `engine/HumanParkingService`, `engine/CompiledPipeline` (`resumeHuman`, `reloadParked`),
> `runtime/PipelineRuntimeManager` (`humanResolve`, `resumeFromDb`), `repo/PipelineRepository.parkedStageRuns`

---

## 1. Contexte

Certaines étapes attendent une personne : relire un résumé, valider un dossier, signer après un délai
réglementaire. L'étape de type **H** arrête le message et le **parque** ; il repart vers l'aval quand l'app
appelle `human_resolve`, éventuellement avec un payload corrigé.

L'attente peut durer des jours. Le parking est donc **persisté en PostgreSQL**, et `resume_run`
reconstruit un run après redémarrage en rechargeant ses messages parqués.

Cas de référence : **APP-17-BilanSocle**. Un parcours de bilan de compétences est un run (un par
bénéficiaire). Chaque étape d'entretien est une étape H. `ParcoursInstanceService.completerEtape` refuse la
validation avant l'échéance réglementaire (RG-06), puis appelle `human_resolve`.

---

## 2. Architecture

```
            ┌──────── run actif (mémoire) ────────┐
 message ─► │ étape H : handler (identity par déf.)│
            │   └ HumanParkingService.park(out)    │──► INSERT tr_pipeline_stage_run
            │       parkId = UUID aléatoire        │      stage_type='H', status='parked',
            │       parked[parkId] = message       │      datas = message COMPLET (payload+metadata+lineage)
            └──────────────────┬───────────────────┘
                               │ run_status → parked[] = {parkId, stageId, runId, parkedAt}
 human_resolve(run_key, park_id, payload?)
            │  payload fourni → message.withPayload(payload)   (remplacement, pas fusion)
            │  StageRouter.route(étape H, message) → arêtes sortantes de H
            │  UPDATE tr_pipeline_stage_run SET status='resolved', datas = payload
            │  executors arrêtés (step, ou batch non relancé) → drainage synchrone

 ─── redémarrage ───  la mémoire est perdue
 resume_run(run_key)
            ├─ tr_pipeline_run.frozen_graph → recompilation
            ├─ SELECT … status='parked' → reload : NOUVEAU parkId par message
            └─ executors NON démarrés
```

---

## 3. Étape 1 — Déclarer l'étape humaine

```json
{
  "code": "parcours-bilan",
  "label": "Parcours de bilan en trois entretiens",
  "executionMode": "batch",
  "stages": [
    { "id": "src",        "type": "S" },
    { "id": "ouverture",  "type": "T", "handler": "set-field", "params": { "field": "phase", "value": "ouverte" },
      "config": { "timeoutMs": 5000, "maxRetries": 0 } },
    { "id": "entretien1", "type": "H", "label": "Entretien préliminaire",  "config": { "timeoutMs": 5000, "maxRetries": 0 } },
    { "id": "entretien2", "type": "H", "label": "Entretien d'investigation","config": { "timeoutMs": 5000, "maxRetries": 0 } },
    { "id": "synthese",   "type": "H", "label": "Synthèse signée",          "config": { "timeoutMs": 5000, "maxRetries": 0 } },
    { "id": "clos",       "type": "K", "handler": "log",                    "config": { "timeoutMs": 5000, "maxRetries": 0 } }
  ],
  "edges": [
    { "id": "e1", "from": "src",        "to": "ouverture" },
    { "id": "e2", "from": "ouverture",  "to": "entretien1" },
    { "id": "e3", "from": "entretien1", "to": "entretien2" },
    { "id": "e4", "from": "entretien2", "to": "synthese" },
    { "id": "e5", "from": "synthese",   "to": "clos" }
  ]
}
```

L'étape H exécute son handler **avant** de parquer : un handler sur une étape H prépare le message
présenté à l'humain (le défaut `identity` le laisse tel quel).

---

## 4. Étape 2 — Lister ce qui attend, résoudre

| Action | Paramètres | Réponse |
|---|---|---|
| `run_status` | `run_key` | `parked: [{parkId, stageId, runId, parkedAt}]` |
| `human_resolve` | `run_key`, `park_id`, `payload` (facultatif) | `{runKey, parkId, resolved:true, remaining_parked, status}` |

`status` vaut `drained` quand **plus aucun message n'est parqué** dans ce run, `running` sinon. Il ne dit
rien des files d'attente.

```java
package eu.lmvi.monapp.parcours;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

/** Étapes humaines d'un parcours : ce qui attend, et la validation d'une étape. */
@Service
public class EtapesHumainesService {

    private final PipelineWorker pipeline;

    public EtapesHumainesService(PipelineWorker pipeline) {
        this.pipeline = pipeline;
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> enAttente(String runKey) {
        ActionResult r = pipeline.executeAction("run_status",
                ActionParameters.fromMap(Map.of("run_key", runKey)), null);
        if (!r.success()) throw new NoSuchElementException("run introuvable : " + runKey);
        Object p = r.data().get("parked");
        return p instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    /**
     * Valide l'étape {@code stageId}. Le parkId est relu à chaque appel : il change à chaque reprise.
     * {@code correction} REMPLACE le payload ; pour ne modifier qu'un champ, fournir le payload complet.
     */
    public Map<String, Object> valider(String runKey, String stageId, String utilisateur,
                                       Map<String, Object> correction) {
        String parkId = enAttente(runKey).stream()
                .filter(e -> stageId.equals(String.valueOf(e.get("stageId"))))
                .map(e -> String.valueOf(e.get("parkId")))
                .findFirst()
                .orElseThrow(() -> new NoSuchElementException("aucune étape '" + stageId + "' en attente"));

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("run_key", runKey);
        params.put("park_id", parkId);
        if (correction != null) {
            Map<String, Object> payload = new LinkedHashMap<>(correction);
            payload.put("valide_par", utilisateur);
            params.put("payload", payload);
        }
        ActionResult r = pipeline.executeAction("human_resolve", ActionParameters.fromMap(params), null);
        if (!r.success()) throw new IllegalStateException("human_resolve refusé : " + r.error());
        return r.data();
    }
}
```

Le pack ne contrôle **ni l'identité ni les droits** de celui qui résout. Les contrôles (rôle, échéance,
tenant) se font dans l'app avant l'appel, comme le fait BilanSocle pour RG-06.

---

## 5. Étape 3 — Reprendre les runs au démarrage

`resume_run` reconstruit un run depuis la base mais **ne relance pas les executors**. Pour un run batch, il
faut ensuite `run_resume`. Le composant ci-dessous reprend tous les runs vivants au démarrage de l'app.

```java
package eu.lmvi.monapp.parcours;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Au démarrage : recompile chaque run vivant, recharge ses étapes parquées, relance le batch. */
@Component
@Order(20)
public class RepriseDesRuns implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RepriseDesRuns.class);

    private final PipelineWorker pipeline;
    private final JdbcTemplate jdbc;
    private final String schema;

    public RepriseDesRuns(PipelineWorker pipeline, JdbcTemplate jdbc,
                          @Value("${socle.pipeline.schema}") String schema) {
        this.pipeline = pipeline;
        this.jdbc = jdbc;
        this.schema = schema;
    }

    @Override
    public void run(ApplicationArguments args) {
        var vivants = jdbc.queryForList(
                "SELECT DISTINCT ON (run_key) run_key, execution_mode, status FROM " + schema + ".tr_pipeline_run "
                        + "WHERE status IN ('created','running','paused') ORDER BY run_key, x_id DESC");
        for (Map<String, Object> r : vivants) {
            String runKey = (String) r.get("run_key");
            ActionResult rep = pipeline.executeAction("resume_run",
                    ActionParameters.fromMap(Map.of("run_key", runKey)), null);
            if (!rep.success()) {
                log.warn("[reprise] {} non repris : {}", runKey, rep.error());
                continue;
            }
            if ("batch".equals(r.get("execution_mode")) && !"paused".equals(r.get("status"))) {
                pipeline.executeAction("run_resume", ActionParameters.fromMap(Map.of("run_key", runKey)), null);
            }
            log.info("[reprise] {} repris : {} étape(s) parquée(s) rechargée(s)",
                    runKey, rep.data().get("reloaded_parked"));
        }
    }
}
```

Réponse de `resume_run` : `{runKey, resumed:true, mode, reloaded_parked, status}`, ou
`{resumed:false, reason:"déjà actif"}` si le run est déjà en mémoire. Sur la branche documentée,
`instantiate` d'une clé vivante passe aussi par `resume_run` ([[howto-pipeline-04-executer-un-run|PIPELINE-04]] §4.1).

---

## 6. Vérifier

```sql
SELECT x_id, stage_id, status, x_dateCreated, datas->'payload' AS payload
  FROM schema_monapp.tr_pipeline_stage_run
 WHERE id_pipeline_run = (SELECT max(x_id) FROM schema_monapp.tr_pipeline_run WHERE run_key = 'run__lmvi__42')
   AND stage_type = 'H'
 ORDER BY x_id;
```

Attendu après la validation du premier entretien : `entretien1` en `resolved`, `entretien2` en `parked`.
Une ligne `parked` porte le message complet (`datas->'payload'`, `datas->'lineage'`) ; une ligne
`resolved` ne porte plus que le payload relancé.

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `run_start` du parcours | `run_status.parked` contient `entretien1` |
| 2 | `human_resolve` sans payload | `entretien1` → `resolved`, `entretien2` parqué |
| 3 | `human_resolve` avec `{"note":"ok"}` | le payload aval vaut **exactement** `{"note":"ok"}` ; un maillon de lineage au nom de l'étape résolue est ajouté |
| 4 | `human_resolve` deux fois avec le même `park_id` | second appel : `parkId inconnu ou déjà résolu` |
| 5 | Redémarrer l'app, `resume_run` | `reloaded_parked = 1`, nouveau `parkId` dans `run_status` |
| 6 | Ancien `parkId` après redémarrage | refusé `parkId inconnu` |
| 7 | Run batch repris sans `run_resume` | `run_status.running = false` ; un `human_resolve` draine quand même l'aval, en synchrone |

Test du pack correspondant : `PipelineP1IntegrationTest.humanInTheLoop_parkResolve_andLineagePersisted`
et `resumeFromDb_afterRestart_reloadsParked_andResolves` (PostgreSQL réel, Testcontainers).

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **`parkId` gardé par l'app** | après un redémarrage, `parkId inconnu` : le rechargement en attribue un neuf | retrouver le `parkId` par `stageId` dans `run_status.parked` à chaque fois (§4) |
| **`payload` de `human_resolve` pris pour un correctif partiel** | champs amont disparus en aval : le payload est **remplacé** | envoyer le payload complet modifié |
| `resume_run` d'un run batch sans `run_resume` | messages des files techdb/nats jamais consommés ; seul `human_resolve` draine | enchaîner `run_resume` (§5) |
| Mode `step` + étapes H | `run_start` marque le run `completed` alors que des étapes attendent | lire `parked`, ou rester en `batch` |
| Plusieurs messages parqués sur la même étape | `filter(stageId)` prend le premier, sans ordre garanti | discriminer par un champ métier du message, ou un run par dossier |
| Contrôle d'accès attendu du pack | n'importe quel porteur de clé MCP peut résoudre | vérifier rôle, tenant et échéance dans l'app avant l'appel |
| `resume_run` d'un run sans `frozen_graph` | `run '…' sans graphe figé — non reconstructible` | un run créé par `instantiate` a toujours son graphe ; ne pas insérer de run à la main |
| Échec de persistance du parking | WARN `persistance parking échouée` ; le message vit en mémoire seulement et disparaît au redémarrage | surveiller ce WARN ; vérifier droits et schéma |
| Résolution pendant que le run est absent de la mémoire | `run inconnu ou inactif` | `resume_run` d'abord |
| Le timeout de l'étape H pris pour un délai d'attente humaine | aucun effet : `timeoutMs` borne le handler, pas l'attente | le délai métier se contrôle dans l'app (RG-06 de BilanSocle) |

---

## 9. Pour aller plus loin

- [[howto-pipeline-04-executer-un-run|PIPELINE-04]] — cycle de vie complet d'un run
- [[howto-pipeline-07-observer-lineage-et-metriques|PIPELINE-07]] — historique des étapes résolues
- `APP-17-BilanSocle/bilansocle/src/main/java/eu/lmvi/ParcoursInstanceService.java` — usage réel
