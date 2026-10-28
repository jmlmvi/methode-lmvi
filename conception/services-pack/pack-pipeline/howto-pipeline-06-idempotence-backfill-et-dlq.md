# HOWTO PIPELINE-06 — Idempotence, backfill et relance des échecs (DLQ)

**Niveau :** Expert
**Cible :** application qui embarque `socle-pack-pipeline`
**Versions vérifiées au code :** `socle-pack-pipeline` 0.1.0-SNAPSHOT @ `5fa8f05` · `socle-v005` 5.8.0 (`VThreadStageExecutor` lu au bytecode) · date 2026-10-28
**Temps estimé :** 45 min

> Classes de référence : `engine/MessageIds`, `engine/DedupRegistry`, `engine/DagStageFunction`,
> `engine/CompiledPipeline` (`backfill`, `retryStageDlq`), `eu.lmvi.socle.pipeline.executor.VThreadStageExecutor` (framework)

---

## 1. Contexte

Le pack promet un traitement **exactly-once aux frontières d'étape** : un même message présenté deux fois
à une étape n'y est traité qu'une fois. Cette promesse permet de rejouer un lot (`backfill`) sans
doublon. Elle a aussi un revers, mesuré en production, qu'il faut connaître avant de s'appuyer sur les
relances : **la déduplication jette les relances du moteur V2** (§7).

Cas de référence : **APP-12-RssArchiver**. Son `CurationPipelineFeeder` injecte les articles en attente
par `backfill`. Le 2026-10-26, **16 556 articles** sont restés bloqués en `pending` alors que le run
affichait `dlq=0` et `totalFailed=0`. Contournement livré en 1.80.3, décrit au §5.

---

## 2. Architecture

```
 run_start / backfill(payload)
   └ stampSource : _mid = UUID.nameUUIDFromBytes("src:" + runKey + ":" + payload.toString())

 à chaque étape (DagStageFunction.apply)
   1. DedupRegistry.firstSee(stageId, _mid) ── déjà vu → return null  (= succès pour V2, rien routé)
   2. handler …
   3. StageRouter : pour chaque arête e → _mid_enfant = UUID("<_mid>:" + e.id)

 DedupRegistry = Set<"stageId#_mid"> EN MÉMOIRE, un par run compilé
   ├ vidé au redémarrage et à chaque resume_run
   └ jamais purgé tant que le run vit

 Échec d'un handler, côté V2 (VThreadStageExecutor.handleError)
   tentative < maxRetries → backoff → nack(requeue=true) → même message, même _mid
   sinon                   → sendToDlq
```

---

## 3. Étape 1 — Rejouer un lot : `backfill`

| Paramètre | Requis | Rôle |
|---|---|---|
| `run_key` | oui | run actif |
| `payloads` | oui | tableau non vide de payloads, un message Source par élément |

Réponse : `{runKey, submitted, processed, mode}`.

- run batch en marche : chaque payload est soumis à V2, `processed = submitted` ;
- run arrêté ou `step` : les payloads sont injectés puis drainés en synchrone (2 000 vagues au plus) ;
  `processed` compte les traitements d'étape réellement effectués.

Deux payloads **identiques** dans le même run donnent le même `_mid` : le second est écarté dès la Source.
Le test du pack le montre : trois `{"score":80}` et un `{"score":81}` produisent deux sorties
(`PipelineP1IntegrationTest.idempotence_backfill_dedupesDuplicates_andStageRetryWired`).

## 4. Étape 2 — Relancer une DLQ : `stage_retry`

| Paramètre | Requis | Rôle |
|---|---|---|
| `run_key` | oui | run actif |
| `stage_id` | oui | étape dont la DLQ est rejouée |

Réponse : `{runKey, stageId, replayed}`. Si le run ne tourne pas, la propagation aval est drainée en
synchrone.

`stage_retry` remet les messages **tels quels** dans la file : même `_mid`. Tant que le run n'a pas été
recompilé, la déduplication les écarte en entrée (§7). Il n'a donc d'effet qu'**après** un redémarrage ou
un `resume_run`, qui vident le registre.

---

## 5. Étape 3 — Réinjecter soi-même, avec un numéro de tentative

La voie fiable aujourd'hui : l'app garde l'état de chaque élément, et chaque nouvelle tentative porte un
champ `attempt` dans le payload. Le payload change, donc le `_mid` aussi : la déduplication laisse passer.
C'est le contournement de RssArchiver 1.80.3.

```sql
CREATE TABLE IF NOT EXISTS schema_monapp.tr_demande (
    x_id            BIGSERIAL PRIMARY KEY,
    x_dateCreated   TIMESTAMPTZ NOT NULL DEFAULT now(),
    id_demande      VARCHAR(100) NOT NULL UNIQUE,
    texte           TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending | done
    datas           JSONB NOT NULL DEFAULT '{}'::jsonb         -- pipeline_attempts, pipeline_injected_at
);
```

Le Sink final passe la demande à `done` (handler `monapp-enregistre`, [[howto-pipeline-03-ecrire-un-stage-handler|PIPELINE-03]]).

```java
package eu.lmvi.monapp.pipeline;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Injecte les demandes en attente dans le run. Une demande non aboutie est réinjectée après
 * {@code delaiMinutes}, au plus {@code maxTentatives} fois, avec un numéro de tentative dans le payload :
 * le _mid change, la dédup du pack ne l'écarte pas.
 */
@Service
public class InjecteurDemandes {

    private static final Logger log = LoggerFactory.getLogger(InjecteurDemandes.class);

    private final PipelineWorker pipeline;
    private final JdbcTemplate jdbc;
    private final String schema;
    private final int delaiMinutes;
    private final int maxTentatives;
    private final int lot;

    public InjecteurDemandes(PipelineWorker pipeline, JdbcTemplate jdbc,
                             @Value("${socle.pipeline.schema}") String schema,
                             @Value("${MONAPP_REINJECT_DELAY_MIN:60}") int delaiMinutes,
                             @Value("${MONAPP_MAX_ATTEMPTS:5}") int maxTentatives,
                             @Value("${MONAPP_INJECT_BATCH:50}") int lot) {
        this.pipeline = pipeline;
        this.jdbc = jdbc;
        this.schema = schema;
        this.delaiMinutes = delaiMinutes;
        this.maxTentatives = maxTentatives;
        this.lot = lot;
    }

    /** Appelé par le cycle d'un worker de l'app (SimplePollingWorker), jamais par @Scheduled. */
    public int injecter(String runKey) {
        List<Map<String, Object>> aFaire = jdbc.queryForList(
                "SELECT id_demande, texte, COALESCE((datas->>'pipeline_attempts')::int, 0) AS tentatives "
                        + "FROM " + schema + ".tr_demande WHERE status = 'pending' "
                        + "AND COALESCE((datas->>'pipeline_attempts')::int, 0) < ? "
                        + "AND (datas->>'pipeline_injected_at' IS NULL "
                        + "     OR (datas->>'pipeline_injected_at')::timestamptz < now() - make_interval(mins => ?)) "
                        + "ORDER BY x_id LIMIT ?",
                maxTentatives, delaiMinutes, lot);
        if (aFaire.isEmpty()) return 0;

        List<Map<String, Object>> payloads = new ArrayList<>();
        List<Object[]> marques = new ArrayList<>();
        for (Map<String, Object> d : aFaire) {
            int tentative = ((Number) d.get("tentatives")).intValue() + 1;
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", d.get("id_demande"));
            p.put("texte", d.get("texte"));
            p.put("attempt", tentative);              // _mid neuf à chaque tentative
            payloads.add(p);
            marques.add(new Object[]{tentative, d.get("id_demande")});
        }

        ActionResult r = pipeline.executeAction("backfill",
                ActionParameters.fromMap(Map.of("run_key", runKey, "payloads", payloads)), null);
        if (!r.success()) {
            log.warn("[injecteur] backfill refusé : {}", r.error());
            return 0;
        }
        jdbc.batchUpdate("UPDATE " + schema + ".tr_demande SET datas = datas "
                + "|| jsonb_build_object('pipeline_injected_at', now(), 'pipeline_attempts', ?::int) "
                + "WHERE id_demande = ?", marques);
        log.info("[injecteur] {} demande(s) injectée(s) dans {}", payloads.size(), runKey);
        return payloads.size();
    }
}
```

Ajouter `"attempt"` au payload impose que les étapes l'ignorent ; aucune garde ne doit s'appuyer dessus.

---

## 6. Étape 4 — Surveiller ce que les compteurs taisent

Un message jeté par la déduplication est compté **réussi** par V2. `totalFailed` et `dlq` restent à zéro.
Le seul indice est une **chute de `totalProcessed` d'une étape à la suivante** sur une chaîne sans Gate.

```java
package eu.lmvi.monapp.pipeline;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Écart de traitements entre étapes consécutives d'une chaîne linéaire (hors Gate). */
@Service
public class EcartsEntreEtapes {

    private final PipelineWorker pipeline;

    public EcartsEntreEtapes(PipelineWorker pipeline) {
        this.pipeline = pipeline;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Long> mesurer(String runKey, List<String> chaine) {
        ActionResult r = pipeline.executeAction("run_status",
                ActionParameters.fromMap(Map.of("run_key", runKey)), null);
        Map<String, Map<String, Object>> stages = (Map<String, Map<String, Object>>) r.data().get("stages");
        Map<String, Long> ecarts = new LinkedHashMap<>();
        for (int i = 1; i < chaine.size(); i++) {
            Map<String, Object> amont = stages.get(chaine.get(i - 1));
            Map<String, Object> aval = stages.get(chaine.get(i));
            long perdus = ((Number) amont.get("totalProcessed")).longValue()
                    - ((Number) aval.get("totalProcessed")).longValue()
                    - ((Number) aval.get("pending")).longValue()
                    - ((Number) aval.get("processing")).longValue();
            ecarts.put(chaine.get(i - 1) + "→" + chaine.get(i), perdus);
        }
        return ecarts;
    }
}
```

Chez RssArchiver le 2026-10-26 : `src.totalProcessed` 68 242 contre `reader` 12 465.

---

## 7. Ce que la déduplication fait aux relances

Constat de lecture du code, confirmé en production (RssArchiver, 2026-10-26) :

1. `DagStageFunction.apply` inscrit `(étape, _mid)` dans le registre **avant** d'appeler le handler.
2. Le handler lève une exception, ou dépasse `timeoutMs` (V2 n'annule pas l'appel en cours).
3. V2 attend le backoff, puis `nack(requeue=true)` : le **même** message revient.
4. À la relance, le registre répond « déjà vu » : `apply` rend `null`, V2 **acquitte** et compte un succès.
5. Le message n'a produit aucune sortie et n'est pas en DLQ. L'exception d'origine n'est lue par personne.

Conséquences pratiques :

| Réglage | Effet réel |
|---|---|
| `maxRetries ≥ 1` (défaut 3) | **perte silencieuse** au premier échec |
| `maxRetries: 0` | premier échec → **DLQ, visible** (`dlq`, `totalFailed`, ligne `failed` en base) |
| `stage_retry` sans redémarrage | rejoue la DLQ… que la dédup écarte aussitôt |
| `backfill` du même payload | écarté jusqu'au prochain redémarrage |

D'où les règles de ce dossier : **`maxRetries: 0`** sur les étapes faillibles, relances **dans** le handler
ou la passerelle appelée, et réinjection pilotée par l'app avec `attempt` (§5).

Correctifs ouverts : côté socle, la PR `jmlmvi/V005#28` (2026-10-26) annule l'appel au dépassement de délai ;
côté pack, marquer la déduplication **après** un traitement réussi reste à faire.

---

## 8. Vérifier

```bash
curl -s "$APP/mcp" -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pipeline_worker__backfill",
       "arguments":{"run_key":"tri-demandes-a1b2c3d4",
                    "payloads":[{"id":"D1","texte":"urgent"},{"id":"D1","texte":"urgent"}]}}}' \
 | jq -r '.result.content[0].text'
```

En mode batch : `{"submitted":2,"processed":2,…}`, puis **une seule** ligne `tr_demande_decision` pour `D1`
et un seul passage de chaque étape dans `tr_pipeline_stage_run`.

```sql
SELECT stage_id, status, count(*)
  FROM schema_monapp.tr_pipeline_stage_run
 WHERE id_pipeline_run = (SELECT max(x_id) FROM schema_monapp.tr_pipeline_run WHERE run_key = 'tri-demandes-a1b2c3d4')
 GROUP BY 1, 2 ORDER BY 1, 2;
```

---

## 9. Validation

Tests 3 à 6 sur un run `batch` : c'est là que V2 applique `maxRetries` et range la DLQ sous l'id d'étape.

| # | Test | Attendu |
|---|---|---|
| 1 | `backfill` de deux payloads identiques | une seule sortie |
| 2 | Même `backfill` avec `attempt` 1 puis 2 | deux sorties |
| 3 | Handler qui lève une fois, `maxRetries: 3` | aucune sortie, `dlq=0`, `totalFailed=0` : **c'est le défaut du §7** |
| 4 | Même handler, `maxRetries: 0` | `dlq=1`, ligne `failed` dans `tr_pipeline_stage_run` |
| 5 | `stage_retry` juste après le test 4 | `replayed=1`, aucune sortie (dédup) |
| 6 | Redémarrer, `resume_run`, `run_resume`, `stage_retry` | message rejoué et traité (backends `techdb`/`nats` ; DLQ perdue en `memory`) |

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Relances V2 jetées par la dédup** | éléments bloqués, `dlq=0`, `totalFailed=0` | `maxRetries: 0`, relances dans le handler, réinjection avec `attempt` |
| **Dépassement de `timeoutMs`** | l'appel continue après coup, la relance est jetée | timeouts internes inférieurs à `timeoutMs` |
| Croire `stage_retry` efficace à chaud | `replayed > 0` mais rien ne sort | réinjecter avec `attempt`, ou recompiler le run (`resume_run`) |
| Payloads égaux mais clés dans un autre ordre | traités deux fois : `_mid` dérive de `payload.toString()` | construire le payload toujours dans le même ordre |
| Champ variable dans le payload (horodatage, UUID) | la dédup ne déduplique plus rien | ne mettre que des données métier stables |
| Run long avec des centaines de milliers de messages | mémoire qui croît : le registre n'est jamais purgé | une clé de run par version ou par période, `run_cancel` des anciens |
| Compter sur la dédup après un redémarrage | doublons : le registre repart vide | effets de bord idempotents dans les Sinks (upsert) |
| Gate qui route vers deux arêtes vers la même étape | deux `_mid` distincts : l'étape traite deux fois | une seule arête par cible |
| Surveiller seulement `dlq` et `totalFailed` | pertes invisibles | comparer les `totalProcessed` (§6) |
| DLQ en backend `memory` | perdue au redémarrage | état métier côté app, réinjection |
| Échec en mode `step` puis `stage_retry` | `replayed: 0` : le pas-à-pas fait `nack(requeue=false)`, la file `memory` range le message sous l'étape `unknown`, et `stage_retry` filtre par `stage_id` (en `nats`, le message est abandonné) | réinjection par l'app ; `stage_retry` ne sert qu'aux runs `batch` |

---

## 11. Pour aller plus loin

- [[howto-pipeline-04-executer-un-run|PIPELINE-04]] — runs longs et runs unitaires
- [[howto-pipeline-07-observer-lineage-et-metriques|PIPELINE-07]] — lignes `failed` et durées par étape
- `APP-12-RssArchiver/rssarchiver/src/main/java/eu/lmvi/pipeline/CurationPipelineFeeder.java` — contournement en production
