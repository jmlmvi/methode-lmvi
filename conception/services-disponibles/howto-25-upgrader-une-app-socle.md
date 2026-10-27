# HOWTO 25 — Upgrader une application Socle V005 vers une nouvelle version du framework

> **Niveau** : intermédiaire | **Prérequis** : app Socle V005 existante (cf. howto-24), accès au repo `git@github.com:jmlmvi/V005-packs.git`, Java 21 GraalVM CE | **Temps estimé** : 30 min - 2 h selon les ruptures

Ce guide montre comment **upgrader une app Socle V005 existante** vers une nouvelle version du framework (ex. `5.2.0` → `5.6.0`) et/ou une nouvelle version du `V005-FrontendShell` (ex. `3.0.0` → `3.0.1`). Il s'agit du travail **côté développeur d'app**, pas du `update_app` côté admin Hub (qui swappe juste l'image Docker — cf. howto-04). L'objectif est de produire un nouveau tarball livrable dans `livraison/` avec le code source mis à jour.

---

## 1. Contexte

Le framework `eu.lmvi:socle-v005` évolue au rythme des correctifs et des nouvelles features (cf. `V005-packs/CHANGELOG.md`). Une app installée sur un Hub utilise **une version figée** du framework, embarquée dans son JAR au moment du build. Pour bénéficier des correctifs (ex. v5.4.9 fix critique du MOP cron) ou des nouveaux composants (ex. v5.6.0 `OidcAuthFilter`), le développeur doit :

1. Récupérer les nouveaux artefacts (`socle-v005-X.Y.Z.jar`, `V005-FrontendShell-vN.N.N.tar.gz`),
2. Les intégrer au code source de l'app,
3. Adapter le code applicatif si rupture d'API,
4. Rebuild et reproduire un tarball livrable.

Le framework V005 maintient une **politique de compatibilité ascendante stricte** : depuis la v5.0.0, aucune release n'a introduit de breaking change sur l'interface `Worker`, `ActionProvider`, `KvBus` ou la signature des templates. Les upgrades sont donc majoritairement **transparents** (bump de version + rebuild). Les seules exceptions sont signalées explicitement dans le `CHANGELOG.md` avec le marqueur `BREAKING` (aucune occurrence à ce jour).

Le pipeline d'upgrade côté Hub (cf. howto-04) ne sait que swapper le tag Docker — il ne modifie pas le code de l'app. **C'est bien le développeur de l'app qui doit produire le nouveau tarball**, puis l'admin Hub déclenche `update_app` pour le déployer.

---

## 2. Architecture

```
            ┌──────────────────────────────────────────────────────┐
            │      git@github.com:jmlmvi/V005-packs.git            │
            │                                                      │
            │  ├─ V005-StarterPack-v5.6.0.tar.gz   (full pack)     │
            │  ├─ V005-UpgradePack-v5.6.0.tar.gz   (delta backend) │
            │  ├─ V005-FrontendShell-v3.0.1.tar.gz (delta front)   │
            │  └─ CHANGELOG.md                                     │
            └────────────────────┬─────────────────────────────────┘
                                 │  git pull
                                 ▼
            ┌──────────────────────────────────────────────────────┐
            │      APP-NN-NomApp/nomapp/    (source de l'app)      │
            │                                                      │
            │      1. lib/socle-v005-X.Y.Z.jar      (remplacé)     │
            │      2. pom.xml <socle.version>       (bumped)       │
            │      3. mvn install:install-file       (~/.m2)       │
            │      4. (si frontend) frontend/lib/   (remplacé)     │
            │      5. code Java adapté si rupture                  │
            │      6. mvn clean package -DskipTests                │
            │      7. tar czf livraison/<app>-X.Y.Z.tar.gz ...     │
            └────────────────────┬─────────────────────────────────┘
                                 │  install_app / update_app
                                 ▼
            ┌──────────────────────────────────────────────────────┐
            │      Hub admin (cf. howto-03 / howto-04)             │
            └──────────────────────────────────────────────────────┘
```

**Distinction clé entre les 3 packs publiés** :

| Pack | Contenu | Cible |
|------|---------|-------|
| **StarterPack** | Framework JAR + drivers + templates + docs + bootstrap d'une app neuve | Création d'une app from scratch (cf. howto-24) |
| **UpgradePack** | Delta : JAR framework, doc des changements, scripts de migration | Upgrade backend d'une app existante |
| **FrontendShell** | Delta : `lib/` V002 + `themes/` + composants + docs frontend | Upgrade frontend d'une app existante |

---

## 3. Étape 1 — Identifier la version cible

```bash
cd /opt/2026-TheHub4TheSocle/V005-packs
git pull
```

Lister les packs disponibles :

```bash
ls *.tar.gz
# V005-FrontendShell-v3.0.1.tar.gz
# V005-StarterPack-v5.6.0.tar.gz
# V005-UpgradeHubPack-v5.6.0.tar.gz   ← réservé au Hub lui-même
# V005-UpgradePack-v5.6.0.tar.gz       ← pour les apps
```

Lire le `CHANGELOG.md` pour repérer les ruptures et les nouveautés entre la version courante et la version cible :

```bash
head -50 CHANGELOG.md
```

Identifier la version actuelle de l'app à upgrader :

```bash
cd /opt/2026-TheHub4TheSocle/APP-04-CNX2Notion/cnx2notion
grep -m1 'socle.version\|<artifactId>socle-v005' pom.xml
# <socle.version>5.2.0</socle.version>
```

Ici l'app CNX2Notion est en `5.2.0`, on cible `5.6.0`. Les versions intermédiaires `5.3.x`, `5.4.x`, `5.5.x` sont **incluses** dans le saut (le framework garantit la compatibilité ascendante depuis 5.0).

---

## 4. Étape 2 — Récupérer les packs

Créer un dossier de travail temporaire pour comparer/inspecter sans toucher au code de l'app :

```bash
WORK=/tmp/upgrade-cnx2notion
mkdir -p "$WORK"
cd "$WORK"

tar xzf /opt/2026-TheHub4TheSocle/V005-packs/V005-UpgradePack-v5.6.0.tar.gz
tar xzf /opt/2026-TheHub4TheSocle/V005-packs/V005-FrontendShell-v3.0.1.tar.gz

ls
# V005-FrontendShell-v3.0.1/
# V005-UpgradePack-v5.6.0/
```

Lire les notes de migration **du pack** (différentes du CHANGELOG global) :

```bash
cat V005-UpgradePack-v5.6.0/MIGRATION.md 2>/dev/null
cat V005-UpgradePack-v5.6.0/CHANGELOG.md 2>/dev/null
cat V005-FrontendShell-v3.0.1/CHANGELOG.md 2>/dev/null
```

Le `MIGRATION.md` du UpgradePack liste — dans l'ordre — chaque changement à appliquer côté app (config, code, dépendances).

---

## 5. Étape 3 — Lire les changements et estimer l'effort

Catégoriser ce qui suit :

| Catégorie | Action |
|-----------|--------|
| **Pas de breaking change** (cas typique) | Bump de version + rebuild → 5 min |
| **Nouvelle env var optionnelle** (ex. `SOCLE_OIDC_ENABLED`) | Ajouter à `manifest.json/env.optional` si l'app veut l'exposer |
| **Nouveau Worker fourni par framework** (ex. v5.4.8 `TechDbReaderWorker`) | Disponible automatiquement, rien à faire côté app |
| **Bug fix transparent** (ex. v5.4.9 MOP cron) | Aucune action — le rebuild suffit |
| **Renommage public d'API** (rare) | Adapter les imports + signatures dans le code app |
| **Migration SQL côté app** | Ajouter dans `sql/migrations/` un fichier `vX.Y.Z-monapp.sql` |

Pour CNX2Notion 5.2.0 → 5.6.0, le `CHANGELOG.md` indique :

- v5.3.x à v5.5.x : 22 bug fixes B.1 à B.22, **aucun breaking change**,
- v5.6.0 : ajout `OidcAuthFilter` désactivé par défaut, aucun breaking change.

→ **L'upgrade est transparent**. Aucune adaptation de code applicatif n'est nécessaire.

---

## 6. Étape 4 — Bumper le framework

### 4a. Remplacer le JAR + POM dans `lib/`

```bash
APP=/opt/2026-TheHub4TheSocle/APP-04-CNX2Notion/cnx2notion
NEW_VERSION=5.6.0

# Sauvegarde l'ancien (au cas où)
mv "$APP/lib/socle-v005-5.2.0.jar" "$APP/lib/socle-v005-5.2.0.jar.bak"
mv "$APP/lib/socle-v005-5.2.0.pom" "$APP/lib/socle-v005-5.2.0.pom.bak"

# Copie le nouveau
cp /opt/2026-TheHub4TheSocle/V005-packs/V005-StarterPack-v$NEW_VERSION/lib/socle-v005-$NEW_VERSION.jar "$APP/lib/"
cp /opt/2026-TheHub4TheSocle/V005-packs/V005-StarterPack-v$NEW_VERSION/lib/socle-v005-$NEW_VERSION.pom "$APP/lib/"
```

### 4b. Réinstaller dans le repo Maven local

```bash
cd "$APP"
mvn install:install-file \
  -Dfile=lib/socle-v005-$NEW_VERSION.jar \
  -DpomFile=lib/socle-v005-$NEW_VERSION.pom \
  -DgroupId=eu.lmvi -DartifactId=socle-v005 \
  -Dversion=$NEW_VERSION -Dpackaging=jar
```

### 4c. Mettre à jour `pom.xml`

```xml
<properties>
    <socle.version>5.6.0</socle.version>
</properties>
```

Ou directement dans la `<dependency>` si pas de propriété :

```xml
<dependency>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-v005</artifactId>
    <version>5.6.0</version>
</dependency>
```

### 4d. Mettre à jour la version de l'app

Bumper aussi la version de l'app elle-même (convention SemVer côté app) :

```xml
<groupId>eu.lmvi</groupId>
<artifactId>cnx2notion</artifactId>
<version>1.1.0</version>   <!-- était 1.0.0 -->
```

Et dans `manifest.json` :

```json
{
  "version": "1.1.0"
}
```

### 4e. Mettre à jour les drivers JDBC (si nouvelle version)

```bash
# Comparer les versions de drivers entre packs
diff <(ls /opt/2026-TheHub4TheSocle/V005-packs/V005-StarterPack-v5.6.0/lib/drivers/) \
     <(ls "$APP/lib/drivers/")
# Si des nouveaux JARs sortent, copier
cp /opt/2026-TheHub4TheSocle/V005-packs/V005-StarterPack-v5.6.0/lib/drivers/*.jar "$APP/lib/drivers/"
# Et supprimer les anciennes versions si elles co-existent (un seul driver par DB sinon ClassLoader confus)
```

---

## 7. Étape 5 — Adapter le code Java (si rupture)

Pour le saut 5.2.0 → 5.6.0 il n'y a **aucune rupture** publique. Mais en règle générale, les patterns à vérifier sont :

```bash
# Vérifier qu'aucune classe importée n'a changé de package
grep -r "import eu.lmvi.socle\." src/main/java/ | sort -u
```

Si le `MIGRATION.md` du UpgradePack liste un renommage (rare), patcher avec `sed` :

```bash
# Exemple générique — adapter selon le MIGRATION.md
sed -i 's|eu.lmvi.socle.old.Class|eu.lmvi.socle.new.Class|g' \
  $(grep -rl "eu.lmvi.socle.old.Class" src/main/java)
```

**Tester la compilation après chaque modification** :

```bash
mvn clean compile
```

Cibler les warnings de dépréciation :

```bash
mvn clean compile 2>&1 | grep -i "deprecated\|warning"
```

---

## 8. Étape 6 — Mettre à jour le frontend (V005-FrontendShell)

Si l'app a un frontend React utilisant le `V005-FrontendShell`, et que la nouvelle version apporte des correctifs :

### 8a. Préserver les sources métier

Le frontend de l'app a deux sous-arbres :

```
frontend/
├── lib/         ← V002 vendoré — fourni par FrontendShell, NE PAS MODIFIER
├── themes/      ← 9 thèmes — fourni par FrontendShell, NE PAS MODIFIER
└── src/         ← code métier de l'app, À PRÉSERVER
```

→ Sauvegarder `frontend/src/`, écraser `frontend/lib/` et `frontend/themes/`, restaurer `frontend/src/`.

```bash
APP=/opt/2026-TheHub4TheSocle/APP-04-CNX2Notion/cnx2notion
SHELL_VERSION=3.0.1

# Backup src/
cp -r "$APP/frontend/src" /tmp/frontend-src-backup

# Extraire le nouveau shell dans un dossier temp
mkdir /tmp/new-shell
tar xzf /opt/2026-TheHub4TheSocle/V005-packs/V005-FrontendShell-v$SHELL_VERSION.tar.gz \
  -C /tmp/new-shell --strip-components=1

# Remplacer lib/ et themes/
rm -rf "$APP/frontend/lib" "$APP/frontend/themes"
cp -r /tmp/new-shell/lib "$APP/frontend/lib"
cp -r /tmp/new-shell/themes "$APP/frontend/themes"

# Vérifier qu'aucun fichier de src/ n'a été touché
diff -r /tmp/frontend-src-backup "$APP/frontend/src"
# (doit être vide)
```

### 8b. Comparer `package.json`

```bash
diff /tmp/new-shell/package.json "$APP/frontend/package.json"
```

Si le shell a bumpé des dépendances (React, Vite, Phosphor), répercuter dans le `package.json` de l'app **uniquement les dépendances communes** (ne pas écraser celles ajoutées spécifiquement par l'app).

### 8c. Reinstaller + rebuilder le frontend

```bash
cd "$APP/frontend"
rm -rf node_modules package-lock.json
export NODE_OPTIONS="--max-old-space-size=4096"
npm install --legacy-peer-deps
npm run build
# → src/main/resources/static/ régénéré
cd "$APP"
```

---

## 9. Étape 7 — Migrations SQL (si nécessaire)

Si la nouvelle version du framework introduit des tables système ou modifie le schéma TechDB, le `UpgradePack` fournit un dossier `sql/new-migrations/`.

Pour les **migrations système framework** (TechDB H2), c'est **automatique** : le `MOP` applique au démarrage.

Pour les **migrations métier de l'app** (PostgreSQL provisionné par le Hub), ajouter un nouveau fichier dans `sql/migrations/` selon la convention :

```bash
# Convention : sql/migrations/v<version>-<description>.sql
cat > "$APP/sql/migrations/v1.1.0-add-oidc-fields.sql" <<'EOF'
-- Ajout colonnes OIDC pour intégration ApplicationEditors (v5.6.0)
ALTER TABLE schema_cnx2notion.tr_event
  ADD COLUMN IF NOT EXISTS oidc_subject TEXT;

CREATE INDEX IF NOT EXISTS idx_tr_event_oidc_subject
  ON schema_cnx2notion.tr_event (oidc_subject);
EOF
```

Et déclarer dans le `manifest.json` :

```json
"upgradeMigrations": [
  { "fromVersion": "1.0.0", "toVersion": "1.1.0", "script": "sql/migrations/v1.1.0-add-oidc-fields.sql" }
]
```

(Convention en cours de standardisation — vérifier le format actuel attendu par le pipeline `update_app` côté Hub.)

---

## 10. Étape 8 — Build local + tests

```bash
cd "$APP"
mvn clean package -DskipTests
# → target/cnx2notion-1.1.0-exec.jar
```

Vérifier que les workers démarrent toujours :

```bash
java -Dloader.path=./lib/drivers -jar target/cnx2notion-1.1.0-exec.jar &
APP_PID=$!
sleep 15

curl -s http://localhost:8080/admin/workers | jq '.workers[] | {name, isHealthy}'
# Tous les workers attendus doivent être présents avec isHealthy: true

curl -s http://localhost:9374/status   # Status Dashboard

kill $APP_PID
```

Tester les actions métier critiques de l'app via REST/MCP :

```bash
curl -s -X POST http://localhost:8080/api/actions/cnx2notion_worker/ping \
  -H "Content-Type: application/json" -d '{}'
```

Si l'app a des tests d'intégration :

```bash
mvn test
```

---

## 11. Étape 9 — Documenter la migration

Créer le fichier `MIGRATION-vX.Y-vers-vA.B.md` à la racine du dossier source de l'app :

```bash
cat > "$APP/MIGRATION-v5.2-vers-v5.6.md" <<'EOF'
# Migration Socle V005 v5.2 → v5.6 (CNX2Notion 1.0.0 → 1.1.0)

## Ce qui change
- Framework `eu.lmvi:socle-v005` bumpé de 5.2.0 → 5.6.0
- Frontend shell `V005-FrontendShell` bumpé de 3.0.0 → 3.0.1 (patch doc)
- Aucune rupture publique d'API. Aucun changement de Worker requis.

## Étapes appliquées
1. Remplacement de `lib/socle-v005-5.2.0.{jar,pom}` par 5.6.0
2. `mvn install:install-file` du nouveau JAR
3. `pom.xml` : `<socle.version>5.6.0</socle.version>`
4. `pom.xml` : version app 1.0.0 → 1.1.0
5. `manifest.json` : `"version": "1.1.0"`
6. `frontend/lib/` et `frontend/themes/` remplacés par v3.0.1
7. `npm install --legacy-peer-deps && npm run build`
8. `mvn clean package -DskipTests`

## Bénéfices framework
- v5.4.9 CRITICAL : MOP scheduleWorkerDoWork respecte cron (fix OOM cascade)
- v5.4.7 : SqlStatementGuard whitelist DDL safe
- v5.4.6 : TechDbManager.getTableCounts() listage dynamique
- v5.5.1 : 4 batch fixes (B.19+B.20+B.21+B.22)
- v5.6.0 : OidcAuthFilter disponible (désactivé par défaut)

## Tests post-upgrade
- [x] mvn clean package OK
- [x] Démarrage local OK, tous les workers healthy
- [x] Action `cnx2notion/ping` répond 200
- [x] Frontend build sans warning
- [x] Tarball produit < 200 Mo
EOF
```

---

## 12. Étape 10 — Packager le tarball d'upgrade

Le tarball d'upgrade suit la même convention de nommage que le tarball d'install (cf. howto-24 §12) :

```bash
cd /opt/2026-TheHub4TheSocle/APP-04-CNX2Notion
VERSION=1.1.0
TARBALL="livraison/cnx2notion-${VERSION}.tar.gz"

tar czf "$TARBALL" \
  --transform "s|^cnx2notion/|cnx2notion-${VERSION}/|" \
  cnx2notion/manifest.json \
  cnx2notion/docker/Dockerfile \
  cnx2notion/target/cnx2notion-${VERSION}-exec.jar \
  cnx2notion/lib/drivers/ \
  cnx2notion/sql/ \
  cnx2notion/repository/ \
  cnx2notion/MIGRATION-v5.2-vers-v5.6.md

ls -lh livraison/
# cnx2notion-1.0.0.tar.gz   (ancien, à conserver pour rollback)
# cnx2notion-1.1.0.tar.gz   (nouveau)

du -sh "$TARBALL"
tar tzf "$TARBALL" | head -10
```

**Convention** : conserver l'ancien tarball dans `livraison/` permet à l'admin Hub de faire un `update_app` vers le nouveau tag, et un rollback vers l'ancien tag si besoin (cf. howto-04 §7 sur le rollback automatique).

---

## 13. Validation

### Smoke test du nouveau tarball

```bash
cd /tmp && rm -rf test-upgrade
tar xzf /opt/2026-TheHub4TheSocle/APP-04-CNX2Notion/livraison/cnx2notion-1.1.0.tar.gz
cd cnx2notion-1.1.0

docker build -t cnx2notion:1.1.0-test -f Dockerfile .
docker run --rm -p 8080:8080 -p 9374:9374 cnx2notion:1.1.0-test &
DOCK_PID=$!
sleep 30

# Vérifier la version du framework embarqué
docker exec $(docker ps -qf ancestor=cnx2notion:1.1.0-test) \
  java -jar /app/app.jar --version 2>/dev/null || \
docker logs $(docker ps -qf ancestor=cnx2notion:1.1.0-test) 2>&1 | grep -i "socle.*v005\|version"

# Health
curl -s http://localhost:8080/admin/health | jq

kill $DOCK_PID 2>/dev/null
docker rmi cnx2notion:1.1.0-test
```

### Vérifier la compatibilité avec le Hub cible

Vérifier que la version du framework du Hub est ≥ celle de l'app (sinon l'OIDC, l'IAM ou les actions MCP peuvent diverger) :

```bash
# Côté Hub
curl -s http://admin.thesocle.net/admin/health | jq '.framework.version'
# Doit retourner >= 5.6.0
```

### Vérifier le `manifest.json`

```bash
jq -e '.version, .framework' livraison/cnx2notion-1.1.0.tar.gz cnx2notion/manifest.json
# version: "1.1.0", framework: "socle-v005"
```

---

## 14. Pièges courants

### Piège 1 — `mvn install:install-file` oublié, ancien JAR utilisé

**Symptôme** : on a remplacé `lib/socle-v005-5.6.0.jar`, on a bumpé `pom.xml`, mais `mvn package` continue à charger l'ancien (ou échoue avec `Could not find artifact 5.6.0`).

**Cause** : Maven cherche dans `~/.m2/`, pas dans `lib/`. Le fichier `lib/socle-v005-X.Y.Z.jar` est juste l'archive embarquée — il faut le **réinstaller** dans `~/.m2/`.

**Résolution** :

```bash
mvn install:install-file -Dfile=lib/socle-v005-5.6.0.jar -DpomFile=lib/socle-v005-5.6.0.pom \
  -DgroupId=eu.lmvi -DartifactId=socle-v005 -Dversion=5.6.0 -Dpackaging=jar
```

Vérifier avec `ls ~/.m2/repository/eu/lmvi/socle-v005/`.

### Piège 2 — Anciens drivers JDBC restés dans `lib/drivers/`

**Symptôme** : après upgrade, `ClassNotFoundException` ou `LinkageError: duplicate class`.

**Cause** : on a copié les nouveaux drivers sans supprimer les anciens. Plusieurs versions du même driver = conflit ClassLoader.

**Résolution** :

```bash
ls lib/drivers/
# postgresql-42.7.1.jar
# postgresql-42.8.0.jar   ← doublon, à supprimer

rm lib/drivers/postgresql-42.7.1.jar
```

Toujours conserver **un seul JAR par DB**.

### Piège 3 — Frontend `src/` écrasé pendant l'upgrade shell

**Symptôme** : après `tar xzf V005-FrontendShell-v3.0.1.tar.gz`, le code métier `frontend/src/` est perdu.

**Cause** : on a extrait directement dans `frontend/` sans préserver `src/`. Le shell **ne contient pas** de `src/` métier (juste `lib/` + `themes/` + un `src/` template), donc l'extraction écrase tout.

**Résolution** : extraire dans un dossier temporaire et copier sélectivement (cf. §8a). Toujours faire un `git status` avant et après l'extraction du shell pour vérifier qu'aucun fichier de `src/` n'a bougé.

### Piège 4 — `package.json` incompatible avec les nouvelles deps shell

**Symptôme** : `npm install` échoue avec `Cannot resolve dependency` ou `Conflicting peer dependency`.

**Cause** : le shell v3.0.1 attend une version de React/Vite que l'app a pinnée à une autre version.

**Résolution** : merger manuellement les deux `package.json`. Conserver les deps métier de l'app, adopter les deps de la lib partagée. Toujours `--legacy-peer-deps` :

```bash
npm install --legacy-peer-deps
```

Si ça échoue malgré tout, le shell distribue son propre `package.json.example` — le prendre comme base et y ajouter les deps métier.

### Piège 5 — `manifest.json` pas bumpé

**Symptôme** : `update_app` côté Hub lit `version: "1.0.0"` dans le tarball alors que le tag Docker est `1.1.0` → la deployment row affiche `to_version: "1.0.0"` (incohérent).

**Cause** : oubli de bumper `manifest.json/version`. Le Hub se fie à ce champ, pas au numéro dans le nom du tarball.

**Résolution** : aligner systématiquement les 3 sources de vérité :

```bash
grep -E '"version"' cnx2notion/manifest.json
grep -m1 '<version>' cnx2notion/pom.xml
ls livraison/
# Les 3 doivent indiquer la même version
```

### Piège 6 — Migrations SQL non exécutées au déploiement

**Symptôme** : nouveau tarball déployé, mais les nouvelles colonnes attendues n'existent pas en base.

**Cause** : `manifest.json` ne déclare pas le bloc `upgradeMigrations` (ou pas dans le format attendu par le pipeline `update_app`). Le pipeline `update_app` actuel **swap juste l'image Docker**, il ne lit pas les migrations métier.

**Résolution** : exécuter manuellement les migrations métier en base **avant** ou **après** l'`update_app` du Hub :

```bash
docker exec -i soclehub-postgres psql -U cnx2notion -d cnx2notion \
  < cnx2notion/sql/migrations/v1.1.0-add-oidc-fields.sql
```

Le support natif des migrations métier est sur la roadmap (post v2.7).

### Piège 7 — Anciens `*.jar.bak` embarqués dans le tarball

**Symptôme** : tarball trop volumineux (300+ Mo).

**Cause** : on a renommé les anciens JAR en `.bak` pour les conserver, et le `tar` les a inclus.

**Résolution** : nettoyer avant `tar` :

```bash
rm -f cnx2notion/lib/*.jar.bak cnx2notion/lib/*.pom.bak
```

Ou exclure explicitement :

```bash
tar czf "$TARBALL" --exclude='*.bak' ...
```

### Piège 8 — Test local OK, mais Hub refuse l'image

**Symptôme** : `docker build` local OK, image `1.1.0-test` lance correctement. Mais à l'`update_app` côté Hub, le pull échoue avec `manifest unknown`.

**Cause** : on a buildé localement mais pas pushé l'image vers le registry du Hub. L'`update_app` pull depuis le registry, pas depuis le local.

**Résolution** : pour les apps `appType: "thesocle"`, le Hub build à partir du `Dockerfile` du tarball (mode `buildFromDockerfile: true`), pas depuis un registry. Vérifier `manifest.json/docker.buildFromDockerfile` est bien `true`. Si l'app utilise un registry privé, il faut pousser l'image taguée :

```bash
docker tag cnx2notion:1.1.0-test repository.thesocle.net/soclehub-local/cnx2notion:1.1.0
docker push repository.thesocle.net/soclehub-local/cnx2notion:1.1.0
```

### Piège 9 — `update_app` Hub fait un rollback car le nouveau container ne démarre pas

**Symptôme** : `update_app` rollback vers la version 1.0.0 immédiatement. Logs : `New container failed to start`.

**Cause** : env var requise par v1.1.0 mais pas provisionnée. Le nouveau code lit `SOCLE_OIDC_ENABLED` ou un autre flag inexistant et crash.

**Résolution** : aligner `manifest.json/env.optional` avec les nouvelles env vars **avant** l'update :

```bash
# Côté Hub, set la nouvelle env
curl -X POST http://admin.thesocle.net/api/actions/docker/set_env_var \
  -H "Content-Type: application/json" \
  -d '{"app_id": "cnx2notion", "key": "SOCLE_OIDC_ENABLED", "value": "true"}'

# Puis update
curl -X POST http://admin.thesocle.net/api/actions/docker/update_app \
  -d '{"app_id": "cnx2notion", "new_tag": "1.1.0"}'
```

Cf. howto-04 §10 piège 6.

### Piège 10 — Régression non détectée car la version est jugée transparente

**Symptôme** : on déploie en production sans test, parce que « le CHANGELOG dit pas de breaking change ». 24 h après, un Worker B fait quelque chose de différent.

**Cause** : « pas de breaking change publique » ne veut pas dire « comportement identique partout ». Un fix peut changer une décision (ex. v5.4.9 fait que les cron schedules sont enfin respectés — si l'app comptait sur le bug pour ne pas s'exécuter avant 5s, elle se met à s'exécuter maintenant).

**Résolution** : toujours tester en staging avant la production. Utiliser le pattern "staging app" : un Hub de staging avec la même app installée, où l'on déploie d'abord. Cf. howto-04 §7 best practice.

---

## 15. Pour aller plus loin

- Voir `howto-24-creer-une-app-socle-from-scratch.md` pour la création d'une app from scratch (le pendant amont de ce guide),
- Voir `howto-04-mettre-a-jour-une-app.md` pour la mise à jour côté admin Hub (swap d'image Docker) — réf. [[61-pipeline-update|AppUpdatePipeline]],
- Voir `howto-06-publier-une-app-editeur.md` pour publier le nouveau tarball dans un registry signé,
- Voir `V005-packs/CHANGELOG.md` (`git@github.com:jmlmvi/V005-packs.git`) pour la liste exhaustive des changements par version,
- Voir [[200-build-maven|build Maven]] pour les options avancées du build (profiles, classifiers, build natif GraalVM),
- Voir `agent-guide/03-regles-absolues.md` pour les invariants framework qui ne changent jamais entre versions.

### Propositions futures (non implémentées)

Le dossier `V2-Specs4Appli` (archivé) contient des évolutions proposées qui changeraient le pattern d'upgrade :

- **`upgradeMigrations` natif dans `manifest.json`** — déclarer les migrations SQL métier par delta (`fromVersion → toVersion → script`) pour qu'elles soient exécutées automatiquement par le pipeline `update_app` côté Hub. Aujourd'hui, les migrations métier doivent être exécutées **manuellement** avant ou après l'`update_app` (cf. piège 6 de ce guide).
- **`PgPipelineContext`** — table `apps.pipeline_context` pour persister l'état d'exécution des pipelines et permettre une reprise après crash. Aujourd'hui, un crash du Hub pendant un upgrade laisse l'app dans un état incertain (à diagnostiquer manuellement).
- **Pipeline d'update à 5 stages typés** (`lookup → pull → swap → verify → register`) avec retry/backoff par stage. Aujourd'hui le pipeline `AppUpdatePipeline` a 7 stages (cf. howto-04) sans retry par stage.
