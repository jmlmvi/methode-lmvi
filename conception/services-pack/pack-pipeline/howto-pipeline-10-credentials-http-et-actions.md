# HOWTO PIPELINE-10 — Credentials, appels HTTP et actions MCP depuis une étape

**Niveau :** Confirmé
**Cible :** application qui embarque `socle-pack-pipeline` **0.5.0** ([[howto-pipeline-01-integrer-le-pack|PIPELINE-01]] fait)
**Versions vérifiées au code :** `socle-pack-pipeline` 0.5.0, branche `feat/0.5.0`, non commitée au 2026-11-12 · `socle-v005` 5.11.0 (minimum 5.10.0) / Spring Boot 4.1.2 · 33 tests verts · date 2026-11-12
**Temps estimé :** 45 min

> Classes de référence : `credential/CredentialService`, `CredentialResolver`, `DbCredentialResolver`,
> `CredentialAccess`, `CredentialTypes` ; `engine/handlers/HttpHandler`, `McpActionHandler` ;
> `spi/PipelineHttpClient`, `JdkPipelineHttpClient`, `PipelineActionInvoker`, `LocalActionInvoker`, `PipelineSpis` ;
> `engine/ExpressionResolver`, `PipelineCallContext`, `StageExecutionContext`, `validation/DagValidator` (V7).
> Spec : `socle-pack-pipeline/docs/SPEC-socle-pack-pipeline.md` §9 (décisions D5, D6).
> Modèle de code : `src/test/java/eu/lmvi/socle/pack/v050/Pipeline050IntegrationTest.java`.

---

## 1. Contexte

Jusqu'en 0.4.0, toute sortie d'une étape vers l'extérieur passait par un `StageHandler` écrit par l'app.
La 0.5.0 apporte trois briques prêtes à l'emploi, à la manière des nœuds de n8n :

- le handler **`http`** appelle une adresse et ajoute la réponse au message ;
- le handler **`mcp_action`** appelle une action d'un worker de l'app et ajoute son résultat ;
- les **credentials** fournissent à ces étapes un jeton, un mot de passe ou une clé, sans que la valeur
  figure jamais dans le DAG, le payload, le lineage, les journaux ou les erreurs (décision D5).

Les paramètres de toutes les étapes acceptent des **expressions** `{{ … }}`, résolues juste avant
l'exécution contre le message entrant.

Chaque appel sortant passe par une **SPI** que l'app hôte peut remplacer en déclarant un bean : le Hub y
branchera Vault (`CredentialResolver`), son proxy de sortie (`PipelineHttpClient`) et le contrôle des droits
du propriétaire du pipeline (`PipelineActionInvoker`, décision D6).

Règle de routage (`CLAUDE.md`) : un service que le Hub rend déjà (courriel, stockage, NATS…) se consomme
par sa porte. `http` et `mcp_action` sont les moyens d'atteindre ces portes depuis un DAG, pas des
raisons de les réécrire.

---

## 2. Architecture

```
 DagStageFunction.apply(in)                              (une exécution d'étape)
   1. dédup, contrat d'entrée
   2. access = CredentialService.access(call.tenant())   ← une instance par exécution d'étape
   3. params résolus = ExpressionResolver.resolve(stage.params, in, call)
   4. PipelineCallScope.enter(call)                       ← contexte visible du code appelé (même fil)
   5. handler.handle(new StageExecutionContext(effective, access, call, déclaré), in)
        http        → ctx.credentials().get(code) ─► CredentialResolver.resolve(tenant, code)
                    → PipelineHttpClient.send(requête, call)
        mcp_action  → PipelineActionInvoker.invoke(worker, action, params, call)
   6. masquage : toute valeur secrète rendue en 5 → "***" (payload sortant, message d'erreur)
   7. sortie rangée dans in.metadata()._steps[stageId]   ← pour {{ $etape("id") }} en aval

 SPI (bean de l'app prioritaire, sinon celui du pack — PipelineSpis.preferHost / CredentialService)
   CredentialResolver     défaut DbCredentialResolver   (AES-256-GCM, db_pipeline_credential.secret_cipher)
   PipelineHttpClient     défaut JdkPipelineHttpClient  (java.net.http, garde SSRF, pas de redirection)
   PipelineActionInvoker  défaut LocalActionInvoker     (WorkerActionRegistry local, pipeline_worker refusé)
```

`PipelineCallContext` (`pipelineCode`, `runKey`, `tenant`, `owner`, `eventId`, `chain`) accompagne chaque
appel sortant. Pour un run manuel, `tenant` et `owner` viennent de l'`ActionContext` de `instantiate`
(`tenantId()`, `callerId()`) ; pour un run déclenché, du déclencheur ([[howto-pipeline-11-declencheurs-et-file-dediee|PIPELINE-11]]).

---

## 3. Étape 1 — Activer le résolveur par défaut

Le résolveur par défaut chiffre la valeur en **AES-256-GCM** dans `db_pipeline_credential.secret_cipher`
(table créée par `V003__credentials_triggers.sql`). Le tenant et le code sont liés au chiffré (données
associées GCM) : un chiffré recopié sur une autre ligne ne se déchiffre pas.

```bash
# 32 octets aléatoires en base64 : la clé, à ranger dans le coffre de l'app
openssl rand -base64 32
```

```yaml
socle:
  pipeline:
    credentials:
      key: ${SOCLE_PIPELINE_CREDENTIALS_KEY:}   # vide = création de credential refusée
```

| Clé | Défaut | Effet |
|---|---|---|
| `socle.pipeline.credentials.key` (`SOCLE_PIPELINE_CREDENTIALS_KEY`) | *(vide)* | base64 de 32 octets exactement. Vide, illisible ou d'une autre longueur : `credential_set` est refusé et toute résolution échoue, avec la raison (`aucune clé de chiffrement…`, `doit faire 32 octets (base64) ; reçu N`) |

Au démarrage, le journal dit quel résolveur est actif et s'il peut écrire :

```
[pipeline] credentials : résolveur actif 'db-aes-gcm' (écriture possible)
```

---

## 4. Étape 2 — Enregistrer un credential

Quatre types, définis dans `CredentialTypes`. Un champ secret est masqué partout ; un champ non secret
(nom d'utilisateur, nom d'en-tête) reste lisible dans les sorties.

| Type | Champs | Champs secrets | Usage par `http` |
|---|---|---|---|
| `http_bearer` | `token` | `token` | `Authorization: Bearer <token>` |
| `http_basic` | `username`, `password` | `password` | `Authorization: Basic base64(username:password)` |
| `http_header` | `name`, `value` | `value` | en-tête `<name>: <value>` |
| `api_key` | `key` | `key` | en-tête ou paramètre d'adresse, selon `api_key_in` / `api_key_name` de l'étape |

Les champs sont contrôlés : tous les champs du type sont requis, aucun autre n'est admis.

| Action | Paramètres | Rend |
|---|---|---|
| `credential_types` | — | `types` (champs, champs secrets), `resolver`, `writable`, `reason` |
| `credential_set` | `code` (requis, `[a-zA-Z0-9_.-]{1,150}`), `type` (requis), `secret` (objet, requis), `label` | `{code, type, backend, stored: true}` — jamais la valeur |
| `credential_list` | — | métadonnées des credentials **du tenant de l'appelant** |
| `credential_delete` | `code` | `{code, deleted}` ; la valeur est effacée, la ligne désactivée |

Le tenant est celui de l'`ActionContext` (`tenantId()`), `null` hors contexte multi-tenant. Un credential
n'est visible et résolu que dans son tenant.

```java
ActionResult r = pipelineWorker.executeAction("credential_set", ActionParameters.fromMap(Map.of(
        "code", "echo-api",
        "type", "http_bearer",
        "label", "API d'écho",
        "secret", Map.of("token", jeton))), ctx);   // ctx porte le tenant
```

Par MCP : `pipeline_worker__credential_set` avec les mêmes arguments.

---

## 5. Étape 3 — Appeler une adresse : le handler `http`

Étape de type E (aussi admis en T et K). Paramètres, expressions admises partout sauf restriction du §5.2 :

| Paramètre | Défaut | Rôle |
|---|---|---|
| `url` | **requis** (V7) | adresse appelée |
| `method` | `GET` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` |
| `headers` | — | objet d'en-têtes |
| `query` | — | objet de paramètres d'adresse (encodés, ajoutés à ceux de `url`) |
| `body` | — | objet ou tableau → JSON ; texte → tel quel |
| `body_type` | `json` (`text` si `body` est un texte) | `json`, `text`, `form` ; pose `Content-Type` s'il est absent |
| `credential` | — | code du credential |
| `api_key_in` / `api_key_name` | `header` / — | pour un credential `api_key` : où et sous quel nom placer la clé (`api_key_name` requis) |
| `timeout_ms` | `socle.pipeline.http.timeout-ms` | délai de cet appel |
| `output` | `http` | champ de sortie |
| `fail_on_status` | `true` | un statut ≥ 400 fait échouer l'étape |

Sortie : le payload entrant (s'il est un objet ; sinon un objet vide) augmenté de
`<output>: { status, headers, body }`. Les noms d'en-têtes sont en minuscules ; `body` est lu en JSON quand la
réponse annonce du JSON, sinon en texte (`null` si vide).

```json
{ "id": "appel", "type": "E", "handler": "http",
  "params": {
    "url": "https://api.exemple.fr/echo",
    "method": "POST",
    "credential": "echo-api",
    "query": { "q": "{{ $json.q }}" },
    "body":  { "texte": "{{ $json.texte }}" } } }
```

### 5.1 La garde SSRF du client par défaut

`JdkPipelineHttpClient` refuse, avant tout envoi :

- un schéma autre que `http` ou `https`, une adresse sans hôte, une méthode hors liste ;
- un hôte absent de `socle.pipeline.http.allowed-hosts` quand la liste est renseignée (`.exemple.fr` admet
  le domaine et ses sous-domaines) ;
- sauf `allow-private=true` : un nom dont **une seule** des adresses est de bouclage, privée, de lien local
  (dont 169.254/16, métadonnées cloud), CGNAT 100.64/10, 0/8, 198.18/15, multicast, ULA `fc00::/7` ou une IPv4
  mappée en IPv6 de ces plages.

Il ne suit **aucune redirection** (une 3xx rend son statut) et tronque la réponse au-delà de
`max-response-bytes`.

| Clé `socle.pipeline.http.*` | Variable | Défaut |
|---|---|---|
| `allow-private` | `SOCLE_PIPELINE_HTTP_ALLOW_PRIVATE` | `false` |
| `allowed-hosts` | `SOCLE_PIPELINE_HTTP_ALLOWED_HOSTS` | *(vide : tout hôte public)* |
| `timeout-ms` | `SOCLE_PIPELINE_HTTP_TIMEOUT_MS` | `15000` (délai de connexion : au moins 1 s) |
| `max-response-bytes` | — | `2000000` |

### 5.2 Un credential ne part que vers une origine écrite dans le DAG

Avec un `credential`, le **code du credential** et l'**origine** de `url` (schéma, hôte, port) s'écrivent en
dur dans le DAG. Les expressions restent admises dans le chemin, la requête, les en-têtes et le corps. Sans
cette règle, l'auteur d'un message (un salon, un webhook) choisirait où partir avec le jeton.

| Contrôle | Où | Message |
|---|---|---|
| `credential` calculé par une expression | V7 (validation) et exécution | `le credential doit être écrit dans le DAG, pas calculé` |
| schéma ou hôte de `url` absent ou calculé | V7 (validation) | `avec un credential, le schéma et l'hôte de 'url' doivent être écrits dans le DAG` |
| idem, plus `?` ou `#` dans l'origine | exécution (`HttpHandler.requireFixedTarget`) | `… (expressions admises seulement dans le chemin et les paramètres)` |

À l'exécution, le contrôle lit le paramètre **tel que déclaré**, avant résolution des expressions :
`StageExecutionContext.declaredParam(champ)`.

```json
{ "params": { "url": "https://api.exemple.fr/{{ $json.chemin }}", "credential": "echo-api" } }   ✔
{ "params": { "url": "{{ $json.cible }}/echo",                    "credential": "echo-api" } }   ✘ V7
{ "params": { "url": "https://api.exemple.fr/echo",               "credential": "{{ $json.cred }}" } } ✘ V7
```

### 5.3 Le masquage (décision D5)

`CredentialAccess` retient chaque valeur secrète rendue pendant l'étape. Après le handler, le moteur remplace
ces valeurs par `***` dans le payload sortant (clés et valeurs textuelles, à toute profondeur). Une exception
levée pendant l'étape est remplacée par une `IllegalStateException` au message masqué, sans sa cause
d'origine. Le payload masqué est celui qui part vers l'aval, le lineage, les artefacts et `_steps`.

Prouvé au test de bout en bout : le serveur renvoie l'en-tête reçu, la sortie porte `"auth": "Bearer ***"` ; la
valeur ne figure dans aucune table du pack ; une réponse 401 donne une erreur contenant `401` et `***`.

---

## 6. Étape 4 — Appeler une action : le handler `mcp_action`

| Paramètre | Défaut | Rôle |
|---|---|---|
| `worker` | **requis** | worker visé (ex. `salon_worker`) |
| `action` | **requis** | action (ex. `salon_post`) |
| `params` | `{}` | paramètres de l'action, expressions admises |
| `output` | `result` | champ de sortie |
| `fail_on_error` | `true` | `false` : un échec donne `<output>: { "error": … }` au lieu d'arrêter le message |

```json
{ "id": "rev", "type": "E", "handler": "mcp_action",
  "params": { "worker": "echo_worker", "action": "reverse",
              "params": { "text": "{{ $json.msg }}" }, "output": "r" } }
```

`LocalActionInvoker` appelle le registre local (`WorkerActionRegistry`) avec un `ActionContext`
`INTERNAL`, `callerId = pipeline:<code>`, `tenantId` = tenant du run (le `runKey` et l'`eventId` y sont aussi
transmis). Il **refuse**
`pipeline_worker` : un pipeline en lance un autre par une étape Composite (C), dont la profondeur est bornée
([[howto-pipeline-08-catalogue-fork-et-sous-pipelines|PIPELINE-08]]).

L'action s'exécute sur le fil de l'étape : elle lit `PipelineCallScope.current()` pour savoir qu'un pipeline
l'appelle, et transmet `chainForChildren()` à tout événement qu'elle produit (anti-boucle,
[[howto-pipeline-11-declencheurs-et-file-dediee|PIPELINE-11]] §6).

---

## 7. Étape 5 — Les expressions

| Expression | Valeur |
|---|---|
| `{{ $json.a.b[0] }}`, `{{ $json["clé"] }}` | payload entrant |
| `{{ $etape("id").x }}` (alias `$step`) | sortie d'une étape **en amont** traversée par ce message |
| `{{ $meta.x }}` | métadonnées du message (hors `_steps`) |
| `{{ $run.key }}`, `$run.pipeline`, `$run.tenant`, `$run.owner`, `$run.eventId` | contexte d'appel |

- Une chaîne réduite à **une seule** expression prend le type JSON de la valeur (objet, nombre, booléen ;
  absente → `null`). Sinon chaque expression est interpolée en texte (objet → JSON compact, absente → vide).
- Aucun code n'est évalué. Une racine inconnue est une erreur, à la validation (V7) comme à l'exécution.
- Les handlers reçoivent des paramètres **déjà résolus** ([[howto-pipeline-03-ecrire-un-stage-handler|PIPELINE-03]]).

```json
{ "id": "t1", "type": "T", "handler": "set-field",
  "params": { "field": "salut", "value": "Bonjour {{ $json.nom }} ({{ $run.pipeline }})" } },
{ "id": "t2", "type": "T", "handler": "set-field",
  "params": { "field": "copie", "value": "{{ $etape(\"t1\").salut }}" } },
{ "id": "t3", "type": "T", "handler": "set-field",
  "params": { "field": "objet", "value": "{{ $json.adresse }}" } }
```

Avec `{"nom":"Ada","adresse":{"ville":"Nantes"}}` dans un pipeline `expr-1` : `salut = "Bonjour Ada (expr-1)"`,
`copie` identique, `objet = {"ville":"Nantes"}` (objet conservé).

---

## 8. Étape 6 — Remplacer une SPI par un bean de l'app

Déclarer un bean de l'interface suffit : le pack prend le premier bean qui n'est **pas** son implémentation
par défaut. Le bean du pack reste construit, l'app peut donc l'injecter et lui déléguer.

### 8.1 `PipelineHttpClient` : journaliser les sorties en gardant la garde SSRF

```java
package eu.lmvi.monapp.pipeline;

import eu.lmvi.socle.pack.pipeline.engine.PipelineCallContext;
import eu.lmvi.socle.pack.pipeline.spi.JdkPipelineHttpClient;
import eu.lmvi.socle.pack.pipeline.spi.PipelineHttpClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Sortie HTTP des pipelines : journal par appel, puis le client du pack (garde SSRF, pas de redirection). */
@Component
public class JournalPipelineHttpClient implements PipelineHttpClient {

    private static final Logger log = LoggerFactory.getLogger(JournalPipelineHttpClient.class);
    private final JdkPipelineHttpClient delegue;

    public JournalPipelineHttpClient(JdkPipelineHttpClient delegue) {
        this.delegue = delegue;
    }

    @Override
    public Response send(Request request, PipelineCallContext call) {
        Response r = delegue.send(request, call);
        // ni en-têtes ni corps au journal : ils portent les credentials
        log.info("[pipeline-http] {} {} {} → {} (pipeline={} tenant={} owner={})", call.runKey(), request.method(),
                request.uri().getHost(), r.status(), call.pipelineCode(), call.tenant(), call.owner());
        return r;
    }
}
```

### 8.2 `PipelineActionInvoker` : borner les actions appelables

```java
package eu.lmvi.monapp.pipeline;

import eu.lmvi.socle.pack.pipeline.engine.PipelineCallContext;
import eu.lmvi.socle.pack.pipeline.spi.LocalActionInvoker;
import eu.lmvi.socle.pack.pipeline.spi.PipelineActionInvoker;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;

/** Les pipelines de l'app n'appellent que les workers listés ; le reste passe par le registre local. */
@Component
public class InvocateurBorne implements PipelineActionInvoker {

    private static final Set<String> WORKERS_ADMIS = Set.of("echo_worker", "monapp_notification_worker");
    private final LocalActionInvoker local;

    public InvocateurBorne(LocalActionInvoker local) {
        this.local = local;
    }

    @Override
    public Outcome invoke(String worker, String action, Map<String, Object> params, PipelineCallContext call) {
        if (!WORKERS_ADMIS.contains(worker)) {
            return Outcome.failed("worker non admis pour les pipelines : " + worker);
        }
        return local.invoke(worker, action, params, call);   // garde aussi le refus de pipeline_worker
    }
}
```

### 8.3 `CredentialResolver` : un coffre externe

Le contrat : `backendName()`, `writable()` / `notWritableReason()`, `store(tenant, code, type, secret)`,
`resolve(tenant, code)` (lève `IllegalStateException` si absent), `delete(tenant, code)`. Les métadonnées
restent dans `db_pipeline_credential` (colonne `backend` = `backendName()`, `secret_cipher` à `NULL`) ; seule
la valeur vit dans le coffre. Le Hub branchera Vault par ce bean. Un résolveur en lecture seule rend
`writable() = false` : `credential_set` est alors refusé avec `notWritableReason()`, et les métadonnées
s'écrivent par l'app.

---

## 9. Vérifier

```bash
curl -s "$APP/mcp" -H "Authorization: Bearer $MCP_API_KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"pipeline_worker__credential_types","arguments":{}}}' \
 | jq -r '.result.content[0].text'
```

Attendu : `"resolver":"db-aes-gcm","writable":true`. Puis `pipeline_worker__list_handlers` : `descriptors`
contient `http` (`credentialTypes` : les quatre types) et `mcp_action`.

```sql
-- la valeur n'est jamais en clair : seul secret_cipher (base64) est rempli
SELECT code, cred_type, backend, secret_cipher IS NOT NULL AS chiffre, x_partition
  FROM schema_monapp.db_pipeline_credential WHERE x_active = true;
```

---

## 10. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `credential_set` sans `SOCLE_PIPELINE_CREDENTIALS_KEY` | échec `credentials en base indisponibles : aucune clé de chiffrement…` |
| 2 | `credential_set` type `http_basic` sans `password` | échec `champ 'password' requis` |
| 3 | `credential_list` | métadonnées, aucune valeur ; rien d'un autre tenant |
| 4 | Étape `http` avec credential vers un serveur qui renvoie l'en-tête reçu | sortie `Bearer ***` ; valeur absente de `tr_pipeline_*` |
| 5 | Même étape, serveur en 401 | étape en échec, erreur avec `401` et `***` |
| 6 | `url` = `{{ $json.cible }}/echo` avec un credential | `validate` : erreur V7 `l'hôte de 'url'` |
| 7 | `http` vers `http://127.0.0.1/…` sans `allow-private` | échec `adresse interne refusée pour 127.0.0.1` |
| 8 | `mcp_action` sur `pipeline_worker` | échec `… utiliser un stage Composite (C)` |
| 9 | `{{ $etape("t2").y }}` dans `t1`, `t2` en aval | `validate` : erreur V7 `n'est pas en amont` |

---

## 11. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| **Clé AES changée ou perdue** | toute étape à credential échoue : `credential '…' indéchiffrable (clé changée ?)` | ranger la clé dans le coffre de l'app ; changer de clé = ré-enregistrer chaque credential |
| **Run instancié sans tenant** (`executeAction(…, null)`) alors que le credential a été créé dans un tenant | `credential inconnu: 'x'` | instancier avec l'`ActionContext` du tenant ; le credential suit `call.tenant()` |
| **SPI `PipelineHttpClient` réécrite sans déléguer** | la garde SSRF, `allowed-hosts` et le refus des redirections disparaissent : ils vivent dans `JdkPipelineHttpClient` | déléguer au bean du pack (§8.1) ou réimplémenter les mêmes contrôles |
| **SPI `PipelineActionInvoker` réécrite sans déléguer** | le refus de `pipeline_worker` disparaît : un pipeline peut en lancer un autre hors de la garde de profondeur | déléguer à `LocalActionInvoker` (§8.2) ou refuser `pipeline_worker` soi-même |
| Valeur secrète de moins de 4 caractères | non masquée (trop courte pour être cherchée sans masquer du texte ordinaire) | secrets longs |
| Champ non secret (`username`, `name` d'un `http_header`) | lisible dans les sorties | voulu ; ne pas y ranger de secret |
| Handler de l'app qui journalise la valeur, ou la range dans les **métadonnées** du message | fuite : le masquage couvre le payload sortant et l'erreur, pas les journaux ni `metadata` | ne jamais journaliser `ctx.credentials().get(...)` ; rien de secret en métadonnée |
| `{{ $run.foo }}` | accepté par V7 (toute clé `$run.*`), refusé à l'exécution : `$run admet key, pipeline, tenant, owner, eventId` | s'en tenir aux cinq clés |
| `{{ $etape("x") }}` vers une étape d'une autre branche | V7 refuse si `x` n'est pas un ancêtre ; à l'exécution `cette étape n'est pas en amont du message` | ne viser que des ancêtres |
| Réponse plus grosse que `max-response-bytes` | corps tronqué sans erreur ; un JSON tronqué est rendu en texte | relever la limite, ou paginer |
| Redirection 301/302 | `status` 3xx rendu, l'étape réussit (`fail_on_status` ne vise que ≥ 400) | appeler l'adresse finale |
| `api_key` sans `api_key_name` | `credential api_key '…' sans paramètre 'api_key_name'` | renseigner `api_key_name` (et `api_key_in`) |
| Payload entrant qui n'est pas un objet | `http` / `mcp_action` repartent d'un objet vide : le payload d'origine disparaît | payload objet en entrée |
| Rôle PostgreSQL qui pose `app.current_tenant_id` (RLS) avec un appelant sans tenant | `fn_x_partition_default` remplit `x_partition` à l'insertion, les lectures à tenant `null` ne retrouvent pas la ligne | passer le même tenant à l'action qu'à la session |

---

## 12. Pour aller plus loin

- [[howto-pipeline-11-declencheurs-et-file-dediee|PIPELINE-11]] — déclencher ces pipelines par événement, webhook ou cron
- [[howto-pipeline-03-ecrire-un-stage-handler|PIPELINE-03]] — écrire un handler qui lit un credential (`ctx.credentials()`)
- [[howto-pipeline-02-declarer-valider-publier-un-dag|PIPELINE-02]] — la règle V7
- `socle-pack-pipeline/src/test/java/eu/lmvi/socle/pack/v050/Pipeline050IntegrationTest.java`
