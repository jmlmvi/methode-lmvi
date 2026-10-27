# HOWTO 36 — Exposer un programme derrière sa propre entrée API, avec repli scripté (Janino)

> **Niveau** : avancé | **Prérequis** : Hub 3.20.0 (les scripts Janino n'existent pas avant), un programme qui répond en HTTP, accès admin APIM + base | **Temps estimé** : 45-60 min

Ce guide part d'un **programme quelconque qui expose une API HTTP** et va jusqu'à une entrée APIM complète : URL publique, authentification par clé, quotas, audit, facturation — puis un **script Janino** qui rejoue l'appel sur un backend de secours quand le premier refuse.

Le fil rouge est un cas réel : le service de transcription `whisper-fw` (APP-M002-Transcription — pas encore de fiche institutionnelle ; le service d'embeddings [[177-app-m001-embeddings]] suit le même patron), publié sous `https://api.thesocle.net/transcription/v1`. Remplacez le slug et les noms de conteneurs par les vôtres.

> **[3.20.0]** Les sections 7 à 9 décrivent une fonctionnalité livrée en 3.20.0. Vérifiez votre version (`/admin/health`) avant de commencer : sur un Hub antérieur, `apim_forward` n'existe pas et la règle sera acceptée en base mais jamais évaluée.

---

## 1. Ce qu'on construit

```
   client                    APIM (Hub)                         backends
     │                          │                                  │
     │  Bearer apim_prod_xxx    │ 1. auth (scope)                  │
     ├─────────────────────────►│ 2. quota / rate-limit            │
     │                          │ 3. JDM apim_pricing              │
     │                          │ 4. apim_forward ── script ──┐    │
     │                          │                             ├───►│ rank0  (429 !)
     │                          │        rejoue le suivant ───┘    │
     │                          │                             ─────►│ rank1  (200)
     │◄─────────────────────────┤ 5. audit + facturation           │
     │   200 + x-apim-call-id   │                                  │
```

Ce que l'APIM apporte au programme **sans qu'il ait une ligne à écrire** : clé d'API et scopes, rate-limit, quotas par tenant, audit complet (`apim.tr_api_call_audit`), facturation, et — avec le script — la tolérance de panne.

---

## 2. Étape 1 — Le programme, côté application

Aucune contrainte de langage. Trois exigences seulement :

| Exigence | Pourquoi |
|----------|----------|
| Répondre en **HTTP** sur un port connu | l'APIM forwarde en HTTP vers `http://<conteneur>:<port>` |
| Être joignable **sur le réseau Docker du Hub** (`docker_soclehub-net`) ou via un minihub | le forward part du conteneur Hub, pas d'Internet |
| Exposer un **chemin de santé** | utilisé par le suivi de backend |

> ⚠️ **L'APIM strippe `Authorization` et `X-API-Key` avant le forward** (`ApimFilter.injectHeaders`). Le programme ne verra **jamais** la clé du client — c'est voulu. S'il a besoin de connaître le tenant appelant, activez `sign_identity_jwt=true` sur l'API publiée : l'APIM injecte alors `Authorization: ApimSigned <jwt>`, vérifiable et infalsifiable. Cf. [[126-apim-certs-jwt-security]].

---

## 3. Étape 2 — Déclarer l'API publiée

L'entrée vit dans `apim.tr_published_api`. Les colonnes qui comptent :

```sql
INSERT INTO apim.tr_published_api
 (slug, display_name, description, owner_app_id,
  public_hostname, base_path_external,
  target_backend_type, target_app_id, target_port, target_path_internal,
  status, required_scope, payment_mode,
  cost_per_call_cents, cost_per_mb_in_cents, currency,
  default_rate_per_minute, default_rate_per_day,
  sign_identity_jwt, upstream_timeout_ms, x_active)
VALUES
 ('transcription', 'Transcription audio vers texte', '…', 'whisper-fw',
  'api.thesocle.net', '/transcription/v1',
  'hub_container', 'whisper-fw', 8080, '/v1',
  'published', 'api:transcription:*', 'subscription',
  0, 2, 'EUR',
  60, 5000,
  false, 900000, true);
```

| Colonne | À ne pas se tromper |
|---------|---------------------|
| `base_path_external` | chemin public **après** le hostname. L'appel final est `https://{public_hostname}{base_path_external}{reste}` |
| `target_path_internal` | chemin **côté programme**. Le reste de l'URL publique y est concaténé : `/transcription/v1/audio/transcriptions` → `/v1/audio/transcriptions` |
| `target_port` | le port **réellement écouté par le conteneur**. Piège vécu : le Hub écoute 80/443, pas 8080 — un backend mal porté donne un 502 silencieux |
| `payment_mode` | `subscription` sauf si le wallet du tenant est approvisionné (cf. piège 2) |
| `upstream_timeout_ms` | dimensionner sur le pire cas réel. Une transcription dure ~0,7× la durée de l'audio : 900 000 ms pour accepter de longs fichiers |
| `required_scope` | le scope que la clé du client devra porter |

---

## 4. Étape 3 — Créer la clé d'API (le piège n°1)

⚠️ **N'utilisez pas l'action MCP `iam_worker.create_api_key`** : elle produit un UUID, alors que la passerelle APIM n'accepte **que** le format `apim_<env>_<40hex>` (`ApimAuthHandler`). Une clé UUID est rejetée en `401 auth_missing` **avant tout lookup** — le message ne dit pas que le format est en cause.

Frappez la clé et n'insérez que son empreinte :

```bash
key="apim_prod_$(openssl rand -hex 20)"
hash=$(printf "%s" "$key" | openssl dgst -sha256 | awk '{print $NF}')
echo "$key"   # à remettre au client — jamais récupérable ensuite
```

```sql
INSERT INTO iam.tr_api_keys (id_users, key_name, key_hash, scopes, id_tenant, revoked, x_active)
VALUES (13, 'monapp-transcription', '<hash>', '["api:transcription:*"]'::jsonb, 76, false, true);
```

Le `scopes` doit satisfaire le `required_scope` de l'API (`ScopeMatcher`, les jokers `*` sont acceptés).

---

## 5. Étape 4 — Attendre le rechargement (le piège n°2)

Le catalogue d'APIs **et** le cache de règles se rechargent toutes les **5 minutes**. Juste après l'`INSERT`, l'appel répond :

```
404 No route configured for api.thesocle.net (aucune app installée sous ce hostname,
    ou cache routing à rafraîchir)
```

**C'est normal, ne corrigez rien.** Attendez le rechargement plutôt que de redémarrer le Hub — un redémarrage coupe les autres apps et, sur les minihubs, le flux de commandes ne se rétablit pas toujours seul.

---

## 6. Étape 5 — Premier appel de validation

```bash
curl -i -X POST "https://api.thesocle.net/transcription/v1/audio/transcriptions" \
  -H "Authorization: Bearer apim_prod_xxx" \
  -F "file=@dictee.m4a" -F "language=fr"
```

| Ce que vous obtenez | Ce que ça veut dire |
|---------------------|---------------------|
| **200** + en-tête `x-apim-call-id` | la passerelle a été engagée et le backend a répondu — c'est la preuve à conserver |
| `401 auth_missing` | format de clé invalide (cf. étape 3) |
| `403` | scope insuffisant, **ou** backend injoignable au chemin forwardé |
| `402 Wallet balance 0 < required 1` | `payment_mode='prepaid_wallet'` sans wallet approvisionné → passer en `subscription` |
| `404 No route configured` | cache pas encore rechargé (cf. étape 4) |

Vérifiez l'audit — c'est lui qui prouve la traçabilité, pas le code HTTP :

```sql
SELECT call_uuid, id_tenant, status_code, request_bytes, duration_ms, cost_eur_cents, backend_target
FROM apim.tr_api_call_audit
WHERE id_published_api = (SELECT x_id FROM apim.tr_published_api WHERE slug='transcription')
ORDER BY x_id DESC LIMIT 5;
```

---

## 7. Étape 6 — Déclarer les backends nommés **[3.20.0]**

Un script de repli a besoin de **plusieurs cibles nommées**. Elles vivent dans `apim.tr_api_backend`, une ligne par rang :

```sql
INSERT INTO apim.tr_api_backend
 (id_published_api, name, backend_type, app_id, port, path_internal, priority, x_active)
VALUES
 (<id_api>, 'rank0', 'hub_container', 'whisper-fw',     8080, '/v1', 0, true),
 (<id_api>, 'rank1', 'hub_container', 'whisper-fw-bis', 8080, '/v1', 1, true);
```

| Colonne | Rôle |
|---------|------|
| `name` | **le nom référencé par le script** — doit correspondre exactement |
| `backend_type` | `hub_container` \| `minihub_container` \| `external_url` |
| `priority` | ordre indicatif ; c'est le script qui décide réellement de l'ordre |

> Un `name` absent ou inactif fait échouer `forward.send(...)` silencieusement (statut 0) — que le script doit traiter comme réessayable.

---

## 8. Étape 7 — Cloner et adapter le script **[3.20.0]**

Ne partez pas d'une page blanche : clonez le template livré.

```bash
# 1. retrouver le template
curl -s "$HUB/api/apim/admin/jdm-templates?category=script" | jq '.[] | {x_id, slug}'
#    → script-cascade-retry

# 2. le cloner en règle draft pour VOTRE api
curl -s -X POST "$HUB/api/apim/admin/jdm-templates/<template_id>/clone" \
  -H 'Content-Type: application/json' \
  -d '{"id_published_api": <id_api>, "scope": "per_api", "custom_slug": "transcription-cascade"}'
```

Puis adaptez **les deux tableaux en tête du script** (`tr_jdm_rule.script_source`) :

```java
private static final String[] BACKENDS = { "rank0", "rank1" };
private static final String[] MODELS   = { null,    null    };  // null = corps inchangé
```

- `BACKENDS[i]` — un `name` déclaré à l'étape 6 ;
- `MODELS[i]` — écrit dans le champ `model` du corps JSON (conventions OpenAI-compatibles). **Indispensable quand le rang de secours sert un autre modèle**, sinon il répond `model_not_found`. Sans objet pour une API non-LLM : laisser `null`.

Le contrat du script, en une table :

| Élément | Valeur |
|---------|--------|
| Interface | `Executable` — `Object execute(Map input)` |
| Émetteur | `input.get("forward")` → `ApimForwardHelper.send(backendName, modelOverride)` → statut HTTP |
| Sortie | `forward_handled=true` si le script a émis l'appel ; `reason` pour l'audit |
| Interdit | ouvrir une connexion : `java.net` / `java.io` sont bloqués par le bac à sable |

---

## 9. Étape 8 — Publier la règle **[3.20.0]**

```bash
curl -X POST "$HUB/api/apim/admin/jdm-rules/<rule_id>/publish"
```

Seules les règles `published` **et** `x_active=TRUE` entrent en moteur. Le clonage ne déclenche pas de rechargement : comptez de nouveau jusqu'à **5 minutes**, ou forcez un `reload` administratif.

Vérifiez ensuite que le repli s'exerce vraiment — le plus simple est de pointer `rank0` sur un backend volontairement inexistant et de constater dans l'audit que la réponse revient quand même en 200, avec la trace du script :

```sql
SELECT status_code, backend_target, jdm_post_decisions
FROM apim.tr_api_call_audit
WHERE id_published_api = <id_api> ORDER BY x_id DESC LIMIT 1;
-- jdm_post_decisions contient : reason = "succes sur rank1 [rank0=0 rank1=200]"
```

---

## 10. Pièges courants

### Piège 1 — Le backend reçoit un 403 alors que la clé est bonne

**Cause** : `target_path_internal` pointe sur un chemin que le programme n'expose pas. Le forward atteint bien le conteneur, mais le framework répond 403 (rejet CSRF sur route inconnue) au lieu de 404 — le message oriente donc vers une fausse piste d'autorisation.

**Résolution** : vérifier le chemin réellement servi par le programme, pas celui qu'on croit. `curl` depuis un conteneur voisin (`docker exec <autre> curl -s http://<cible>:<port>/<chemin>`) tranche en dix secondes.

### Piège 2 — 402 alors que tout est correct

**Cause** : `payment_mode='prepaid_wallet'` exige un wallet approvisionné ; à zéro, la passerelle rejette avant le backend.

**Résolution** : `subscription` tant que la facturation prépayée n'est pas voulue. Cf. [[howto-35-configurer-le-wallet-et-la-facturation-apim|HOWTO 35]].

### Piège 3 — Coût facturé à 0 sur les petites requêtes

**Cause** : `cost_per_call_cents` et `cost_per_mb_in_cents` sont des **entiers de centimes**. 186 Ko × 2 c/Mo = 0,36 c → arrondi à 0.

**Résolution** : pour une facturation fine (à la seconde, au token), passer par une règle sur `apim_pricing` qui pose `cost_eur_cents` — c'est précisément le rôle du point pricing. Cf. [[124-apim-pricing-wallet-billing]].

### Piège 4 — Le script n'a aucun effet

**Trois causes, dans l'ordre de fréquence** :
1. règle restée en `draft` — seules les `published` entrent en moteur ;
2. cache pas encore rechargé (5 min) ;
3. règle créée avec `kind='jdm'` sur `apim_forward` — elle est **ignorée avec un avertissement** dans les logs : ce point n'accepte que les scripts.

### Piège 5 — Le repli boucle sur des erreurs client

**Cause** : rejouer un `400`/`404` sur les rangs suivants. Ils refuseront pareil, on n'ajoute que de la latence.

**Résolution** : ne considérer comme réessayables que `429`, `5xx` et `0` (backend injoignable) — c'est ce que fait le template livré.

### Piège 6 — Un script fautif inquiète plus qu'il ne casse

Une erreur de compilation ou d'exécution est journalisée, renvoie une sortie vide, et **le forward par défaut s'applique**. Le trafic n'est jamais coupé. C'est l'invariant qui rend la fonctionnalité sûre à essayer — mais il masque aussi les scripts morts : surveiller les `WARN [apim-jdm]` et `[apim-filter] apim_forward script error`.

---

## 11. Pour aller plus loin

- [[125-apim-jdm-rules-engine]] — le moteur, l'aiguillage `jdm`/`janino`, `applyOutput`, le contrat de `ApimForwardHelper`,
- [[howto-31-creer-une-regle-jdm-apim|HOWTO 31]] — cycle de vie d'une règle, test d'évaluation avant publication,
- [[howto-30-publier-une-api-apim|HOWTO 30]] — publication par le wizard (alternative aux `INSERT` manuels),
- [[120-apim-architecture-pipeline]] — position exacte d'`apim_forward` dans le pipeline,
- [[121-apim-published-apis-catalog]] — catalogue des APIs et backends nommés,
- [[126-apim-certs-jwt-security]] — `sign_identity_jwt` quand le programme doit connaître le tenant appelant.
