# socle-pack-editorial — HOWTOs

**Le pack en cinq lignes.**
`eu.lmvi:socle-pack-editorial` donne à une application V005 un pipeline de veille éditoriale :
collecte de flux RSS/Atom → curation par LLM (score, résumé, routage par seuils) → enrichissement
(corps complet, bibliographie, 5W1H, traduction, KEW, RAG) → validation humaine facultative → newsletters
HTML envoyées par e-mail. Quatre workers, 31 actions MCP, huit tables PostgreSQL migrées au démarrage.
Il s'appuie sur `socle-pack-ai` (LLM, web, RAG) et `socle-pack-comm` (e-mail, relances), qu'il ne
remplace pas.

---

## Version documentée

| | |
|---|---|
| Artefact | `eu.lmvi:socle-pack-editorial:**2.2.0**` (`socle-pack.json` : `2.2.0`, 31 actions, `builtAgainstSocleVersion` 5.11.0, `minSocleVersion` 5.10.0) |
| Dépôt | `/opt/2026-TheHub4TheSocle/socle-pack-Editorial` — `github.com/jmlmvi/socle-pack-Editorial` |
| Référence git | **`main`** @ **`1dbb5c4`**, tag **`v2.2.0`** (2026-10-28), poussé ; **code identique à 2.1.0** (`1fb6c6a`, tag `v2.1.0`) : seul le build change |
| Construit contre | parent **`eu.lmvi:socle-v005-parent` 5.11.0** (fils de Spring Boot **4.1.2** ; fournit `${socle.version}`, importe `socle-v005-bom` — gRPC 1.85.1, Testcontainers 1.21.4 — et la règle enforcer `socle-versions-testees`), `socle-v005:5.11.0` (`provided`), `socle-pack-ai:2.9.0`, `socle-pack-comm:2.2.0` (tous deux `provided` ; ai 2.8.0 et comm 2.1.0 restent acceptés côté app) ; OkHttp = `okhttp-jvm` 5.5.1 du socle (`provided`) |
| Compatibilité | **2.2.0** et **2.1.0** → socle 5.10.x et 5.11.x / Boot 4.1.2 (lignée « Socle 5.10-5.11 · Boot 4.1.2 ») ; 2.1.0 = tag `v2.1.0`, construite contre socle 5.10.0, ai 2.8.0, comm 2.1.0 |
| Version précédente (Boot 4.0) | **2.0.0** — tag `v2.0.0` (`main` @ `8879bf7`) : Boot 4.0.6, socle 5.8.8-5.9.x, ai 2.7.x, comm 2.0.0 |
| Dernière version Boot 3 | **`1.0.0-SNAPSHOT`** — `main` @ `fffd6f9` (2026-10-10) : socle 5.7.4, Boot 3.2.1, ai 2.3.3, comm 1.0.0-SNAPSHOT. Les apps Boot 3 (RssArchiver) y restent |
| Tests | 18 classes, **67 tests verts, 0 sauté** (`mvn clean verify`, Testcontainers pgvector ; enforcer passé) dont `DemarrageContexteSpringTest` : vraie `SpringApplication` Boot 4.1 + socle 5.11.0 + ai 2.9.0 + comm 2.2.0 (en 2.1.0 : socle 5.10.0 + ai 2.8.0 + comm 2.1.0), générateur de noms par défaut, MOP `RUNNING` ; `HitlWorker`, `RssCollectWorker`, `NewsletterRenderer` sans test unitaire |
| Vérifié au code | 2026-10-28 |

**Comment une application l'obtient.** Aucune version n'est publiée (ni `maven.thesocle.net`, ni
`mvn-repo/` vendorisé). L'application construit le pack depuis le tag voulu — `v2.2.0` ou `v2.1.0` (socle 5.10-5.11,
Boot 4.1.2), `v2.0.0` (socle 5.8.8-5.9.x, Boot 4.0.6) ou le commit `fffd6f9` (1.0.0-SNAPSHOT, Boot 3)
— (`mvn install`) puis vendorise
le jar et le pom dans son propre `mvn-repo/` — [[howto-editorial-01-integrer-le-pack|EDITORIAL-01 §3]].
Une branche `master` diverge de `main` (28 commits propres) : ne pas construire depuis elle.

---

## Ce qui est prêt, ce qui ne l'est pas

| Fonctionnalité | État |
|---|---|
| Collecte RSS (poller, politesse par hôte, GET conditionnel, réessai auto des sources en erreur) | **prêt**, éprouvé en production (RssArchiver) |
| Enrichissements (`WebWorker`, bibliographie, 5W1H, traduction, KEW, RAG) | **prêt**, éprouvé en production avant la migration de RssArchiver vers son pipeline DAG |
| Curation et routage par seuils | **prêt** ; à déclencher par l'application (worker passif) ; `update_curation_config` en échec depuis `V999z` |
| Newsletters (rendu, envoi, historique, planification) | **fonctionnel**, sans usage connu en production ; prompt d'intro et désabonnement à fournir par l'app |
| HITL — décisions manuelles | **fonctionnel** à la lecture du code, non testé |
| HITL — relances, escalades, timeouts | **défaillant** : `NullPointerException` à chaque tick dès le premier délai dépassé |
| Multi-tenant | **non prêt** : trigger `x_partition` posé, RLS différée, tenant non propagé entre packs |

---

## Besoin → HOWTO

| J'ai besoin de… | HOWTO |
|---|---|
| ajouter le pack à mon application (pom, scan, schéma, secrets, vérification) | [[howto-editorial-01-integrer-le-pack\|EDITORIAL-01 — Intégrer le pack]] |
| relever des flux RSS/Atom et stocker les nouveaux articles | [[howto-editorial-02-collecter-des-flux-rss\|EDITORIAL-02 — Collecter des flux RSS]] |
| trier automatiquement les articles par pertinence, avec résumé | [[howto-editorial-03-curer-et-router-les-articles\|EDITORIAL-03 — Curer et router les articles]] |
| obtenir le texte intégral, les entités, une traduction, une indexation RAG | [[howto-editorial-04-enrichir-les-articles-publies\|EDITORIAL-04 — Enrichir les articles publiés]] |
| faire valider la zone grise par un humain | [[howto-editorial-05-valider-en-hitl\|EDITORIAL-05 — Valider en HITL]] |
| envoyer une lettre d'information périodique | [[howto-editorial-06-envoyer-des-newsletters\|EDITORIAL-06 — Envoyer des newsletters]] |

---

## Dépendances vers d'autres packs

| Pack | Ce qu'Editorial utilise | Présence |
|---|---|---|
| `socle-pack-ai` **2.9.0** (socle 5.10-5.11, 2.8.0 accepté ; 2.7.x pour Boot 4.0.6 ; 2.4.x pour Boot 3) — [[howto-ai-01-integrer-le-pack\|AI-01]] | `GenerationWorker.generateOne` (score, résumé, intro), `FiveW1HService`, `TranslationService`, `WebWorker.fetch_smart`, `RagWorker.ingest_document` ; prompts `classify_generic`, `generate_summary` | jar **obligatoire** ; `GenerationWorker` requis si `curation_worker` actif ; le reste facultatif |
| `socle-pack-comm` **2.2.0** (socle 5.10-5.11, 2.1.0 accepté ; 2.0.0 pour Boot 4.0.6 ; 1.x pour Boot 3) — [[howto-com-01-integrer-le-pack\|COM-01]] | `NotifyWorker.sendNotification` ; types `HITL_REMINDER`, `NEWSLETTER` | jar **obligatoire** ; bean facultatif (sans lui : ni relance, ni envoi) |
| Service Hub **KEW** (APIM `api.thesocle.net`) | extraction mots-clés / Wikidata | facultatif, clé APIM — [[howto-39-provisionner-une-cle-apim-pour-une-app\|HOWTO 39]] |

---

## Applications consommatrices

| Application | Usage |
|---|---|
| **APP-12-RssArchiver** (`rssarchiver/pom.xml`, Boot 3.2.1, socle 5.7.4, pack-ai 2.7.7 — reste sur editorial **1.0.0-SNAPSHOT**) | collecte RSS du pack ; `curation_worker` **désactivé** (`SOCLE_EDITORIAL_CURATION_WORKER_ENABLED=false`) ; réutilise `CurationConfigService`, `KewClient`, `BibliographicExtractor`, `ArticleBodyFetcher` dans son pipeline DAG (`eu.lmvi.pipeline.CurationSteps`) |
| `APP-RAG-INDEPENDANT/02-sources/domain-pack-editorial` | **pas un consommateur** : une copie ancienne du pack (socle 5.2.0) sous les **mêmes coordonnées Maven** — à ne pas installer |

---

## Écarts relevés entre la documentation du pack et son code

Le code fait foi ; chaque écart est repris dans les « Pièges courants » du HOWTO concerné.

- ~~README : 35 actions ; code : 31. README : dépendances ai/comm en `1.0.0-SNAPSHOT` ; pom : ai 2.3.3.~~
  **Corrigé en 2.0.0** : README, manifeste et pom disent 31 actions, ai 2.7.x, comm 2.0.0.
- README / exemples `curl …/api/actions/<worker>__<action>` sur l'app : cette porte est celle du Hub.
- README / CLAUDE.md : `ClassificationWorker` fait le score ; code : `GenerationWorker` + prompt `scoring_prompt_id`.
- CLAUDE.md : un article accepté en HITL est ingéré au RAG ; code : non, ni enrichi.
- HOWTO 28 : « mode dégradé silencieux » sans ai/comm ; code : `NoClassDefFoundError` sans les jars.
- `languages` (curation), `rag.default-source-type`, `db_source_rss.content_type`, `from_email`/`from_name`
  (newsletter) : déclarés, jamais lus.
- `ENV-REFERENCE.md` ne couvre pas `kew.*`, `newsletter.base-url|unsubscribe-secret|scheduler-*`,
  `rss.min-content-chars-for-fetch|always-fetch-body`.

---

## Construction socle 5.11.0 (2.2.0) — ce qu'elle change pour l'app

- **Rien au code ni à l'API** : 2.2.0 = code de 2.1.0, construit contre socle 5.11.0, ai 2.9.0, comm 2.2.0 ;
  socle minimum toujours **5.10.0**. 2.1.0 reste valide en socle 5.10.x et 5.11.x.
- **Parent `eu.lmvi:socle-v005-parent` 5.11.0** recommandé pour l'app : il aligne gRPC, H2, Jedis, Kafka et
  les pilotes sur les versions du socle — plus d'import `grpc-bom` ni `testcontainers-bom`, plus de
  `<socle.version>` local. App qui garde son parent : `socle-v005-bom` 5.11.0 importé + `h2.version`,
  `jedis.version`, `kafka.version`, `mysql.version`, `mariadb.version` surchargées
  ([[howto-editorial-01-integrer-le-pack|EDITORIAL-01 §4]]).
- **Enforcer** : ne déclarer aucune `<configuration>` de `maven-enforcer-plugin` dans le pom de l'app
  (elle effacerait sans message les bornes du parent) ; une règle de plus = une autre `<execution>`.

## Montée socle 5.10 / Boot 4.1.2 (2.1.0) — ce qu'elle change pour l'app

- **Trois packs à monter ensemble** : editorial 2.1.0 + ai 2.8.0 + comm 2.1.0, socle ≥ 5.10.0, Boot 4.1.2.
- **OkHttp** : le pack n'embarque plus `okhttp:4.12.0` ; il prend `okhttp-jvm` 5.5.1 du socle
  (`provided`). Une app qui déclare encore `okhttp` 4.x a deux copies de `okhttp3.*` : la retirer.
- **Noms de beans préfixés** `editorial*` (`editorialPackMigrationRunner`, `editorialTenantResolver`,
  `editorialKewClient`, `editorialCurationWorker`…, table complète dans le README du pack). Avec ai
  `ai*` et comm `comm*`, le **`FullyQualifiedAnnotationBeanNameGenerator` n'est plus nécessaire**
  (vérifié par `DemarrageContexteSpringTest`, générateur par défaut). Une app qui injecte par nom
  (`@Qualifier("curationWorker")`, `getBean("kewClient")`) doit prendre le nouveau nom ; par type :
  rien à changer. Noms de workers MCP et d'actions inchangés.
- **gRPC** : `grpc-bom` 1.85.1 (Boot 4.1.2 gère 1.84.1) — depuis 2.2.0, apporté par le parent `socle-v005-parent` ; **disruptor** : celui du socle (4.0.0).
- **Inchangés** : actions MCP, propriétés `socle.editorial.*`, variables d'environnement, migrations SQL,
  code fonctionnel. Les défauts listés plus haut (HITL `sendReminders` NPE, `update_curation_config`…)
  ne sont **pas** corrigés par la 2.1.0.

## Migration Boot 4 (2.0.0) — ce qu'elle a résolu, ce qu'elle impose

- **API pack-ai inchangée** pour ce pack entre 2.3.3 et 2.7.13 (comparée par `javap`) : aucun changement
  du code principal. Seuls les câblages manuels changent : `AgentIaLlmProvider(…, ResilienceFactory)`,
  `StrategyDetector(…, SymbolJavaChunker)`.
- **Journalisation** : sous Boot 4, `spring-boot-starter-jdbc` apporte `log4j-to-slf4j` ; il faut y
  exclure `spring-boot-starter-logging` (le pack le fait ; l'app hôte aussi) —
  [[howto-editorial-01-integrer-le-pack|EDITORIAL-01 §4]].
- **`ObjectMapper` Jackson 2** : Boot 4 n'en fournit plus ; le web de pack-ai l'exige ; c'est
  `SocleJacksonConfiguration` du socle qui le déclare → l'app doit balayer `eu.lmvi.socle` (§5 d'EDITORIAL-01).
- **Jackson 3 côté HTTP** : le pack ne rend que des Map/List/scalaires (taxonomie KEW convertie en Map) ;
  aucun `JsonNode` ne sort, pas de contrôleur.
- **Inchangés** : actions MCP, propriétés `socle.editorial.*`, variables d'environnement, migrations SQL.
  Les défauts fonctionnels listés plus haut (HITL `sendReminders` NPE, `update_curation_config`…) ne
  sont **pas** corrigés par la 2.0.0.
