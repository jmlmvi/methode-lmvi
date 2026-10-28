# socle-pack-ai — HOWTOs par fonctionnalité

> **Version documentée :** `eu.lmvi:socle-pack-ai:2.7.14` — branche `main` du dépôt
> `/opt/2026-TheHub4TheSocle/socle-pack-ai`. Dernier commit de code : `a357a95` (2026-10-16,
> « AgentToolBridge résout le registre à l'usage — 2.7.14 ») ; `main` locale est à `8249cd3`
> (2026-10-23, deux commits de documentation en plus, aucun changement de code).
> **Socle :** compilé contre `socle-v005` **5.8.8**, Spring Boot **4.0.6** (scope `provided`).
> **Vérifié au code le 2026-10-28.**

## Le pack en cinq lignes

1. **Génération de texte** par prompts versionnés en base (`z_config_ia`), quatre fournisseurs
   (`agentia`, `anthropic`, `openai`, `ollama`), cascade de repli, plafonds financiers.
2. **Embeddings** multi-fournisseurs (`http`, `openai`, `ollama`) avec cache persistant.
3. **RAG complet** dans PostgreSQL + pgvector : découpage, recherche hybride (cosinus + BM25 +
   RRF), élargissement aux voisins, réponse rédigée avec citations `[N]`.
4. **Capacités prêtes** : classification avec retour utilisateur, résumé 5W1H, traduction,
   transcription audio, rédaction de documentation, lecture du web (cascade 4 étages + recherche).
5. **Plateforme d'agents** (lignée 2.x, partielle) : passerelle LLM 13 fournisseurs en flux,
   boucle agent, sessions persistées, outils = actions MCP, gRPC-Web.

Le pack embarque **10 workers concrets** (plus la classe abstraite `AbstractAgentWorker`) et **27 migrations SQL** (`db/ai/V*.sql`), toutes appliquées au
démarrage par `PackMigrationRunner`.

## Besoin → HOWTO

| Je veux… | HOWTO |
|---|---|
| Ajouter le pack à mon app, régler schéma, secrets, vérifier au dashboard | [[howto-ai-01-integrer-le-pack\|AI-01 — Intégrer le pack]] |
| Générer un texte (résumé, analyse, JSON) à partir d'un prompt versionné | [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes\|AI-02 — Générer du texte]] |
| Vectoriser des textes (bge-m3 par l'APIM, OpenAI, Ollama) | [[howto-ai-03-calculer-des-embeddings\|AI-03 — Embeddings]] |
| Indexer un corpus et répondre aux questions avec citations | [[howto-ai-04-construire-un-rag-ingerer-et-interroger\|AI-04 — RAG]] |
| Étiqueter / noter des items et apprendre des rejets | [[howto-ai-05-classifier-avec-retour-utilisateur\|AI-05 — Classification]] |
| Résumer en 5W1H, traduire, transcrire un audio, rédiger une doc | [[howto-ai-06-resumer-traduire-transcrire-documenter\|AI-06 — Capacités prêtes]] |
| Lire une page web, un PDF, chercher sur le web, piloter un navigateur | [[howto-ai-07-lire-le-web-fetch-recherche-navigateur\|AI-07 — Web]] |
| Construire un agent qui appelle des outils MCP en boucle | [[howto-ai-08-construire-un-agent-llm-gateway-et-sessions\|AI-08 — Agents]] |
| Mon app est en Spring Boot 3.2.1 | [[howto-ai-09-lignee-2-4-x-pour-les-apps-boot-3\|AI-09 — Lignée 2.4.x]] |

## Workers embarqués (2.7.14)

| Worker | Type | Actions MCP | HOWTO |
|---|---|---|---|
| `generation_worker` | PASSIVE | `generate`, `generate_batch`, `preview`, `get_status` | AI-02 |
| `embedding_worker` | PASSIVE | `embed_text`, `embed_batch`, `list_providers`, `get_status` | AI-03 |
| `rag_worker` | PASSIVE | `ingest_document`, `ingest_batch`, `search`, `search_chunks`, `get_document`, `delete_document`, `reindex_all`, `get_stats`, `get_status` | AI-04 |
| `classification_worker` | PASSIVE | `classify_item`, `classify_batch`, `retag_item`, `submit_feedback`, `get_quality_metrics`, `get_status` | AI-05 |
| `web_worker` | PASSIVE | `fetch`, `search`, `fetch_browserless`, `fetch_playwright`, `fetch_flaresolverr`, `fetch_smart`, `parse_doc`, `get_status` | AI-07 |
| `browser_worker` | PASSIVE | `browse`, `get_status`, `flush_pool` | AI-07 |
| `llm_gateway_worker` | PASSIVE | `stream_complete`, `complete_blocking`, `list_providers`, `list_models`, `model_info`, `model_pricing`, `get_status`, `test_provider` | AI-08 |
| `agent_toolset` | PASSIVE | `tool_search`, `reindex_tools` | AI-08 |
| `workspace_manager_worker` | PASSIVE | `create_workspace`, `get_workspace`, `list_workspaces`, `update_quota`, `mark_synced`, `expire_workspace`, `get_status` | AI-08 |
| `workspace_gc_worker` | CRON | — | AI-08 |

Les services Java sans worker (`FiveW1HService`, `TranslationService`, `HttpTranscriptionProvider`,
`DocumentationGenerator`, `MultiAxisEmbeddingService`) sont décrits dans AI-03 et AI-06.

## Dépendances

- **Vers d'autres packs : aucune.** Le manifeste déclare `"dependencies": []`.
- **Packs qui dépendent de celui-ci :** `socle-pack-editorial` (s'appuie sur la génération, la
  classification, le 5W1H et la traduction) et `socle-pack-mail`.
- **Vers le Hub (services consommés, pas réimplémentés) :** AgentIA par l'edge APIM
  (`https://api.thesocle.net/agentia/v1`), embeddings `embed-std`, transcription
  (`/transcription/v1`), `hub-docs-parser`, Playwright / browserless / flaresolverr mutualisés,
  coffre et injection d'environnement (`vault_worker`, `docker_worker`).

## Apps consommatrices relevées le 2026-10-28

| App | Version du pack | Boot | Ce qu'elle emploie |
|---|---|---|---|
| `APP-31-LeSachant` | 2.7.13 | 4.0.6 | RAG complet, `DocumentationGenerator` — **exemple de référence RAG** |
| `APP-26B-IdeaBoxDev` | 2.7.5 (vendorisée) | 4.0.6 | `GenerationWorker` + prompt seedé — **exemple de référence génération** |
| `APP-12-RssArchiver` | 2.7.7 | 3.2.1 (pom de la copie de travail) | génération, 5W1H, traduction, web |
| `APP-25-UniqPersonnality`, `APP-06-NotionSocle` | 2.5.0 | 4.0.6 | fournisseur AgentIA seul |
| `APP-18-SDR2` | 2.4.8 | 3.2.1 | fournisseurs LLM et embedding (lignée 2.4.x) |
| `APP-16-REGIES` / `APP-17-BilanSocle` | 2.4.3 / 2.4.2 | 3.2.1 | fournisseur AgentIA / transcription |
| `APP-08-AgentIA` | 2.3.5 | 3.2.1 | plateforme d'agents (`AbstractAgentWorker`) |

## Écarts documentation ↔ code (le code fait foi)

| Source | Ce qu'elle dit | Ce que fait le code 2.7.14 |
|---|---|---|
| `README.md` du pack | v1.0.0, 4 workers, 23 actions, 8 tables | 10 workers, 51 actions MCP, 27 migrations |
| `README.md` du pack | `curl …/api/actions/rag_worker__search` | une app s'invoque par `POST /mcp` (`tools/call`) ; `/api/actions` est une porte du Hub |
| `CLAUDE.md` du pack | Spring Boot 3.2, socle 5.7.1 | Spring Boot 4.0.6, socle 5.8.8 |
| `socle-pack.json` | version 1.1.0, 7 workers | `web_worker`, `browser_worker`, `agent_toolset` absents du manifeste |
| `socle-pack.json` | « 12 providers + 5 APIs streaming » | 13 fournisseurs (dont `socle_gateway`) ; 4 décodeurs de flux, l'API OpenAI Responses n'en a pas |
| `contexte.md` | « socle 5.0.0, 182 erreurs de compilation » | obsolète (mai 2026) |
| `CascadeFetcher` (javadoc) | seuil de texte exploitable 250 | défaut réel `100` (`socle.ai.web.cascade-min-text-len`) |

Fonctionnalités déclarées et **non branchées** : voir le tableau récapitulatif de chaque HOWTO
(paramètre `filters` ignoré, `socle.ai.chunk.strategy` lu nulle part, `test_provider` en stub,
`MemoryGrpcService` en `UNIMPLEMENTED`, lecture Vault jamais déclenchée pour les clés LLM).
