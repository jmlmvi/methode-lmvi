# HOWTO PIPELINE-11 — Déclencher un pipeline : événement, webhook, planning, file dédiée

**Niveau :** Expert
**Cible :** application qui embarque `socle-pack-pipeline` **0.5.0** et veut lancer des pipelines sans les piloter run par run
**Versions vérifiées au code :** `socle-pack-pipeline` 0.5.0, branche `feat/0.5.0`, non commitée au 2026-11-12 · `socle-v005` 5.11.0 (minimum 5.10.0) / Spring Boot 4.1.2 · `io.nats:jnats` 2.19.1 · 33 tests verts · date 2026-11-12
**Temps estimé :** 1 h

> Classes de référence : `trigger/PipelineTriggerService` (API publique), `TriggerDispatcher`, `TriggerEvent`,
> `TriggerRepository`, `PipelineScheduleWorker`, `PipelineWebhookController` ; `engine/PipelineCallScope`,
> `PipelineCallContext` ; `runtime/PipelineRuntimeManager#runTriggered`.
> Spec : `socle-pack-pipeline/docs/SPEC-socle-pack-pipeline.md` §9 (décisions D1, D2, D7).
> Modèle de code : `src/test/java/eu/lmvi/socle/pack/v050/Pipeline050IntegrationTest.java` (tests 30 à 34).

---

## 1. Contexte

Jusqu'en 0.4.0, un run naissait d'un `instantiate` puis d'un `run_start` ([[howto-pipeline-04-executer-un-run|PIPELINE-04]]).
La 0.5.0 ajoute les **déclencheurs**, à la manière de n8n : un pipeline publié part tout seul quand
l'app émet un événement, quand un appel HTTP arrive, quand une échéance tombe, ou sur un tir à la main.

| Type | Ce qui le tire | Création |
|---|---|---|
| `event` | `PipelineTriggerService.fireEvent(nom, tenant, payload, eventId, chaîne)` appelé par l'app | `event_name` requis, `match` facultatif |
| `webhook` | `POST /pipeline/webhook/{jeton}` (ou `fireWebhook`) | rend le jeton **une seule fois** |
| `schedule` | `pipeline_schedule_worker`, à chaque échéance du cron | `cron` (5 ou 6 champs), `zone`, `payload` |
| `manual` | `trigger_fire` / `fireManual` | rien de plus ; `trigger_fire` marche aussi sans déclencheur |

Cas de référence : `soclehub#60` — un message de salon (`salon.message`) déclenche les pipelines abonnés à ce
salon ; une étape `mcp_action` répond par `salon_post` ([[howto-pipeline-10-credentials-http-et-actions|PIPELINE-10]]).

---

## 2. Architecture

```
 fireEvent / fireWebhook / fireManual / fireDueSchedules        (rend la main tout de suite)
   │  pour chaque pipeline visé :
   ├─ chaîne contient ce pipeline ?           → skipped « boucle »          (D7)
   ├─ taille de chaîne ≥ trigger.max-depth ?  → skipped « profondeur »      (D7)
   ├─ INSERT tr_pipeline_trigger_event (tenant, pipeline, event_id) ON CONFLICT DO NOTHING
   │        déjà présent                      → duplicate
   └─ TriggerDispatcher.enqueue(TriggerEvent) → queued
                │
                ▼  file dédiée  trig.<tenant|_>.<code>    (D1, backend socle.pipeline.queue-backend)
        StageQueue<TriggerEvent>  +  UN VThreadStageExecutor du framework
          concurrency = trigger.concurrency, timeout = trigger.run-timeout-seconds,
          maxRetries = trigger.max-retries (backoff 2 s ×2), bail = run-timeout + 30 s
                │  un message = un run                  (D2)
                ▼
        PipelineRuntimeManager.runTriggered(dernière version PUBLIÉE, runKey = <code>:<eventId>)
          run figé tr_pipeline_run, mode step, queues en MÉMOIRE, contexte d'appel (tenant, owner, chaîne)
          completed → ack ; parked (étape H) → ack, run gardé en mémoire ;
          failed    → exception → nouvelles tentatives de la file → DLQ de la file → trigger_retry
```

Les états d'un événement (`tr_pipeline_trigger_event.status`) : `queued` → `running` → `completed`,
`failed` ou `parked` ; `skipped` pour une boucle ou une profondeur dépassée.

---

## 3. Étape 1 — Configuration

```yaml
socle:
  pipeline:
    queue-backend: ${SOCLE_PIPELINE_QUEUE_BACKEND:nats}   # nats en production (D1) ; memory/techdb ailleurs
    nats-url: ${SOCLE_PIPELINE_NATS_URL:nats://soclehub-nats:4222}
    trigger:
      enabled: true                 # files dédiées et déclencheurs
      max-depth: 5                  # profondeur maximale d'une chaîne de déclenchements
      concurrency: 2                # événements traités en parallèle par la file d'UN pipeline
      max-retries: 0                # nouvelles tentatives d'un événement avant la DLQ de la file
      run-timeout-seconds: 300      # délai d'un run déclenché
      schedule-interval-ms: 30000   # cadence de pipeline_schedule_worker (1 s au moins)
      webhook-enabled: false        # expose POST /pipeline/webhook/{jeton}
```

Variables : `SOCLE_PIPELINE_TRIGGER_ENABLED`, `…_MAX_DEPTH`, `…_CONCURRENCY`, `…_MAX_RETRIES`,
`…_RUN_TIMEOUT_SECONDS`, `…_WEBHOOK_ENABLED`.

Les files dédiées suivent `queue-backend` : `nats` (JetStream, la cible de D1 ; streams `PIPE_trig_…`,
[[howto-pipeline-09-backend-nats-jetstream|PIPELINE-09]] §8 bis), `techdb` (défaut du pack) ou `memory`
(rien ne survit à un redémarrage).

Tables (`V003__credentials_triggers.sql`) : `tr_pipeline_trigger` (déclencheurs) et
`tr_pipeline_trigger_event` (journal, index unique `(x_partition, pipeline_code, event_id)`).

Au démarrage de `pipeline_worker`, une file est ouverte pour chaque (tenant, pipeline) qui a un déclencheur
actif ; les événements restés dans une file durable reprennent :

```
[pipeline-trigger] file dédiée 'trig._.salon-echo' ouverte (concurrence 2, nouvelles tentatives 0)
[pipeline-trigger] 1 file(s) dédiée(s) ouverte(s) — backend nats
```

---

## 4. Étape 2 — Créer un déclencheur

Le pipeline doit être **publié** : les runs déclenchés exécutent toujours sa dernière version publiée.

| Action | Paramètres | Rend |
|---|---|---|
| `trigger_create` | `pipeline_code`, `type` (requis) ; `event_name`, `match` (event) ; `cron`, `zone`, `payload` (schedule) ; `owner` (défaut : l'appelant) | `trigger_id`, `queue`, `next_fire_at` (schedule), `webhook_token` (webhook, une seule fois) |
| `trigger_list` | `pipeline_code` (filtre) | déclencheurs du tenant (jamais le jeton) |
| `trigger_set_active` | `trigger_id`, `enabled` | un planifié réactivé repart de l'échéance suivante |
| `trigger_delete` | `trigger_id` | désactive et efface le condensat du jeton |
| `trigger_fire` | `pipeline_code`, `payload`, `event_id` | `{pipeline, eventId, status, reason?}` |
| `trigger_status` | `pipeline_code`, `limit` (20) | file : `open`, `pending`, `processing`, `dlq`, `dlq_events` ; `events` récents |
| `trigger_retry` | `pipeline_code` | `replayed` : événements remis en file depuis la DLQ |
| `list_runs` | `limit` (50), `status` (ex. `failed`), `pipeline_code` | runs récents avec `pipeline_code` et `error_message` : la vue « erreurs » d'un écran |
| `run_attempts` | `run_key` | `attempts` : toutes les tentatives de la clé, de la plus ancienne à la plus récente, chacune avec ses `stage_runs` (étape, état, essais, `error_message`) |

Le tenant de toutes ces actions est celui de l'`ActionContext` de l'appelant.

**Filtre `match`** (type `event`) : un objet `{ "pointeur": valeur | [valeurs] }`. Chaque pointeur JSON
(`/salon_code`, ou `salon_code` / `a.b` convertis en `/a/b`) doit exister dans le payload et valoir la
valeur attendue, ou l'une des valeurs du tableau ; comparaison en texte. Une valeur objet est refusée.

```java
ActionResult t = pipelineWorker.executeAction("trigger_create", ActionParameters.fromMap(Map.of(
        "pipeline_code", "salon-echo",
        "type", "event",
        "event_name", "salon.message",
        "match", Map.of("/salon_code", List.of("SAL-A", "SAL-C")))), ctx);
// t.getData("queue") → "trig._.salon-echo"  (tenant null → "_")
```

```java
// Planifié : toutes les heures à la minute 5, heure de Paris
pipelineWorker.executeAction("trigger_create", ActionParameters.fromMap(Map.of(
        "pipeline_code", "rapport-horaire", "type", "schedule",
        "cron", "5 * * * *", "zone", "Europe/Paris", "payload", Map.of("source", "cron"))), ctx);
```

---

## 5. Étape 3 — Émettre un événement depuis l'app

`PipelineTriggerService` est l'API publique pour l'hôte. Un appel rend un `Fired` par pipeline visé
(`queued`, `duplicate` ou `skipped`) ; le run s'exécute dans la file, jamais dans le fil de l'appelant.

```java
List<Fired> fireEvent(String eventName, String tenant, JsonNode payload, String eventId, List<String> chain)
Fired       fireManual(String tenant, String pipelineCode, JsonNode payload, String eventId, String actor, List<String> chain)
Fired       fireWebhook(String token, JsonNode payload, String eventId)
```

`fireEvent` ne vise que les déclencheurs `event` **actifs**, de **ce nom**, du **même tenant** (`null` égale
`null`), dont le `match` accepte le payload. `eventId` vide → un UUID.

Émettre **après le commit** de la transaction qui a produit le fait : le run tourne sur un autre fil et peut
relire la base aussitôt ; un événement émis puis annulé par un rollback serait déjà en file.

```java
package eu.lmvi.monapp.pipeline;

import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.lmvi.socle.pack.pipeline.engine.PipelineCallContext;
import eu.lmvi.socle.pack.pipeline.engine.PipelineCallScope;
import eu.lmvi.socle.pack.pipeline.trigger.PipelineTriggerService;
import eu.lmvi.socle.pack.pipeline.util.PipelineJson;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;

/** Émet « demande.creee » vers les pipelines abonnés, après commit, en portant la chaîne anti-boucle. */
@Component
public class EvenementsDemande {

    private final PipelineTriggerService triggers;

    public EvenementsDemande(PipelineTriggerService triggers) {
        this.triggers = triggers;
    }

    public void demandeCreee(String tenant, String idDemande, String texte) {
        ObjectNode payload = PipelineJson.mapper().createObjectNode().put("id", idDemande).put("texte", texte);
        // Appelé pendant une étape d'un pipeline (mcp_action) : la chaîne de ce run, plus ce pipeline.
        // Appelé par un humain ou l'extérieur : chaîne vide.
        List<String> chaine = PipelineCallScope.current().map(PipelineCallContext::chainForChildren).orElse(List.of());
        String eventId = "demande:" + idDemande;   // stable : un rejeu de l'app ne relance rien (duplicate)
        Runnable emettre = () -> triggers.fireEvent("demande.creee", tenant, payload, eventId, chaine);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    emettre.run();
                }
            });
        } else {
            emettre.run();
        }
    }
}
```

`PipelineCallScope.current()` est lu **avant** l'enregistrement de la synchronisation : c'est un
`ThreadLocal` posé pour la durée de l'étape, sur son fil.

---

## 6. Étape 4 — Arrêter les boucles (D7)

Un événement porte la chaîne des pipelines qui l'ont produit. `PipelineTriggerService` écarte (`skipped`,
consigné au journal) :

- un pipeline déjà présent dans la chaîne (« boucle : 'x' figure déjà dans la chaîne […] ») ;
- un événement dont la chaîne atteint `trigger.max-depth` (« profondeur N ≥ M »).

La garde ne marche que si **l'action qui produit le nouvel événement** transmet la chaîne : elle lit
`PipelineCallScope.current().chainForChildren()` (§5). C'est ce que fera le Hub pour `salon_post` →
`fireEvent("salon.message", …)`. Une `PipelineActionInvoker` de l'app qui exécute l'action sur un autre fil,
ou à distance, transmet elle-même `call.chainForChildren()` : le `ThreadLocal` ne traverse pas.

`fireWebhook` et les échéances planifiées partent d'une chaîne vide.

---

## 7. Étape 5 — Le webhook

```yaml
socle.pipeline.trigger.webhook-enabled: true
```

`PipelineWebhookController` expose `POST /pipeline/webhook/{jeton}` :

- corps JSON (vide → `{}`), lu en texte et analysé en Jackson 2 — rien ne dépend du convertisseur HTTP de
  l'hôte (Jackson 3 sous Boot 4) ;
- en-tête facultatif `X-Event-Id` : identifiant de dédoublonnage ;
- **202** avec `{pipeline, eventId, status}` (y compris `duplicate`) ; **404** `{"error":"webhook inconnu"}`
  pour un jeton absent, inconnu ou d'un déclencheur inactif ; **400** pour un corps illisible.

Le jeton (32 octets aléatoires, base64url) est rendu par `trigger_create` **une seule fois** ; seul son
SHA-256 est gardé (`tr_pipeline_trigger.webhook_hash`). Le jeton est le seul secret : l'hôte laisse passer
`/pipeline/webhook/**` **sans authentification** (filtre de sécurité de l'app, route du proxy du Hub), et
rien d'autre.

```bash
curl -s -X POST "https://monapp.thesocle.net/pipeline/webhook/$JETON" \
  -H "Content-Type: application/json" -H "X-Event-Id: commande-4242" -d '{"x":42}'
# → 202 {"pipeline":"hook","eventId":"commande-4242","status":"queued"}
```

---

## 8. Étape 6 — Le planning

`pipeline_schedule_worker` (worker POLLING, nom MOP `pipeline_schedule_worker`, actif si
`trigger.enabled`) tire à chaque cycle les déclencheurs `schedule` échus, 100 au plus par cycle.

- Cron à **5 champs** (minute heure jour mois jour-de-semaine) ou à 6 (secondes en tête) ; fuseau par
  `zone`, défaut `Europe/Paris`.
- `eventId` = `sched:<trigger_id>:<échéance en secondes epoch>` ; le payload du déclencheur reçoit
  `_scheduled_at` (ISO-8601).
- L'échéance avance par une mise à jour conditionnelle (`next_fire_at` attendu) : avec plusieurs instances de
  l'app, une seule tire.
- La prochaine échéance est calculée **depuis maintenant** : après un arrêt, une seule échéance en retard est
  tirée, les autres sont sautées.

---

## 9. Étape 7 — Échecs, DLQ et rejeu

Dans un run déclenché, une étape qui lève fait échouer **le run entier** (pas-à-pas). L'événement passe
`failed`, la file applique `trigger.max-retries` nouvelles tentatives (chacune = un nouveau run sous la même
clé), puis range l'événement dans la **DLQ de la file**.

```java
ActionResult st = pipelineWorker.executeAction("trigger_status",
        ActionParameters.fromMap(Map.of("pipeline_code", "flaky")), ctx);
// st.getData("dlq") → 1 ; st.getData("dlq_events") → [{eventId, error}] ; st.getData("events") → journal

ActionResult r = pipelineWorker.executeAction("trigger_retry",
        ActionParameters.fromMap(Map.of("pipeline_code", "flaky")), ctx);
// r.getData("replayed") → 1 ; l'événement repasse queued, puis completed
```

Au test de bout en bout, `tr_pipeline_run` porte alors deux lignes pour `flaky:ev-flaky` : `failed` puis
`completed`.

`run_status` et `lineage` ne montrent que la **dernière** tentative d'une clé : après un rejeu réussi,
l'échec d'origine n'y apparaît plus. Un écran d'erreurs se construit donc avec les deux lectures
suivantes, sans toucher aux tables du pack :

```java
// Les runs en échec, avec le pipeline et le message
ActionResult ko = pipelineWorker.executeAction("list_runs",
        ActionParameters.fromMap(Map.of("status", "failed", "limit", 30)), ctx);
// Pour l'un d'eux : toutes les tentatives et l'étape fautive de chacune
ActionResult att = pipelineWorker.executeAction("run_attempts",
        ActionParameters.fromMap(Map.of("run_key", "flaky:ev-flaky")), ctx);
// att.getData("attempts") → [{status: failed, stage_runs: [{stage_id: appel, status: failed, error_message: "… 500"}]},
//                            {status: completed, …}]
```

Le banc `APP-38-PipelineLab` en fait un panneau « Erreurs » (DLQ à rejouer, runs en échec avec étape
fautive et tentative n/N, événements refusés), et dessine chaque DAG avec `graph_view`, chaque étape
colorée selon son état au dernier run.

Dédoublonnage : un `eventId` déjà inscrit au journal pour ce (tenant, pipeline) rend `duplicate`, quel que
soit son état. Côté exécution, un run déjà `completed` sous la même clé n'est pas rejoué.

---

## 10. Vérifier

```bash
curl -s "$APP/mcp" -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pipeline_worker__trigger_status","arguments":{"pipeline_code":"salon-echo"}}}' \
 | jq -r '.result.content[0].text'
```

```sql
SELECT event_id, source, status, run_key, error_message, datas->>'reason' AS raison
  FROM schema_monapp.tr_pipeline_trigger_event
 WHERE pipeline_code = 'salon-echo' ORDER BY x_id DESC LIMIT 20;
```

Le run d'un événement se lit comme tout run : `run_status`, `lineage`, `metrics` avec
`run_key = <code>:<eventId>` ([[howto-pipeline-07-observer-lineage-et-metriques|PIPELINE-07]]).
`getStats()` de `pipeline_worker` donne `trigger_queues` (files ouvertes) ; celui de
`pipeline_schedule_worker` donne `cycles`, `fired`, `lastError`.

---

## 11. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `fireEvent` dont le payload ne passe pas `match` | liste vide, aucun run |
| 2 | `fireEvent` qui passe | `queued`, puis événement `completed`, run `<code>:<eventId>` `completed` |
| 3 | Même `eventId` une seconde fois | `duplicate` |
| 4 | Événement d'un autre tenant | liste vide |
| 5 | Chaîne contenant le pipeline visé | `skipped`, raison `boucle` |
| 6 | Chaîne de longueur `max-depth` | `skipped`, raison `profondeur` |
| 7 | Étape en échec, `trigger_status` | `dlq = 1` ; après correction, `trigger_retry` → `replayed = 1`, `completed` |
| 8 | `trigger_create` webhook puis `trigger_list` | jeton rendu une fois, absent de la liste et des tables |
| 9 | `POST /pipeline/webhook/<jeton faux>` | 404 `webhook inconnu` |
| 10 | Cron `* * * * * *`, `fireDueSchedules` deux fois sur la même échéance | 1 puis 0 |
| 11 | Backend `nats`, après le premier déclencheur | stream `PIPE_trig___<code>` dans JetStream |

---

## 12. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Les retries par étape ne s'appliquent pas** | un run déclenché tourne en pas-à-pas, files en mémoire : `maxRetries` / `backoffMs` du bloc `config` d'une étape sont sans effet, la première exception fait échouer le run | seule la file dédiée rejoue : `trigger.max-retries`, ou `trigger_retry` ; relancer dans le handler si l'appel est passager |
| Un échec rejoue **tout** le run | les étapes déjà passées s'exécutent de nouveau (nouveau run, dédup en mémoire vide) | étapes idempotentes, K en upsert ([[howto-pipeline-06-idempotence-backfill-et-dlq\|PIPELINE-06]]) |
| **Dédoublonnage plus large que « déjà terminé »** | un `eventId` déjà `failed` ou `skipped` renvoyé par `fireEvent`/`trigger_fire` rend `duplicate` et ne repart pas | rejouer un échec par `trigger_retry` ; un nouveau tir prend un nouvel `eventId` |
| Déclencheur créé sur un pipeline **jamais publié** | `trigger_create` accepte (il vérifie seulement que le code existe) ; chaque événement échoue `aucune version publiée` puis part en DLQ | publier avant de créer le déclencheur |
| Nouvelle version définie mais pas publiée | les runs déclenchés gardent l'ancienne version publiée | publier ; c'est la dernière publiée qui part |
| `fireEvent` appelé avant le commit | le run lit des données absentes, ou un fait annulé par rollback déclenche quand même | émettre en `afterCommit` (§5) |
| Action qui produit un événement **sans** transmettre la chaîne | boucle : le pipeline se redéclenche jusqu'à `max-depth`… qui ne voit jamais la chaîne grandir | `PipelineCallScope.current().chainForChildren()` (§5, §6) |
| `concurrency` > 1 | deux événements du même pipeline s'exécutent en parallèle, dans un ordre quelconque | `trigger.concurrency: 1` si l'ordre compte (réglage global, pour toutes les files) |
| Backend `memory` | un redémarrage perd les événements en file ; le journal les garde `queued` à vie | `nats` en production |
| Backend `techdb` (défaut) | files sur la TechDB H2 du framework, sujette à `object is already closed` sous charge ([[howto-pipeline-04-executer-un-run\|PIPELINE-04]] §6) | `nats` |
| `trigger_fire` sur un pipeline **sans** déclencheur | marche ; au redémarrage, sa file est rouverte tant qu'elle a des événements `queued` ou `running` (corrigé en 0.5.0 avant livraison) | — |
| Étape H dans un pipeline déclenché | événement `parked`, message acquitté, run gardé **en mémoire** jusqu'à `human_resolve` (qui le termine). Un redémarrage le retire de la mémoire ; repris par `resume_run`, il redevient un run manuel : sans propriétaire ni chaîne, sur le backend configuré, et l'événement reste `parked` au journal | éviter H dans un pipeline déclenché, ou traiter la reprise à la main |
| Planning après une panne | une seule échéance en retard tirée, les autres sautées | voulu ; un rattrapage s'écrit dans l'app (`trigger_fire` avec un `eventId` par échéance) |
| Route du webhook protégée par l'hôte | 401/302 au lieu de 202 | laisser passer `/pipeline/webhook/**` sans authentification, et rien d'autre (§7) |
| `trigger_delete` | le déclencheur disparaît, la file reste ouverte jusqu'à l'arrêt de l'app | sans effet sur les tirs (plus rien ne la vise) |
| Run déclenché plus long que `run-timeout-seconds` | le bail de la file (délai + 30 s) expire : le message peut être relivré pendant que le run tourne | `run-timeout-seconds` au-dessus du plus long run attendu |
| Codes de pipeline qui ne diffèrent que par `.`, `-` ou `_` | **corrigé en 0.5.0** : le nom de file ne garde que `[A-Za-z0-9_]` et ajoute un condensat de 8 caractères quand le nettoyage modifie le code (`salon-echo` → `trig._.salon_echo_<condensat>`, stream `PIPE_trig___salon_echo_<condensat>`) | lire le nom réel dans `trigger_create.queue` ou `trigger_status.queue`, ne pas le recalculer |

---

## 13. Pour aller plus loin

- [[howto-pipeline-10-credentials-http-et-actions|PIPELINE-10]] — `http`, `mcp_action`, credentials, expressions
- [[howto-pipeline-09-backend-nats-jetstream|PIPELINE-09]] — les streams JetStream, dont ceux des files dédiées
- [[howto-pipeline-05-human-in-the-loop-et-reprise|PIPELINE-05]] — étape H et reprise
- `socle-pack-pipeline/docs/SPEC-socle-pack-pipeline.md` §9
