# HOWTO CONNECTORS-10 — Résilience et journal des appels (`tr_connector_log`)

**Niveau :** Confirmé
**Cible :** développeur ou exploitant qui diagnostique un connecteur lent, refusé ou « en panne »
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:3.0.0` (Boot 4.0.6 ; code de ce périmètre identique à 2.0.0, dernière version Boot 3) — `ResilienceFactory`,
`CircuitBreaker`, `RetryPolicy`, `RateLimiter`, `ConnectorLogger`, `V001__create_connector_log.sql`
**Temps estimé :** 20 min

---

## 1. Contexte

Les quatre connecteurs partagent la même chaîne de protection, réimplémentée localement dans le
pack (aucune dépendance vers `socle-pack-comm` ni vers les circuit breakers du socle) :

| Mécanisme | Réglage **codé en dur** | Portée |
|---|---|---|
| Rate limiter | fenêtre glissante 1 s ; `socle.conn.<c>.rate-limit-rps` (notion 2, gdrive 8, stripe 80, hubspot 8) | une instance par client/worker, bloquante (`Thread.sleep`) |
| Retry | 3 tentatives, 500 ms × 2^n + gigue, plafond 10 s | toute exception, **y compris 4xx**, POST compris |
| Circuit breaker | 5 échecs en 30 s → OUVERT 60 s → DEMI-OUVERT → 1 succès referme | **un par fournisseur**, partagé par toute la JVM (`notion`, `gdrive`, `stripe`, `hubspot`) |
| Journal | une ligne `tr_connector_log` par action exécutée | toutes actions des 4 workers |

---

## 2. Architecture

```
executeAction(name)
   │
   ├─ handler ─► client.request()
   │               ├─ RateLimiter.acquire()            (une seule fois, hors retry)
   │               └─ ResilienceFactory.execute(provider, call)
   │                     CircuitBreaker.execute(          OPEN → CircuitOpenException immédiate
   │                        RetryPolicy.execute(call))    3 essais ; un seul échec compté par appel
   │
   └─ ConnectorLogger.logCall(partition=null, userId=ctx.callerId(), worker, provider, action,
                              status SUCCESS|FAILED, http_status=null, latency_ms, error, null, params={})
          └─ INSERT <schema>.tr_connector_log … RETURNING x_id     (échec d'insert = WARN, jamais bloquant)
```

---

## 3. Étape 1 — Lire le journal

```sql
-- Santé par connecteur sur la dernière heure
SELECT connector,
       count(*)                                         AS appels,
       count(*) FILTER (WHERE status = 'FAILED')        AS echecs,
       round(avg(latency_ms))                           AS latence_moy_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms
FROM schema_monapp.tr_connector_log
WHERE x_dateCreated > now() - interval '1 hour'
GROUP BY connector ORDER BY echecs DESC;

-- Dernières erreurs, avec l'appelant
SELECT x_dateCreated, connector, action, caller_user_id, left(error_message, 160) AS erreur
FROM schema_monapp.tr_connector_log
WHERE status <> 'SUCCESS'
ORDER BY x_id DESC LIMIT 20;
```

L'index partiel `idx_tr_connector_log_status (status) WHERE status <> 'SUCCESS'` sert la seconde
requête.

| Colonne | Contenu réel en 2.0.0 |
|---|---|
| `connector`, `action`, `latency_ms`, `caller_worker` | renseignés |
| `status` | `SUCCESS` ou `FAILED` uniquement |
| `error_message` | message de l'exception ou de l'`ActionResult` ; peut être vide (voir Pièges) |
| `caller_user_id`, `x_createdBy` | `ActionContext.callerId()` (`system` si absent) |
| `http_status`, `provider_request_id` | toujours `NULL` |
| `x_partition` | toujours `NULL` (shim post-5.6.0, partition remplacée par `null`) |
| `request_hash` | SHA-256 de `connector::action::{}` — **identique** pour tous les appels d'une même action |
| `datas` | toujours `{}` |

---

## 4. Étape 2 — Purger le journal

Le pack ne purge pas `tr_connector_log`. Une table d'appels grossit sans fin ; un Worker cron de
l'app s'en charge :

```java
package eu.lmvi.monapp.workers;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import eu.lmvi.socle.worker.Worker;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class ConnectorLogPurgeWorker implements Worker {

    private static final Logger log = LoggerFactory.getLogger(ConnectorLogPurgeWorker.class);

    private final JdbcTemplate jdbc;
    private final String schema;
    private final int retentionDays;
    private final AtomicLong purged = new AtomicLong();

    public ConnectorLogPurgeWorker(JdbcTemplate jdbc,
                                   @Value("${socle.conn.schema:public}") String schema,
                                   @Value("${monapp.connector-log.retention-days:30}") int retentionDays) {
        this.jdbc = jdbc;
        this.schema = schema.replaceAll("[^a-zA-Z0-9_]", "").toLowerCase();
        this.retentionDays = retentionDays;
    }

    @Override public String getName() { return "connector_log_purge_worker"; }
    @Override public String getSchedule() { return "15 3 * * *"; }   // cron 5 champs : 03:15 chaque jour
    @Override public boolean isScheduled() { return true; }
    @Override public void initialize() { }
    @Override public void start() { }
    @Override public void stop() { }
    @Override public boolean isHealthy() { return true; }
    @Override public Map<String, Object> getStats() {
        return Map.of("purged_total", purged.get(), "retention_days", retentionDays);
    }

    @Override
    public void doWork() {
        int n = jdbc.update("DELETE FROM " + schema + ".tr_connector_log "
                + "WHERE x_dateCreated < now() - make_interval(days => ?)", retentionDays);
        purged.addAndGet(n);
        log.info("[worker:connector_log_purge_worker] {} lignes purgées (> {} j)", n, retentionDays);
    }
}
```

---

## 5. Étape 3 — Reconnaître un circuit ouvert

```
[retry:stripe] 1/3 failed: Stripe POST /customers HTTP 400: … — retry in 1213ms
[retry:stripe] 2/3 failed: … — retry in 2380ms
[circuit:stripe] → OPEN
```

Pendant 60 s, **toutes** les actions du fournisseur échouent immédiatement avec
`Circuit [stripe] OPEN`, et le journal les inscrit en `FAILED`. Au premier appel après 60 s :
`[circuit:stripe] OPEN → HALF_OPEN`, puis `HALF_OPEN → CLOSED` si l'appel réussit.

L'état du circuit n'est exposé ni dans `getStats()`, ni par une action : il se lit dans les logs.
Le seul moyen de le remettre à zéro est de redémarrer l'app (`ResilienceFactory` vit en mémoire).

---

## 6. Vérifier

```bash
curl -s -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/docker_worker/get_logs \
  -d '{"app_id":"monapp","lines":500}' | grep -E '\[circuit:|\[retry:|\[connector-log\]'
```

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | 1 appel réussi | 1 ligne `SUCCESS`, `latency_ms` > 0 |
| 2 | 1 appel en 401 | 3 tentatives dans les logs, 1 ligne `FAILED` |
| 3 | 5 appels en échec en < 30 s | `[circuit:<c>] → OPEN` ; 6ᵉ appel refusé sans requête réseau |
| 4 | Attendre 60 s, appel valide | `HALF_OPEN → CLOSED` |
| 5 | Notion, 10 appels simultanés | étalés sur ≈ 5 s (2 req/s) |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Erreurs de validation (4xx) retentées et comptées** | Une app qui envoie 5 requêtes mal formées coupe le fournisseur **pour toute l'app** pendant 60 s | Valider les paramètres avant l'appel |
| **POST rejoués après délai d'attente** | Objets en double (client Stripe, contact HubSpot, page Notion) | Idempotence côté app ([[howto-connectors-07-stripe-clients-et-abonnements|CONNECTORS-07]]) |
| `ActionResult` en échec avec `error` vide | Ligne `FAILED`, `error_message` `NULL` | Signature d'une `NullPointerException` dans `Map.of` (réponse fournisseur avec un champ `null`) : voir CONNECTORS-04, -06, -07 |
| Attendre `RATE_LIMITED` / `CIRCUIT_OPEN` dans `status` | Jamais présents (seulement commentés dans le DDL) | Chercher `Circuit [` dans `error_message` |
| Se fier à `request_hash` pour dédoublonner | Toutes les lignes d'une action ont le même hash | Les workers passent `Map.of()` : la colonne est inexploitable en 2.0.0 |
| Filtrer par tenant | `x_partition` toujours `NULL` | Non porté ; dette signalée dans le CLAUDE.md du pack |
| Relever `rate-limit-rps` au-dessus du quota fournisseur | `HTTP 429` rejoués 3 fois, puis circuit ouvert | Rester sous 3 req/s pour Notion, 100/10 s pour HubSpot |
| Plusieurs instances de l'app | Le limiteur est **par JVM** : 2 conteneurs = 2× le débit | Diviser `rate-limit-rps` par le nombre d'instances |
| Délai : `http-timeout-seconds` × 3 essais + attentes | Une action peut bloquer ≈ 100 s (`callTimeout` 30 s ×3 + ≈ 3,5 s) | Mode ASYNC pour les appels longs ; abaisser `SOCLE_CONN_HTTP_TIMEOUT_SECONDS` |
| Journal sans purge | Table de plusieurs millions de lignes | Worker de purge ci-dessus |

---

## 9. Pour aller plus loin

- [[howto-connectors-01-integrer-le-pack|CONNECTORS-01 — Intégrer le pack]]
- [[howto-connectors-03-gerer-les-identifiants|CONNECTORS-03 — Identifiants]]
- [[howto-18-restaurer-backup|HOWTO 18 — Restaurer un backup]] (le journal vit dans le schéma de l'app)
