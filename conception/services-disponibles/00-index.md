# SocleHub — HOWTOs : Index

> Index de la section `use-cases/`. **45 HOWTOs** avec code complet (zéro pseudo-code), section « Pièges courants » obligatoire en fin de chaque fichier. Liens Obsidian `[[fiche|titre]]`.
>
> **État de référence** : Hub **3.70.3** / framework **socle-v005 5.9.4** / Java 21 GraalVM CE — vérifié au code et **mesuré en production** le 2026-10-16.
> Les domaines d'exemple utilisent la convention staging `*.thesocle.net`.
>
> ⚠️ **Cet index annonçait « 35 HOWTOs » et un état de référence « Hub 3.12.1 / socle 5.8.0 vérifié
> le 2026-06-22 » alors qu'il y avait 39 fichiers et que le Hub était en 3.70.x** — quatre mois de
> dérive. Recalé le 2026-10-16. Les sept fiches 36 à 42 n'y figuraient pas.
>
> **Ce qui existe mais n'a encore aucun HowTo** est recensé au §22.A de
> [[CATALOGUE-FONCTIONS-TSH|le catalogue des fonctions mutualisées]], qui réconcilie les 534 outils
> MCP publiés avec leur couverture documentaire. C'est la liste de travail, et elle est tenue à
> jour.

---

## Méta — Travailler sur le Hub

| HOWTO | Description |
|---|---|
| [[howto-01-ajouter-une-fonctionnalite\|HOWTO 01 — Ajouter une fonctionnalité]] | Action sur worker existant, nouveau worker, endpoint REST, écran portal Thymeleaf, filtre servlet. Pièges + checklist avant push. |
| [[howto-02-corriger-un-bug\|HOWTO 02 — Corriger un bug]] | Triage, reproduction, isolation cause, catégories de bugs typiques, patterns de fix, validation, documentation. |

---

## Lifecycle d'apps (côté admin Hub)

| HOWTO | Description |
|---|---|
| [[howto-03-installer-une-app\|HOWTO 03 — Installer une app]] | `docker_worker/install_app` — pipeline d'install, autofill data-driven (db.* / redis.* / vault.*), modes SSO. |
| [[howto-04-mettre-a-jour-une-app\|HOWTO 04 — Mettre à jour une app]] | Nouveau tag Docker — pipeline update avec rollback automatique, préservation volumes. |
| [[howto-05-desinstaller-une-app\|HOWTO 05 — Désinstaller une app]] | Désinstallation propre — option `purge` volumes, cleanup DNS/Vault/proxy, orphan check. |

---

## Développer une app sur le Socle (côté développeur)

| HOWTO | Description |
|---|---|
| [[howto-24-creer-une-app-socle-from-scratch\|HOWTO 24 — Créer une app Socle from scratch]] | App V005 de A à Z — arborescence, `pom.xml`, `Application.java`, choix template Worker, `manifest.json`, frontend React, Dockerfile, packaging. |
| [[howto-25-upgrader-une-app-socle\|HOWTO 25 — Upgrader une app Socle]] | Bump du framework / `V005-FrontendShell` — ré-installation Maven, adaptation code, frontend, migrations SQL, nouveau tarball. |
| [[howto-28-integrer-un-socle-pack-dans-une-app\|HOWTO 28 — Intégrer un socle-pack dans une app]] | Choix du pack, dep Maven, schéma PG, Vault, env vars, build, déploiement, MCP refresh, premier appel. |

---

## Repository Platform

| HOWTO | Description |
|---|---|
| [[howto-06-publier-une-app-editeur\|HOWTO 06 — Publier une app (éditeur)]] | Mode `editor` — push registry htpasswd, `publish_version`, vérification digest, signature Ed25519. |
| [[howto-07-ajouter-une-source-repository\|HOWTO 07 — Ajouter une source repository]] | Mode `client` — source distante (URL + clé publique TOFU), tags + couleurs, sync 6 h. |

---

## Identité, SSO, OIDC, Tenants

| HOWTO | Description |
|---|---|
| [[howto-08-creer-utilisateur-iam\|HOWTO 08 — Créer un utilisateur IAM]] | User IAM (BCrypt), role + scopes, API key (SHA-256). |
| [[howto-09-configurer-sso-multi-app\|HOWTO 09 — SSO multi-app]] | SSO transparent inter-app via cookie cross-subdomain, 4 modes (none/gate/optional/required). |
| [[howto-10-configurer-oidc-provider\|HOWTO 10 — OIDC Provider]] | SocleHub comme OIDC Provider — registration client, code flow + PKCE S256, JWKS. |
| [[howto-34-gerer-les-tenants-iam\|HOWTO 34 — Gérer les tenants IAM]] | Création / suspension / quotas tenants, StrictMode, audit de cohérence, IHM `/hub/iam/tenants`. |

---

## Mail, Calendrier, Antivirus

| HOWTO | Description |
|---|---|
| [[howto-11-configurer-james-mail\|HOWTO 11 — Configurer James / mail]] | Apache James — provision, domaines, DKIM (TXT DNS), MX direct/relay, mailboxes, IAM sync. |
| [[howto-21-clamav-mail-scan\|HOWTO 21 — Scan ClamAV des mails]] | Scan antivirus pièces jointes — IMAP READ_ONLY → S3 → ClamAV → quarantine, NATS publish. |
| [[howto-22-cosmo-calendrier\|HOWTO 22 — Cosmo : calendrier]] | CalDAV/CardDAV via Cosmo — provision compte, sync IAM, Thunderbird/Apple Calendar, iCal injection. |

---

## Sécurité du plan de requête

| HOWTO | Description |
|---|---|
| [[howto-40-scanguard-proteger-le-hub\|HOWTO 40 — ScanGuard]] | Les deux jeux de motifs (12 catégories câblées + motifs en base) et leur ordre, désactivation temporisée bornée, exceptions par hôte. **Dit aussi les trois endroits où le ScanGuard ne protège rien** — mesuré. **[3.70.1]** |

---

## Collaboration & automatisation

| HOWTO | Description |
|---|---|
| [[howto-41-salons-echanger-entre-sessions\|HOWTO 41 — Salons]] | Faire dialoguer deux sessions MCP : curseurs, attente serveur réveillée par `LISTEN`/`NOTIFY` (< 100 ms mesuré), pièces jointes versionnées et scannées, entrée d'un humain par mail. **[3.70.1]** |
| [[howto-42-alfred-automatiser-une-tache\|HOWTO 42 — Alfred]] | Confier une tâche à l'agent sans lui donner les clés : listes blanches, `@readonly`, liste d'interdits, quatre garde-fous, veilles E1/E2/E4. **Les 27 actions n'étaient pas exposées avant 3.70.1.** **[3.70.1]** |

---

## TLS, DNS, Cache

| HOWTO | Description |
|---|---|
| [[howto-43-mettre-un-domaine-et-une-app-en-ligne\|HOWTO 43 — Mettre un domaine et une app en ligne]] | La chaîne complète : registre des domaines (11 actions) puis table de routage (9 actions) — **deux registres indépendants que rien ne réconcilie**. Dit pourquoi `update_route` modifie une route au hasard sur les 12 apps multi-route, et pourquoi `health_check_all` est un faux vert. **[3.70.1]** |
| [[howto-12-configurer-acme-cloudflare\|HOWTO 12 — ACME / Cloudflare]] | Cert ACME Let's Encrypt — flow DNS-01 via Cloudflare, stockage Vault, cycle 24 h. |
| [[howto-20-configurer-cache\|HOWTO 20 — Configurer le cache]] | Cache HTTP L1 (RAM) + L2 (Redis) — TTL par hostname, purge sélective, quand utiliser/éviter. |

---

## Stockage, Édition, Signature

| HOWTO | Description |
|---|---|
| [[howto-14-onlyoffice-edition\|HOWTO 14 — Édition OnlyOffice]] | Protocole WOPI (CheckFileInfo, GetFile, PutFile, callback), JWT WOPI + JWT editor config. |
| [[howto-15-signature-docuseal\|HOWTO 15 — Signature DocuSeal]] | Submission, archive S3, download URL, blockchain anchor optionnel. |
| [[howto-16-storage-s3-quotas\|HOWTO 16 — Storage S3 & quotas]] | MinIO — browse, upload, presigned URLs, quotas user, partage de dossiers, purge trash. |

---

## MCP, NATS

| HOWTO | Description |
|---|---|
| [[howto-13-utiliser-mcpagger\|HOWTO 13 — Utiliser MCPagger]] | Hub comme MCP aggregator — auth OIDC ou MCP_API_KEY, `tools/list` agrégés, préfixe `appId__toolName`. |
| [[howto-23-nats-streams\|HOWTO 23 — NATS streams]] | NATS JetStream — streams provisionnés, créer/peek/publier/purger. |
| [[howto-37-publier-des-messages-nats-depuis-une-app\|HOWTO 37 — Publier des messages NATS]] | Côté producteur : sujets dérivés, stream auto-créé, `js.publish` + `PublishAck`, DLQ, variante APIM. |
| [[howto-38-consommer-des-messages-nats-depuis-une-app\|HOWTO 38 — Consommer des messages NATS]] | Côté consommateur : consumer durable auto-provisionné, sémantique de l'ack, fan-out vs scale-out, idempotence. |

---

## TheFront

| HOWTO | Description |
|---|---|
| [[howto-26-publier-une-app-thefront\|HOWTO 26 — Publier une app TheFront]] | keypair Ed25519, enregistrement clé publique, signature OpenSSL, `POST /api/apps/{id}/manifest/publish`, vérification. |
| [[howto-29-rotation-publisher-keys-thefront\|HOWTO 29 — Rotation publisher keys TheFront]] | Rotation Ed25519 avec grâce 90 j ou immédiate (clé compromise), cron `PublisherKeyExpiryJob`. |

---

## AgentIA Gateway

| HOWTO | Description |
|---|---|
| [[howto-27-configurer-agentia-gateway\|HOWTO 27 — Configurer AgentIA Gateway]] | Provider LLM + provisioning tenant + quotas + premier appel `/api/agentia/v1/chat/completions` (Anthropic native, OpenAI compat, vLLM Spark `glm47`). |

---

## Décider sur un texte (KEV)

| HOWTO | Description |
|---|---|
| [[howto-45-classer-un-texte-avec-kev\|HOWTO 45 — Classer un texte avec KEV]] | Rubrique, catégorie, routage, oui/non : `choisir` / `oui_non` / `noter` / `decider` par l'APIM, deux moteurs (Spark 9B, nas4 4B). **La règle de l'écart au-delà de trois options** (le seuil de 0,80 y envoie tout en revue — mesuré), plugin WordPress complet, repli quand le moteur tombe. **Publié en recette (`.net`) seulement au 2026-10-28.** |

---

## APIM (API Management)

| HOWTO | Description |
|---|---|
| [[howto-30-publier-une-api-apim\|HOWTO 30 — Publier une API via le wizard APIM]] | Publication d'une API via le wizard APIM, endpoints `/<api>/v1/...`, clés `apim_<env>_<hex>`. |
| [[howto-31-creer-une-regle-jdm-apim\|HOWTO 31 — Créer une règle JDM APIM]] | Création et publication d'une règle JDM (expressionNode) appliquée à la gateway APIM. |
| [[howto-35-configurer-le-wallet-et-la-facturation-apim\|HOWTO 35 — Wallet & facturation APIM]] | Configuration du portefeuille, tarification et facturation à l'usage d'une API publiée. |
| [[howto-36-exposer-un-programme-en-api-avec-repli-janino\|HOWTO 36 — Exposer un programme en API + repli Janino]] | De zéro à une entrée APIM complète pour un programme HTTP, puis script Janino de repli sur 429/5xx. **[3.20.0]** |
| [[howto-39-provisionner-une-cle-apim-pour-une-app\|HOWTO 39 — Provisionner une clé APIM pour une app]] | Côté consommateur : frapper la clé `apim_prod_<40hex>`, scope, Vault, injection dans l'app, preuve depuis le conteneur. Pourquoi `create_api_key` ne convient pas. |

---

## Minihub (exécution distribuée)

| HOWTO | Description |
|---|---|
| [[howto-32-enroler-un-minihub\|HOWTO 32 — Enrôler un mini-hub]] | Enrôlement d'un minihub, Vault PKI `pki-minihub`, identité persistée, heartbeat + command stream. |
| [[howto-33-installer-une-app-sur-minihub\|HOWTO 33 — Installer une app sur un mini-hub]] | `POST /api/minihub/install` (DistributedInstallService) — déploiement sur box distante. |

---

## Opérations

| HOWTO | Description |
|---|---|
| [[howto-17-deployer-en-production\|HOWTO 17 — Déployer en production]] | Déploiement du Hub depuis zéro — StarterPack, `.env`, premier boot, premier déploiement d'app, validation. |
| [[howto-18-restaurer-backup\|HOWTO 18 — Restaurer un backup]] | Restauration — DB Postgres, Vault, MinIO, recover cert ACME si IP change, validation post-restore. |
| [[howto-19-rotation-secrets\|HOWTO 19 — Rotation des secrets]] | Rotation en production — Vault tokens, BCrypt passwords, API keys, JWT keypair, sans coupure. |

---

## Navigation rapide par problématique

| Besoin | HOWTO(s) |
|---|---|
| Coder une nouvelle feature | [[howto-01-ajouter-une-fonctionnalite\|HOWTO 01]] |
| Fixer un bug | [[howto-02-corriger-un-bug\|HOWTO 02]] |
| Première install Hub (serveur neuf, StarterPack) | [[howto-17-deployer-en-production\|HOWTO 17]] |
| **Monter de version un Hub qui tourne** | **la skill `devops`** (`.claude/skills/devops/` + `references/runbook-hub.md`) — pas un HOWTO : rayon de souffle, sauvegarde de la config cible, canary, vérification post-bascule, rollback |
| Installer une app | [[howto-03-installer-une-app\|HOWTO 03]] |
| Mettre à jour / désinstaller une app | [[howto-04-mettre-a-jour-une-app\|HOWTO 04]], [[howto-05-desinstaller-une-app\|HOWTO 05]] |
| Créer une app from scratch | [[howto-24-creer-une-app-socle-from-scratch\|HOWTO 24]] |
| Upgrader le code source d'une app | [[howto-25-upgrader-une-app-socle\|HOWTO 25]] |
| Publier ses propres apps | [[howto-06-publier-une-app-editeur\|HOWTO 06]], [[howto-07-ajouter-une-source-repository\|HOWTO 07]] |
| Login / identité | [[howto-08-creer-utilisateur-iam\|HOWTO 08]], [[howto-19-rotation-secrets\|HOWTO 19]] |
| SSO multi-app | [[howto-09-configurer-sso-multi-app\|HOWTO 09]] |
| Connecter une app externe en SSO | [[howto-10-configurer-oidc-provider\|HOWTO 10]] |
| Gérer les tenants | [[howto-34-gerer-les-tenants-iam\|HOWTO 34]] |
| Mail entrant/sortant | [[howto-11-configurer-james-mail\|HOWTO 11]] |
| Cert TLS auto | [[howto-12-configurer-acme-cloudflare\|HOWTO 12]] |
| Brancher un agent IA sur le Hub | [[howto-13-utiliser-mcpagger\|HOWTO 13]] |
| Édition Office | [[howto-14-onlyoffice-edition\|HOWTO 14]] |
| Signature électronique | [[howto-15-signature-docuseal\|HOWTO 15]] |
| Quotas storage / partages | [[howto-16-storage-s3-quotas\|HOWTO 16]] |
| Restauration backup | [[howto-18-restaurer-backup\|HOWTO 18]] |
| Optimiser le cache | [[howto-20-configurer-cache\|HOWTO 20]] |
| Antivirus pièces jointes | [[howto-21-clamav-mail-scan\|HOWTO 21]] |
| Calendrier collaboratif | [[howto-22-cosmo-calendrier\|HOWTO 22]] |
| NATS streams (administration) | [[howto-23-nats-streams\|HOWTO 23]] |
| Publier / consommer NATS depuis une app | [[howto-37-publier-des-messages-nats-depuis-une-app\|HOWTO 37]], [[howto-38-consommer-des-messages-nats-depuis-une-app\|HOWTO 38]] |
| Publier une app TheFront signée | [[howto-26-publier-une-app-thefront\|HOWTO 26]], [[howto-29-rotation-publisher-keys-thefront\|HOWTO 29]] |
| Configurer le LLM Gateway AgentIA | [[howto-27-configurer-agentia-gateway\|HOWTO 27]] |
| Classer un texte (rubrique d'article, routage de ticket, oui/non) sans LLM | [[howto-45-classer-un-texte-avec-kev\|HOWTO 45]] |
| Intégrer un socle-pack dans une app | [[howto-28-integrer-un-socle-pack-dans-une-app\|HOWTO 28]] |
| Publier / tarifer une API APIM | [[howto-30-publier-une-api-apim\|HOWTO 30]], [[howto-31-creer-une-regle-jdm-apim\|HOWTO 31]], [[howto-35-configurer-le-wallet-et-la-facturation-apim\|HOWTO 35]] |
| Donner sa propre entrée API à un programme, avec repli | [[howto-36-exposer-un-programme-en-api-avec-repli-janino\|HOWTO 36]] |
| Donner à une app une clé pour appeler un LLM (ou toute API APIM) | [[howto-39-provisionner-une-cle-apim-pour-une-app\|HOWTO 39]] |
| Enrôler / déployer sur un minihub | [[howto-32-enroler-un-minihub\|HOWTO 32]], [[howto-33-installer-une-app-sur-minihub\|HOWTO 33]] |
| Comprendre ce qui bloque les scans — et ce qui n'est pas protégé | [[howto-40-scanguard-proteger-le-hub\|HOWTO 40]] |
| Faire dialoguer deux sessions d'agent, ou un agent et un humain | [[howto-41-salons-echanger-entre-sessions\|HOWTO 41]] |
| Automatiser une tâche récurrente ou événementielle | [[howto-42-alfred-automatiser-une-tache\|HOWTO 42]] |
| Mettre un domaine de marque et une app en ligne | [[howto-43-mettre-un-domaine-et-une-app-en-ligne\|HOWTO 43]] |
| Suivre la fabrication d'une app (salon + dossier TheDash + 4 tableaux) | [[howto-44-suivre-la-fabrication-dune-app\|HOWTO 44]] |
| Savoir quelles fonctions du Hub n'ont PAS de HowTo | [[CATALOGUE-FONCTIONS-TSH\|Catalogue]] §22 |

---

## Autres sections

- **Inventaire des fonctions mutualisées et de leur couverture** : [[CATALOGUE-FONCTIONS-TSH|CATALOGUE-FONCTIONS-TSH.md]] + [[CATALOGUE-ANNEXE-ACTIONS-MCP|l'annexe des 475 actions]]
- Référence technique exhaustive : [[00-index|institutional/00-index.md]]
- Onboarding agent IA : [[00-INDEX|agent-guide/00-INDEX.md]]
