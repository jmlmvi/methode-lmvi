# TSH — Catalogue des fonctions mutualisées, et leur couverture par les HowTo

> **Ce que ce document est** : l'inventaire de tout ce qu'une application — ou un opérateur, ou un
> agent — peut **consommer** de TheSocleHub sans l'écrire elle-même. Extrait **du code**, pas de la
> documentation : c'est la liste contre laquelle on mesure les HowTo, et non une liste tirée des
> HowTo.
>
> **Ce qu'il n'est pas** : un mode d'emploi. Chaque fonction renvoie vers son HowTo quand il existe,
> vers sa fiche institutionnelle sinon.
>
> **État de référence** — code `soclehub/` sur `main` au commit `090aa38` (2026-10-11), Hub
> **3.70.0**, Spring Boot 4.0.6, Java 21 GraalVM CE. Les comptes d'exécution viennent de la
> **production** (`status_dashboard_worker.get_all_workers_status`, relevé le 2026-10-16).
> ⚠️ `main` est en retard sur la prod : une fonction livrée en prod et non mergée n'est pas ici.
>
> **Annexe** : [[CATALOGUE-ANNEXE-ACTIONS-MCP|les 475 actions, worker par worker, avec leurs
> paramètres]].

---

## 1. Les trois guichets

Une fonction mutualisée du Hub s'atteint par l'un de trois guichets. Confondre les trois est la
première cause de HowTo faux, parce que les droits, le format et les pièges n'y sont pas les mêmes.

| Guichet | Ce qu'on y trouve | Volume | Qui l'utilise |
|---|---|---|---|
| **MCP** (`/mcp`) | les actions de workers — `worker__action` | **534 outils** | agents IA, sessions Claude, `deliver.sh` |
| **REST + portail** | API d'app (`/api/**`), écrans d'admin (`/hub/**`), protocoles (WOPI, OIDC, A2A, gRPC) | **592 routes** sur **100 contrôleurs** | apps, front TheFront, navigateurs, pairs |
| **Plan de requête** | ce qui s'applique **sans être appelé** : filtres, SSO, RLS tenant, APIM, ScanGuard, cache | 10 filtres ordonnés + 3 greffons | toute requête entrante |

Le troisième guichet est celui que les HowTo oublient le plus : ce sont des fonctions qu'on **active
par configuration**, pas par appel, et dont on ne découvre l'existence qu'en tombant dessus.

### Réconciliation des comptes — pourquoi 534 et pas 475

Le Hub publie **534 outils MCP**. Ils se décomposent ainsi, et le compte tombe juste, ce qui atteste
que l'inventaire est complet :

| Origine | Workers | Actions |
|---|--:|--:|
| Workers **du Hub** (code `soclehub/`) déclarant des actions | 45 | 475 |
| Workers **du framework** socle-v005 (TechDB, HTTP, licence, bases, contrôle) | 12 | +59 |
| **Total publié en MCP** | **57** | **534** |

Les 70 workers que fait tourner le Hub se répartissent en 57 qui alimentent le registre d'actions et
13 qui n'en alimentent pas — ceux-là ne déclarent rien du tout (pure mécanique, §21).

> ✅ **Corrigé le 2026-10-16 — ce paragraphe disait autre chose.** Jusqu'au Hub **3.70.0**, le compte
> était de **503 outils / 55 workers** : `alfred_admin` (27 actions) et `mcpagger_aggregator_worker`
> (4) déclaraient des actions **sans jamais être exposés**, soit 31 manquantes. Cause établie puis
> corrigée : un `Worker` qui injecte `WorkerActionRegistry` à la construction déclenche le
> `@PostConstruct` du registre, lequel s'indexe par `getBeansOfType(Worker.class)` — où Spring
> écarte en silence un singleton en cours de création. Le worker s'excluait lui-même.
> Livré en **Hub 3.70.1** (déploiement du 2026-10-16) puis à la racine en **socle 5.9.4**
> (Hub 3.70.3). Mesuré : 534 / 57, et `alfred_admin__list_tasks` répond. Voir la fiche
> `soclehub/docs/bugsExplicite/003-ActionsWorkerDeclareesNonExposeesEnMCP.md` et la sonde
> permanente `soclehub/docker/sondes-james/08-actions-mcp.sh`.

---

## 2. Lecture d'ensemble — où est la masse

| Domaine | Actions MCP | Workers | Couverture HowTo |
|---|--:|--:|---|
| [Mail, calendrier, réputation](#3-mail-calendrier-réputation--102-actions) | 102 | 6 | 🟡 3 HowTo pour 102 actions |
| [Identité, tenants, accès](#4-identité-tenants-accès--48-actions) | 48 | 1 | 🟡 4 HowTo, la moitié des actions hors champ |
| [Réseau, noms, certificats](#5-réseau-noms-certificats-sortie--42-actions) | 42 | 6 | 🟡 1 HowTo (ACME) |
| [Données, cache, sauvegarde](#6-données-cache-sauvegarde--32-actions) | 32 | 3 | ✅ 3 HowTo |
| [Cycle de vie des apps](#7-cycle-de-vie-des-apps--30-actions) | 30 | 4 | ✅ 5 HowTo |
| [Fichiers, édition, preuve](#8-fichiers-édition-signature-preuve--30-actions) | 30 | 4 | 🟡 3 HowTo, TSA non documenté |
| [Exécution distribuée](#9-exécution-distribuée--minihub-miniminihub-gardien--28-actions) | 28 | 5 | 🟡 2 HowTo, mMH et Gardien absents |
| [Automatisation (Alfred)](#10-automatisation--alfred--27-actions-non-exposées) | 27 | 1 | ❌ aucun |
| [Collaboration (salons)](#11-collaboration--salons--26-actions) | 26 | 2 | ❌ aucun |
| [Sécurité applicative](#12-sécurité-applicative--scanguard-clamav--25-actions) | 25 | 2 | 🟡 1 HowTo (ClamAV mail) |
| [IA (AgentIA)](#13-ia--passerelle-agentia--22-actions) | 22 | 1 | 🟡 2 HowTo |
| [Supervision, état, pont](#14-supervision-état-pont--18-actions) | 18 | 3 | ❌ aucun |
| [Messagerie (NATS)](#15-messagerie--nats-jetstream--15-actions) | 15 | 1 | ✅ 3 HowTo |
| [APIM](#16-apim--10-actions-mais-115-routes) | 10 | 2 | ✅ 5 HowTo |
| [MCP (agrégation, proxy)](#17-mcp--agrégation-et-proxy--10-actions) | 10 | 2 | 🟡 1 HowTo |
| [Secrets (Vault)](#18-secrets--vault--9-actions) | 9 | 1 | 🟡 1 HowTo (rotation) |
| [Exploitation (MOP)](#19-exploitation-et-socle-technique--framework--1--59-actions) | 1 + 59 | 1 + 12 | ❌ quasi aucun |

**Lecture** : les domaines nés tôt (apps, données, APIM, NATS) sont couverts ; ceux nés en 2026
(salons, Alfred, supervision externe, miniMiniHub, Gardien, domaines multi-fournisseurs) ne le sont
pas. Le mail est l'anomalie inverse : 102 actions, trois HowTo, et c'est le domaine le plus actif en
production (7 561 cycles `james_worker`).

---

## 3. Mail, calendrier, réputation — 102 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Serveur mail complet (domaines, DKIM, MX direct/relay, boîtes, quotas, mobileconfig) | `james_worker` (53) | H11 | ✅ |
| Envoi applicatif + **gabarits d'e-mail** (`upsert_email_template`, `upsert_email_layout`, `preview`, `send_templated_email`) | `mail_worker` (11) | — | ❌ les gabarits ne sont nulle part |
| Scan antivirus des pièces jointes entrantes | `mail_attachment_worker` (7) | H21 | ✅ |
| **TLS de James réconcilié automatiquement** (`james_tls_probe/reconcile`) | `james_tls_worker` (3) | — | ❌ |
| **Chauffe de réputation d'expéditeur** (comptes, cibles, paliers, relevé, rapport) | `warmup_worker` (13) | — | ❌ domaine entier non documenté |
| Calendriers et carnets CalDAV/CardDAV partagés | `cosmo_worker` (15) | H22 | ✅ |
| Règles d'enrichissement / routage, fetchmail, migration de boîte | `james_worker` | — | 🟡 cité, pas déroulé |
| Réputation : `check_blacklist`, `get_reputation_report`, `get_inbound_recommendations` | `james_worker` | — | 🟡 |
| Boîtes des salons provisionnées à la demande | `salon_mail_worker` (3) | — | ❌ |
| Profil mail utilisateur, écrans `/hub/james` (32 routes), `/hub/mail` (9) | portail | — | 🟡 |

**Trous nets** : la chauffe (warmup), les gabarits d'e-mail, le TLS James, la migration de boîtes.

---

## 4. Identité, tenants, accès — 48 actions

`iam_worker` est le worker le plus dense du Hub, et le moins découpé en HowTo.

| Fonction mutualisée | Actions | HowTo | État |
|---|---|---|---|
| Utilisateurs, rôles, scopes | `create_user`, `lock_user`, `assign_role`, `create_role`, `assign_scope_to_role`, `remove_scope_from_role`… | H08 | ✅ |
| Clés d'API IAM (≠ clés APIM) | `create_api_key`, `create_my_api_key`, `list_api_keys`, `revoke_api_key` | H08, H39 | ✅ (H39 explique pourquoi ne pas les confondre) |
| Tenants : cycle de vie | `create/update/activate/suspend/restore/delete_tenant` | H34 | ✅ |
| Tenants : **fiche société** (SIREN, établissements) | `get/upsert_tenant_fiche`, `import_tenant` | — | ❌ |
| Tenants : **membres et médias** (logo, photos) | `list/upsert/remove_tenant_membre`, `set_tenant_logo`, `set_tenant_membre_photo`, `list_tenant_medias` | — | ❌ |
| Tenants : **règles d'adressage mail** | `list/add/set_enabled/test_tenant_rule` | — | ❌ |
| Accès croisés utilisateur ↔ tenant ↔ app | `grant/revoke_tenant_access`, `grant_app_access`, `list_user_tenants`, `list_tenant_users` | H34 | 🟡 |
| Audit de cohérence | `tenant_consistency_audit`, `bootstrap_tenants_from_users` | H34 | 🟡 |
| Clients OIDC enregistrés | `list_oidc_clients`, `revoke_oidc_client` | H10 | 🟡 révocation non traitée |
| SSO transparent inter-apps (4 modes) | filtre `SsoFilter` + `proxy_worker.enable_sso` | H09 | ✅ |
| Hub **fournisseur OIDC** (code flow + PKCE, JWKS) | `OidcController` (14 routes) | H10 | ✅ |
| Identité de l'appelant | `get_my_identity`, `/api/iam/me` | — | 🟡 |
| RLS par tenant pour les apps TheFront | `TenantContextFilter`, `TenantRlsHelper` | — | ❌ (institutional 92) |

**Trou net** : tout le volet « fiche d'entreprise » du tenant (fiche, membres, médias, règles) — 14
actions, 21 routes REST (`/api/iam/tenant/**`), un écran, zéro HowTo.

---

## 5. Réseau, noms, certificats, sortie — 42 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Certificats ACME automatiques (DNS-01) | `acme_worker` (6) | H12 | ✅ |
| DNS multi-fournisseur (OVH, Cloudflare, Hostinger, Infomaniak) | `dns_sync_worker` (11) + `dns/provider/` | — | 🟡 H12 n'en montre qu'un |
| **Noms de domaine comme objets du Hub** (registre, hôtes, jeton DNS, résolution) | `domain_worker` (11) | — | ❌ |
| Reverse-proxy dynamique, routes, santé, SSO par route | `proxy_worker` (9) + `DynamicProxyFilter` | — | ❌ aucun HowTo proxy |
| **Proxy de sortie** mutualisé (IP de sortie stable, mots de passe) | `egress_proxy_worker` (4), `egress_probe_worker` (1) | — | ❌ |
| Redirection HTTPS, HTTP/2, SNI | `HttpsRedirectFilter`, `TomcatSslConfig` | — | 🟡 |
| Tunnel WebSocket/gRPC vers les mini-hubs | `minihub/egress/` | H32 | 🟡 |

**Trou net** : `proxy_worker` et `domain_worker` — le cœur du routage et des noms — n'ont **aucun**
HowTo, alors que toute mise en ligne passe par eux.

---

## 6. Données, cache, sauvegarde — 32 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Schéma PostgreSQL provisionné par app | `db_worker.create_app_schema` | H03, H24 | ✅ |
| Base MySQL/MariaDB provisionnée | `db_worker.create_mysql_db` | — | 🟡 |
| **Redis mutualisé** : allocation d'un index par app | `db_worker.list_redis_allocations`, `flush_redis_db` | H20 | 🟡 le cache est documenté, l'allocation non |
| Cache HTTP L1 (RAM) + L2 (Redis), purge sélective | `cache_worker` (6) | H20 | ✅ |
| Sauvegarde : destinations, planifications, exécutions, purge | `backup_worker` (14) | H18 | ✅ |
| Sauvegarde/restauration d'une base d'app | `db_worker.backup_app_db`, `restore_backup` | H18 | ✅ |
| Cibles de sauvegarde découvertes automatiquement | `list_database_targets`, `refresh_targets` | — | 🟡 |
| Bases exposées en lecture SQL directe (MCP) | `postgresql_database`, `mariadb_database`, `h2_database` (framework) | — | ❌ |
| OLAP embarqué (DuckDB) | `DuckDbOlapEngine` | — | ❌ |

---

## 7. Cycle de vie des apps — 30 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Installer / mettre à jour / désinstaller une app | `docker_worker` + `pipeline/App*Pipeline` | H03, H04, H05 | ✅ |
| Catalogue d'apps et sources distantes | `app_registry_worker` (4), `catalog_sync_worker` (3) | H07 | ✅ |
| Publier une version (éditeur), manifeste, signature | `repository_editor_worker` (6) | H06 | ✅ |
| Images tierces importées du catalogue | `import_thirdparty_from_catalog`, `validate_thirdparty_images` | — | ❌ |
| Variables d'environnement, mémoire, journaux, stats du conteneur | `docker_worker.set_env_var`, `set_memory_limit`, `get_logs`… | H04 | 🟡 |
| Créer une app Socle de zéro / l'upgrader / y intégrer un pack | templates + `socle-pack-*` | H24, H25, H28 | ✅ |
| Publier une app TheFront signée Ed25519, roter les clés | `/api/apps`, `/api/publishers` | H26, H29 | ✅ |

C'est le domaine le mieux couvert — et le plus ancien.

---

## 8. Fichiers, édition, signature, preuve — 30 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Stockage S3/MinIO : parcours, dépôt, URL présignée, quotas, partages, corbeille | `storage_worker` (10) | H16 | ✅ |
| Édition collaborative Office (protocole WOPI) | `onlyoffice_worker` (5) + `WopiController` | H14 | ✅ |
| Signature électronique (DocuSeal) | `signature_worker` (10) | H15 | ✅ |
| **Horodatage qualifié + ancrage blockchain** | `tsa_worker` (5) | — | ❌ cité par H15, jamais déroulé |
| Pièces jointes de salon versionnées et éditables | `salon_worker.salon_attachment_*` | — | ❌ |

---

## 9. Exécution distribuée — miniHub, miniMiniHub, Gardien — 28 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Enrôler un mini-hub (PKI Vault, identité, heartbeat) | `minihub_registry_worker` (4) + `/api/minihub` | H32 | ✅ |
| Installer une app sur un mini-hub | `DistributedInstallService` | H33 | ✅ |
| Exécuter une commande sur un mini-hub | `minihub_exec_worker.minihub_exec` | — | 🟡 |
| **Poser / mettre à jour / détruire un miniMiniHub**, travaux par lots | `miniminihub_deploy_worker` (13) | — | ❌ |
| **Actions d'un mMH appelées depuis le Hub** | `mmh_list_actions`, `mmh_invoke_action` | — | ❌ |
| Jetons de pose, révocation | `create/list/revoke_install_token` | — | ❌ |
| **Gardien** : jetons, rapports, ordres, approbations, alertes, salon | `gardien_worker` (9) + console WebSocket | — | ❌ |
| Console distante et observabilité | `minihub/console/`, `minihub/observability/` | — | ❌ |
| gRPC inter-socle (admin, contrôle, capacités, proxy, observabilité) | `minihub/grpc/` (5 services) | — | ❌ (institutional 140) |

**Trou net** : le miniMiniHub et le Gardien — deux chantiers 2026 entiers — n'ont aucun HowTo.

---

## 10. Automatisation — Alfred — 27 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Tâches en langage naturel (CRON / EVENT / MANUAL), budget, délai, quota horaire | `alfred_admin` 🔴 | — | ❌ |
| Listes blanches d'actions autorisées à l'agent | `create/update/delete/list_whitelist` 🔴 | — | ❌ |
| Veilles : boîte mail (E1), KvBus (E2), file JetStream (E4) | `add_mail_watch`, `add_kvbus_watch`, `add_queue_watch` 🔴 | — | ❌ |
| Kill-switch global, paramètres runtime | `pause_all`, `resume_all`, `update_setting` 🔴 | — | ❌ |
| Fédération A2A entre agents (carte d'agent, JSON-RPC) | `alfred/a2a/`, `/hub/alfred/a2a` (13 routes) | — | ❌ |
| Flux d'exécution en direct (SSE) | `AlfredStreamController` | — | ❌ |

> ✅ **Débloqué le 2026-10-16.** Ce paragraphe disait : « les 27 actions sont déclarées et non
> publiées en MCP (fiche bug 003), un HowTo écrit aujourd'hui serait injouable tel quel ». Elles le
> sont désormais — Hub **3.70.1**, mesuré à 534 outils, `alfred_admin__list_tasks` répond en lecture
> et en écriture. **Alfred est documentable.** Les 🔴 ci-dessus ne marquent plus qu'une absence de
> HowTo, pas une action injouable.

---

## 11. Collaboration — salons — 26 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Salons d'échange entre sessions MCP (créer, rejoindre, poster, lire, attendre) | `salon_worker` | — | ❌ |
| Attente bloquante côté agent (`salon_wait`) et réveil par NATS | `salon/notify/` | — | ❌ |
| Pièces jointes : dépôt, URL, lecture, **édition**, versions, archive | `salon_attachment_*` | — | ❌ |
| Types de salon (modèles, droits) | `salon_type_*`, `salon_set_type` | — | ❌ |
| **Une adresse mail par salon**, relève automatique | `salon_mail_worker` | — | ❌ |
| Écrans `/hub/salons` (14 routes) | portail | — | ❌ |

**Domaine entier sans HowTo**, alors qu'il est le canal d'échange entre agents et qu'un skill
(`/salons`) s'appuie dessus.

---

## 12. Sécurité applicative — ScanGuard, ClamAV — 25 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Blocage des scanners (motifs base + regex intégré, catégories, exceptions, top hits) | `scan_guard_worker` (13) + `BotnetScanFilter` | — | ❌ (institutional 46) |
| Désactivation temporisée auditée | `disable_temporarily`, `enable_now` | — | ❌ |
| Antivirus à la demande sur octets | `clamav_worker.scan_bytes` | H21 | 🟡 H21 ne traite que le mail |
| Quarantaine : lister, relire, relâcher, supprimer | `clamav_worker` | H21 | 🟡 |
| Signatures : état, rechargement forcé | `get_signature_info`, `force_reload_signatures` | — | ❌ |
| ScanGuard appliqué **dans la passerelle APIM** | `apim/filter/ApimScanGuardHandler` | — | ❌ |
| API REST ScanGuard (`/api/security/scan-guard`, 7 routes) et écran (9) | — | — | ❌ |

**Trou net** : ScanGuard, qui protège tout le Hub et que les apps peuvent appeler, n'a pas de HowTo.

---

## 13. IA — passerelle AgentIA — 22 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Fournisseurs LLM déclarés (Anthropic natif, OpenAI-compat, vLLM) | `upsert_provider`, `list_providers` | H27 | ✅ |
| Provisionnement d'un tenant, rotation, révocation | `provision_tenant`, `rotate_tenant`, `revoke_tenant` | H27 | ✅ |
| Quotas et tarification par tenant | `set_quota`, `set_pricing`, `list_pricing` | H27 | 🟡 |
| Tarifs synchronisés depuis OpenRouter | `pricing_sync_worker` | — | ❌ |
| **Outils déclarés à la passerelle** (`list_tools`, `upsert_tool`) | `agentia_worker` | — | ❌ |
| Apps enregistrées, sessions, consommation | `register_app`, `list_sessions`, `get_usage_summary` | — | 🟡 |
| Passerelle `/api/agentia/v1/*` (compatible OpenAI) | `AgentIaGatewayController` | H27 | ✅ |
| Clé APIM pour qu'une app appelle un LLM | `apim_provisioning_worker.create_api_key` | H39 | ✅ |

---

## 14. Supervision, état, pont — 18 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| **Supervision externe** : sources déclarées, jetons frappés, balayage, alertes, règles | `supervision_externe_worker` (15) | — | ❌ |
| Blocs d'installation à poser chez le supervisé | `blocs_installation` | — | ❌ |
| Lecteurs spécialisés (WordPress, générique) | `supervision/WordpressLecteur` | — | ❌ |
| État de tous les workers, stats du tableau de bord | `status_dashboard_worker` (framework) | — | ❌ |
| **Pont de sessions** (Bridge) : connexions, événements SSE | `bridge_session_worker`, `/hub/bridge`, `BridgeEventsController` | — | ❌ (institutional 49) |
| Journal d'actions, d'API, d'événements, de logs | `techdb_reader_worker` (framework, 8) | — | ❌ |
| Rapport d'erreurs avec seuil | `error_report_worker` (framework) | — | ❌ |

---

## 15. Messagerie — NATS JetStream — 15 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Administrer les flux (créer, purger, inspecter, consommateurs) | `nats_worker` | H23 | ✅ |
| Publier depuis une app (sujets dérivés, DLQ) | `socle_publish`, `SocleNatsPublisher` | H37 | ✅ |
| Consommer depuis une app (consumer durable, ack) | `socle_consume`, `socle_ack` | H38 | ✅ |
| Provisionnement automatique des flux | `nats_provision_worker` (sans action) | H37 | 🟡 |
| API REST de flux (`/api/nats/v1`, 5 routes) | `NatsFlowController` | — | 🟡 |

Domaine **complet et bien couvert** — le modèle à suivre : une fonction, trois angles
(administration, production, consommation).

---

## 16. APIM — 10 actions, mais 115 routes

L'APIM est l'inverse du reste : peu d'actions MCP, énormément de surface REST et de plan de requête.

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Publier une API (wizard, DNS + ACME + activation) | `provision_api`, `/api/apim/admin/wizard` | H30, H36 | ✅ |
| Frapper / lister / révoquer une **vraie clé APIM** | `apim_provisioning_worker` | H39 | ✅ |
| Scopes et RBAC par API | `/api/apim/admin/scopes` (8), `ScopeMatcher` | H30 | 🟡 |
| Limitation de débit et quotas par palier | `ApimRateLimitService` | — | 🟡 (institutional 123) |
| Portefeuille, tarification, facturation à l'usage, Stripe | `apim/wallet`, `apim/billing` (9 routes) | H35 | ✅ |
| Règles JDM appliquées à la passerelle, repli Janino | `apim/jdm`, `ApimJaninoRunner` | H31, H36 | ✅ |
| Certificats personnalisés par API | `apim/cert` (7 routes) | — | ❌ |
| JWT d'identité signé vers le backend, JWKS | `apim/jwt` | — | ❌ |
| Coupe-circuit par backend | `apim/circuit` | — | ❌ |
| Détection d'OpenAPI du backend | `apim/openapi` (4 routes) | — | ❌ |
| Portail du consommateur (`/portal/apim`, `/api/apim/me`) | 24 routes | — | 🟡 |

---

## 17. MCP — agrégation et proxy — 10 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Le Hub comme **agrégateur MCP unique** pour un agent | `/mcp`, `OidcMcpAuthFilter`, `McpToolAuthorization` | H13 | ✅ |
| Proxy vers les serveurs MCP des apps (`appId__tool`) | `mcp_proxy_worker` (6) | H13 | ✅ |
| Agrégation des **spécifications** OpenAPI des apps | `mcpagger_aggregator_worker` (4) | H13 | 🟡 exposé depuis 3.70.1, absent du HowTo |
| Catalogue d'apps MCP des mini-hubs | `minihub/mcp/` | — | 🟡 |
| Contrat Hub↔app `tools2use` | — | — | ❌ |

---

## 18. Secrets — Vault — 9 actions

| Fonction mutualisée | Surface | HowTo | État |
|---|---|---|---|
| Chemin de secrets par app, jeton dédié | `create_app_path`, `delete_app_path` | H03, H19 | ✅ |
| Lire / écrire / supprimer un secret | `set_secret`, `get_secret`, `get_secret_keys` | H19 | ✅ |
| Renouveler le jeton | `renew_token` | H19 | ✅ |
| **Audit des bundles d'app** | `audit_app_bundles` | — | ❌ |
| Accès Vault **depuis l'app** (`/api/apps/vault`) | `AppVaultController` | H24 | 🟡 |
| PKI Vault pour les mini-hubs | `VaultPkiClient` | H32 | 🟡 |

---

## 19. Exploitation et socle technique (framework) — 1 + 59 actions

Ces fonctions viennent du framework socle-v005, pas du code du Hub — mais le Hub les expose, donc
une app ou un opérateur les consomme.

| Fonction mutualisée | Worker | Actions | HowTo |
|---|---|--:|---|
| Redémarrer un worker sans redémarrer le conteneur | `mop_worker` | 1 | ❌ |
| Journal d'actions, d'API, d'événements, de logs, états des workers | `techdb_reader_worker` | 8 | ❌ |
| Export/restauration de la TechDB (SQL, CSV, staging) | `techdb_backup_worker` | 9 | ❌ |
| Purge de la TechDB | `techdb_purge_worker` | 3 | ❌ |
| Serveur HTTP : connexions, drain gracieux, stats | `http_worker` | 6 | ❌ |
| Mode de fonctionnement (contrôle) | `control_worker` | 3 | ❌ |
| Maintenance planifiée | `maintenance_worker` | 3 | ❌ |
| Rapport d'erreurs avec seuil | `error_report_worker` | 4 | ❌ |
| État de tous les workers / tableau de bord | `status_dashboard_worker` | 2 | ❌ |
| Licence : enregistrement, heartbeat, état | `license_guard` | 4 | ❌ |
| SQL direct PostgreSQL / MariaDB / H2 | `*_database` | 17 | ❌ |

**59 actions, aucun HowTo.** Ce sont pourtant les outils du premier diagnostic.

---

## 20. Plan de requête — les fonctions qu'on n'appelle pas

Elles s'appliquent à toute requête, dans cet ordre, et ne s'activent que par configuration.

| Ordre | Filtre | Ce qu'il fait | HowTo |
|--:|---|---|---|
| HIGHEST | `HttpsRedirectFilter` | force HTTPS | ❌ |
| HIGHEST | `BotnetScanFilter` | ScanGuard : coupe les scanners | ❌ |
| +5 | `ApiAuthFilter` | authentifie les appels `/api/**` | 🟡 H08 |
| +5 | `RequestIdFilter` | pose l'identifiant de requête (MDC) | ❌ |
| +5 | `ApimFilter` | passerelle APIM complète (auth, scopes, quota, JDM, coupe-circuit, facturation) | ✅ H30 |
| +5 | `DomainContextFilter` | résout le domaine de marque servi | ❌ |
| +10 | `DynamicProxyFilter` | route vers l'app cible, cache L1/L2 | 🟡 H20 |
| +10 | `TenantContextFilter` | pose le tenant et le RLS PostgreSQL | ❌ |
| +15 | `RateLimitFilter` | limite de débit TheFront | ❌ |
| +50 | `OidcMcpAuthFilter` | authentifie `/mcp` (OIDC ou clé) | ✅ H13 |
| — | `SsoFilter` | SSO transparent, 4 modes par route | ✅ H09 |
| — | `IdempotencyInterceptor` | rejoue sans effet de bord | ❌ |
| — | `McpToolAuthorization` | filtre les outils MCP selon les droits | 🟡 H13 |

**Treize fonctions de plan de requête, sept sans aucune documentation d'usage.**

---

## 21. Workers sans action — la mécanique invisible

Treize workers tournent sans rien exposer. Ils n'ont pas d'API, mais leur **existence** est une
information : ce qu'ils font, personne n'a besoin de le déclencher, et donc personne ne le
surveille.

| Worker | Ce qu'il fait tout seul |
|---|---|
| `alfred_event`, `alfred_executor`, `alfred_queue`, `alfred_scheduler`, `alfred_health_bridge` | moteur d'Alfred (déclenchement, exécution, file, santé) |
| `warmup_metrics_worker`, `warmup_planner_worker`, `warmup_releve_worker`, `warmup_sender_worker` | moteur de chauffe de réputation |
| `minio_provision_worker` | crée les buckets des apps |
| `nats_provision_worker` | crée les flux et consommateurs des apps |
| `minihub_snapshot_poller`, `miniminihub_catalog_poller` | relèvent l'état des hubs distants |
| `error_purge_worker` (framework, cron 3 h) | purge les erreurs |

---

## 22. Synthèse — les trous de HowTo, classés

### A. Domaines entiers sans aucun HowTo (à créer)

| Domaine | Actions | Pourquoi ça compte |
|---|--:|---|
| **Salons** (y compris pièces jointes et mail par salon) | 26 | canal d'échange entre agents, un skill s'appuie dessus |
| **Supervision externe** | 15 | surveillance de la flotte et des sites clients |
| **miniMiniHub** (pose, lots, actions distantes, jetons) | 13 | chantier 2026 livré, piloté à l'aveugle |
| **Chauffe de réputation (warmup)** | 13 | conditionne la délivrabilité de tout le mail sortant |
| **ScanGuard** | 13 | protège tout le Hub, appelable par les apps |
| **Domaines (`domain_worker`)** | 11 | toute mise en ligne passe par là |
| **Proxy (`proxy_worker`)** | 9 | idem |
| **Gardien** | 9 | sécurité de l'exécution distribuée |
| **Vault : audit des bundles** | 1 | la seule façon de voir les apps en Vault dégradé |
| **Socle technique (TechDB, HTTP, MOP, licence, SQL)** | 59 | les outils du premier diagnostic |
| **Alfred** | 27 | exposé depuis 3.70.1 — plus rien ne bloque l'écriture |

### B. HowTo existants à élargir (le sujet est traité, la fonction dépasse le HowTo)

| HowTo | Ce qui manque |
|---|---|
| H08 / H34 (IAM, tenants) | fiche société, membres, médias, règles d'adressage, révocation de client OIDC |
| H11 (James) | migration de boîte, règles d'enrichissement, fetchmail, réputation, TLS réconcilié |
| H12 (ACME) | les trois autres fournisseurs DNS (OVH, Hostinger, Infomaniak) |
| H13 (MCPagger) | agrégation des spécifications (non exposée), contrat `tools2use` |
| H15 (signature) | horodatage TSA et ancrage blockchain |
| H16 (storage) | pièces jointes de salon versionnées |
| H20 (cache) | allocation d'un index Redis par app |
| H21 (ClamAV) | scan à la demande hors mail, signatures, ScanGuard dans l'APIM |
| H27 (AgentIA) | outils déclarés à la passerelle, tarifs OpenRouter |
| H30 → H36 (APIM) | certificats personnalisés, JWT d'identité, coupe-circuit, détection OpenAPI |
| H32 / H33 (miniHub) | console distante, gRPC, observabilité |
| H04 (mise à jour d'app) | mémoire, variables, journaux du conteneur |
| H18 (backup) | découverte automatique des cibles |
| H19 (secrets) | audit des bundles Vault |

### C. Incohérences repérées au passage (à traiter en phase 2)

1. ✅ **Résolu le 2026-10-16** — `alfred_admin` (27) et `mcpagger_aggregator_worker` (4)
   déclaraient des actions jamais publiées en MCP (fiche bug 003). Corrigé en Hub **3.70.1**, cause
   racine en **socle 5.9.4** (Hub 3.70.3), sonde permanente `08-actions-mcp.sh`. Le compte est passé
   de 503 / 55 à **534 / 57**.
2. **`00-index.md` annonce « 35 HOWTOs » et un état de référence « Hub 3.12.1 / socle 5.8.0 vérifié
   le 2026-06-22 »** ; il y a **39 fichiers** et le Hub est en **3.70.0**. L'index est à refaire.
3. ✅ **Tranché le 2026-10-16** — **287 actions sur 475 ne déclarent pas `readOnly`**, et le défaut
   du framework est **`false`** : vérifié au bytecode de `socle-v005-5.9.4.jar`, le constructeur
   `ActionMetadata$Builder()` initialise le champ à `iconst_0`. Ces 287 actions sont donc traitées
   comme des **écritures**. Le défaut est le bon sens : il sous-estime les droits. Conséquence
   concrète, documentée dans [[howto-42-alfred-automatiser-une-tache|HOWTO 42]] §5 : le marqueur
   `@readonly` d'une liste blanche Alfred ne retient que les 188 actions qui déclarent la lecture,
   et les lectures non déclarées doivent être nommées une par une.
4. **`mop_worker`, `alfred_*`, `catalog_sync_worker`, `repository_editor_worker`,
   `egress_proxy_worker` sont `stopped` en production** : leurs actions sont documentables mais
   injouables en l'état. À vérifier avant d'écrire.

---

## 23. Phase 2 — ce qui reste à faire

Ce document répond à « **qu'est-ce qui existe** ». Restent deux questions, dans cet ordre :

1. **Les HowTo existants sont-ils en phase avec le code ?** Relire les 39 fichiers contre les actions
   et routes réelles : nom d'action disparu ou renommé, paramètre devenu obligatoire, route changée,
   version de référence périmée (l'index annonce 3.12.1, le code est en 3.70.0 — l'écart est de
   quatre mois).
2. **Quels HowTo écrire d'abord ?** Trier §22.A par ce qui est à la fois livré, allumé en production
   et consommé par une app réelle.

---

## 24. Comment ce document a été construit

Reproductible, et à régénérer après chaque livraison :

```bash
# 1. les workers qui déclarent des actions
cd soclehub/src/main/java/eu/lmvi/soclehub
grep -rl "List<ActionMetadata> getActions" .          # → 45 fichiers

# 2. les actions, leurs paramètres, leur readOnly  → annexe
python3 extract_actions.py . <fichiers> > actions.json
python3 gen_annexe.py                                  # → CATALOGUE-ANNEXE-ACTIONS-MCP.md

# 3. la surface REST
python3 extract_routes.py .                            # → 100 contrôleurs, 592 routes

# 4. la vérité de production (prod > main)
mcp__soclehub__status_dashboard_worker__get_all_workers_status   # → 70 workers
```

Les scripts sont vendorisés dans **`tools/catalogue-fonctions/`** (avec leur mode d'emploi). Le
garde-fou : le total des actions du Hub plus celui du framework doit retomber sur le nombre d'outils
publiés en MCP — s'il ne retombe pas, un motif d'écriture des actions a échappé à l'extracteur, ou
un worker ne s'expose plus.

---

**Voir aussi** — [[00-index|l'index des HowTo]] ·
[[CATALOGUE-ANNEXE-ACTIONS-MCP|l'annexe des 475 actions]] ·
`institutional/00-index.md` pour la référence technique par worker.
