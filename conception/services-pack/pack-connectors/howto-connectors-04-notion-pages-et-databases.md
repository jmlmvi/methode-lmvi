# HOWTO CONNECTORS-04 — Notion : lire et écrire pages, databases et blocs par actions

**Niveau :** Intermédiaire
**Cible :** app, agent MCP ou opérateur qui pilote un workspace Notion via `notion_worker`
**Versions vérifiées au code (2026-10-28) :** `socle-pack-connectors:3.2.0` (tag `v3.2.0`, commit `edac18b`, code identique à 3.1.0 `69da4ab` ; Boot 4.1.2, socle 5.11.0, minimum 5.10.0 ; comportement identique à 3.0.0) — `NotionWorker` (20 actions),
`NotionClient`, `PropertyConverter` ; API Notion `2022-06-28` (défaut `socle.conn.notion.version`)
**Temps estimé :** 20 min

---

## 1. Contexte

`notion_worker` expose l'API Notion v1 en actions MCP/REST. Les propriétés s'échangent en **JSON
simplifié** (`{"Name":"Acme","Tags":["a","b"]}`), converti dans les deux sens par `PropertyConverter`.
Les blocs, eux, circulent au **format Notion brut**.

| Groupe | Actions | Mode |
|---|---|---|
| Lecture | `search_pages`, `get_page`, `get_page_full`, `list_workspace_pages`, `query_database`, `get_database_full`, `list_databases` | SYNC sauf `get_page_full`, `list_workspace_pages`, `get_database_full` (ASYNC) |
| Écriture pages | `create_page`, `create_database_item`, `update_page`, `archive_page` | SYNC |
| Schéma | `create_database` | SYNC — absente du manifeste et du README |
| Blocs | `append_blocks` (découpe 100/appel), `update_block`, `delete_block` | SYNC |
| Santé | `test_connection`, `get_status` | SYNC |
| **Stubs** | `import_zip_export` (renvoie toujours un échec), `download_asset` (renvoie l'URL, ne télécharge rien) | — |
| Expérimental | `register_webhook` (tente `POST /v1/webhooks`, renvoie l'échec de l'API sinon) | SYNC |

---

## 2. Architecture

```
appelant ──► POST /mcp  ou  POST /admin/workers/notion_worker/actions/<action>
                 │
                 ▼
        NotionWorker.executeAction(name, params, ctx)
                 │  PropertyConverter.toNotion / fromNotion
                 ▼
        NotionClient.request()
           ├─ RateLimiter (socle.conn.notion.rate-limit-rps = 2 req/s, partagé JVM)
           ├─ ResilienceFactory.execute("notion")  → retry ×3 puis circuit breaker
           └─ OkHttp  Authorization: Bearer <api-key> · Notion-Version: 2022-06-28
                 │
                 ▼
        https://api.notion.com/v1/…
                 │
        ConnectorLogger.logCall(…) ──► tr_connector_log (connector=notion)
```

---

## 3. Étape 1 — Préparer l'intégration Notion

1. Créer l'intégration interne, copier son jeton dans `SOCLE_CONN_NOTION_API_KEY`.
2. Ouvrir chaque page/database cible → *Connections* → ajouter l'intégration. Une page non
   partagée renvoie `HTTP 404 object_not_found`.
3. `SOCLE_CONN_NOTION_ENABLED=true`, redémarrer ([[howto-connectors-02-activer-un-connecteur|CONNECTORS-02]]).

---

## 4. Étape 2 — Appeler les actions en REST

```bash
APP=http://localhost:8080
H=(-H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json")
W=$APP/admin/workers/notion_worker/actions

# Databases accessibles
curl -s "${H[@]}" -X POST $W/list_databases -d '{}'
# data : {"databases":[{"id":"…","title":"CRM","url":"…"}],"count":1}

# Ajouter une ligne — propriétés simplifiées, types devinés
curl -s "${H[@]}" -X POST $W/create_database_item -d '{
  "database_id": "1f2e3d4c-…",
  "properties": { "Contact email": "hello@acme.com", "Tags": ["SaaS","B2B"], "Score": 42 }
}'

# Modifier une page
curl -s "${H[@]}" -X POST $W/update_page -d '{
  "page_id": "9a8b7c6d-…", "properties": { "Score": 57 }
}'

# Page complète, arbre de blocs récursif (profondeur ≤ 10)
curl -s "${H[@]}" -X POST $W/get_page_full -d '{"page_id":"9a8b7c6d-…"}'

# Ajouter 250 blocs : 3 appels Notion, découpe automatique par 100
curl -s "${H[@]}" -X POST $W/append_blocks -d '{
  "page_id": "9a8b7c6d-…",
  "children": [
    {"object":"block","type":"paragraph",
     "paragraph":{"rich_text":[{"type":"text","text":{"content":"Bonjour"}}]}}
  ]
}'
# data : {"appended":1,"chunks":1}

# Créer une database sous une page (schéma au format Notion brut)
curl -s "${H[@]}" -X POST $W/create_database -d '{
  "parent_page_id": "5e4d3c2b-…",
  "title": "Projets",
  "properties_schema": {
    "Nom":    {"title": {}},
    "État":   {"select": {"options": [{"name":"À faire"},{"name":"Fait"}]}},
    "Début":  {"date": {}}
  }
}'
```

Par MCP, le même appel est un `tools/call` sur l'outil `notion_worker__create_database_item`,
`POST /mcp` avec `Authorization: Bearer $MCP_API_KEY`.

---

## 5. Étape 3 — Appeler depuis le code Java de l'app

```java
package eu.lmvi.monapp.crm;

import eu.lmvi.socle.action.model.ActionContext;
import eu.lmvi.socle.action.model.ActionParameters;
import eu.lmvi.socle.action.model.ActionResult;
import eu.lmvi.socle.pack.connectors.NotionWorker;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class CrmNotionWriter {

    private final ObjectProvider<NotionWorker> notion;

    public CrmNotionWriter(ObjectProvider<NotionWorker> notion) {
        this.notion = notion;
    }

    public String ajouterProspect(String databaseId, String email, int score) {
        NotionWorker w = notion.getIfAvailable();
        if (w == null) throw new IllegalStateException("notion_worker inactif");

        Map<String, Object> props = new LinkedHashMap<>();
        props.put("Contact email", email);   // détecté « email » (contient @ et .)
        props.put("Score", score);           // détecté « number »

        ActionResult r = w.executeAction("create_database_item",
                ActionParameters.fromMap(Map.of("database_id", databaseId, "properties", props)),
                ActionContext.internal("crm_notion_writer"));
        if (!r.success()) throw new IllegalStateException("Notion : " + r.error());
        return r.getDataString("id");
    }
}
```

---

## 6. Conversion des propriétés — règles exactes du code

**Écriture** (`toNotion`) : sans schéma, le type est **deviné par la valeur** :

| Valeur Java | Type Notion choisi |
|---|---|
| `Boolean` | `checkbox` |
| `Number` | `number` |
| `List` | `multi_select` |
| chaîne contenant `@` **et** `.` | `email` |
| chaîne commençant par `http://` / `https://` | `url` |
| toute autre chaîne | `rich_text` |

Les types `title`, `select`, `status`, `date`, `people`, `relation` ne sont **jamais devinés**. Par
action, le worker appelle toujours `toNotion(properties, null)` : il est impossible d'écrire le titre
d'une ligne ou un `select` via `create_page` / `create_database_item` / `update_page`. Pour cela,
passer par `NotionDatabaseService.upsertDatabaseRow(…, schema, …)`
([[howto-connectors-05-notion-synchroniser-une-database|CONNECTORS-05]]).

**Lecture** (`fromNotion`) : aplatissement lisible — `date` → `"2026-10-28"` ou
`"2026-10-01 → 2026-10-28"`, `people` → noms, `files` → noms de fichiers, `formula` / `rollup` →
valeur, `created_time` → jour seul.

---

## 7. Vérifier

```sql
SELECT action, status, latency_ms, error_message, x_dateCreated
FROM schema_monapp.tr_connector_log
WHERE connector = 'notion' ORDER BY x_id DESC LIMIT 10;
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `test_connection` | `connected: true`, `bot_name` = nom de l'intégration |
| 2 | `create_database_item` avec `{"Tags":["a"]}` | page créée, `Tags` en multi-select |
| 3 | `append_blocks` avec 250 blocs | `appended: 250, chunks: 3` |
| 4 | `get_database_full` sur 250 lignes | `row_count: 250` (pagination complète) |
| 5 | `import_zip_export` | Échec `import_zip_export is a stub in v1.0 — implemented in v1.1` |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **`search_pages`, `query_database`, `list_workspace_pages` sur la dernière page de résultats** | Échec avec erreur **vide** (`error: null`) dès que `has_more=false` | `Map.of(…, "next_cursor", null)` lève une `NullPointerException` (vérifié avec Jackson 2.15.4). Utiliser `get_database_full` (construit sa réponse en `LinkedHashMap`) ou `NotionDatabaseService` |
| `get_page` → `blocks`, `get_database_full` → `properties_schema` en pack **2.0.0** sur une app socle ≥ 5.8 | Champ rempli de clés Java (`nodeType`, `array`, `containerNode`…) au lieu du JSON Notion | **Corrigé en 3.0.0** : ces champs sont des `List`/`Map` (le serveur MCP du socle 5.8+ écrit en Jackson 3, qui ne reconnaît pas un `JsonNode` Jackson 2). Monter en 3.0.0 |
| Écrire un titre ou un `select` par action | `HTTP 400 … is expected to be title/select` | `NotionDatabaseService.upsertDatabaseRow` avec schéma |
| Une chaîne contenant `@` et `.` (« RDV @ 14.30 ») | Envoyée comme `email`, refus 400 | Schéma explicite |
| Page non partagée avec l'intégration | `HTTP 404` | *Connections* sur la page |
| `download_asset` | Renvoie seulement `url` + `hint` ; rien n'est téléchargé ni réhébergé | Télécharger l'URL signée Notion soi-même avant expiration (≈ 1 h) |
| `import_zip_export` | Toujours en échec | Stub ; aucun import ZIP n'existe |
| `register_webhook` | Échec `Webhook registration failed (API version may not support it)` | Configurer le webhook dans l'interface Notion ; le pack n'a **pas** de contrôleur de réception Notion (`NotionWebhookController` prévu par le CLAUDE.md, jamais écrit) |
| `SOCLE_CONN_NOTION_WEBHOOK_SECRET` | Aucun effet | Propriété déclarée, lue nulle part |
| Mode ASYNC des actions longues | `get_database_full` sur une grosse base dépasse le délai SYNC | Route `…/actions/get_database_full/async` puis `GET /admin/jobs/<id>` |
| Débit | ~2 requêtes/s : `get_page_full` d'une page à 300 blocs imbriqués prend plusieurs minutes | Prévoir un appel ASYNC ; ne pas relever `rate-limit-rps` au-delà de 3 (limite Notion) |

---

## 10. Pour aller plus loin

- [[howto-connectors-05-notion-synchroniser-une-database|CONNECTORS-05 — Synchroniser une database Notion depuis le code]]
- [[howto-connectors-10-resilience-et-journal-des-appels|CONNECTORS-10 — Résilience et journal]]
- [[howto-13-utiliser-mcpagger|HOWTO 13 — MCPagger]] (voir les outils MCP publiés)
