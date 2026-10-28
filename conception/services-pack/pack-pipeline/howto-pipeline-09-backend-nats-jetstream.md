# HOWTO PIPELINE-09 — Faire transiter les étapes par NATS JetStream

**Niveau :** Expert
**Cible :** application qui embarque `socle-pack-pipeline` et joint un serveur NATS JetStream
**Versions vérifiées au code :** `socle-pack-pipeline` 0.4.0 @ `2e477c2` (tag `v0.4.0`, `main` ; code identique à 0.3.0 @ `fef144d` ; code fonctionnel identique à 0.2.0 et à 0.1.0-SNAPSHOT @ `5fa8f05`) · `socle-v005` 5.11.0 (minimum 5.10.0) / Spring Boot 4.1.2 · `io.nats:jnats` 2.19.1 · date 2026-10-28
**Temps estimé :** 30 min

> Classe de référence : `engine/NatsStageQueue` (implémente `eu.lmvi.socle.pipeline.queue.StageQueue` du framework)
> Publier ou consommer des **messages métier** entre apps : [[howto-37-publier-des-messages-nats-depuis-une-app|HOWTO 37]],
> [[howto-38-consommer-des-messages-nats-depuis-une-app|HOWTO 38]] — ce n'est pas l'objet de cette fiche.

---

## 1. Contexte

Par défaut, les files entre étapes vivent en H2 (`techdb`) ou en mémoire (`memory`). Le backend `nats` les
place dans **JetStream** : les messages en vol survivent à un redémarrage de l'app, et la redélivrance
après expiration du bail est native.

Ce backend est un **transport interne** au pipeline d'une app. Il crée ses propres streams, hors des
conventions de nommage du socle NATS du Hub (`<DOMAIN>_<CHANNEL>`) et hors de sa gouvernance. Pour faire
circuler des messages **entre applications**, la voie reste le socle NATS du Hub (HOWTO 37/38).

État au 2026-10-28 : implémentation complète et testée contre un JetStream réel
(`NatsPipelineIntegrationTest`, 3 tests, image `nats:2.10-alpine`) ; **aucune app de la flotte ne
l'utilise** en production.

---

## 2. Architecture

```
 DagPipelineBuilder.build(dag, run_key)            queue-backend=nats
   ├─ Nats.connect(socle.pipeline.nats-url)         1 connexion par run compilé
   ├─ contexte V2 : InMemoryPipelineContext
   └─ pour chaque étape  q = "q.<run_key nettoyé>.<stageId>"
        NatsStageQueue(q, bail = 2 min)
          ├ stream PIPE_<q'>        sujet  q            (stockage File, sans limite d'âge)
          ├ stream PIPE_<q'>_DLQ    sujet  DLQ_<q'>
          └ consumer pull durable C_<q'>  ackWait = 2 min, AckPolicy.Explicit, maxDeliver 1 000 000
        q' = q avec tout caractère hors [a-zA-Z0-9_] remplacé par « _ »

 enqueue → js.publish(sujet)        claim → fetch(1)        ack → msg.ack()
 nack(requeue=true) → msg.nak()      nack(requeue=false) → msg.term()  (abandon, PAS de DLQ)
 sendToDlq → publish DLQ + msg.term()
 stage_retry → replayAllFromDlq      close() → unsubscribe (streams CONSERVÉS)
```

Exemple : run `tri-demandes-a1b2c3d4`, étape `note` → sujet `q.tri-demandes-a1b2c3d4.note`, stream
`PIPE_q_tri_demandes_a1b2c3d4_note`, DLQ `PIPE_q_tri_demandes_a1b2c3d4_note_DLQ`.

---

## 3. Étape 1 — Configuration

```yaml
socle:
  pipeline:
    schema: ${PIPELINE_SCHEMA:schema_monapp}
    queue-backend: nats
    # jeton éventuel dans l'URL : nats://<jeton>@soclehub-nats:4222
    nats-url: ${PIPELINE_NATS_URL:nats://soclehub-nats:4222}
```

`io.nats:jnats` 2.19.1 doit être dans les dépendances de l'app, ce qui est déjà le cas pour toute app qui
embarque le pack ([[howto-pipeline-01-integrer-le-pack|PIPELINE-01]] §4).

Le conteneur de l'app doit joindre le serveur : sur le Hub, `soclehub-nats` n'est résolu que depuis le
réseau `docker_soclehub-net`, et le port 4222 n'est pas publié sur l'hôte.

---

## 4. Étape 2 — Nettoyer les streams d'un run clos

`close()` désabonne le consumer mais **ne supprime pas** les streams. Chaque `run_key` laisse
`2 × nombre d'étapes` streams sur le serveur. Le service ci-dessous les supprime après `run_cancel`.

```java
package eu.lmvi.monapp.pipeline;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.pipeline.PipelineWorker;
import io.nats.client.Connection;
import io.nats.client.JetStreamManagement;
import io.nats.client.Nats;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;

/** Clôt un run du backend nats et supprime ses streams PIPE_q_<run>_*. */
@Service
public class NettoyageStreamsPipeline {

    private static final Logger log = LoggerFactory.getLogger(NettoyageStreamsPipeline.class);

    private final PipelineWorker pipeline;
    private final String natsUrl;

    public NettoyageStreamsPipeline(PipelineWorker pipeline, @Value("${socle.pipeline.nats-url}") String natsUrl) {
        this.pipeline = pipeline;
        this.natsUrl = natsUrl;
    }

    public int clore(String runKey) throws Exception {
        ActionResult c = pipeline.executeAction("run_cancel", ActionParameters.fromMap(Map.of("run_key", runKey)), null);
        if (!c.success()) {
            log.warn("[nats-clean] run_cancel {} : {}", runKey, c.error());
        }
        // même nettoyage que DagPipelineBuilder (run_key) puis NatsStageQueue (nom de stream)
        String cle = runKey.replaceAll("[^a-zA-Z0-9_-]", "_").replaceAll("[^a-zA-Z0-9_]", "_");
        String prefixe = "PIPE_q_" + cle + "_";
        int supprimes = 0;
        try (Connection nc = Nats.connect(natsUrl)) {
            JetStreamManagement jsm = nc.jetStreamManagement();
            for (String stream : jsm.getStreamNames()) {
                if (stream.startsWith(prefixe)) {
                    jsm.deleteStream(stream);
                    supprimes++;
                }
            }
        }
        log.info("[nats-clean] {} : {} stream(s) supprimé(s)", runKey, supprimes);
        return supprimes;
    }
}
```

Le préfixe est un **préfixe** : `run-1` couvrirait aussi les streams de `run-10`. Des clés de longueur fixe
(empreinte) évitent ce recouvrement.

Depuis le Hub, la même opération se fait à la main : `nats_worker.list_streams`, puis
`nats_worker.delete_stream` avec `stream_name`.

---

## 5. Étape 3 — Reprise après redémarrage

Le consumer est **durable** : après un redémarrage, `resume_run` recompile le run, recrée les
`NatsStageQueue` sous les mêmes noms et se rattache aux consumers existants. Les messages non acquittés
reviennent après expiration du bail (2 min). `run_resume` relance ensuite les executors
([[howto-pipeline-05-human-in-the-loop-et-reprise|PIPELINE-05]] §5).

La déduplication, elle, repart vide ([[howto-pipeline-06-idempotence-backfill-et-dlq|PIPELINE-06]]) : un
message traité mais pas encore acquitté au moment de l'arrêt est traité une seconde fois.

---

## 6. Vérifier

```bash
# Depuis le Hub
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/list_streams -d '{}' \
 | jq -r '.. | strings | select(startswith("PIPE_q_"))'
```

Attendu après `instantiate` d'un run de 8 étapes : 16 streams `PIPE_q_<run>_…`.

```bash
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/nats_worker/get_stream_info \
  -d '{"stream_name":"PIPE_q_tri_demandes_a1b2c3d4_note"}'
```

Côté app, `run_status.stages.<id>.pending` lit `numPending` du consumer durable.

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `instantiate` + `run_start` en batch | streams créés, run drainé (`fullPipeline_overNats_endToEnd`) |
| 2 | Échec forcé avec `maxRetries: 0` | message dans `PIPE_…_DLQ`, `run_status.stages.<id>.dlq = 1` |
| 3 | `stage_retry` après `resume_run` | message republié dans le stream principal (`natsStageQueue_enqueueClaimAck_andDlqReplay`) |
| 4 | Arrêter l'app avec des messages en attente, redémarrer, `resume_run` + `run_resume` | messages traités |
| 5 | `NettoyageStreamsPipeline.clore` | streams du run supprimés, autres runs intacts |
| 6 | Serveur NATS arrêté puis `instantiate` | échec `connexion NATS échouée (nats://…)` ; la ligne `tr_pipeline_run` reste `created` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Streams jamais supprimés** | centaines de streams `PIPE_q_*` sur le serveur, disque qui grossit (stockage File, sans `maxAge`) | supprimer après `run_cancel` (§4) ; préférer des runs longs |
| **Runs unitaires ou Composite sur `nats`** | 2 streams par étape et **par run** ou par appel de sous-pipeline | backend `memory` pour ces usages |
| `id` d'étape avec `.`, `*`, `>` ou espace | sujet NATS invalide ou capturant d'autres sujets : l'id d'étape n'est pas nettoyé | ids d'étape en `[a-zA-Z0-9_-]` |
| Deux `run_key` qui ne diffèrent que par des caractères spéciaux | mêmes streams : `-`, `.`, `:` deviennent tous `_` | clés alphanumériques |
| Une connexion par run | nombre de connexions au serveur = nombre de runs actifs | peu de runs longs |
| `jnats` absent | `NoClassDefFoundError` au démarrage, quel que soit le backend | dépendance `io.nats:jnats` |
| App hors `docker_soclehub-net` | `connexion NATS échouée` | réseau du Hub, ou serveur JetStream dédié |
| Bail de 2 min fixe | un handler plus long voit son message relivré pendant qu'il travaille (puis jeté par la dédup) | `timeoutMs` < 2 min ; le bail n'est pas réglable par étape (`leaseOverride` ignoré) |
| Run en mode `step` sur `nats` | un échec d'étape fait `nack(requeue=false)` → `term()` : le message est **abandonné**, absent de la DLQ | `batch` sur `nats` (l'échec passe par `sendToDlq` de V2) |
| Confondre avec le socle NATS du Hub | streams hors convention, aucune DLQ `.dlq`, pas de `Nats-Msg-Id` | HOWTO 37/38 pour les échanges entre apps |
| Contexte V2 attendu en persistance | `InMemoryPipelineContext` : l'état d'exécution V2 est perdu au redémarrage, seules les files survivent | le métier se relit en base (`tr_pipeline_*`) |

---

## 9. Pour aller plus loin

- [[howto-pipeline-04-executer-un-run|PIPELINE-04]] §6 — comparer les trois backends
- [[howto-23-nats-streams|HOWTO 23]] — administrer les streams du serveur NATS du Hub
- `socle-pack-pipeline/src/test/java/eu/lmvi/socle/pack/pipeline/NatsPipelineIntegrationTest.java`
