# socle-pack-connectors — HOWTOs

**Le pack en 5 lignes**

1. Bibliothèque Maven `eu.lmvi:socle-pack-connectors` qu'une app V005 embarque pour parler à **Notion, Google Drive, Stripe et HubSpot**.
2. Quatre Workers **PASSIVE** (`notion_worker`, `gdrive_worker`, `stripe_worker`, `hubspot_worker`) exposant **54 actions** MCP/REST bas niveau, sans logique métier.
3. Depuis 2.0.0, **chaque connecteur est éteint par défaut** et s'allume par `socle.conn.<connecteur>.enabled=true`.
4. Résilience commune (rate limiter, retry ×3, circuit breaker par fournisseur) et journal `tr_connector_log` dans le schéma PostgreSQL de l'app.
5. Services Notion réutilisables sans worker (`NotionDatabaseService`, `PropertyConverter`) et récepteur webhook Stripe signé (`POST /api/webhooks/stripe`, qui valide et journalise seulement).

**Version documentée :** `2.0.0` (pom, `socle-pack.json`), compilée contre `socle-v005:5.7.4` et
Spring Boot `3.2.1`, Java 21.
**Référence git :** dépôt `socle-pack-Connectors`, branche `feat/connectors-enabled` @ `298f758`.
Le mécanisme d'activation (`f3a3e08`) est **fusionné dans `main`** (`9e6d106`) ; la branche n'ajoute
que `docs/preuves/README.md`. Aucun mécanisme n'est propre à la branche.
**Vérifié au code le :** 2026-10-28.

---

## Besoin → HOWTO

| Besoin | HOWTO |
|---|---|
| Ajouter le pack à une app (dépendance, scan, schéma, migrations, contrôle au dashboard) | [[howto-connectors-01-integrer-le-pack\|CONNECTORS-01 — Intégrer le pack]] |
| Allumer / éteindre un connecteur, l'utiliser comme dépendance optionnelle | [[howto-connectors-02-activer-un-connecteur\|CONNECTORS-02 — Activer un connecteur]] |
| Poser et faire tourner les clés (env, `set_env_var`, ce que « Vault » fait vraiment) | [[howto-connectors-03-gerer-les-identifiants\|CONNECTORS-03 — Identifiants]] |
| Lire/écrire pages, databases, blocs Notion par actions MCP/REST | [[howto-connectors-04-notion-pages-et-databases\|CONNECTORS-04 — Notion par actions]] |
| Synchroniser une database Notion avec une table de l'app | [[howto-connectors-05-notion-synchroniser-une-database\|CONNECTORS-05 — Synchroniser Notion]] |
| Déposer, lister, exporter des fichiers Google Drive | [[howto-connectors-06-google-drive\|CONNECTORS-06 — Google Drive]] |
| Créer clients, abonnements, sessions Checkout Stripe | [[howto-connectors-07-stripe-clients-et-abonnements\|CONNECTORS-07 — Stripe]] |
| Traiter les événements Stripe (webhooks signés) | [[howto-connectors-08-stripe-recevoir-les-webhooks\|CONNECTORS-08 — Webhooks Stripe]] |
| Alimenter le CRM HubSpot (contacts, entreprises, deals) | [[howto-connectors-09-hubspot-crm\|CONNECTORS-09 — HubSpot]] |
| Diagnostiquer un connecteur (circuit ouvert, lenteur, journal, purge) | [[howto-connectors-10-resilience-et-journal-des-appels\|CONNECTORS-10 — Résilience et journal]] |

---

## Ce qui est implémenté, ce qui est stub

| Connecteur | Actions | État |
|---|---|---|
| Notion | 20 (19 au manifeste + `create_database`) | Réel, sauf `import_zip_export` (**stub**, échoue toujours), `download_asset` (**stub**, renvoie l'URL), `register_webhook` (tentative best-effort) |
| Google Drive | 10 | Réel ; `list_files` échoue quand la réponse n'a pas de `nextPageToken` (CONNECTORS-06) |
| Stripe | 12 + contrôleur webhook | Réel ; le contrôleur ne transmet pas les événements (CONNECTORS-08) |
| HubSpot | 12 | Réel |
| Transverse | — | Vault jamais consulté (`appId` toujours `null`) ; `tr_notion_import_job` créée mais jamais alimentée ; `x_partition`, `http_status`, `request_hash` utile non renseignés |

## Dépendances vers d'autres packs

**Aucune.** `socle-pack.json` déclare `"dependencies": []` et le CLAUDE.md du pack interdit tout
import de `socle-pack-ai` ou `socle-pack-comm` (les classes de résilience sont recopiées localement).
Dépendances techniques attendues de l'app hôte (scope `provided` dans le pack) : `socle-v005`,
`spring-boot-starter-web`, `spring-boot-starter-jdbc`, `postgresql`, `jackson-databind` (Jackson 2),
`log4j2`. Le pack apporte OkHttp 4.12.0.

## Applications consommatrices

Au 2026-10-28, **aucune APP-* du dépôt ne déclare la dépendance** (`grep -rl socle-pack-connectors
--include=pom.xml` : zéro résultat hors du pack). Les versions `1.0.0-SNAPSHOT` → `2.0.0` sont
installées dans `~/.m2` de la box de build ; aucune n'est vendorisée dans un `mvn-repo/`. Les
exemples de code des HOWTOs utilisent donc une app fictive `monapp` (`schema_monapp`).

## Services du Hub à préférer

- Stockage de fichiers interne à la plateforme : [[howto-16-storage-s3-quotas|HOWTO 16]] plutôt que Google Drive.
- Facturer l'usage d'une API publiée : [[howto-35-configurer-le-wallet-et-la-facturation-apim|HOWTO 35]] plutôt que Stripe.
- Fiche générique d'intégration d'un pack : [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]].
