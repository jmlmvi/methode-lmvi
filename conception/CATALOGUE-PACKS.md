<!-- KIT-VERSION: 1.15.0 -->
# Catalogue des packs du socle — de la brique au howto

> **À quoi ça sert** : au plan technique (M6, §3 bis), une brique dont le besoin n'est pas un
> service du Hub ([`CATALOGUE-SERVICES.md`](CATALOGUE-SERVICES.md)) cherche ensuite si un
> `socle-pack-*` le rend **dans l'app**. Cette table répond sans quitter le kit : un besoin, un
> howto `howto-<pack>-NN`, que la brique cite dans la colonne « Pack embarqué » de la table de
> routage.
>
> **Les howtos sont dans le kit** : [`services-pack/`](services-pack/00-index.md) — un dossier par
> pack, un howto par grande fonctionnalité, écrits à partir du code des packs le 2026-10-28. Le
> `README.md` de chaque dossier donne la version et le commit documentés.
>
> **Ordre de routage et règle « service-pack first »** : schéma et explication dans
> [`README.md`](README.md#services-packs-et-mécanismes--où-chercher-et-qui-appelle-qui).

Colonne **État** : `prêt` = version étiquetée sur `main`, jar dans `~/.m2` de la box de build, que
l'app vendorise dans son `mvn-repo/` (aucun pack n'est servi par `maven.thesocle.net`) · `défaut` = un défaut connu
touche cette fonctionnalité, le howto donne le contournement ; à corriger **dans le pack**
(service-pack first), pas dans l'app.

### Intégrer un pack (toujours en premier)

| Ma brique embarque… | Howto | État |
|---|---|---|
| `socle-pack-ai` 2.8.0 (socle 5.10 ; 2.7.14 pour 5.9.x ; 2.4.x pour Boot 3) | [`howto-ai-01`](services-pack/pack-ai/howto-ai-01-integrer-le-pack.md) · [`howto-ai-09`](services-pack/pack-ai/howto-ai-09-lignee-2-4-x-pour-les-apps-boot-3.md) | prêt (tag `v2.8.0`, jar dans `~/.m2`, à vendoriser) |
| `socle-pack-comm` 2.1.0 (socle 5.10 ; 2.0.0 pour 5.9.x ; 1.1.0 pour Boot 3) | [`howto-com-01`](services-pack/pack-com/howto-com-01-integrer-le-pack.md) | prêt (tag `v2.1.0`) |
| `socle-pack-connectors` 3.1.0 (socle 5.10 ; 3.0.0 / 2.0.0) | [`howto-connectors-01`](services-pack/pack-connectors/howto-connectors-01-integrer-le-pack.md) | prêt (tag `v3.1.0`) |
| `socle-pack-editorial` 2.1.0 (socle 5.10, ai 2.8.0 + comm 2.1.0 ; 2.0.0 pour 5.9.x) | [`howto-editorial-01`](services-pack/pack-editorial/howto-editorial-01-integrer-le-pack.md) | prêt (tag `v2.1.0`) |
| `socle-pack-egress` 3.0.0 (socle 5.10, protobuf 4 ; 2.0.0 / 1.0.0) | [`howto-egress-01`](services-pack/pack-egress/howto-egress-01-integrer-le-pack.md) | prêt (tag `v3.0.0` ; test contre le Hub à rejouer) |
| `socle-pack-mail` 1.5.0 (socle 5.10, ai 2.8.0 ; 1.4.0 pour 5.9.x) | [`howto-mail-01`](services-pack/pack-mail/howto-mail-01-integrer-le-pack.md) | prêt (tag `v1.5.0`) |
| `socle-pack-pipeline` 0.3.0 (socle 5.10 ; 0.2.0 / 0.1.0-SNAPSHOT) | [`howto-pipeline-01`](services-pack/pack-pipeline/howto-pipeline-01-integrer-le-pack.md) | prêt (tag `v0.3.0`) |
| `socle-pack-tenant` 0.6.0 (socle 5.10 ; 0.5.0 pour 5.9.x) | [`howto-tenant-01`](services-pack/pack-tenant/howto-tenant-01-integrer-le-pack.md) | prêt (tag `v0.6.0`) |
| **un pack qui n'existe pas encore**, ou une extension d'un pack | [`00-creer-ou-amender-un-pack`](services-pack/00-creer-ou-amender-un-pack.md) — modèle `socle-pack-ZZ-TEMPLATE` (`bootstrap.sh`) | service-pack first |

### IA et texte

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| générer du texte avec des prompts versionnés en base, cascade de modèles, plafonds de coût | [`howto-ai-02`](services-pack/pack-ai/howto-ai-02-generer-du-texte-avec-des-prompts-versionnes.md) | défaut : plafonds contrôlés seulement par MCP |
| calculer des embeddings (bge-m3 par l'APIM, OpenAI, Ollama) | [`howto-ai-03`](services-pack/pack-ai/howto-ai-03-calculer-des-embeddings.md) | prêt |
| un RAG : ingérer un corpus, rechercher, répondre avec citations | [`howto-ai-04`](services-pack/pack-ai/howto-ai-04-construire-un-rag-ingerer-et-interroger.md) | défaut : `filters` ignoré |
| classer des items par LLM et apprendre des rejets | [`howto-ai-05`](services-pack/pack-ai/howto-ai-05-classifier-avec-retour-utilisateur.md) | prêt |
| résumer en 5W1H, traduire, transcrire un audio, rédiger une documentation | [`howto-ai-06`](services-pack/pack-ai/howto-ai-06-resumer-traduire-transcrire-documenter.md) | prêt |
| lire une page web ou un document, chercher, piloter un navigateur | [`howto-ai-07`](services-pack/pack-ai/howto-ai-07-lire-le-web-fetch-recherche-navigateur.md) | prêt |
| un agent LLM avec outils MCP et sessions | [`howto-ai-08`](services-pack/pack-ai/howto-ai-08-construire-un-agent-llm-gateway-et-sessions.md) | défaut : plusieurs parties en stub |

### Notifier et écrire aux gens

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| notifier un utilisateur sur plusieurs canaux, avec priorités | [`howto-com-02`](services-pack/pack-com/howto-com-02-envoyer-une-notification-multicanal.md) | défaut : throttling en mono-tenant |
| des types de notification et leurs gabarits en base | [`howto-com-03`](services-pack/pack-com/howto-com-03-types-et-gabarits.md) | prêt |
| envoyer des courriels (Hub, James, Brevo) — ou choisir le `mail_worker` du Hub | [`howto-com-04`](services-pack/pack-com/howto-com-04-envoyer-des-courriels-smtp-brevo-hub.md) | prêt |
| journal des envois, rejeu, anti-doublon | [`howto-com-05`](services-pack/pack-com/howto-com-05-journal-rejeu-et-anti-doublon.md) | défaut : rejeu sans contenu si `log-content: false` |
| Telegram, Slack | [`howto-com-06`](services-pack/pack-com/howto-com-06-telegram-et-slack.md) | prêt |
| SMS (Twilio, OVH, Vonage, fournisseur maison) | [`howto-com-07`](services-pack/pack-com/howto-com-07-envoyer-des-sms.md) | prêt |
| webhook signé sortant, boîte de notifications in-app | [`howto-com-08`](services-pack/pack-com/howto-com-08-webhook-et-notifications-in-app.md) | prêt (contrôleur in-app à écrire) |

### Courrier de chaque utilisateur

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| importer la boîte d'un utilisateur (IMAP, Gmail, CSV Outlook) et ses contacts | [`howto-mail-02`](services-pack/pack-mail/howto-mail-02-importer-une-boite-utilisateur.md) | défaut : identifiants par `source_config` |
| envoyer depuis la boîte de l'utilisateur (plages, quota, différé) | [`howto-mail-03`](services-pack/pack-mail/howto-mail-03-envoyer-depuis-la-boite-utilisateur.md) | défaut : contournement `@Primary` requis |
| rédiger un courriel contextualisé par IA | [`howto-mail-04`](services-pack/pack-mail/howto-mail-04-generer-un-mail-contextualise.md) | défaut : prompt posé dans le mauvais schéma |
| épurer des messages stockés (citations, signatures) | [`howto-mail-05`](services-pack/pack-mail/howto-mail-05-epurer-les-messages.md) | prêt |
| traiter les courriels reçus par la boîte de l'app | [`howto-mail-06`](services-pack/pack-mail/howto-mail-06-relever-une-boite-applicative.md) | prêt (1.4.0) |
| créer un compte IAM par lien d'activation | [`howto-mail-07`](services-pack/pack-mail/howto-mail-07-lien-dactivation-de-compte.md) | prêt (1.4.0) |

### Applications SaaS

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| activer un connecteur seulement s'il sert | [`howto-connectors-02`](services-pack/pack-connectors/howto-connectors-02-activer-un-connecteur.md) | prêt |
| donner ses identifiants à un connecteur | [`howto-connectors-03`](services-pack/pack-connectors/howto-connectors-03-gerer-les-identifiants.md) | défaut : Vault jamais lu |
| lire ou écrire pages, databases et blocs Notion | [`howto-connectors-04`](services-pack/pack-connectors/howto-connectors-04-notion-pages-et-databases.md) | défaut : dernière page de résultats |
| synchroniser une database Notion depuis l'app | [`howto-connectors-05`](services-pack/pack-connectors/howto-connectors-05-notion-synchroniser-une-database.md) | prêt |
| Google Drive : déposer, lister, exporter | [`howto-connectors-06`](services-pack/pack-connectors/howto-connectors-06-google-drive.md) | défaut : `list_files` sur une seule page |
| Stripe : clients, abonnements, Checkout | [`howto-connectors-07`](services-pack/pack-connectors/howto-connectors-07-stripe-clients-et-abonnements.md) | défaut : retry de POST sans idempotence |
| Stripe : recevoir les webhooks | [`howto-connectors-08`](services-pack/pack-connectors/howto-connectors-08-stripe-recevoir-les-webhooks.md) | prêt (récepteur à écrire) |
| HubSpot : contacts, entreprises, deals | [`howto-connectors-09`](services-pack/pack-connectors/howto-connectors-09-hubspot-crm.md) | prêt |
| journal et résilience des appels sortants | [`howto-connectors-10`](services-pack/pack-connectors/howto-connectors-10-resilience-et-journal-des-appels.md) | prêt |

### Chaîne éditoriale

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| collecter des flux RSS/Atom | [`howto-editorial-02`](services-pack/pack-editorial/howto-editorial-02-collecter-des-flux-rss.md) | prêt |
| curer et router les articles par LLM | [`howto-editorial-03`](services-pack/pack-editorial/howto-editorial-03-curer-et-router-les-articles.md) | défaut : `update_curation_config` échoue |
| enrichir les articles publiés (corps, bibliographie, 5W1H, traduction, RAG) | [`howto-editorial-04`](services-pack/pack-editorial/howto-editorial-04-enrichir-les-articles-publies.md) | prêt |
| faire valider les articles par un humain | [`howto-editorial-05`](services-pack/pack-editorial/howto-editorial-05-valider-en-hitl.md) | défaut : délais et relances inopérants |
| composer et envoyer une newsletter | [`howto-editorial-06`](services-pack/pack-editorial/howto-editorial-06-envoyer-des-newsletters.md) | défaut : désabonnement à écrire |

### Pipelines

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| déclarer, valider, publier un DAG d'étapes | [`howto-pipeline-02`](services-pack/pack-pipeline/howto-pipeline-02-declarer-valider-publier-un-dag.md) | prêt |
| écrire la logique métier d'une étape | [`howto-pipeline-03`](services-pack/pack-pipeline/howto-pipeline-03-ecrire-un-stage-handler.md) | prêt |
| exécuter et piloter un run (batch, pas-à-pas, idempotent) | [`howto-pipeline-04`](services-pack/pack-pipeline/howto-pipeline-04-executer-un-run.md) | défaut : fin de run |
| une étape humaine, reprise après redémarrage | [`howto-pipeline-05`](services-pack/pack-pipeline/howto-pipeline-05-human-in-the-loop-et-reprise.md) | prêt |
| idempotence, backfill, relance des échecs | [`howto-pipeline-06`](services-pack/pack-pipeline/howto-pipeline-06-idempotence-backfill-et-dlq.md) | défaut : relance perdue (déduplication avant exécution) |
| observer un run : lineage, métriques, artefacts | [`howto-pipeline-07`](services-pack/pack-pipeline/howto-pipeline-07-observer-lineage-et-metriques.md) | défaut : aucune purge |
| catalogue, fork, sous-pipelines | [`howto-pipeline-08`](services-pack/pack-pipeline/howto-pipeline-08-catalogue-fork-et-sous-pipelines.md) | prêt |
| faire transiter les étapes par NATS JetStream | [`howto-pipeline-09`](services-pack/pack-pipeline/howto-pipeline-09-backend-nats-jetstream.md) | prêt |

### Tenant et identité de la société

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| savoir quel tenant sert la requête (MDC `tenant_id`) | [`howto-tenant-02`](services-pack/pack-tenant/howto-tenant-02-poser-le-tenant-courant.md) | prêt (le filtre est à écrire dans l'app) |
| la fiche société (raison sociale, mentions légales…) | [`howto-tenant-03`](services-pack/pack-tenant/howto-tenant-03-lire-la-fiche-societe.md) | prêt |
| la marque : couleurs, typographies, logo | [`howto-tenant-04`](services-pack/pack-tenant/howto-tenant-04-rendre-la-marque.md) | prêt |
| l'équipe du tenant | [`howto-tenant-05`](services-pack/pack-tenant/howto-tenant-05-lire-l-equipe.md) | prêt |
| servir plusieurs tenants depuis une même app | [`howto-tenant-06`](services-pack/pack-tenant/howto-tenant-06-servir-plusieurs-tenants.md) | prêt |
| fraîcheur, cache, fonctionnement Hub indisponible | [`howto-tenant-07`](services-pack/pack-tenant/howto-tenant-07-fraicheur-cache-et-mode-degrade.md) | prêt |
| remplacer une table locale par la fiche du Hub | [`howto-tenant-08`](services-pack/pack-tenant/howto-tenant-08-migrer-une-table-locale-p4-p5.md) | prêt |

### Sortie réseau

| Ma brique a besoin de… | Howto | État |
|---|---|---|
| faire sortir ses appels HTTPS par une autre IP (miniMiniHub) | [`howto-egress-02`](services-pack/pack-egress/howto-egress-02-faire-sortir-un-client-http.md) | prêt |
| choisir sa sortie : pays, Tor, affinité | [`howto-egress-03`](services-pack/pack-egress/howto-egress-03-choisir-sa-sortie.md) | prêt |
| diagnostiquer un refus de sortie | [`howto-egress-04`](services-pack/pack-egress/howto-egress-04-observer-et-diagnostiquer.md) | prêt |

---

> **Aucune ligne ne répond ?** Si le besoin est **mutualisable** (une autre app en aura besoin, ou il
> appartient visiblement au thème d'un pack), la règle « service-pack first » s'applique : la brique
> devient une **extension de pack** (ou un pack neuf), déclarée en M6 dans la colonne « Pack
> embarqué » sous la forme `EXTENSION <pack> — <ce qui est ajouté>`, et livrée dans le pack avant
> l'app. Sinon, on passe au [`CATALOGUE-MECANISMES.md`](CATALOGUE-MECANISMES.md).
