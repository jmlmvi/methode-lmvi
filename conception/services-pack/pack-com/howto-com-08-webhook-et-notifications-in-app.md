# HOWTO COM-08 — Webhooks signés et boîte de notifications in-app

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-comm` **2.2.0** (branche `main`, commit `227fe5e`, tag `v2.2.0`, code identique à 2.1.0 — commit `ba69578` ; Spring Boot 4.1.2, socle 5.11.0, minimum 5.10.0) — comportement identique à 2.1.0, à 2.0.0 (socle 5.8.6-5.9.x, Boot 4.0.6) et à 1.1.0, dernière version Boot 3
**Vérifié au code le :** 2026-10-28
**Prérequis :** [[howto-com-02-envoyer-une-notification-multicanal|COM-02]]
**Temps estimé :** 30 min

---

## 1. Contexte

Deux canaux de `notify_worker` sont **toujours disponibles**, sans aucune configuration externe :

| Canal | Ce que fait le pack | Ce que fait l'app |
|---|---|---|
| `WEBHOOK` | `POST` JSON vers l'URL donnée comme destinataire, signature HMAC-SHA256 optionnelle | fournir des URL de confiance ; côté récepteur, vérifier la signature |
| `IN_APP` | insère une ligne dans `tr_notification_inbox` | **tout le reste** : API de lecture, marquage « lu », affichage, purge |

Le pack ne fournit **aucune action** pour lire la boîte ou marquer une notification lue :
`tr_notification_inbox` est une table que l'app expose elle-même.

---

## 2. Architecture

```
WEBHOOK
  NotifyWorker ─► WebhookChannel.send(url, subject, body, contexte)
                    POST url
                    Content-Type: application/json
                    User-Agent: socle-pack-comm/1.0
                    X-Socle-Signature: sha256=<hex HMAC-SHA256(secret, corps)>   (si hmac-secret)
                    {"subject":…, "body":…, "context":{…données + recipient, app_name, priority…}}
                  2xx → SENT (provider_message_id = code HTTP) ; sinon FAILED « Webhook HTTP <code> »

IN_APP
  NotifyWorker ─► InAppChannel.send(id_utilisateur, subject, body, contexte)
                    INSERT tr_notification_inbox (x_partition, id_utilisateur, notification_type,
                           title = subject|type, body, action_url, priority, icon, expires_at, datas)
  Frontend ◄── contrôleur REST de l'app ◄── SELECT … WHERE id_utilisateur = ? AND is_read = false
```

---

## 3. Étape 1 — Webhook sortant

```bash
# variable du conteneur
SOCLE_COMM_WEBHOOK_HMAC_SECRET=<32 octets aléatoires, base64>
```

```yaml
socle:
  comm:
    webhook:
      timeout-seconds: 10
```

Envoi : type dont les canaux contiennent `WEBHOOK`, URL dans `recipients_per_channel.WEBHOOK`
(ou `recipient` si c'est le seul canal) :

```java
notify.sendNotification(null, "monapp", "ORDER_SHIPPED", email,
        Map.of("order_id", "C-1042", "tracking_url", url),
        List.of("EMAIL", "WEBHOOK"), null, "fr",
        Map.of("EMAIL", email, "WEBHOOK", "https://erp.client.example/hooks/monapp"));
```

Le secret est **unique pour toute l'app** : tous les destinataires vérifient avec le même.

---

## 4. Étape 2 — Vérifier la signature côté récepteur

Récepteur V005 complet (contrôleur REST, pas un worker). Les classes HMAC du JDK
(`javax.crypto`, hors Jakarta EE) sont écrites en nom complet :

```java
package eu.lmvi.recepteur.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

@RestController
public class WebhookSocleController {

    private final byte[] secret;

    public WebhookSocleController(@Value("${recepteur.webhook-secret}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping(path = "/hooks/monapp", consumes = "application/json")
    public ResponseEntity<String> recevoir(@RequestBody byte[] corps,
                                           @RequestHeader(name = "X-Socle-Signature", required = false) String signature)
            throws Exception {
        if (signature == null || !signature.startsWith("sha256=")) return ResponseEntity.status(401).body("signature absente");
        var mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(secret, "HmacSHA256"));
        byte[] attendu = HexFormat.of().formatHex(mac.doFinal(corps)).getBytes(StandardCharsets.US_ASCII);
        byte[] recu = signature.substring(7).getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(attendu, recu)) return ResponseEntity.status(401).body("signature invalide");
        // corps = {"subject":…, "body":…, "context":{…}} — traiter de façon idempotente
        return ResponseEntity.ok("ok");
    }
}
```

Lire le corps en **octets bruts** : re-sérialiser un objet désérialisé change les octets et casse
la signature. La signature ne porte ni horodatage ni nonce : le récepteur dédoublonne lui-même
(par exemple sur `context.order_id`).

---

## 5. Étape 3 — Boîte in-app : écrire

Type dont les canaux contiennent `IN_APP` ; destinataire = **identifiant utilisateur** (colonne
`id_utilisateur VARCHAR(255)`), passé dans `recipients_per_channel.IN_APP`. Clés de `data`
reprises par le canal : `action_url`, `icon` (nom d'icône Phosphor), `expires_at` (ISO-8601,
converti en `timestamptz`), et `priority` (celle de l'envoi).

```java
notify.sendNotification(null, "monapp", "IMPORT_COMPLETE", idUtilisateur,
        Map.of("item_type", "contacts", "count", 1240, "errors", 0,
               "action_url", "/imports/77", "icon", "check-circle",
               "expires_at", "2026-11-30T00:00:00Z"),
        List.of("IN_APP"), null, "fr", null);
```

Le gabarit `IN_APP` fournit `title` (sujet) et `body`. Sans gabarit, `title` = le type.
(`IMPORT_COMPLETE` a un anti-doublon de 30 min : en mono-tenant, le ramener à 0 — COM-05 §5.)

---

## 6. Étape 4 — Boîte in-app : exposer à l'interface

Contrôleur REST de l'app, identité lue depuis l'en-tête posé par le proxy SSO du Hub :

```java
package eu.lmvi.monapp.web;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notifications")
public class NotificationsController {

    private final JdbcTemplate jdbc;

    public NotificationsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> nonLues(@RequestHeader("X-SSO-User") String utilisateur) {
        return jdbc.queryForList("""
                SELECT x_id, CAST(x_dateCreated AS text) AS cree_le, notification_type, title, body,
                       action_url, priority, icon
                  FROM tr_notification_inbox
                 WHERE id_utilisateur = ? AND is_read = false AND x_active = true
                   AND (expires_at IS NULL OR expires_at > now())
                 ORDER BY x_dateCreated DESC LIMIT 50""", utilisateur);
    }

    @PostMapping("/{id}/lue")
    public ResponseEntity<Void> marquerLue(@RequestHeader("X-SSO-User") String utilisateur, @PathVariable long id) {
        int n = jdbc.update("""
                UPDATE tr_notification_inbox SET is_read = true, read_at = now(), x_updatedBy = ?
                 WHERE x_id = ? AND id_utilisateur = ?""", utilisateur, id, utilisateur);
        return n == 1 ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }
}
```

Le nom de l'en-tête d'identité dépend du mode SSO de la route ([[howto-09-configurer-sso-multi-app|HOWTO 09]]) ;
la clause `id_utilisateur = ?` sur l'UPDATE empêche de marquer la notification d'un autre.
L'index `idx_tr_notification_inbox_user_unread (id_utilisateur, is_read, x_dateCreated DESC)` sert
exactement cette requête.

Purge, à planifier par l'app (le pack n'en fait aucune, malgré le commentaire « auto-purge » du DDL) :

```sql
DELETE FROM tr_notification_inbox
 WHERE (expires_at IS NOT NULL AND expires_at < now())
    OR (is_read AND read_at < now() - interval '90 days');
```

---

## 7. Vérifier

```sql
SELECT x_id, id_utilisateur, title, is_read, expires_at
  FROM schema_monapp.tr_notification_inbox ORDER BY x_dateCreated DESC LIMIT 5;
```

```bash
# Webhook : recalculer la signature à la main
corps='{"subject":"s","body":"b","context":{}}'
printf '%s' "$corps" | openssl dgst -sha256 -hmac "$SOCLE_COMM_WEBHOOK_HMAC_SECRET" -hex
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Webhook vers un récepteur 200 | `SENT`, `provider_message_id = "200"` |
| 2 | Récepteur 500 | `FAILED « Webhook HTTP 500 »`, rejoué selon COM-05 |
| 3 | Signature altérée côté récepteur | 401 |
| 4 | `IN_APP` sans destinataire | `FAILED « recipient (user_id) required »` |
| 5 | `expires_at` passé | notification absente de `GET /api/notifications` |

Tests du pack : `WebhookChannelTest` (3, MockWebServer), `InAppChannelTest` (2, Testcontainers).

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| URL de webhook venue d'un utilisateur | le pack poste vers n'importe quelle adresse, y compris interne (`http://soclehub:80`) | n'accepter que des URL d'une liste blanche tenue par l'app |
| `context` complet dans le corps du webhook | toutes les `data` partent chez le destinataire | `data` minimales pour les types routés en `WEBHOOK` |
| Pas de résilience immédiate sur le webhook | ni retry ni circuit breaker : seul le rejeu différé (COM-05) | récepteur idempotent et rapide (< `timeout-seconds`) |
| Signature vérifiée sur un corps re-sérialisé | 401 systématique | vérifier sur les octets bruts |
| Rejeu `IN_APP` par le poller | ligne `GENERIC`, partition NULL, sans `action_url` | rejouer côté app |
| Attendre une action « lire la boîte » | le pack n'en expose aucune | contrôleur REST de l'app (§6) |
| `title` > 200 caractères | échec d'insertion (`VARCHAR(200)`) | sujets courts pour `IN_APP` |
| `expires_at` mal formé | échec du cast `timestamptz`, `FAILED` | ISO-8601 complet avec fuseau |

---

## 10. Pour aller plus loin

- [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer une notification]]
- [[howto-com-05-journal-rejeu-et-anti-doublon|COM-05 — Journal et rejeu]]
- [[howto-09-configurer-sso-multi-app|HOWTO 09 — SSO multi-app]]
