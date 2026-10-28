# HOWTO COM-01 — Intégrer socle-pack-comm dans une application V005

**Niveau :** Confirmé
**Cible :** `eu.lmvi:socle-pack-comm` **1.1.0** (dépôt `socle-pack-com`, branche `main`, commit `6abb702`) · compilé contre `socle-v005` **5.7.4** (`provided`) · parent Spring Boot **3.2.1**
**Vérifié au code le :** 2026-10-28
**Prérequis :** application V005 sur PostgreSQL (le pack n'a pas de variante H2) ; Java 21 GraalVM CE ; accès à `~/.m2` de la box de build
**Temps estimé :** 30 min

> Suite du pack : [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer une notification]] ·
> [[howto-com-04-envoyer-des-courriels-smtp-brevo-hub|COM-04 — Courriels]]
> Côté plateforme : [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28 — Intégrer un socle-pack]] (générique, daté — voir §9)

---

## 1. Contexte

`socle-pack-comm` apporte à une application V005 la **notification multicanal** : un orchestrateur
(`notify_worker`) qui route un *type* de notification vers des canaux (EMAIL, SMS, TELEGRAM, SLACK,
WEBHOOK, IN_APP), rend un gabarit par canal et par langue, applique un anti-doublon (throttling),
journalise chaque tentative et rejoue les échecs. Trois workers de messagerie (`telegram_worker`,
`slack_worker`, `sms_worker`) sont aussi utilisables seuls.

Le pack s'embarque **par dépendance Maven** : ses classes sont des `@Component` du package
`eu.lmvi.socle.pack.comm`, ses tables vivent **dans le schéma de l'application**, ses migrations sont
jouées au démarrage par son propre `PackMigrationRunner` (pas Flyway).

Avant de l'embarquer, appliquer la règle de routage du dépôt : **un simple courriel transactionnel
se consomme au Hub** (`mail_worker`, [[howto-11-configurer-james-mail|HOWTO 11]]). Le pack se justifie
quand l'app a besoin de plusieurs canaux, de gabarits par type, d'une boîte de notifications in-app
ou d'un journal rejouable. Même alors, son canal EMAIL **délègue au Hub** (fournisseur `hub`) ou à
James (`smtp`) — voir [[howto-com-04-envoyer-des-courriels-smtp-brevo-hub|COM-04]].

Apps de référence :
- **APP-30 BingFetch** (socle 5.8.6) — alertes de supervision par courriel, fournisseur `hub`.
- **APP-25 UniqPersonnality** (socle 5.8.9) — 8 types de courriels, SMTP vers James, `log-content: false`.

---

## 2. Architecture

```
┌──────────────────────── Application V005 (une JVM) ───────────────────────────┐
│                                                                               │
│  code métier ──► NotifyWorker.sendNotification(...)   (appel Java direct)     │
│  agent / Hub ──► POST /mcp  tools/call notify_worker__send_notification       │
│                                                                               │
│  socle-pack-comm 1.1.0  (package eu.lmvi.socle.pack.comm)                     │
│   ├─ CommProperties          @ConfigurationProperties("socle.comm")           │
│   ├─ PackMigrationRunner     @PostConstruct → db/comm/V*.sql                  │
│   ├─ NotifyWorker            PASSIVE, 8 actions, poller de rejeu              │
│   ├─ TelegramWorker / SlackWorker / SmsWorker   PASSIVE, désactivés sans clé  │
│   └─ canaux : Email · Sms · Telegram · Slack · Webhook · InApp                │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ DataSource de l'app (JdbcTemplate)
                               ▼
┌──────────────── PostgreSQL — schéma ${socle.comm.schema} ─────────────────────┐
│ tr_notification_log · tr_notification_inbox · z_notification_config ·        │
│ z_notification_template · fonctions comm_update_changed_fields,               │
│ comm_x_partition_default                                                      │
└───────────────────────────────────────────────────────────────────────────────┘
          + public.z_pack_migrations  (registre partagé, clé "socle-pack-comm@<schéma>")
```

---

## 3. Étape 1 — Résoudre l'artefact

La version 1.1.0 est **installée dans le `~/.m2` de la box de build** (`_remote.repositories` vide :
elle ne vient d'aucun dépôt distant) ; aucune app consommatrice ne la vendorise dans un `mvn-repo/`.
Un clone frais sur une autre machine doit d'abord la construire :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-com
git checkout main && git log -1 --oneline        # 6abb702
mvn clean install -DskipTests                    # → ~/.m2/repository/eu/lmvi/socle-pack-comm/1.1.0/
```

Pour qu'une CI compile sans cette étape, déposer le `.jar` et le `.pom` dans le `mvn-repo/` vendorisé
de l'app (`mvn-repo/eu/lmvi/socle-pack-comm/1.1.0/`), comme pour le framework.

---

## 4. Étape 2 — Dépendance Maven

L'artifactId est **`socle-pack-comm`** (deux *m*), même si le dépôt git s'appelle `socle-pack-com`.

```xml
<!-- pom.xml de l'application -->
<dependency>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-pack-comm</artifactId>
    <version>1.1.0</version>
</dependency>

<!-- Le pack déclare en provided : l'app doit les fournir -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
```

Le pack apporte en `compile` : `okhttp 4.12.0` et `com.sun.mail:jakarta.mail 2.0.1`. Le reste
(socle, Spring Web, Jackson, Log4j2, Disruptor) est `provided`.

Les classes sont trouvées par le balayage de composants **si** l'application balaie `eu.lmvi` —
c'est le cas avec une classe principale `eu.lmvi.Application` annotée `@SpringBootApplication`.
Une app dont la classe principale est dans un autre package ajoute :

```java
package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {"com.example", "eu.lmvi"})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

---

## 5. Étape 3 — Configuration (`application.yml`)

Préfixe **`socle.comm`** (classe `eu.lmvi.socle.pack.comm.config.CommProperties`). Le *relaxed
binding* de Spring fait correspondre `SOCLE_COMM_EMAIL_HUB_URL` à `socle.comm.email.hub.url`.

Configuration minimale réelle, reprise de BingFetch :

```yaml
socle:
  comm:
    schema: ${DATABASE_SCHEMA:schema_monapp}   # OBLIGATOIRE en pratique : le défaut est "public"
    app-name: MonApp                            # variable {app_name} des gabarits
    default-language: fr
    log-content: true                           # false = ni sujet ni corps au journal (COM-05)
    retry:
      auto-enabled: false                       # true = poller de rejeu du pack (COM-05)
      max-retries: 3
      poll-interval-seconds: 60
      batch-size: 50
    email:
      provider: hub                             # smtp | brevo | hub
      from-name: MonApp
      hub:
        url: ${SOCLEHUB_URL:}                   # http://soclehub:80 en interne
        api-key: ${SOCLEHUB_API_KEY:}           # clé IAM, envoyée en X-Api-Key
        app-id: monapp
```

Référence complète des propriétés (toutes vérifiées dans `CommProperties`) :

| Propriété | Défaut | Rôle |
|---|---|---|
| `schema` | `public` | schéma des 4 tables ; assaini en `[a-z0-9_]` |
| `app-name` | `TheSocle` | `{app_name}` |
| `default-language` | `fr` | langue de résolution des gabarits |
| `log-content` | `true` | conserver sujet/corps/contexte dans `tr_notification_log` |
| `retry.auto-enabled` / `max-retries` / `poll-interval-seconds` / `batch-size` | `true` / `3` / `60` / `50` | rejeu automatique |
| `email.provider` | `smtp` | `smtp`, `brevo` ou `hub` |
| `email.from-email` / `from-name` / `timeout-seconds` | — / — / `30` | expéditeur, délai |
| `email.smtp.host` / `port` / `user` / `password` / `start-tls` | — / `587` / — / — / `true` | SMTP |
| `email.brevo.api-key` / `base-url` | — / `https://api.brevo.com/v3` | Brevo direct |
| `email.hub.url` / `api-key` / `app-id` | — | relais par le `mail_worker` du Hub |
| `telegram.bot-token` / `default-chat-id` / `base-url` / `rate-limit-per-second` | — / — / `https://api.telegram.org` / `25` | Telegram |
| `slack.webhook-url` / `bot-token` / `default-channel` / `base-url` | — / — / — / `https://slack.com/api` | Slack |
| `sms.provider` / `from` | — | `twilio`, `ovh`, `vonage` |
| `sms.twilio.*`, `sms.ovh.*`, `sms.vonage.*` | — | identifiants fournisseurs (COM-07) |
| `webhook.hmac-secret` / `timeout-seconds` | — / `10` | signature des webhooks |
| `vault.enabled` / `base-path` | `false` / `soclehub/apps` | voir piège « Vault » |

---

## 6. Étape 4 — Secrets

Les secrets arrivent **par variables d'environnement** du conteneur (déclarées dans le
`manifest.json`, posées par `docker_worker/set_env_var` puis `update_app`) :

```json
{
  "name": "SOCLEHUB_URL",
  "description": "Hub en interne (port 80)",
  "defaultValue": "http://soclehub:80"
},
{
  "name": "SOCLEHUB_API_KEY",
  "description": "Clé des actions du Hub (courriel des alertes)",
  "defaultValue": ""
}
```

⚠️ Le `VaultCredentialResolver` existe mais **n'est jamais consulté** en 1.1.0 : tous les appels
passent `appId = null`, et la lecture Vault n'a lieu que si `appId != null`. Poser
`socle.comm.vault.enabled: true` ne change rien. Les chemins `apps/{appId}/comm/{provider}` cités
dans le README, `docs/ENV-REFERENCE.md` et HOWTO 28 ne sont pas lus.

---

## 7. Étape 5 — Démarrage : ce que le pack fait seul

Au démarrage, dans cet ordre :

1. **`PackMigrationRunner` (`@PostConstruct`)** crée `public.z_pack_migrations` s'il manque, puis
   joue `db/comm/V000…V999` avec `${comm_schema}` remplacé par le schéma. Chaque script est noté
   sous la clé **`socle-pack-comm@<schéma>`**. Un échec SQL lève `IllegalStateException` : l'app
   ne démarre pas.
2. `NotificationConfigService` et `TemplateService` chargent leurs caches.
3. Le MOP initialise les workers. Sans clé, `telegram_worker`, `slack_worker` et `sms_worker`
   répondent `isEnabled() = false` : le MOP les sort du superviseur mais ils restent découvrables.
4. `notify_worker.start()` lance le poller de rejeu si `retry.auto-enabled: true`.

Scripts et effets :

| Script | Effet |
|---|---|
| `V000__init` | extension `pgcrypto` si absente ; fonction `<schéma>.comm_update_changed_fields()` |
| `V001` | `tr_notification_log`, `tr_notification_inbox` + index + triggers de mise à jour |
| `V002` | `z_notification_config`, `z_notification_template` + index uniques |
| `V003` | fonction `comm_x_partition_default()` et trigger `trg_x_partition_default` sur les **4 tables du pack seulement** |
| `V004` | type `NEWSLETTER` → `["EMAIL"]` |
| `V999` | 6 types (`SYSTEM_ALERT`, `USER_WELCOME`, `PASSWORD_RESET`, `IMPORT_COMPLETE`, `HITL_REMINDER`, `HARD_CAP_BREACH`) et 14 gabarits |

Droits requis du compte applicatif : `CREATE` sur son schéma ; `CREATE EXTENSION pgcrypto` **si**
l'extension manque (sinon V000 échoue) ; lecture/écriture sur `public.z_pack_migrations`.

---

## 8. Vérifier

```bash
# Journal de démarrage
docker logs monapp 2>&1 | grep -E "pack-migration|notify-config|notify-template|worker:(notify|sms|telegram|slack)"
# attendu :
# [worker:pack-migration] Found 6 DDL scripts for socle-pack-comm (schema schema_monapp)
# [worker:pack-migration] all migrations applied successfully
# [notify-config] loaded 7 configs
# [worker:notify_worker] initialized — channels available: [EMAIL, WEBHOOK, IN_APP]
# [worker:sms_worker] no SMS provider configured (SOCLE_COMM_SMS_PROVIDER) — worker désactivé
```

```sql
-- Registre : une ligne par script, clé scopée par schéma
SELECT pack_id, version, executed_at FROM public.z_pack_migrations
 WHERE pack_id = 'socle-pack-comm@schema_monapp' ORDER BY version;

-- Tables du pack dans le schéma de l'app
SELECT relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'schema_monapp' AND relname LIKE '%notification%';
```

Par MCP (socle ≥ 5.9 : `MCP_API_KEY` obligatoire) :

```bash
curl -s -X POST http://monapp:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"notify_worker__get_stats","arguments":{}}}' \
  | jq '.result.content[0].text | fromjson'
```

Attendu : `channels_available` liste au moins `IN_APP` et `WEBHOOK` (toujours disponibles), plus
`EMAIL` si le fournisseur est configuré.

Au tableau de bord (`/dashboard`, en-tête `X-Admin-Key`), les quatre workers apparaissent. Ils
s'affichent « stopped » sur un socle ≤ 5.9.4 : leur `getStats()` n'écrit pas les clés
`state`/`execution_count` que le tableau de bord lit — ce n'est pas un arrêt.

---

## 9. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Premier démarrage sur base vide | 6 lignes `socle-pack-comm@<schéma>` dans `z_pack_migrations` |
| 2 | Redémarrage | aucun script rejoué |
| 3 | Deuxième app, même base, autre schéma | ses propres tables ; la première est intacte |
| 4 | `notify_worker__get_stats` | `channels_available` cohérent avec la config |
| 5 | Sans `SOCLE_COMM_SMS_PROVIDER` | `sms_worker` désactivé, aucun redémarrage en boucle au journal |

Tests du pack correspondants : `RegistreScopeParSchemaTest`, `XPartitionDefaultTriggerTest`
(Testcontainers PostgreSQL) — 34 tests verts au dernier `surefire-reports`.

---

## 10. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `schema` laissé à `public` | tables créées dans `public` ; refus si le compte n'a pas `CREATE` sur `public` | toujours `socle.comm.schema: <schéma de l'app>` |
| Pack ≤ 1.0.0 sur une base partagée | 2ᵉ app démarre **sans tables** (registre indexé par `pack_id` seul), fonctions `public.*` écrasées, trigger posé sur les tables de l'hôte | 1.1.0 minimum ; les lignes anciennes sont adoptées seulement par le schéma qui a déjà `tr_notification_log` |
| `pgcrypto` absente et compte sans droit d'extension | V000 échoue, l'app ne démarre pas | faire créer l'extension par le DBA avant le premier démarrage |
| Croire Vault branché | secrets absents alors que Vault est rempli | les passer en variables d'environnement (§6) |
| Variable déclarée avec valeur vide (`SOCLE_COMM_SLACK_WEBHOOK_URL=`) | Slack/Telegram se croient configurés (« » ≠ `null`) puis échouent à chaque envoi | ne déclarer la variable que si elle porte une valeur |
| `artifactId socle-pack-com` | dépendance introuvable | l'artifactId est `socle-pack-comm` |
| Suivre HOWTO 28 à la lettre | `soclehub-pack.com.schema`, `${pack_schema}`, chemins Vault : rien n'est lu | propriétés `socle.comm.*`, placeholder `${comm_schema}` |
| README / `socle-pack.json` | annoncent 1.0.0, deux fournisseurs email, `POST /api/actions/notify_worker__…` | le code est en 1.1.0, trois fournisseurs ; une app s'invoque par `POST /mcp` |
| Socle ≥ 5.8 (Spring Boot 4) | pack compilé contre Boot 3.2.1 / socle 5.7.4 | employé tel quel par BingFetch (5.8.6) et UniqPersonnality (5.8.9) ; Your360 (5.9.4) a préféré un `GatewayWorker` maison en attendant une version Boot 4 — tester l'envoi réel après chaque montée de socle |
| Worker affiché « stopped » | tableau de bord ≤ 5.9.4 | lire `notify_worker__get_stats` ou `tr_notification_log` |

---

## 11. Pour aller plus loin

- [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer une notification multicanal]]
- [[howto-com-03-types-et-gabarits|COM-03 — Déclarer des types et des gabarits]]
- [[howto-com-04-envoyer-des-courriels-smtp-brevo-hub|COM-04 — Courriels : Hub, James ou Brevo]]
- [[howto-com-05-journal-rejeu-et-anti-doublon|COM-05 — Journal, rejeu et anti-doublon]]
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28 — Intégrer un socle-pack]] · [[howto-03-installer-une-app|HOWTO 03 — Installer une app]]
