# TSH — Annexe : toutes les actions MCP, worker par worker

> Annexe générée **depuis le code** de `soclehub/` (voir [[CATALOGUE-FONCTIONS-TSH|le catalogue]] pour la lecture par domaine et la couverture HowTo).
> Ne pas éditer à la main : régénérer.
>
> **475 actions** déclarées par **45 workers** du Hub. Les workers du framework socle-v005 (TechDB, HTTP, licence, bases) sont dans le catalogue, pas ici.

Colonnes : **L** = `readOnly` — `✓` lecture seule, `✗` écriture, `?` non déclaré dans le code (287 actions sur 475 : le défaut du framework s'applique). **Paramètres** — `*` = obligatoire.

## `apim_provisioning_worker` — 8 actions

Domaine : APIM · cadence : `PASSIVE` · source : `soclehub/.../apim/provisioning/ApimProvisioningWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `provision_api` | ? | Provisionne une Published API (DNS + ACME + activation). Async, retourne immédiatement avec job_id. | `api_id`* |
| `retry_provisioning` | ? | Relance le provisioning d'une API en échec. | `api_id`* |
| `rollback_provisioning` | ? | Rollback complet d'un provisioning : supprime DNS, archive l'API. Irréversible. | `api_id`* |
| `get_status` | ✓ | Statut du worker (jobs actifs + stats). | — |
| `create_api_key` | ? | Frappe une VRAIE clé APIM (format apim_<env>_<40hex>), avec son propriétaire, son tenant, ses scopes et son tier. La clé brute n'est rendue QU'UNE FOIS : le Hub n'en garde que l'empreinte SHA-256. À ne pas confondre avec iam_worker.create_api_key, qui émet un UUID sans scopes que la passerelle rejette en 401. ATTENTION : la clé brute figure dans le journal des actions du Hub — la traiter comme un secret exposé. | `key_name`*, `scopes`*, `tenant`*, `user`, `tier`, `expires_in_days`, `allowed_ips`, `env`, `force` |
| `list_api_keys` | ? | Liste les clés APIM — jamais leur valeur, que leurs droits. Sans filtre : toutes les clés non révoquées. | `tenant`, `user`, `include_revoked` |
| `revoke_api_key` | ? | Révoque une clé APIM et vide le cache de la passerelle — effet immédiat. | `key_id`* |
| `list_api_scopes` | ✓ | Les scopes réellement ouverts par les API publiées — ce qu'on peut mettre dans une clé, et rien d'autre. | — |

## `pricing_sync_worker` — 2 actions

Domaine : APIM · cadence : `POLLING` · source : `soclehub/.../worker/PricingSyncWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `sync_now` | ✗ | Force la sync OpenRouter immédiatement (bypasse l'intervalle 23h) | — |
| `get_status` | ✓ | Stats du worker : dernière sync, modèles synchronisés, erreurs | — |

## `alfred_admin` — 27 actions  ✅ exposé en MCP depuis le Hub 3.70.1 (fiche bug 003 — l'était pas avant)

Domaine : Automatisation · cadence : `PASSIVE` · source : `soclehub/.../alfred/worker/AlfredAdminWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `create_task` | ✗ | Crée une tâche Alfred (langage naturel + déclencheur). | `task_name`*, `prompt`*, `trigger_type`*, `cron_expr`, `whitelist`, `max_steps`, `budget_tokens`, `timeout_seconds`, `max_runs_per_hour`, `notify_on_error`, `created_by`, `expires_at` |
| `update_task` | ✗ | Met à jour une tâche existante. | `task_id`*, `prompt`, `cron_expr`, `whitelist`, `enabled` |
| `pause_task` | ✗ | Désactive une tâche. | `task_id`* |
| `resume_task` | ✗ | Réactive une tâche. | `task_id`* |
| `delete_task` | ✗ | Supprime (soft) une tâche. | `task_id`* |
| `run_now` | ✗ | Exécute immédiatement une tâche. | `task`*, `context` |
| `abort_run` | ✗ | Interrompt un run en cours (F10). | `run`* |
| `skip_next` | ✗ | Saute la prochaine occurrence CRON d'une tâche. | `task_id`* |
| `list_tasks` | ✓ | Liste les tâches. | `filter` |
| `get_task` | ✓ | Détail d'une tâche. | `task`* |
| `list_runs` | ✓ | Liste les runs. | `task`, `status`, `limit` |
| `get_run` | ✓ | Détail d'un run (+ steps). | `run`*, `with_steps` |
| `get_stats` | ✓ | Statistiques (tokens/runs/erreurs). | `period` |
| `create_whitelist` | ✗ | Crée une whitelist custom. | `whitelist_name`*, `whitelist_description`, `actions`* |
| `update_whitelist` | ✗ | Met à jour une whitelist custom. | `whitelist_id`*, `actions`, `whitelist_description` |
| `delete_whitelist` | ✗ | Supprime une whitelist custom. | `whitelist_id`* |
| `list_whitelists` | ✓ | Liste les whitelists. | — |
| `add_mail_watch` | ✗ | Surveille une boîte mail (E1). | `mailbox`*, `poll_seconds`, `task`, `whitelist` |
| `add_queue_watch` | ✗ | Autorise une queue JetStream (E4). | `queue_subject`*, `consumer_name`, `whitelist` |
| `add_kvbus_watch` | ✗ | Surveille un topic KvBus (E2). | `topic_pattern`*, `payload_filter`, `task`, `whitelist` |
| `update_watch` | ✗ | Active/désactive un watch. | `type`*, `id`*, `enabled` |
| `remove_watch` | ✗ | Supprime un watch. | `type`*, `id`* |
| `list_watches` | ✓ | Liste les watches. | `type` |
| `pause_all` | ✗ | Kill-switch logique : suspend tout déclenchement. | — |
| `resume_all` | ✗ | Reprend les déclenchements. | — |
| `get_settings` | ✓ | Lit les paramètres runtime (F12). | — |
| `update_setting` | ✗ | Modifie un paramètre runtime (F12). | `setting_key`*, `setting_value`* |

## `salon_mail_worker` — 3 actions

Domaine : Collaboration · cadence : `n/d` · source : `soclehub/.../salon/worker/SalonMailWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | État de la relève des boîtes mail des salons : compteurs, domaine, dernière erreur | — |
| `poll_now` | ? | Relever tout de suite les boîtes des salons (sans attendre le cycle d'une minute) ; crée au passage les boîtes manquantes | `salon_code` |
| `provision` | ? | Créer (ou recréer après échec) la boîte mail d'un salon et rendre son adresse ou le motif d'échec | `salon_code`* |

## `salon_worker` — 23 actions

Domaine : Collaboration · cadence : `PASSIVE` · source : `soclehub/.../salon/worker/SalonWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `salon_create` | ? | Ouvrir un salon d'échange et obtenir son code court à transmettre à une autre session. Le salon reçoit aussi une adresse mail (mail_address) : tout mail qui y arrive est versé dans le fil, pièces jointes comprises, avec author_role=EXTERNAL | `title`*, `session_name`*, `topic`, `type` |
| `salon_list` | ? | Lister les salons avec participants, volume et signal de question en attente. Filtrable par nature (type) pour ne regarder que les salons d'applications, de supervision, etc. | `status`, `type`, `limit`, `session_name` |
| `salon_join` | ? | Rejoindre un salon en choisissant de reprendre depuis le début ou de démarrer à partir de maintenant | `salon_code`*, `session_name`*, `mode` |
| `salon_post` | ? | Écrire dans un salon. Utiliser le rôle QUESTION quand une réponse est attendue | `salon_code`*, `session_name`*, `body`*, `role`, `reply_to_seq`, `attachment_ids` |
| `salon_attach` | ? | Déposer une pièce jointe (contenu en base64, max 8 Mo) dans un salon : scan antivirus puis dépôt MinIO. Rend un attachment_id à passer ensuite à salon_post. ⚠️ Un salon ne se supprime pas : n'y déposer aucun secret | `salon_code`*, `session_name`*, `filename`*, `content_base64`*, `content_type` |
| `salon_attach_url` | ? | Ouvrir un dépôt direct pour une pièce volumineuse : rend une URL présignée PUT vers MinIO. Le fichier ne passe pas par MCP. Confirmer ensuite avec salon_attach_confirm | `salon_code`*, `session_name`*, `filename`*, `content_type` |
| `salon_attach_confirm` | ? | Confirmer un dépôt direct : mesure la taille et l'empreinte réelles, scanne l'objet, et rend la pièce publiable | `attachment_id`* |
| `salon_attachments` | ? | Lister les pièces jointes d'un salon : nom, taille, type, auteur, message d'origine et verdict antivirus | `salon_code`* |
| `salon_attachment_url` | ? | Obtenir une URL de téléchargement à durée limitée pour une pièce jointe | `attachment_id`* |
| `salon_attachment_read` | ? | Lire le contenu d'une pièce jointe TEXTE (markdown, txt, json…) pour pouvoir la corriger. Rend le texte tel quel et son numéro de version | `attachment_id`* |
| `salon_attachment_edit` | ? | Modifier une pièce jointe : nouveau texte, ou nouveau contenu binaire en base64 (image annotée, fichier remplacé). La version précédente est CONSERVÉE et reste consultable — rien n'est écrasé. La pièce apparaît « modifiée » dans le salon | `attachment_id`*, `session_name`*, `text`, `content_base64`, `content_type`, `how` |
| `salon_attachment_versions` | ? | Historique d'une pièce jointe : ce que chaque modification a remplacé, par qui et comment | `attachment_id`* |
| `salon_attachments_archive` | ? | Récupérer TOUTES les pièces jointes d'un salon en une archive zip, rendue par URL à durée limitée | `salon_code`* |
| `salon_read` | ? | Lire les messages d'un salon depuis un curseur ; avance le curseur de la session | `salon_code`*, `session_name`, `since_seq`, `limit` |
| `salon_wait` | ? | Attendre le prochain message du salon (attente longue côté serveur, rend la main dès réception) | `salon_code`*, `session_name`*, `timeout_seconds` |
| `salon_participants` | ? | Lister les participants d'un salon avec leur rôle, leur mode d'inscription et leur retard de lecture | `salon_code`* |
| `salon_close` | ? | Clore un salon — écriture refusée ensuite, lecture toujours possible | `salon_code`*, `session_name` |
| `salon_type_list` | ? | Lister les natures de salon disponibles (APPLICATION, REUNION, SUPERVISION, CHANTIER, AUTRE, et celles ajoutées depuis), avec le nombre de salons de chacune | `include_inactive` |
| `salon_type_create` | ? | Ajouter une nature de salon au référentiel — elle devient aussitôt utilisable par salon_create et salon_list | `code`*, `label`, `description`, `color`, `sort_order` |
| `salon_type_update` | ? | Modifier une nature de salon : libellé, description, couleur, rang, activation. Le code ne se modifie pas — les salons s'y réfèrent | `code`*, `label`, `description`, `color`, `sort_order`, `active` |
| `salon_type_delete` | ? | Supprimer une nature ajoutée. Refusé sur un type livré avec le Hub (le désactiver) et sur un type encore porté par des salons (les déplacer d'abord) | `code`* |
| `salon_set_type` | ? | Changer la nature d'un salon existant | `salon_code`*, `type`* |
| `get_status` | ✓ | État du worker Salons : salons ouverts, attentes en cours, mode de réveil | — |

## `app_registry_worker` — 4 actions

Domaine : Cycle de vie des apps · cadence : `PASSIVE` · source : `soclehub/.../worker/AppRegistryWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_catalog` | ✓ | Lister toutes les applications du catalogue | — |
| `get_app_info` | ? | Obtenir les details complets d'une application par son appId | `app_id`* |
| `refresh_catalog` | ✗ | Recharger le fichier catalog.json depuis le disque | — |
| `get_status` | ✓ | Retourner la version du catalogue et le nombre d'applications | — |

## `catalog_sync_worker` — 3 actions

Domaine : Cycle de vie des apps · cadence : `n/d` · source : `soclehub/.../worker/CatalogSyncWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `force_sync` | ✗ | Force une synchronisation immédiate de toutes les sources de catalog | — |
| `get_sources` | ✓ | Liste les sources de repository configurées | — |
| `get_status` | ✓ | Retourne les stats de synchronisation | — |

## `docker_worker` — 17 actions

Domaine : Cycle de vie des apps · cadence : `n/d` · source : `soclehub/.../worker/DockerWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `install_app` | ? | Installer une nouvelle application depuis le catalogue : provisionner la BDD, les secrets, le conteneur Docker, le DNS et la route proxy | `app_id`*, `catalog_app_id`*, `subdomain`*, `docker_tag`, `tenant` |
| `start_app` | ? | Demarrer le conteneur d'une application arretee | `app_id`* |
| `stop_app` | ? | Arreter le conteneur d'une application en cours d'execution | `app_id`* |
| `restart_app` | ? | Redemarrer le conteneur d'une application (arret + demarrage) | `app_id`* |
| `update_app` | ? | Mettre a jour une application vers un nouveau tag d'image Docker | `app_id`*, `new_tag`* |
| `uninstall_app` | ? | Desinstaller completement une application : arreter le conteneur, supprimer le DNS, la BDD, les secrets. Option de purge des volumes Docker. | `app_id`*, `purge` |
| `list_apps` | ✓ | Lister toutes les applications installees | — |
| `get_app` | ? | Obtenir les informations detaillees d'une application specifique | `app_id`* |
| `get_logs` | ? | Recuperer les logs du conteneur d'une application | `app_id`*, `lines` |
| `get_stats` | ? | Obtenir les statistiques de ressources du conteneur (CPU, memoire, reseau) d'une application | `app_id`* |
| `set_env_var` | ? | Definir une variable d'environnement pour le conteneur d'une application | `app_id`*, `key`*, `value`* |
| `list_env_vars` | ? | Lister les variables d'environnement d'une application | `app_id`* |
| `get_memory_config` | ? | Obtenir la configuration memoire d'une application : runtime, limites du catalogue, variables d'environnement Vault, limite memoire Docker | `app_id`* |
| `set_memory_limit` | ? | Definir la limite memoire d'une application : met a jour la variable d'environnement runtime (JAVA_OPTS, NODE_OPTIONS, etc.) dans Vault et redemarre le conteneur | `app_id`*, `memory_mb`* |
| `get_memory_usage` | ? | Obtenir l'utilisation memoire en temps reel du conteneur d'une application | `app_id`* |
| `get_all_memory` | ✓ | Obtenir un apercu de l'utilisation memoire pour toutes les applications et services d'infrastructure | — |
| `get_status` | ✓ | Retourner le statut du worker Docker et les statistiques resumees | — |

## `repository_editor_worker` — 6 actions

Domaine : Cycle de vie des apps · cadence : `n/d` · source : `soclehub/.../worker/RepositoryEditorWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `regenerate_manifest` | ✗ | Régénère le manifest depuis les tables repository.* et le signe Ed25519 | — |
| `publish_version` | ✗ | Publie une nouvelle version (internal ou thirdparty). Auto-fetch digest si absent. Auto-create app si absente. | — |
| `import_thirdparty_from_catalog` | ✗ | Migration one-shot : importe toutes les entrées appType=thirdparty du /app/catalog.json dans repository.*. Idempotent. | — |
| `validate_thirdparty_images` | ✗ | Re-vérifie le digest courant de chaque version thirdparty et met à jour validation_status. Idempotent. | — |
| `get_access_log` | ✓ | Retourne les N dernières entrées d'access_log | — |
| `get_status` | ✓ | Stats de l'éditeur repository | — |

## `backup_worker` — 14 actions

Domaine : Données · cadence : `PASSIVE` · source : `soclehub/.../worker/BackupWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_destinations` | ✓ | Liste des destinations S3 enregistrees | — |
| `create_destination` | ? | Cree une destination S3 (credentials stockes dans Vault, jamais en DB) | `name`*, `endpoint`*, `region`, `bucket`*, `path_prefix`, `access_key`*, `secret_key`*, `ssl_verify` |
| `delete_destination` | ? | Supprime une destination S3 + ses credentials Vault | `x_id`* |
| `test_destination` | ? | Teste qu'une destination est accessible (P4: verifie credentials Vault, P7: ping S3 reel) | `x_id`* |
| `list_schedules` | ✓ | Liste des schedules cron enregistres | — |
| `create_schedule` | ? | Cree un schedule cron | `name`*, `cron_expression`*, `id_s3_destinations`*, `retention_days`, `include_postgres`, `include_mariadb`, `include_vault`, `include_config`, `include_minio`, `include_techdb`, `include_sqlite`, `include_volumes` |
| `delete_schedule` | ? | Supprime un schedule | `x_id`* |
| `list_runs` | ? | Liste des derniers runs | `limit` |
| `get_run` | ? | Detail d'un run avec ses items | `x_id`* |
| `run_now` | ? | Lance un backup manuel synchrone via le daemon Go | `id_s3_destinations`, `include_postgres`, `include_mariadb`, `include_vault`, `include_config`, `include_minio`, `include_techdb`, `include_sqlite`, `include_volumes` |
| `list_database_targets` | ✓ | Liste des cibles DB auto-decouvertes (postgres/mariadb/h2/sqlite) | — |
| `refresh_targets` | ✗ | Re-scanne le serveur pour decouvrir les cibles DB et upsert dans backup.z_database_targets | — |
| `get_status` | ✓ | Statut du worker + ping daemon Go | — |
| `purge_old_runs` | ? | Purge les runs et objets S3 plus anciens que retention_days (sauf is_locked=true) | `retention_days`*, `dry_run`, `max_runs` |

## `cache_worker` — 6 actions

Domaine : Données · cadence : `PASSIVE` · source : `soclehub/.../worker/CacheWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `cache_stats` | ✓ | Obtenir les statistiques du cache (taux de succes, entrees, tailles L1/L2) | — |
| `cache_purge_app` | ? | Purger toutes les entrees en cache pour une application | `app_id`* |
| `cache_purge_path` | ? | Purger un chemin specifique en cache pour une application | `app_id`*, `path`* |
| `cache_purge_all` | ✗ | Purger l'integralite du cache (L1 + L2) | — |
| `cache_configure` | ? | Modifier le TTL du cache pour une application | `app_id`*, `page_ttl`, `asset_ttl` |
| `get_status` | ✓ | Obtenir le statut du worker cache | — |

## `db_worker` — 12 actions

Domaine : Données · cadence : `n/d` · source : `soclehub/.../worker/DbWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_schemas` | ✓ | Lister tous les schemas PostgreSQL provisionnes | — |
| `create_app_schema` | ? | Creer un nouveau schema PostgreSQL pour une application et stocker les identifiants dans Vault | `app_id`* |
| `drop_app_schema` | ? | Supprimer un schema PostgreSQL pour une application | `app_id`* |
| `get_schema_stats` | ? | Obtenir les statistiques du schema PostgreSQL d'une application | `app_id`* |
| `create_mysql_db` | ? | Creer une base de donnees MySQL pour une application | `app_id`* |
| `drop_mysql_db` | ? | Supprimer une base de donnees MySQL pour une application | `app_id`* |
| `backup_app_db` | ? | Declencher une sauvegarde asynchrone de la base de donnees d'une application | `app_id`* |
| `list_backups` | ✓ | Lister toutes les sauvegardes de bases de donnees disponibles | — |
| `restore_backup` | ? | Restaurer une base de donnees depuis une sauvegarde specifique | `app_id`*, `backup_id`* |
| `get_status` | ✓ | Obtenir le statut actuel et les statistiques du worker base de donnees | — |
| `flush_redis_db` | ? | Vider la base Redis allouee a une application | `app_id`* |
| `list_redis_allocations` | ✓ | Lister toutes les allocations de bases Redis par application | — |

## `mop_worker` — 1 actions

Domaine : Exploitation · cadence : `PASSIVE` · source : `soclehub/.../worker/MopWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `restart_worker` | ✗ | Redémarre un Worker interne du Hub via le MOP (stop → initialize → start), sans redémarrer le conteneur Docker. Les workers built-in (http_worker, control_worker, maintenance_worker, rule_engine_worker, status_dashboard_worker) exigent force=true. Utilise status_dashboard_worker__get_all_workers_status pour connaître les noms exacts. | `worker_name`*, `force`, `timeout_seconds` |

## `gardien_worker` — 9 actions

Domaine : Exécution distribuée · cadence : `n/d` · source : `soclehub/.../gardien/GardienWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `create_install_token` | ✗ | Jeton d'enrôlement d'un gardien (usage unique, pour UNE machine, 60 min par défaut). Paramètres : host (nom court, ex. ovh-rss), ttl_minutes. Le jeton n'est rendu qu'une fois. | — |
| `list_gardiens` | ✓ | Gardiens enrôlés : version, canal, dernier compte rendu, état | — |
| `list_reports` | ✓ | Derniers événements rapportés (paramètres : host optionnel, limit ≤ 500) | — |
| `list_orders` | ✓ | Derniers ordres donnés dans le salon et leur issue (limit ≤ 500) | — |
| `summary` | ✓ | Bilan de la flotte (le même que celui posté chaque matin), sans le poster | — |
| `set_alerts` | ✗ | Destinataires des alertes mail (alert_to, séparés par des virgules ; vide = aucune) et expéditeur (alert_from, défaut supervision@thesocle.net) | — |
| `approve_mmh_action` | ✗ | Approuve ou refuse une action mmh en attente (code affiché dans le salon). Paramètres : code, decision (approuve\|refuse). Réservé à une identité PERSONNELLE ayant le rôle GARDIEN_ADMIN : connecteur MCP OIDC, ou clé IAM en REST ; la clé MCP partagée est refusée. Approuvée, l'action est exécutée et son résultat rendu. | — |
| `list_mmh_approvals` | ✓ | Dernières demandes d'approbation d'actions mmh et leur issue (limit ≤ 500) | — |
| `salon` | ✗ | Code du salon « Gardien — flotte » (créé au premier appel) | — |

## `minihub_exec_worker` — 1 actions

Domaine : Exécution distribuée · cadence : `PASSIVE` · source : `soclehub/.../worker/MiniHubExecWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `minihub_exec` | ? | Exécute une commande shell sur un mini-hub via gRPC (pas de SSH). Renvoie exit_code/stdout/stderr. Nécessite exec-worker activé sur le mini-hub. | `minihub_id`*, `command`*, `timeout_ms` |

## `minihub_registry_worker` — 4 actions

Domaine : Exécution distribuée · cadence : `POLLING` · source : `soclehub/.../worker/MiniHubRegistryWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_minihubs` | ✓ | Liste les mini-hubs enrôlés avec leur état temps réel (status, last_heartbeat) | — |
| `pool_stats` | ✓ | Compte global des mini-hubs par statut (ACTIVE / DEGRADED / UNREACHABLE) | — |
| `tick_detect_transitions` | ✗ | Déclenche manuellement la détection DEGRADED/UNREACHABLE (normalement scheduled) | — |
| `revoke_minihub` | ? | Révoque un mini-hub : insère dans iam.tr_minihub_revoked | `minihub_id`*, `reason` |

## `minihub_server_worker` — 1 actions

Domaine : Exécution distribuée · cadence : `PASSIVE` · source : `soclehub/.../worker/MiniHubServerWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Etat du serveur gRPC mini-hub : servlet monte, virtual host, port, services exposes | — |

## `miniminihub_deploy_worker` — 13 actions

Domaine : Exécution distribuée · cadence : `PASSIVE` · source : `soclehub/.../worker/MiniMiniHubDeployWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `deploy_miniminihub` | ✗ | Déploie un agent miniMiniHub (Go) sur une VM via SSH (zéro-touch V002 P4). Requis: vm_host + (ssh_user & ssh_password) [auto-stockés au Vault]. Auto-dérivés: vm_id, slug, minihub_id (le seul connecté, sinon le mini-hub par défaut), parent_endpoint, binary_url, roles(proxy,smtp), mode(persistent), with_tor(=proxy). Le mh installe/configure tor (ControlPort 9051 + NEWNYM) si with_tor. Le store_secret est genere et persiste au Vault, et un settings.local.json derive des roles est depose — sans lui l agent demarre muet (moteur de permissions fail-closed). | — |
| `update_miniminihub` | ✗ | Met à jour un mmh EXISTANT (montée de version) sans changer son identité : même miniminihub_id, même slug, mêmes rôles — donc pas de fantôme DEAD et store.db préservé. Repris du registre: slug, vm_host, roles, mode. Creds SSH relues au Vault (soclehub/miniminihub/<vm_id>). Les paramètres de configuration ABSENTS laissent en place ce qui est déjà posé sur la VM. REFUSE tout nœud non déployé par deploy_miniminihub (programme tiers enrôlé en voie C : le mettre à jour remplacerait son binaire par notre agent) — refus non contournable. | — |
| `destroy_miniminihub` | ✗ | Détruit un agent miniMiniHub (stop+purge SSH). | — |
| `set_batch_job` | ✗ | V002 P5 — crée/modifie un job batch (agent IA planifié) d'un mmh. Persisté côté mh, poussé au mmh. | — |
| `run_now` | ✗ | V003 WS4 — exécute immédiatement un prompt sur un mmh (gate Permission Engine). Le rapport est diffusé par mail (Brevo). | — |
| `list_miniminihubs` | ✓ | V004 WS13 — liste les mmh rattachés à un mini-hub (identité, statut, heartbeat, rôles, mode, IP, charge, et l'état du catalogue d'actions connu). Comble le trou entre list_minihubs, qui s'arrête aux mini-hubs, et les mmh. | — |
| `mmh_list_actions` | ✓ | V004 WS13 — catalogue d'actions d'un mmh, INTROSPECTÉ : chaque binaire de l'allowlist est interrogé (--mmh-actions), rien n'est déclaré. Si le mmh est injoignable, le mh sert le dernier catalogue connu avec stale=true. | — |
| `mmh_invoke_action` | ✗ | V004 WS13 — invoque une action déclarée par un binaire du mmh, APRÈS validation contre le catalogue introspecté (verbe connu, params requis présents, enum/pattern respectés) : un appel malformé est refusé sans réveiller la VM. Exécution via le chemin run_now sync. | — |
| `create_install_token` | ✗ | Crée un jeton d'installation à usage unique pour l'installateur en une ligne (VM sans SSH entrant, sortie internet suffit) : curl -fsSL <hub>/api/mmh/install.sh \| sudo bash -s -- <JETON> [mh]. Rend le jeton UNE fois et la commande exacte ; seul son sha256 est gardé au Vault. | — |
| `list_install_tokens` | ✓ | Liste les jetons d'installation mmh (valides, expirés, utilisés) SANS secret : préfixe d'empreinte, rôles, parent, échéance ; pour un jeton utilisé, l'hôte, l'IP et le mmh enrôlé. | — |
| `revoke_install_token` | ✗ | Révoque (supprime) un jeton d'installation mmh par préfixe d'empreinte (cf. list_install_tokens). | — |
| `egress_pool` | ✓ | Sorties internet disponibles : les mmh du pool d'égress remonté par les mini-hubs, avec IP de sortie, géo/ASN, charge et fraîcheur. usable=true = HEALTHY et vu il y a moins de 15 s, donc sélectionnable pour une sortie. | — |
| `egress_test` | ✓ | Fait sortir une requête HTTP GET (HTTP/1.0, en clair) par un mmh et rend le corps : avec api.ipify.org, le corps est l'IP de sortie. Prouve le chemin Hub → mini-hub → mmh → internet, en direct ou par TOR. | — |

## `onlyoffice_worker` — 5 actions

Domaine : Fichiers · cadence : `PASSIVE` · source : `soclehub/.../worker/OnlyOfficeWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Obtenir le statut du serveur OnlyOffice : accessibilite, version, configuration | — |
| `get_connections` | ✓ | Obtenir les connexions d'edition actives (placeholder) | — |
| `test_health` | ✓ | Tester le endpoint healthcheck OnlyOffice et la configuration JWT | — |
| `get_conversion_queue` | ✓ | Obtenir le statut de la file de conversion de documents (placeholder) | — |
| `force_disconnect` | ✗ | Forcer la deconnexion de toutes les sessions d'edition (placeholder) | — |

## `signature_worker` — 10 actions

Domaine : Fichiers · cadence : `PASSIVE` · source : `soclehub/.../worker/SignatureWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Obtenir le statut du service DocuSeal : accessibilite, URL, configuration | — |
| `signature_create` | ? | Creer une nouvelle soumission de signature a partir d'un modele DocuSeal | `template_id`*, `submitters_json`* |
| `signature_list` | ? | Lister les soumissions de signature, avec filtre optionnel par statut | `status_filter` |
| `signature_get` | ? | Obtenir les details d'une soumission de signature specifique | `id`* |
| `signature_cancel` | ? | Annuler une soumission de signature en attente | `id`* |
| `signature_resend` | ? | Renvoyer l'email d'invitation de signature a un signataire | `id`*, `email`* |
| `signature_download` | ? | Obtenir l'URL de telechargement d'un document signe | `id`* |
| `signature_verify` | ? | Verifier l'integrite d'un document signe | `id`* |
| `signature_templates` | ✓ | Lister les modeles de signature DocuSeal disponibles | — |
| `signature_stats` | ✓ | Obtenir les statistiques agregees de signature : compteurs par statut | — |

## `storage_worker` — 10 actions

Domaine : Fichiers · cadence : `PASSIVE` · source : `soclehub/.../worker/StorageWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Lister tous les buckets S3 avec tailles et nombre d'objets | — |
| `storage_stats` | ✓ | Obtenir l'espace de stockage total, le nombre de fichiers et les statistiques par bucket | — |
| `storage_browse` | ? | Lister les objets dans un bucket/prefixe | `bucket`*, `prefix` |
| `storage_download_url` | ? | Generer une URL presignee GET pour un objet (TTL 1h) | `bucket`*, `key`* |
| `storage_upload` | ? | Uploader un objet dans un bucket (contenu en base64) | `bucket`*, `key`*, `content_base64`*, `content_type` |
| `storage_delete` | ? | Supprimer un objet d'un bucket | `bucket`*, `key`* |
| `storage_set_quota` | ? | Definir le quota de stockage fichier pour un utilisateur | `user_id`*, `max_bytes`* |
| `storage_list_shares` | ✓ | Lister tous les dossiers partages et leurs membres | — |
| `storage_revoke_share` | ? | Revoquer l'acces d'un utilisateur a un dossier partage | `folder_id`*, `user_id`* |
| `storage_purge_trash` | ? | Supprimer tous les objets sous le prefixe .trash/ d'un utilisateur | `user_id`* |

## `tsa_worker` — 5 actions

Domaine : Fichiers · cadence : `PASSIVE` · source : `soclehub/.../worker/TsaWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Obtenir le statut du service TSA : fournisseurs, configuration d'ancrage blockchain | — |
| `tsa_timestamp` | ? | Creer un horodatage TSA pour un hash SHA-256 (encode en hexadecimal) | `hash_hex`* |
| `tsa_verify` | ? | Verifier une reponse d'horodatage TSA par rapport au hash d'origine | `tsa_response_base64`*, `hash_hex`* |
| `tsa_providers` | ✓ | Lister les fournisseurs TSA configures avec leur statut | — |
| `tsa_blockchain_status` | ✓ | Obtenir la configuration et le statut de l'ancrage blockchain | — |

## `agentia_worker` — 22 actions

Domaine : IA · cadence : `PASSIVE` · source : `soclehub/.../worker/AgentIaWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_tools` | ✓ | Lister tous les tools (fetchers + MCP/custom) | — |
| `get_tool` | ? | Obtenir un tool par son nom | `name`* |
| `upsert_tool` | ? | Créer ou mettre à jour un tool (idempotent par name) | `name`*, `tool_type`, `image`, `container_name`, `internal_url`, `endpoint`, `config_json` |
| `list_providers` | ✓ | Lister tous les LLM providers | — |
| `get_provider` | ? | Obtenir un LLM provider par son nom | `name`* |
| `upsert_provider` | ? | Créer ou mettre à jour un LLM provider (métadonnées uniquement — la clé API se stocke via vault_worker set_secret) | `name`*, `mode`*, `base_url`, `default_model`, `available_models`, `api_key_vault_path`, `timeout_sec`, `max_concurrent`, `enabled`, `extra_config_json` |
| `delete_provider` | ? | Supprimer un LLM provider (la clé Vault doit être supprimée séparément) | `name`* |
| `list_tenants` | ✓ | Lister les tenants détectés (iam.db_users) avec leur statut de provisioning AgentIA | — |
| `provision_tenant` | ? | Provisionner un user technique AgentIA pour un tenant (user + rôle agentia:runner + API key Vault) | `tenant_id`* |
| `rotate_tenant` | ? | Régénérer l'API key d'un tenant (révoque les anciennes) | `tenant_id`* |
| `revoke_tenant` | ? | Révoquer le provisioning d'un tenant (lock user + revoke API keys) | `tenant_id`* |
| `provision_all_pending` | ✗ | Provisionner tous les tenants en statut not_provisioned | — |
| `list_apps` | ? | Lister les apps enregistrées (filtre tenant_id optionnel) | `tenant_id` |
| `register_app` | ? | Pré-enregistrer une app (et restreindre providers/modèles) | `tenant_id`*, `app_id`*, `app_name`, `description`, `allowed_providers`, `allowed_models`, `enabled` |
| `list_pricing` | ✓ | Lister les prix courants par (provider, model) | — |
| `set_pricing` | ? | Override manuel d'un prix (source='admin_override' protégé du sync) | `provider_name`*, `model`*, `input_per_1m_usd`*, `output_per_1m_usd`* |
| `set_quota` | ? | Créer/MAJ une règle de quota (tenant, app?, period, max_cost_usd / max_calls / max_tokens_*) | `tenant_id`*, `app_id`, `period`*, `max_cost_usd`, `max_tokens_in`, `max_tokens_out`, `max_calls`, `alert_threshold_pct`, `enabled` |
| `list_quotas` | ✓ | Liste les règles de quota en vigueur | — |
| `delete_quota` | ? | Supprimer une règle de quota | `tenant_id`*, `app_id`, `period`* |
| `list_sessions` | ? | Liste paginée des appels (filtre tenant_id, limit) | `tenant_id`, `limit` |
| `get_usage_summary` | ? | Stats agrégées par tenant/app sur une période | `tenant_id`*, `from`, `to`, `group_by` |
| `get_status` | ✓ | Statut du worker et stats globales | — |

## `iam_worker` — 48 actions

Domaine : Identité · cadence : `n/d` · source : `soclehub/.../worker/IamWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `create_user` | ? | Creer un nouveau compte utilisateur | `email`*, `password`*, `first_name`, `last_name`, `tenant_id` |
| `get_user` | ? | Recuperer les informations d'un utilisateur par son identifiant | `user_id`* |
| `list_users` | ✓ | Lister tous les utilisateurs | — |
| `update_user` | ? | Mettre a jour les champs du profil utilisateur | `user_id`*, `email`, `first_name`, `last_name` |
| `lock_user` | ? | Verrouiller un compte utilisateur | `user_id`* |
| `delete_user` | ? | Supprimer un compte utilisateur, en une transaction : codes OIDC, sessions, roles, acces tenants, cles API et mots de passe de proxy sont retires ; l'historique d'usage AgentIA est conserve anonymise. Refuse si l'utilisateur est proprietaire d'un tenant. | `user_id`* |
| `assign_role` | ? | Attribuer un role a un utilisateur | `user_id`*, `role_name`* |
| `revoke_role` | ? | Revoquer un role d'un utilisateur | `user_id`*, `role_name`* |
| `create_role` | ? | Creer une nouvelle definition de role | `name`*, `description`, `scopes` |
| `delete_role` | ? | Supprimer un role : retire ses liens role→scopes et user→role puis le role, dans une seule transaction. Les roles systeme (admin) sont refuses. | `role_name`* |
| `remove_scope_from_role` | ? | Retirer un scope (permission) d'un role | `role_name`*, `scope_name`, `scope` |
| `list_oidc_clients` | ? | Lister les clients OIDC (jamais le secret) avec leur etat et leurs sessions actives | `include_inactive` |
| `revoke_oidc_client` | ? | Revoquer un client OIDC : x_active=false, suppression de ses codes d'autorisation non consommes et de ses sessions refresh. Les jetons d'acces deja emis expirent a leur TTL. | `client_id`* |
| `assign_scope_to_role` | ? | Attribuer un scope (permission) a un role | `role_name`*, `scope_name`, `scope` |
| `create_api_key` | ? | Generer une nouvelle cle API pour un utilisateur | `user_id`*, `key_name`*, `expires_in_days` |
| `get_my_identity` | ✓ | Retourne l'identite de l'appelant authentifie (user, roles, scopes) — TheBrowser compte actif | — |
| `create_my_api_key` | ? | Genere une cle API pour l'appelant authentifie lui-meme (self-service, sans admin) | `label`*, `expires_in_days`, `max_keys` |
| `revoke_api_key` | ? | Revoquer une cle API existante | `key_id`* |
| `list_api_keys` | ? | Lister les cles API d'un utilisateur | `user_id`* |
| `grant_app_access` | ? | Accorder a un utilisateur l'acces a une application avec un role specifique | `user_id`*, `app_id`*, `role_name`* |
| `create_tenant` | ? | Creer un nouveau tenant (status initial: pending) | `slug`*, `name`*, `contact_email`, `owner_user_id`, `plan`, `expires_at` |
| `get_tenant` | ? | Recuperer les details d'un tenant par son slug | `slug`* |
| `list_tenants` | ? | Lister les tenants avec filtres optionnels | `status`, `plan`, `q`, `limit`, `offset` |
| `update_tenant` | ? | Mettre a jour les champs d'un tenant (optimistic locking via expected_version) | `slug`*, `expected_version`*, `name`, `contact_email`, `plan`, `expires_at`, `max_users`, `max_apps`, `max_storage_gb` |
| `activate_tenant` | ? | Passer un tenant au status 'active' | `slug`* |
| `suspend_tenant` | ? | Suspendre un tenant (avec raison obligatoire, audit force) | `slug`*, `reason`* |
| `restore_tenant` | ? | Restaurer un tenant precedemment suspendu (status -> 'active') | `slug`* |
| `delete_tenant` | ? | Supprimer un tenant. Par defaut soft delete (status='deleted', reversible, les comptes sont conserves). hard=true : suppression DEFINITIVE du tenant ET de ses utilisateurs (tenant principal), en une transaction ; refusee si l'un d'eux est proprietaire d'un autre tenant. | `slug`*, `hard` |
| `bootstrap_tenants_from_users` | ? | Creer un row iam.db_tenants pour chaque tenant_id distinct de iam.db_users (idempotent). A executer apres migration vn. | `dry_run` |
| `get_tenant_fiche` | ? | Lire la fiche societe d'un tenant : identite, identite legale, coordonnees, marque, dirigeant, editeur, domaine. C'est l'action que les applications appellent au lieu de redefinir la societe chacune de leur cote. Le retour porte aussi 'mention_legale' deja formee, 'est_enseigne', et selon le cas 'societe_porteuse' ou 'enseignes'. | `slug`* |
| `upsert_tenant_fiche` | ? | Creer ou mettre a jour la fiche societe d'un tenant. Seuls les champs fournis sont ecrits : un champ absent garde sa valeur. Le cas normal est la societe a part entiere (raison sociale, SIREN et representant propres, 'enseigne_de' vide). 'enseigne_de' ne sert qu'aux marques commerciales sans existence juridique propre et designe le tenant de la societe porteuse. Deux societes a part entiere ne peuvent pas porter le meme SIREN. | `slug`*, `version_attendue`, `fiche`* |
| `set_tenant_logo` | ? | Deposer le logo d'un tenant dans le magasin d'objets et mettre a jour logo_asset_id. Jamais un binaire en base : la fiche ne garde que la cle. 200 Ko au plus, PNG, JPEG, WebP ou SVG. Rend une URL signee, qui expire. | `slug`*, `content_base64`*, `content_type`, `filename` |
| `list_tenant_membres` | ? | L'equipe d'un tenant : fonction, telephone, bio, citation, photo, CV, roles. Les comptes restent dans iam.users ; cette liste porte ce que l'IAM n'a pas. Les membres retires ne sont pas rendus sauf include_inactive=true. | `slug`*, `include_inactive` |
| `upsert_tenant_membre` | ? | Creer ou mettre a jour la fiche d'un membre. Ecriture partielle : un champ absent garde sa valeur. Ne cree PAS le compte IAM ni la boite mail — une fiche de membre peut preceder son compte, c'est le cas pendant un import. | `slug`*, `user_login`*, `membre`* |
| `remove_tenant_membre` | ? | Retirer un membre de l'equipe : sa fiche est DESACTIVEE, pas supprimee — un collaborateur parti figure dans des historiques. Son compte IAM et sa boite se traitent a part, ce n'est pas la meme decision. | `slug`*, `user_login`* |
| `import_tenant` | ? | Monter une societe complete depuis un seul paquet JSON (format tenant.json) : le tenant, sa fiche et ses membres. REJOUABLE — avale trois fois le meme fichier, meme resultat. Les comptes IAM, boites James et entrees DNS sont HORS perimetre : le journal rendu dit ce qui reste a faire, il ne le tente pas a l'aveugle. | `paquet`*, `dry_run` |
| `set_tenant_membre_photo` | ? | Deposer le portrait d'un membre et ses vignettes : 500 px (page de presentation), 256 px (carte d'equipe) et 64 px (avatar a cote d'un nom), recadrees au centre pour garder le visage. 200 Ko au plus. PNG et JPEG sont reechantillonnes ; un SVG est garde tel quel, il se met a l'echelle seul. | `slug`*, `user_login`*, `content_base64`*, `content_type`, `filename` |
| `list_tenant_medias` | ? | Tous les medias d'une societe et de son equipe : logo et portraits, avec leurs variantes, leurs dimensions et une URL signee. La cible vaut la chaine vide pour la societe, le login du membre pour un portrait. | `slug`* |
| `grant_tenant_access` | ? | Octroyer a un utilisateur l'acces a un tenant supplementaire (au-dela de son tenant primary) | `user_id`*, `tenant_slug`*, `role` |
| `revoke_tenant_access` | ? | Revoquer un grant d'acces non-primary (le tenant primary ne peut etre revoque ici) | `user_id`*, `tenant_slug`*, `reason` |
| `list_user_tenants` | ? | Lister les tenants accessibles par un utilisateur (primary + grants actifs) | `user_id`* |
| `list_tenant_users` | ? | Lister les utilisateurs ayant acces a un tenant (primary + grants actifs) | `tenant_slug`* |
| `tenant_consistency_audit` | ✓ | Audit lecture seule : compare iam.db_tenants (source de verite) aux satellites (iam.db_users.tenant_id, apps.applications.x_partition, thefront.z_thefront_tenants, agentia.z_tenant_users) et liste les tenants orphelins + mappings TheFront manquants. | — |
| `list_tenant_rules` | ✓ | Lister les regles de rattachement courriel -> tenant, dans leur ordre d'evaluation (priorite croissante, la premiere qui correspond gagne ; l'attrape-tout .* ferme la liste) | — |
| `add_tenant_rule` | ? | Ajouter une regle de rattachement : si l'adresse (en minuscules) contient le motif, un compte cree sans tenant arrive dans tenant_slug. Refuse une expression invalide et un tenant inexistant. | `motif`*, `tenant_slug`*, `priorite`*, `libelle` |
| `set_tenant_rule_enabled` | ? | Activer ou desactiver une regle de rattachement (une regle ne se supprime pas) | `rule_id`*, `enabled`* |
| `test_tenant_rule` | ? | Banc d'essai : pour une adresse, la regle qui s'appliquerait et le tenant d'arrivee. Ne cree rien. | `email`* |
| `get_status` | ✓ | Retourner le statut du worker IAM et les statistiques | — |

## `mcp_proxy_worker` — 6 actions

Domaine : MCP · cadence : `PASSIVE` · source : `soclehub/.../worker/McpProxyWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `mcp_proxy_status` | ✓ | Obtenir le statut du proxy MCP : applications aggregees, total des outils, sante par application | — |
| `mcp_proxy_refresh` | ✗ | Forcer le rafraichissement du cache d'outils MCP depuis toutes les applications | — |
| `mcp_proxy_list_apps` | ✓ | Lister les applications aggregees avec leur nombre d'outils | — |
| `mcp_proxy_list_tools` | ? | Lister les outils (noms prefixes exacts + description) d'UNE application aggregee. A appeler avant mcp_proxy_invoke pour connaitre les noms reels sans deviner. | `app_id`*, `filter`, `max_description_length` |
| `mcp_proxy_invoke` | ? | Invoquer un outil prefixe sur une application distante via le proxy MCP | `tool`*, `params` |
| `get_status` | ✓ | Obtenir le statut du worker proxy MCP | — |

## `mcpagger_aggregator_worker` — 4 actions  ✅ exposé en MCP depuis le Hub 3.70.1 (fiche bug 003 — l'était pas avant)

Domaine : MCP · cadence : `POLLING` · source : `soclehub/.../worker/McpaggerAggregatorWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_all_specs` | ✓ | Liste les specs MCPagger de toutes les apps avec leur statut | — |
| `get_app_spec` | ✓ | Retourne la spec MCPagger d'une app specifique | `app_id`* |
| `get_aggregated_spec` | ✓ | Retourne la spec consolidee de toutes les apps | — |
| `refresh_specs` | ✗ | Force le refresh immediat de toutes les specs | — |

## `cosmo_worker` — 15 actions

Domaine : Mail · cadence : `PASSIVE` · source : `soclehub/.../worker/CosmoWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Obtenir le statut du worker Cosmo CalDAV : accessibilite, activation, version | — |
| `provision_cosmo` | ✓ | Placeholder : le conteneur Cosmo est gere par docker-compose, pas de provisionnement dynamique | — |
| `create_account` | ? | Creer un compte Cosmo CalDAV pour une adresse email (auto-provisionnement via acces DAV) | `email`* |
| `delete_account` | ? | Supprimer un compte Cosmo CalDAV (supprime les identifiants du Vault) | `email`* |
| `list_accounts` | ✓ | Lister les comptes eligibles CalDAV depuis les boites mail actives | — |
| `sync_iam_users` | ✗ | Synchroniser les utilisateurs IAM : creer des comptes Cosmo pour ceux qui n'en ont pas encore | — |
| `create_calendar` | ? | Creer une collection calendrier pour un compte Cosmo | `email`*, `name`* |
| `delete_calendar` | ? | Supprimer une collection calendrier | `email`*, `calendar_id`* |
| `list_calendars` | ? | Lister les calendriers d'un compte Cosmo | `email`* |
| `share_calendar` | ? | Partager un calendrier avec un autre utilisateur (placeholder — Cosmo ACL via PROPPATCH) | `email`*, `calendar_id`*, `share_with`*, `permission` |
| `create_addressbook` | ? | Creer un carnet d'adresses (collection CardDAV) | `email`*, `name`* |
| `list_addressbooks` | ? | Lister les carnets d'adresses d'un compte Cosmo | `email`* |
| `export_contacts` | ? | Exporter les contacts d'un carnet d'adresses (placeholder) | `email`*, `format` |
| `inject_ical_event` | ? | Injecter un evenement iCalendar dans le calendrier par defaut d'un compte | `email`*, `ical_data`* |
| `get_connection_info` | ✓ | Obtenir les informations de connexion CalDAV/CardDAV pour la configuration client | — |

## `james_tls_worker` — 3 actions

Domaine : Mail · cadence : `n/d` · source : `soclehub/.../worker/JamesTlsWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `james_tls_status` | ✓ | Etat du TLS de la messagerie : par domaine, ce qui est declare, ce qui est dans Vault, ce qui est dans le keystore, et ce qui est REELLEMENT servi, avec l'echeance | — |
| `james_tls_probe` | ? | Mesurer seulement : quel certificat James presente-t-il pour chaque nom, et pour un client sans SNI. Ne modifie rien | `domain` |
| `james_tls_reconcile` | ? | Faire converger maintenant : renouveler ce qui manque, reconstruire le keystore si besoin, recharger a chaud, verifier. Avec dry_run=true, n'affiche que l'ecart | `dry_run` |

## `james_worker` — 53 actions

Domaine : Mail · cadence : `n/d` · source : `soclehub/.../worker/JamesWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `provision_james` | ✗ | Provisionner le serveur mail Apache James via Docker (pull image, creation conteneur, demarrage) | — |
| `start_james` | ✗ | Demarrer le conteneur Docker James | — |
| `stop_james` | ✗ | Arreter le conteneur Docker James | — |
| `get_status` | ✓ | Obtenir le statut du worker James : accessibilite, version, nombre de boites, reputation | — |
| `add_domain` | ? | Ajouter un domaine mail a James et persister en base | `domain`* |
| `remove_domain` | ? | Supprimer un domaine mail de James et de la base | `domain`* |
| `list_domains` | ✓ | Lister tous les domaines mail enregistres | — |
| `check_dns_config` | ? | Verifier les enregistrements DNS (MX, SPF, DKIM, DMARC) d'un domaine | `domain`* |
| `configure_dkim` | ? | Generer et configurer la cle DKIM pour un domaine | `domain`* |
| `create_mailbox` | ? | Creer une boite mail (utilisateur James) pour un domaine | `user`*, `domain`*, `quota_mb`, `recovery_email` |
| `delete_mailbox` | ? | Supprimer une boite mail (utilisateur James) | `user`*, `domain`* |
| `set_mailbox_password` | ? | Changer le mot de passe d'une boite mail (genere si absent) + maj Vault + envoi optionnel a l'adresse de recuperation | `user`*, `domain`*, `new_password`, `recovery_email`, `notify` |
| `generate_mobileconfig` | ? | Genere un profil Apple .mobileconfig (config Mail 1-tap Mac/iPhone) + URL de telechargement signee | `user`*, `domain`* |
| `list_mailboxes` | ? | Lister les boites mail, avec filtre optionnel par domaine | `domain` |
| `get_mailbox_quota` | ? | Obtenir l'utilisation du quota d'une boite mail | `user`*, `domain`* |
| `set_mailbox_quota` | ? | Definir le quota d'une boite mail | `user`*, `domain`*, `quota_mb`* |
| `provision_system_mailboxes` | ? | Creer les boites systeme (postmaster, abuse, noreply) pour un domaine | `domain`* |
| `list_quota_alerts` | ? | Lister les boites depassant un seuil d'utilisation de quota | `threshold` |
| `send_via_james` | ? | Envoyer un email via le SMTP James (destinataires multiples, copie, copie cachee, pieces jointes) | `from`*, `to`*, `cc`, `bcc`, `subject`*, `html`*, `text`, `attachments`, `copy_to_sent` |
| `get_smtp_config` | ✓ | Obtenir la configuration SMTP actuelle (mode, relai, disponibilite port 25) | — |
| `set_smtp_mode` | ? | Definir le mode SMTP (direct ou relai) | `mode`*, `relay_host`, `relay_port` |
| `test_outbound` | ? | Envoyer un email de test pour verifier la delivrabilite sortante | `to`* |
| `check_blacklist` | ? | Verifier si l'IP du serveur est sur des listes noires email | `ip` |
| `get_reputation_report` | ? | Obtenir le rapport de reputation email d'un domaine | `domain`* |
| `swap_mx_priority` | ? | Inverser la priorite MX entre primaire et secondaire pour un domaine | `domain`* |
| `get_inbound_recommendations` | ✓ | Obtenir les recommandations pour ameliorer la configuration email entrante | — |
| `enable_warmup` | ? | Activer le programme de chauffe IP/domaine pour une montee en volume progressive | `domain`*, `target_volume`* |
| `get_warmup_status` | ? | Obtenir le statut du programme de chauffe d'un domaine | `domain`* |
| `set_max_message_size` | ? | Definir la taille maximale des messages (en Mo) globalement ou par domaine | `size_mb`*, `domain` |
| `set_domain_quota` | ? | Definir le quota de stockage total pour un domaine | `domain`*, `quota_gb`* |
| `get_storage_stats` | ✓ | Obtenir les statistiques de stockage blob (total, unique, ratio deduplication) | — |
| `run_gc` | ✗ | Declencher le ramasse-miettes sur les blobs orphelins | — |
| `get_quota_usage` | ? | Obtenir le resume d'utilisation des quotas, avec filtre optionnel par domaine | `domain` |
| `migrate_mailbox` | ? | Migrer une boite mail depuis un serveur IMAP externe vers James | `source_host`*, `source_user`*, `source_password`*, `target_user`*, `target_domain`* |
| `get_migration_status` | ? | Obtenir le statut d'un job de migration de boite mail | `job_id`* |
| `add_fetchmail_account` | ? | Ajouter un compte FetchMail (recuperation depuis un IMAP externe sur planning) | `host`*, `user`*, `password`*, `target_user`*, `target_domain`*, `interval_seconds` |
| `remove_fetchmail_account` | ? | Supprimer un compte FetchMail | `user`* |
| `add_enrichment_rule` | ? | Ajouter une regle d'enrichissement pour lier les donnees des mails entrants a une table metier | `domain`*, `matcher`*, `target_table`*, `field_mapping`*, `datasource` |
| `list_enrichment_rules` | ? | Lister les regles d'enrichissement, avec filtre optionnel par domaine | `domain` |
| `remove_enrichment_rule` | ? | Supprimer une regle d'enrichissement par son ID | `rule_id`* |
| `get_enrichment_logs` | ? | Obtenir les logs de traitement d'enrichissement | `domain`, `limit` |
| `resolve_pending_links` | ✗ | Resoudre les liens mail-contact non resolus dans mail_contact_link | — |
| `configure_mx_direct` | ? | Configurer un domaine pour la livraison MX directe | `domain`*, `mx_host`*, `priority` |
| `configure_mx_relay` | ? | Configurer un domaine pour la livraison MX via relai | `domain`*, `relay_host`*, `relay_port` |
| `list_mail_logs` | ? | Lister les logs recents de livraison d'emails | `domain`, `limit` |
| `sync_iam_users` | ? | Synchroniser les utilisateurs IAM vers les boites James pour un domaine | `domain`* |
| `get_sync_status` | ✓ | Obtenir le statut de synchronisation IAM vers boites mail | — |
| `unsync_user` | ? | Supprimer le lien IAM d'une boite mail | `user_id`* |
| `list_messages` | ? | Lister les messages d'une boite mail (lecture seule via IMAP, du plus recent au plus ancien) | `user`*, `domain`*, `folder`, `limit`, `unread_only` |
| `get_message` | ? | Lire le contenu d'un message (corps texte/HTML + entetes) via IMAP, par UID retourne par list_messages | `user`*, `domain`*, `message_id`*, `folder`, `mark_seen` |
| `list_folders` | ? | Lister les dossiers d'une boite mail (INBOX, Sent, dossiers crees) avec total et non lus — ne marque rien comme lu | `user`*, `domain`* |
| `create_folder` | ? | Creer un dossier dans une boite mail (un seul niveau ; lettres, chiffres, espaces, - et _) | `user`*, `domain`*, `folder`* |
| `move_message` | ? | Deplacer un message d'un dossier a un autre de la meme boite (par UID) ; ses marques, dont lu/non lu, sont conservees | `user`*, `domain`*, `message_id`*, `from_folder`, `to_folder`* |

## `mail_attachment_worker` — 7 actions

Domaine : Mail · cadence : `n/d` · source : `soclehub/.../worker/MailAttachmentWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Obtenir le statut du scanner de pieces jointes : en cours, ClamAV joignable, totaux | — |
| `list_scan_state` | ✓ | Lister l'etat de scan IMAP pour toutes les boites mail suivies | — |
| `get_mailbox_scan_state` | ? | Obtenir l'etat de scan IMAP d'une boite mail specifique | `username`* |
| `trigger_scan` | ? | Declencher un scan des pieces jointes immediatement. Optionnel : pour une seule boite mail. | `username` |
| `scan_backlog` | ? | Reinitialiser la position de scan et re-scanner a partir d'un UID donne (ou 0 pour un scan complet) | `username`*, `from_uid` |
| `reset_scan_state` | ? | Reinitialiser l'etat de scan d'une boite mail (last_uid = 0) | `username`* |
| `set_enabled` | ? | Activer ou desactiver le scan des pieces jointes pour une boite mail | `username`*, `enabled`* |

## `mail_worker` — 11 actions

Domaine : Mail · cadence : `PASSIVE` · source : `soclehub/.../worker/MailWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `send_email` | ? | Envoyer un email avec contenu HTML et corps texte brut optionnel | `to`*, `subject`*, `html`*, `text`, `app_id` |
| `list_logs` | ? | Lister les logs d'envoi d'emails, avec filtre optionnel par application | `app_id`, `limit` |
| `test_smtp` | ✓ | Tester la connectivite du serveur SMTP | — |
| `get_status` | ✓ | Retourner le statut actuel du worker mail avec la configuration et les statistiques | — |
| `list_email_templates` | ✓ | Lister les templates d'email disponibles (clé, sujet, catégorie, actif) | — |
| `get_email_template` | ? | Récupérer un template d'email complet (corps HTML/texte, placeholders) | `template_key`* |
| `preview_email_template` | ? | Rendre un template avec des variables SANS l'envoyer (retourne subject/html/text) | `template_key`*, `variables` |
| `send_templated_email` | ? | Rendre puis envoyer un template d'email. Canal brevo (defaut) ou james. | `to`*, `template_key`*, `variables`, `from`, `channel` |
| `upsert_email_template` | ? | Créer ou mettre à jour un template d'email (par template_key) | `template_key`*, `subject`*, `body_html`*, `body_text`, `name`, `description`, `category`, `locale`, `layout_key`, `placeholders`, `is_active` |
| `delete_email_template` | ? | Supprimer un template d'email par sa clé | `template_key`* |
| `upsert_email_layout` | ? | Créer ou mettre à jour un layout brandé (par layout_key). Placeholders {{PREHEADER}}, {{CONTENT}}. | `layout_key`*, `html`*, `name`, `description`, `is_active` |

## `warmup_worker` — 13 actions

Domaine : Mail · cadence : `PASSIVE` · source : `soclehub/.../worker/WarmupWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `warmup_add_account` | ? | Enregistrer (ou mettre à jour) une boîte-persona du parc ; le mot de passe part en Vault | `address`*, `provider`, `password`*, `login`, `imap_host`, `imap_port`, `smtp_host`, `smtp_port`, `is_target`, `daily_cap`, `persona`, `persona_role`, `persona_signature` |
| `warmup_test_account` | ? | Vérifier la connexion IMAP + SMTP d'une boîte du parc (sans envoyer de message) | `address`* |
| `warmup_list_accounts` | ✓ | Lister le parc de boîtes-personas avec le dernier résultat de test (sans secret) | — |
| `warmup_remove_account` | ? | Retirer une boîte du parc et supprimer son secret Vault | `address`* |
| `get_status` | ✓ | État du moteur et compteurs du parc | — |
| `warmup_enroll_target` | ? | Déclarer une adresse/domaine à chauffer (+ profil de rampe) | `address`*, `domain`, `ramp_profile`, `start_date` |
| `warmup_status` | ✓ | État global : parc, cibles, %INBOX/7j, jours sans spam, plafond James, jobs | — |
| `warmup_report` | ? | Rapport de délivrabilité par opérateur pour une cible, sur N jours | `address`*, `days` |
| `warmup_force_cycle` | ? | Ouvrir immédiatement une conversation (démo/debug) ; cible optionnelle | `address`, `count` |
| `warmup_plan_now` | ✗ | Forcer la planification du jour (planner) pour toutes les cibles WARMING | — |
| `warmup_pause` | ? | Suspendre une cible (plus de nouveaux fils) | `address`* |
| `warmup_resume` | ? | Reprendre une cible suspendue | `address`* |
| `warmup_mark_hot` | ? | Marquer une cible « chaude » et notifier TheDiffuseur (hand-off). Vérifie le critère sauf force=true | `address`*, `force` |

## `nats_worker` — 15 actions

Domaine : Messagerie · cadence : `PASSIVE` · source : `soclehub/.../worker/NatsWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Obtenir le statut de connexion NATS et les informations du serveur | — |
| `list_streams` | ✓ | Lister tous les streams JetStream avec le nombre de messages, la taille en octets et le nombre de consumers | — |
| `get_stream_info` | ? | Obtenir la configuration detaillee et l'etat d'un stream specifique | `stream_name`* |
| `create_stream` | ? | Creer un nouveau stream JetStream | `stream_name`*, `subjects`*, `max_age_days` |
| `delete_stream` | ? | Supprimer un stream JetStream et toutes ses donnees | `stream_name`* |
| `purge_stream` | ? | Purger tous les messages d'un stream JetStream | `stream_name`* |
| `peek_messages` | ? | Lire les N derniers messages d'un stream sans les consommer | `stream_name`*, `count` |
| `get_message` | ? | Lire un message specifique par numero de sequence | `stream_name`*, `seq`* |
| `delete_message` | ? | Supprimer un message specifique par numero de sequence | `stream_name`*, `seq`* |
| `list_consumers` | ? | Lister tous les consumers d'un stream JetStream | `stream_name`* |
| `publish_message` | ? | Publier un message sur un sujet NATS | `subject`*, `payload`* |
| `socle_publish` | ? | Publier en JetStream sur un sujet DERIVE de domain/channel/target (stream auto-provisionne, PublishAck garanti, headers socle, repli DLQ) | `domain`*, `channel`*, `target`*, `payload`*, `msg_id`, `schema`, `tenant` |
| `socle_consume` | ? | Consommer sur un durable auto-provisionne (curseur preserve). Retourne des messages NON ackes, chacun avec son ack_token a rappeler via socle_ack | `domain`*, `channel`*, `consumer`*, `target`, `max`, `timeout_seconds` |
| `socle_ack` | ? | Accuser reception d'un message consomme : ack (traite), nak (rejouer) ou term (empoisonne, part en DLQ) | `ack_token`*, `type`, `delay_seconds`, `subject`, `error` |
| `get_account_info` | ✓ | Obtenir les limites du compte JetStream et les statistiques d'utilisation | — |

## `acme_worker` — 6 actions

Domaine : Réseau · cadence : `n/d` · source : `soclehub/.../worker/AcmeWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `request_certificate` | ? | Demander un nouveau certificat TLS pour un domaine via ACME (DNS-01). Avec wildcard=true, couvre le domaine ET tous ses sous-domaines en un seul ordre | `domain`*, `wildcard` |
| `list_certificates` | ✓ | Lister tous les certificats TLS geres | — |
| `check_expiry` | ? | Verifier les informations d'expiration du certificat d'un domaine | `domain`* |
| `force_renew` | ? | Forcer le renouvellement d'un certificat TLS pour un domaine | `domain`* |
| `force_check_all` | ✗ | Forcer la verification de tous les certificats pour renouvellement | — |
| `get_status` | ✓ | Retourner le statut actuel du worker ACME | — |

## `dns_sync_worker` — 11 actions

Domaine : Réseau · cadence : `n/d` · source : `soclehub/.../worker/DnsSyncWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_zones` | ✓ | Lister toutes les zones DNS (BDD + Cloudflare en direct) | — |
| `register_zone` | ? | Enregistrer une nouvelle zone DNS dans la base de donnees | `zone_id`*, `zone_name`* |
| `list_records` | ? | Lister les enregistrements DNS depuis la base de donnees, avec filtre optionnel par zone | `zone_id` |
| `create_record` | ? | Creer un enregistrement DNS (persiste + optionnellement pousse vers Cloudflare) | `zone_id`*, `type`*, `name`*, `content`*, `ttl`, `proxied` |
| `update_record` | ? | Mettre a jour un enregistrement DNS existant (en BDD et Cloudflare) | `record_id`*, `content`*, `ttl`, `proxied` |
| `delete_record` | ? | Supprimer un enregistrement DNS (Cloudflare + BDD) | `zone_id`*, `record_id`* |
| `create_subdomain` | ? | Creer un enregistrement A pour un sous-domaine (action simplifiee) | `subdomain`*, `ip`* |
| `delete_subdomain` | ? | Supprimer un sous-domaine et ses enregistrements associes | `subdomain`* |
| `force_sync` | ✗ | Forcer une synchronisation complete depuis Cloudflare vers la BDD | — |
| `push_pending` | ✗ | Pousser tous les changements DNS en attente vers Cloudflare | — |
| `get_status` | ✓ | Obtenir le statut actuel et les statistiques du worker de synchronisation DNS | — |

## `domain_worker` — 11 actions

Domaine : Réseau · cadence : `PASSIVE` · source : `soclehub/.../domain/worker/DomainWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `domain_list` | ? | Lister les domaines du registre avec leurs hôtes, leur statut et leur couverture TLS | `with_hosts` |
| `domain_get` | ? | Détail d'un domaine : statut, zone DNS, chemin Vault, hôtes, options activées | `domain_name`* |
| `domain_register` | ? | Déclarer un domaine. Il naît en PENDING avec un jeton de preuve de propriété : aucun certificat n'est demandé et aucun trafic n'est servi tant que la preuve n'est pas faite | `domain_name`*, `kind`, `dns_zone_id`, `dns_provider`, `canonical_host` |
| `domain_status` | ? | Changer le statut d'un domaine : PENDING \| VALIDATING \| ACTIVE \| SUSPENDED \| RETIRED | `domain_name`*, `status`* |
| `domain_remove` | ? | Retirer un domaine du registre, avec ses hôtes. Le domaine primaire ne se supprime pas | `domain_name`* |
| `domain_host_add` | ? | Déclarer un hôte servi sous un domaine (portail, app, API, mail, calendrier…) | `domain_name`*, `hostname`*, `role`, `app_id`, `tls_mode` |
| `domain_host_remove` | ? | Retirer un hôte du registre | `hostname`* |
| `domain_update` | ? | Régler l'apparence d'un domaine (nom affiché, couleur, logo, baseline) et son hôte de portail. C'est ce que voit un utilisateur de cette marque : il ne doit jamais y lire le nom d'une autre | `domain_name`*, `canonical_host`, `brand_name`, `brand_color`, `brand_tagline`, `brand_logo_url` |
| `domain_set_dns_token` | ? | Déposer le jeton d'API DNS PROPRE à un domaine, sous sa racine Vault. C'est ce jeton — et non celui du Hub — qui servira à provisionner sa zone | `domain_name`*, `token`* |
| `domain_resolve` | ? | Diagnostic : à quel domaine du registre un nom d'hôte se rattache-t-il, et comment | `hostname`* |
| `get_status` | ✓ | État du worker : nombre de domaines et d'hôtes au registre, domaine primaire | — |

## `egress_probe_worker` — 1 actions

Domaine : Réseau · cadence : `POLLING` · source : `soclehub/.../worker/EgressProxyProbeWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `egress_probe_status` | ✓ | Verdicts de la sonde active des sorties : saine / hors service, échecs consécutifs, latence, dernière réussite, par mmh. | — |

## `egress_proxy_worker` — 4 actions

Domaine : Réseau · cadence : `PASSIVE` · source : `soclehub/.../worker/EgressProxyWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `egress_proxy_status` | ✓ | État du proxy de sortie par les mmh (soclehub:3128) : écoute, tunnels actifs et cumulés, octets, refus, garde-fous, et sorties sélectionnables. | — |
| `egress_proxy_password_create` | ✗ | Crée un mot de passe de PROXY dédié pour un utilisateur (B4) : email + mot de passe distinct de l'IAM, pour se connecter au proxy depuis un navigateur. Si password absent, il est généré et rendu UNE seule fois. | — |
| `egress_proxy_password_list` | ✓ | Liste les mots de passe de proxy (jamais le secret), filtrable par email. | — |
| `egress_proxy_password_revoke` | ✗ | Révoque un mot de passe de proxy par son x_id. | — |

## `proxy_worker` — 9 actions

Domaine : Réseau · cadence : `PASSIVE` · source : `soclehub/.../worker/ProxyWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `add_route` | ? | Creer une route de proxy associant un nom d'hote public a une cible interne | `app_id`*, `hostname`*, `target_host`*, `target_port`* |
| `remove_route` | ? | Supprimer une route de proxy par nom d'hote | `hostname`* |
| `list_routes` | ✓ | Lister toutes les routes de proxy enregistrees | — |
| `enable_sso` | ? | Activer le SSO sur une route identifiee par app_id | `app_id`*, `sso_scope`* |
| `disable_sso` | ? | Desactiver le SSO sur une route identifiee par app_id | `app_id`* |
| `update_route` | ? | Mettre a jour les champs d'une route de proxy (persiste en BDD et met a jour en memoire) | `app_id`*, `hostname`, `target_host`, `target_port`, `protocol`, `tls_enabled`, `sso_enabled`, `sso_mode`, `sso_scope`, `sso_protected_paths`, `proxy_protocol`, `health_path`, `status` |
| `health_check_all` | ✗ | Executer les health checks sur tous les backends | — |
| `get_routing_table` | ✓ | Retourner la table de routage brute a des fins de debug | — |
| `get_status` | ✓ | Retourner le statut du proxy worker : nombre de routes, SSO et TLS | — |

## `vault_worker` — 9 actions

Domaine : Secrets · cadence : `n/d` · source : `soclehub/.../worker/VaultWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `create_app_path` | ? | Creer un chemin de secrets Vault pour une application | `app_id`* |
| `delete_app_path` | ? | Supprimer un chemin de secrets Vault pour une application | `app_id`* |
| `set_secret` | ? | Ecrire/merger une paire cle-valeur dans le payload du secret au chemin donne (read-modify-write : preserve les autres cles existantes) | `path`*, `key`*, `value`* |
| `get_secret_keys` | ? | Lister les sous-chemins (folders) sous un chemin Vault donne (= LIST KV v2 metadata). Pour lire les cles du payload d'un secret, utiliser get_secret. | `path`* |
| `get_secret` | ? | Lire les cles du payload d'un secret Vault au chemin donne (valeurs masquees pour audit). BUG-023 fix : permet de verifier ce qui a ete persiste par set_secret. | `path`* |
| `delete_secret` | ? | Supprimer un secret a un chemin donne | `path`* |
| `renew_token` | ✗ | Renouveler le token d'authentification Vault | — |
| `get_status` | ✓ | Retourner le statut de connexion Vault et les informations de sante | — |
| `audit_app_bundles` | ? | Auditer l'acces Vault de TOUTES les applications installees : chemin present, bundle lisible, token applicatif valide. Une app dont le bundle est vide ou refuse se replie en silence sur son environnement — cette action est le signal qui manquait. Aucune valeur de secret ni de token n'est retournee, seulement des empreintes. | `app_id` |

## `bridge_session_worker` — 2 actions

Domaine : Supervision · cadence : `POLLING` · source : `soclehub/.../worker/BridgeSessionSweepWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_connections` | ✓ | Liste les clients TheBrowser (socle-hub-bridge) actuellement connectés au Hub | — |
| `get_status` | ✓ | Stats du registre de sessions bridge : connectés, users distincts, TTL | — |

## `portal_worker` — 1 actions

Domaine : Supervision · cadence : `PASSIVE` · source : `soclehub/.../worker/PortalWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Retourner les informations du portail : domaine, utilisation CDN et version | — |

## `supervision_externe_worker` — 15 actions

Domaine : Supervision · cadence : `POLLING` · source : `soclehub/.../supervision/SupervisionExterneWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Etat de la Supervision Externe : sources, sources muettes, rapports recus, alertes ouvertes, rejets des 24 dernieres heures | — |
| `list_sources` | ? | Liste les sources declarees avec leur dernier etat connu et sa date. Une source injoignable est muette, pas vide : son etat precedent est conserve | `type_source` |
| `get_source` | ? | Le detail d'une source : son etat courant normalise et ses compteurs | `source_id`* |
| `list_alertes` | ? | Les alertes, les plus recentes d'abord, avec ce qu'Alfred en a fait | `source_id`, `ouvertes`, `limit` |
| `acquitter_alerte` | ? | Acquitte une alerte. Elle quitte les ouvertes et se relevera si le fait change | `alerte_id`* |
| `list_receptions` | ? | Le journal des appels recus, acceptes ET rejetes avec leur motif. C'est ici qu'on comprend pourquoi une source ne remonte pas | `source_id`, `limit` |
| `list_regles` | ? | Les regles d'anomalie en vigueur. Elles sont des donnees : les modifier ne demande pas de livraison | `type_source` |
| `declarer_source` | ? | Declare une source. Elle nait sans jeton et sans rapport : declarer et habiliter sont deux gestes | `source_id`*, `type_source`*, `nom`, `url`, `cadence_s` |
| `frapper_jeton` | ? | Frappe le jeton APIM de la source (format apim_<env>_<40hex>) et rend les trois blocs a coller. ATTENTION : la cle en clair n'est rendue QU'ICI et n'est jamais reaffichable. Sur une source qui en a deja un, c'est une rotation : l'ancienne cle reste acceptee pendant la fenetre de recouvrement | `source_id`*, `tenant`*, `user`, `expires_in_days` |
| `revoquer_jeton` | ? | Revoque le jeton d'une source. Elle devient muette, et c'est l'effet voulu | `source_id`* |
| `suspendre_source` | ? | Suspend une source sans toucher a son jeton : la coupure est reversible | `source_id`* |
| `reprendre_source` | ? | Remet une source en service. Elle repart 'declaree' : 'active' se merite a la premiere reception | `source_id`* |
| `blocs_installation` | ? | Les trois blocs a coller pour une source : les constantes wp-config.php, le curl de poussee, le curl de lecture de l'inventaire. Le jeton y figure en marqueur, car sa valeur n'est pas reaffichable | `source_id`* |
| `force_balayage` | ✗ | Declenche immediatement le balayage du silence, sans attendre le cycle | — |
| `force_purge` | ✗ | Applique immediatement les bornes de retention | — |

## `clamav_worker` — 12 actions

Domaine : Sécurité · cadence : `PASSIVE` · source : `soclehub/.../worker/ClamAvWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `get_status` | ✓ | Obtenir le statut du daemon ClamAV : accessibilite, version, infos daemon | — |
| `get_signature_info` | ✓ | Obtenir les infos de la base de signatures ClamAV : date, nombre | — |
| `get_clamd_stats` | ✓ | Obtenir les statistiques brutes du daemon clamd (pools, threads, file d'attente) | — |
| `force_reload_signatures` | ✗ | Forcer ClamAV a recharger les bases de signatures virales | — |
| `scan_bytes` | ? | Scanner des donnees encodees en base64 pour detecter des virus | `data_base64`* |
| `scan_test` | ✓ | Scanner la chaine de test EICAR pour verifier le fonctionnement de la detection ClamAV | — |
| `list_quarantine` | ✓ | Lister les fichiers en quarantaine (non encore liberes) | — |
| `get_quarantine_file` | ? | Obtenir les details d'un fichier en quarantaine specifique | `id`* |
| `release_quarantine` | ? | Liberer un fichier en quarantaine (marquer comme libere) | `id`* |
| `delete_quarantine` | ? | Supprimer definitivement un fichier en quarantaine | `id`* |
| `get_scan_history` | ? | Obtenir l'historique recent des scans | `limit` |
| `get_scan_stats` | ✓ | Obtenir les statistiques agregees des scans : total, nombre d'infections, duree moyenne | — |

## `scan_guard_worker` — 13 actions

Domaine : Sécurité · cadence : `PASSIVE` · source : `soclehub/.../worker/ScanGuardWorker.java`

| Action | L | Rôle | Paramètres |
|---|:-:|---|---|
| `list_patterns` | ✓ | Lister tous les patterns (avec hit_count a jour) | — |
| `get_top_hits` | ? | Top N patterns par nombre de hits | `limit` |
| `add_pattern` | ? | Ajouter un pattern de blocage | `pattern`*, `match_type`*, `category`, `description` |
| `remove_pattern` | ? | Supprimer un pattern par son x_id | `x_id`* |
| `set_enabled` | ? | Activer ou desactiver un pattern | `x_id`*, `enabled`* |
| `reload_patterns` | ✗ | Recharger les patterns depuis la DB en RAM | — |
| `get_status` | ✓ | Statut du worker et stats globales (total_blocked, db_blocked, regex_blocked) | — |
| `disable_temporarily` | ? | Désactive le ScanGuard pour N minutes (auto-réactivation). Refuse si déjà désactivé. | `duration_minutes`*, `reason`* |
| `enable_now` | ✗ | Réactive immédiatement le ScanGuard (annule une désactivation en cours) | — |
| `list_builtin_categories` | ✓ | Liste les catégories du regex hardcodé (built-in) avec leurs hits depuis le boot | — |
| `list_builtin_exceptions` | ✓ | Liste les exceptions built-in (catégories laissées passer par hostname/glob) | — |
| `add_builtin_exception` | ? | Ajoute une exception built-in (laisse passer une catégorie pour un hostname/glob) | `category`*, `hostname_glob`, `reason`*, `duration_minutes` |
| `remove_builtin_exception` | ? | Désactive une exception built-in par son x_id | `x_id`* |
