# HOWTO COM-01 — Intégrer socle-pack-comm dans une application V005

**Niveau :** Confirmé
**Cible :** `eu.lmvi:socle-pack-comm` **2.2.0** (dépôt `socle-pack-com`, branche `main`, commit `227fe5e`, tag `v2.2.0` ; code identique à 2.1.0, commit `ba69578`) · construit contre `socle-v005` **5.11.0** (`provided`, minimum **5.10.0**) · parent `eu.lmvi:socle-v005-parent` 5.11.0, fils de Spring Boot **4.1.2**
**Autres lignes :** 2.1.0 (tag `v2.1.0`) reste valide en socle 5.10.x et 5.11.x ; socle 5.8.6-5.9.x / Boot 4.0.6 → **2.0.0** (tag `v2.0.0`, commit `ffbfd75`) ; Boot 3.2.1 / socle ≤ 5.7.x → **1.1.0** (commit `6abb702`), dernière version Boot 3 — même comportement, mêmes propriétés
**Vérifié au code le :** 2026-10-28
**Prérequis :** application V005 **Spring Boot 4.1.2, socle ≥ 5.10.0** (5.11.0 recommandé) sur PostgreSQL (le pack n'a pas de variante H2) ; Java 21 GraalVM CE ; accès à `~/.m2` de la box de build
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
│  socle-pack-comm 2.2.0  (package eu.lmvi.socle.pack.comm, beans comm*)        │
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

Les versions 2.2.0 et 2.1.0 (socle 5.10-5.11 / Boot 4.1.2), 2.0.0 (socle 5.8.6-5.9.x / Boot 4.0.6) et 1.1.0 (Boot 3) sont **installées dans le `~/.m2` de la box de build**
(`_remote.repositories` vide : elles ne viennent d'aucun dépôt distant) ; aucune app consommatrice ne
les vendorise dans un `mvn-repo/`. Un clone frais sur une autre machine doit d'abord construire :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-com
git checkout v2.2.0                              # 227fe5e (2.2.0) — v2.1.0 = même code ; v2.0.0 = Boot 4.0.6 ; 1.1.0 = commit 6abb702 (Boot 3)
mvn clean install -DskipTests                    # → ~/.m2/repository/eu/lmvi/socle-pack-comm/2.2.0/
```

Pour qu'une CI compile sans cette étape, déposer le `.jar` et le `.pom` dans le `mvn-repo/` vendorisé
de l'app (`mvn-repo/eu/lmvi/socle-pack-comm/2.2.0/`), comme pour le framework.

---

## 4. Étape 2 — Dépendance Maven

L'artifactId est **`socle-pack-comm`** (deux *m*), même si le dépôt git s'appelle `socle-pack-com`.

Parent recommandé : `eu.lmvi:socle-v005-parent`. Fils de `spring-boot-starter-parent` 4.1.2, il fournit
`${socle.version}`, importe `eu.lmvi:socle-v005-bom` (gRPC 1.85.1, Testcontainers 1.21.4, H2, Jedis,
Kafka, pilotes MySQL / MariaDB aux versions testées par le socle) et porte la règle
`maven-enforcer-plugin` `socle-versions-testees`. L'app ne déclare ni `<socle.version>`, ni
`grpc-bom`, ni `testcontainers-bom`.

```xml
<!-- pom.xml de l'application -->
<parent>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-v005-parent</artifactId>
    <version>5.11.0</version>   <!-- fils de spring-boot-starter-parent 4.1.2 -->
    <relativePath/>
</parent>

<dependency>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-v005</artifactId>
    <version>${socle.version}</version>   <!-- fourni par le parent -->
</dependency>
<dependency>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-pack-comm</artifactId>
    <version>2.2.0</version>   <!-- socle 5.10-5.11 / Boot 4.1.2 (2.1.0 accepté) ; 2.0.0 pour socle 5.8.6-5.9.x ; 1.1.0 pour Boot 3.2.1 -->
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

Le pack n'apporte en `compile` que `com.sun.mail:jakarta.mail 2.0.1` (comme socle-pack-mail). Le
reste (socle, Spring Web, JDBC, Jackson, Log4j2, **OkHttp**) est `provided`. Disruptor n'est plus
déclaré par le pack : c'est celui du socle (4.0.0).

**App qui garde son propre parent.** Voie supportée : importer le BOM du socle et surcharger les
cinq propriétés que `spring-boot-dependencies` gère en direct (un BOM importé ne bat pas ces entrées) :

```xml
<properties>
    <socle.version>5.11.0</socle.version>
    <h2.version>2.5.252</h2.version>
    <jedis.version>8.0.2</jedis.version>
    <kafka.version>4.4.0</kafka.version>
    <mysql.version>26.10.0</mysql.version>
    <mariadb.version>4.0.0</mariadb.version>
</properties>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>eu.lmvi</groupId>
            <artifactId>socle-v005-bom</artifactId>
            <version>5.11.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

**OkHttp 5 (depuis 2.1.0).** Le socle 5.10.0 passe à OkHttp **5.5.1** (inchangé en 5.11.0), dont l'artefact JVM s'appelle
`com.squareup.okhttp3:okhttp-jvm` (`okhttp` 5.x n'est plus qu'un module multiplateforme). Le pack
(≥ 2.1.0) déclare `okhttp-jvm` en `provided` et utilise donc celle du socle. Le 2.0.0 embarquait
`okhttp:4.12.0` en `compile` : coordonnées différentes, Maven ne dédoublonne pas, et une app socle 5.10
recevrait **deux copies** de `okhttp3.*`/okio (le premier jar sur le classpath gagne). En 2.2.0,
l'artefact `okhttp` n'apparaît que comme **exclusion** de `mockwebserver` (test). Ne jamais
ajouter `okhttp` 4.x dans l'app : `mvn dependency:tree -Dincludes=com.squareup.okhttp3` doit ne montrer
que `okhttp-jvm`.

**Version de Boot.** Le pack doit tourner sur le Boot de son socle : 2.2.0 et 2.1.0 sont construits sur
Spring Boot 4.1.2, celui de `socle-v005` 5.10.0 et 5.11.0 ; 2.0.0 sur Boot 4.0.6 (socle 5.8.6-5.9.x). Une app qui
garde une version du pack bâtie sur une autre ligne de Spring compile, puis casse à l'exécution.

**Noms de beans (depuis 2.1.0).** Tous les beans du pack ont un nom explicite préfixé `comm`
(`commPackMigrationRunner`, `commTenantResolver`, `commVaultCredentialResolver`,
`commResilienceFactory`, `commProperties`, `commNotifyWorker`… — liste complète dans le README du
kit). Plusieurs packs (ai, Editorial, Connectors, Mail, pipeline) déclarent une classe de même nom
simple ; avec les noms par défaut, deux packs dans la même app levaient
`ConflictingBeanDefinitionException`. Une app qui injecte par **type** n'a rien à changer ; une app
qui citait un nom par défaut (`@Qualifier("telegramWorker")`) doit passer au nom `comm*`. Les noms
des workers MCP (`notify_worker`…) et des actions sont inchangés.

**Jackson.** Boot 4 sérialise le HTTP en Jackson 3 (`tools.jackson`). Le pack, comme le socle et les
packs tenant/mail/ai, reste en Jackson 2 (`com.fasterxml`, version gérée par Boot 4 : 2.21.x) pour
son code interne, et ne rend que des `Map`/`List`/scalaires dans ses `ActionResult` : rien à
adapter côté app. Une app qui relaie une réponse du pack dans **son propre** contrôleur ne doit pas
y glisser de `JsonNode` Jackson 2 (voir la règle Boot 4 : convertir en `Map` avant de rendre).

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

Au démarrage (⚠️ l'ordre des étapes 1 et 2 n'est **pas** garanti, voir piège « caches vides au
premier démarrage ») :

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

Tests du pack correspondants : `RegistreScopeParSchemaTest`, `XPartitionDefaultTriggerTest`,
`DemarrageContexteSpringTest` (depuis 2.1.0 : vraie `SpringApplication` Boot 4.1 avec le socle
entier — 5.11.0 en 2.2.0, 5.10.0 en 2.1.0 — MOP `RUNNING`, workers et actions comparés au manifeste `socle-pack.json`, registre
d'actions du socle, tables et registre de migrations dans un schéma neuf, beans préfixés `comm*`) —
Testcontainers PostgreSQL ; 35 tests verts, aucun sauté (2.2.0 comme 2.1.0) ; enforcer passé.

Pour démarrer le socle 5.10 / 5.11 hors conteneur (test, poste local) : `MCP_API_KEY` **et** `ADMIN_API_KEY`
non vides (sinon refus de démarrer, fail-closed), et `TECHDB_PATH` **absolu** (H2 refuse un chemin
relatif implicite).

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
| README du pack | annonce deux fournisseurs email, `POST /api/actions/notify_worker__…` | trois fournisseurs ; une app s'invoque par `POST /mcp` (la version, le socle minimal et Boot sont justes depuis 2.0.0) |
| Mauvaise ligne de Boot | pack bâti sur un autre Boot que le socle de l'app | socle 5.10-5.11 / Boot 4.1.2 → **2.2.0** (2.1.0 accepté) ; socle 5.8.6-5.9.x / Boot 4.0.6 → 2.0.0 ; Boot 3.2.1 → 1.1.0. Tester l'envoi réel après chaque montée de socle |
| Deux OkHttp dans l'app (pack 2.0.0 sur socle 5.10) | `okhttp` 4.12 du pack + `okhttp-jvm` 5.5.1 du socle : deux copies de `okhttp3.*`, comportement selon l'ordre du classpath | **corrigé en 2.1.0** (OkHttp du socle, `provided`) ; ne pas déclarer `okhttp` 4.x dans l'app |
| `<configuration>` déclarée sur `maven-enforcer-plugin` dans le pom de l'app | les bornes du parent disparaissent **sans message** : une liste `bannedDependencies/excludes` redéclarée remplace celle du parent ; `combine.self="override"` ou `<skip>true</skip>` coupent tout | ne jamais configurer le plugin ; une règle de plus = une autre `<execution>` avec son propre `<id>` |
| `h2.version`, `jedis.version`, `kafka.version`… redéclarées sous la version testée | build en échec à `validate` (exécution `socle-versions-testees`) | voulu : retirer la surcharge et garder la version du parent |
| Versions du socle perdues dans l'app (gRPC 1.84.1, H2 2.4.240, Jedis 7.4.1 au lieu de celles du socle) | Boot 4.1.2 gère ces bibliothèques plus bas que le socle et l'emporte dans une app au parent Boot | **corrigé côté socle** : parent `socle-v005-parent` 5.11.0, ou `socle-v005-bom` ≥ 5.10.1 importé + les cinq propriétés (§4) ; une app restée en socle 5.10.0 sans BOM importe encore `io.grpc:grpc-bom:1.85.1` |
| Collision de noms de beans entre packs | `ConflictingBeanDefinitionException` sur `packMigrationRunner`, `tenantResolver`, `vaultCredentialResolver`, `resilienceFactory` quand deux packs sont dans la même app | **corrigé en 2.1.0** : beans `comm*` ; un `@Qualifier` sur un ancien nom par défaut doit être renommé |
| Caches vides au premier démarrage | sur un schéma neuf : `[notify-config] reload failed: bad SQL grammar` et `[notify-template] reload failed` **avant** `pack-migration … applying V000` ; `send_notification` → « no config for type » jusqu'au premier rechargement (vu en 2.0.0 et 2.1.0 ; code identique en 2.2.0) | appeler `NotificationConfigService.reload()` et `TemplateService.reload()` depuis un `ApplicationRunner` de l'app (patron COM-03), ou redémarrer l'app une fois les tables posées |
| Schéma absent | `schema "…" does not exist` à V000, l'app ne démarre pas | le pack ne crée pas le schéma : c'est le Hub (`db_worker/create_app_schema`) qui le pose |
| Worker affiché « stopped » | tableau de bord ≤ 5.9.4 | lire `notify_worker__get_stats` ou `tr_notification_log` |

---

## 11. Pour aller plus loin

- [[howto-com-02-envoyer-une-notification-multicanal|COM-02 — Envoyer une notification multicanal]]
- [[howto-com-03-types-et-gabarits|COM-03 — Déclarer des types et des gabarits]]
- [[howto-com-04-envoyer-des-courriels-smtp-brevo-hub|COM-04 — Courriels : Hub, James ou Brevo]]
- [[howto-com-05-journal-rejeu-et-anti-doublon|COM-05 — Journal, rejeu et anti-doublon]]
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28 — Intégrer un socle-pack]] · [[howto-03-installer-une-app|HOWTO 03 — Installer une app]]
