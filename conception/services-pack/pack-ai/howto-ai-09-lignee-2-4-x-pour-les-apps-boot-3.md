# HOWTO AI-09 — La lignée 2.4.x : socle-pack-ai pour les apps restées en Spring Boot 3.2.1

**Niveau :** Confirmé
**Pack :** lignée `2.4.x`, dernière version **2.4.8** — branche `fix/cache-embeddings-2.4.x`, commit `819a8a7` — comparée à `main` 2.7.14 (`a357a95`) le 2026-10-28
**Socle :** 2.4.8 est compilée contre Spring Boot **3.2.1** et `socle-v005` **5.7.4** (`provided`)
**Prérequis :** app dont le `pom.xml` déclare `spring-boot-starter-parent` 3.2.1
**Temps estimé :** 20 min (choisir et épingler) ; 1 h (porter un correctif)

---

## 1. Contexte

Depuis la **2.5.0** (2026-09-22), `main` est bâtie sur Spring Boot 4.0.6 et le socle 5.8.8. Une app
encore en Boot 3.2.1 ne peut pas l'embarquer : les classes Boot 4 manquent à l'exécution. Pour ces
apps, une **lignée 2.4.x** est entretenue **dans des branches**, sans tag :

| Version | Branche | Commit | Contenu |
|---|---|---|---|
| 2.4.6 | (point de divergence avec `main`) | `567aca3` | seeds de prompts sans doublon (V1105, `NULLS NOT DISTINCT`) |
| 2.4.7 | `fix/web-stats-sans-reseau-2.4.x` | `d7ecc67` | `WebWorker.getStats()` ne sonde plus le réseau |
| 2.4.8 | `fix/cache-embeddings-2.4.x` | `819a8a7` | le cache d'embeddings lit enfin ses lignes (porté de la 2.7.3) |

**Qui la choisit** (pom des copies de travail, 2026-10-28) : `APP-18-SDR2` (2.4.8), `APP-16-REGIES`
(2.4.3), `APP-17-BilanSocle` (2.4.2). `APP-08-AgentIA` est restée en 2.3.5.

> Le `pom.xml` fait foi, pas le WhoAmI de l'app : le CONTEXTE de SDR2 a un temps annoncé Boot 4.0.6
> alors que son pom déclarait 3.2.1.

---

## 2. Architecture

```
            2.4.6 (567aca3, 2026-09-15)
               │
   main ───────┼── 2.5.0 Boot 4.0.6 / socle 5.8.8 ── … ── 2.7.3 (cache embeddings) ── … ── 2.7.14
               │
   lignée 2.4.x└── 2.4.7 fix/web-stats-sans-reseau-2.4.x ── 2.4.8 fix/cache-embeddings-2.4.x
                         (Boot 3.2.1 / socle 5.7.4)
```

---

## 3. Étape 1 — Savoir sur quelle lignée est l'app

```bash
grep -A2 'spring-boot-starter-parent' <app>/pom.xml | grep version     # 3.2.1 → lignée 2.4.x
grep -A3 '<artifactId>socle-pack-ai' <app>/pom.xml | grep version
cd /opt/2026-TheHub4TheSocle/socle-pack-ai && git branch -a | grep 2.4.x
```

---

## 4. Étape 2 — Épingler la 2.4.8

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.1</version>
    <relativePath/>
</parent>

<dependency>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-pack-ai</artifactId>
    <!-- Lignée 2.4.x (Boot 3.2.1). 2.5.0+ = Boot 4.0.6 : hors de portée de cette app. -->
    <version>2.4.8</version>
</dependency>
```

Configuration minimale d'une app qui ne consomme que les **fournisseurs** (patron SDR2) — la V000
de cette lignée écrit encore dans `public`, ce que le compte d'une app du Hub ne peut pas faire :

```yaml
socle:
  ai:
    schema: ${SOCLE_AI_SCHEMA:schema_monapp}
    migrations:
      enabled: false                # V000 2.4.x : CREATE … dans public → permission denied sur le Hub
    llm:
      provider: agentia
    providers:
      agentia-base-url: ${SOCLE_AI_PROVIDERS_AGENTIA_BASE_URL:https://api.thesocle.net/agentia/v1}
      agentia-api-key: ${SOCLE_AI_PROVIDERS_AGENTIA_API_KEY:}
      agentia-app-id: ${SOCLE_AI_PROVIDERS_AGENTIA_APP_ID:monapp}
      agentia-model: ${SOCLE_AI_PROVIDERS_AGENTIA_MODEL:MiniMax-M3}
      timeout-seconds: 120
```

Et exclure du scan les workers qu'elle n'emploie pas (sans configuration, `GenerationWorker` se
déclare `unhealthy` et le superviseur le redémarre en boucle) :

```java
@ComponentScan(basePackages = {"eu.lmvi.socle", "eu.lmvi.monapp"},
    excludeFilters = @ComponentScan.Filter(type = FilterType.REGEX, pattern = {
        "eu\\.lmvi\\.socle\\.pack\\.ai\\.agent\\..*",
        "eu\\.lmvi\\.socle\\.pack\\.ai\\.(Rag|Classification|Generation|Embedding)Worker",
        "eu\\.lmvi\\.socle\\.pack\\.ai\\.(summary|translate|rag)\\..*"
    }),
    nameGenerator = FullyQualifiedAnnotationBeanNameGenerator.class)
```

(Le générateur de noms complets fonctionne en socle 5.7.x / 5.8.0 ; il casse le `@DependsOn` du
socle ≥ 5.8.6 — sujet de la montée de version, pas de la lignée 2.4.x.)

---

## 5. Étape 3 — Ce que la 2.4.8 n'a pas

| Fonctionnalité de `main` | Arrivée en | Dans 2.4.8 |
|---|---|---|
| V000 qui « regarde avant d'écrire » dans `public` | 2.6.0 | non — migrations à couper sur le Hub |
| Six migrations sorties de `public` | 2.7.5 | non |
| Documents sans morceau réingérés au lieu de « DUPLICATE » | `main` (2.5+) | non |
| Embeddings envoyés par lots bornés (`lot-max-textes`, `lot-max-caracteres`) | `main` (2.5+) | non |
| Paramètre `partition` de `rag_worker__search` | `main` (2.5+) | non |
| `search.type-weights`, `answer-limit` ; `voisins`, `voisins-max` | `main` (2.5+) ; 2.7.12 | non |
| `llm.answer-max-tokens` ; `llm.answer-temperature` | `main` (2.5+) ; 2.7.13 | non |
| `chunk.adressage-dans-le-contexte` | 2.7.11 | non |
| `SymbolJavaChunker`, `DocumentationGenerator`, prompts `doc_page_*` (V1107–V1111) | `main` (2.5+) | non |
| `MainContent` (`fetch format=article`, `fetch_smart main_only`) | `main` (2.5+) | non |
| `tr_tool_index` à la dimension configurée (V1106) | `main` (2.5+) | non |
| `AgentToolBridge` à registre différé | 2.7.14 | non |
| `EmbeddingWorker.isHealthy()` indépendant du service distant | 2.4.x déjà | **oui** |
| Cache d'embeddings lisible (`PGvector`) | 2.7.3 / 2.4.8 | **oui** |
| `response_format` transmis au backend | 2.4.5 | **oui** |

Une app qui a besoin de l'une des lignes « non » doit **monter en Boot 4** et passer sur `main`
([[howto-25-upgrader-une-app-socle|HOWTO 25]]), ou faire porter le correctif (étape 4).

---

## 6. Étape 4 — Porter un correctif de `main` sur la lignée

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-ai
git fetch --all
git checkout -b fix/<sujet>-2.4.x fix/cache-embeddings-2.4.x      # partir de la DERNIÈRE branche *-2.4.x
git cherry-pick <commit-de-main>                                  # ou report manuel si conflit Boot 4
sed -i '0,/<version>2.4.8<\/version>/s//<version>2.4.9<\/version>/' pom.xml
mvn -q clean install -DskipTests                                  # Boot 3.2.1 + socle 5.7.4
git commit -am "fix(ai): <sujet> — porté sur la lignée 2.4.x (2.4.9)"
```

Puis épingler `2.4.9` dans l'app, reconstruire, et livrer en recette avant la production.

---

## 7. Vérifier

```bash
unzip -p ~/.m2/repository/eu/lmvi/socle-pack-ai/2.4.8/socle-pack-ai-2.4.8.jar META-INF/maven/eu.lmvi/socle-pack-ai/pom.xml \
  | grep -A1 spring-boot-starter-parent                            # → 3.2.1
docker logs <app> 2>&1 | grep -E 'pack-migration|worker:embedding_worker|unhealthy'
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Démarrage de l'app Boot 3.2.1 avec 2.4.8 | aucun `ClassNotFoundException` Spring |
| 2 | `migrations.enabled=false` | `[worker:pack-migration] désactivé` |
| 3 | Deux embeddings du même texte | le second sort du cache (correctif 2.4.8) |
| 4 | Workers exclus | aucun redémarrage en boucle dans les journaux du superviseur |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Dire « corrigé dans le pack » à une app Boot 3.2.1 | Le correctif est sur `main` (2.5+), inatteignable | Lire le parent Boot du pom ; porter sur 2.4.x |
| Chercher un tag `v2.4.8` | Il n'existe pas : la lignée vit dans des branches | `git branch -a \| grep 2.4.x` |
| Partir d'une ancienne branche 2.4.x pour un portage | Le correctif précédent (cache) disparaît | Toujours partir de la dernière `*-2.4.x` |
| Migrations activées sur le Hub | `permission denied for schema public` | `socle.ai.migrations.enabled=false`, ou monter en Boot 4 + pack ≥ 2.7.5 |
| Workers du pack laissés dans le scan sans configuration | Redémarrages en boucle, superviseur en WARNING (SDR2, 2026-09-04) | Les exclure (§4) |
| Pack ≤ 2.4.7 | Cache d'embeddings jamais relu (`PGobject cannot be cast to PGvector` avalé en WARN) : tout est re-embeddé | 2.4.8 |
| Pom de RssArchiver (copie de travail) | Déclare 2.7.7 avec un parent Boot 3.2.1 : combinaison hors lignée, à vérifier avant toute montée | Contrôler ce qui tourne réellement (image déployée) |
| `CONTEXTE-LATEST` d'une app qui dit Boot 4 | Faux sur SDR2 | Le pom fait foi |

---

## 10. Pour aller plus loin

- [[howto-ai-01-integrer-le-pack|AI-01 — Intégrer le pack (main)]]
- [[howto-25-upgrader-une-app-socle|HOWTO 25 — Upgrader une app socle]]
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28 — Intégrer un socle-pack]] (écrit pour 2.3.5)
