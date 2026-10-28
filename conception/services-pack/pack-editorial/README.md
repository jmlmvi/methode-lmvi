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
| Artefact | `eu.lmvi:socle-pack-editorial:1.0.0-SNAPSHOT` (`socle-pack.json` annonce `1.0.0`) |
| Dépôt | `/opt/2026-TheHub4TheSocle/socle-pack-Editorial` — `github.com/jmlmvi/socle-pack-Editorial` |
| Référence git | branche **`main`** @ **`fffd6f9`** (2026-10-10, « chore: sauvegarde de session — paquet fetch ») |
| Compilé contre | `socle-v005:5.7.4`, Spring Boot **3.2.1**, `socle-pack-ai:2.3.3`, `socle-pack-comm:1.0.0-SNAPSHOT` |
| Tests | 17 classes, tous verts au dernier rapport Surefire ; `HitlWorker`, `RssCollectWorker`, `NewsletterRenderer` sans test |
| Vérifié au code | 2026-10-28 |

**Comment une application l'obtient.** Aucune version n'est publiée (ni `maven.thesocle.net`, ni
`mvn-repo/` vendorisé). L'application construit le pack depuis `main` (`mvn install`) puis vendorise
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
| `socle-pack-ai` — [[howto-ai-01-integrer-le-pack\|AI-01]] | `GenerationWorker.generateOne` (score, résumé, intro), `FiveW1HService`, `TranslationService`, `WebWorker.fetch_smart`, `RagWorker.ingest_document` ; prompts `classify_generic`, `generate_summary` | jar **obligatoire** ; `GenerationWorker` requis si `curation_worker` actif ; le reste facultatif |
| `socle-pack-comm` — [[howto-com-01-integrer-le-pack\|COM-01]] | `NotifyWorker.sendNotification` ; types `HITL_REMINDER`, `NEWSLETTER` | jar **obligatoire** ; bean facultatif (sans lui : ni relance, ni envoi) |
| Service Hub **KEW** (APIM `api.thesocle.net`) | extraction mots-clés / Wikidata | facultatif, clé APIM — [[howto-39-provisionner-une-cle-apim-pour-une-app\|HOWTO 39]] |

---

## Applications consommatrices

| Application | Usage |
|---|---|
| **APP-12-RssArchiver** (`rssarchiver/pom.xml`, socle 5.7.4, pack-ai 2.7.7) | collecte RSS du pack ; `curation_worker` **désactivé** (`SOCLE_EDITORIAL_CURATION_WORKER_ENABLED=false`) ; réutilise `CurationConfigService`, `KewClient`, `BibliographicExtractor`, `ArticleBodyFetcher` dans son pipeline DAG (`eu.lmvi.pipeline.CurationSteps`) |
| `APP-RAG-INDEPENDANT/02-sources/domain-pack-editorial` | **pas un consommateur** : une copie ancienne du pack (socle 5.2.0) sous les **mêmes coordonnées Maven** — à ne pas installer |

---

## Écarts relevés entre la documentation du pack et son code

Le code fait foi ; chaque écart est repris dans les « Pièges courants » du HOWTO concerné.

- README : 35 actions ; code : **31**. README : dépendances ai/comm en `1.0.0-SNAPSHOT` ; pom : ai **2.3.3**.
- README / exemples `curl …/api/actions/<worker>__<action>` sur l'app : cette porte est celle du Hub.
- README / CLAUDE.md : `ClassificationWorker` fait le score ; code : `GenerationWorker` + prompt `scoring_prompt_id`.
- CLAUDE.md : un article accepté en HITL est ingéré au RAG ; code : non, ni enrichi.
- HOWTO 28 : « mode dégradé silencieux » sans ai/comm ; code : `NoClassDefFoundError` sans les jars.
- `languages` (curation), `rag.default-source-type`, `db_source_rss.content_type`, `from_email`/`from_name`
  (newsletter) : déclarés, jamais lus.
- `ENV-REFERENCE.md` ne couvre pas `kew.*`, `newsletter.base-url|unsubscribe-secret|scheduler-*`,
  `rss.min-content-chars-for-fetch|always-fetch-body`.
