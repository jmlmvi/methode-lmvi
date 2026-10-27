# HOWTO 28 — Intégrer un `socle-pack-*` dans une APP-*

> **Niveau** : avancé | **Cible** : SocleHub Hub 3.12.1 | **Framework** : socle-v005 **5.7.2** | **Pack mature** : socle-pack-ai **2.3.5**

**Audience** : développeur qui démarre une nouvelle APP-* (ou enrichit une existante) et veut consommer un ou plusieurs `socle-pack-*` pour gagner des capacités métier sans réinventer.

**Préalable** : avoir lu [[100-socle-packs-integration|Intégration des socle-packs]]. Avoir Java 21 GraalVM CE installé. Avoir l'APP-* squelette générée via `bootstrap.sh` (cf. [[113-app-05-test-soclepack|APP-05 test-soclepack]]) ou clonée depuis `APP-06-NotionSocle` ou `APP-04-CNX2Notion`.

---

## Vue d'ensemble du workflow

```
1. Choisir le(s) pack(s) à intégrer (101-105)
2. Ajouter la dépendance Maven dans pom.xml
3. Installer les packs en local (mvn install) si SNAPSHOT
4. Configurer le schéma PG du pack (variable SOCLE_{PACK}_SCHEMA)
5. Ajouter les secrets dans Vault sous apps/{appId}/...
6. Configurer les variables d'environnement de l'APP-*
7. Rebuilder l'APP-*, repackager en .tar.gz
8. Déployer via SocleHub install_app / update_app
9. Vérifier que les Workers du pack sont visibles dans Status Dashboard
10. Invoquer une première action
```

---

## Étape 1 — Choisir le(s) pack(s)

Référence rapide :

| Besoin | Pack |
|---|---|
| LLM / Embeddings / RAG / Agent IA | `socle-pack-ai` (le plus mature) |
| Notifications email / SMS / Telegram / Slack | `socle-pack-com` |
| Intégrations Notion / GDrive / Stripe / HubSpot | `socle-pack-Connectors` |
| Pipeline RSS → curation → newsletter | `socle-pack-Editorial` (dépend de ai + com) |
| Ingestion mailbox per-user (IMAP / Gmail API) | `socle-pack-Mail` (dépend de ai, RLS bi-axe) |

Détail dans la fiche correspondante (101 à 105).

**Note** : `socle-pack-Editorial` nécessite **automatiquement** les packs `ai` et `comm`. Si vous oubliez l'un des deux, certains Workers d'Editorial tournent en mode dégradé silencieux.

---

## Étape 2 — Ajouter la dépendance Maven

Édition du `pom.xml` de votre APP-* :

```xml
<dependencies>
    <!-- Framework V005 obligatoire -->
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-v005</artifactId>
        <version>5.7.2</version>
    </dependency>

    <!-- Pack(s) métier -->
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-ai</artifactId>
        <version>2.3.5</version>
    </dependency>

    <!-- Si pack-Editorial : ajouter aussi pack-com -->
    <!--
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-editorial</artifactId>
        <version>1.0.0-SNAPSHOT</version>
    </dependency>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-com</artifactId>
        <version>1.0.0-SNAPSHOT</version>
    </dependency>
    -->
</dependencies>
```

---

## Étape 3 — Installer les packs en local (SNAPSHOT)

Les packs sont en SNAPSHOT (sauf `socle-pack-ai` qui est en `2.3.5` releasée). Pour les versions SNAPSHOT, il faut les installer localement :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-ai
mvn clean install -DskipTests

cd /opt/2026-TheHub4TheSocle/socle-pack-com
mvn clean install -DskipTests

# … répéter pour chaque pack utilisé
```

Vérifier dans `~/.m2/repository/eu/lmvi/socle-pack-{name}/{version}/` que le JAR est présent.

---

## Étape 4 — Configurer le schéma PG du pack

Chaque pack utilise un schéma PG paramétrable via une variable `SOCLE_{PACK}_SCHEMA`. Par défaut c'est `public`. Recommandation : un schéma dédié par pack pour clarifier.

Dans le `application.yml` de votre APP-* :

```yaml
soclehub-pack:
  ai:
    schema: ${SOCLE_AI_SCHEMA:ai}
  com:
    schema: ${SOCLE_COMM_SCHEMA:comm}
```

Ou via variables d'environnement Docker au runtime :

```bash
SOCLE_AI_SCHEMA=ai
SOCLE_COMM_SCHEMA=comm
```

Les migrations Flyway du pack sous `db/{name}/V*.sql` utilisent un placeholder `${pack_schema}` qui sera substitué automatiquement.

---

## Étape 5 — Ajouter les secrets dans Vault

Conventions des chemins Vault (cf. fiche du pack) :

```
apps/{appId}/openai-api-key                # pack-ai (clé OpenAI)
apps/{appId}/smtp-password                  # pack-com (SMTP)
apps/{appId}/twilio-auth-token              # pack-com (SMS)
apps/{appId}/telegram-bot-token             # pack-com (Telegram)
apps/{appId}/slack-webhook-url              # pack-com (Slack)
apps/{appId}/notion-api-key                 # pack-Connectors (Notion)
apps/{appId}/gdrive-service-account-json   # pack-Connectors (GDrive JSON Service Account)
apps/{appId}/stripe-secret-key              # pack-Connectors (Stripe)
apps/{appId}/users/{userId}/mail/*          # pack-Mail (credentials per-user)
```

Pose des secrets via MCP côté Hub :

```bash
JWT="..."

curl -sk -X POST "https://admin.thesocle.net/api/actions/vault_worker/set_secret" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "path":  "apps/myapp/openai-api-key",
       "key":   "value",
       "value": "sk-proj-..."
     }'
```

---

## Étape 6 — Configurer les variables d'environnement de l'APP-*

Dans le `manifest.json` de votre APP-* :

```json
{
  "appId":   "myapp",
  "name":    "My App",
  "appType": "internal",
  "dbType":  "postgresql",
  "ssoMode": "oidc",
  "envVars": {
    "SOCLE_AI_SCHEMA":             "ai",
    "SOCLE_AI_OPENAI_VAULT_PATH":  "apps/myapp/openai-api-key",
    "SOCLE_AI_DEFAULT_PROVIDER":   "openai",
    "SOCLE_AI_EMBEDDING_DIM":      "1536"
  }
}
```

Les variables sont injectées dans le conteneur Docker au démarrage par SocleHub (`DockerWorker.install_app`).

---

## Étape 7 — Rebuilder l'APP-* et packager

```bash
cd /opt/2026-TheHub4TheSocle/APP-XX-MyApp/myapp

mvn clean package -DskipTests
# → target/myapp-1.0.0.jar

# Packager pour SocleHub
docker build -t myapp:1.0.0 .

# Ou directement en tar.gz selon votre workflow CI
tar czf myapp-1.0.0.tar.gz target/myapp-1.0.0.jar Dockerfile manifest.json
```

---

## Étape 8 — Déployer via SocleHub

Si c'est une nouvelle app :

```bash
# Ajouter l'app au catalog (édition manuelle de soclehub/catalog.json,
# ou via une action MCP si vous en disposez)

# Installer
curl -sk -X POST "https://admin.thesocle.net/api/actions/docker_worker/install_app" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "app_id":         "myapp",
       "catalog_app_id": "myapp",
       "subdomain":      "myapp",
       "docker_tag":     "1.0.0",
       "sso_mode":       "oidc"
     }'
```

Si c'est une mise à jour :

```bash
# update_app + update_route (cf. mémoires feedback)
curl -sk -X POST "https://admin.thesocle.net/api/actions/docker_worker/update_app" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{ "app_id": "myapp", "new_tag": "1.0.1" }'

# Récupérer la nouvelle IP du container
NEW_IP=$(curl -sk -X POST "https://admin.thesocle.net/api/actions/docker_worker/get_app" \
     -H "Authorization: Bearer $JWT" \
     -d '{ "app_id": "myapp" }' | jq -r '.container_ip')

curl -sk -X POST "https://admin.thesocle.net/api/actions/proxy_worker/update_route" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d "{ \"app_id\": \"myapp\", \"target_host\": \"$NEW_IP\" }"
```

---

## Étape 9 — Vérifier que les Workers du pack tournent

Le Hub agrège les MCP des apps via `McpProxyWorker`. Après `update_app`, refresh :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/mcp_proxy_worker/mcp_proxy_refresh" \
     -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{}'
```

Visitez `https://admin.thesocle.net/hub/mcpagger` — les actions du pack doivent maintenant apparaître sous `myapp__embedding_worker__embed_text`, etc.

Ou direct via les logs de l'app :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/docker_worker/get_logs" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{ "app_id": "myapp", "lines": 100 }'
```

Vous devez voir des logs Spring `Worker {name} initialized / started` pour chaque Worker du pack.

Status Dashboard interne (port 9374 du container app) : `curl -sk https://myapp.{tenant}.thesocle.net:9374/status` (si exposé).

---

## Étape 10 — Invoquer une première action

Depuis le code de votre APP-* :

```java
@Service
public class MyAppService {

    private final EmbeddingWorker embeddingWorker;   // injection auto Spring

    public MyAppService(EmbeddingWorker embeddingWorker) {
        this.embeddingWorker = embeddingWorker;
    }

    public List<Double> getEmbedding(String text) {
        ActionResult result = embeddingWorker.executeAction(
            "embed_text",
            ActionParameters.fromMap(Map.of("text", text)),
            ActionContext.internal("my_app_service"));

        if (!result.success()) {
            throw new RuntimeException("Embedding failed: " + result.error());
        }
        return (List<Double>) result.data().get("vector");
    }
}
```

Depuis l'extérieur (côté Hub via MCP proxy) :

```bash
curl -sk -X POST "https://admin.thesocle.net/api/actions/myapp__embedding_worker/embed_text" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{ "text": "Bonjour le monde" }'
```

---

## Pièges courants

1. **Pack en SNAPSHOT pas installé localement** : `mvn package` de l'APP-* échoue avec `Could not find artifact eu.lmvi:socle-pack-XXX`. Toujours `mvn install` dans le pack avant de builder l'app consommatrice.

2. **Schéma PG en conflit** : si deux packs utilisent par défaut `public`, leurs tables peuvent entrer en conflit. Toujours définir un `SOCLE_{PACK}_SCHEMA` dédié par pack (ex. `ai`, `comm`, `connectors`).

3. **Cross-pack dependency manquant** : `socle-pack-Editorial` dépend d'`ai` + `com`. Si l'un manque, les Workers d'Editorial tournent en mode dégradé sans alerte explicite. Vérifier les logs Spring au démarrage : `Editorial: dependencies OK (ai, com)`.

4. **Secrets pas dans Vault** : si `SOCLE_AI_OPENAI_VAULT_PATH` pointe vers un chemin Vault inexistant, le Worker démarre quand même mais retourne `ofFailure("provider unavailable")` à chaque appel. Toujours valider avec `vault_worker.get_secret_keys` avant déploiement.

5. **`update_app` sans `update_route`** : le proxy reste sur l'ancien container → 502. Toujours faire les deux dans l'ordre.

6. **`set_env_var` sans `update_app`** : les nouvelles env vars ne se propagent pas par `restart_app` seul. Utiliser `update_app(same_tag)` après `set_secret`.

7. **`ctx.getPartition()` retourne null** : V005 5.6.0+ a supprimé ce champ. Utiliser le helper standard `currentTenant()` qui lit la session PG (cf. fiche pack et `06-conventions-db-iam-tenants.md` côté `docs4AgentCode`).

8. **Triggers LMVI standards en conflit avec triggers du pack** : sur chaque table de pack, DROPer explicitement les triggers `z_after_insert/update/delete` et `update_changed_fields` avant de poser ceux du pack. Pattern dans tous les `db/{name}/V001__*.sql`.

9. **Hook GOV-009 bloque** : si vous écrivez un Worker avec `@Scheduled` ou `new Thread()`, le hook rejette à la compilation. Utiliser Virtual Threads (`Thread.ofVirtual()`) ou `ScheduledExecutorService` créé dans `start()` / shutdowné dans `stop()`.

10. **MCP Proxy ne voit pas le pack** : `mcp_proxy_worker.mcp_proxy_refresh` n'a pas été appelé après `update_app`. Toujours forcer le refresh, ou attendre 5 min (refresh auto).

---

## Pour aller plus loin

- **Pattern d'intégration packs** : [[100-socle-packs-integration|Intégration des socle-packs]]
- **Fiches packs** : [[101-socle-pack-ai|ai]] / [[102-socle-pack-com|com]] / [[103-socle-pack-connectors|connectors]] / [[104-socle-pack-editorial|editorial]] / [[105-socle-pack-mail|mail]]
- **Pipeline d'installation détaillé** : [[60-pipeline-install|Pipeline d'installation]]
- **HOWTO créer une app from scratch** : [howto-24-creer-une-app-socle-from-scratch.md](howto-24-creer-une-app-socle-from-scratch.md)
- **APP-06-NotionSocle (banc d'essai 5 packs)** : [[114-app-06-notionsocle|APP-06 NotionSocle]]
