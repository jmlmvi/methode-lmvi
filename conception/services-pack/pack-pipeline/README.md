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
| Artefact | `eu.lmvi:socle-pack-pipeline:`**`0.4.0`** |
| Dépôt | `/opt/2026-TheHub4TheSocle/socle-pack-pipeline` (git autonome, `github.com/jmlmvi/socle-pack-pipeline`) |
| Réf. documentée | **`main` @ `2e477c2`** (2026-10-28), tag **`v0.4.0`** — code identique à 0.3.0 (`fef144d`, tag `v0.3.0` posé sur `db7881f` ; `fef144d` n'y ajoute que le manifeste et le pom de test). Précédente lignée : `v0.2.0` @ `cd47a4d` |
| Compilé contre | parent **`eu.lmvi:socle-v005-parent` 5.11.0** (fils de Spring Boot **4.1.2** ; fournit `${socle.version}`, `socle-v005-bom` et la règle enforcer `socle-versions-testees`), `socle-v005` **5.11.0** (`provided`). `jnats` 2.19.1 (`provided`, non géré par Boot 4.1.2) |
| Manifeste | `META-INF/socle-pack.json`, `minSocleVersion` **5.10.0**, `builtAgainstSocleVersion` 5.11.0, `springBootVersion` 4.1.2, **24 actions** listées |
| Tests | 15 verts, 0 sauté ; règle enforcer passée |
| Journalisation | Log4j2 seul : depuis 0.3.0 le pack n'apporte plus Logback (`spring-boot-starter-logging` venait par `spring-boot-starter-jdbc`, en portée compile) |
| Jackson | Jackson 2 (`com.fasterxml`, `provided`), comme le socle et les packs tenant/mail/ai. Le pack n'a aucun contrôleur HTTP : le Jackson 3 de Boot 4 ne voit jamais ses `JsonNode` |
| Où trouver le JAR | **uniquement `~/.m2` de la box de build** (`mvn install` du 2026-10-28). Aucun `mvn-repo/` vendorisé, et le dépôt `maven.thesocle.net` ne le sert pas |

| Version pack | Spring Boot | socle-v005 |
|---|---|---|
| **0.4.0** | **4.1.2** | **5.10.0** et suivants (construit contre 5.11.0) |
| 0.3.0 | 4.1.2 | 5.10.0 et suivants — ⚠️ amène `disruptor` 3.4.4 dans l'app (voir Limites) |
| 0.2.0 (dernière Boot 4.0.6) | 4.0.6 | 5.8.4 → 5.9.x |
| 0.1.0-SNAPSHOT (dernière Boot 3) | 3.2.1 | 5.7.4 → 5.8.0 |

**Dernière version Boot 3 = `0.1.0-SNAPSHOT`** (branche `feat/p1-p4-dag-engine` @ `5fa8f05`, Spring Boot 3.2.1,
socle 5.8.0) — pour les apps restées en Boot 3.2.1 (RssArchiver, REGIES, BilanSocle). Elle n'est plus
modifiée. Une app Boot 4.0.6 (socle 5.8.4 → 5.9.x) prend 0.2.0 ; une app montée en socle 5.10.x-5.11.x prend 0.4.0.

**0.4.0 ne change aucun code** (lignée « Socle 5.10-5.11 · Boot 4.1.2 », comme 0.3.0) : parent
`socle-v005-parent` 5.11.0 (`<socle.version>`, `<testcontainers.version>` et l'import `testcontainers-bom` retirés
du pom), et retrait de `com.lmax:disruptor:3.4.4` déclaré en portée **compile** — il passait dans l'app et y
battait la 4.0.0 du socle (règle du plus proche). Le pack n'utilise pas Disruptor.

**0.3.0 ne change aucun code** : l'API Pipeline V2 du socle (`eu.lmvi.socle.pipeline.*`) et
`eu.lmvi.socle.config.PipelineProperties` sont identiques en 5.9.0 et 5.10.0 (signatures comparées au bytecode),
et les classes nouvelles du socle 5.10.0 ne croisent aucun nom `pipelinePack*`.

**0.2.0 corrige la collision `pipelineProperties`** avec le socle ≥ 5.8.6 : tous les beans du pack portent un
nom explicite `pipelinePack*` (`pipelinePackProperties`, `pipelinePackWorker`, `pipelinePackRepository`,
`pipelinePackDagBuilder`, `pipelinePackRuntimeManager`, …). Plus besoin de générateur de noms dans l'app.
Prouvé par `PackContexteSocleTest` (contexte Spring socle + pack, vrai PostgreSQL ; socle 5.11.0 / Boot 4.1.2 en 0.4.0, 5.10.0 en 0.3.0).

Le contenu fonctionnel est celui de `feat/p1-p4-dag-engine` : `V002__run_key_unique.sql` (index unique partiel
`NULLS NOT DISTINCT`, PostgreSQL ≥ 15) et `instantiate` **idempotent sur `run_key`** sont inclus.

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
| `socle-v005` ≥ 5.10.0 (Boot 4.1.2) en 0.4.0 et 0.3.0 ; 5.8.4 → 5.9.x en 0.2.0 ; 5.7.4 → 5.8.0 en 0.1.0-SNAPSHOT (Boot 3) | **fournie par l'app** (`provided`) ; Pipeline V2, Worker, ActionProvider, TechDB |
| PostgreSQL ≥ **15** | **obligatoire** : 6 tables `db_/tr_pipeline_*` + registre `z_pack_migrations`, dans `socle.pipeline.schema`. `V002` exige `NULLS NOT DISTINCT` |
| `spring-boot-starter-jdbc` | tirée par le pack (`JdbcTemplate`, `DataSource` de l'app), **sans** `spring-boot-starter-logging` depuis 0.3.0 |
| OkHttp | **aucune** : le pack n'en dépend pas. Le socle (5.10.0 et 5.11.0) apporte `com.squareup.okhttp3:okhttp-jvm` 5.5.1 |
| Disruptor | **aucune** depuis 0.4.0 : la 4.0.0 vient du socle. Jusqu'en 0.3.0, `disruptor` 3.4.4 en portée compile |
| TechDB H2 du framework | seulement si `queue-backend=techdb` (défaut) |
| client NATS `io.nats:jnats` 2.19.1 | **toujours requis à l'exécution**, même sans NATS : `DagPipelineBuilder` le référence dans ses signatures et le pack le déclare `provided`. Un serveur JetStream n'est nécessaire que si `queue-backend=nats` |
| Autres packs | aucune |

## Apps qui l'embarquent (2026-10-28)

| App | Socle (Boot) | Backend | Usage |
|---|---|---|---|
| **APP-12-RssArchiver** | 5.7.4 (Boot 3) → reste en 0.1.0-SNAPSHOT | `techdb` | moteur unique de curation éditoriale (DAG `rss-editorial`, 12 handlers, Pipeline Studio) |
| **APP-17-BilanSocle** | 5.8.0 (Boot 3) → reste en 0.1.0-SNAPSHOT | `memory` | parcours de bilan de compétences : étapes humaines (`H`) résolues par `human_resolve` |
| APP-06-NotionSocle | 5.8.9 (Boot 4) → **peut passer en 0.2.0** | `memory` | moteur de workflows d'ingestion |
| APP-16-REGIES | 5.8.0 (Boot 3) → reste en 0.1.0-SNAPSHOT | `memory` | atelier de décomposition (un prompt = une étape) |
| APP-21-TheDiffuseur | 5.8.6 (Boot 4) → **peut passer en 0.2.0** (et retirer `NomsDesPacks` s'il ne sert qu'au pack) | `memory` | plans de diffusion |

## Écarts entre la documentation du pack et le code

Le code fait foi. Le détail figure dans chaque HOWTO.

- **24 actions** dans `PipelineWorker`. Jusqu'en 0.2.0, le README et `socle-pack.json` n'en listaient que 21 (`catalogue_set_category`, `get_graph`, `list_handlers` manquaient) — **corrigé en 0.3.0**.
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
| Le nom de bean `pipelineProperties` entre en collision avec le socle ≥ 5.8.6 — **corrigé en 0.2.0** (beans `pipelinePack*`) ; reste vrai pour 0.1.0-SNAPSHOT | une app Boot 3 n'est pas concernée (socle ≤ 5.8.0) | [[howto-pipeline-01-integrer-le-pack\|01]] §6 |
| Le pom du socle 5.10.0 annonce gRPC 1.85.1, H2 2.5.252, Jedis 8.0.2 ; une app au parent Boot 4.1.2 reçoit **gRPC 1.84.1, H2 2.4.240, Jedis 7.4.1** (la nomenclature Boot l'emporte sur les versions transitives) — **corrigé côté socle** par `socle-v005-bom` 5.10.1 et le parent `socle-v005-parent` 5.11.0 | app au parent `socle-v005-parent` : versions du socle reçues ; app qui garde son parent Boot : importer le BOM et surcharger cinq propriétés | [[howto-pipeline-01-integrer-le-pack\|01]] §4 |
| Pack **≤ 0.3.0** : `disruptor` 3.4.4 déclaré en portée compile — **corrigé en 0.4.0** | l'app reçoit disruptor 3.4.4 au lieu de la 4.0.0 du socle (règle du plus proche) | prendre 0.4.0, ou déclarer `com.lmax:disruptor:4.0.0` dans l'app — [[howto-pipeline-01-integrer-le-pack\|01]] §11 |
