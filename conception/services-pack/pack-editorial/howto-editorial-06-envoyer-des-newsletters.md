# HOWTO EDITORIAL-06 — Composer et envoyer des newsletters avec `newsletter_worker`

**Niveau :** Confirmé
**Cible :** application V005 embarquant le pack — 2.0.0 sur Spring Boot 4.0.6 (1.0.0-SNAPSHOT sur Boot 3.2.1 : contenu identique)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-editorial:2.0.0`, `feat/boot4` @ `8879bf7` (fonctionnellement identique à `1.0.0-SNAPSHOT`, `main` @ `fffd6f9`) —
`NewsletterWorker`, `NewsletterRenderer`, gabarits `templates/editorial/newsletter-{digest,flash,premium}.html` ;
migration `V003` ; type `NEWSLETTER` seedé par `socle-pack-comm` (`db/comm/V004__seed_newsletter_config.sql`)
**Prérequis :** des articles dans `tr_article` ([[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03]]) ;
[[howto-com-01-integrer-le-pack|pack-comm]] avec un fournisseur e-mail ;
[[howto-ai-01-integrer-le-pack|pack-ai]] pour l'introduction rédigée par IA (facultatif)
**Temps estimé :** 40 min

---

## 1. Contexte

`newsletter_worker` sélectionne les meilleurs articles publiés depuis le dernier envoi, rédige
facultativement une introduction par LLM, rend un HTML e-mail à partir d'un des trois gabarits, et
l'envoie à chaque abonné par `NotifyWorker` (pack-comm, canal `EMAIL`). Chaque envoi est historisé
avec un instantané du HTML.

| Action | Mode | Rôle |
|---|---|---|
| `create_newsletter` / `edit_newsletter` / `delete_newsletter` / `list_newsletters` | SYNC | configuration (`z_newsletter_config`) |
| `preview` | SYNC | HTML sans envoi |
| `send_test` | SYNC | envoi à une adresse, sans historique |
| `send_now` | ASYNC | envoi à tous les abonnés, historique `tr_newsletter_envoi` |
| `list_history` | SYNC | envois passés |
| `get_status` | SYNC | santé |

**État :** rendu, envoi, historique et planification **fonctionnels** (tests `NewsletterLogicTest`,
`NewsletterScheduleTest` sur `isDue` et le jeton de désabonnement). Restent **à la charge de
l'application** : le prompt d'introduction (absent des seeds de pack-ai), l'**endpoint de
désabonnement**, la gestion des abonnés au-delà d'une liste JSON. Aucune application connue ne
l'emploie en production (le `newsletter_collector_worker` de RssArchiver *collecte* des newsletters
entrantes : c'est un autre sujet).

---

## 2. Architecture

```
send_now(newsletter_id)                    planificateur (opt-in, toutes les scheduler-interval-seconds)
   │                                          └ runScheduleCycle : status='active', abonnés ≠ ∅, isDue(frequency, last_sent_at)
   ▼ renderNewsletter
 SELECT x_id,title,url,summary,tags,score,source_name FROM tr_article
   WHERE validated_at > COALESCE(last_sent_at, now() - 7 jours)
     AND x_partition = <partition de la newsletter>          (si non NULL)
     AND tags ?| array[<thematics>]                          (si thematics non vide)
   ORDER BY score DESC, validated_at DESC LIMIT article_count
 [intro_ai_enabled] GenerationWorker.generateOne(partition, intro-prompt-id,
                    {titles: 5 premiers titres, language, newsletter_name}, {temperature:0.5, max_tokens:256})
 NewsletterRenderer.render(template, …)  {newsletter_name} {date} {language} {primary_color}
                                         {intro_section} {articles_html} {app_name} {unsubscribe_url}
   ▼
 INSERT tr_newsletter_envoi (status 'pending', html_preview, article_ids)
 pour chaque abonné :
   html.replace("__UNSUB_TOKEN__", jeton propre à l'abonné)
   NotifyWorker.sendNotification(partition, null, "NEWSLETTER", email,
       {subject:"[<name>] AAAA-MM-JJ", body:html, recipient_name:email, app_name},
       ["EMAIL"], "NORMAL", language, null)
 UPDATE tr_newsletter_envoi : sent | partial | failed ; z_newsletter_config.last_sent_at = now()
```

---

## 3. Étape 1 — Créer le prompt d'introduction

`intro-prompt-id` vaut `newsletter_intro` par défaut, et **pack-ai ne le seede pas** : sans lui,
l'introduction échoue (journal `[newsletter-render] intro AI failed`) et la lettre part sans
introduction. À créer dans la table de prompts de pack-ai (schéma de pack-ai) :

```sql
INSERT INTO schema_monapp.z_config_ia
    (prompt_id, version, content, active, provider, model, temperature, max_tokens, description, x_createdBy, datas)
VALUES
    ('newsletter_intro', '1.0.0',
$$Tu rédiges l'introduction de la newsletter « {newsletter_name} ».
En 2 ou 3 phrases, dans la langue « {language} », présente les sujets du numéro à partir de ces titres,
sans en inventer d'autres et sans formule commerciale :
{titles}$$,
     true, null, null, 0.5, 256, 'Introduction de newsletter (pack-editorial)', 'monapp', '{}'::jsonb)
ON CONFLICT (x_partition, prompt_id, version) DO NOTHING;
```

---

## 4. Étape 2 — Créer la newsletter

```bash
editorial newsletter_worker__create_newsletter '{
  "name": "Veille IA hebdo",
  "config": {
    "thematics": ["IA", "régulation"],
    "frequency": "weekly",
    "article_count": 10,
    "detail_level": "summary",
    "template": "digest",
    "primary_color": "#5B2A86",
    "intro_ai_enabled": true,
    "subscribers": ["alice@example.com", "bob@example.com"],
    "language": "fr"
  }
}'
# → {"newsletter_id": 1, "name": "Veille IA hebdo"}
```

| Champ | Valeurs | Défaut | Note |
|---|---|---|---|
| `thematics` | liste | `[]` = tous les articles | comparé **exactement** aux `tags` des articles |
| `frequency` | `daily` \| `weekly` \| `biweekly` \| `monthly` | `weekly` | `monthly` = 30 jours |
| `article_count` | entier | 10 | |
| `detail_level` | `summary` \| `full` | `summary` | effet sur `digest` seulement (1ʳᵉ phrase / résumé entier) |
| `template` | `digest` \| `flash` \| `premium` | `digest` | inconnu → `digest` |
| `primary_color` | `#RRGGBB` | `#0066CC` | 7 caractères max |
| `language` | `fr` \| `en` | `fr` | format de date ; autre valeur → date en français |

`flash` affiche la première phrase du résumé, `premium` le résumé entier en typographie serif.

Modifier : `edit_newsletter` avec un `config` partiel (clés acceptées : les mêmes, plus `status`
`active` | `paused`).

---

## 5. Étape 3 — Prévisualiser, tester, envoyer

```bash
# HTML sans envoi (le jeton de désabonnement y figure sous la forme __UNSUB_TOKEN__)
editorial newsletter_worker__preview '{"newsletter_id":1}' > apercu.json

# Une adresse de test — pas d'historique, last_sent_at inchangé
editorial newsletter_worker__send_test '{"newsletter_id":1,"test_email":"moi@monapp.fr"}'

# Tous les abonnés
editorial newsletter_worker__send_now '{"newsletter_id":1}'
```

Le HTML se trouve dans le champ `html` de la donnée rendue (elle-même dans `content[0].text` de
l'enveloppe MCP). Réponse de `send_now` une fois le job terminé :

```json
{"newsletter_id":1,"envoi_id":7,"status":"sent","sent":2,"failed":0,"total_subscribers":2,"articles_count":10}
```

L'expéditeur, le relais SMTP et la limitation de débit sont ceux de pack-comm
([[howto-com-01-integrer-le-pack|COM-01]]).

---

## 6. Étape 4 — Planifier l'envoi automatique

```yaml
socle:
  editorial:
    newsletter:
      scheduler-enabled: ${SOCLE_EDITORIAL_NEWSLETTER_SCHEDULER_ENABLED:true}
      scheduler-interval-seconds: ${SOCLE_EDITORIAL_NEWSLETTER_SCHEDULER_INTERVAL_SECONDS:3600}
```

Le planificateur ne démarre que si `scheduler-enabled` **et** `NotifyWorker` est présent (période
minimale 30 s). Journal : `[worker:newsletter_worker] scheduler newsletter démarré (toutes les 3600s)`.

**Avant de l'activer**, poser `last_sent_at` sur les newsletters existantes : une newsletter jamais
envoyée est jugée « due » et part au premier cycle.

```sql
UPDATE schema_monapp.z_newsletter_config
SET last_sent_at = now()
WHERE last_sent_at IS NULL AND status = 'active';
```

---

## 7. Étape 5 — Le désabonnement (à écrire dans l'application)

Le pack fabrique le lien, il ne le traite pas. Avec `unsubscribe-secret` renseigné, le jeton vaut
`base64url(email) + "." + hex(HMAC-SHA256(email + "|" + newsletterId, secret))`. Le lien ne
contenant pas l'identifiant de la newsletter, le contrôleur vérifie le HMAC contre chaque
newsletter qui compte cette adresse :

```java
package eu.lmvi.monapp.newsletter;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

@RestController
public class UnsubscribeController {

    private static final String S = "schema_monapp";
    private final JdbcTemplate jdbc;
    private final String secret;

    public UnsubscribeController(JdbcTemplate jdbc,
                                 @Value("${socle.editorial.newsletter.unsubscribe-secret:}") String secret) {
        this.jdbc = jdbc;
        this.secret = secret;
    }

    @GetMapping(value = "/unsubscribe", produces = "text/html;charset=UTF-8")
    public ResponseEntity<String> unsubscribe(@RequestParam String token) throws Exception {
        if (secret.isBlank()) return ResponseEntity.status(503).body("<p>Désabonnement indisponible.</p>");
        int dot = token.indexOf('.');
        if (dot <= 0) return ResponseEntity.badRequest().body("<p>Lien invalide.</p>");

        String email = new String(Base64.getUrlDecoder().decode(token.substring(0, dot)), StandardCharsets.UTF_8);
        byte[] recu = HexFormat.of().parseHex(token.substring(dot + 1));

        List<Long> candidates = jdbc.queryForList(
                "SELECT x_id FROM " + S + ".z_newsletter_config WHERE jsonb_exists(subscribers, ?)",
                Long.class, email);
        int retires = 0;
        for (Long id : candidates) {
            if (MessageDigest.isEqual(recu, hmac(email + "|" + id))) {
                retires += jdbc.update(
                        "UPDATE " + S + ".z_newsletter_config SET subscribers = subscribers - ? WHERE x_id = ?",
                        email, id);
            }
        }
        return retires > 0
                ? ResponseEntity.ok("<p>Vous êtes désabonné.</p>")
                : ResponseEntity.badRequest().body("<p>Lien invalide ou déjà utilisé.</p>");
    }

    private byte[] hmac(String data) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
    }
}
```

`jsonb_exists(subscribers, ?)` équivaut à l'opérateur `subscribers ? '<email>'`, sans le conflit
entre ce `?` et le marqueur de paramètre JDBC. Les classes de chiffrement du JDK sont écrites en nom
qualifié, conformément à la règle de gouvernance GOV-010 du dépôt.

Le lien doit être joignable sans authentification : exclure `/unsubscribe` du SSO de la route
([[howto-09-configurer-sso-multi-app|HOWTO 09]]).

---

## 8. Vérifier

```bash
editorial newsletter_worker__list_history '{"newsletter_id":1,"limit":5}'
editorial newsletter_worker__get_status '{}'    # {"worker":"newsletter_worker","healthy":true}
```

```sql
SELECT x_id, status, articles_count, recipients_count, recipients_sent, recipients_failed, sent_at
FROM schema_monapp.tr_newsletter_envoi
ORDER BY x_id DESC LIMIT 5;

-- Le HTML exactement envoyé (avant substitution du jeton)
SELECT html_preview FROM schema_monapp.tr_newsletter_envoi WHERE x_id = 7;
```

Le détail par destinataire (statut SMTP, reprises) est dans `tr_notification_log` de pack-comm.

---

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `preview` avec 3 articles validés depuis 7 jours | HTML avec 3 blocs, introduction si le prompt existe |
| 2 | `thematics: ["IA"]`, articles tagués `ia` | **aucun** article (comparaison sensible à la casse) |
| 3 | `send_test` | e-mail reçu ; `tr_newsletter_envoi` inchangé |
| 4 | `send_now`, un abonné invalide | `status = partial`, `recipients_failed = 1` |
| 5 | Deuxième `send_now` immédiat | seuls les articles validés depuis le premier envoi |
| 6 | Clic sur le lien de désabonnement | adresse retirée de `subscribers` |
| 7 | Planificateur activé, newsletter jamais envoyée | envoi au premier cycle |

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Prompt `newsletter_intro` absent | `intro AI failed`, lettre sans introduction | §3 |
| Aucun article sur la période | la lettre **part quand même**, vide : rien ne bloque un envoi à zéro article | contrôler `preview` (`article_count`) avant `send_now` |
| `thematics` différentes des tags produits par le LLM | sélection vide | aligner les thématiques sur les tags réels (`SELECT DISTINCT jsonb_array_elements_text(tags) FROM tr_article`) |
| `from_email` / `from_name` | stockés, **jamais transmis** à `NotifyWorker` : l'expéditeur est celui de pack-comm | régler l'expéditeur dans pack-comm |
| Objet du message | fixe : `[<nom>] AAAA-MM-JJ` | adapter le gabarit `NEWSLETTER` côté pack-comm s'il surcharge `subject` |
| `unsubscribe-secret` vide | jeton = `base64url(email\|id)`, **falsifiable** : n'importe qui désabonne n'importe qui | toujours renseigner le secret (Vault) |
| Endpoint `/unsubscribe` absent | lien en 404 | §7 |
| `base-url` vide | lien relatif `/unsubscribe?token=…`, inutilisable dans un client mail | `APP_BASE_URL` |
| Planificateur activé sur un parc existant | toutes les newsletters jamais envoyées partent d'un coup | §6 : poser `last_sent_at` d'abord |
| `delete_newsletter` | supprime aussi l'historique (CASCADE sur `tr_newsletter_envoi`) | `edit_newsletter` avec `status: paused` |
| Deux newsletters de même nom en mono-tenant | acceptées : l'index `(x_partition, name)` laisse passer les `NULL` | contrôler côté application |
| `edit_newsletter` avec `article_count` en chaîne | `ClassCastException` (conversion en `Number`) | envoyer un entier JSON |
| `newsletter_worker` unhealthy | `isHealthy()` = présence de `NotifyWorker` | intégrer pack-comm |
| Gros volume d'abonnés | envoi séquentiel dans une seule action, une ligne `tr_notification_log` par abonné | au-delà de quelques centaines, un outil d'e-mailing dédié |

---

## 11. Pour aller plus loin

- [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03 — Curer et router]] — d'où viennent `score` et `tags`
- [[howto-editorial-05-valider-en-hitl|EDITORIAL-05 — Valider en HITL]]
- [[howto-com-01-integrer-le-pack|pack-comm]] — `NotifyWorker`, type `NEWSLETTER`, fournisseurs e-mail
- [[howto-11-configurer-james-mail|HOWTO 11]] — le relais mail du Hub
- [[howto-ai-01-integrer-le-pack|pack-ai]] — prompts et fournisseurs LLM
