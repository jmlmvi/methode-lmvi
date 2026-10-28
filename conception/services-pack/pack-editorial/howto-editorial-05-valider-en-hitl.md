# HOWTO EDITORIAL-05 — Valider les articles en HITL avec `hitl_worker`

**Niveau :** Confirmé
**Cible :** application V005 embarquant le pack — 2.0.0 sur Spring Boot 4.0.6 (1.0.0-SNAPSHOT sur Boot 3.2.1 : contenu identique)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-editorial:2.0.0`, `feat/boot4` @ `8879bf7` (fonctionnellement identique à `1.0.0-SNAPSHOT`, `main` @ `fffd6f9`) —
`HitlWorker`, `HitlConfigService` ; migrations `V002`, `V004`, `V999` ; type de notification
`HITL_REMINDER` seedé par `socle-pack-comm` (`db/comm/V999__seed_default_configs_and_templates.sql`)
**Prérequis :** [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03]] avec `hitl_enabled = true` ;
[[howto-com-01-integrer-le-pack|pack-comm]] avec un canal e-mail pour les relances
**Temps estimé :** 30 min

---

## 1. Contexte

Le HITL (*human in the loop*) reçoit la zone grise de la curation : les articles dont le score tombe
entre les deux seuils, ou **tous** les articles si `auto_publish = false`. Un curateur accepte,
rejette, ou accepte en corrigeant le résumé et les tags. Un poller relance, escalade, puis applique
une décision par défaut si personne ne répond.

| Action | Rôle |
|---|---|
| `list_pending` | file des décisions en attente (`oldest` \| `newest` \| `score_desc`) |
| `decide` | `accept` \| `reject` \| `modify_accept` (+ `modifications {summary, tags}`) |
| `batch_decide` | lot `[{hitl_id, decision, modifications?}]` |
| `escalate` | escalade manuelle (notifie `escalation_recipients`) |
| `get_config` / `update_config` | délais, décision par défaut, destinataires |
| `get_stats` / `get_status` | compteurs |

**État — à lire avant de s'engager :**

- **Décisions manuelles (`decide`, `batch_decide`, `escalate`) : fonctionnelles** à la lecture du code.
- **Poller de délais : défaillant.** Dès qu'un article dépasse le délai de relance, la relance lève
  une `NullPointerException` (§9, premier piège) ; le tick s'interrompt avant les escalades et les
  décisions par défaut. Concrètement, **aucune relance, aucune escalade et aucun timeout ne
  s'appliquent** tant que ce défaut n'est pas corrigé dans le pack. Constaté à la lecture du code ;
  aucun test ne couvre `HitlWorker`, et aucune application connue n'active le HITL (RssArchiver
  tourne `hitl_enabled = false`).
- **Interface de validation : à la charge de l'application.** Les notifications pointent vers
  `/admin/hitl/{id}`, route que le pack ne fournit pas.

Recommandation : utiliser le HITL en **validation manuelle pilotée par l'application** (§5), et
traiter les délais par un worker applicatif tant que le poller du pack n'est pas corrigé.

---

## 2. Architecture

```
curation (zone grise) ──INSERT──► tr_hitl_queue (decision NULL)
                                        │
        ┌───────────────────────────────┼─────────────────────────────────┐
        ▼ actions                       ▼ poller "hitl-timeout-poller" (15 min)
 decide / batch_decide            sendReminders()   > reminder_delay_hours   → HITL_REMINDER
   accept        → INSERT tr_article  sendEscalations() > escalation_delay_hours → HITL_REMINDER (+escalated)
                   (validated_by =    applyTimeouts()  > timeout_delay_hours
                    "curator:<id>")        default_decision accept → tr_article (validated_by "timeout")
   modify_accept → idem, résumé/tags       sinon              → tr_raw_item rejected
                   corrigés          NotifyWorker.sendNotification(partition, null, "HITL_REMINDER",
   reject        → tr_raw_item               destinataire, data, null, "HIGH", "fr", null)
                   rejected
 puis UPDATE tr_hitl_queue SET decision, decided_by, decided_at, modifications
```

Configuration : `z_hitl_config`, une ligne par partition (globale `x_partition IS NULL` seedée par
`V999` : 4 h / 24 h / 48 h, `default_decision = 'reject'`, destinataires vides), en cache mémoire.

---

## 3. Étape 1 — Faire entrer la zone grise en HITL

```sql
UPDATE schema_monapp.z_curation_config
SET hitl_enabled = true,
    auto_publish = true,          -- false = TOUT passe en HITL
    score_threshold_high = 75,
    score_threshold_low  = 35
WHERE x_partition IS NULL AND content_type = 'rss';
```

Redémarrer l'application (cache de curation).

---

## 4. Étape 2 — Configurer délais et destinataires

```sql
UPDATE schema_monapp.z_hitl_config
SET reminder_delay_hours   = 4,
    escalation_delay_hours = 24,
    timeout_delay_hours    = 48,
    default_decision       = 'reject',
    reminder_recipients    = '["redaction@monapp.fr"]'::jsonb,
    escalation_recipients  = '["redac-chef@monapp.fr"]'::jsonb,
    timeout_recipients     = '["redac-chef@monapp.fr"]'::jsonb
WHERE x_partition IS NULL;
```

puis redémarrage (cache `HitlConfigService`). En mono-tenant, préférer ce SQL à `update_config` (§9).

Les e-mails partent par le type `HITL_REMINDER` de pack-comm (canaux seedés : `EMAIL`, `TELEGRAM`,
`IN_APP` ; gabarit e-mail « `[{app_name}] {pending_count} décisions en attente` »). Leur configuration
et leur limitation de débit relèvent de [[howto-com-01-integrer-le-pack|COM-01]].

---

## 5. Étape 3 — Décider depuis l'application

Le pack n'a pas d'écran. L'application expose sa propre page de validation et appelle le worker :

```java
package eu.lmvi.monapp.hitl;

import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.editorial.HitlWorker;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/hitl")
public class HitlController {

    private final HitlWorker hitlWorker;

    public HitlController(HitlWorker hitlWorker) {
        this.hitlWorker = hitlWorker;
    }

    @GetMapping("/pending")
    public ResponseEntity<Map<String, Object>> pending(@RequestParam(defaultValue = "score_desc") String sort,
                                                       @RequestParam(defaultValue = "50") int limit) {
        ActionResult r = hitlWorker.executeAction("list_pending",
                ActionParameters.fromMap(Map.of("sort", sort, "limit", limit)), null);
        return r.success() ? ResponseEntity.ok(r.data())
                           : ResponseEntity.badRequest().body(Map.of("error", r.error()));
    }

    /** decision = accept | reject | modify_accept ; summary/tags seulement pour modify_accept. */
    @PostMapping("/{hitlId}/decision")
    public ResponseEntity<Map<String, Object>> decide(@PathVariable long hitlId,
                                                      @RequestBody DecisionRequest req,
                                                      Principal principal) {
        Map<String, Object> p = new HashMap<>();
        p.put("hitl_id", hitlId);
        p.put("decision", req.decision());
        if ("modify_accept".equals(req.decision())) {
            Map<String, Object> mods = new HashMap<>();
            if (req.summary() != null) mods.put("summary", req.summary());
            if (req.tags() != null) mods.put("tags", req.tags());
            p.put("modifications", mods);
        }
        ActionResult r = hitlWorker.executeAction("decide", ActionParameters.fromMap(p), null);
        return r.success() ? ResponseEntity.ok(r.data())
                           : ResponseEntity.badRequest().body(Map.of("error", r.error()));
    }

    public record DecisionRequest(String decision, String summary, List<String> tags) {}
}
```

Appelé sans `ActionContext`, `decided_by` vaut `system` et `validated_by` `curator:unknown`. Pour
tracer le curateur, passer par MCP (le socle remplit `callerId`) ou écrire `decided_by` après coup.

Par MCP :

```bash
editorial hitl_worker__list_pending '{"limit":20,"sort":"score_desc"}'
editorial hitl_worker__decide '{"hitl_id":42,"decision":"modify_accept",
  "modifications":{"summary":"Résumé corrigé, plus factuel.","tags":["IA","régulation"]}}'
editorial hitl_worker__batch_decide '{"decisions":[{"hitl_id":43,"decision":"accept"},{"hitl_id":44,"decision":"reject"}]}'
```

---

## 6. Étape 4 — Appliquer les délais depuis l'application (palliatif)

Tant que le poller du pack échoue, un worker applicatif applique la décision par défaut en SQL —
les mêmes écritures que `applyTimeouts()`, sans la relance défaillante :

```java
package eu.lmvi.monapp.hitl;

import eu.lmvi.socle.worker.Worker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** Rejette les entrées HITL restées sans décision au-delà de timeout_delay_hours (défaut 48 h). */
@Component
public class HitlTimeoutWorker implements Worker {

    private static final Logger log = LoggerFactory.getLogger(HitlTimeoutWorker.class);
    private static final String S = "schema_monapp";

    private final JdbcTemplate jdbc;
    private final AtomicLong executions = new AtomicLong();
    private final AtomicLong expirees = new AtomicLong();
    private volatile boolean running;

    public HitlTimeoutWorker(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Override public String getName() { return "hitl_timeout_worker"; }
    @Override public long getCycleIntervalMs() { return 900_000L; }
    @Override public void initialize() { log.info("[worker:{}] initialisé", getName()); }
    @Override public void start() { running = true; }
    @Override public void stop() { running = false; }
    @Override public boolean isHealthy() { return running; }

    @Override
    public void doWork() {
        try {
            String echues =
                "SELECT h.x_id FROM " + S + ".tr_hitl_queue h " +
                "WHERE h.decision IS NULL AND h.x_dateCreated <= now() - make_interval(hours => COALESCE(" +
                "  (SELECT c.timeout_delay_hours FROM " + S + ".z_hitl_config c " +
                "   WHERE c.x_active AND (c.x_partition = h.x_partition OR c.x_partition IS NULL) " +
                "   ORDER BY c.x_partition NULLS LAST, c.x_id LIMIT 1), 48))";
            int bruts = jdbc.update(
                "UPDATE " + S + ".tr_raw_item SET status = 'rejected' WHERE x_id IN " +
                "(SELECT id_raw_item FROM " + S + ".tr_hitl_queue WHERE x_id IN (" + echues + "))");
            int lignes = jdbc.update(
                "UPDATE " + S + ".tr_hitl_queue SET decision = 'reject', decided_by = 'timeout', " +
                "decided_at = now(), timeout_applied_at = now() WHERE x_id IN (" + echues + ")");
            executions.incrementAndGet();
            expirees.addAndGet(lignes);
            if (lignes > 0) log.info("[worker:{}] {} entrées expirées, {} articles rejetés", getName(), lignes, bruts);
        } catch (Exception ex) {
            log.error("[worker:{}] cycle en erreur", getName(), ex);
        }
    }

    @Override
    public Map<String, Object> getStats() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("running", running);
        m.put("execution_count", executions.get());
        m.put("expired_total", expirees.get());
        return m;
    }
}
```

Pour garder le poller du pack muet pendant ce temps, l'espacer au maximum :
`socle.editorial.hitl.timeout-check-interval-minutes: 1440`.

---

## 7. Vérifier

```bash
editorial hitl_worker__get_stats '{}'
```

```json
{"worker":"hitl_worker","running":true,"reminders_sent":0,"escalations_sent":0,"timeouts_applied":0,
 "decisions_manual":12,"notify_available":true,"pending":7,"decided_last_24h":12}
```

```sql
SELECT decision, decided_by, count(*)
FROM schema_monapp.tr_hitl_queue
GROUP BY decision, decided_by
ORDER BY 1 NULLS FIRST;
```

Symptôme du défaut du poller dans le journal, toutes les 15 min dès qu'un article a plus de 4 h :
`[hitl-poller] tick failed: null`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Article score 50, `hitl_enabled=true` | ligne `tr_hitl_queue` `decision IS NULL` |
| 2 | `decide accept` | ligne `tr_article` `validated_by = curator:…`, brut en `published` |
| 3 | `decide modify_accept` avec résumé | `tr_article.summary` = résumé corrigé ; `modifications` tracées |
| 4 | `decide` sur une entrée déjà décidée | `HITL item not found or already decided` |
| 5 | `batch_decide` avec une entrée invalide | `{"success":n-1,"failed":1}` |
| 6 | Entrée > 48 h avec `HitlTimeoutWorker` | `decision = reject`, `decided_by = timeout` |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Poller de délais (`sendReminders`)** : la requête ne sélectionne pas `x_dateCreated`, puis `Map.of(…, "pending_since", item.get("x_dateCreated"), …)` reçoit `null` | `NullPointerException` à chaque tick, `[hitl-poller] tick failed: null` ; **ni relance, ni escalade, ni timeout** ; aucune trace en base | palliatif §6 ; correctif dans le pack : ajouter `h.x_dateCreated` aux `SELECT` de `sendReminders` et `sendEscalations` |
| Destinataires vides | le défaut ci-dessus se produit **quand même** : la carte est construite avant le test des destinataires | idem |
| `update_config` en mono-tenant | une **nouvelle ligne globale** à chaque appel : l'index unique `(x_partition)` ne voit pas les `NULL` en conflit ; le cache garde l'une d'elles au hasard | SQL `UPDATE … WHERE x_partition IS NULL` (§4), et supprimer les doublons |
| SQL sur `z_hitl_config` sans redémarrage | ancienne configuration en cache | redémarrer l'app |
| Article accepté en HITL | publié **sans** enrichissements, sans `published_at`, sans ingestion RAG (CLAUDE.md du pack annonce l'ingestion) | relancer les enrichissements côté app si besoin |
| Lien `/admin/hitl/{id}` des notifications | 404 : le pack ne fournit aucune page | exposer une page applicative, ajuster le gabarit `HITL_REMINDER` de pack-comm |
| `decided_by = system` | appel Java sans `ActionContext` | passer par MCP, ou mettre à jour `decided_by` |
| Langue des relances | `"fr"` en dur dans l'appel à `NotifyWorker` | gabarits pack-comm en français |
| `NotifyWorker` absent | `notify_available: false`, décisions possibles mais aucune relance | [[howto-com-01-integrer-le-pack\|COM-01]] |
| Multi-tenant | `list_pending` filtre par `app.current_tenant_id`, que la connexion du pack ne voit pas hors transaction partagée : `NULL` ⇒ toutes les partitions | considérer le HITL mono-tenant à ce jour |

---

## 10. Pour aller plus loin

- [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03 — Curer et router]] — d'où viennent les entrées
- [[howto-editorial-06-envoyer-des-newsletters|EDITORIAL-06 — Envoyer des newsletters]] — ce que deviennent les articles acceptés
- [[howto-com-01-integrer-le-pack|pack-comm]] — `NotifyWorker`, types et gabarits de notification
- [[howto-42-alfred-automatiser-une-tache|HOWTO 42]] — Alfred, pour surveiller la file `pending` depuis le Hub
