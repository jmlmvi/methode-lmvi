# HOWTO MAIL-02 — Importer la boîte d'un utilisateur et bâtir son référentiel contacts

**Niveau :** Confirmé
**Cible :** application V005 qui embarque `socle-pack-mail`
**Versions vérifiées au code (2026-10-28) :** `socle-pack-mail` **1.4.0** (copie de travail, base `24bc50a`) · socle **5.9.5** · `jakarta.mail` 2.0.1 · OkHttp 4.12.0
**Prérequis :** [[howto-mail-01-integrer-le-pack|MAIL-01]] fait ; accès IMAP de l'utilisateur, ou jeton OAuth2 Gmail, ou export CSV Outlook
**Temps estimé :** 30 min

---

## 1. Contexte

`mail_import_worker` lit l'historique d'une boîte **personnelle** et en tire un référentiel de
contacts : qui écrit à l'utilisateur, à qui il écrit, à quelle fréquence, sur quel ton. C'est le
socle des fonctions de prospection (génération MAIL-04, envoi MAIL-03).

Trois sources, une action :

| `source_type` | Ce qui est lu | Mécanisme (code) |
|---|---|---|
| `imap` | en-têtes + extrait du corps, dossiers `INBOX,Sent` par défaut | `ImapImporter` — `ReceivedDateTerm ≥ since_date` |
| `gmail` | **en-têtes seulement** (`format=metadata` : From, To, Cc, Date, Subject, Message-ID) | `GmailImporter` — refresh OAuth2 puis `GET /users/me/messages?q=after:…` par pages de 100 |
| `outlook_export` | lignes d'un CSV Outlook, colonnes reconnues par un `mapping` | `OutlookCsvImporter` |

Ce que l'import écrit, par utilisateur (`owner_user_id`) :

| Table | Contenu |
|---|---|
| `db_contact` | un contact par adresse et par utilisateur (unicité `owner_user_id, lower(email)`), `proximity_score`, `tone`, `exchange_count` |
| `tr_email_import` | une ligne par message : sujet, date, direction, mots-clés, `message_id` (unicité `owner_user_id, message_id`) — **sans corps** |
| `tr_import_log` | une ligne par import : statut, compteurs, configuration source **expurgée** des secrets |

> Le corps des messages n'est pas stocké par l'import : choix RGPD du pack. `V004` crée les colonnes
> `corps_texte` / `corps_html`, mais seule l'application peut les remplir (voir MAIL-05).

> **Recouvrement avec le Hub.** Une boîte hébergée sur le James du Hub n'a pas besoin du pack pour
> être relevée par le Hub lui-même (scan antivirus : [[howto-21-clamav-mail-scan|HOWTO 21]]). Le
> pack sert quand **l'application** veut exploiter le contenu d'une boîte d'utilisateur, où qu'elle
> soit hébergée.

---

## 2. Architecture

```
 start_import(user_id, source_type, source_config, since_date)
        │  (action ASYNC — rend tout de suite {import_id, status: RUNNING})
        ▼
 MailImportWorker ── INSERT tr_import_log (status RUNNING, config sans secrets)
        │
        ▼  pool interne de 3 fils « mail-import-worker »
 ImapImporter | GmailImporter | OutlookCsvImporter
        │  lots de ImportedEmail
        ▼
 ContactExtractor.processBatch()
        ├── db_contact      (création / mise à jour, ProximityScorer, ToneDetector)
        └── tr_email_import (ON CONFLICT (owner_user_id, message_id) DO NOTHING)
        │
        ▼
 UPDATE tr_import_log  → COMPLETED | FAILED (error_details) | CANCELLED
```

---

## 3. Étape 1 — Lancer un import IMAP

Les identifiants passent **dans l'appel**, champ `source_config` (voir §7 pour Vault).

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"mail_import_worker__start_import",
                 "arguments":{
                   "user_id":"alice",
                   "source_type":"imap",
                   "source_config":{
                     "host":"imap.exemple.fr","port":"993","ssl":"true",
                     "username":"alice@exemple.fr","password":"'"$ALICE_IMAP_PWD"'",
                     "folders":"INBOX,Sent"},
                   "since_date":"2025-01-01"}}}'
```

Réponse (dans `content[0].text`) : `{"import_id": 42, "status": "RUNNING"}`.

Clés lues par `ImapImporter` : `host`, `port` (défaut `993`), `ssl` (défaut `true`), `username`,
`password`, `folders` (défaut `INBOX,Sent`). `since_date` absent → `SOCLE_MAIL_IMP_SINCE_DEFAULT`
(`2020-01-01`).

## 4. Étape 2 — Import Gmail ou CSV Outlook

```json
{"user_id":"alice","source_type":"gmail",
 "source_config":{"refresh_token":"1//0g…","client_id":"123456.apps.googleusercontent.com",
                  "client_secret":"GOCSPX-…"},
 "since_date":"2025-01-01"}
```

```bash
B64=$(base64 -w0 contacts-outlook.csv)
# arguments de mail_import_worker__start_import :
# {"user_id":"alice","source_type":"outlook_export",
#  "source_config":{"csv_content_base64":"'"$B64"'",
#                   "mapping":"{\"company\":\"Société\"}"}}
```

`mapping` est une **chaîne JSON** (le worker la relit par `ObjectMapper.readValue`) ; les noms de
colonnes non fournis prennent les en-têtes Outlook anglais (`Company`, …).

## 5. Étape 3 — Suivre, annuler, lister

| Action | Arguments | Rend |
|---|---|---|
| `get_import_status` | `import_id` | `status`, `processed_emails`, `contacts_created`, `contacts_updated`, `errors`, `started_at`, `completed_at` |
| `cancel_import` | `import_id` | `{cancelled: true}` — interrompt le fil, passe la ligne `RUNNING` en `CANCELLED` |
| `list_imports` | `user_id`?, `status`? | 100 derniers imports |
| `get_status` | — | compteurs du worker, `imports_running`, `contacts_total` |

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"mail_import_worker__get_import_status","arguments":{"import_id":42}}}
```

## 6. Étape 4 — Exploiter le référentiel depuis l'application

```java
package eu.lmvi.contacts;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/** Lecture du référentiel produit par le pack — toujours filtrée sur le propriétaire. */
@Component
public class ContactsDepot {

    private final JdbcTemplate jdbc;

    public ContactsDepot(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> plusProches(String utilisateur, int limite) {
        return jdbc.queryForList("""
            SELECT x_id, email, first_name, last_name, company, job_title, tone,
                   proximity_score, exchange_count
            FROM schema_monapp.db_contact
            WHERE owner_user_id = ? AND x_active = true
            ORDER BY proximity_score DESC NULLS LAST
            LIMIT ?""", utilisateur, limite);
    }
}
```

`x_id` est le `contact_id` attendu par `mail_generation_worker` (MAIL-04).

---

## 7. Identifiants : inline aujourd'hui, Vault plus tard

Le code prévoit une lecture Vault (`VaultCredentialResolver`) sur
`soclehub/apps/{appId}/users/{user_id}/imap|gmail`. En 1.4.0 elle **ne s'active pas** :

- `appId` est la « partition » de l'appel, et `safePartition()` rend **toujours `null`** depuis le
  socle 5.6.0 (commentaire du code) ; `readCredentials` rend alors `null` sans chercher ;
- le résolveur attend en plus un bean dont le nom de classe contient « Vault » et qui offre
  `getSecret(String)` : le socle 5.9.5 n'en publie aucun dans une app.

Conséquence pratique : **passer `source_config` à chaque import.** L'application garde le secret
(Vault → variable d'environnement, ou son propre coffre) et le transmet à l'appel ; le pack le retire
de `tr_import_log` (`password`, `refresh_token`, `client_secret`, `csv_content_base64`).

---

## 8. Vérifier

```sql
SELECT status, processed_emails, contacts_created, contacts_updated, errors, source_config
FROM schema_monapp.tr_import_log WHERE x_id = 42;
-- source_config ne contient ni password, ni refresh_token

SELECT count(*) FROM schema_monapp.db_contact WHERE owner_user_id = 'alice';
SELECT direction, count(*) FROM schema_monapp.tr_email_import
WHERE owner_user_id = 'alice' GROUP BY 1;
```

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Import IMAP sur une boîte de test | `COMPLETED`, contacts créés, `tr_email_import` peuplée |
| 2 | Relancer le même import | aucun doublon dans `tr_email_import` (unicité `message_id`) ; `contacts_updated` augmente |
| 3 | Mauvais mot de passe | `FAILED`, `error_details` renseigné |
| 4 | `cancel_import` pendant l'import | `CANCELLED` |
| 5 | Lire `tr_import_log.source_config` | aucun secret |

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Compter sur Vault | `No source_config provided and no Vault credentials found at apps/null/users/alice/imap` | Passer `source_config` (§7) |
| Activer la synchronisation quotidienne (`configure_sync`) | l'action réussit, **aucun import ne part** | Le poller (`syncTick`, toutes les 60 min) ne lit les identifiants que dans Vault, et la partition enregistrée est `null` : la synchro est inerte en 1.4.0. Planifier l'import depuis l'application (CronWorker qui appelle `start_import` avec `source_config`) |
| Croire à la « reprise après crash via `last_offset` » (README, manifeste) | un import interrompu repart de zéro | `last_offset` est lu par `get_import_status`, **jamais écrit** : relancer l'import ; l'unicité `message_id` évite les doublons |
| Attendre le corps des messages Gmail | `tr_email_import` sans contenu, extrait vide | `GmailImporter` lit en `format=metadata` |
| Épurer après import | `epurer_messages` rend `vides` partout | L'import n'écrit pas `corps_texte` / `corps_html` (MAIL-05) |
| `mapping` Outlook passé en objet | colonnes non reconnues | Le passer en **chaîne** JSON |
| Arrêt de l'app pendant un import | ligne figée en `RUNNING` | Le fil est daemon, arrêté au `stop()` sans mise à jour du statut : passer la ligne en `FAILED` à la main avant de relancer |
| Gros historique | import long, mémoire | `SOCLE_MAIL_IMP_MAX_EMAILS` (100 000) et `SOCLE_MAIL_IMP_BATCH_SIZE` (500) bornent le volume |

> À savoir : `MailImportWorker` crée ses propres fils (`Executors.newFixedThreadPool(3)` et un
> `ScheduledExecutorService`) au lieu d'être cadencé par le MOP. Le `CLAUDE.md` du pack déclare ce
> poller interne « conforme (pattern pack-editorial) » ; la règle générale V005 (« jamais
> `new Thread()` dans un Worker ») le refuse. Les fils sont daemon et arrêtés dans `stop()`.

---

## 11. Pour aller plus loin

- [[howto-mail-03-envoyer-depuis-la-boite-utilisateur|MAIL-03]] — écrire depuis la même boîte
- [[howto-mail-04-generer-un-mail-contextualise|MAIL-04]] — rédiger pour un contact du référentiel
- [[howto-mail-05-epurer-les-messages|MAIL-05]] — si l'application stocke les corps
- [[howto-11-configurer-james-mail|HOWTO 11]] — boîtes hébergées par le Hub
