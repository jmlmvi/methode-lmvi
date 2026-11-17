# HOWTO PIPELINE-03 — Écrire un StageHandler (la logique métier d'une étape)

**Niveau :** Confirmé
**Cible :** application qui embarque `socle-pack-pipeline`
**Versions vérifiées au code :** `socle-pack-pipeline` **0.5.0**, branche `feat/0.5.0`, non commitée au 2026-11-12 (descripteur, paramètres résolus, credentials, contexte d'appel) · 0.4.0 @ `2e477c2` (tag `v0.4.0`) pour le reste, inchangé · `socle-v005` 5.11.0 (minimum 5.10.0) / Spring Boot 4.1.2 · date 2026-11-12
**Temps estimé :** 30 min par handler

> Classes de référence : `engine/StageHandler`, `engine/HandlerDescriptor`, `engine/StageHandlerRegistry`,
> `engine/StageExecutionContext`, `engine/PipelineCallContext`, `credential/CredentialAccess`,
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
   3. (0.5.0) expressions {{ … }} des params résolues contre `in` ; contexte d'appel posé (PipelineCallScope)
   4. VOTRE HANDLER.handle(ctx, in) ─────────── exception → (masquée si un secret a été lu)
                                                 → observer.onStageFailure → V2 (retry/DLQ)
   5. (0.5.0) secrets lus → "***" dans le payload sortant ; sortie rangée dans metadata._steps[stageId]
   6. type H ? → HumanParkingService.park(out)
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
    default HandlerDescriptor descriptor() { return HandlerDescriptor.minimal(handlerName()); }   // 0.5.0
}
```

`StageExecutionContext` est en 0.5.0 un record `(StageDef stage, CredentialAccess credentials,
PipelineCallContext call, StageDef declared)`. Le constructeur historique `new StageExecutionContext(stage)`
reste (ni credentials ni contexte d'appel) : les essais unitaires de 0.4.0 compilent sans changement.

| Élément | Ce qu'il donne |
|---|---|
| `ctx.stage()` | le `StageDef` : `id()`, `stageType()`, `label()`, `params()`, `contractIn()`… — **paramètres déjà résolus** (0.5.0) |
| `ctx.params()` | `params` en `JsonNode`, expressions `{{ … }}` déjà remplacées, jamais `null` (`MissingNode` si absent) |
| `ctx.paramText(champ, défaut)` | lecture texte d'un paramètre |
| `ctx.paramInt(champ, défaut)`, `ctx.paramBool(champ, défaut)` | lecture entière / booléenne (0.5.0) |
| `ctx.declaredParam(champ)` | le paramètre **tel qu'écrit dans le DAG**, avant résolution (0.5.0) — pour les contrôles de sécurité : refuser qu'une valeur venue du message choisisse une cible |
| `ctx.credentials()` | `CredentialAccess` (0.5.0) : `typeOf(code)`, `get(code)` → `Map<String,String>` des champs. Chaque valeur secrète lue est masquée par le moteur dans la sortie et l'erreur. Jamais `null` ; sans résolveur, `get` lève |
| `ctx.call()` | `PipelineCallContext` (0.5.0) : `pipelineCode()`, `runKey()`, `tenant()`, `owner()`, `eventId()`, `chain()`, `chainForChildren()` — à transmettre à tout appel sortant (droits côté hôte, décision D6) |
| `in.payload()` | la charge métier (`JsonNode`, `NullNode` si vide) |
| `in.runId()` | le `run_key` du run |
| `in.metadata()` | métadonnées ; `_mid` (idempotence), `_depth` (Composite) et `_steps` (sorties des étapes, pour `{{ $etape("id") }}`, 0.5.0) sont **réservées** |
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
| `http` (0.5.0) | `HttpHandler` | `url`, `method`, `headers`, `query`, `body`, `credential`… | appel HTTP, réponse ajoutée au message ([[howto-pipeline-10-credentials-http-et-actions\|PIPELINE-10]]) |
| `mcp_action` (0.5.0) | `McpActionHandler` | `worker`, `action`, `params`, `output` | appel d'une action d'un worker de l'app ([[howto-pipeline-10-credentials-http-et-actions\|PIPELINE-10]]) |

---

## 3 bis. Étape 1 bis — Le descripteur (0.5.0)

`descriptor()` dit ce que le handler est : de quoi dessiner sa palette et son formulaire dans un studio, et
de quoi vérifier le DAG. `list_handlers` rend les descripteurs sous `descriptors` ; la validation **V7**
refuse un DAG où un paramètre marqué requis manque ([[howto-pipeline-02-declarer-valider-publier-un-dag|PIPELINE-02]]).

| Champ de `HandlerDescriptor` | Rôle |
|---|---|
| `name` | nom logique (celui de `StageDef.handler`) ; le nom d'enregistrement fait foi dans `list_handlers` |
| `label`, `category`, `icon`, `description` | palette (icône : nom lucide) |
| `stageTypes` | types d'étape où le handler a un sens (`S/T/E/G/K/H/C`) |
| `paramsSchema` | schéma JSON `{type: object, properties, required}` ; seul `required` est vérifié (V7) |
| `credentialTypes` | types de credential acceptés (vide : aucun) |

Sans surcharge, `HandlerDescriptor.minimal(nom)` : catégorie `autre`, types `T`/`E`, aucun paramètre requis.
`HandlerDescriptor.Schema` écrit le schéma sans JSON à la main.

---

## 4. Étape 2 — Un handler d'enrichissement (E)

Il lit une table de mots-clés de l'app et pose une note sur 100. Le nom `monapp-note` est celui que
référence le DAG de [[howto-pipeline-02-declarer-valider-publier-un-dag|PIPELINE-02]].

```java
package eu.lmvi.monapp.pipeline.handlers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.lmvi.socle.pack.pipeline.engine.HandlerDescriptor;
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
    public HandlerDescriptor descriptor() {
        return new HandlerDescriptor(NAME, "Note par mots-clés", "transformer", "gauge",
                "Pose une note sur 100 d'après les mots-clés pondérés de l'app.",
                List.of("E", "T"),
                HandlerDescriptor.Schema.object().build(),   // aucun paramètre
                List.of());
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
import eu.lmvi.socle.pack.pipeline.engine.HandlerDescriptor;
import eu.lmvi.socle.pack.pipeline.engine.StageExecutionContext;
import eu.lmvi.socle.pack.pipeline.engine.StageHandler;
import eu.lmvi.socle.pack.pipeline.model.PipelineMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

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
    public HandlerDescriptor descriptor() {   // 0.5.0 : V7 refuse un DAG sans params.statut
        return new HandlerDescriptor(NAME, "Enregistrer la décision", "sortie", "database",
                "Enregistre la décision de la demande (upsert).", List.of("K"),
                HandlerDescriptor.Schema.object()
                        .prop("statut", "string", "Statut enregistré (acceptee, rejetee, acceptee_auto)", true)
                        .build(),
                List.of());
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

## 5 bis. Étape 3 bis — Un handler qui lit un credential (0.5.0)

Pour un appel HTTP ordinaire, le handler `http` suffit ([[howto-pipeline-10-credentials-http-et-actions|PIPELINE-10]]).
Un handler maison lit un credential quand il parle un protocole propre (client SDK, SMTP…). Le code du
credential s'écrit dans le DAG (`params.credential`) ; la valeur ne passe que par `ctx.credentials()`, et le
moteur masque dans la sortie et dans l'erreur toute valeur secrète lue.

```java
package eu.lmvi.monapp.pipeline.handlers;

import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.lmvi.socle.pack.pipeline.credential.CredentialTypes;
import eu.lmvi.socle.pack.pipeline.engine.HandlerDescriptor;
import eu.lmvi.socle.pack.pipeline.engine.StageExecutionContext;
import eu.lmvi.socle.pack.pipeline.engine.StageHandler;
import eu.lmvi.socle.pack.pipeline.model.LineageEntry;
import eu.lmvi.socle.pack.pipeline.model.PipelineMessage;
import eu.lmvi.socle.pack.pipeline.util.PipelineJson;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** E — interroge le service tiers de l'app avec la clé d'API du tenant (credential api_key). */
@Component
public class TiersHandler implements StageHandler {

    public static final String NAME = "monapp-tiers";

    private final ClientTiers client;   // client du service tiers, propre à l'app

    public TiersHandler(ClientTiers client) {
        this.client = client;
    }

    @Override
    public String handlerName() {
        return NAME;
    }

    @Override
    public HandlerDescriptor descriptor() {
        return new HandlerDescriptor(NAME, "Service tiers", "appel", "plug",
                "Interroge le service tiers avec la clé d'API du tenant.", List.of("E"),
                HandlerDescriptor.Schema.object()
                        .prop("credential", "string", "Code du credential api_key", true)
                        .prop("reference", "string", "Référence à chercher (expressions admises)", true)
                        .build(),
                List.of(CredentialTypes.API_KEY));
    }

    @Override
    public PipelineMessage handle(StageExecutionContext ctx, PipelineMessage in) {
        String code = ctx.paramText("credential", null);
        if (ctx.declaredParam("credential").asText("").contains("{{")) {
            throw new IllegalArgumentException(NAME + " : credential calculé refusé sur '" + ctx.stage().id() + "'");
        }
        if (!CredentialTypes.API_KEY.equals(ctx.credentials().typeOf(code))) {
            throw new IllegalArgumentException(NAME + " : credential '" + code + "' de type api_key attendu");
        }
        Map<String, String> c = ctx.credentials().get(code);          // retenu pour le masquage
        String reference = ctx.paramText("reference", "");           // déjà résolu : {{ $json.ref }} → valeur
        Map<String, Object> reponse = client.chercher(c.get("key"), reference, ctx.call().tenant());

        ObjectNode out = in.payload().isObject() ? ((ObjectNode) in.payload()).deepCopy()
                : PipelineJson.mapper().createObjectNode();
        out.set("tiers", PipelineJson.mapper().valueToTree(reponse));
        return in.withPayload(out, new LineageEntry(ctx.stage().id(), UUID.randomUUID().toString()));
    }
}
```

`ClientTiers` est un service de l'app (non fourni par le pack). V7 vérifie au `validate` que `credential` est
écrit en dur dans le DAG ; le contrôle par `declaredParam` couvre l'exécution.

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

Attendu : `monapp-enregistre` et `monapp-note` dans `handlers`, et leur descripteur dans `descriptors`.
Depuis 0.5.0, un DAG qui référence un nom absent est **refusé à la validation** (V7 : `handler inconnu 'x'`),
donc aussi à `define` ; jusqu'en 0.4.0, l'échec n'arrivait qu'à `instantiate`.

---

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Démarrer l'app | journal `StageHandlerRegistry initialisé — 10 handlers` (8 du pack en 0.5.0, dont `http` et `mcp_action`, + 2) |
| 2 | `validate` d'un DAG qui référence `monapp-inexistant` | erreur V7 `handler inconnu 'monapp-inexistant'` |
| 2 bis | `validate` d'un DAG avec `monapp-enregistre` sans `params.statut` | erreur V7 `paramètre requis 'statut' absent` |
| 2 ter | `list_handlers` | `descriptors[name=monapp-enregistre].paramsSchema.required = ["statut"]` |
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
| Écrire `_mid`, `_depth` ou `_steps` dans les métadonnées | idempotence, garde de profondeur ou `{{ $etape(...) }}` faussées | choisir d'autres clés |
| (0.5.0) Résoudre soi-même les `{{ … }}` | double résolution, ou texte littéral `{{ $json.x }}` attendu | les paramètres arrivent **déjà résolus** ; lire `ctx.declaredParam` seulement pour un contrôle |
| (0.5.0) Journaliser, ou ranger en métadonnée, une valeur de `ctx.credentials().get(...)` | fuite : le moteur ne masque que le payload sortant et l'erreur | ne jamais journaliser un secret ; rien de secret dans `metadata` |
| (0.5.0) Handler écrit pour un pipeline **déclenché** | les retries par étape n'y jouent pas (run pas-à-pas en mémoire, [[howto-pipeline-11-declencheurs-et-file-dediee\|PIPELINE-11]] §12) ; seule la file rejoue, tout le run | relancer l'appel passager dans le handler ; effets idempotents |
| (0.5.0) Paramètre requis non déclaré dans `descriptor()` | V7 ne le voit pas ; l'échec arrive à l'exécution | déclarer `required` dans le schéma |
| (0.5.0) Payload qui grossit à chaque étape | chaque étape range sa sortie dans `metadata._steps` | voulu (`$etape`) ; éviter de longues chaînes d'étapes sur de gros payloads |
| Appeler un service du Hub en dur | divergence avec la plateforme | consommer le service du Hub par sa porte ([[howto-37-publier-des-messages-nats-depuis-une-app\|HOWTO 37]] pour NATS) |

---

## 11. Pour aller plus loin

- [[howto-pipeline-04-executer-un-run|PIPELINE-04]] — exécuter le DAG qui utilise ces handlers
- [[howto-pipeline-10-credentials-http-et-actions|PIPELINE-10]] — `http`, `mcp_action`, credentials et expressions (0.5.0)
- [[howto-pipeline-06-idempotence-backfill-et-dlq|PIPELINE-06]] — ce que « exactly-once » couvre réellement
- `APP-12-RssArchiver/rssarchiver/src/main/java/eu/lmvi/pipeline/handlers/` — 12 handlers en production
