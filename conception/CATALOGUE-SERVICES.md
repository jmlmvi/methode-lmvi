<!-- KIT-VERSION: 1.12.0 -->
# Catalogue des services du Hub — de la brique au guide

> **À quoi ça sert** : au plan technique (M6, §3 bis), chaque brique cherche d'abord si son besoin
> est un service que le Hub rend déjà. Cette table répond sans quitter le kit : un besoin, un guide
> `howto-NN`, que la brique cite dans la table de routage.
>
> **Les guides sont dans le kit** : [`services-disponibles/`](services-disponibles/00-index.md) — un clic
> sur une référence ouvre le guide. Source canonique : `docs/02-DocHub/use-cases/` (44 guides),
> recopiée dans `APP-ZZ-TEMPLATE/docs/services-disponibles/` puis ici. Recensé le 2026-10-27 ; la source fait foi — si elle a grandi, ajouter
> la ligne ici.
>
> Ce qui reste à écrire dans l'app se route ensuite vers les 148 fiches de mécanismes
> (`APP-ZZ-TEMPLATE/docs/use-cases/INDEX.md`).

Colonne **Côté** : `app` = une brique de M6 consomme ce service ; `plateforme` = geste
d'administration du Hub ou de livraison, utile en M7 mais qu'aucune brique ne réimplémente.

### Identité et accès

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| comptes, rôles, scopes, clé d'API utilisateur | [`howto-08`](services-disponibles/howto-08-creer-utilisateur-iam.md) créer un utilisateur IAM | app |
| SSO entre apps (modes none / gate / optional / required) | [`howto-09`](services-disponibles/howto-09-configurer-sso-multi-app.md) SSO multi-app | app |
| connecter une app externe en OIDC (code flow + PKCE, JWKS) | [`howto-10`](services-disponibles/howto-10-configurer-oidc-provider.md) OIDC provider | app |
| tenants : création, suspension, quotas, audit de cohérence | [`howto-34`](services-disponibles/howto-34-gerer-les-tenants-iam.md) gérer les tenants IAM | app |
| tourner secrets, mots de passe, clés, jetons sans coupure | [`howto-19`](services-disponibles/howto-19-rotation-secrets.md) rotation des secrets | plateforme |

### Exposer et appeler des API

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| publier une API à des tiers (`/<api>/v1/…`, clés `apim_*`) | [`howto-30`](services-disponibles/howto-30-publier-une-api-apim.md) publier une API APIM | app |
| une règle de décision appliquée à la passerelle | [`howto-31`](services-disponibles/howto-31-creer-une-regle-jdm-apim.md) règle JDM APIM | app |
| tarifer et facturer l'usage d'une API | [`howto-35`](services-disponibles/howto-35-configurer-le-wallet-et-la-facturation-apim.md) wallet et facturation APIM | app |
| donner une entrée API à un programme, avec repli sur 429/5xx | [`howto-36`](services-disponibles/howto-36-exposer-un-programme-en-api-avec-repli-janino.md) programme en API + repli Janino | app |
| une clé pour appeler un LLM ou toute API APIM | [`howto-39`](services-disponibles/howto-39-provisionner-une-cle-apim-pour-une-app.md) provisionner une clé APIM | app |
| appeler un LLM (providers, quotas, tenant) | [`howto-27`](services-disponibles/howto-27-configurer-agentia-gateway.md) passerelle AgentIA | app |
| exposer ses actions à un agent (agrégation MCP) | [`howto-13`](services-disponibles/howto-13-utiliser-mcpagger.md) MCPagger | app |

### Messagerie et événements

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| publier des événements | [`howto-37`](services-disponibles/howto-37-publier-des-messages-nats-depuis-une-app.md) publier sur NATS | app |
| consommer des événements (durable, ack, idempotence) | [`howto-38`](services-disponibles/howto-38-consommer-des-messages-nats-depuis-une-app.md) consommer depuis NATS | app |
| créer, inspecter, purger un stream | [`howto-23`](services-disponibles/howto-23-nats-streams.md) streams NATS | plateforme |
| faire dialoguer deux sessions d'agent, ou un agent et un humain | [`howto-41`](services-disponibles/howto-41-salons-echanger-entre-sessions.md) salons | app |
| automatiser une tâche récurrente ou sur événement | [`howto-42`](services-disponibles/howto-42-alfred-automatiser-une-tache.md) Alfred | app |

### Courrier, calendrier, antivirus

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| envoyer ou recevoir du courrier (domaines, DKIM, boîtes) | [`howto-11`](services-disponibles/howto-11-configurer-james-mail.md) James | app |
| scanner les pièces jointes, quarantaine | [`howto-21`](services-disponibles/howto-21-clamav-mail-scan.md) scan ClamAV | app |
| calendrier et carnet d'adresses (CalDAV / CardDAV) | [`howto-22`](services-disponibles/howto-22-cosmo-calendrier.md) Cosmo | app |

### Fichiers, édition, signature

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| stocker des fichiers, URL présignées, quotas, partages | [`howto-16`](services-disponibles/howto-16-storage-s3-quotas.md) stockage S3 | app |
| éditer un document Office dans le navigateur | [`howto-14`](services-disponibles/howto-14-onlyoffice-edition.md) OnlyOffice | app |
| faire signer un document | [`howto-15`](services-disponibles/howto-15-signature-docuseal.md) signature DocuSeal | app |

### Mise en ligne, TLS, cache, protection

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| un domaine de marque et une route vers l'app | [`howto-43`](services-disponibles/howto-43-mettre-un-domaine-et-une-app-en-ligne.md) domaine et app en ligne | plateforme |
| un certificat TLS automatique | [`howto-12`](services-disponibles/howto-12-configurer-acme-cloudflare.md) ACME | plateforme |
| un cache HTTP (TTL par hôte, purge) | [`howto-20`](services-disponibles/howto-20-configurer-cache.md) cache | app |
| savoir ce que le filtre anti-scan bloque, et ce qu'il ne protège pas | [`howto-40`](services-disponibles/howto-40-scanguard-proteger-le-hub.md) ScanGuard | plateforme |

### Construire et faire vivre l'app

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| créer l'app de zéro (arborescence, manifeste, front, Dockerfile) | [`howto-24`](services-disponibles/howto-24-creer-une-app-socle-from-scratch.md) app from scratch | app |
| monter la version du socle ou du front | [`howto-25`](services-disponibles/howto-25-upgrader-une-app-socle.md) upgrader une app | app |
| intégrer un socle-pack (IA, pipeline, tenant…) | [`howto-28`](services-disponibles/howto-28-integrer-un-socle-pack-dans-une-app.md) intégrer un socle-pack | app |
| ajouter une fonctionnalité au Hub lui-même | [`howto-01`](services-disponibles/howto-01-ajouter-une-fonctionnalite.md) ajouter une fonctionnalité | plateforme |
| corriger un bug | [`howto-02`](services-disponibles/howto-02-corriger-un-bug.md) corriger un bug | plateforme |
| suivre la fabrication de l'app (salon, dossier TheDash, tableaux) | [`howto-44`](services-disponibles/howto-44-suivre-la-fabrication-dune-app.md) suivre la fabrication | plateforme |

### Livrer et exploiter

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| installer l'app sur le Hub | [`howto-03`](services-disponibles/howto-03-installer-une-app.md) installer une app | plateforme |
| la mettre à jour, avec retour arrière | [`howto-04`](services-disponibles/howto-04-mettre-a-jour-une-app.md) mettre à jour une app | plateforme |
| la désinstaller proprement | [`howto-05`](services-disponibles/howto-05-desinstaller-une-app.md) désinstaller une app | plateforme |
| publier ses images (mode éditeur, signature) | [`howto-06`](services-disponibles/howto-06-publier-une-app-editeur.md) publier une app | plateforme |
| ajouter une source de dépôt distante | [`howto-07`](services-disponibles/howto-07-ajouter-une-source-repository.md) source repository | plateforme |
| publier une app TheFront signée | [`howto-26`](services-disponibles/howto-26-publier-une-app-thefront.md) publier sur TheFront | plateforme |
| tourner les clés d'éditeur TheFront | [`howto-29`](services-disponibles/howto-29-rotation-publisher-keys-thefront.md) rotation des clés TheFront | plateforme |
| enrôler un mini-hub | [`howto-32`](services-disponibles/howto-32-enroler-un-minihub.md) enrôler un mini-hub | plateforme |
| installer l'app sur un mini-hub | [`howto-33`](services-disponibles/howto-33-installer-une-app-sur-minihub.md) app sur mini-hub | plateforme |
| installer un Hub neuf | [`howto-17`](services-disponibles/howto-17-deployer-en-production.md) déployer en production | plateforme |
| restaurer une sauvegarde | [`howto-18`](services-disponibles/howto-18-restaurer-backup.md) restaurer un backup | plateforme |

> **Aucune ligne ne répond ?** Le service existe peut-être sans guide : le §22.A de
> `CATALOGUE-FONCTIONS-TSH.md` (même dossier) recense les fonctions du Hub qui n'ont pas encore de
> HowTo. Sinon, la brique porte `NON COUVERT` dans la table de routage de M6, avec sa raison.
