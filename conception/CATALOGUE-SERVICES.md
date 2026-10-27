<!-- KIT-VERSION: 1.11.2 -->
# Catalogue des services du Hub — de la brique au guide

> **À quoi ça sert** : au plan technique (M6, §3 bis), chaque brique cherche d'abord si son besoin
> est un service que le Hub rend déjà. Cette table répond sans quitter le kit : un besoin, un guide
> `howto-NN`, que la brique cite dans la table de routage.
>
> **Source canonique** : `docs/02-DocHub/use-cases/` (44 guides, index `00-index.md`). Copie livrée
> avec le squelette : `APP-ZZ-TEMPLATE/docs/services-disponibles/`, celle que lit
> `controle-avant-go.sh`. Recensé le 2026-10-27 ; la source fait foi — si elle a grandi, ajouter
> la ligne ici.
>
> Ce qui reste à écrire dans l'app se route ensuite vers les 148 fiches de mécanismes
> (`APP-ZZ-TEMPLATE/docs/use-cases/INDEX.md`).

Colonne **Côté** : `app` = une brique de M6 consomme ce service ; `plateforme` = geste
d'administration du Hub ou de livraison, utile en M7 mais qu'aucune brique ne réimplémente.

### Identité et accès

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| comptes, rôles, scopes, clé d'API utilisateur | `howto-08` créer un utilisateur IAM | app |
| SSO entre apps (modes none / gate / optional / required) | `howto-09` SSO multi-app | app |
| connecter une app externe en OIDC (code flow + PKCE, JWKS) | `howto-10` OIDC provider | app |
| tenants : création, suspension, quotas, audit de cohérence | `howto-34` gérer les tenants IAM | app |
| tourner secrets, mots de passe, clés, jetons sans coupure | `howto-19` rotation des secrets | plateforme |

### Exposer et appeler des API

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| publier une API à des tiers (`/<api>/v1/…`, clés `apim_*`) | `howto-30` publier une API APIM | app |
| une règle de décision appliquée à la passerelle | `howto-31` règle JDM APIM | app |
| tarifer et facturer l'usage d'une API | `howto-35` wallet et facturation APIM | app |
| donner une entrée API à un programme, avec repli sur 429/5xx | `howto-36` programme en API + repli Janino | app |
| une clé pour appeler un LLM ou toute API APIM | `howto-39` provisionner une clé APIM | app |
| appeler un LLM (providers, quotas, tenant) | `howto-27` passerelle AgentIA | app |
| exposer ses actions à un agent (agrégation MCP) | `howto-13` MCPagger | app |

### Messagerie et événements

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| publier des événements | `howto-37` publier sur NATS | app |
| consommer des événements (durable, ack, idempotence) | `howto-38` consommer depuis NATS | app |
| créer, inspecter, purger un stream | `howto-23` streams NATS | plateforme |
| faire dialoguer deux sessions d'agent, ou un agent et un humain | `howto-41` salons | app |
| automatiser une tâche récurrente ou sur événement | `howto-42` Alfred | app |

### Courrier, calendrier, antivirus

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| envoyer ou recevoir du courrier (domaines, DKIM, boîtes) | `howto-11` James | app |
| scanner les pièces jointes, quarantaine | `howto-21` scan ClamAV | app |
| calendrier et carnet d'adresses (CalDAV / CardDAV) | `howto-22` Cosmo | app |

### Fichiers, édition, signature

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| stocker des fichiers, URL présignées, quotas, partages | `howto-16` stockage S3 | app |
| éditer un document Office dans le navigateur | `howto-14` OnlyOffice | app |
| faire signer un document | `howto-15` signature DocuSeal | app |

### Mise en ligne, TLS, cache, protection

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| un domaine de marque et une route vers l'app | `howto-43` domaine et app en ligne | plateforme |
| un certificat TLS automatique | `howto-12` ACME | plateforme |
| un cache HTTP (TTL par hôte, purge) | `howto-20` cache | app |
| savoir ce que le filtre anti-scan bloque, et ce qu'il ne protège pas | `howto-40` ScanGuard | plateforme |

### Construire et faire vivre l'app

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| créer l'app de zéro (arborescence, manifeste, front, Dockerfile) | `howto-24` app from scratch | app |
| monter la version du socle ou du front | `howto-25` upgrader une app | app |
| intégrer un socle-pack (IA, pipeline, tenant…) | `howto-28` intégrer un socle-pack | app |
| ajouter une fonctionnalité au Hub lui-même | `howto-01` ajouter une fonctionnalité | plateforme |
| corriger un bug | `howto-02` corriger un bug | plateforme |
| suivre la fabrication de l'app (salon, dossier TheDash, tableaux) | `howto-44` suivre la fabrication | plateforme |

### Livrer et exploiter

| Ma brique a besoin de… | Guide | Côté |
|---|---|---|
| installer l'app sur le Hub | `howto-03` installer une app | plateforme |
| la mettre à jour, avec retour arrière | `howto-04` mettre à jour une app | plateforme |
| la désinstaller proprement | `howto-05` désinstaller une app | plateforme |
| publier ses images (mode éditeur, signature) | `howto-06` publier une app | plateforme |
| ajouter une source de dépôt distante | `howto-07` source repository | plateforme |
| publier une app TheFront signée | `howto-26` publier sur TheFront | plateforme |
| tourner les clés d'éditeur TheFront | `howto-29` rotation des clés TheFront | plateforme |
| enrôler un mini-hub | `howto-32` enrôler un mini-hub | plateforme |
| installer l'app sur un mini-hub | `howto-33` app sur mini-hub | plateforme |
| installer un Hub neuf | `howto-17` déployer en production | plateforme |
| restaurer une sauvegarde | `howto-18` restaurer un backup | plateforme |

> **Aucune ligne ne répond ?** Le service existe peut-être sans guide : le §22.A de
> `CATALOGUE-FONCTIONS-TSH.md` (même dossier) recense les fonctions du Hub qui n'ont pas encore de
> HowTo. Sinon, la brique porte `NON COUVERT` dans la table de routage de M6, avec sa raison.
