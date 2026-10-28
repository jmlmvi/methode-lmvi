# HOWTO AI-07 — Lire le web : récupérer une page, un document, chercher, piloter un navigateur

**Niveau :** Intermédiaire
**Pack :** `eu.lmvi:socle-pack-ai:2.7.14` — branche `main`, code au commit `a357a95` — vérifié au code le 2026-10-28
**Composants :** `WebWorker` (`web_worker`), `FetchService`, `CascadeFetcher`, `BrowserlessFetcher`, `PlaywrightFetcher`, `FlaresolverrFetcher`, `DocsParserClient`, `SearchService`, `UrlPreflightFilter`, `BrowserWorker` (`browser_worker`), `BrowserContextPool` ; tables `tr_web_fetch_cache`, `tr_web_search_cache`, `tr_browser_session_log`
**Prérequis :** [[howto-ai-01-integrer-le-pack|AI-01]] ; services mutualisés du Hub `playwright`, `browserless`, `flaresolverr`, `hub-docs-parser`, et une instance SearXNG ou une clé de moteur de recherche
**Temps estimé :** 30 min

---

## 1. Contexte

Le pack sait transformer une URL en Markdown exploitable par un LLM, du moins cher au plus
coûteux, et sait chercher sur le web. Ces capacités servent d'outils à un agent
([[howto-ai-08-construire-un-agent-llm-gateway-et-sessions|AI-08]]) ou alimentent un corpus RAG
([[howto-ai-04-construire-un-rag-ingerer-et-interroger|AI-04]]).

Exemples réels : `APP-12-RssArchiver` (cascade de récupération des articles), `APP-08-AgentIA`
(outils `web_worker__search`, `web_worker__fetch_smart`, `web_worker__parse_doc` de son agent démo).

---

## 2. Architecture

```
fetch_smart(url, main_only?) ── CascadeFetcher
   │ URL d'un document (pdf, docx, xlsx, pptx…) → DocsParserClient → hub-docs-parser:8000
   ├─ 1. FetchService     HTTP + jsoup + flexmark → Markdown        ~100 ms   (cache 1 h)
   ├─ 2. browserless      http://browserless:3000                    3–8 s
   ├─ 3. Playwright       ws://playwright:3001/ (BrowserContextPool) 5–15 s
   └─ 4. flaresolverr     http://flaresolverr:8191                   10–30 s  (Cloudflare)
   escalade tant que le Markdown fait < cascade-min-text-len signes (défaut 100)
   contenu non-HTML détecté en route → docs-parser

UrlPreflightFilter : http/https seulement, IP privées / link-local bloquées (résolution DNS
                     vérifiée), liste blanche facultative de domaines

search(query, max_results) ── SearchService : brave → serpapi → bing → kagi → you → searxng
   chaque moteur sans clé (ou sans URL pour searxng) est sauté ; cache 1 h

browse(actions[]) ── BrowserWorker ── BrowserContextPool (2 contextes, TTL 300 s)
   DSL : goto, click, fill, wait_for, screenshot, extract, scroll, press, back, forward
```

---

## 3. Étape 1 — Configurer

Ces clés sont lues en `@Value` (elles ne sont pas dans `AiProperties`) :

```yaml
socle:
  ai:
    web:
      fetch-timeout-ms: 15000
      fetch-cache-ttl-sec: 3600
      block-private-ips: true
      allowed-domains: ""                 # CSV ; vide = tout domaine public
      proxy-url: ""                       # proxy de sortie facultatif
      cascade-min-text-len: 100
      cascade-skip-playwright: false
      cascade-html-max-len: 50000
      browserless-url: http://browserless:3000
      flaresolverr-url: http://flaresolverr:8191
      playwright-timeout-ms: 30000
      search-providers: searxng           # ordre d'essai ; défaut brave,serpapi,bing,kagi,you,searxng
      searxng-base-url: ${SOCLE_AI_WEB_SEARXNG_BASE_URL:http://searxng:8080}
      brave-api-key: ${SOCLE_AI_WEB_BRAVE_API_KEY:}
      search-timeout-ms: 10000
    docs-parser-url: http://hub-docs-parser:8000
    docs-parser-enabled: true
    browser:
      ws-url: ${SOCLE_AI_BROWSER_WS_URL:ws://playwright:3001/}   # vide = Chromium LOCAL
      pool-size: 2
      ttl-sec: 300
      checkout-timeout-ms: 30000
      headless: true
```

Le conteneur de l'app doit être sur le réseau Docker du Hub pour joindre `playwright`,
`browserless`, `flaresolverr` et `hub-docs-parser` par leur nom.

---

## 4. Étape 2 — Récupérer et chercher depuis le code

```java
package eu.lmvi.monapp.veille;

import eu.lmvi.socle.pack.ai.web.CascadeFetcher;
import eu.lmvi.socle.pack.ai.web.FetchService;
import eu.lmvi.socle.pack.ai.web.SearchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class LectureWeb {

    private static final Logger log = LoggerFactory.getLogger(LectureWeb.class);

    private final CascadeFetcher cascade;
    private final SearchService search;

    public LectureWeb(CascadeFetcher cascade, SearchService search) {
        this.cascade = cascade;
        this.search = search;
    }

    /** Le corps d'un article (sans menu ni colonne), en Markdown. */
    public Optional<String> lireArticle(String url) {
        FetchService.FetchResult r = cascade.fetch(url, true);    // corpsSeulement = true
        if (!r.ok()) {
            log.warn("[web] {} → {} ({})", url, r.errorCode(), r.httpStatus());
            return Optional.empty();
        }
        // contentType porte la méthode employée, préfixée « via=… »
        log.info("[web] {} via {} en {} ms, {} signes", url, r.contentType(), r.durationMs(), r.bodySize());
        return Optional.of(r.body());
    }

    public List<String> chercher(String requete) {
        SearchService.SearchResult res = search.search(requete, 5);
        return res.hits().stream().map(SearchService.SearchHit::url).toList();
    }
}
```

`FetchResult` : `url`, `finalUrl`, `httpStatus`, `contentType`, `body`, `bodySize`, `durationMs`,
`errorCode`, `expiresAt`, `fromCache`, `rawHtml` ; `ok()` = pas d'erreur et statut 2xx/3xx.

---

## 5. Étape 3 — Par MCP

```bash
mcp() { curl -s -X POST http://localhost:8080/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1"; }

mcp '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_worker__fetch_smart",
     "arguments":{"url":"https://www.example.org/actualite","main_only":true}}}'

mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_worker__parse_doc",
     "arguments":{"url":"https://www.example.org/rapport-annuel.pdf"}}}'

mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_worker__browse",
     "arguments":{"actions":[{"type":"goto","url":"https://www.example.org"},
                             {"type":"wait_for","selector":"main","state":"visible"},
                             {"type":"extract","selector":"main","mode":"text"}]}}}'
```

| Action | Paramètres |
|---|---|
| `fetch` | `url`, `format` = `markdown` (défaut) \| `raw` \| `article` |
| `fetch_browserless` | `url`, `wait_for_ms` (défaut 2000) |
| `fetch_playwright` | `url`, `wait_load` = `networkidle` \| `load` \| `domcontentloaded` |
| `fetch_flaresolverr` | `url`, `max_timeout_ms` (défaut 60000) |
| `fetch_smart` | `url`, `main_only` |
| `parse_doc` | `url`, `force_format` = `pdf` \| `docx` \| `xlsx` \| `pptx` \| `json` \| `csv` \| `image` |
| `search` | `query`, `max_results` (défaut 10) |
| `browse` | `actions[]`, `session_uuid`, `agent_id` (audit) |
| `flush_pool` | — (ferme tous les contextes du navigateur) |

---

## 6. Vérifier

```bash
docker logs monapp 2>&1 | grep -E 'CascadeFetcher|BrowserContextPool|Playwright'
#   [CascadeFetcher] initialized — minTextLen=100, skipPlaywright=false, docsParserEnabled=true, htmlMaxLen=50000
#   … connecté à Playwright remote ws://playwright:3001/        ← et non « launched local Chromium »
docker stats --no-stream monapp     # mémoire stable après un browse
```

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `fetch` sur `http://192.168.1.1` | refus du préfiltre (IP privée), aucune requête émise |
| 2 | `fetch_smart` sur une page statique | servi à l'étage 1, ~100 ms |
| 3 | `fetch_smart` sur une SPA | escalade jusqu'à Playwright, Markdown ≥ 100 signes |
| 4 | `search` sans aucune clé ni SearXNG | résultat d'erreur, aucun appel réseau |
| 5 | `browse` avec `ws-url` posé | journal « connecté à Playwright remote », pas de téléchargement de navigateur |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| `socle.ai.browser.ws-url` vide | Chromium lancé dans le conteneur : +1 Go (RssArchiver : 93 % → 31 % de mémoire une fois corrigé), ou `playwright_error` dans une image GraalVM | `SOCLE_AI_BROWSER_WS_URL=ws://playwright:3001/` puis `update_app` |
| Exclusion Maven de `driver-bundle` puis usage du navigateur local | Échec de lancement de Playwright | Garder `ws-url` renseigné ; l'exclusion ne vaut que pour une app sans navigateur local |
| Redirections | `FetchService` suit les redirections (`Redirect.NORMAL`) et ne repasse **pas** chaque saut au préfiltre SSRF (constat de TheDiffuseur le 2026-09-24) | Pour une URL fournie par un utilisateur externe, contrôler la cible finale (`finalUrl`) ou employer un client gardé |
| Seuil de texte exploitable | La javadoc de `CascadeFetcher` annonce 250 ; le défaut réel est **100** | Régler `cascade-min-text-len` explicitement |
| `search-providers` laissé au défaut | Essaie cinq moteurs payants avant SearXNG ; sans clé, chacun est sauté | Ne lister que les moteurs configurés |
| SearXNG partagé | Moteurs amont qui renvoient des captchas : résultats vides | Choisir les moteurs de l'instance SearXNG |
| Cloudflare 403 | `User-Agent: TheSocleAgent/2.0` refusé par certains sites | `fetch_flaresolverr` ou `fetch_smart` |
| PDF récupéré par `fetch` | Markdown illisible (binaire) et jetons gaspillés | `parse_doc` ou `fetch_smart` (route vers docs-parser) |
| `tr_web_fetch_cache` sous RLS forcée | Une ligne en cache n'est visible que pour sa partition (ou partition NULL) | Rester cohérent sur `app.current_tenant_id` |
| Croire `getStats()` de `web_worker` | Sa liste d'actions omet `parse_doc` | `tools/list` fait foi |

---

## 9. Pour aller plus loin

- [[howto-ai-08-construire-un-agent-llm-gateway-et-sessions|AI-08 — Agents]] : ces actions comme outils
- [[howto-ai-04-construire-un-rag-ingerer-et-interroger|AI-04 — RAG]] : ingérer ce qui a été lu
- [[howto-40-scanguard-proteger-le-hub|HOWTO 40 — ScanGuard]]
