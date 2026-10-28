# HOWTO AI-05 — Classifier des items et apprendre des rejets

**Niveau :** Intermédiaire
**Pack :** `eu.lmvi:socle-pack-ai:2.9.0` — tag `v2.9.0`, commit `8c771e8`, code identique à 2.8.0 (commit de code `f8d7dac`) (socle-v005 5.11.0, minimum 5.10.0 / Spring Boot 4.1.2) — vérifié au code le 2026-10-28 ; aucune action ni comportement ne change depuis 2.7.14 (`a357a95`)
**Composants :** `ClassificationWorker` (`classification_worker`), `ClassificationCacheService`, `FeedbackService`, prompt `classify_generic`, table `tr_feedback_ia`
**Prérequis :** [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02]] (le classifieur passe par le `GenerationWorker`)
**Temps estimé :** 20 min

---

## 1. Contexte

Le classifieur rend, pour un item (`item_type`, `item_id`, `content`), une liste de **tags**, un
**score** 0–100, les **facteurs** qui le justifient et une **explication**. L'utilisateur valide,
modifie ou rejette ; trois rejets d'un même item pour la même raison le mettent en **liste noire** :
le classifieur refuse alors de le retraiter.

Quand les options sont **fermées** (une rubrique parmi N, oui/non), le service KEV du Hub classe
sans LLM : [[howto-45-classer-un-texte-avec-kev|HOWTO 45]]. Ce worker sert quand les tags sont
libres ou que l'explication compte.

---

## 2. Architecture

```
classify_item(item_type, item_id, content, context?, prompt_id?)
   │ liste noire ? (tr_feedback_ia : ≥ 3 REJECT même raison) ── oui → échec « Item blacklisted »
   │ cache mémoire LRU 10 000 entrées, clé (item_type, item_id, content_hash)
   │   hit → résultat, "cached": true
   ▼ miss
GenerationWorker.generateOne(partition, prompt_id = classify_generic,
      {item_type, content, context}, {temperature: 0.1, max_tokens: 512})
   ▼
extraction du premier « { » au dernier « } » → {tags[], score, factors[], explanation}
   échec de lecture → tags vides, score 0, texte brut dans explanation

submit_feedback(item_type, item_id, action_type, feedback_detail)
   VALIDATE | MODIFY | REJECT | POSTPONE  → tr_feedback_ia ; tout sauf VALIDATE invalide le cache
get_quality_metrics(item_type?) → taux par action
```

---

## 3. Étape 1 — Écrire son prompt de classification

Le prompt reçoit trois variables : `{item_type}`, `{content}`, `{context}` (le `context` de
l'appel, rendu par `Map.toString()` : `{site=Lyon}`). Il doit rendre un objet JSON aux clés `tags`, `score`, `factors`,
`explanation`.

```sql
INSERT INTO schema_monapp.z_config_ia
    (prompt_id, version, content, active, temperature, max_tokens, description, x_createdBy)
VALUES ('classify_ticket', '1.0.0',
$$Tu classes des tickets de support informatique.
Rends UNIQUEMENT un objet JSON :
- tags        : 1 à 3 parmi [materiel, logiciel, reseau, acces, autre]
- score       : entier 0-100, l'urgence
- factors     : les 3 éléments du texte qui justifient le score
- explanation : une phrase
Ticket ({item_type}) :
{content}
Contexte : {context}$$,
 true, 0.10, 512, 'Classification des tickets', 'monapp')
ON CONFLICT (x_partition, prompt_id, version) DO NOTHING;
```

Puis `ConfigReloadService.reloadAll()` (ou redémarrage) pour que le résolveur le voie.

---

## 4. Étape 2 — Classifier

```bash
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"classification_worker__classify_item",
       "arguments":{"item_type":"ticket","item_id":4211,
                    "content":"Plus d accès au VPN depuis la mise à jour de ce matin",
                    "context":{"site":"Lyon"},"prompt_id":"classify_ticket"}}}'
```

Rendu : `tags`, `score`, `factors`, `explanation`, `prompt_id`, `model`, `cached`.

En lot : `classify_batch {item_type, items:[{item_id, content, context?}], prompt_id?}` — un
résultat par item, `blacklisted: true` pour un item en liste noire. `retag_item` force un nouvel
appel (vide le cache de l'item).

Depuis le code, appeler l'action par le registre n'est pas nécessaire : le même résultat s'obtient
par `GenerationWorker.generateOne(partition, "classify_ticket", Map.of("item_type", "ticket",
"content", texte, "context", Map.of()), Map.of("temperature", 0.1, "max_tokens", 512))` — sans
cache ni liste noire, qui appartiennent au worker.

---

## 5. Étape 3 — Remonter le retour de l'utilisateur

```bash
curl -s -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"classification_worker__submit_feedback",
       "arguments":{"item_type":"ticket","item_id":4211,"action_type":"REJECT",
                    "feedback_detail":{"reject_reason":"mauvais_tag","reject_level":"MAJOR",
                                       "prompt_id":"classify_ticket","prompt_version":"1.0.0"}}}}'
```

Clés lues dans `feedback_detail` : `reject_reason` (50 signes), `reject_level` (`MAJOR` | `MINOR`),
`modify_type`, `prompt_id`, `prompt_version` ; l'objet entier est aussi rangé. Indicateurs :
`get_quality_metrics {item_type:"ticket"}`.

---

## 6. Vérifier

```sql
SELECT source_type, source_id, action_type, reject_reason, x_dateCreated
  FROM schema_monapp.tr_feedback_ia ORDER BY x_id DESC LIMIT 10;
```

`classification_worker__get_status` : `cache_hits`, `cache_size`, `blacklist_blocks`.

---

## 7. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `classify_item` deux fois, même contenu | 2e réponse `cached: true` |
| 2 | Même `item_id`, contenu changé | nouvel appel LLM (empreinte différente) |
| 3 | Trois `REJECT` même `reject_reason` | `classify_item` rend `Item blacklisted (rejected 3+ times with same reason)` |
| 4 | Réponse du modèle hors JSON | `tags: []`, `score: 0`, texte brut dans `explanation` |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Score 0 et tags vides | Le JSON n'a pas pu être lu : le résultat de repli **est mis en cache** comme un vrai résultat | Contrôler `score`/`tags` côté app ; `retag_item` après correction du prompt |
| Modèle à raisonnement sans balise | Le premier « { » trouvé peut être dans le raisonnement : JSON faux | MiniMax-M3 + `agentia-disable-thinking`, ou prompt plus strict |
| Cache attendu persistant | Le cache est **en mémoire** (LRU 10 000) : perdu à chaque redémarrage | Ranger le résultat dans une table de l'app |
| `prompt_version` du résultat | Toujours `1.0.0`, écrit en dur, quelle que soit la version servie | Lire la version servie par `generation_worker__preview` |
| Liste noire « pour toujours » | Aucun mécanisme de levée dans le pack, et la requête de contrôle ne filtre pas `x_active` | Supprimer (ou requalifier) les lignes `REJECT` de l'item dans `tr_feedback_ia` |
| Partition | Lue dans `app.current_tenant_id` : `null` dans un appel MCP | Mono-tenant assumé, ou API Java dans une transaction `SET LOCAL` |
| Options fermées traitées au LLM | Coût et latence pour une décision qu'un classifieur dédié prend mieux | KEV ([[howto-45-classer-un-texte-avec-kev\|HOWTO 45]]) |

---

## 9. Pour aller plus loin

- [[howto-ai-02-generer-du-texte-avec-des-prompts-versionnes|AI-02 — Prompts versionnés]]
- [[howto-ai-06-resumer-traduire-transcrire-documenter|AI-06 — 5W1H, traduction]]
- [[howto-45-classer-un-texte-avec-kev|HOWTO 45 — KEV]]
