# HOWTO COM-02 — Envoyer une notification multicanal avec `notify_worker`

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-comm` **1.1.0** (branche `main`, commit `6abb702`) · `socle-v005` 5.7.4 (`provided`)
**Vérifié au code le :** 2026-10-28
**Prérequis :** pack intégré ([[howto-com-01-integrer-le-pack|COM-01]]) ; au moins un canal disponible
**Temps estimé :** 20 min

---

## 1. Contexte

L'application ne choisit pas un canal : elle émet un **type** (`USER_WELCOME`, `MONAPP_ALERTE`…)
vers un **destinataire**, avec des **données**. `NotifyWorker` lit la configuration du type
(`z_notification_config`), envoie sur chaque canal listé, rend le gabarit du canal, et note **une
ligne par canal tenté** dans `tr_notification_log`.

Deux portes pour la même logique :

| Porte | Pour qui | Appel |
|---|---|---|
| **Java direct** | le code métier de l'app (recommandé) | `NotifyWorker.sendNotification(...)` |
| **MCP** | un agent, le Hub, un opérateur | `tools/call notify_worker__send_notification` |

Exemple de référence : `eu.lmvi.bingfetch.alerte.Alertes` (APP-30 BingFetch).

---

## 2. Architecture

```
sendNotification(partition, userId, type, recipient, data, channels?, priority?, language?, recipientsPerChannel?)
   │
   ├─ NotificationConfigService.resolve(partition, type)   ── absent → ChannelResult.ko("no notification config…")
   │                                                       ── enabled=false → ko("…is disabled")
   ├─ canaux = channels (forcés) sinon cfg.channels
   ├─ priorité = priority sinon cfg.priority_default ; langue = language sinon default-language
   ├─ contexte = data + recipient, recipient_name, app_name, notification_type, priority, x_partition
   │
   └─ pour chaque canal :
        indisponible ─────────────► log FAILED « Channel X unavailable »
        ThrottleService ──────────► log THROTTLED
        TemplateService.resolve ──► gabarit rendu, sinon data.subject / data.body
        channel.send(...) ────────► log SENT | FAILED (+ next_retry_at)
```

Identifiants de canal (`NotificationChannel.channelId()`) : `EMAIL`, `SMS`, `TELEGRAM`, `SLACK`,
`WEBHOOK`, `IN_APP`. Ce sont aussi les clés de `recipients_per_channel`.

---

## 3. Étape 1 — Appel Java direct

Signature réelle (`eu.lmvi.socle.pack.comm.NotifyWorker`) :

```java
public List<ChannelResult> sendNotification(String partition, String userId,
                                            String type, String recipient,
                                            Map<String, Object> data,
                                            List<String> overrideChannels,
                                            String overridePriority,
                                            String language,
                                            Map<String, String> recipientsPerChannel)
```

`ChannelResult` est un record `(boolean success, String providerMessageId, String error)`.

Service métier complet, au modèle de BingFetch :

```java
package eu.lmvi.monapp.notification;

import eu.lmvi.socle.pack.comm.NotifyWorker;
import eu.lmvi.socle.pack.comm.notify.ChannelResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class AvisCommande {

    private static final Logger log = LoggerFactory.getLogger(AvisCommande.class);
    private final NotifyWorker notify;

    public AvisCommande(NotifyWorker notify) {
        this.notify = notify;
    }

    /** Rend true si AU MOINS un canal a réellement envoyé. */
    public boolean commandeExpediee(String email, String telephone, String idUtilisateur,
                                    String numero, String urlSuivi) {
        List<ChannelResult> resultats;
        try {
            resultats = notify.sendNotification(
                    null,                       // partition : null en mono-tenant (voir piège throttling)
                    "monapp",                   // userId → x_createdBy du journal
                    "ORDER_SHIPPED",
                    email,                      // destinataire principal
                    Map.of("recipient_name", "Client",
                           "order_id", numero,
                           "tracking_url", urlSuivi,
                           "action_url", urlSuivi),
                    null,                       // canaux : ceux de la config du type
                    null,                       // priorité : celle de la config
                    "fr",
                    Map.of("EMAIL", email,
                           "SMS", telephone,
                           "IN_APP", idUtilisateur));
        } catch (RuntimeException e) {          // une erreur SQL (throttling, journal) remonte telle quelle
            log.warn("[avis][step:envoi] commande {} : {}", numero, e.getMessage());
            return false;
        }
        resultats.stream().filter(r -> !r.success())
                 .forEach(r -> log.warn("[avis][step:envoi] commande {} : {}", numero, r.error()));
        return resultats.stream().anyMatch(ChannelResult::success);
    }
}
```

Points de contrat :

- La méthode **ne lève pas** pour un canal en échec : elle rend un `ChannelResult.ko`. Elle peut
  lever pour une erreur SQL (cas du throttling en mono-tenant, COM-05) — d'où le `try`.
- La liste rendue suit l'ordre des canaux ; pour un type sans config, elle contient **un seul**
  `ko` explicite (correctif COM-3 : plus de succès silencieux).
- Un type configuré avec `channels = []` rend une **liste vide** : rien n'est envoyé, rien n'échoue.
- Pour forcer un canal et un contenu brut sans gabarit (BingFetch) : `overrideChannels =
  List.of("EMAIL")` et `data = Map.of("subject", sujet, "body", corps)`.

---

## 4. Étape 2 — Appel MCP

Paramètres déclarés de `send_notification` : `type` (requis), `recipient` (requis), `data`,
`channels`, `priority` (`LOW|NORMAL|HIGH|CRITICAL`), `language`, `recipients_per_channel`.

```bash
curl -s -X POST http://monapp:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"notify_worker__send_notification",
        "arguments":{
          "type":"HARD_CAP_BREACH",
          "recipient":"ops@example.com",
          "priority":"CRITICAL",
          "data":{"scope":"TENANT_MONTH","current_usd":520,"threshold_usd":500,
                  "action_on_breach":"blocage","dashboard_url":"https://monapp.thesocle.net/couts"},
          "recipients_per_channel":{"EMAIL":"ops@example.com","SLACK":"#alerts-billing"}}}}' \
  | jq '.result.content[0].text | fromjson'
```

Réponse (enveloppe MCP déballée) :

```json
{"channels_attempted":2,"channels_sent":1,"channels_failed":1,
 "results":[{"success":true,"provider_message_id":"<…>","error":""},
            {"success":false,"provider_message_id":"","error":"channel unavailable"}]}
```

Depuis le Hub, par le proxy MCP — `params` est une **chaîne JSON** et l'outil porte le préfixe de l'app :

```bash
curl -s -X POST https://admin.thesocle.net/api/actions/mcp_proxy_worker/mcp_proxy_invoke \
  -H "X-Api-Key: $HUB_IAM_KEY" -H "Content-Type: application/json" \
  -d '{"tool":"monapp__notify_worker__send_notification",
       "params":"{\"type\":\"SYSTEM_ALERT\",\"recipient\":\"ops@example.com\",\"data\":{\"title\":\"Test\",\"message\":\"ok\",\"severity\":\"info\",\"timestamp\":\"2026-10-28\"}}"}'
```

Lot : `notify_worker__send_batch` avec `notifications: [ {type, recipient, data?, channels?, priority?, language?}, … ]`.
Réponse : `{requested, sent, failed}` — une entrée compte « sent » si au moins un de ses canaux a réussi.

---

## 5. Étape 3 — Priorités

| Priorité | Fenêtre anti-doublon effective | Délais de rejeu (1ʳᵉ, 2ᵉ, 3ᵉ) |
|---|---|---|
| `LOW`, `NORMAL` | `throttle_minutes` du type | 1 min, 5 min, 30 min |
| `HIGH` | `min(throttle_minutes, 1)` | 1 min, 5 min, 30 min |
| `CRITICAL` | aucune | 30 s, 1 min, 5 min |

`LOW` n'a aucun traitement propre : le « regroupement en digest » de la spec n'est pas implémenté.

---

## 6. Vérifier

```bash
# Historique (filtrable par recipient, type, since ISO-8601 ; limit défaut 50)
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"notify_worker__list_history","arguments":{"recipient":"ops@example.com","limit":10}}}' \
  | jq '.result.content[0].text | fromjson | .history[] | {notification_type,channel,status,error_message}'
```

```sql
SELECT correlation_id, channel, recipient, status, error_message, provider_message_id
  FROM schema_monapp.tr_notification_log
 ORDER BY x_dateCreated DESC LIMIT 10;
```

Les lignes d'un même appel partagent le même `correlation_id`.

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `send_notification` sur un type seedé (`USER_WELCOME`) | 2 lignes au journal (EMAIL, IN_APP), même `correlation_id` |
| 2 | Type inconnu | `channels_failed=1`, erreur « no notification config for type=… » |
| 3 | `channels:["IN_APP"]` forcé | une seule ligne, une entrée dans `tr_notification_inbox` |
| 4 | Canal non configuré (SMS sans fournisseur) | ligne `FAILED` « Channel SMS unavailable » |
| 5 | `recipients_per_channel` | chaque canal reçoit son propre destinataire |

Tests du pack : `NotifyConfigAndErrorTest` (type absent → erreur explicite).

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Lire le statut de l'action MCP | `send_notification` rend **toujours** un succès, même si tous les canaux ont échoué | lire `channels_sent` / `results[].success` |
| Un seul `recipient` pour plusieurs canaux | le SMS part vers une adresse courriel, l'IN_APP vers un e-mail au lieu d'un id utilisateur | `recipients_per_channel` par canal |
| `send_batch` | ignore `recipients_per_channel` (le code passe `null`) | une entrée par canal, ou appel Java en boucle |
| Partition attendue de l'appel MCP | `TenantResolver` lit `app.current_tenant_id` sur une connexion du pool : hors transaction de l'appelant, il rend `null` | multi-tenant : appel Java avec `partition` explicite (COM-05 §6) |
| Lire `result` de l'enveloppe MCP | champs vides, zéro, sans erreur | déballer `result.content[0].text` (chaîne JSON) |
| Proxy Hub avec `arguments` | « Parameters 'type' and 'recipient' are required » | `params` = **chaîne** JSON |
| `/api/actions/notify_worker__send_notification` (README) | 404 sur une app | `POST /mcp` sur l'app, ou proxy Hub |
| `MCP_API_KEY` vide (socle ≥ 5.9) | 401, ou l'app refuse de démarrer | poser `MCP_API_KEY` et `ADMIN_API_KEY` |
| `recipient_name` non fourni | gabarit « Bonjour alice@example.com » | le pack recopie `recipient` ; fournir `recipient_name` dans `data` |

---

## 9. Pour aller plus loin

- [[howto-com-03-types-et-gabarits|COM-03 — Déclarer des types et des gabarits]]
- [[howto-com-05-journal-rejeu-et-anti-doublon|COM-05 — Journal, rejeu et anti-doublon]]
- [[howto-com-08-webhook-et-notifications-in-app|COM-08 — Webhook et boîte in-app]]
- [[howto-13-utiliser-mcpagger|HOWTO 13 — MCPAgger]] (proxy MCP du Hub)
