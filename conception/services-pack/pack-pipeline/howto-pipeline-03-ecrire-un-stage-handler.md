# HOWTO PIPELINE-03 — Écrire un StageHandler (la logique métier d'une étape)

**Niveau :** Confirmé
**Cible :** application qui embarque `socle-pack-pipeline`
**Versions vérifiées au code :** `socle-pack-pipeline` 0.4.0 @ `2e477c2` (tag `v0.4.0`, `main` ; code identique à 0.3.0 @ `fef144d` ; code fonctionnel identique à 0.2.0 et à 0.1.0-SNAPSHOT @ `5fa8f05`) · `socle-v005` 5.11.0 (minimum 5.10.0) / Spring Boot 4.1.2 · date 2026-10-28
**Temps estimé :** 30 min par handler

> Classes de référence : `engine/StageHandler`, `engine/StageHandlerRegistry`, `engine/StageExecutionContext`,
> `engine/DagStageFunction`, `model/PipelineMessage`, `engine/handlers/*`

---

## 1. Contexte

Le pack sait router, paralléliser, parquer et tracer. Il ne sait **rien faire de métier** : appeler un LLM,
écrire dans une table, publier sur NATS. Tout cela vit dans des `StageHandler`, l'**unique point
d'extension** du moteur.

Un handler est une transformation `PipelineMessage → PipelineMessage`. Il ne route pas (le `StageRouter`
le fait d'après le DAG) et ne gère ni concurrence ni timeout (le `VThreadStageExecutor` de V2 le fait).

Cas de référence : **APP-12-RssArchiver** déclare 12 handlers sous `eu.lmvi.pipeline.handlers`
(`ReaderHandler`, `ScoreHandler`, `SummaryHandler`, `TranslateHandler`, `KewHandler`,
`ArticleSinkHandler`, `RejectSinkHandler`, `PgvectorSinkHandler`…). Chacun délègue à un service
(`CurationSteps`) et tient en une vingtaine de lignes.

---

## 2. Architecture

```
  message en file q.<runKey>.<stageId>
          │ claim (VThreadStageExecutor, `concurrency` vthreads)
          ▼
  DagStageFunction.apply(in)
   1. DedupRegistry.firstSee(stage, _mid) ── doublon ? → ignoré (rend null)
   2. contrat : params.requiredIn présents ? ── sinon IllegalArgumentException
   3. VOTRE HANDLER.handle(ctx, in) ─────────── exception → observer.onStageFailure → V2 (retry/DLQ)
   4. type H ? → HumanParkingService.park(out)
      sinon   → RunRecorder.onStageSuccess  (tr_pipeline_stage_run, tr_pipeline_metric, artefact si K)
              → StageRouter.route(out)      (arêtes sortantes / gardes du Gate)
```

Résolution du handler d'une étape : `StageDef.handler` s'il est renseigné, sinon le défaut du type
(`identity` pour S/T/E/G/H, `log` pour K, `composite` pour C).

---

## 3. Étape 1 — Le contrat de l'interface

```java
@FunctionalInterface
public interface StageHandler {
    PipelineMessage handle(StageExecutionContext ctx, PipelineMessage in);
    default String handlerName() { return getClass().getSimpleName().toLowerCase(); }
}
```

| Élément | Ce qu'il donne |
|---|---|
| `ctx.stage()` | le `StageDef` : `id()`, `stageType()`, `label()`, `params()`, `contractIn()`… |
| `ctx.params()` | `params` du DAG en `JsonNode`, jamais `null` (`MissingNode` si absent) |
| `ctx.paramText(champ, défaut)` | lecture texte d'un paramètre |
| `in.payload()` | la charge métier (`JsonNode`, `NullNode` si vide) |
| `in.runId()` | le `run_key` du run |
| `in.metadata()` | métadonnées ; `_mid` (idempotence) et `_depth` (Composite) sont **réservées** |
| `in.withPayload(nouveau, new LineageEntry(stageId, id))` | message dérivé, maillon de lineage empilé |
| `in.withMeta(clé, valeur)` | copie avec une métadonnée ajoutée |

Built-ins disponibles sans rien écrire :

| Nom | Classe | Paramètres | Effet |
|---|---|---|---|
| `identity` | `IdentityHandler` | — | rend le message tel quel |
| `set-field` | `SetFieldHandler` | `field`, `value` | pose un champ de premier niveau ; payload objet obligatoire |
| `merge-fields` | `MergeFieldsHandler` | `fields` (objet) | fusion superficielle dans le payload |
| `log` | `LogSinkHandler` | — | journalise `run` et `payload` en INFO |
| `collect` | `CollectSinkHandler` | — | retient le message en mémoire par `(runId, stageId)` ([[howto-pipeline-07-observer-lineage-et-metriques\|PIPELINE-07]]) |
| `composite` | `CompositeHandler` | `pipeline` (code) | exécute un sous-pipeline publié |

---

## 4. Étape 2 — Un handler d'enrichissement (E)

Il lit une table de mots-clés de l'app et pose une note sur 100. Le nom `monapp-note` est celui que
référence le DAG de [[howto-pipeline-02-declarer-valider-publier-un-dag|PIPELINE-02]].

```java
package eu.lmvi.monapp.pipeline.handlers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.lmvi.socle.pack.pipeline.engine.StageExecutionContext;
import eu.lmvi.socle.pack.pipeline.engine.StageHandler;
import eu.lmvi.socle.pack.pipeline.model.LineageEntry;
import eu.lmvi.socle.pack.pipeline.model.PipelineMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** E — note une demande d'après les mots-clés pondérés de schema_monapp.z_mot_cle. */
@Component
public class NoteHandler implements StageHandler {

    public static final String NAME = "monapp-note";

    private final JdbcTemplate jdbc;
    private final String schema;

    public NoteHandler(JdbcTemplate jdbc, @Value("${socle.pipeline.schema}") String schema) {
        this.jdbc = jdbc;
        this.schema = schema;
    }

    @Override
    public String handlerName() {
        return NAME;
    }

    @Override
    public PipelineMessage handle(StageExecutionContext ctx, PipelineMessage in) {
        JsonNode p = in.payload();
        if (p == null || !p.isObject()) {
            throw new IllegalArgumentException(NAME + " : payload objet attendu sur '" + ctx.stage().id() + "'");
        }
        String texte = p.path("texte").asText("").toLowerCase(Locale.ROOT);

        List<Map<String, Object>> mots = jdbc.queryForList(
                "SELECT mot, poids FROM " + schema + ".z_mot_cle WHERE x_active = true");
        int note = 0;
        for (Map<String, Object> m : mots) {
            if (texte.contains(((String) m.get("mot")).toLowerCase(Locale.ROOT))) {
                note += ((Number) m.get("poids")).intValue();
            }
        }
        ObjectNode out = ((ObjectNode) p).deepCopy();
        out.put("note", Math.max(0, Math.min(100, note)));
        return in.withPayload(out, new LineageEntry(ctx.stage().id(), UUID.randomUUID().toString()));
    }
}
```

---

## 5. Étape 3 — Un handler terminal (K) idempotent

Le même handler sert trois Sinks, distingués par `params.statut`. L'écriture est un **upsert** : rejouer
le message ne crée pas de doublon.

```java
package eu.lmvi.monapp.pipeline.handlers;

import com.fasterxml.jackson.databind.JsonNode;
import eu.lmvi.socle.pack.pipeline.engine.StageExecutionContext;
import eu.lmvi.socle.pack.pipeline.engine.StageHandler;
import eu.lmvi.socle.pack.pipeline.model.PipelineMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** K — enregistre la décision dans schema_monapp.tr_demande_decision (upsert sur id_demande). */
@Component
public class EnregistreHandler implements StageHandler {

    public static final String NAME = "monapp-enregistre";

    private final JdbcTemplate jdbc;
    private final String schema;

    public EnregistreHandler(JdbcTemplate jdbc, @Value("${socle.pipeline.schema}") String schema) {
        this.jdbc = jdbc;
        this.schema = schema;
    }

    @Override
    public String handlerName() {
        return NAME;
    }

    @Override
    public PipelineMessage handle(StageExecutionContext ctx, PipelineMessage in) {
        String statut = ctx.paramText("statut", null);
        if (statut == null) {
            throw new IllegalArgumentException(NAME + " : params.statut requis sur '" + ctx.stage().id() + "'");
        }
        JsonNode p = in.payload();
        jdbc.update("INSERT INTO " + schema + ".tr_demande_decision (id_demande, statut, note, run_key, datas) "
                        + "VALUES (?, ?, ?, ?, ?::jsonb) "
                        + "ON CONFLICT (id_demande) DO UPDATE SET statut = EXCLUDED.statut, note = EXCLUDED.note, "
                        + "run_key = EXCLUDED.run_key, datas = EXCLUDED.datas",
                p.path("id").asText(), statut, p.path("note").asInt(0), in.runId(), p.toString());
        return in;   // jamais null : le moteur lèverait « le handler a renvoyé null »
    }
}
```

DDL côté app (le pack ne crée pas les tables métier) :

```sql
CREATE TABLE IF NOT EXISTS schema_monapp.z_mot_cle (
    x_id BIGSERIAL PRIMARY KEY, x_active BOOLEAN DEFAULT true,
    mot VARCHAR(100) NOT NULL, poids INTEGER NOT NULL, datas JSONB);

CREATE TABLE IF NOT EXISTS schema_monapp.tr_demande_decision (
    x_id BIGSERIAL PRIMARY KEY, x_dateCreated TIMESTAMPTZ NOT NULL DEFAULT now(),
    id_demande VARCHAR(100) NOT NULL UNIQUE, statut VARCHAR(30) NOT NULL,
    note INTEGER, run_key VARCHAR(100), datas JSONB);
```

---

## 6. Étape 4 — Enregistrement

Rien à déclarer : `StageHandlerRegistry` reçoit **tous les beans `StageHandler`** à sa construction
(`List<StageHandler>`) et les indexe par `handlerName()`. Un bean qui reprend le nom d'un built-in le
**remplace** (journal `handler 'log' surchargé (LogSinkHandler → …)`).

Hors contexte Spring (essai unitaire), `new StageHandlerRegistry()` puis `register(handler)`.

---

## 7. Étape 5 — Tester un handler seul

```java
package eu.lmvi.monapp.pipeline.handlers;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.lmvi.socle.pack.pipeline.engine.StageExecutionContext;
import eu.lmvi.socle.pack.pipeline.engine.handlers.SetFieldHandler;
import eu.lmvi.socle.pack.pipeline.model.PipelineMessage;
import eu.lmvi.socle.pack.pipeline.model.StageDef;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SetFieldHandlerContractTest {

    private final ObjectMapper om = new ObjectMapper();

    @Test
    void poseLeChampEtEmpileLeLineage() {
        ObjectNode params = om.createObjectNode().put("field", "etat").put("value", "normalisee");
        StageDef stage = new StageDef("normalise", "T", "set-field", null, params, null, null, null);
        PipelineMessage in = PipelineMessage.initial("run-test", om.createObjectNode().put("id", "D1"));

        PipelineMessage out = new SetFieldHandler().handle(new StageExecutionContext(stage), in);

        assertEquals("normalisee", out.payload().get("etat").asText());
        assertEquals(1, out.lineage().size());
        assertEquals("normalise", out.lineage().get(0).stageId());
    }

    @Test
    void refuseUnPayloadQuiNestPasUnObjet() {
        StageDef stage = new StageDef("normalise", "T", "set-field", null,
                om.createObjectNode().put("field", "etat"), null, null, null);
        PipelineMessage in = PipelineMessage.initial("run-test", om.getNodeFactory().textNode("brut"));
        assertThrows(IllegalArgumentException.class,
                () -> new SetFieldHandler().handle(new StageExecutionContext(stage), in));
    }
}
```

Les handlers qui touchent la base se testent avec un PostgreSQL réel (Testcontainers), comme le pack
lui-même : clause NO-SIMULATION.

---

## 8. Vérifier

```bash
curl -s "$APP/mcp" -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pipeline_worker__list_handlers","arguments":{}}}' \
 | jq -r '.result.content[0].text'
```

Attendu : `monapp-enregistre` et `monapp-note` dans la liste. Un DAG qui référence un nom absent se
**valide** quand même ; l'échec arrive à `instantiate` : `handler inconnu: 'x' (enregistrés: […])`.

---

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Démarrer l'app | journal `StageHandlerRegistry initialisé — 8 handlers` (6 + 2) |
| 2 | Un DAG référence `monapp-inexistant` puis `instantiate` | échec `handler inconnu` |
| 3 | Le handler rend `null` | ligne `tr_pipeline_stage_run` en `failed`, message `le handler 'x' a renvoyé null` |
| 4 | Rejouer deux fois le même message jusqu'au Sink | une seule ligne `tr_demande_decision` (upsert) |
| 5 | `params.requiredIn: ["/texte"]` et payload sans `texte` | échec avant l'appel du handler : `contrat d'entrée violé` |

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Le handler lève une exception passagère** | le message est **perdu** à la relance : la dédup le jette et V2 le compte réussi ([[howto-pipeline-06-idempotence-backfill-et-dlq\|PIPELINE-06]] §7) | relancer **dans** le handler (ou la passerelle appelée) ; `maxRetries: 0` dans le DAG |
| **Le handler dépasse `timeoutMs`** | V2 ne l'interrompt pas : l'appel continue, ses effets arrivent après coup, et la relance est jetée | timeouts propres (client HTTP, requête SQL) **inférieurs** à `timeoutMs` |
| Handler non thread-safe | données mélangées dès `concurrency > 1` | aucun état mutable de champ ; tout en variables locales |
| Effet de bord non idempotent dans un K | doublons en base après un `backfill` ou un `resume_run` | upsert, clé métier unique |
| Handler qui injecte `PipelineWorker` ou `PipelineRuntimeManager` | cycle de beans au démarrage (registre → handler → worker → registre) | injection `@Lazy`, comme `SubPipelineRunner` le fait pour `DagPipelineBuilder` |
| Rendre `null` pour « ne rien router » | l'étape échoue | pour arrêter une branche : un Gate avec garde, ou un K |
| Deux handlers avec le même `handlerName()` | le dernier enregistré gagne, en silence hormis un INFO | noms préfixés par l'app (`monapp-…`, `rss-…`) |
| `handlerName()` non surchargé | nom = nom de classe en minuscules (`notehandler`) | toujours surcharger avec une constante `NAME` |
| Écrire `_mid` ou `_depth` dans les métadonnées | idempotence ou garde de profondeur faussées | choisir d'autres clés |
| Appeler un service du Hub en dur | divergence avec la plateforme | consommer le service du Hub par sa porte ([[howto-37-publier-des-messages-nats-depuis-une-app\|HOWTO 37]] pour NATS) |

---

## 11. Pour aller plus loin

- [[howto-pipeline-04-executer-un-run|PIPELINE-04]] — exécuter le DAG qui utilise ces handlers
- [[howto-pipeline-06-idempotence-backfill-et-dlq|PIPELINE-06]] — ce que « exactly-once » couvre réellement
- `APP-12-RssArchiver/rssarchiver/src/main/java/eu/lmvi/pipeline/handlers/` — 12 handlers en production
