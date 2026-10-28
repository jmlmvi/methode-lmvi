# HOWTO COM-07 — Envoyer des SMS (Twilio, OVH, Vonage, ou fournisseur maison)

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-comm` **2.0.0** (branche `feat/boot4`, commit `ffbfd75` ; Spring Boot 4.0.6, socle 5.9.0) — comportement identique à 1.1.0, dernière version Boot 3
**Vérifié au code le :** 2026-10-28
**Prérequis :** [[howto-com-01-integrer-le-pack|COM-01]] ; un compte chez l'un des fournisseurs
**Temps estimé :** 20 min

---

## 1. Contexte

Le Hub ne rend aucun service SMS : `sms_worker` est la voie de la plateforme pour une app V005.
Il porte trois fournisseurs, en sélectionne **un actif** par configuration, et accepte un
fournisseur maison : tout `@Component` qui implémente `eu.lmvi.socle.pack.comm.sms.SmsProvider`
est ramassé par Spring et rangé sous son `getName()`.

| Fournisseur | `getName()` | Authentification | Solde (`get_balance`) |
|---|---|---|---|
| Twilio | `twilio` | Basic `account_sid:auth_token` | `-1` (non implémenté) |
| OVH | `ovh` | en-têtes `X-Ovh-*`, signature `$1$` SHA-1 | `creditsLeft` du compte SMS |
| Vonage | `vonage` | `api_key` / `api_secret` en formulaire | `-1` (le solde monétaire est seulement journalisé) |

Aucune app de la flotte n'emploie le canal SMS au 2026-10-28 : ce HOWTO décrit le code, sans
retour de production.

---

## 2. Architecture

```
NotifyWorker ─► SmsChannel (tronque à 1 600 caractères, ignore le sujet)
                  │
MCP / Java ─────► SmsWorker.sendDirect(to, body, from, provider)
                     selectProvider(provider) ── null → fournisseur actif (socle.comm.sms.provider)
                     ResilienceFactory.execute(<nom>, () -> p.send(to, body, from))
                        ├─ TwilioSmsProvider  POST /2010-04-01/Accounts/{sid}/Messages.json
                        ├─ OvhSmsProvider     POST /1.0/sms/{serviceName}/jobs
                        ├─ VonageSmsProvider  POST /sms/json
                        └─ <votre @Component SmsProvider>
```

`SmsResult` : `(success, providerMessageId, provider, error, segmentsUsed)`.

---

## 3. Étape 1 — Configurer un fournisseur

Variables d'environnement (relaxed binding de `socle.comm.sms.*`) :

```bash
# commun
SOCLE_COMM_SMS_PROVIDER=ovh            # twilio | ovh | vonage | <nom maison>
SOCLE_COMM_SMS_FROM=MONAPP             # numéro E.164 ou expéditeur alphanumérique

# OVH
SOCLE_COMM_SMS_OVH_APPLICATION_KEY=…
SOCLE_COMM_SMS_OVH_APPLICATION_SECRET=…
SOCLE_COMM_SMS_OVH_CONSUMER_KEY=…
SOCLE_COMM_SMS_OVH_SERVICE_NAME=sms-ab12345-1

# ou Twilio
# SOCLE_COMM_SMS_TWILIO_ACCOUNT_SID=AC…
# SOCLE_COMM_SMS_TWILIO_AUTH_TOKEN=…

# ou Vonage
# SOCLE_COMM_SMS_VONAGE_API_KEY=…
# SOCLE_COMM_SMS_VONAGE_API_SECRET=…
```

Points d'URL surchargeables (tests, proxy) : `socle.comm.sms.twilio.base-url`
(`https://api.twilio.com/2010-04-01`), `ovh.base-url` (`https://eu.api.ovh.com/1.0`),
`vonage.base-url` (`https://rest.nexmo.com`).

Au démarrage : `[worker:sms_worker] initialized with provider=ovh available=true`. Sans
`SOCLE_COMM_SMS_PROVIDER`, le worker est désactivé ; avec un nom inconnu, il journalise
`provider 'x' not found. Available: [twilio, ovh, vonage]` et reste désactivé.

Expéditeur : Twilio et Vonage **exigent** `from` (paramètre ou `SOCLE_COMM_SMS_FROM`) ; OVH
l'omet si absent et prend l'expéditeur par défaut du compte.

---

## 4. Étape 2 — Envoyer

MCP :

```bash
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"sms_worker__send_sms",
        "arguments":{"to":"+33612345678","body":"Votre code : 482915"}}}' \
  | jq '.result.content[0].text | fromjson'
# {"success":true,"provider":"ovh","provider_message_id":"…","segments":1}
```

Lot : `sms_worker__send_batch` avec `messages: [{to, body, from?}, …]` et `provider` optionnel ;
réponse `{results:[{to, success, provider, message_id|error}], count}`.

Java :

```java
package eu.lmvi.monapp.sms;

import eu.lmvi.socle.pack.comm.SmsWorker;
import eu.lmvi.socle.pack.comm.sms.SmsResult;
import org.springframework.stereotype.Service;

@Service
public class CodeParSms {

    private final SmsWorker sms;

    public CodeParSms(SmsWorker sms) {
        this.sms = sms;
    }

    public String envoyer(String numeroE164, String code) {
        SmsResult r = sms.sendDirect(numeroE164, "Votre code : " + code, null, null);
        return r.success() ? r.providerMessageId() : "échec " + r.provider() + " : " + r.error();
    }
}
```

Via `notify_worker` : canal `SMS` d'un type, destinataire fourni dans
`recipients_per_channel.SMS` ([[howto-com-02-envoyer-une-notification-multicanal|COM-02]]).

---

## 5. Étape 3 — Ajouter un fournisseur maison

Implémenter l'interface et l'annoter `@Component` dans un package balayé par l'app :

```java
package eu.lmvi.monapp.sms;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.lmvi.socle.pack.comm.sms.SmsProvider;
import eu.lmvi.socle.pack.comm.sms.SmsResult;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;

@Component
public class PasserelleSmsMaison implements SmsProvider {

    private static final MediaType JSON = MediaType.get("application/json");
    private final OkHttpClient http = new OkHttpClient.Builder().callTimeout(Duration.ofSeconds(15)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String url;
    private final String cle;

    public PasserelleSmsMaison(@Value("${monapp.sms.url:}") String url,
                               @Value("${monapp.sms.cle:}") String cle) {
        this.url = url;
        this.cle = cle;
    }

    @Override public String getName() { return "maison"; }

    @Override public boolean isAvailable() { return !url.isBlank() && !cle.isBlank(); }

    @Override
    public SmsResult send(String to, String body, String from) {
        try {
            String json = mapper.writeValueAsString(Map.of("to", to, "text", body));
            Request req = new Request.Builder().url(url).header("Authorization", "Bearer " + cle)
                    .post(RequestBody.create(json, JSON)).build();
            try (Response res = http.newCall(req).execute()) {
                String b = res.body() == null ? "" : res.body().string();
                if (!res.isSuccessful()) return SmsResult.ko(getName(), "HTTP " + res.code() + " " + b);
                return SmsResult.ok(mapper.readTree(b).path("id").asText(""), getName(), 1);
            }
        } catch (Exception e) {
            return SmsResult.ko(getName(), e.getMessage());
        }
    }

    @Override public int getBalance() { return -1; }
}
```

puis `SOCLE_COMM_SMS_PROVIDER=maison`. Le circuit breaker et le retry du pack s'appliquent aussi
au fournisseur maison (clé `maison` dans la `ResilienceFactory`).

---

## 6. Vérifier

```bash
curl -s -X POST http://monapp:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sms_worker__list_providers","arguments":{}}}' \
  | jq '.result.content[0].text | fromjson'
# {"providers":[{"name":"ovh","available":true,"active":true}, …]}
```

Puis un SMS vers un téléphone réel, et `get_balance` pour constater le débit (OVH seulement).

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Sans `SOCLE_COMM_SMS_PROVIDER` | worker désactivé ; canal `SMS` indisponible dans `notify_worker` |
| 2 | `send_sms` Twilio sans `from` | échec « Sender number 'from' is required » |
| 3 | `provider:"inconnu"` | échec « Unknown SMS provider: inconnu » |
| 4 | Fournisseur maison déclaré | listé par `list_providers` |
| 5 | Corps de 2 000 caractères via `notify_worker` | tronqué à 1 600 |

Tests du pack : `TwilioSmsProviderTest` (3, MockWebServer).

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `getStats()` appelle `getBalance()` | chaque rafraîchissement du tableau de bord ou `get_status` fait un appel HTTP chez OVH/Vonage (lent, compté) | à connaître ; préférer `notify_worker__get_stats` pour la supervision |
| Numéro non E.164 | refus du fournisseur | normaliser en `+33…` avant l'appel |
| Expéditeur alphanumérique | refusé par certains opérateurs ou pays | numéro court ou long déclaré chez le fournisseur |
| Twilio / Vonage `get_balance` | toujours `-1` | consulter la console du fournisseur |
| Fournisseur forcé par `provider` | contourne le fournisseur actif, même s'il est indisponible | réserver le paramètre aux essais |
| Données personnelles | le numéro est conservé dans `tr_notification_log.recipient` | purge et effacement RGPD (COM-05 §4) |

---

## 9. Pour aller plus loin

- [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer une notification]]
- [[howto-com-05-journal-rejeu-et-anti-doublon|COM-05 — Journal et rejeu]]
- [[howto-com-06-telegram-et-slack|COM-06 — Telegram et Slack]]
