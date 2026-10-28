# HOWTO PIPELINE-02 — Déclarer, valider et publier un DAG

**Niveau :** Confirmé
**Cible :** application qui embarque `socle-pack-pipeline` ([[howto-pipeline-01-integrer-le-pack|PIPELINE-01]] fait)
**Versions vérifiées au code :** `socle-pack-pipeline` 0.2.0 @ `4cb5aa6` (branche `feat/boot4`, code fonctionnel identique à 0.1.0-SNAPSHOT @ `5fa8f05`) · `socle-v005` 5.9.0 / Spring Boot 4.0.6 · date 2026-10-28
**Temps estimé :** 30 min

> Classes de référence : `model/TypePipeline`, `StageDef`, `EdgeDef`, `GuardDef`, `StageConfigDef`,
> `validation/DagValidator`, `engine/GuardEvaluator`, `view/ReactFlowProjection`

---

## 1. Contexte

Un pipeline du pack est un **template** : un document JSON qui décrit des étapes (nœuds), des arêtes et des
gardes. Il passe par trois états dans `db_pipeline_type.status` :

```
define ──► draft ──publish──► published ──instantiate──► run figé (tr_pipeline_run.frozen_graph)
   ▲                                                          │
   └──────── fork (nouveau code, nouveau draft) ◄─────────────┘
```

Le template publié reste modifiable par une **nouvelle version** (`define` avec un autre `version_label`).
Un run déjà instancié garde sa copie figée du graphe : modifier le template ne change pas un run en cours.

Cas de référence : le DAG `rss-editorial` d'**APP-12-RssArchiver**
(`rssarchiver/src/main/resources/pipeline/rss-editorial.json`, 12 étapes, un Gate à trois sorties),
publié au démarrage par `eu.lmvi.pipeline.PipelineDefinitionRunner`.

---

## 2. Architecture

```
   JSON du DAG                         PipelineWorker
 ┌──────────────┐   validate   ┌──────────────────────────┐
 │ code, label  │ ───────────► │ PipelineJson.parse        │
 │ executionMode│              │ DagValidator  V1…V6       │──► { valid, errors[], warnings[] }
 │ stages[]     │   define     │   └ GuardEvaluator        │
 │ edges[]      │ ───────────► │ PipelineRepository        │──► db_pipeline_type (draft)
 │ guards[]     │   publish    │   insertType/publishType  │──► status = published
 └──────────────┘              └──────────────────────────┘
                     graph_view ─► ReactFlowProjection ─► { nodes[], edges[] } (constructeur visuel)
```

---

## 3. Étape 1 — Écrire le DAG

### 3.1 Les sept types d'étapes

| Code | Rôle | Handler par défaut | Comportement du moteur |
|---|---|---|---|
| **S** | Source, point d'entrée | `identity` | reçoit le message soumis par `run_start` / `backfill` |
| **T** | Transform | `identity` | transforme le payload, route vers **toutes** ses arêtes sortantes |
| **E** | Enrich | `identity` | idem T ; convention : appel à un service externe |
| **G** | Gate | `identity` | route vers **chaque** arête dont la garde est vraie, sinon vers la branche sans garde |
| **K** | Sink | `log` | persiste ou publie ; produit un `tr_pipeline_artifact` |
| **H** | Human | `identity` | **parque** le message jusqu'à `human_resolve` ([[howto-pipeline-05-human-in-the-loop-et-reprise\|PIPELINE-05]]) |
| **C** | Composite | `composite` | exécute un sous-pipeline publié ([[howto-pipeline-08-catalogue-fork-et-sous-pipelines\|PIPELINE-08]]) |

T et E ne diffèrent que par l'intention : le moteur les traite de la même façon.

### 3.2 Un DAG complet

`src/main/resources/pipeline/tri-demandes.json` :

```json
{
  "code": "tri-demandes",
  "label": "Tri des demandes entrantes",
  "description": "Normalise, note, puis oriente : validation humaine au-dessus de 70, rejet sous 30.",
  "executionMode": "batch",
  "stages": [
    { "id": "src",      "type": "S", "label": "Demande reçue" },
    { "id": "normalise","type": "T", "handler": "set-field",
      "params": { "field": "etat", "value": "normalisee", "requiredIn": ["/id", "/texte"] },
      "contractOut": "demande.v1",
      "config": { "concurrency": 2, "timeoutMs": 5000, "maxRetries": 0 } },
    { "id": "note",     "type": "E", "handler": "monapp-note",
      "contractIn": "demande.v1", "contractOut": "demande.notee.v1",
      "config": { "concurrency": 4, "timeoutMs": 60000, "maxRetries": 0 } },
    { "id": "gate",     "type": "G", "label": "Orientation par note",
      "config": { "timeoutMs": 2000, "maxRetries": 0 } },
    { "id": "revue",    "type": "H", "label": "Validation par un instructeur",
      "config": { "timeoutMs": 2000, "maxRetries": 0 } },
    { "id": "accepte",  "type": "K", "handler": "monapp-enregistre",
      "params": { "statut": "acceptee" },
      "config": { "concurrency": 2, "timeoutMs": 10000, "maxRetries": 0 } },
    { "id": "rejet",    "type": "K", "handler": "monapp-enregistre",
      "params": { "statut": "rejetee" },
      "config": { "concurrency": 1, "timeoutMs": 10000, "maxRetries": 0 } },
    { "id": "auto",     "type": "K", "handler": "monapp-enregistre",
      "params": { "statut": "acceptee_auto" },
      "config": { "concurrency": 1, "timeoutMs": 10000, "maxRetries": 0 } }
  ],
  "edges": [
    { "id": "e1", "from": "src",       "to": "normalise" },
    { "id": "e2", "from": "normalise", "to": "note" },
    { "id": "e3", "from": "note",      "to": "gate" },
    { "id": "e4", "from": "gate",      "to": "revue", "guard": "g_haut" },
    { "id": "e5", "from": "gate",      "to": "rejet", "guard": "g_bas" },
    { "id": "e6", "from": "gate",      "to": "auto" },
    { "id": "e7", "from": "revue",     "to": "accepte" }
  ],
  "guards": [
    { "id": "g_haut", "pointer": "/note", "op": "GTE", "value": "70" },
    { "id": "g_bas",  "pointer": "/note", "op": "LT",  "value": "30" }
  ]
}
```

`monapp-note` et `monapp-enregistre` sont des handlers de l'app ([[howto-pipeline-03-ecrire-un-stage-handler|PIPELINE-03]]).
`maxRetries: 0` est délibéré : voir [[howto-pipeline-06-idempotence-backfill-et-dlq|PIPELINE-06]] §7.

### 3.3 Référence des champs

**Racine (`TypePipeline`)** : `code` (slug, ≤ 150 car.), `label`, `description`, `executionMode`
(`batch` par défaut, ou `step`), `stages[]`, `edges[]`, `guards[]`. Tout autre champ est **ignoré**
(`FAIL_ON_UNKNOWN_PROPERTIES=false`).

**Étape (`StageDef`)** : `id` (unique), `type` (`S|T|E|G|K|H|C`, casse libre), `handler` (nom d'un
`StageHandler` enregistré), `label`, `params` (objet libre transmis au handler), `contractIn`,
`contractOut` (noms de contrat), `config`.

**Réglages d'exécution (`StageConfigDef` → `StageConfig` du framework V2)** :

| Champ | Défaut appliqué | Rôle |
|---|---|---|
| `concurrency` | 1 | nombre de vthreads consommateurs de l'étape |
| `queueSize` | 256 | capacité de la file |
| `timeoutMs` | 30 000 | délai max d'un appel au handler |
| `maxRetries` | 3 | relances V2 avant DLQ |
| `backoffBaseMs` | 200 | premier délai de relance |
| `backoffMultiplier` | 2.0 | facteur exponentiel |
| `optional` | false | transmis à V2 |

**Arête (`EdgeDef`)** : `id` (unique), `from`, `to`, `guard` (id d'une garde, facultatif).

**Garde (`GuardDef`)** : `id`, `pointer` (JSON Pointer dans le payload, `/note`), `op`, `value` (toujours
une **chaîne**, comparée numériquement quand les deux côtés sont numériques).

| `op` | Vrai quand | `value` |
|---|---|---|
| `EQ` / `NEQ` | égalité textuelle, ou numérique si les deux côtés sont des nombres | requise |
| `GT` `GTE` `LT` `LTE` | comparaison numérique ; faux si le champ n'est pas numérique | nombre requis |
| `EXISTS` / `ABSENT` | champ présent et non `null` / absent ou `null` | — |
| `TRUE` / `FALSE` | `asBoolean` du champ | — |
| `MATCHES` | la regex Java **trouve** une occurrence (`find`, pas `matches`) | regex requise |

**Contrats** :

- à la validation (V4), `contractOut` amont et `contractIn` aval doivent être **la même chaîne** ;
- à l'exécution, seul `params.requiredIn` (liste de JSON Pointers) est vérifié : un champ absent ou `null`
  lève une erreur avant l'appel du handler.

---

## 4. Étape 2 — Valider

```java
ActionResult v = pipeline.executeAction("validate",
        ActionParameters.fromMap(Map.of("graph", graphe)), null);
```

`graphe` est une `Map<String,Object>` ou un `JsonNode`. La réponse est toujours un succès, le verdict est
dans les données :

```json
{ "valid": true,
  "summary": "…",
  "errors": [],
  "warnings": [ { "code": "V6", "message": "stage 'x' : aucun bloc config — défauts appliqués (retry=3, timeout=30s)" } ] }
```

| Code | Règle | Niveau |
|---|---|---|
| `STRUCT` | ids d'étapes et d'arêtes présents et uniques, `from`/`to` connus, type reconnu | erreur, arrête la validation |
| `V1` | aucun cycle | erreur |
| `V2` | ≥ 1 Source, ≥ 1 Sink, un Sink atteignable depuis une Source | erreur |
| `V3` | toute étape hors S a une entrée ; toute étape hors K a une sortie ; aucune étape isolée | erreur |
| `V4` | `contractOut` amont = `contractIn` aval | erreur si différents, avertissement si l'amont n'en déclare pas |
| `V5` | gardes décidables et existantes ; un Gate a ≥ 1 arête gardée et ≤ 1 branche par défaut | erreur ; avertissement si Gate sans défaut, ou garde sur un non-Gate |
| `V6` | `timeoutMs > 0`, `maxRetries ≥ 0`, `concurrency ≥ 1` | erreur ; avertissement si `config` absent (hors S) |

---

## 5. Étape 3 — Définir et publier, de façon idempotente

`define` valide, puis insère un **draft**. `publish` revalide et passe au statut `published`. Le service
ci-dessous reprend le principe de RssArchiver : la version porte l'empreinte du JSON, et rien n'est fait si
cette version est déjà publiée.

```java
package eu.lmvi.monapp.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;

/** Publie au démarrage le DAG embarqué, versionné par l'empreinte de son JSON. */
@Component
@Order(10)
public class TriDemandesPublisher implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(TriDemandesPublisher.class);
    static final String CODE = "tri-demandes";
    private static final String RESOURCE = "/pipeline/tri-demandes.json";

    private final PipelineWorker pipeline;
    private final JdbcTemplate jdbc;
    private final String schema;
    private final ObjectMapper mapper = new ObjectMapper();

    public TriDemandesPublisher(PipelineWorker pipeline, JdbcTemplate jdbc,
                                @Value("${socle.pipeline.schema}") String schema) {
        this.pipeline = pipeline;
        this.jdbc = jdbc;
        this.schema = schema;
    }

    @Override
    @SuppressWarnings("unchecked")
    public void run(ApplicationArguments args) throws Exception {
        String json;
        try (var in = getClass().getResourceAsStream(RESOURCE)) {
            json = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        String versionLabel = "app-" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8)), 0, 4);

        // L'index unique (x_partition, code, version_label) ne protège pas : x_partition est NULL.
        // On vérifie donc soi-même avant d'insérer.
        Integer deja = jdbc.queryForObject(
                "SELECT count(*) FROM " + schema + ".db_pipeline_type WHERE code = ? AND version_label = ?",
                Integer.class, CODE, versionLabel);
        if (deja != null && deja > 0) {
            log.info("[pipeline] {} {} déjà défini", CODE, versionLabel);
            publierSiBesoin(versionLabel);
            return;
        }

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("graph", mapper.readValue(json, Map.class));
        params.put("version_label", versionLabel);
        ActionResult def = pipeline.executeAction("define", ActionParameters.fromMap(params), null);
        if (!def.success()) {
            throw new IllegalStateException("DAG " + CODE + " refusé : " + def.error());
        }
        log.info("[pipeline] {} défini type_id={} avertissements={}",
                CODE, def.data().get("type_id"), def.data().get("warnings"));
        publierSiBesoin(versionLabel);
    }

    private void publierSiBesoin(String versionLabel) {
        Long typeId = jdbc.queryForObject(
                "SELECT x_id FROM " + schema + ".db_pipeline_type WHERE code = ? AND version_label = ? "
                        + "ORDER BY x_id DESC LIMIT 1", Long.class, CODE, versionLabel);
        ActionResult pub = pipeline.executeAction("publish",
                ActionParameters.fromMap(Map.of("type_id", typeId)), null);
        if (!pub.success()) {
            throw new IllegalStateException("publication de " + CODE + " refusée : " + pub.error());
        }
        log.info("[pipeline] {} publié (type_id={})", CODE, typeId);
    }
}
```

Publier par `type_id` plutôt que par `code` est volontaire : `code` désigne **la dernière ligne insérée**
pour ce code, quel que soit son statut (§9).

Les mêmes opérations par MCP :

```bash
APP=https://monapp.thesocle.net
H=(-H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json"
   -H "Accept: application/json, text/event-stream")

curl -s "$APP/mcp" "${H[@]}" -d "$(jq -n --slurpfile g tri-demandes.json \
  '{jsonrpc:"2.0",id:1,method:"tools/call",
    params:{name:"pipeline_worker__define",arguments:{graph:$g[0],version_label:"v2"}}}')"

curl -s "$APP/mcp" "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
  "params":{"name":"pipeline_worker__publish","arguments":{"type_id":42}}}'
```

---

## 6. Étape 4 — Afficher le graphe

Trois actions servent un éditeur visuel. RssArchiver les expose par
`eu.lmvi.pipeline.PipelineStudioController` (`/api/pipeline/{types,handlers,graph,graph-view,…}`) à son
Pipeline Studio React (`frontend/lib/pipeline-studio/`, `@xyflow/react`).

| Action | Paramètres | Rend |
|---|---|---|
| `graph_view` | `graph` (inline) **ou** `type_id` **ou** `code` | `{nodes[], edges[]}` au format React Flow, disposition en couches topologiques (240 px × 120 px), arêtes issues d'un Gate animées |
| `get_graph` | `type_id` ou `code` | le JSON source éditable + `type_id`, `code`, `label`, `status`, `version_label` |
| `list_handlers` | — | `{handlers:[…]}` triés : la palette disponible |
| `list_types` | — | tous les templates, avec `category` lue au catalogue |

Chaque nœud projeté porte `type: "pipelineStage"` et `data: {label, stageType, handler}`.

---

## 7. Vérifier

```sql
SELECT x_id, code, version_label, status, stage_count, edge_count, published_at
  FROM schema_monapp.db_pipeline_type ORDER BY x_id DESC LIMIT 5;
```

Attendu : une ligne `tri-demandes`, `status = published`, `stage_count = 8`, `edge_count = 7`.

```bash
curl -s "$APP/mcp" "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{"name":"pipeline_worker__graph_view","arguments":{"code":"tri-demandes"}}}' \
 | jq -r '.result.content[0].text' | jq '.nodes | length'
```

Attendu : `8`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `validate` d'un DAG avec cycle `a→b→a` | `valid:false`, erreur `V1` |
| 2 | `validate` sans étape K | erreur `V2 aucun stage Sink (K)` |
| 3 | Gate avec deux arêtes sans garde | erreur `V5 … 2 branches par défaut` |
| 4 | Garde `GTE` avec `value:"haut"` | erreur `V5 opérande non numérique` |
| 5 | `define` d'un DAG invalide | échec `DAG invalide: […]`, aucune ligne insérée |
| 6 | Redémarrer l'app sans changer le JSON | aucune nouvelle ligne `db_pipeline_type` |
| 7 | Changer un `timeoutMs` dans le JSON, redémarrer | nouvelle version `app-xxxxxxxx`, publiée |
| 8 | `instantiate` sur un draft | échec `template '…' non publié (status=draft)` |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Le Gate route vers TOUTES les gardes vraies** | un message part à la fois en revue et en rejet si les gardes se chevauchent | gardes **mutuellement exclusives** ; RssArchiver route sur un champ `/routing` avec `EQ` |
| Gate sans branche par défaut | message abandonné en silence (`WARN aucun routage … abandonné`), aucune DLQ | toujours une arête sans garde ; V5 ne le signale qu'en avertissement |
| `code` désigne la dernière ligne, pas la dernière publiée | après un `define` d'essai, `instantiate code=…` échoue `non publié` | instancier et publier par `type_id`, ou publier chaque version définie |
| `define` répété avec le même `version_label` | lignes en double : l'index unique est neutralisé par `x_partition` NULL (V002 n'a corrigé que les runs) | tester l'existence avant `define` (§5) |
| Plusieurs étapes S | seule la **première** S déclarée reçoit les messages ; les autres n'en reçoivent jamais | une seule Source par DAG, ou des sous-pipelines |
| Champ `triggers` / `phases` / `execution_mode` dans le JSON | ignoré sans erreur | la clé est `executionMode` ; `triggers` et `phases` ne sont pas modélisés |
| `contractIn` pris pour un JSON Schema | aucune vérification de structure à l'exécution | lister les champs requis dans `params.requiredIn` |
| Garde posée sur une arête d'un T/E/K | avertissement V5, garde ignorée : l'arête est toujours empruntée | gardes uniquement en sortie de G |
| `value` numérique écrite en nombre JSON (`"value": 70`) | accepté par Jackson (converti en `"70"`) | écrire `"70"` pour rester explicite |
| `MATCHES` lu comme une correspondance totale | `"^urgent"` nécessaire pour ancrer | `find()` : ancrer la regex soi-même |
| Un K qui a des arêtes sortantes | accepté : le moteur route aussi après un Sink (RssArchiver : `article` → enrichissements) | à utiliser sciemment ; un artefact est écrit à chaque passage |
| Modifier le template pour corriger un run en cours | sans effet : le run garde `frozen_graph` | nouvelle version + nouveau `run_key` |

---

## 10. Pour aller plus loin

- [[howto-pipeline-03-ecrire-un-stage-handler|PIPELINE-03]] — écrire `monapp-note` et `monapp-enregistre`
- [[howto-pipeline-04-executer-un-run|PIPELINE-04]] — instancier et lancer le template publié
- [[howto-pipeline-08-catalogue-fork-et-sous-pipelines|PIPELINE-08]] — catalogue, fork, Composite
- `socle-pack-pipeline/docs/mockups/pipeline-studio.html` — maquette du constructeur visuel (contrat `graph_view`)
