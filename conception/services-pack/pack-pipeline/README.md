# socle-pack-pipeline — moteur de pipelines DAG

> Vérifié au code le **2026-10-28**.

## Le pack en 5 lignes

1. Un **moteur de pipelines en graphe (DAG)** qu'une app V005 embarque sous forme de JAR (`eu.lmvi:socle-pack-pipeline`).
2. Il se **pose sur le Pipeline V2 du framework** (`VThreadStageExecutor`, `StageQueue` + DLQ, `PersistentPipelineContext`) et n'en réécrit aucune brique d'exécution.
3. Il apporte en plus : le DAG déclaratif en JSON (template → run figé), sept types d'étapes **S/T/E/G/K/H/C**, la validation V1–V6, le Human-in-the-loop, le lineage persisté en PostgreSQL, le catalogue avec fork et les sous-pipelines.
4. Tout se pilote par **un seul worker passif, `pipeline_worker`, qui expose 24 actions** en MCP/REST, ou en Java par `PipelineWorker.executeAction(...)`.
5. La logique métier vit dans des **`StageHandler` de l'app**. Le pack fournit le câblage, le routage, la reprise et la traçabilité.

## Version documentée

| Élément | Valeur |
|---|---|
| Artefact | `eu.lmvi:socle-pack-pipeline:0.1.0-SNAPSHOT` (jamais publié en release) |
| Dépôt | `/opt/2026-TheHub4TheSocle/socle-pack-pipeline` (git autonome, `github.com/jmlmvi/socle-pack-pipeline`) |
| Réf. documentée | branche **`feat/p1-p4-dag-engine` @ `5fa8f05`** (2026-10-05) |
| Compilé contre | `socle-v005` **5.8.0** (`provided`), parent Spring Boot **3.2.1**, `jnats` 2.19.1 (`provided`) |
| Manifeste | `META-INF/socle-pack.json`, `minSocleVersion` 5.7.4 |
| Où trouver le JAR | **uniquement `~/.m2` de la box de build** (installé par `mvn install` le 2026-10-05). Aucun `mvn-repo/` vendorisé, et le dépôt `maven.thesocle.net` ne le sert pas |

**Ce que la branche a de plus que `main`** (`git diff main --stat`, `main` = `4c9bc17`) :

| Fichier | Apport |
|---|---|
| `db/pipeline/V002__run_key_unique.sql` | ferme les doublons de `run_key` et pose un index unique partiel `NULLS NOT DISTINCT` (PostgreSQL ≥ 15) |
| `runtime/PipelineRuntimeManager.java` | `instantiate` devient **idempotent sur `run_key`** : un run non terminé en base est repris au lieu d'être recréé |
| `docs/preuves/README.md` | preuves du correctif |

Le JAR présent dans `~/.m2` contient déjà `V002` : les apps qui reconstruisent aujourd'hui embarquent donc la branche, pas `main`.

## Quel HOWTO pour quel besoin

| J'ai besoin de… | HOWTO |
|---|---|
| ajouter le pack à mon app, choisir entre le pack et les pipelines du framework | [[howto-pipeline-01-integrer-le-pack\|PIPELINE-01 — Intégrer le pack]] |
| décrire un enchaînement d'étapes avec branchements, le valider et le publier | [[howto-pipeline-02-declarer-valider-publier-un-dag\|PIPELINE-02 — Déclarer, valider, publier un DAG]] |
| brancher ma logique métier (appel LLM, écriture en base, publication) sur une étape | [[howto-pipeline-03-ecrire-un-stage-handler\|PIPELINE-03 — Écrire un StageHandler]] |
| lancer, mettre en pause, annuler un traitement ; choisir batch ou pas-à-pas | [[howto-pipeline-04-executer-un-run\|PIPELINE-04 — Exécuter un run]] |
| faire valider une étape par un humain, survivre à un redémarrage | [[howto-pipeline-05-human-in-the-loop-et-reprise\|PIPELINE-05 — Human-in-the-loop et reprise]] |
| rejouer un lot sans doublon, relancer les messages en échec | [[howto-pipeline-06-idempotence-backfill-et-dlq\|PIPELINE-06 — Idempotence, backfill, DLQ]] |
| savoir ce qui s'est passé : étapes, durées, artefacts produits | [[howto-pipeline-07-observer-lineage-et-metriques\|PIPELINE-07 — Lineage et métriques]] |
| réutiliser un pipeline, le dériver, imbriquer un pipeline dans un autre | [[howto-pipeline-08-catalogue-fork-et-sous-pipelines\|PIPELINE-08 — Catalogue, fork, sous-pipelines]] |
| faire transiter les messages entre étapes par NATS JetStream | [[howto-pipeline-09-backend-nats-jetstream\|PIPELINE-09 — Backend NATS JetStream]] |

## Dépendances

| Dépendance | Nature |
|---|---|
| `socle-v005` ≥ 5.7.4 | **fournie par l'app** (`provided`) ; Pipeline V2, Worker, ActionProvider, TechDB |
| PostgreSQL ≥ **15** | **obligatoire** : 6 tables `db_/tr_pipeline_*` + registre `z_pack_migrations`, dans `socle.pipeline.schema`. `V002` exige `NULLS NOT DISTINCT` |
| `spring-boot-starter-jdbc` | tirée par le pack (`JdbcTemplate`, `DataSource` de l'app) |
| TechDB H2 du framework | seulement si `queue-backend=techdb` (défaut) |
| client NATS `io.nats:jnats` 2.19.1 | **toujours requis à l'exécution**, même sans NATS : `DagPipelineBuilder` le référence dans ses signatures et le pack le déclare `provided`. Un serveur JetStream n'est nécessaire que si `queue-backend=nats` |
| Autres packs | aucune |

## Apps qui l'embarquent (2026-10-28)

| App | Socle | Backend | Usage |
|---|---|---|---|
| **APP-12-RssArchiver** | 5.7.4 | `techdb` | moteur unique de curation éditoriale (DAG `rss-editorial`, 12 handlers, Pipeline Studio) |
| **APP-17-BilanSocle** | 5.8.0 | `memory` | parcours de bilan de compétences : étapes humaines (`H`) résolues par `human_resolve` |
| APP-06-NotionSocle | 5.8.9 | `memory` | moteur de workflows d'ingestion |
| APP-16-REGIES | 5.8.0 | `memory` | atelier de décomposition (un prompt = une étape) |
| APP-21-TheDiffuseur | 5.8.6 | `memory` | plans de diffusion |

## Écarts entre la documentation du pack et le code

Le code fait foi. Le détail figure dans chaque HOWTO.

- **24 actions** dans `PipelineWorker`. Le README et `socle-pack.json` en listent 21 : `catalogue_set_category`, `get_graph` et `list_handlers` y manquent.
- **15 tests** (10 + 3 NATS + 2 `CollectSinkHandler`). Le README en annonce 10.
- Le README annonce un framework 5.7.4 ; le `pom.xml` compile contre **5.8.0**.
- **Contrats E/S** : le README parle de contrats validés. Le code vérifie à l'exécution des **JSON Pointers obligatoires** (`params.requiredIn`) et compare à la validation des **noms** de contrat. La validation JSON Schema prévue par la SPEC n'existe pas.
- La SPEC prévoit `triggers` et `phases` dans le DAG, et des boucles bornées. Aucun des trois n'est modélisé : les deux premiers champs sont **ignorés en silence** et un cycle est refusé (V1).
- Les actions MCP s'appellent `pipeline_worker__<action>`, pas `pipeline_<action>` comme dans la SPEC.
- Une queue par **nœud consommateur** (`q.<runKey>.<stageId>`), et non par arête comme le dit la SPEC.
- `jnats` est déclaré `provided` comme une option du backend `nats` ; il est en réalité **requis au
  démarrage** quel que soit le backend.
- La SPEC décrit le parking Human comme un « claim sans ack » de V2 ; le code parque en mémoire et trace en
  base (`tr_pipeline_stage_run.status = parked`).

## Limites constatées au code (2026-10-28)

| Limite | Effet | HOWTO |
|---|---|---|
| Dédup marquée **avant** le handler | les relances V2 (exception, dépassement de délai) sont jetées et comptées réussies ; perte silencieuse. Mesuré chez RssArchiver (16 556 éléments bloqués, 2026-10-26) | [[howto-pipeline-06-idempotence-backfill-et-dlq\|06]] §7 |
| Aucune fin automatique d'un run `batch` | `status = running` à vie ; seul `run_status.drained` signale la fin | [[howto-pipeline-04-executer-un-run\|04]] |
| Run `step` marqué `completed` avec des étapes H en attente | statut trompeur | [[howto-pipeline-05-human-in-the-loop-et-reprise\|05]] |
| Index uniques neutralisés par `x_partition` NULL sur `db_pipeline_type` et `db_pipeline_catalogue` | doublons possibles (V002 ne corrige que les runs) | [[howto-pipeline-02-declarer-valider-publier-un-dag\|02]], [[howto-pipeline-08-catalogue-fork-et-sous-pipelines\|08]] |
| Multi-tenant : `x_partition` jamais posé, aucune requête filtrée | pas d'isolation par tenant dans le pack | [[howto-pipeline-07-observer-lineage-et-metriques\|07]] |
| `visibility` du catalogue stockée, jamais appliquée | `catalogue_list` rend tout | 08 |
| Aucune purge des tables `tr_pipeline_*` ni des streams NATS | croissance sans borne | 07, [[howto-pipeline-09-backend-nats-jetstream\|09]] |
| `context_params` stocké mais transmis à aucun handler | donnée inutilisable par les étapes | 04 |
| Le nom de bean `pipelineProperties` entre en collision avec le socle ≥ 5.8.6 | l'app ne démarre pas sans générateur de noms | [[howto-pipeline-01-integrer-le-pack\|01]] §6 |
