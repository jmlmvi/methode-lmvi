# HOWTO COM-05 — Journal des envois, rejeu, anti-doublon et multi-tenant

**Niveau :** Confirmé
**Cible :** `eu.lmvi:socle-pack-comm` **1.1.0** (branche `main`, commit `6abb702`)
**Vérifié au code le :** 2026-10-28 (requête d'anti-doublon rejouée en JDBC sur PostgreSQL 17 le même jour)
**Prérequis :** [[howto-com-02-envoyer-une-notification-multicanal|COM-02]]
**Temps estimé :** 30 min

---

## 1. Contexte

Chaque canal tenté laisse une ligne dans `tr_notification_log`. Cette table sert à trois choses :

1. **l'historique** (`list_history`, `get_stats` sur 24 h) ;
2. **le rejeu** des échecs (poller interne ou rejeu piloté par l'app) ;
3. **l'anti-doublon** (`ThrottleService` y cherche un envoi identique récent).

Elle porte des données personnelles (destinataire, et par défaut sujet, corps et contexte) : sa
rétention est à la charge de l'app.

---

## 2. Architecture

```
tr_notification_log
  x_id · x_dateCreated · x_partition · x_createdBy(userId|system)
  correlation_id · notification_type · channel · recipient · subject · body · priority
  status ∈ SENT | FAILED | THROTTLED | PERMANENTLY_FAILED
  error_message · retry_count · next_retry_at · provider_message_id · datas(jsonb = contexte)

Cycle d'une ligne :
  envoi OK ─────────────────────────────► SENT
  envoi KO ─► FAILED, next_retry_at = now + délai(priorité, 0)
              │ poller (retry.auto-enabled) ou action retry_failed
              ├─ OK ──────────────────────► SENT (retry_count+1)
              ├─ KO, retry_count+1 < max ─► FAILED, next_retry_at replanifié
              └─ KO, retry_count+1 ≥ max ─► PERMANENTLY_FAILED (DLQ logique)
  canal indisponible au rejeu ──────────► PERMANENTLY_FAILED
```

---

## 3. Étape 1 — Choisir qui rejoue

| Réglage | Quand |
|---|---|
| `retry.auto-enabled: true` (défaut) | le contenu est rejouable tel quel (alerte, notification générique) |
| `retry.auto-enabled: false` + rejeu côté app | le message porte un secret à usage unique (lien personnel, code) ou l'app tient son propre état d'envoi |

Le poller est un `ScheduledExecutorService` démarré par `NotifyWorker.start()` : délai
`max(5, poll-interval-seconds)`, au plus `batch-size` lignes par cycle, `FAILED` dont
`next_retry_at <= now()` et `retry_count < max-retries`.

```yaml
socle:
  comm:
    retry:
      auto-enabled: true
      max-retries: 3
      poll-interval-seconds: 60
      batch-size: 50
```

Rejeu manuel d'une ligne :

```bash
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"notify_worker__retry_failed","arguments":{"notification_id":4182}}}'
```

Le patron « rejeu côté app » (UniqPersonnality, BingFetch) : l'app garde sa propre table d'état
(`a_envoyer` / `envoye` / `echec`, compteur de tentatives) et rappelle `sendNotification` ; le
journal du pack n'est plus qu'une trace technique.

```java
// BingFetch — Alertes.envoyer(), extrait réel
if (erreur == null) {
    jdbc.update("UPDATE tr_alerte SET statut_envoi = 'envoye', envoye_le = now(), tentatives = tentatives + 1, erreur = NULL WHERE x_id = ?", id);
} else {
    jdbc.update("""
            UPDATE tr_alerte SET statut_envoi = CASE WHEN tentatives + 1 >= 5 THEN 'echec' ELSE 'a_envoyer' END,
                   tentatives = tentatives + 1, erreur = ? WHERE x_id = ?""", erreur, id);
}
```

---

## 4. Étape 2 — Ne pas conserver le contenu

```yaml
socle:
  comm:
    log-content: false     # sujet = NULL, corps = "[contenu non conservé]", datas = {}
    retry:
      auto-enabled: false  # OBLIGATOIRE avec log-content: false
```

Le rejeu du pack renvoie le `subject` et le `body` **lus dans le journal** : avec
`log-content: false`, il enverrait un courriel sans sujet dont le corps est
« [contenu non conservé] ». Désactiver le poller et rejouer côté app.

Même ainsi, `recipient` reste en clair. Une app qui efface une personne (RGPD) supprime aussi ses
lignes :

```sql
DELETE FROM schema_monapp.tr_notification_log   WHERE recipient = :adresse;
DELETE FROM schema_monapp.tr_notification_inbox WHERE id_utilisateur = :id_utilisateur;
-- et une purge périodique : le pack n'en fait aucune
DELETE FROM schema_monapp.tr_notification_log WHERE x_dateCreated < now() - interval '180 days';
```

---

## 5. Étape 3 — Anti-doublon (throttling)

Un envoi est sauté (`THROTTLED`) s'il existe, dans la fenêtre effective, une ligne `SENT` de même
`notification_type`, même `recipient` (le destinataire **du canal**) et même partition. Fenêtre
effective : `throttle_minutes` du type, ramenée à 1 min en `HIGH`, nulle en `CRITICAL`, nulle si
`throttle_minutes = 0`.

🔴 **En mono-tenant, la requête d'anti-doublon échoue.** `ThrottleService` écrit
`(x_partition = ? OR (x_partition IS NULL AND ? IS NULL))`. Avec une partition `null`, le second
paramètre n'a aucun type déductible : PostgreSQL refuse la requête
(`ERROR: could not determine data type of parameter $n` — `$5` dans la requête du pack ; reproduit en JDBC sur la même clause le 2026-10-28). Aucun
test du pack ne couvre ce chemin. L'exception **remonte de `sendNotification`** : l'appel échoue
pour tous les canaux restants.

Types seedés concernés (fenêtre effective > 0) : `SYSTEM_ALERT` (5 min, HIGH → 1), `IMPORT_COMPLETE`
(30), `HITL_REMINDER` (240). Non concernés : `USER_WELCOME`, `PASSWORD_RESET`, `NEWSLETTER`
(0) et `HARD_CAP_BREACH` (CRITICAL).

Conduite à tenir en 1.1.0, en mono-tenant :

```sql
-- désactiver l'anti-doublon du pack ; le faire côté app si nécessaire
UPDATE schema_monapp.z_notification_config SET throttle_minutes = 0 WHERE x_partition IS NULL;
```

puis `NotificationConfigService.reload()`. Les types déclarés par l'app se créent avec
`throttle_minutes = 0` (c'est le choix de BingFetch et d'UniqPersonnality). Ou passer une
partition non nulle à `sendNotification`.

---

## 6. Étape 4 — Multi-tenant

Toutes les tables portent `x_partition VARCHAR(30)`. Ce que le pack fait réellement :

| Mécanisme | Réalité en 1.1.0 |
|---|---|
| Partition passée à `sendNotification(partition, …)` | utilisée pour config, gabarit, anti-doublon, journal, inbox |
| Partition d'un appel MCP | lue par `TenantResolver` (`current_setting('app.current_tenant_id', true)`) sur une connexion du pool ; hors transaction de l'appelant elle vaut `null` |
| Trigger `trg_x_partition_default` | remplit `x_partition` à l'INSERT depuis `app.current_tenant_id` si non fourni |
| Policies RLS | **aucune n'est créée** (V003 : « N'active PAS la RLS dure ») |
| Rejeu automatique | ne restaure pas la partition ; rejoue avec un contexte vide |

Donc : en multi-tenant, appeler en Java avec la partition explicite.

```java
List<ChannelResult> r = notify.sendNotification(tenantSlug, idUtilisateur, "UNIQP_INVITATION",
        destinataire, donnees, null, null, "fr", null);
```

`TenantResolver` ne voit la variable de session que si l'appel a lieu **dans** une transaction
Spring de l'app, sur la même `DataSource`, après `SET LOCAL app.current_tenant_id = '…'`.

---

## 7. Vérifier

```sql
-- Échecs en attente et DLQ logique
SELECT status, count(*), min(next_retry_at) FROM schema_monapp.tr_notification_log
 WHERE status IN ('FAILED','PERMANENTLY_FAILED') GROUP BY status;
```

```bash
# Compteurs 24 h : last24h_<STATUT>, last24h_channel_<CANAL>
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"notify_worker__get_stats","arguments":{}}}' \
  | jq '.result.content[0].text | fromjson'
```

Journal : `[notify-retry] N notification(s) rejouée(s)`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Canal KO puis rétabli, poller actif | `FAILED` → `SENT`, `retry_count = 1` |
| 2 | Canal KO 3 fois | `PERMANENTLY_FAILED`, `next_retry_at` NULL |
| 3 | `log-content: false` | `subject` NULL, `body = '[contenu non conservé]'`, `datas = {}` |
| 4 | Deux envois identiques, `throttle_minutes = 10`, partition `'t1'` | 2ᵉ ligne `THROTTLED` |
| 5 | Même test, partition `null` | exception SQL (défaut connu, §5) |

Tests du pack : `RetryCycleTest` (3), `JournalSansContenuTest` (1), `XPartitionDefaultTriggerTest` (3).

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Anti-doublon en mono-tenant** | `could not determine data type of parameter` ; l'envoi entier échoue | `throttle_minutes = 0`, ou partition non nulle |
| `log-content: false` + poller actif | courriels « [contenu non conservé] » sans sujet | `retry.auto-enabled: false` |
| Rejeu d'un `IN_APP` ou `WEBHOOK` | contexte vide : inbox en type `GENERIC`, partition NULL, sans `action_url` ; webhook sans `context` | rejouer ces canaux côté app |
| Lien à usage unique rejoué | le destinataire reçoit un lien périmé ou déjà consommé | rejeu côté app avec un lien neuf (UniqPersonnality) |
| Croire à la RLS | toutes les partitions visibles par `list_history` sans filtre | filtrer en SQL côté app ; la RLS n'est pas posée |
| Rétention | journal et inbox grossissent sans fin | purge planifiée côté app (CronWorker) |
| `recipient` conservé même sans contenu | donnée personnelle résiduelle | suppression à l'effacement RGPD |
| Le poller crée son propre fil | contraire à la règle « jamais de thread dans un worker » | à connaître ; désactivable par `retry.auto-enabled: false` |

---

## 10. Pour aller plus loin

- [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer]]
- [[howto-com-03-types-et-gabarits|COM-03 — Types et gabarits]]
- [[howto-34-gerer-les-tenants-iam|HOWTO 34 — Tenants IAM]]
