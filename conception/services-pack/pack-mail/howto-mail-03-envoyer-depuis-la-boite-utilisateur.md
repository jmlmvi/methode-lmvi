# HOWTO MAIL-03 — Envoyer depuis la boîte de l'utilisateur (plages horaires, quota, envois différés)

**Niveau :** Confirmé
**Cible :** application V005 qui embarque `socle-pack-mail`
**Versions vérifiées au code (2026-10-28) :** `socle-pack-mail` **1.5.0** (commit `a396ada`, tag `v1.5.0`) · socle **5.10.0** · Spring Boot 4.1.2 · `jakarta.mail-api` 2.1.5 + `angus-mail` 2.0.5 · OkHttp `okhttp-jvm` 5.5.1 (du socle) — comportement inchangé depuis 1.4.0
**Prérequis :** [[howto-mail-01-integrer-le-pack|MAIL-01]] ; accès SMTP/IMAP de l'utilisateur ou OAuth2 Gmail avec le droit d'envoi
**Temps estimé :** 40 min

---

## 1. Contexte

`mail_send_worker` envoie un courriel **au nom d'un utilisateur, depuis sa propre boîte** : le
destinataire voit l'adresse réelle de l'utilisateur, la réponse revient dans sa boîte, et le message
est rangé dans son dossier « Envoyés ». C'est l'envoi d'un commercial à un prospect, pas un envoi
applicatif.

| Besoin | Voie |
|---|---|
| Notification, accusé, lien d'activation **envoyés par l'application** | Hub — `mail_worker.send_templated_email` (gabarits du Hub) |
| Envoi depuis une boîte James du Hub au nom de l'app | Hub — `james_worker.send_via_james` ([[howto-11-configurer-james-mail\|HOWTO 11]] §8) |
| **Envoi depuis la boîte personnelle d'un utilisateur**, avec plages et quota | **pack** — `mail_send_worker` |

Garde-fous appliqués par le pack avant l'envoi :

- **quota** : nombre d'envois `status='sent'` des 24 dernières heures, comparé à
  `z_mail_config.daily_quota` (défaut `SOCLE_MAIL_SEND_DEFAULT_DAILY_QUOTA` = 20) ;
- **plage** : jour (`send_days`, 1 = lundi … 7 = dimanche, défaut lundi–vendredi) et heure
  (`send_hours_start`–`send_hours_end`, défaut 08:00–19:00) dans le fuseau `timezone`
  (défaut `Europe/Paris`). Hors plage, le courriel est **différé** à l'ouverture suivante.

Deux transports, choisis par les identifiants disponibles (Gmail prioritaire) :

| Transport | Classe | Comportement |
|---|---|---|
| `gmail_api` | `GmailApiSender` | refresh OAuth2 puis `POST /users/me/messages/send` ; Gmail range lui-même dans Envoyés |
| `imap_smtp` | `ImapSmtpSender` | SMTP (port 465 → SSL, sinon STARTTLS ; défaut 587) puis `APPEND` IMAP dans le premier dossier trouvé parmi `Sent`, `Envoyés`, `INBOX.Sent`, `[Gmail]/Sent Mail`, `[Gmail]/Envoyés` |

---

## 2. Architecture

```
 send_mail(user_id, to, subject, body, cc?, id_mail_propose?, force_send?)
        │
        ▼
 z_mail_config (from_email, from_name, plages, jours, quota, timezone)
        │
        ├─ quota atteint et !force_send ───────────────► échec « Daily quota reached: n/q »
        ├─ hors plage et !force_send ─► INSERT tr_mail_envoye(status=deferred, scheduled_for)
        │                                    ▲
        │                 poller interne (5 min) : DELETE la ligne puis envoi direct
        ▼
 VaultCredentialResolver.readCredentials(appId, user, "gmail" | "imap")
        │
        ├─ gmail → GmailApiSender ─┐
        └─ imap  → ImapSmtpSender ─┤
                                   ▼
                INSERT tr_mail_envoye(status=sent|failed, sent_via, folder_stored, provider_message_id)
                UPDATE tr_mail_propose SET status='sent'  (si id_mail_propose)
```

---

## 3. Étape 1 — Fournir les identifiants d'envoi

`send_mail` **ne prend aucun identifiant en paramètre** : il les demande à
`VaultCredentialResolver.readCredentials(appId, userId, type)`. En 1.4.0 comme en 1.5.0 cette méthode rend toujours
`null` dans une app (la partition `appId` vaut `null` — `safePartition()` — et le socle (5.9.5 comme 5.10.0) ne
publie aucun bean Vault lisible par le pack). **Sans action de l'hôte, tout envoi échoue** avec
`No mail credentials for user alice (neither gmail nor imap in Vault)`.

L'hôte fournit donc sa propre résolution, en publiant une sous-classe `@Primary` : `MailSendWorker`
reçoit son résolveur par type, et `@Primary` l'emporte sur le bean du pack.

```java
package eu.lmvi.mail;

import eu.lmvi.socle.pack.mail.adapter.vault.VaultCredentialResolver;
import eu.lmvi.socle.pack.mail.config.MailProperties;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Identifiants d'envoi par utilisateur, lus dans la configuration de l'application :
 * app.mail.comptes.<user_id>.<imap|gmail>.<clé>. Les secrets arrivent par variables
 * d'environnement injectées depuis Vault — jamais en clair dans le dépôt.
 */
@Primary
@Component
public class IdentifiantsDepuisConfiguration extends VaultCredentialResolver {

    private final Binder binder;

    public IdentifiantsDepuisConfiguration(MailProperties props, Environment env) {
        super(props, null);                 // le chemin Vault du pack n'est pas utilisé
        this.binder = Binder.get(env);
    }

    @Override
    public Map<String, String> readCredentials(String appId, String userId, String credType) {
        if (userId == null || credType == null) return null;
        return binder.bind("app.mail.comptes." + userId + "." + credType,
                           Bindable.mapOf(String.class, String.class))
                     .orElse(null);
    }

    @Override
    public boolean isEnabled() {
        return true;
    }
}
```

`application.yml` — les clés qui contiennent `_` s'écrivent **entre crochets** : en liaison de
`Map`, Spring retire sinon tout caractère autre que lettres, chiffres, `-` et `.`
(`smtp_port` deviendrait `smtpport`, que le pack ne lit pas).

```yaml
app:
  mail:
    comptes:
      alice:                             # user_id : minuscules, chiffres, « - »
        imap:
          host: mail.exemple.fr          # SMTP et IMAP si smtp_host / imap_host absents
          "[smtp_port]": "587"
          "[imap_port]": "993"
          ssl: "true"
          username: alice@exemple.fr
          password: ${MAIL_ALICE_PASSWORD}
          "[from_email]": alice@exemple.fr
          "[sent_folder]": Envoyés       # facultatif : sinon détection automatique
```

Pour Gmail : sous `gmail`, les clés `"[refresh_token]"`, `"[client_id]"`, `"[client_secret]"`,
`"[from_email]"`.

## 4. Étape 2 — Régler les préférences d'envoi de l'utilisateur

Aucune action du pack n'écrit les plages, le quota ou l'expéditeur : `configure_sync` ne touche que
`sync_enabled` / `sync_frequency`. L'application écrit `z_mail_config` elle-même.

```java
package eu.lmvi.mail;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PreferencesEnvoi {

    private final JdbcTemplate jdbc;

    public PreferencesEnvoi(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Une ligne par utilisateur (unicité owner_user_id). Jours : 1 = lundi … 7 = dimanche. */
    public void enregistrer(String utilisateur, String adresse, String nom, String debut, String fin,
                            String joursJson, int quota, String fuseau) {
        jdbc.update("""
            INSERT INTO schema_monapp.z_mail_config
                (x_createdBy, owner_user_id, from_email, from_name, send_hours_start, send_hours_end,
                 send_days, daily_quota, timezone)
            VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
            ON CONFLICT (owner_user_id) DO UPDATE SET
                from_email = EXCLUDED.from_email, from_name = EXCLUDED.from_name,
                send_hours_start = EXCLUDED.send_hours_start, send_hours_end = EXCLUDED.send_hours_end,
                send_days = EXCLUDED.send_days, daily_quota = EXCLUDED.daily_quota,
                timezone = EXCLUDED.timezone, x_dateUpdated = now()""",
            utilisateur, utilisateur, adresse, nom, debut, fin, joursJson, quota, fuseau);
    }
}
```

Appel : `preferences.enregistrer("alice", "alice@exemple.fr", "Alice Martin", "09:00", "18:00", "[1,2,3,4,5]", 30, "Europe/Paris")`.

## 5. Étape 3 — Envoyer

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"mail_send_worker__send_mail",
                 "arguments":{"user_id":"alice","to":"jean.dupont@acme.com",
                              "subject":"Votre levée ACME — un café mardi ?",
                              "body":"Bonjour M. Dupont,\n\n…","cc":["bob@exemple.fr"],
                              "id_mail_propose":88}}}'
```

Réponses possibles (dans `content[0].text`) :

```json
{"status":"sent","envoye_id":123,"sent_via":"imap_smtp","folder_stored":"Envoyés","provider_message_id":"<…>"}
{"status":"deferred","scheduled_for":"2026-10-29T09:00","envoye_id":124}
{"status":"sent_but_log_failed","error":"…"}
```

Un échec rend `isError` avec le message du transport, ou `Daily quota reached: 30/30`.

| Action | Rôle |
|---|---|
| `send_mail` | un envoi, garde-fous compris ; `force_send: true` passe outre quota **et** plage |
| `send_batch` | `mails: [ {mêmes champs que send_mail}, … ]` → `{sent, deferred, failed, total}` |
| `store_in_sent` | inscrit dans `tr_mail_envoye` un envoi fait hors plateforme (`sent_via='manual'`) |
| `get_status` | compteurs, `deferred_pending` |

---

## 6. Vérifier

```sql
SELECT x_id, status, sent_via, folder_stored, scheduled_for, sent_at, error_message
FROM schema_monapp.tr_mail_envoye
WHERE owner_user_id = 'alice' ORDER BY x_id DESC LIMIT 10;
```

Côté boîte : le message figure dans le dossier « Envoyés » de l'utilisateur (`imap_smtp`) ou dans
« Messages envoyés » de Gmail (`gmail_api`).

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Envoi dans la plage | `sent`, ligne `tr_mail_envoye`, message dans Envoyés |
| 2 | Envoi un samedi (plage lundi–vendredi) | `deferred`, `scheduled_for` = lundi à l'heure d'ouverture |
| 3 | Attendre l'ouverture + 5 min | ligne différée remplacée par une ligne `sent` |
| 4 | Quota de 1, deux envois | second refusé « Daily quota reached » |
| 5 | Sans résolveur de l'hôte (§3) | « No mail credentials for user … » |
| 6 | `id_mail_propose` fourni | `tr_mail_propose.status = 'sent'` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Compter sur Vault pour l'envoi | tout envoi échoue : `No mail credentials … in Vault` | Résolveur `@Primary` de l'hôte (§3) |
| Envoyer par le pack un courriel **de l'application** | adresse d'un utilisateur au lieu de celle de l'app, quota consommé | `mail_worker.send_templated_email` du Hub |
| Fuseau de la JVM ≠ fuseau de l'utilisateur | envoi différé décalé d'une à deux heures | `scheduled_for` est une heure locale de l'utilisateur convertie par `Timestamp.valueOf`, donc lue dans le fuseau **de la JVM**. Faire tourner la JVM dans le fuseau des utilisateurs (`TZ=Europe/Paris`) |
| Envois différés et quota | le poller dépasse le quota du jour | La relance passe directement par l'envoi, **sans** recontrôler quota ni plage |
| Crash entre `DELETE` et envoi d'un différé | courriel différé perdu, sans trace | Le poller supprime la ligne avant d'envoyer : surveiller `deferred_pending` et l'écart avec les envois |
| `store_in_sent` pris au mot | rien n'apparaît dans le dossier IMAP « Envoyés » | L'action n'écrit **que** la table `tr_mail_envoye` |
| Rien dans `z_mail_config` | expéditeur = `username`, plages et quota par défaut | Écrire la préférence (§4) |
| Texte brut contenant `<` et `>` (ex. `Jean <jean@acme.com>`) | message parti en `text/html`, retours à la ligne perdus | Les deux transports choisissent `text/html` dès que le corps contient `<` **et** `>` : envoyer un vrai HTML (`<br>`) ou retirer les chevrons |
| Clés avec `_` dans `app.mail.comptes` sans crochets | `smtp_port`, `from_email`, `refresh_token` ignorés | En liaison de `Map`, Spring retire les `_` des clés hors crochets : écrire `"[smtp_port]"` (§3) |
| `user_id` avec majuscules ou `@` | `InvalidConfigurationPropertyNameException` dans le résolveur | Le résolveur du §3 exige des `user_id` en minuscules, chiffres et `-` ; sinon lire une table de l'app |
| Port SMTP 465 vs 587 | délai puis échec de connexion | 465 → SSL implicite, tout autre port → STARTTLS (`smtp_port`) |

> À savoir : `MailSendWorker` crée son `ScheduledExecutorService` (poller des différés) au lieu
> d'être cadencé par le MOP — admis par le `CLAUDE.md` du pack, contraire à la règle générale V005.

---

## 9. Pour aller plus loin

- [[howto-mail-04-generer-un-mail-contextualise|MAIL-04]] — produire le brouillon `id_mail_propose`
- [[howto-mail-02-importer-une-boite-utilisateur|MAIL-02]] — même boîte, sens entrant
- [[howto-11-configurer-james-mail|HOWTO 11]] — envoi par le Hub, DKIM, réputation
- [[howto-19-rotation-secrets|HOWTO 19]] — rotation des mots de passe portés en variables
