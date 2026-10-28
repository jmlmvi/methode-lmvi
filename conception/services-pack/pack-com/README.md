# socle-pack-comm — notification multicanal pour une app V005

**Le pack en cinq lignes.**
`eu.lmvi:socle-pack-comm` donne à une application V005 un orchestrateur de notifications
(`notify_worker`) : un *type* est routé vers EMAIL, SMS, TELEGRAM, SLACK, WEBHOOK ou IN_APP, avec
gabarit par canal et langue, anti-doublon, journal par canal et rejeu des échecs. Trois workers de
messagerie (`telegram_worker`, `slack_worker`, `sms_worker`) s'emploient aussi seuls. Tables et
gabarits vivent dans le schéma PostgreSQL de l'app. Le canal EMAIL **délègue à la plateforme**
(`mail_worker` du Hub ou James) : le pack n'est pas un serveur de courriel.

| | |
|---|---|
| Version documentée | **2.2.0** (`pom.xml`) — Spring Boot **4.1.2**, socle **5.11.0** (minimum **5.10.0**) |
| Référence git | dépôt `/opt/2026-TheHub4TheSocle/socle-pack-com`, branche `main`, commit `227fe5e`, tag `v2.2.0` (2026-10-28), poussés sur `origin` ; **code identique à 2.1.0** (commit `ba69578`, tag `v2.1.0`) : seul le build change |
| Construit contre | parent **`eu.lmvi:socle-v005-parent` 5.11.0** (fils de Spring Boot **4.1.2**), qui fournit `${socle.version}`, importe `socle-v005-bom` et porte la règle enforcer `socle-versions-testees` ; `socle-v005` en `provided` ; Java 21. Socle minimal **5.10.0** (`minSocleVersion`, aucune API 5.11 employée) : OkHttp 5 (`okhttp-jvm` 5.5.1) vient du socle |
| Compatibilité | **2.2.0** → socle 5.10.x et 5.11.x / Boot 4.1.2 (construit contre 5.11.0) · **2.1.0** (commit `ba69578`, tag `v2.1.0`) → socle 5.10.x et 5.11.x / Boot 4.1.2, reste valide · **2.0.0** (commit `ffbfd75`, tag `v2.0.0`) → socle 5.8.6-5.9.x / Boot 4.0.6 · **1.1.0** (commit `6abb702`) → dernière Boot 3 (3.2.1, socle ≤ 5.7.x) |
| Noms des beans | tous préfixés `comm` : `commPackMigrationRunner`, `commTenantResolver`, `commVaultCredentialResolver`, `commResilienceFactory`, `commProperties`, `commTemplateRenderer`, `commTemplateService`, `commNotificationConfigService`, `commNotificationLogger`, `commThrottleService`, `comm{Email,Sms,Telegram,Slack,Webhook,InApp}Channel`, `comm{Twilio,Ovh,Vonage}SmsProvider`, `comm{Notify,Telegram,Slack,Sms}Worker`. Noms des workers MCP et des actions inchangés |
| Distribution | installé dans `~/.m2` de la box de build (`mvn install`) ; ni vendorisé, ni vu sur un dépôt distant |
| Contenu | 4 workers PASSIVE, 22 actions MCP, 4 tables, 6 scripts SQL, 35 tests (dont un démarrage d'une vraie `SpringApplication` Boot 4.1 avec le socle entier, MOP `RUNNING`), tous verts, aucun sauté en 2.2.0 (socle 5.11.0) comme en 2.1.0 (socle 5.10.0) ; enforcer passé |
| Vérifié au code le | 2026-10-28 |

## Besoin → HOWTO

| Je veux… | HOWTO |
|---|---|
| ajouter le pack à mon app, le configurer, vérifier qu'il démarre | [[howto-com-01-integrer-le-pack\|COM-01 — Intégrer le pack]] |
| prévenir quelqu'un sur plusieurs canaux depuis mon code ou par MCP | [[howto-com-02-envoyer-une-notification-multicanal\|COM-02 — Envoyer une notification multicanal]] |
| déclarer mes types de notification et écrire leurs gabarits | [[howto-com-03-types-et-gabarits\|COM-03 — Types et gabarits]] |
| envoyer des courriels (Hub, James ou Brevo) et savoir quand me passer du pack | [[howto-com-04-envoyer-des-courriels-smtp-brevo-hub\|COM-04 — Courriels]] |
| tracer, rejouer, éviter les doublons, purger, gérer les tenants | [[howto-com-05-journal-rejeu-et-anti-doublon\|COM-05 — Journal, rejeu, anti-doublon]] |
| poster sur Telegram ou Slack | [[howto-com-06-telegram-et-slack\|COM-06 — Telegram et Slack]] |
| envoyer des SMS, ou brancher mon propre fournisseur | [[howto-com-07-envoyer-des-sms\|COM-07 — SMS]] |
| appeler un système tiers par webhook signé, ou afficher des notifications dans mon interface | [[howto-com-08-webhook-et-notifications-in-app\|COM-08 — Webhook et in-app]] |

## Frontière avec les services du Hub

| Besoin | Où |
|---|---|
| un courriel transactionnel isolé | Hub : `mail_worker/send_email` ou `send_templated_email` — [[howto-11-configurer-james-mail\|HOWTO 11]] |
| boîtes aux lettres, domaines, DKIM, réception | Hub : `james_worker` — [[howto-11-configurer-james-mail\|HOWTO 11]] |
| plusieurs canaux, gabarits par type en base, boîte in-app, journal rejouable | **ce pack**, canal EMAIL en fournisseur `hub` ou `smtp` → James |
| SMS, Telegram, Slack, webhook sortant | **ce pack** (aucun service du Hub) |
| événements entre applications | Hub : NATS — [[howto-37-publier-des-messages-nats-depuis-une-app\|HOWTO 37]] |

## Dépendances

- **Ce pack ne dépend d'aucun autre pack.**
- **`socle-pack-Editorial` dépend de lui** (newsletter : type `NEWSLETTER` seedé par V004).
- Apps consommatrices au 2026-10-28 : **APP-30 BingFetch** (1.1.0, alertes par le Hub),
  **APP-25 UniqPersonnality** (1.1.0, SMTP James, contenu non conservé), **APP-12 RssArchiver**
  (encore en 1.0.0-SNAPSHOT, aux côtés de socle-pack-Editorial). APP-28 Your360 (socle 5.9.4) l'a écarté au profit
  d'un `GatewayWorker` maison en attendant une version Boot 4.
- **Apps en socle 5.10 / 5.11, Boot 4.1.2 → 2.2.0** (2.1.0 reste valide). Candidates à la 2.0.0 (Boot 4.0.6, socle 5.8.6-5.9.x) : BingFetch (5.8.6) et UniqPersonnality (5.8.9), qui
  embarquent aujourd'hui la 1.1.0 Boot 3 dans une app Boot 4 ; Your360 (5.9.4) peut revenir au pack.
  `socle-pack-Editorial` doit passer en Boot 4 pour suivre (il dépend de ce pack).

## Écarts README / code et fonctions incomplètes (le code fait foi)

| Sujet | Documentation du pack | Code 2.2.0 (= 2.1.0 = 2.0.0 = 1.1.0) |
|---|---|---|
| Fournisseurs email | `smtp`, `brevo` | + `hub` (relais `mail_worker`) |
| Invocation | `POST /api/actions/notify_worker__…` | une app s'invoque par `POST /mcp` (`notify_worker__…`) |
| Vault | « credentials lus depuis Vault d'abord » | jamais consulté (`appId` toujours `null`) |
| Multi-tenant | « RLS + policies » (CLAUDE.md) | aucune policy créée ; trigger de partition seulement |
| `reload_config` | « à venir » | absent ; `update_config` ne recharge que les configs |
| `get_config` sans type | — | échec « not implemented » |
| Digest `LOW` | spec | non implémenté |
| Purge inbox / journal | « auto-purge » (commentaire DDL) | aucune |
| Variables `SOCLE_COMM_EMAIL_HUB_*`, `LOG_CONTENT`, `RETRY_*` | absentes de `ENV-REFERENCE.md` et du manifeste | lues par `CommProperties` |
| `contexte.md` | « socle 5.2.0, ne compile pas » | obsolète : socle 5.11.0 (minimum 5.10.0) / Boot 4.1.2, 35 tests verts |

Corrigé en 2.1.0 : le 2.0.0 embarquait `okhttp` 4.12.0 en compile ; avec le socle 5.10
(`okhttp-jvm` 5.5.1) l'app aurait eu deux copies de `okhttp3.*` — le pack prend désormais celle du
socle, en `provided`. Noms de beans génériques (`packMigrationRunner`, `tenantResolver`…) en
collision avec les autres packs : préfixés `comm*`.

Corrigé en 2.0.0 : README et `socle-pack.json` annonçaient 1.0.0 — ils portent désormais la
version, le socle minimal (5.8.6) et Boot 4.0.6 ; un `CHANGELOG.md` existe.

Défauts constatés au code (détail dans les HOWTOs) : anti-doublon qui échoue en mono-tenant
(`? IS NULL` sans type, COM-05) ; `update_config` qui duplique les lignes à partition NULL
(COM-03) ; gabarits seedés avec des `\n` littéraux (COM-03) ; `telegram_worker`/`slack_worker`
`get_status` en NPE avant le premier envoi (COM-06) ; `send_notification` toujours en succès MCP
(COM-02) ; sur un schéma neuf, les caches de configs et de gabarits se chargent **avant** les
migrations (« reload failed: bad SQL grammar ») et restent vides jusqu'au premier `reload()` (COM-01,
vu sur 2.0.0 et 2.1.0 ; code identique en 2.2.0).
