# HOWTO COM-06 — Publier sur Telegram et Slack

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-comm` **2.2.0** (branche `main`, commit `227fe5e`, tag `v2.2.0`, code identique à 2.1.0 — commit `ba69578` ; Spring Boot 4.1.2, socle 5.11.0, minimum 5.10.0) — comportement identique à 2.1.0, à 2.0.0 (socle 5.8.6-5.9.x, Boot 4.0.6) et à 1.1.0, dernière version Boot 3
**Vérifié au code le :** 2026-10-28
**Prérequis :** [[howto-com-01-integrer-le-pack|COM-01]] ; un bot Telegram (BotFather) et/ou un Incoming Webhook ou un jeton bot Slack
**Temps estimé :** 20 min

---

## 1. Contexte

Le pack fournit deux workers PASSIVE de messagerie, utilisables **seuls** (actions MCP, appel
Java) ou **via** `notify_worker` (canaux `TELEGRAM` et `SLACK`) :

| Worker | Actions MCP | Mode |
|---|---|---|
| `telegram_worker` | `send_message`, `send_document`, `get_updates`, `set_webhook`, `get_status` | Bot API, limiteur 25 msg/s |
| `slack_worker` | `send_message`, `send_webhook`, `list_channels`, `get_status` | Bot API si jeton, sinon Incoming Webhook |

Le Hub n'offre pas de service Telegram ou Slack : c'est donc bien au pack de le faire. Pour
prévenir l'exploitation de la plateforme, le carnet de bord passe par les salons et Alfred
([[howto-41-salons-echanger-entre-sessions|HOWTO 41]], [[howto-42-alfred-automatiser-une-tache|HOWTO 42]]),
pas par un bot propre à l'app.

---

## 2. Architecture

```
TelegramWorker.callBot(method, body)
   RateLimiter.acquire()   (fenêtre glissante 1 s, bloque le fil appelant)
   ResilienceFactory.execute("telegram", …)   retry 3× (500 ms → 10 s, jitter) dans un circuit breaker
   POST {base-url}/bot{token}/{sendMessage|sendDocument|getUpdates|setWebhook}

SlackWorker.doSendMessage(channel, text, blocks)
   jeton bot ? ─ oui ─► POST https://slack.com/api/chat.postMessage  (Authorization: Bearer)
              └ non ──► POST <webhook-url> {text, channel si "#…", blocks}  — réponse attendue "ok"
   ResilienceFactory.execute("slack", …)

Circuit breaker par fournisseur : ouvert après 5 échecs en 30 s, essai de réouverture après 60 s.
```

---

## 3. Étape 1 — Configurer

Les identifiants se posent **uniquement en variables d'environnement**, lues par le *relaxed
binding* de `CommProperties` ; le YAML ne porte que les réglages non secrets :

```yaml
socle:
  comm:
    telegram:
      rate-limit-per-second: 25
```

```bash
# variables du conteneur — n'en déclarer AUCUNE qui serait vide
SOCLE_COMM_TELEGRAM_BOT_TOKEN=123456789:AA…
SOCLE_COMM_TELEGRAM_DEFAULT_CHAT_ID=-1001234567890
SOCLE_COMM_SLACK_BOT_TOKEN=xoxb-…            # ou SOCLE_COMM_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…
SOCLE_COMM_SLACK_DEFAULT_CHANNEL=#ops
```

Écrire `bot-token: ${SOCLE_COMM_TELEGRAM_BOT_TOKEN:}` dans le YAML donnerait une chaîne vide quand
la variable manque, et le worker se croirait configuré (voir pièges).

Sans jeton ni webhook, chaque worker répond `isEnabled() = false` et se signale au démarrage :
`[worker:telegram_worker] no bot token configured … — worker désactivé`.

---

## 4. Étape 2 — Envoyer directement

MCP :

```bash
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"telegram_worker__send_message",
        "arguments":{"chat_id":"-1001234567890","text":"<b>Import terminé</b> : 1 240 lignes","parse_mode":"HTML"}}}'
# → {"message_id": 812}

curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"slack_worker__send_message",
        "arguments":{"channel":"#ops","text":"Import terminé",
                     "blocks":[{"type":"section","text":{"type":"mrkdwn","text":"*Import terminé* : 1 240 lignes"}}]}}}'
# → {"sent": true, "channel": "#ops"}
```

Java (méthodes publiques des workers, rendent un booléen) :

```java
package eu.lmvi.monapp.ops;

import eu.lmvi.socle.pack.comm.SlackWorker;
import eu.lmvi.socle.pack.comm.TelegramWorker;
import org.springframework.stereotype.Service;

@Service
public class AvisOps {

    private final TelegramWorker telegram;
    private final SlackWorker slack;

    public AvisOps(TelegramWorker telegram, SlackWorker slack) {
        this.telegram = telegram;
        this.slack = slack;
    }

    public boolean importTermine(int lignes) {
        String texte = "Import terminé : " + lignes + " lignes";
        boolean t = telegram.sendDirect(null, texte, "HTML");   // null → default-chat-id
        boolean s = slack.sendDirect(null, texte);               // null → default-channel
        return t || s;
    }
}
```

Autres actions : `telegram_worker__send_document` (`chat_id`, `file_url`, `caption`) envoie un
document **par URL** (Telegram le télécharge : l'URL doit être publique) ; `get_updates`
(`offset`, `limit`) fait du polling ; `set_webhook` (`url` HTTPS publique) bascule le bot en
réception par webhook — l'app doit alors exposer elle-même le contrôleur qui reçoit les mises à jour.
`slack_worker__send_webhook` (`webhook_url`, `payload`) poste un payload brut ;
`list_channels` exige le jeton bot (200 canaux maximum, sans pagination).

---

## 5. Étape 3 — Via `notify_worker`

Canaux `TELEGRAM` et `SLACK` d'un type ([[howto-com-03-types-et-gabarits|COM-03]]). Le canal :

- Telegram : préfixe le sujet en gras Markdown (`*sujet*`), force `parse_mode = Markdown` ;
  destinataire = `chat_id`, sinon `default-chat-id`.
- Slack : préfixe `*sujet*\n` ; destinataire = `#canal` ou id, sinon `default-channel`.
- `provider_message_id` est vide au journal pour ces deux canaux.

---

## 6. Vérifier

```bash
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"slack_worker__list_channels","arguments":{}}}'
```

Et vérifier le message dans le canal réel. `get_status` est fiable **après** un premier envoi réussi
(voir pièges).

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Sans jeton Telegram | worker désactivé, canal `TELEGRAM` indisponible |
| 2 | `send_message` HTML valide | `message_id` rendu, message visible |
| 3 | Texte contenant `_` ou `*` isolé, en Markdown | échec Telegram « can't parse entities » |
| 4 | Slack webhook seul, `channel:"#autre"` | message posté dans le canal du webhook (Slack ignore la surcharge sur les webhooks récents) |
| 5 | 6 échecs consécutifs | `CircuitOpenException`, envois refusés pendant 60 s |

Tests du pack : `RateLimiterTest` (4), `CircuitBreakerTest` (4).

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `parse_mode` Markdown par défaut | « can't parse entities » dès qu'un nom contient `_`, `*`, `[` ; puis 3 tentatives et circuit ouvert | `parse_mode: "HTML"` en appel direct ; via `notify_worker`, gabarits sans caractères Markdown non appariés |
| `get_status` avant tout envoi | échec `NullPointerException` : `getStats()` met `last_activity = null` et `ActionResult` refuse les valeurs nulles | lire `notify_worker__get_stats` ; ou envoyer un message d'essai d'abord |
| Variable vide (`SOCLE_COMM_SLACK_WEBHOOK_URL=`) | worker « configuré », puis échec à chaque envoi (URL vide) | ne pas déclarer la variable, ou `#{null}` |
| Limiteur bloquant | au-delà de 25 msg/s le fil appelant dort (`Thread.sleep`) | envoyer hors du fil d'une requête HTTP |
| Limite Telegram par chat | ~1 msg/s par chat individuel, ~20/min par groupe côté Telegram ; le limiteur ne connaît que le global | espacer les envois vers un même chat |
| Slack webhook + `channel` | ignoré par les webhooks modernes | jeton bot pour cibler un canal |
| `send_document` avec une URL interne | Telegram ne peut pas la télécharger | URL publique (URL présignée du storage du Hub, [[howto-16-storage-s3-quotas|HOWTO 16]]) |
| Jeton dans l'URL Telegram | `bot<token>` apparaît dans l'URL appelée | ne jamais journaliser les URL OkHttp en DEBUG |

---

## 9. Pour aller plus loin

- [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer une notification]]
- [[howto-com-07-envoyer-des-sms|COM-07 — SMS]]
- [[howto-com-08-webhook-et-notifications-in-app|COM-08 — Webhook et in-app]]
