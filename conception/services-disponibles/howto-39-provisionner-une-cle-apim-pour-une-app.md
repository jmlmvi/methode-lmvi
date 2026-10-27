# HOWTO 39 — Provisionner une clé APIM pour une app (accès LLM et autres APIs)

> **Pour qui** : le développeur ou l'agent qui câble une app sur une API publiée par l'API Manager
> — typiquement l'accès LLM (`agentia`, `articles-llm`), mais la procédure vaut pour toute API
> du catalogue APIM (`transcription`, `embed-std`, `kew-fast`, `nats`…).
>
> **Durée** : 10 minutes. **Prérequis** : accès SSH au serveur du Hub, MCP `soclehub` disponible.

---

## 0. Ce que cette procédure règle — et pourquoi elle est manuelle

Une app ne parle **jamais** en direct à un provider LLM. Elle sort par l'edge APIM
(`https://api.thesocle.net/<api>/v1`), qui authentifie, applique les scopes, les quotas, le
rate-limit, la facturation et l'audit. Côté app, cela se résume à une variable d'environnement :
une clé.

**Il n'existe pas d'action Hub pour fabriquer cette clé.** `iam_worker.create_api_key` écrit :

```sql
INSERT INTO iam.tr_api_keys (id_users, key_name, key_hash, expires_at, revoked)
```

Les colonnes `scopes` et `id_tenant` n'y figurent pas, et la clé produite est un **UUID**. Or
`ApimAuthHandler` n'extrait que le format `apim_<env>_<40hex>` : une clé UUID est rejetée en
`401 auth_missing` **avant tout lookup**, et le message ne dit pas que le format est en cause.

Conséquence : toute app qui appelle une API APIM a sa clé frappée à la main. C'est le cas de
REGIES, RssArchiver, BilanSocle et SDR V2. **Dette identifiée** : une action
`iam_worker.create_apim_key(user, name, scopes, tenant, expires)` supprimerait ce HOWTO ; tant
qu'elle n'existe pas, cette procédure est la référence.

Signature de reconnaissance dans la base : une clé qui porte un `scopes` non vide a
nécessairement été écrite par cette procédure ; une clé au `scopes` vide vient du MCP et **ne
fonctionnera pas** sur l'edge.

---

## 1. Étape 0 — Vérifier qu'une clé n'existe pas déjà

Ne jamais empiler les clés : une clé en clair n'est **jamais récupérable** (seule l'empreinte est
stockée), donc une clé oubliée est une clé morte qui pollue l'inventaire.

```bash
ssh ubuntu@<hôte-du-hub> 'docker exec soclehub-postgres sh -lc \
  "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \
  \"select x_id, key_name, scopes, id_tenant, revoked from iam.tr_api_keys \
    where key_name like '\''%<app>%'\'' order by x_id desc;\""'
```

- Une ligne avec le bon `scopes` et `revoked=false` → **réutiliser** ; si la valeur en clair est
  perdue, révoquer puis refrapper (§3 avec `revoked=true` sur l'ancienne).
- Aucune ligne → continuer.

---

## 2. Étape 1 — Identifier l'API cible et son scope requis

```bash
ssh ubuntu@<hôte-du-hub> 'docker exec soclehub-postgres sh -lc \
  "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \
  \"select slug, base_path_external, required_scope, status from apim.tr_published_api \
    where status='\''published'\'' order by slug;\""'
```

Exemples au 2026-07-23 :

| API | Base path | Scope requis |
|---|---|---|
| `agentia` | `/agentia/v1` | `api:agentia:*` |
| `articles-llm` | `/articles-llm/v1` | `api:articles-llm:*` |
| `transcription` | `/transcription/v1` | `api:transcription:*` |
| `embed-std` | `/embed-std/v1` | `api:embed-std:read` |

Le `scopes` de la clé doit satisfaire le `required_scope` (`ScopeMatcher`, jokers `*` acceptés).

---

## 3. Étape 2 — Frapper la clé et n'insérer que son empreinte

```bash
key="apim_prod_$(openssl rand -hex 20)"
hash=$(printf "%s" "$key" | openssl dgst -sha256 | awk '{print $NF}')
echo "$key"     # à conserver MAINTENANT — irrécupérable ensuite
```

```sql
INSERT INTO iam.tr_api_keys (id_users, key_name, key_hash, scopes, id_tenant, revoked, x_active)
VALUES (<id_user>, '<app>-apim-<usage>', '<hash>', '["api:agentia:*"]'::jsonb, <id_tenant>, false, true)
RETURNING x_id, key_name, scopes, id_tenant;
```

- `id_users` / `id_tenant` : reprendre ceux d'une app comparable
  (`select k.id_users, k.id_tenant from iam.tr_api_keys k where k.key_name='regies-apim-llm';`).
- Convention de nommage : `<app>-apim-<usage>` (`sdrv2-apim-llm`, `bilansocle-transcription`).

---

## 4. Étape 3 — Ranger la clé dans Vault (ne pas sauter)

C'est l'étape qu'on oublie, et elle coûte cher : sans elle, la clé n'existe plus qu'en variable
d'environnement du conteneur. Un `uninstall_app`, une purge, une machine de dev réinstallée, et
il faut tout refrapper.

```
vault_worker.set_secret(
    path  = "soclehub/apps/<app>/apim",
    key   = "agentia_api_key",
    value = "<key>")
```

---

## 5. Étape 4 — Enregistrer l'app côté gateway (APIs LLM uniquement)

Pour `agentia` / `articles-llm`, la gateway veut connaître l'app appelante (quota, audit,
restriction de providers) :

```
agentia_worker.register_app(
    tenant_id = "lmvi",
    app_id    = "<app>",
    app_name  = "<Nom lisible>")
```

`allowed_providers` / `allowed_models` vides = tous autorisés.

---

## 6. Étape 5 — Injecter la clé dans l'app

```
docker_worker.set_env_var(app_id="<app>", key="SOCLE_AI_PROVIDERS_AGENTIA_API_KEY", value="<key>")
docker_worker.update_app(app_id="<app>", new_tag="<tag courant>")
```

⚠️ **`restart_app` ne suffit pas** : `set_env_var` écrit dans Vault, mais seule la recréation du
conteneur par `update_app` réinjecte l'environnement. Après `update_app`, penser à
`proxy_worker.update_route(app_id, target_host=<nouvelle IP>)` — le proxy garde l'ancienne IP.

Variables attendues par `socle-pack-ai` :

| Variable | Rôle |
|---|---|
| `SOCLE_AI_PROVIDERS_AGENTIA_API_KEY` | la clé `apim_prod_…` |
| `SOCLE_AI_PROVIDERS_AGENTIA_BASE_URL` | `https://api.thesocle.net/<api>/v1` |
| `SOCLE_AI_PROVIDERS_AGENTIA_APP_ID` | slug de l'app (en-tête `X-App-Id`) |
| `SOCLE_AI_PROVIDERS_AGENTIA_MODEL` | modèle par défaut |

---

## 7. Étape 6 — Prouver depuis le conteneur, pas depuis son poste

Un appel réussi depuis la box de dev ne prouve que la clé. L'appel doit partir **du conteneur de
production** : il valide en plus l'egress réseau et l'environnement réellement injecté.

```bash
ssh ubuntu@<hôte> 'docker exec <app> sh -lc "curl -s --max-time 90 \
  -X POST https://api.thesocle.net/agentia/v1/chat/completions \
  -H \"Authorization: Bearer \$SOCLE_AI_PROVIDERS_AGENTIA_API_KEY\" \
  -H \"Content-Type: application/json\" -H \"X-App-Id: <app>\" \
  -d \"{\\\"model\\\":\\\"glm47\\\",\\\"messages\\\":[{\\\"role\\\":\\\"user\\\",\\\"content\\\":\\\"Reponds exactement: PREUVE\\\"}],\\\"max_tokens\\\":512}\""'
```

Attendu : `200` et un `content` non nul.

---

## 8. Pièges, dans l'ordre où on les rencontre

| Symptôme | Cause | Correctif |
|---|---|---|
| `401 auth_missing` | clé au format UUID (issue de `create_api_key`) | refrapper en `apim_prod_<40hex>` (§3) |
| `403` scope | `scopes` de la clé ne satisfait pas `required_scope` | corriger `scopes` en base (§2-§3) |
| `404 No route configured` juste après l'INSERT | catalogue APIM et cache de règles rechargés toutes les **5 min** | attendre — **ne pas redémarrer le Hub**, ça coupe les autres apps et le flux de commandes des minihubs ne se rétablit pas toujours seul |
| Clé absente du conteneur après `set_env_var` | `restart_app` ne réinjecte pas l'environnement | `update_app` (§6) |
| `content: null` + `finish_reason: length` | modèle **reasoning** (`glm47`) : le raisonnement consomme le budget avant le contenu | `max_tokens` généreux (≥ 512) ; ne pas conclure à une panne. `enable_thinking=false` n'est pas honoré par ce backend |
| `<think>…` dans le contenu | `minimax/MiniMax-M3` rend le raisonnement inline | laisser le décodeur du pack le retirer, ou préférer `glm47` |
| Clé perdue | seule l'empreinte est stockée | révoquer (`revoked=true`) et refrapper — d'où l'étape Vault (§4) |

---

## 9. Voir aussi

- `howto-36-exposer-un-programme-en-api-avec-repli-janino.md` — publier une API et son piège de clé
- `howto-30-publier-une-api-apim.md` — publication d'API dans le catalogue
- `howto-27-configurer-agentia-gateway.md` — providers, quotas, pricing de la gateway
- `howto-28-integrer-un-socle-pack-dans-une-app.md` — câbler `socle-pack-ai` (règle PACK FIRST)
- `APP-16-REGIES/docs/PASSATION-MIGRATION-SOCLE-PACK-AI.md` — première formalisation de cette procédure
