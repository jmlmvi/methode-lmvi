# HOWTO PIPELINE-08 — Catalogue, fork et sous-pipelines (étape Composite)

**Niveau :** Confirmé
**Cible :** application qui embarque `socle-pack-pipeline`
**Versions vérifiées au code :** `socle-pack-pipeline` 0.4.0 @ `2e477c2` (tag `v0.4.0`, `main` ; code identique à 0.3.0 @ `fef144d` ; code fonctionnel identique à 0.2.0 et à 0.1.0-SNAPSHOT @ `5fa8f05`) · `socle-v005` 5.11.0 (minimum 5.10.0) / Spring Boot 4.1.2 · date 2026-10-28
**Temps estimé :** 30 min

> Classes de référence : `PipelineWorker` (`handleCatalogueImport`, `handleFork`), `repo/PipelineRepository`
> (`insertCatalogue`, `setCatalogueCategory`, `listCatalogue`), `engine/handlers/CompositeHandler`,
> `runtime/SubPipelineRunner`, `engine/CapturingObserver`

---

## 1. Contexte

Deux besoins de réutilisation :

- **dériver** un pipeline existant pour un autre usage, en gardant trace de son origine : le **catalogue**
  et le **fork** ;
- **imbriquer** un pipeline dans un autre, comme une étape : l'étape **C (Composite)**.

Cas de référence : **APP-12-RssArchiver** a retenu « un DAG par type de contenu » : `rss-editorial` est la
souche, les variantes (newsletter, communiqués) naissent par `fork` depuis le Pipeline Studio, puis
s'assignent à un flux (`db_source_rss.workflow_code`). La catégorie métier sert à grouper les pipelines
dans le Studio (`catalogue_set_category`).

---

## 2. Architecture

```
 db_pipeline_type                       db_pipeline_catalogue
 ┌───────────────────────┐   import   ┌──────────────────────────────────────┐
 │ x_id=1 rss-editorial  │──────────► │ x_id=10 code=rss-editorial  parent=∅ │
 │        published      │            │         visibility, category         │
 └───────────────────────┘            └───────────────▲──────────────────────┘
          │ fork(new_code=rss-newsletter)              │ id_parent
          ▼                                            │
 ┌───────────────────────┐            ┌────────────────┴─────────────────────┐
 │ x_id=7 rss-newsletter │──────────► │ x_id=11 code=rss-newsletter parent=10│
 │        draft, v1      │            │         visibility=private           │
 └───────────────────────┘            └──────────────────────────────────────┘

 Étape C du run parent (thread de son executor)
   CompositeHandler ── params.pipeline = "csub"
     └ SubPipelineRunner.runSync(code, payload, depth)
          ├ dernière version de "csub", doit être published
          ├ build(dag, "sub-csub-<uuid>", CapturingObserver, repo=null)
          ├ inject → runStepToCompletion(2000)      (pas-à-pas, synchrone)
          ├ sortie = payload du 1er Sink atteint   (sinon : payload d'entrée)
          └ close()
     garde : métadonnée _depth, MAX_DEPTH = 5
```

---

## 3. Étape 1 — Catalogue et fork

| Action | Paramètres | Effet | Réponse |
|---|---|---|---|
| `catalogue_import` | `type_id` ou `code`, `visibility` (`private` par défaut, `shared`, `public`), `category` | insère une entrée de catalogue | `{catalogue_id, code, type_id}` |
| `fork` | `type_id` ou `code` (source), `new_code` (requis, ≠ source), `new_label` | copie le graphe en **draft `v1`** sous `new_code` ; entrée de catalogue `private` dont le parent est la dernière entrée de la source | `{type_id, code, status:"draft", forked_from, catalogue_id, parent_catalogue_id}` |
| `catalogue_list` | — | toutes les entrées, récentes d'abord | `{catalogue:[{x_id, code, label, id_pipeline_type, id_parent, visibility, category, x_dateCreated}]}` |
| `catalogue_set_category` | `code`, `category` (vide = aucune) | met à jour toutes les entrées du code ; en crée une si le code n'est pas au catalogue | `{updated, code, category}` |

`parent_catalogue_id` vaut `""` si la source n'avait pas d'entrée de catalogue : importer la souche
**avant** de la forker pour que la filiation soit enregistrée.

Le fork copie `description`, `executionMode`, `stages`, `edges`, `guards`. Il ne publie pas.

### Le code

```java
package eu.lmvi.monapp.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/** Dérive un pipeline publié, ajuste un paramètre d'étape, publie la variante et la range au catalogue. */
@Service
public class VariantePipelineService {

    private final PipelineWorker pipeline;
    private final ObjectMapper mapper = new ObjectMapper();

    public VariantePipelineService(PipelineWorker pipeline) {
        this.pipeline = pipeline;
    }

    public Map<String, Object> deriver(String source, String nouveauCode, String libelle,
                                       String stageId, String param, Object valeur, String categorie) {
        // 1. la souche au catalogue (sinon la filiation du fork reste vide)
        appel("catalogue_import", Map.of("code", source, "visibility", "shared", "category", categorie));

        // 2. fork → draft v1 identique, sous le nouveau code
        Map<String, Object> fork = appel("fork", Map.of("code", source, "new_code", nouveauCode, "new_label", libelle));

        // 3. relire le graphe du fork, modifier un paramètre, définir la version v2
        Map<String, Object> g = appel("get_graph", Map.of("type_id", fork.get("type_id")));
        ObjectNode graphe = mapper.valueToTree(g.get("graph"));
        for (JsonNode s : graphe.path("stages")) {
            if (stageId.equals(s.path("id").asText())) {
                ObjectNode params = s.get("params") instanceof ObjectNode o ? o : ((ObjectNode) s).putObject("params");
                params.set(param, mapper.valueToTree(valeur));
            }
        }
        Map<String, Object> def = new LinkedHashMap<>();
        def.put("graph", graphe);
        def.put("version_label", "v2");
        Map<String, Object> v2 = appel("define", def);

        // 4. publier la v2 par son type_id, ranger la variante dans sa catégorie
        appel("publish", Map.of("type_id", v2.get("type_id")));
        appel("catalogue_set_category", Map.of("code", nouveauCode, "category", categorie));
        return Map.of("code", nouveauCode, "type_id", v2.get("type_id"),
                "forked_from", source, "catalogue_id", fork.get("catalogue_id"));
    }

    private Map<String, Object> appel(String action, Map<String, Object> params) {
        ActionResult r = pipeline.executeAction(action, ActionParameters.fromMap(params), null);
        if (!r.success()) throw new IllegalStateException(action + " : " + r.error());
        return r.data();
    }
}
```

---

## 4. Étape 2 — Imbriquer un pipeline : l'étape Composite

Le sous-pipeline est un DAG ordinaire, **publié**. L'étape C le désigne par son code dans
`params.pipeline` ; le handler `composite` est appliqué par défaut à toute étape de type C.

`csub` — le sous-pipeline :

```json
{
  "code": "csub",
  "label": "Normalisation réutilisable",
  "executionMode": "step",
  "stages": [
    { "id": "s",  "type": "S" },
    { "id": "t",  "type": "T", "handler": "set-field", "params": { "field": "normalise", "value": true },
      "config": { "timeoutMs": 5000, "maxRetries": 0 } },
    { "id": "k",  "type": "K", "handler": "identity", "config": { "timeoutMs": 5000, "maxRetries": 0 } }
  ],
  "edges": [ { "id": "e1", "from": "s", "to": "t" }, { "id": "e2", "from": "t", "to": "k" } ]
}
```

`couter` — le pipeline qui l'appelle (repris du test du pack `composite-outer.json`) :

```json
{
  "code": "couter",
  "label": "Pipeline composite (S→C(csub)→K)",
  "executionMode": "step",
  "stages": [
    { "id": "s", "type": "S" },
    { "id": "c", "type": "C", "params": { "pipeline": "csub" },
      "config": { "timeoutMs": 60000, "maxRetries": 0 } },
    { "id": "k", "type": "K", "handler": "collect", "config": { "timeoutMs": 5000, "maxRetries": 0 } }
  ],
  "edges": [ { "id": "e1", "from": "s", "to": "c" }, { "id": "e2", "from": "c", "to": "k" } ]
}
```

Le Sink du sous-pipeline utilise `identity` et non `collect` : sa sortie est captée par l'observateur du
Composite, un `collect` y retiendrait en plus chaque message en mémoire sans que personne ne l'oublie.

Ordre : `define` + `publish` de `csub`, **puis** de `couter`. La validation de `couter` ne vérifie pas que
`csub` existe ; l'échec arriverait à l'exécution (`sous-pipeline introuvable`).

---

## 5. Vérifier

```bash
curl -s "$APP/mcp" -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pipeline_worker__catalogue_list","arguments":{}}}' \
 | jq -r '.result.content[0].text' | jq '.catalogue[] | {code, id_parent, visibility, category}'
```

```sql
-- Arbre des forks
WITH RECURSIVE arbre AS (
  SELECT x_id, code, id_parent, 0 AS niveau FROM schema_monapp.db_pipeline_catalogue WHERE id_parent IS NULL
  UNION ALL
  SELECT c.x_id, c.code, c.id_parent, a.niveau + 1
    FROM schema_monapp.db_pipeline_catalogue c JOIN arbre a ON c.id_parent = a.x_id)
SELECT repeat('  ', niveau) || code AS pipeline FROM arbre ORDER BY niveau, code;
```

Pour le Composite : `instantiate` puis `run_start` de `couter` avec `{"v":1}` ; le puits `k` reçoit
`{"v":1,"normalise":true}`. Le lineage de l'artefact porte le maillon `c` seulement : le Composite ne
reprend que le **payload** de la sortie du sous-pipeline, pas son lineage.

---

## 6. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `fork` avec `new_code` = code source | échec `new_code doit différer du code source` |
| 2 | `fork` d'une souche importée au catalogue | `parent_catalogue_id` = id de l'entrée souche |
| 3 | `fork` d'une souche absente du catalogue | `parent_catalogue_id: ""` |
| 4 | `instantiate` du fork sans publication | échec `non publié (status=draft)` |
| 5 | Run de `couter` | sortie enrichie par `csub` (test du pack `compositeStage_runsSubPipelineSynchronously`) |
| 6 | `csub` contient une étape C vers `csub` | échec au 5ᵉ niveau : `profondeur de composition maximale atteinte (5)` |
| 7 | `csub` repassé en draft par un nouveau `define` | l'étape C échoue `sous-pipeline 'csub' non publié` |

---

## 7. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **`catalogue_import` répété** | entrées en double : l'index unique `(x_partition, code)` est neutralisé par `x_partition` NULL | importer une fois ; `catalogue_set_category` pour modifier |
| `fork` vers un code qui existe déjà en `v1` | deux lignes `v1` pour ce code ; `code` désigne désormais le fork | vérifier `list_types` avant de forker |
| `visibility` prise pour un contrôle d'accès | `catalogue_list` rend tout, quelle que soit la visibilité | filtrer dans l'app |
| Fork d'une souche non importée | filiation perdue (`id_parent` NULL) | `catalogue_import` de la souche d'abord |
| **Nouvelle version draft du sous-pipeline** | tous les runs parents échouent à l'étape C : la **dernière** version doit être publiée | publier chaque version définie, ou définir sous un autre code |
| Étape H dans un sous-pipeline | le message est parqué en mémoire du sous-run puis jeté à sa fermeture ; le Composite rend le payload d'entrée | pas d'étape humaine dans un sous-pipeline |
| Sous-pipeline sans Sink atteint (Gate sans défaut) | WARN `n'a produit aucune sortie sink`, payload d'entrée renvoyé tel quel | branche par défaut sur chaque Gate du sous-pipeline |
| Plusieurs Sinks dans le sous-pipeline | seule la **première** sortie captée est rendue | un seul Sink de sortie |
| `timeoutMs` de l'étape C trop court | le sous-pipeline entier doit tenir dans ce délai, sinon relance jetée (PIPELINE-06 §7) | délai C ≥ somme des délais du sous-pipeline |
| Historique du sous-pipeline cherché en base | absent : pas d'écriture `tr_pipeline_*` pour un sous-run | tracer dans les handlers du sous-pipeline |
| Backend `nats` + Composite | chaque appel crée des streams `PIPE_q_sub_…` jamais supprimés | backend `memory` (cf. [[howto-pipeline-09-backend-nats-jetstream\|PIPELINE-09]]) |
| `collect` comme Sink d'un sous-pipeline | rétention mémoire par sous-run, jamais oubliée | `identity` ou un Sink métier |

---

## 8. Pour aller plus loin

- [[howto-pipeline-02-declarer-valider-publier-un-dag|PIPELINE-02]] — versions et publication
- [[howto-pipeline-07-observer-lineage-et-metriques|PIPELINE-07]] — ce que l'historique contient
- `APP-12-RssArchiver/rssarchiver/src/main/java/eu/lmvi/pipeline/PipelineStudioController.java` — fork depuis le Studio
