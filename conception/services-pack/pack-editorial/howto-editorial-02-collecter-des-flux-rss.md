# HOWTO EDITORIAL-02 — Collecter des flux RSS/Atom avec `rss_collect_worker`

**Niveau :** Intermédiaire
**Cible :** application V005 embarquant le pack — 2.1.0 sur Spring Boot 4.1.2 / socle 5.10 (2.0.0 sur Boot 4.0.6, 1.0.0-SNAPSHOT sur Boot 3.2.1 : contenu identique)
**Versions vérifiées au code (2026-10-28) :** `socle-pack-editorial:2.1.0`, `main` @ `1fb6c6a`, tag `v2.1.0` (fonctionnellement identique à 2.0.0 — tag `v2.0.0` — et à `1.0.0-SNAPSHOT`, commit `fffd6f9`) —
classes `RssCollectWorker`, `RssCollectionService`, `RssFetcher`, `RssParser`, `Politesse`,
`EnParallele`, `UrlNormalizer`, `LanguageDetector` ; migrations `V001`, `V010`, `V011`
**Prérequis :** [[howto-editorial-01-integrer-le-pack|EDITORIAL-01]] fait
**Temps estimé :** 20 min

---

## 1. Contexte

Le premier maillon du pipeline : déclarer des flux, les relever périodiquement, et déposer chaque
nouvel article dans `tr_raw_item` avec `status = 'pending'`, prêt pour la curation
([[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03]]).

**Prêt et éprouvé en production** (RssArchiver, plusieurs centaines de flux) : c'est la partie la plus
mûre du pack. Les correctifs récents visibles au code : parallélisme réel, politesse par hôte,
GET conditionnel, réessai automatique des sources en erreur, URL de source modifiable.

Rien à coder : le worker démarre son propre poller. L'application déclare les sources et règle la
cadence.

---

## 2. Architecture

```
 poller "rss-collect-poller" (toutes les collect-interval-seconds, défaut 60 s)
   │ findDueSources(parallel-fetches)
   │   status IN ('active','error') AND x_active
   │   AND cooldown_until échu AND last_fetch_at + frequency_minutes échu
   │   ORDER BY last_fetch_at NULLS FIRST
   ▼
 EnParallele → pool "rss-collect-N" (parallel-fetches fils, borné 1..16)
   │
   ▼  RssCollectionService.collectSource(id)
 RssFetcher.fetchConditional(url, etag, last_modified, polite_ms)
   │   Politesse : ≥ polite_ms entre deux requêtes vers le même hôte (avant chaque tentative)
   │   If-None-Match / If-Modified-Since ; retry ×fetch-retries (repli 1 s puis 5 s avec 3 tentatives)
   ├── 304 ──► horodatage seul, error_count = 0
   ▼ 200
 RssParser (Rome : RSS 0.9x/2.0, RSS 1.0, Atom)  → contents[0] sinon description
   ▼ pour chaque entrée
 UrlNormalizer (host minuscule, sans slash final, sans utm_*/gclid/fbclid/ref…, query triée)
 content_hash = SHA-256(url_normalized | titre \n contenu)   LanguageDetector → fr|en|de|es|unknown
   ▼
 INSERT tr_raw_item … WHERE NOT EXISTS (même x_partition + url_normalized)
                       ON CONFLICT (x_partition, content_hash) DO NOTHING
```

En échec : `error_count + 1`, `cooldown_until = now() + min(30 × échecs, 360) min`. Au
`max-error-count`-ième échec consécutif (défaut 10) : `status = 'error'` et cooldown de
`error-retry-hours` (défaut 24 h) ; la source est **réessayée d'elle-même** ensuite, et un succès la
remet en `active`. `paused` est la seule mise à l'écart définitive : c'est une décision humaine.

---

## 3. Étape 1 — Tester un flux avant de le déclarer

`test_source` relève et analyse le flux sans rien écrire (5 échantillons).

```bash
editorial rss_collect_worker__test_source '{"url":"https://www.lemonde.fr/rss/une.xml"}'
```

```json
{"valid":true,"feed_title":"Le Monde.fr - Actualités et Infos en France et dans le monde",
 "total_items":20,
 "samples":[{"title":"…","url":"https://www.lemonde.fr/…","published_at":"2026-10-28T07:12:00Z","content_length":312}]}
```

`content_length` faible (quelques centaines de caractères) annonce un flux « chapô seul » : prévoir
la récupération du corps en curation ([[howto-editorial-04-enrichir-les-articles-publies|EDITORIAL-04]]).

---

## 4. Étape 2 — Déclarer les sources

```bash
editorial rss_collect_worker__add_source '{
  "url": "https://www.lemonde.fr/rss/une.xml",
  "label": "Le Monde — À la Une",
  "thematic": "actualités",
  "frequency_minutes": 30
}'
# → {"source_id": 12, "url": "https://www.lemonde.fr/rss/une.xml"}
```

`frequency_minutes` absent ou ≤ 0 → 60. La source est collectée au tick suivant (`last_fetch_at`
est `NULL`, elle passe en tête de file).

Chargement en masse : la table est directe, et le pack la lit telle quelle.

```sql
INSERT INTO schema_monapp.db_source_rss
    (x_partition, x_createdBy, url, label, thematic, frequency_minutes, status, polite_ms)
VALUES
    (NULL, 'import', 'https://www.lemonde.fr/rss/une.xml',           'Le Monde',  'actualités', 30,  'active', NULL),
    (NULL, 'import', 'https://www.01net.com/actualites/feed/',       '01net',     'tech',       60,  'active', NULL),
    (NULL, 'import', 'https://www.service-public.fr/rss/actu.rss',   'Service-Public', 'admin', 240, 'active', 5000)
ON CONFLICT DO NOTHING;
```

`polite_ms` : `NULL` → défaut du pack (`socle.editorial.rss.polite-ms`, 1500) ; `0` → aucune attente
pour cet hôte ; une valeur haute ménage un serveur fragile.

---

## 5. Étape 3 — Régler la cadence

| Propriété (`socle.editorial.rss.*`) | Défaut | Effet |
|---|---|---|
| `collect-interval-seconds` | 60 | période du poller (lue une fois, au `start()`) |
| `parallel-fetches` | 3 | sources ramenées **et** traitées ensemble par tick (borné à 16) |
| `polite-ms` | 1500 | espacement minimal par hôte (sources sans `polite_ms`) |
| `http-timeout-seconds` | 30 | `callTimeout` OkHttp par requête |
| `fetch-retries` | 3 | tentatives par relevé |
| `max-error-count` | 10 | échecs consécutifs avant `status = 'error'` |
| `error-retry-hours` | 24 | délai avant réessai d'une source en `error` |

Débit maximal ≈ `parallel-fetches` sources par `collect-interval-seconds`. Avec les défauts : 3
sources/min, soit 180 relevés/heure. Pour 600 flux relevés toutes les heures, il faut ~10 par minute :

```yaml
socle:
  editorial:
    rss:
      parallel-fetches: ${SOCLE_EDITORIAL_RSS_PARALLEL_FETCHES:10}
      collect-interval-seconds: ${SOCLE_EDITORIAL_RSS_COLLECT_INTERVAL_SECONDS:60}
```

La politesse étant **par hôte**, dix fils vers dix domaines différents ne s'attendent pas ; dix
sources du même domaine se succèdent à `polite_ms` d'intervalle.

---

## 6. Étape 4 — Exploiter les sources

```bash
# Lister (filtre facultatif : active | paused | error)
editorial rss_collect_worker__list_sources '{"status":"error"}'

# Corriger l'URL d'un flux déplacé : remet etag/last_modified, error_count, last_error, cooldown à zéro
editorial rss_collect_worker__edit_source '{"source_id":42,"url":"https://towardsdatascience.com/feed/","status":"active"}'

# Suspendre (exclu du poller jusqu'à réactivation)
editorial rss_collect_worker__edit_source '{"source_id":42,"status":"paused"}'

# Relever tout de suite une source (ou toutes les actives si source_id absent)
editorial rss_collect_worker__force_collect '{"source_id":42}'

# Supprimer — CASCADE sur tous ses tr_raw_item
editorial rss_collect_worker__delete_source '{"source_id":42}'
```

`force_collect` sans `source_id` relève **séquentiellement** toutes les sources `active` : sur un parc
de plusieurs centaines de flux, c'est long. L'action est déclarée `ASYNC` : le socle rend un `jobId`
immédiatement.

---

## 7. Vérifier

```bash
editorial rss_collect_worker__get_stats '{}'
```

```json
{"worker":"rss_collect_worker","running":true,"total_collected":412,"total_inserted":1873,
 "total_errors":9,"sources_total":206,"sources_active":199,"sources_error":7,"items_pending":1620}
```

Les compteurs `total_*` repartent de zéro à chaque démarrage ; `sources_*` et `items_pending` sont
lus en base. Côté SQL, la santé du parc :

```sql
SELECT status, count(*) AS sources,
       sum(articles_last_24h) AS articles_24h,
       min(last_fetch_at)     AS releve_le_plus_ancien
FROM schema_monapp.db_source_rss
WHERE x_active
GROUP BY status;
```

`articles_last_24h` est **recalculé** à chaque succès (fenêtre glissante), donc fiable pour repérer un
flux muet.

Journal : `[rss-collect] source=12 (Le Monde — À la Une) fetched=20 inserted=4 skipped=16` à chaque
relevé ; `→ status=error (10 échecs consécutifs) — réessai automatique dans 24 h` au basculement.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `add_source` puis attendre 60 s | `last_fetch_at` posé, `articles_total > 0`, lignes `pending` dans `tr_raw_item` |
| 2 | Deuxième relevé sans nouveauté | `304` si le serveur gère l'ETag : `fetched=0`, aucun insert |
| 3 | Même article avec `?utm_source=x` | une seule ligne (dédup sur `url_normalized`) |
| 4 | URL de flux invalide | `error_count` croît, `cooldown_until` 30, 60, 90… min ; `status=error` au 10ᵉ |
| 5 | Source en `error`, flux réparé | retour en `active` après `error-retry-hours`, sans intervention |
| 6 | `edit_source` url + `status=active` ensemble | succès (une seule remise à zéro dans la requête) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `add_source` deux fois la même URL en mono-tenant | **deux lignes** : l'index unique `(x_partition, url)` ne protège pas les `x_partition NULL` (en SQL, deux `NULL` sont distincts), l'`ON CONFLICT` ne se déclenche pas | vérifier par `list_sources` avant d'ajouter, ou `SELECT … WHERE url = ?` |
| Changer `collect-interval-seconds` à chaud | sans effet | lu au `start()` : redémarrer l'app |
| Monter `parallel-fetches` au-delà de 16 | plafonné à 16 sans message | c'est voulu (borne dans le constructeur) |
| `delete_source` pour « réparer » un flux | tous ses articles bruts disparaissent (CASCADE), et avec eux les entrées HITL | `edit_source` avec la nouvelle `url` |
| Attendre de `thematic` un classement des articles | la thématique reste sur la source : rien ne la recopie dans `tr_raw_item` ni `tr_article` | joindre sur `id_source_rss` |
| Colonne `db_source_rss.content_type` (V999z) | aucun effet : le code ne la lit pas ; la curation prend toujours le type `rss` | régler la ligne `content_type='rss'` de `z_curation_config` |
| `polite_ms = 0` sur une source | aucune attente vers cet hôte, rafales possibles | laisser `NULL` (défaut du pack) |
| Détection de langue | heuristique sur les 200 premiers caractères, 4 langues ; un chapô court donne `unknown` | ne pas en faire un filtre bloquant |
| README : « retry 3× » puis « status=error après 10 échecs » sans réessai | le code réessaie les sources `error` toutes les 24 h depuis le 2026-10-05 | se fier à `findDueSources` |
| Exemples `curl …/api/actions/rss_collect_worker__add_source` du README | 404 sur l'app | passer par `mcp_proxy_invoke` (fonction `editorial`, [[howto-editorial-01-integrer-le-pack\|EDITORIAL-01 §10]]) |

---

## 10. Pour aller plus loin

- [[howto-editorial-03-curer-et-router-les-articles|EDITORIAL-03 — Curer et router les articles]] — la suite du pipeline
- [[howto-editorial-04-enrichir-les-articles-publies|EDITORIAL-04 — Enrichir les articles publiés]] — corps complet des flux « chapô seul »
- [[howto-editorial-01-integrer-le-pack|EDITORIAL-01 — Intégrer le pack]]
- [[howto-38-consommer-des-messages-nats-depuis-une-app|HOWTO 38]] / [[howto-37-publier-des-messages-nats-depuis-une-app|HOWTO 37]] — diffuser ensuite les articles (cas RssArchiver)
