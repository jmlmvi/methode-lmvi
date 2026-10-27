---
id: HOWTO-02
titre: "Corriger un bug dans le Hub : reproduire, isoler, corriger, valider"
theme: "DEV · Développer sur le Hub"
surface: [WorkerActionController, HealthController, IamService, AppInstallPipeline, AppUpdatePipeline, AppUninstallPipeline, InstallState]
tables: [apps.application, apps.proxy_route, iam.db_users, dns.records]
actions_mcp: 0
routes: ["/api/actions/{worker}/{action}", "/admin/health", "/admin/info"]
etat_verifie:
  hub: "3.70.3"
  socle: "5.9.4"
  le: "2026-10-16"
  comment: "relu au code du Hub ; six commandes ou affirmations corrigées"
voisins: [HOWTO-01, HOWTO-17, HOWTO-18]
---

# HOWTO 02 — Corriger un bug dans le Hub

> **Niveau** : intermédiaire | **Prérequis** : avoir lu [[02-architecture-generale|l'architecture générale]] et [[04-cycle-de-vie|le cycle de vie]] | **Temps estimé** : 30 min à plusieurs heures selon la criticité

Ce guide donne une **méthode systématique** pour traiter un bug du Hub : reproduire, isoler, corriger, valider, documenter. Il s'applique aussi bien à un bug critique en production qu'à un comportement subtil signalé par un user.

État de référence : **Hub 3.70.3**, socle **5.9.4**, relu au code le **2026-10-16**.

---

## Questions auxquelles répond cette fiche

1. Par quoi commencer quand un bug est signalé — quelles questions trancher avant d'ouvrir le code ?
2. Où écrire la fiche de bug, et dans quel dossier selon son état d'avancement ?
3. Comment reproduire en local un bug qui n'apparaît qu'avec les données de production ?
4. Comment rejouer exactement l'appel qui plante, en REST comme en MCP ?
5. Où sont les logs du Hub — y a-t-il un fichier à grepper ?
6. Comment retrouver le worker qui porte une action dont je ne connais que le nom ?
7. Comment activer le DEBUG sur un filtre servlet sans redémarrer tout ?
8. Comment lire les étapes traversées par un pipeline d'installation, et ses compensations ?
9. Mes jetons sont-ils invalidés par un redémarrage du Hub ?
10. Un `/admin/info` me donne-t-il la configuration effective pour comparer deux environnements ?
11. Comment pousser une compensation de rollback dans un pipeline — quelle est la vraie API ?
12. Que reste-t-il derrière une installation qui a échoué, et que le rollback ne nettoie pas ?
13. Quelles zones vérifier après un fix, selon ce que j'ai touché ?
14. Que faire quand la cause racine est dans le socle et pas dans le Hub ?
15. Comment traiter un bug intermittent que je n'arrive pas à reproduire ?
16. Comment capturer un thread dump ou un heap dump sur le Hub en production ?

## Mots-clés

bug, correctif, fix, reproduire, isoler, cause racine, régression, triage, criticité,
`02-Bug2Fix`, fiche de bug, `01-NEW`, `02-INPROGRESS`, `03-DONE`, `04-NEEDMORE`, `05-THESOCLE`,
`docker logs`, pas de fichier de log, stdout, log4j2, `logging.level`, DEBUG, filtre servlet,
`/api/actions/{worker}/{action}`, `/admin/info`, `/admin/health`, actuator retiré,
`pg_dump`, dump partiel, `soclehub-postgres`, Vault, NATS, KvBus, cache L1 L2, `cache_purge_all`,
race condition, `volatile`, `synchronized`, `AtomicReference`, cycle de vie, `initialize()`,
routage, table de routage en RAM, ACME, certificat, 401, 403, JWT, clé RSA persistée,
`IAM_JWT_KEY_DIR`, `jwt-private.pkcs8`, migration SQL, Thymeleaf, pipeline, `[stage:N/M]`,
`[rollback]`, compensation, `InstallState`, DNS orphelin, thread dump, `jcmd`, `jstack`,
heap dump, `MatchException`, `ActionResult.ofFailure`

---

## 1. Triage initial — 3 questions à répondre AVANT toute investigation

| Question | Pourquoi |
|---|---|
| **Le Hub est-il complètement KO ou dégradé ?** | Si KO total : `agent-guide/05-diagnostic-systematique.md` § « Hub down » d'abord, le bug fix attend |
| **À partir de quand le bug existe ?** | Régression d'un release récent → `git log --oneline` pour cibler ; bug historique → recherche par symptôme |
| **Est-ce reproductible ou intermittent ?** | Intermittent → instrumenter avant de fixer ; reproductible → reproduire d'abord |

Avant de continuer, capturer dans une fiche de bug. Le dossier est `02-Bug2Fix/`, à la racine du
dépôt, et il est **organisé par état d'avancement** — la fiche se déplace, elle ne se duplique pas :

| Dossier | Ce qu'il contient |
|---|---|
| `02-Bug2Fix/01-NEW/` | bug signalé, pas encore instruit |
| `02-Bug2Fix/02-INPROGRESS/` | en cours d'investigation ou de correction |
| `02-Bug2Fix/03-DONE/` | corrigé et validé |
| `02-Bug2Fix/04-NEEDMORE/` | bloqué faute d'information ou de reproduction |
| `02-Bug2Fix/05-THESOCLE/` | cause racine dans le socle, pas dans le Hub (cf. §8.2) |

Le gabarit est `02-Bug2Fix/TEMPLATE-bug.md`, le processus complet `02-Bug2Fix/WORKFLOW-BUGFIX.md`.
Créer la fiche sous `02-Bug2Fix/01-NEW/BUG-YYYY-MM-DD-....md` et y mettre :

- **Symptôme** : ce que voit l'utilisateur ou le monitoring (1-3 phrases).
- **Reproduction minimale** : commandes/clics qui déclenchent le bug.
- **Comportement attendu** : ce qui devrait se passer.
- **Comportement observé** : ce qui se passe réellement.
- **Contexte** : version Hub, état (dev/prod), browser, account, etc.

---

## 2. Reproduire en local

### 2.1 Sortir le Hub local de l'environnement

```bash
cd /opt/2026-TheHub4TheSocle/soclehub

# Vérifier la branche/commit en cours
git status
git log --oneline -5

# Builder le Hub local sur la même version que la prod
mvn clean package -DskipTests
```

### 2.2 Reproduire la condition

Si le bug se produit avec une donnée précise (un user, une app, un mail), reproduire en local **avec une copie réelle** plutôt qu'inventée. La méthode :

```bash
# Le conteneur s'appelle soclehub-postgres dans TOUS les environnements : il n'y a pas de
# suffixe -prod (docker-compose.yml : container_name: soclehub-postgres). L'utilisateur et la
# base viennent de POSTGRES_USER / POSTGRES_DB du .env, ne pas les écrire en dur.
source docker/.env

# Dump partiel des tables impliquées depuis la prod
docker exec soclehub-postgres pg_dump \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --schema=iam --schema=apps --schema=mail \
    --data-only --inserts > dump-bug-XYZ.sql

# Restaurer en local (attention : remplace les données locales)
docker exec -i soclehub-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < dump-bug-XYZ.sql
```

### 2.3 Reproduire avec curl (action) ou navigateur (IHM)

**Bug API** :
```bash
# Capture la requête exacte qui plante (POST /api/actions/{worker}/{action},
# le worker est exposé sous son getName() = docker_worker)
curl -v -X POST -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"app_id":"wordpress","new_tag":"6.5"}' \
     http://localhost:8080/api/actions/docker_worker/update_app
```

**Bug IHM** :
- Ouvrir Chrome DevTools → Network avant le clic.
- Cliquer.
- Capturer la requête XHR/POST + réponse.
- Inspecter la console JS pour erreurs frontend.

---

## 3. Isoler la cause racine

### 3.1 Suivre le flux dans le code

Partir du **point d'entrée** (controller, filtre, action MCP) et descendre. Le trajet est toujours
le même, en trois paliers : d'abord la couche qui reçoit la requête — un contrôleur REST, un filtre
servlet ou le gestionnaire d'une action MCP ; puis le worker ou le service métier qu'elle appelle ;
enfin la ressource extérieure — base de données, Vault, API tierce. Un bug se situe dans l'un de ces
trois paliers, et les distinguer est ce qui évite de corriger au mauvais étage.

```
Controller / Filter / Action handler
    ↓
Worker / Service métier
    ↓
Service externe / DB / API tierce
```

Cas types :

#### a) Bug dans une action MCP

Source d'entrée : `WorkerActionController.executeAction(...)`

```bash
# Trouver le worker qui gère l'action
grep -rn 'name("nom_action")' soclehub/src/main/java/

# Lire le handler concerné
# Format typique : private ActionResult handleNomAction(...)
```

Insérer des logs DEBUG temporaires :

```java
private ActionResult handleArchiveUser(ActionParameters params, ActionContext ctx) {
    logger.info("[worker:{}][step:archive_user][debug] params={} caller={}",
                getName(), params.values(), ctx.callerId());
    String userId = params.getString("user_id");
    logger.info("[worker:{}][step:archive_user][debug] userId={}", getName(), userId);
    // ...
}
```

#### b) Bug dans un filtre servlet

Tous les filtres ont déjà du logging. Activer le DEBUG sur le package filter :

```yaml
# application.yml ou via -Dlogging.level...
logging:
  level:
    eu.lmvi.soclehub.filter: DEBUG
```

Puis redémarrer. **Il n'y a pas de `/admin/loggers`** : le bloc `management` (Spring Actuator) a été
retiré de `application.yml` le 2026-07-29, parce que la présence du starter cassait le binding SNI
du 443. Changer un niveau de log passe donc forcément par une variable d'environnement et un
redémarrage du conteneur — le prévoir avant de promettre un diagnostic « à chaud ».

Et attention au piège de la variable : le service `soclehub` **n'a pas d'`env_file`**, il a un bloc
`environment:` qui énumère chaque variable une par une (`POSTGRES_DB: ${POSTGRES_DB}`, etc.). Écrire
une variable dans `docker/.env` ne suffit donc pas — elle sert à la substitution du compose, pas à
l'environnement du conteneur. **Il faut les deux lignes** :

```yaml
# soclehub/docker/docker-compose.yml, service soclehub, bloc environment:
      LOGGING_LEVEL_EU_LMVI_SOCLEHUB_FILTER: ${LOG_LEVEL_FILTER:-INFO}
```

```bash
echo 'LOG_LEVEL_FILTER=DEBUG' >> soclehub/docker/.env
docker compose -f soclehub/docker/docker-compose.yml up -d soclehub
```

#### c) Bug dans un pipeline

Les pipelines (install/update/uninstall, cf. [[60-pipeline-install]] et [[61-pipeline-update]])
préfixent chaque étape avec l'identifiant de l'app **et** le rang de l'étape, sous la forme
`[install:<appId>][stage:3/6]` — pas avec le nom de la classe. C'est donc l'`appId` qu'on grep.

> ⚠️ **Il n'existe aucun fichier de log à grepper.** `logging:` dans `application.yml` ne déclare
> que des niveaux, aucun appender fichier : tout part sur la sortie standard et se lit par
> `docker logs`. Un `grep ... logs/soclehub.log` renvoie « No such file or directory », et c'est
> l'erreur qui fait perdre le plus de temps sur ce chemin.

```bash
# Les étapes traversées pour une app
docker logs soclehub 2>&1 | grep "\[install:wordpress\]" | tail -100

# Les compensations, si une étape a échoué
docker logs soclehub 2>&1 | grep "\[rollback\]" | tail -40

# Conserver une trace avant qu'elle sorte du tampon Docker
docker logs --since 2h soclehub > /tmp/hub-$(date +%s).log 2>&1
```

### 3.2 Suivre l'état en DB

Beaucoup de bugs viennent de désynchronisations DB ↔ état applicatif.

```bash
docker exec -it soclehub-postgres psql -U socle_prod -d socle_prod

# Inspecter l'app concernée
socle_prod=# SELECT * FROM apps.application WHERE app_id = 'wordpress';
socle_prod=# SELECT * FROM apps.proxy_route WHERE app_id = 'wordpress';
socle_prod=# SELECT * FROM dns.records WHERE name LIKE '%wordpress%';

# Inspecter Vault (creds DB de l'app sous soclehub/apps/<appId>/db — cf. [[11-vault-worker]])
docker exec -it soclehub-vault vault kv get soclehub/apps/wordpress/db
```

### 3.3 Inspecter NATS/KvBus si event-driven

```bash
# Liste des streams + messages
docker exec -it soclehub-nats nats stream ls

# Peek les derniers messages
docker exec -it soclehub-nats nats stream view MAIL_EVENTS --last 10
```

### 3.4 Inspecter le cache (L1+L2)

```bash
# Stats cache
curl -s -H "X-Api-Key: $API_KEY" \
     -X POST http://localhost:8080/api/actions/cache_worker/cache_stats | jq

# Purge totale en cas de doute
curl -s -H "X-Api-Key: $API_KEY" \
     -X POST http://localhost:8080/api/actions/cache_worker/cache_purge_all
```

### 3.5 Vérifier les threads (si latence/blocage)

```bash
# Lister les threads JVM
docker exec soclehub jcmd 1 Thread.print | head -200

# Détecter les threads bloqués
docker exec soclehub jstack 1 | grep -A5 BLOCKED
```

---

## 4. Catégories de bugs fréquentes

### 4.1 Bug de configuration

**Symptôme** : feature ne marche pas dans l'env A mais marche dans l'env B.
**Vérification** :
```bash
# Diff la config entre envs
diff <(docker exec soclehub-A env | sort) <(docker exec soclehub-B env | sort)
```

⚠️ **`/admin/info` ne rend pas la configuration.** Il rend `name`, `version`, `build`,
`buildTimestamp`, `java`, `jvm`, `uptime`, `startTime`, les processeurs disponibles, trois mesures
de mémoire et `threadCount` — rien d'autre. Un `jq .config` dessus renvoie `null`, ce qui se lit
facilement comme « la clé est vide » au lieu de « la clé n'existe pas ». Et le bloc `management`
d'Actuator ayant été retiré, il n'y a pas non plus d'`/actuator/env` : **le diff des environnements
Docker ci-dessus est le seul moyen**, et il ne montre pas les valeurs internes à
`application.yml`. Pour celles-là, il faut lire le fichier **de la version déployée** — donc du
commit correspondant au tag qui tourne, pas de `main` :

```bash
# Le tag réellement déployé
docker exec soclehub printenv SOCLEHUB_TAG 2>/dev/null || grep SOCLEHUB_TAG soclehub/docker/.env

# Le fichier tel qu'il était dans cette version — les tags sont préfixés « v »
git -C soclehub show "v3.70.3:src/main/resources/application.yml" | sed -n '1,60p'
```

⚠️ Le tag peut manquer : au 2026-10-16 le dépôt `soclehub` s'arrête à **v3.43.1** alors que la
production tourne en 3.70.x, parce que les versions récentes vivent dans des **worktrees de
lignée** et non sur `main`. Si `git show` échoue sur le tag, c'est ce cas-là : chercher le worktree
(`git -C soclehub worktree list`) avant de conclure que la version n'existe pas.

**Résolution** : aligner `application.yml` ou `.env`. Documenter l'écart dans `institutional/160-configuration-reference.md`.

### 4.2 Bug de race condition / concurrence

**Symptôme** : bug intermittent qui n'apparaît que sous charge ou avec des appels en parallèle.
**Vérification** :
- Le code a-t-il un `volatile`, `synchronized`, `AtomicXxx`, `ConcurrentHashMap` ? Sinon, suspect.
- Sous charge : `for i in {1..50}; do curl ... & done`.
**Résolution** : utiliser les classes thread-safe. Voir `agent-guide/03-regles-absolues.md` §7.

### 4.3 Bug de cycle de vie (`initialize()`, `start()`, `stop()`)

**Symptôme** : worker présent mais inactif, ou erreurs au démarrage seulement.
**Vérification** :
- L'exception est-elle catchée silencieusement dans `initialize()` ?
- `getCycleIntervalMs()` retourne-t-il bien > 0 si SCHEDULED ?
- `isHealthy()` retourne-t-il `true` ?
**Résolution** : ajouter `logger.error(..., e)` dans le catch et `running = true` après l'init.

### 4.4 Bug de routing / proxy

**Symptôme** : 404 ou 503 sur `app.thesocle.net`. (Détail de la table de routage en RAM vs `apps.proxy_route` : [[43-proxy-worker]].)
**Vérification** :
```bash
# Routing table en RAM
curl -s -H "X-Api-Key: $API_KEY" \
     -X POST http://localhost:8080/api/actions/proxy_worker/get_routing_table | jq

# Reload depuis DB si nécessaire
curl -s -H "X-Api-Key: $API_KEY" \
     -X POST http://localhost:8080/api/actions/proxy_worker/list_routes | jq
```
Cas typique : la route existe en DB mais pas en RAM → restart du Hub ou trigger un reload via une action.

### 4.5 Bug TLS / cert ACME

**Symptôme** : erreur `ERR_CERT_AUTHORITY_INVALID` ou cert expiré.
**Vérification** :
```bash
# Cert servi par le Hub
echo | openssl s_client -servername app.thesocle.net -connect localhost:443 2>/dev/null | openssl x509 -noout -dates -subject

# Cert dans Vault (la clé normalise le domaine : points → underscores, cf. [[40-acme-worker]])
docker exec -it soclehub-vault vault kv get soclehub/certs/app_thesocle_net

# Statut AcmeWorker
curl -s -H "X-Api-Key: $API_KEY" \
     -X POST http://localhost:8080/api/actions/acme_worker/list_certificates | jq
```
**Résolution** : `force_renew` action ou `force_check_all` si plusieurs domaines.

### 4.6 Bug d'auth (401, 403, JWT invalid)

**Symptôme** : tokens valides hier ne fonctionnent plus aujourd'hui.

**Ce n'est plus le comportement normal.** La clé RSA du JWT est **persistée** depuis le lot 2 RPP :
`IamService.init()` appelle `loadOrCreateKeyPair()`, qui relit `jwt-private.pkcs8`,
`jwt-public.x509` et `jwt-kid` dans `IAM_JWT_KEY_DIR` (par défaut `/app/data/jwt`, monté par le
volume `soclehub-data`). Un redémarrage **réutilise la même clé et le même `kid`** : les jetons
survivent. Si tous les jetons sont invalidés par un restart, c'est un incident, pas le dessin.

**Vérification** — la cause est presque toujours le repli silencieux. Si le répertoire n'est pas
accessible en écriture (volume absent, droits, FS en lecture seule), le code **ne refuse pas de
démarrer** : il journalise une erreur et retombe sur une clé en mémoire, donc volatile.

```bash
# 1. La clé est-elle bien sur le volume ?
docker exec soclehub ls -l /app/data/jwt
# attendu : jwt-private.pkcs8 (rw-------), jwt-public.x509, jwt-kid

# 2. Le repli a-t-il été emprunté au dernier démarrage ?
docker logs soclehub 2>&1 | grep -E "persistance clé JWT indisponible|clé JWT durable"
#   « clé JWT durable chargée depuis … (kid=…) »  → sain, les jetons survivent
#   « clé JWT durable générée et persistée … »     → premier démarrage, sain
#   « persistance clé JWT indisponible … repli en mémoire volatile » → la panne

# 3. Le kid change-t-il d'un restart à l'autre ? (c'est la preuve)
docker exec soclehub cat /app/data/jwt/jwt-kid
```

**Résolution** : rétablir le volume `soclehub-data` sur `/app/data` et les droits d'écriture, puis
redémarrer — la clé sera générée une fois et conservée. Un `kid` qui change à chaque démarrage et
un volume absent sont le même symptôme.

### 4.7 Bug de migration SQL

**Symptôme** : démarrage Hub OK mais erreur `column does not exist` sur une requête.
**Vérification** :
```bash
docker exec -it soclehub-postgres psql -U socle_prod -d socle_prod -c "\d iam.db_users"
```
**Résolution** : appliquer la migration manquante depuis `soclehub/sql/`.

### 4.8 Bug d'intégration externe (Cloudflare, Vault, James, etc.)

**Symptôme** : action timeout ou erreur 5xx du service tiers.
**Vérification** :
```bash
# Tester directement l'API tierce
curl -H "Authorization: Bearer $CF_API_TOKEN" \
     https://api.cloudflare.com/client/v4/user

# Tester depuis le container Hub (réseau Docker interne)
docker exec soclehub curl -s http://vault:8200/v1/sys/health
```
**Résolution** : si l'API tierce est down → wait + alerter. Si la config Hub est mauvaise (mauvais token, mauvaise URL) → corriger.

### 4.9 Bug d'IHM Thymeleaf

**Symptôme** : 500 sur une page, ou contenu vide.
**Vérification** :
- Stack trace sur la sortie standard : `docker logs soclehub 2>&1 | grep -A20 org.thymeleaf.exceptions` (il n'y a pas de fichier de log, cf. §3.1c)
- Variables manquantes dans le model (controller a oublié `model.addAttribute`).
**Résolution** : ajouter la variable manquante ou l'utiliser correctement avec `th:if`.

### 4.10 Bug de lock / migration en cours

**Symptôme** : install d'app coince à un stage particulier.
**Vérification** :
```bash
# Voir les stages traversés
docker logs soclehub 2>&1 | grep "\[install:X\]" | grep "stage:" | tail -20
```
Si le pipeline est resté coincé sans rollback (kill brutal du Hub pendant l'install) :
```sql
-- Manuellement nettoyer l'état partiel
DELETE FROM apps.application WHERE app_id = 'X';
-- + supprimer container, route, DNS, etc. selon ce qui a été créé
```

---

## 5. Corriger

### 5.1 Le minimum

Une fois la cause identifiée :

1. **Faire un test de reproduction automatisé** si possible (test Java JUnit ou shell).
2. Écrire le **fix le plus petit possible** qui résout le bug.
3. Vérifier que le test passe.
4. Vérifier que **rien d'autre n'est cassé** (rebuild + tests + smoke test manuel).

### 5.2 Pattern de fix : valeur par défaut manquante

```java
// AVANT (bug : NPE si la map est vide)
String dbType = catalogApp.getEnvTemplate().get("DB_TYPE");
if (dbType.equals("postgres")) { ... }

// APRÈS
Map<String, ?> envTemplate = catalogApp.getEnvTemplate();
String dbType = envTemplate != null ? (String) envTemplate.get("DB_TYPE") : null;
if ("postgres".equals(dbType)) { ... }
```

### 5.3 Pattern de fix : rollback manquant dans un pipeline

⚠️ **Il n'existe pas de `pushCompensation(...)`** — aucune méthode de ce nom dans le Hub ni dans le
socle. Le mécanisme réel d'`AppInstallPipeline` tient en deux parties, et c'est celui-là qu'il faut
étendre :

1. une `List<Runnable> compensations` locale à `install()`, à laquelle on ajoute **une
   compensation par étape** juste après avoir lancé cette étape ;
2. des **drapeaux dans `InstallState`** (`dnsRecordCreated`, `tlsCertObtained`, `containerCreated`,
   `routePersisted`…) que la méthode de compensation consulte pour savoir ce qui est réellement à
   défaire. En cas d'échec, `rollback(appId, compensations)` les rejoue **en ordre inverse**.

```java
// Dans install(), le câblage — une entrée par étape, ajoutée AVANT que l'étape puisse échouer
compensations.add(() -> compensateNetwork(request, state));
stageNetwork(request, state);

// Dans l'étape, on enregistre de quoi défaire — ici l'identifiant rendu par le fournisseur
String recordId = dnsService.createRecord(...);
state.setDnsRecordId(recordId);     // ← le champ à ajouter : il manque aujourd'hui
state.setDnsRecordCreated(true);

// Dans la compensation, on ne défait que ce qui a été fait
private void compensateNetwork(InstallRequest request, InstallState state) {
    log.info("[install:{}][rollback] Compensating network stage", request.appId());
    if (state.isDnsRecordCreated() && state.getDnsRecordId() != null) {
        dnsService.deleteRecord(state.getZoneId(), state.getDnsRecordId());
    }
}
```

🔴 **Et c'est exactement le trou actuel.** Tel qu'écrit aujourd'hui,
`AppInstallPipeline.compensateNetwork()` ne supprime rien : il journalise
`DNS record for {} should be manually removed` et s'arrête là, faute d'avoir conservé
l'identifiant de l'enregistrement. Le drapeau `tlsCertObtained` n'est, lui, consulté par aucune
compensation. **Une installation qui échoue après l'étape réseau laisse donc derrière elle un
enregistrement DNS et un certificat orphelins**, qu'il faut nettoyer à la main. Le vérifier fait
partie de la validation (cf. piège 3), et le corriger demande le champ `dnsRecordId` ci-dessus.

### 5.4 Pattern de fix : action sans default

```java
// AVANT
return switch (actionName) {
    case "foo" -> handleFoo();
    case "bar" -> handleBar();
};  // → MatchException sur "baz"

// APRÈS
return switch (actionName) {
    case "foo" -> handleFoo();
    case "bar" -> handleBar();
    default    -> ActionResult.ofFailure("Action inconnue : " + actionName);
};
```

### 5.5 Pattern de fix : `kvBus.sub()` en boucle

```java
// AVANT (handler enregistré N fois)
@Override
public void doWork() {
    kvBus.sub("orders.new", this::process);  // BUG
    // ...
}

// APRÈS
@Override
public void initialize() {
    kvBus.sub("orders.new", this::process);  // une seule fois
}

@Override
public void doWork() {
    // logique métier sans sub
}
```

---

## 6. Valider

### 6.1 Test du fix

```bash
# Build
mvn clean package -DskipTests

# Restart container
docker-compose -f docker/docker-compose.yml restart soclehub

# Reproduction du bug : doit maintenant fonctionner correctement
# (re-jouer la commande / clic qui plantait)
```

### 6.2 Vérifier qu'aucune régression

Les zones connectées au fix :

| Si tu as touché | Vérifier également |
|---|---|
| Un worker | toutes ses actions fonctionnent encore (`/api/actions/{worker}`) |
| Un filtre | parcourir une page authentifiée + une page publique + un endpoint API |
| Un pipeline | install complet d'une app de test |
| Un service | tous les workers qui l'injectent |
| Une migration SQL | démarrage du Hub depuis zéro |
| `SecurityConfig` | login + logout + endpoint protégé + endpoint public |

### 6.3 Vérifier que les logs sont propres

```bash
# Pas d'ERROR ni WARN nouveau
docker logs --tail 200 soclehub | grep -E "ERROR|WARN" | grep -v "VolontairementMisDansLeFix"
```

---

## 7. Documenter le fix

Tout fix non-trivial **doit** être documenté quelque part — sinon le bug réapparaîtra dans 6 mois.

### 7.1 Le commit

```
fix(iam): handle null envTemplate in archive_user

Le pipeline d'install échouait silencieusement quand catalog.json
omettait envTemplate (cas des apps sans DB).

Cause: NPE dans handleArchiveUser ligne 320 lors de l'accès direct
à getEnvTemplate().get(...).

Fix: null check + Map vide par défaut.

Refs: BUG-2026-04-XX-iam-archive-npe
```

### 7.2 La fiche de bug — dossier `02-Bug2Fix/`

Déplacer la fiche de `02-Bug2Fix/02-INPROGRESS/` vers `02-Bug2Fix/03-DONE/` et la compléter avec :

- Cause racine identifiée.
- Fix appliqué (commit hash).
- Validation effectuée.
- Régression possible et comment la détecter.

### 7.3 La doc institutional ou agent-guide

Si le bug révèle un piège récurrent :

- Symptôme à ajouter dans `agent-guide/05-diagnostic-systematique.md`.
- Règle absolue à ajouter dans `agent-guide/03-regles-absolues.md` (avec INCORRECT vs CORRECT).
- Comportement détaillé à ajouter dans le fichier `institutional/<XX-composant>.md`.

---

## 8. Cas particuliers

### 8.1 Bug en production sur une seule instance

Avant de fixer le code, **mitigation** :

```bash
# Restart si état corrompu en RAM
docker-compose -f docker/docker-compose.yml restart soclehub

# Purge cache si données stales
curl -s -H "X-Api-Key: $API_KEY" \
     -X POST http://localhost:8080/api/actions/cache_worker/cache_purge_all

# Reload patterns/certificats si liés
curl ... force_reload_signatures
curl ... force_check_all  # ACME
```

Puis reproduire en local et fixer proprement.

### 8.2 Bug dans le framework Socle V005

Si la cause racine est dans `eu.lmvi:socle-v005` (5.9.4 au 2026-10-16) :

1. **Déposer la fiche dans `02-Bug2Fix/05-THESOCLE/`** — ce dossier existe précisément pour ça, et
   c'est ce qui permet de voir d'un coup d'œil ce que le Hub attend du socle.
2. **Ne pas corriger le socle soi-même** : il relève d'une autre responsabilité. Caractériser
   précisément — version, classe, méthode, reproduction minimale — vaut mieux qu'un correctif
   envoyé par-dessus.
3. Contourner dans le Hub si c'est possible sans masquer le défaut (ex. un wrapper qui attrape
   l'exception du socle, en journalisant la raison du contournement et en citant la fiche).
4. Monter la version du socle dans `pom.xml` quand le correctif sort — **et le vérifier** : un
   contournement qui reste en place après la correction devient à son tour un piège.
5. Ne **pas** forker le framework — le Hub doit rester compatible avec les versions suivantes.

### 8.3 Bug intermittent non reproductible

1. Ajouter du logging intensif dans la zone suspecte.
2. Déployer.
3. Attendre la prochaine occurrence.
4. Analyser les logs.

Capturer un thread dump en cas de freeze :
```bash
docker exec soclehub jcmd 1 Thread.print > thread-dump-$(date +%s).txt
docker exec soclehub jcmd 1 GC.heap_dump /tmp/heap.hprof
docker cp soclehub:/tmp/heap.hprof ./heap.hprof
```

---

## 9. Pièges courants

### Piège 1 — Fixer le symptôme, pas la cause
**Exemple** : ajouter un try/catch qui swallow une NullPointerException pour faire passer le test.
**Conséquence** : le bug réapparaît ailleurs.
**Résolution** : toujours comprendre **pourquoi** le NPE arrive et fixer la source du `null`.

### Piège 2 — Fixer trop large
**Exemple** : profiter du fix pour refactoriser le worker entier.
**Conséquence** : la PR devient illisible, on introduit de nouveaux bugs.
**Résolution** : **un fix = un changement minimal**. Le refactor mérite sa propre PR.

### Piège 3 — Oublier de tester le rollback, et croire qu'il nettoie tout
Si tu modifies un pipeline, la compensation doit être testée en simulant un échec :
```bash
# Force échec stage 4 en mettant un mauvais tag Docker
curl ... install_app -d '{"docker_tag": "invalid:tag"}'
```
Puis vérifier ce qui reste. **Deux ressources ne sont pas nettoyées aujourd'hui** : l'enregistrement
DNS (la compensation se contente d'un WARN, cf. §5.3) et le certificat TLS (son drapeau
`tlsCertObtained` n'est consulté par aucune compensation). Les attendre propres mène à conclure à
tort que le rollback a fonctionné :
```bash
docker logs soclehub 2>&1 | grep "should be manually removed"   # le DNS resté en place
# puis supprimer l'enregistrement et le certificat à la main
```

### Piège 4 — Logs silencieux
**Exemple** : `try { ... } catch (Exception e) { }` sans log.
**Conséquence** : prochain bug indétectable.
**Résolution** : toujours `logger.error("[...] {}", e.getMessage(), e)` ou re-lancer.

### Piège 5 — `volatile` insuffisant pour des opérations composées
**Exemple** : `if (x == null) x = compute();` sur un champ `volatile` n'est pas atomique.
**Résolution** : `synchronized` ou `AtomicReference.compareAndSet`.

### Piège 6 — Restart sans purge cache après modif schema
**Exemple** : tu ajoutes une colonne, restart le Hub, mais le cache contient encore les anciennes lignes.
**Résolution** : `cache_purge_all` après toute modif schema.

### Piège 7 — Fix en local qui marche, en prod qui ne marche pas
**Cause typique** : variable d'env différente, version Docker différente, base de données vide vs peuplée.
**Résolution** : reproduire au plus proche de la prod (cf. §2.2).

### Piège 8 — Modifier `application.yml` sans rebuild
**Conséquence** : le fichier dans le JAR reste l'ancien, les changements externes ne sont pas pris.
**Résolution** : soit rebuild + redeploy, soit overrider via env var (`SOCLEHUB_DOMAIN=...`).

### Piège 9 — Tester sans rejouer l'env complet
**Exemple** : tester une action qui utilise James, mais James est down dans l'env de test.
**Conséquence** : faux négatif (le bug est masqué par l'env).
**Résolution** : toujours `docker-compose ps` avant de tester pour confirmer l'état des services.

### Piège 10 — Ne pas écrire de test
**Conséquence** : le bug peut réapparaître à la prochaine modif sans détection.
**Résolution** : test JUnit pour le code Java, ou script `tests/regression/bug-XYZ.sh` qui rejoue le scénario.

---

## 10. Checklist finale

- [ ] Bug reproduit en local.
- [ ] Cause racine identifiée et comprise (pas juste « ça marche maintenant »).
- [ ] Fix minimal appliqué.
- [ ] Test ou script de reproduction qui prouve le fix.
- [ ] Pas de régression sur les zones adjacentes.
- [ ] Logs propres (pas d'ERROR/WARN nouveau qui ne soit pas explicite).
- [ ] Commit message descriptif (`fix(...): ...`).
- [ ] Fiche `02-Bug2Fix/` mise à jour et déplacée en `03-DONE/` (cause + fix + validation).
- [ ] Doc institutional ou agent-guide enrichie si le bug révèle un piège récurrent.
- [ ] PR mergée + déploiement validé en environnement cible.
