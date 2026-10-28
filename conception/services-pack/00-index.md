# Services des packs du socle — index

> **À quoi ça sert.** Un `socle-pack-*` est une bibliothèque Maven (`eu.lmvi:socle-pack-*`) qu'une app
> V005 embarque pour gagner une capacité métier sans la recoder : IA, notifications, connecteurs SaaS,
> chaîne éditoriale, courrier par utilisateur, pipelines DAG, tenant, sortie réseau. Ce dossier donne
> **un howto par grande fonctionnalité de chaque pack**, au même modèle que
> [`services-disponibles/`](../services-disponibles/00-index.md) : code complet, vérification,
> « Pièges courants » obligatoire.
>
> **Ordre de routage au plan technique (M6, §3 bis)** : 1. le besoin est-il un service rendu par le
> Hub ? → `services-disponibles/` ; 2. un pack le rend-il dans l'app ? → **ici** (table « besoin →
> howto » : [`CATALOGUE-PACKS.md`](../CATALOGUE-PACKS.md)) ; 3. mutualisable ? → **service-pack
> first** : on amende un pack ou on en crée un ; 4. ce qui reste, propre à l'app → les fiches de
> mécanismes (`use-cases/`). Une brique qui s'appuie sur un pack cite `howto-<pack>-NN` dans la
> colonne « Pack embarqué » de la table de routage. Schéma complet : [`README.md`](../README.md).
>
> **État de référence** : chaque howto a été écrit **à partir du code du pack** le 2026-10-28 (version
> et commit dans le `README.md` de chaque dossier). Quand le README d'un pack contredit son code, les
> howtos suivent le code et le signalent dans leurs pièges.

---

## Créer ou amender un pack

| Howto | Pour |
|---|---|
| [`00-creer-ou-amender-un-pack`](00-creer-ou-amender-un-pack.md) | `EXTENSION <pack>` (propriété, action, migration, version, tests, howtos, adoption par l'app) et `PACK NEUF <id>` avec le modèle `socle-pack-ZZ-TEMPLATE` (`bootstrap.sh`) ; conventions communes : beans préfixés, test de démarrage, manifeste exact, socle/Boot, vendorisation |

---

## Les huit packs

| Pack | Ce qu'il apporte à l'app | Socle 5.10 · Boot 4.1.2 | Socle 5.8.4-5.9.x · Boot 4.0.6 | Boot 3.2.1 (socle ≤ 5.8.0) | Apps qui le consomment |
|---|---|---|---|---|---|
| [`pack-ai`](pack-ai/README.md) | génération, embeddings, RAG, classification, web, agents | **2.8.0** | 2.7.14 | 2.4.8 (lignée 2.4.x) | LeSachant, IdeaBoxDev, NotionSocle, UniqPersonnality ; 2.4.x : SDR2, REGIES, BilanSocle |
| [`pack-com`](pack-com/README.md) | notifications multicanal : courriel, SMS, Telegram, Slack, webhook, in-app | **2.1.0** | 2.0.0 | 1.1.0 | BingFetch, UniqPersonnality, RssArchiver |
| [`pack-connectors`](pack-connectors/README.md) | Notion, Google Drive, Stripe, HubSpot | **3.1.0** | 3.0.0 | 2.0.0 | aucune à ce jour |
| [`pack-editorial`](pack-editorial/README.md) | RSS → curation LLM → validation humaine → newsletter (ai + comm) | **2.1.0** | 2.0.0 | 1.0.0-SNAPSHOT | RssArchiver |
| [`pack-egress`](pack-egress/README.md) | faire sortir les appels HTTPS de l'app par un miniMiniHub du Hub | **3.0.0** (protobuf 4) | 2.0.0 | 1.0.0 | KEW, RssArchiver |
| [`pack-mail`](pack-mail/README.md) | boîte de chaque utilisateur (IMAP, Gmail, Outlook), envoi, boîte applicative, lien d'activation (ai) | **1.5.0** | 1.4.0 | — | aucune déclarée (TheIdeaBox s'y prépare) |
| [`pack-pipeline`](pack-pipeline/README.md) | moteur de pipelines DAG : runs, étapes humaines, DLQ, catalogue, NATS | **0.3.0** | 0.2.0 | 0.1.0-SNAPSHOT | RssArchiver, BilanSocle, NotionSocle, REGIES, TheDiffuseur |
| [`pack-tenant`](pack-tenant/README.md) | fiche société, marque, équipe et multi-tenant lus depuis l'IAM du Hub | **0.6.0** | 0.5.0 | — | Your360, TheSociety, UniqPersonnality |

Dépendances entre packs : `editorial` → `ai` + `com` ; `mail` → `ai`. Les autres sont autonomes.

---

## Les howtos

### pack-ai — l'IA dans l'app

| Howto | Fonctionnalité |
|---|---|
| [`AI-01`](pack-ai/howto-ai-01-integrer-le-pack.md) | Intégrer socle-pack-ai dans une application V005 |
| [`AI-02`](pack-ai/howto-ai-02-generer-du-texte-avec-des-prompts-versionnes.md) | Générer du texte avec des prompts versionnés |
| [`AI-03`](pack-ai/howto-ai-03-calculer-des-embeddings.md) | Calculer des embeddings (bge-m3 par l'APIM, OpenAI, Ollama) |
| [`AI-04`](pack-ai/howto-ai-04-construire-un-rag-ingerer-et-interroger.md) | Construire un RAG : ingérer un corpus et répondre avec citations |
| [`AI-05`](pack-ai/howto-ai-05-classifier-avec-retour-utilisateur.md) | Classifier des items et apprendre des rejets |
| [`AI-06`](pack-ai/howto-ai-06-resumer-traduire-transcrire-documenter.md) | Résumer en 5W1H, traduire, transcrire un audio, rédiger une documentation |
| [`AI-07`](pack-ai/howto-ai-07-lire-le-web-fetch-recherche-navigateur.md) | Lire le web : récupérer une page, un document, chercher, piloter un navigateur |
| [`AI-08`](pack-ai/howto-ai-08-construire-un-agent-llm-gateway-et-sessions.md) | Construire un agent : passerelle LLM, boucle d'outils, sessions |
| [`AI-09`](pack-ai/howto-ai-09-lignee-2-4-x-pour-les-apps-boot-3.md) | La lignée 2.4.x pour les apps restées en Spring Boot 3.2.1 |

### pack-com — notifier

| Howto | Fonctionnalité |
|---|---|
| [`COM-01`](pack-com/howto-com-01-integrer-le-pack.md) | Intégrer socle-pack-comm dans une application V005 |
| [`COM-02`](pack-com/howto-com-02-envoyer-une-notification-multicanal.md) | Envoyer une notification multicanal avec `notify_worker` |
| [`COM-03`](pack-com/howto-com-03-types-et-gabarits.md) | Déclarer des types de notification et leurs gabarits |
| [`COM-04`](pack-com/howto-com-04-envoyer-des-courriels-smtp-brevo-hub.md) | Envoyer des courriels : Hub, James ou Brevo |
| [`COM-05`](pack-com/howto-com-05-journal-rejeu-et-anti-doublon.md) | Journal des envois, rejeu, anti-doublon et multi-tenant |
| [`COM-06`](pack-com/howto-com-06-telegram-et-slack.md) | Publier sur Telegram et Slack |
| [`COM-07`](pack-com/howto-com-07-envoyer-des-sms.md) | Envoyer des SMS (Twilio, OVH, Vonage, ou fournisseur maison) |
| [`COM-08`](pack-com/howto-com-08-webhook-et-notifications-in-app.md) | Webhooks signés et boîte de notifications in-app |

### pack-connectors — parler aux SaaS

| Howto | Fonctionnalité |
|---|---|
| [`CONNECTORS-01`](pack-connectors/howto-connectors-01-integrer-le-pack.md) | Intégrer `socle-pack-connectors` dans une app V005 |
| [`CONNECTORS-02`](pack-connectors/howto-connectors-02-activer-un-connecteur.md) | Activer un connecteur à la demande |
| [`CONNECTORS-03`](pack-connectors/howto-connectors-03-gerer-les-identifiants.md) | Gérer les identifiants des connecteurs |
| [`CONNECTORS-04`](pack-connectors/howto-connectors-04-notion-pages-et-databases.md) | Notion : lire et écrire pages, databases et blocs par actions |
| [`CONNECTORS-05`](pack-connectors/howto-connectors-05-notion-synchroniser-une-database.md) | Notion : synchroniser une database depuis le code de l'app |
| [`CONNECTORS-06`](pack-connectors/howto-connectors-06-google-drive.md) | Google Drive : déposer, lister, exporter des fichiers |
| [`CONNECTORS-07`](pack-connectors/howto-connectors-07-stripe-clients-et-abonnements.md) | Stripe : clients, abonnements et Checkout |
| [`CONNECTORS-08`](pack-connectors/howto-connectors-08-stripe-recevoir-les-webhooks.md) | Stripe : recevoir et traiter les webhooks |
| [`CONNECTORS-09`](pack-connectors/howto-connectors-09-hubspot-crm.md) | HubSpot : contacts, entreprises et deals |
| [`CONNECTORS-10`](pack-connectors/howto-connectors-10-resilience-et-journal-des-appels.md) | Résilience et journal des appels (`tr_connector_log`) |

### pack-editorial — la chaîne éditoriale

| Howto | Fonctionnalité |
|---|---|
| [`EDITORIAL-01`](pack-editorial/howto-editorial-01-integrer-le-pack.md) | Intégrer `socle-pack-editorial` dans une application |
| [`EDITORIAL-02`](pack-editorial/howto-editorial-02-collecter-des-flux-rss.md) | Collecter des flux RSS/Atom avec `rss_collect_worker` |
| [`EDITORIAL-03`](pack-editorial/howto-editorial-03-curer-et-router-les-articles.md) | Curer et router les articles avec `curation_worker` |
| [`EDITORIAL-04`](pack-editorial/howto-editorial-04-enrichir-les-articles-publies.md) | Enrichir les articles publiés (corps complet, bibliographie, 5W1H, traduction, KEW, RAG) |
| [`EDITORIAL-05`](pack-editorial/howto-editorial-05-valider-en-hitl.md) | Valider les articles en HITL avec `hitl_worker` |
| [`EDITORIAL-06`](pack-editorial/howto-editorial-06-envoyer-des-newsletters.md) | Composer et envoyer des newsletters avec `newsletter_worker` |

### pack-egress — sortir par le Hub

| Howto | Fonctionnalité |
|---|---|
| [`EGRESS-01`](pack-egress/howto-egress-01-integrer-le-pack.md) | Intégrer `socle-pack-egress` dans une application |
| [`EGRESS-02`](pack-egress/howto-egress-02-faire-sortir-un-client-http.md) | Faire sortir un client HTTP par le proxy du pack |
| [`EGRESS-03`](pack-egress/howto-egress-03-choisir-sa-sortie.md) | Choisir sa sortie : sélecteur, affinité, pool du Hub |
| [`EGRESS-04`](pack-egress/howto-egress-04-observer-et-diagnostiquer.md) | Observer la sortie et diagnostiquer un refus |

### pack-mail — le courrier de chaque utilisateur

| Howto | Fonctionnalité |
|---|---|
| [`MAIL-01`](pack-mail/howto-mail-01-integrer-le-pack.md) | Intégrer socle-pack-mail dans une application V005 |
| [`MAIL-02`](pack-mail/howto-mail-02-importer-une-boite-utilisateur.md) | Importer la boîte d'un utilisateur et bâtir son référentiel contacts |
| [`MAIL-03`](pack-mail/howto-mail-03-envoyer-depuis-la-boite-utilisateur.md) | Envoyer depuis la boîte de l'utilisateur (plages horaires, quota, envois différés) |
| [`MAIL-04`](pack-mail/howto-mail-04-generer-un-mail-contextualise.md) | Générer un courriel contextualisé par IA |
| [`MAIL-05`](pack-mail/howto-mail-05-epurer-les-messages.md) | Épurer des messages stockés (citations, en-têtes recopiés, signatures) |
| [`MAIL-06`](pack-mail/howto-mail-06-relever-une-boite-applicative.md) | Relever la boîte d'une application et traiter chaque courriel reçu |
| [`MAIL-07`](pack-mail/howto-mail-07-lien-dactivation-de-compte.md) | Faire naître un compte IAM par un lien d'activation |

### pack-pipeline — les pipelines DAG

| Howto | Fonctionnalité |
|---|---|
| [`PIPELINE-01`](pack-pipeline/howto-pipeline-01-integrer-le-pack.md) | Intégrer socle-pack-pipeline (et quand le préférer aux pipelines du framework) |
| [`PIPELINE-02`](pack-pipeline/howto-pipeline-02-declarer-valider-publier-un-dag.md) | Déclarer, valider et publier un DAG |
| [`PIPELINE-03`](pack-pipeline/howto-pipeline-03-ecrire-un-stage-handler.md) | Écrire un StageHandler (la logique métier d'une étape) |
| [`PIPELINE-04`](pack-pipeline/howto-pipeline-04-executer-un-run.md) | Exécuter un run : instancier, démarrer, piloter, clore |
| [`PIPELINE-05`](pack-pipeline/howto-pipeline-05-human-in-the-loop-et-reprise.md) | Human-in-the-loop et reprise après redémarrage |
| [`PIPELINE-06`](pack-pipeline/howto-pipeline-06-idempotence-backfill-et-dlq.md) | Idempotence, backfill et relance des échecs (DLQ) |
| [`PIPELINE-07`](pack-pipeline/howto-pipeline-07-observer-lineage-et-metriques.md) | Observer un run : lineage, métriques, artefacts |
| [`PIPELINE-08`](pack-pipeline/howto-pipeline-08-catalogue-fork-et-sous-pipelines.md) | Catalogue, fork et sous-pipelines (étape Composite) |
| [`PIPELINE-09`](pack-pipeline/howto-pipeline-09-backend-nats-jetstream.md) | Faire transiter les étapes par NATS JetStream |

### pack-tenant — le tenant vu par l'app

| Howto | Fonctionnalité |
|---|---|
| [`TENANT-01`](pack-tenant/howto-tenant-01-integrer-le-pack.md) | Intégrer socle-pack-tenant dans une application |
| [`TENANT-02`](pack-tenant/howto-tenant-02-poser-le-tenant-courant.md) | Poser le tenant courant pour le pack (MDC `tenant_id`) |
| [`TENANT-03`](pack-tenant/howto-tenant-03-lire-la-fiche-societe.md) | Lire la fiche société du tenant |
| [`TENANT-04`](pack-tenant/howto-tenant-04-rendre-la-marque.md) | Rendre la marque du tenant (couleurs, typographies, logo) |
| [`TENANT-05`](pack-tenant/howto-tenant-05-lire-l-equipe.md) | Lire l'équipe du tenant |
| [`TENANT-06`](pack-tenant/howto-tenant-06-servir-plusieurs-tenants.md) | Servir plusieurs tenants depuis une même application |
| [`TENANT-07`](pack-tenant/howto-tenant-07-fraicheur-cache-et-mode-degrade.md) | Fraîcheur, cache et mode dégradé |
| [`TENANT-08`](pack-tenant/howto-tenant-08-migrer-une-table-locale-p4-p5.md) | Remplacer une table locale par la fiche : lecture double (P4) puis bascule (P5) |

---

## Pièges communs à plusieurs packs

Relevés en écrivant les howtos ; chaque fiche les reprend là où ils mordent.

1. **Une app s'appelle par `POST /mcp`, pas par `/api/actions/…`.** Les README des packs ai, com,
   connectors, editorial et mail montrent des `curl /api/actions/...` : c'est la porte du **Hub**, elle
   rend 404 sur une app.
2. **« Vault » ne lit rien dans quatre packs.** ai, com, connectors et mail appellent leur résolveur
   avec `appId = null` : `vault.enabled: true` ne change rien, les clés viennent des variables
   d'environnement. Ne pas planifier une brique sur une lecture Vault par le pack.
3. **Trois lignées Spring Boot — prendre la colonne du socle de l'app.** Le 2026-10-28, les huit
   packs ont été alignés sur le **socle 5.10.0 / Boot 4.1.2** (tableau ci-dessus, tags `vX.Y.Z` sur
   `main`, jars dans `~/.m2`, à vendoriser). Une app en socle 5.8.4-5.9.x (Boot 4.0.6) garde la
   colonne du milieu ; une app en Boot 3.2.1 garde la dernière colonne (pack-ai en 2.4.x,
   [`AI-09`](pack-ai/howto-ai-09-lignee-2-4-x-pour-les-apps-boot-3.md)). Ne jamais mélanger : un
   pack 5.10 exige le socle 5.10 (`minSocleVersion`). Depuis l'alignement, **tous les beans des packs
   sont préfixés** (`aiPackMigrationRunner`, `commTenantResolver`…) : une app qui embarque plusieurs
   packs n'a plus à qualifier ses beans ; un `@Qualifier` sur un ancien nom est à mettre à jour.
   Le socle 5.10 fournit OkHttp en `okhttp-jvm` 5.5.1 : aucun `okhttp` 4.x dans l'app. Il annonce
   gRPC 1.85.1 mais Boot 4.1.2 impose 1.84.1 : importer `grpc-bom` 1.85.1 dans l'app qui utilise
   gRPC (défaut du socle, signalé). L'app exclut `spring-boot-starter-logging` et balaie
   `eu.lmvi.socle` (l'`ObjectMapper` Jackson 2 vient du socle).
4. **Un pack n'est disponible que s'il est vendorisé.** Aucun pack n'est servi par
   `maven.thesocle.net` dans sa dernière version ; plusieurs ne vivent que dans le `~/.m2` de la box
   de build. L'app copie le jar et le pom dans son `mvn-repo/` (cf. CLAUDE.md racine), sinon un clone
   frais ne compile pas.
5. **Mono-tenant et `x_partition` NULL.** Plusieurs packs (com, editorial, pipeline, ai) écrivent des
   `? IS NULL` sans CAST ou des `ON CONFLICT` sur une colonne nullable : requête refusée ou doublons
   quand l'app n'a pas de tenant. Voir les pièges de chaque fiche.
6. **Le manifeste `socle-pack.json` est en retard sur le pom** dans la plupart des packs (versions,
   actions, tables) : se fier au code et aux howtos.

---

## Maintenance de ce dossier

Ce dossier décrit le code des packs ; il vieillit avec eux. **Chaque pack porte dans son `CLAUDE.md`
la consigne de mettre à jour ses howtos ici** dans le même travail qu'une modification de
fonctionnalité, de configuration, d'action MCP ou de migration. Quand un pack change de version :

1. mettre à jour les howtos concernés, et la version + le commit dans le `README.md` du dossier du pack ;
2. ajouter un howto si une grande fonctionnalité apparaît, et sa ligne dans cet index ;
3. retirer de la liste des pièges ce qui a été corrigé, avec la version qui le corrige.
