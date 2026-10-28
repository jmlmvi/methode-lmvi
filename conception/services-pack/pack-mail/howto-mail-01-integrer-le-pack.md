# HOWTO MAIL-01 — Intégrer socle-pack-mail dans une application V005

**Niveau :** Confirmé
**Cible :** application V005 sur PostgreSQL
**Versions vérifiées au code et à l'exécution (2026-10-28) :** `eu.lmvi:socle-pack-mail` **1.6.0** (commit `932cf29`, tag `v1.6.0` ; code identique à 1.5.0 `a396ada`) · `socle-v005` **5.11.0** (parent `eu.lmvi:socle-v005-parent` 5.11.0 ; minimum 5.10.0) · `socle-pack-ai` **2.9.0** (`provided` ; 2.8.0 accepté) · Spring Boot **4.1.2** · `jakarta.mail-api` 2.1.5 + `angus-mail` 2.0.5 (versions de Boot) · jsoup 1.17.2 · OkHttp `okhttp-jvm` 5.5.1 (du socle). **1.5.0** (tag `v1.5.0`) reste valide sur socle 5.10.x-5.11.x. Lignée **1.4.0** (tag `v1.4.0`) : socle 5.8.x-5.9.x, Boot 4.0.6, pack-ai 2.7.x — voir §4 et Pièges.
**Prérequis :** Java 21 GraalVM CE, PostgreSQL ≥ 14, `socle-pack-ai` intégré ([[howto-ai-01-integrer-le-pack|HOWTO AI-01]])
**Temps estimé :** 45 min

> Fiches de la même série : [[howto-mail-02-importer-une-boite-utilisateur|MAIL-02 import]] ·
> [[howto-mail-03-envoyer-depuis-la-boite-utilisateur|MAIL-03 envoi]] ·
> [[howto-mail-04-generer-un-mail-contextualise|MAIL-04 génération IA]] ·
> [[howto-mail-05-epurer-les-messages|MAIL-05 épuration]] ·
> [[howto-mail-06-relever-une-boite-applicative|MAIL-06 boîte applicative]] ·
> [[howto-mail-07-lien-dactivation-de-compte|MAIL-07 lien d'activation]]

---

## 1. Contexte

`socle-pack-mail` est une bibliothèque Maven qu'une application V005 embarque. Elle apporte deux
familles de fonctions qui n'ont pas le même public :

| Famille | Fonctions | Qui est concerné |
|---|---|---|
| **Mode « contacts »** (1.0 → 1.2) | import de la boîte d'un **utilisateur**, référentiel contacts, envoi depuis sa boîte, génération IA, épuration | une app de prospection / CRM (le modèle d'origine est APP-18 SDR2) |
| **Mode « application »** (1.4.0) | relève de la boîte **de l'application**, lien d'activation de compte IAM | une app qui reçoit des demandes par courriel (cas de référence : APP-98 TheIdeaBox) |

Le mode « contacts » s'installe dès que le pack est sur le classpath et balayé. Les deux fonctions
1.4.0 sont **inactives par défaut** : sans configuration, aucun worker, aucune route, aucune
connexion de plus (seule la table `tr_activation`, vide, est créée).

### Ce que le pack fait, ce que le Hub fait

Règle de routage du dépôt : **un service rendu par le Hub se consomme, il ne se réécrit pas.**

| Besoin | Voie | Fiche |
|---|---|---|
| Héberger des boîtes, DKIM, MX, quotas | Hub — `james_worker` | [[howto-11-configurer-james-mail\|HOWTO 11]] |
| Antivirus des pièces jointes reçues | Hub — `mail_attachment_worker` | [[howto-21-clamav-mail-scan\|HOWTO 21]] |
| Courriel **transactionnel** de l'app (accusé, notification, envoi du lien d'activation) | Hub — `mail_worker.send_templated_email` | catalogue des fonctions TSH (pas encore de HOWTO) |
| Lire la boîte **d'un utilisateur** (IMAP perso, Gmail, export Outlook) et en tirer des contacts | **pack** | MAIL-02 |
| Envoyer **au nom d'un utilisateur, depuis sa propre boîte** (plages, quota, dossier Envoyés) | **pack** | MAIL-03 |
| Rédiger un courriel personnalisé par LLM | **pack** (+ pack-ai) | MAIL-04 |
| Nettoyer des corps de messages stockés par l'app | **pack** | MAIL-05 |
| Traiter le courrier reçu par l'adresse de l'app (`app@thesocle.net`, boîte James) | **pack** — relève ; Hub — la boîte | MAIL-06 |
| Faire naître un compte IAM depuis un lien envoyé par courriel | **pack** — page et jeton ; Hub — IAM et envoi | MAIL-07 |

Le pack ne scanne aucune pièce jointe et n'en transmet aucune : le scan reste au Hub.

---

## 2. Architecture

```
┌────────────────────────── Application hôte (V005) ─────────────────────────────┐
│  @SpringBootApplication(scanBasePackages = "eu.lmvi.socle", "eu.lmvi")          │
│                                                                                │
│  socle-pack-ai (provided → à déclarer)     socle-pack-mail 1.6.0               │
│   GenerationWorker ◄──────────────────────  mail_generation_worker             │
│                                             mail_import_worker   (passif)      │
│                                             mail_send_worker     (passif)      │
│                                             mail_epuration_worker(passif)      │
│                                             boite_applicative_worker  ┐ si     │
│                                             imap_gateway_worker       ┘ BOITE  │
│                                             hub_iam_gateway_worker  ┐ si       │
│                                             /activation/** (page)   ┘ ACTIVATION│
│                                                                                │
│  mailPackMigrationRunner (@PostConstruct) ── db/mail/V000..V005, V999 ─┐       │
└──────────────────────────────────────────────────────────────────────┼─────────┘
                                                                       ▼
                     PostgreSQL : schéma ${SOCLE_MAIL_SCHEMA} (7 tables)
                                  + public.z_pack_migrations, public.update_changed_fields()
```

Le pack ne fournit **aucune auto-configuration Spring Boot** (pas de
`META-INF/spring/…AutoConfiguration.imports`) : ses beans existent parce que l'application balaie
`eu.lmvi.socle`, qui contient `eu.lmvi.socle.pack.mail`.

---

## 3. Étape 1 — Dépendances Maven

Le pack déclare `socle-v005`, `socle-pack-ai`, `spring-boot-starter-web`, `spring-boot-starter-jdbc`,
Jackson, OkHttp (`okhttp-jvm`, celui du socle) et le pilote PostgreSQL en **`provided`** : l'application
hôte les apporte. Il amène lui-même `jakarta.mail-api` + `angus-mail` (versions gérées par Boot 4.1.2,
celles de `spring-boot-starter-mail`) et jsoup. Le parent recommandé de l'app est
**`eu.lmvi:socle-v005-parent`** 5.11.0, lui-même fils de `spring-boot-starter-parent` 4.1.2 : il fournit
`${socle.version}` (5.11.0), importe `eu.lmvi:socle-v005-bom` (gRPC 1.85.1, Testcontainers 1.21.4, H2
2.5.252, Jedis 8.0.2, kafka-clients 4.4.0, mysql-connector-j 26.10.0, mariadb-java-client 4.0.0) et
pose la règle enforcer `socle-versions-testees`, qui fait échouer le build si une de ces bibliothèques
retombe sous la version testée par le socle. Un pack bâti sur un autre Boot que son socle compile, puis
casse à l'exécution.

| Pack mail | Socle | Spring Boot | pack-ai |
|---|---|---|---|
| **1.6.0** | 5.10.0 et + (construit contre 5.11.0) | 4.1.2 | 2.9.0 (2.8.0 accepté) |
| 1.5.0 | 5.10.0 et + | 4.1.2 | 2.8.0 |
| 1.4.0 | 5.8.x-5.9.x | 4.0.6 | 2.7.x |

```xml
<parent>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-v005-parent</artifactId>
    <version>5.11.0</version> <!-- fils de spring-boot-starter-parent 4.1.2 ; fournit ${socle.version} -->
    <relativePath/>
</parent>

<properties>
    <java.version>21</java.version>
    <!-- pas de <socle.version> : le parent la fournit (5.11.0) -->
</properties>

<repositories>
    <!-- le pack n'est publié sur aucun dépôt distant : vendoriser le jar ET le pom -->
    <repository>
        <id>project-local</id>
        <name>Dépôt Maven vendorisé (in-repo)</name>
        <url>file://${project.basedir}/mvn-repo</url>
        <releases><enabled>true</enabled></releases>
    </repository>
</repositories>

<dependencies>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-v005</artifactId>
        <version>${socle.version}</version>
    </dependency>
    <!-- provided dans le pack : l'hôte DOIT le déclarer, sinon MailGenerationWorker ne se charge pas -->
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-ai</artifactId>
        <version>2.9.0</version> <!-- 2.8.0 accepté -->
    </dependency>
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-mail</artifactId>
        <version>1.6.0</version> <!-- 1.5.0 : même code, même lignée -->
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-jdbc</artifactId>
        <exclusions>
            <exclusion>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-logging</artifactId>
            </exclusion>
        </exclusions>
    </dependency>
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
    </dependency>
</dependencies>
```

Le parent `socle-v005-parent` et `socle-v005-bom` se vendorisent comme le jar du socle (`.pom` sous
`mvn-repo/eu/lmvi/socle-v005-parent/5.11.0/` et `mvn-repo/eu/lmvi/socle-v005-bom/5.11.0/`) : sans eux,
un clone frais ne résout pas le parent.

**App qui garde son propre parent** (`spring-boot-starter-parent` 4.1.2 ou un parent maison) : voie
supportée, mais deux gestes au lieu d'un. Importer le BOM du socle **et** surcharger cinq propriétés —
un BOM importé ne bat pas les entrées directes de `spring-boot-dependencies`.

```xml
<properties>
    <socle.version>5.11.0</socle.version>
    <h2.version>2.5.252</h2.version>
    <jedis.version>8.0.2</jedis.version>
    <kafka.version>4.4.0</kafka.version>
    <mysql.version>26.10.0</mysql.version>
    <mariadb.version>4.0.0</mariadb.version>
</properties>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>eu.lmvi</groupId>
            <artifactId>socle-v005-bom</artifactId>
            <version>5.11.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Cette voie n'a pas la règle enforcer du parent : rien ne signale une version retombée.

Vendoriser l'artefact construit localement :

```bash
V=1.6.0
D=mvn-repo/eu/lmvi/socle-pack-mail/$V
mkdir -p $D
cp ~/.m2/repository/eu/lmvi/socle-pack-mail/$V/socle-pack-mail-$V.jar $D/
cp ~/.m2/repository/eu/lmvi/socle-pack-mail/$V/socle-pack-mail-$V.pom $D/
git add $D
```

C'est ce que fait déjà `APP-98-TheIdeaBox/theideabox/mvn-repo/eu/lmvi/socle-pack-mail/1.4.0/` (en 1.4.0 :
l'app est en Boot 4.0.6).

Avec **socle-pack-comm 2.1.0** dans la même app : il embarque encore `com.sun.mail:jakarta.mail`
2.0.1 (API + implémentation dans un seul jar), donc une seconde copie des classes `jakarta.mail.*`.
L'exclure de la dépendance pack-comm :

```xml
<dependency>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-pack-comm</artifactId>
    <version>2.1.0</version>
    <exclusions>
        <exclusion>
            <groupId>com.sun.mail</groupId>
            <artifactId>jakarta.mail</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

---

## 4. Étape 2 — Balayage et noms de beans

**Depuis la 1.5.0, rien à faire** : tous les beans du pack portent un nom préfixé `mail`, ceux de
pack-ai 2.8.0 un nom préfixé `ai`. Les deux packs se balaient ensemble sans conflit — c'est ce que
prouve le test de démarrage du pack (`DemarrageContexteSpringTest` : `SpringApplication` complète,
socle 5.11.0 + pack-ai 2.9.0 en 1.6.0 ; socle 5.10.0 + pack-ai 2.8.0 en 1.5.0).

| Classe | Bean 1.4.0 | Bean 1.5.0 |
|---|---|---|
| `adapter.jdbc.PackMigrationRunner` | `packMigrationRunner` (homonyme de pack-ai 2.7.x) | `mailPackMigrationRunner` |
| `adapter.vault.VaultCredentialResolver` | `vaultCredentialResolver` (homonyme de pack-ai 2.7.x) | `mailVaultCredentialResolver` |
| autres `@Component` et `@Bean` du pack | `contactExtractor`, `imapImporter`, `activationController`, `epurationWorker`, `depotMessages`… | `mailContactExtractor`, `mailImapImporter`, `mailActivationController`, `mailEpurationWorker`, `mailDepotMessages`… (liste : README du pack, `beanNames` du manifeste) |

L'injection se fait par type : une app qui remplace un port (`DepotMessages`, `FournisseurTenant`,
`ActivationDepot`, `AnnuaireComptes`) publie son bean sous le nom qu'elle veut. Les noms de workers et
d'actions MCP n'ont pas changé.

<details>
<summary>Lignée 1.4.0 (Boot 4.0.6, pack-ai 2.7.x) — générateur de noms qualifiés</summary>

En 1.4.0, `packMigrationRunner` et `vaultCredentialResolver` existent dans les deux packs ; le
générateur par défaut lève `ConflictingBeanDefinitionException`. Parade : nommer les beans balayés des
packs par leur nom complet, pour tout le contexte.

```java
package eu.lmvi;

import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.context.annotation.AnnotationBeanNameGenerator;
import org.springframework.context.annotation.FullyQualifiedAnnotationBeanNameGenerator;
import org.springframework.context.annotation.ScannedGenericBeanDefinition;

/** Nom complet pour les beans BALAYÉS des packs ; comportement Spring inchangé pour le reste. */
public class PackQualifiedBeanNameGenerator extends AnnotationBeanNameGenerator {

    @Override
    public String generateBeanName(BeanDefinition definition, BeanDefinitionRegistry registry) {
        if (!(definition instanceof ScannedGenericBeanDefinition)) {
            return FullyQualifiedAnnotationBeanNameGenerator.INSTANCE.generateBeanName(definition, registry);
        }
        String classe = definition.getBeanClassName();
        if (classe != null && classe.startsWith("eu.lmvi.socle.pack.")) {
            return classe;
        }
        return super.generateBeanName(definition, registry);
    }
}
```

```java
package eu.lmvi;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.AnnotationConfigUtils;

/** Pose le générateur pour TOUS les balayages du contexte, y compris ceux lancés par le socle. */
public class NomsDesPacks implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext ctx) {
        ctx.getBeanFactory().registerSingleton(
            AnnotationConfigUtils.CONFIGURATION_BEAN_NAME_GENERATOR,
            new PackQualifiedBeanNameGenerator());
    }
}
```

`src/main/resources/META-INF/spring.factories` :
`org.springframework.context.ApplicationContextInitializer=eu.lmvi.NomsDesPacks`

⚠️ Même ainsi, la 1.4.0 garde trois défauts qui empêchent le démarrage ou font disparaître un
worker (corrigés en 1.5.0, voir Pièges) : `VaultCredentialResolver` injecté par `Object`,
`ActivationController` sans constructeur désigné, `mail_epuration_worker` jamais créé.

</details>

`Application.java` reste celui de toute app V005 :

```java
package eu.lmvi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {
    "eu.lmvi.socle",  // framework ET packs (eu.lmvi.socle.pack.*) — NE PAS SUPPRIMER
    "eu.lmvi"         // application
})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

---

## 5. Étape 3 — Base de données et migrations

Le pack joue ses propres migrations au démarrage, avant tout worker : `PackMigrationRunner`
(bean `mailPackMigrationRunner`, `@PostConstruct`) lit `classpath*:db/mail/V*.sql`, remplace `${mail_schema}` par
`SOCLE_MAIL_SCHEMA` (nettoyé en `[a-z0-9_]`), et inscrit chaque version dans
`public.z_pack_migrations` (clé `pack_id, version`). Une migration en échec **arrête le démarrage**.

| Script | Contenu |
|---|---|
| `V000__init.sql` | `CREATE EXTENSION pgcrypto`, fonctions `public.update_changed_fields()` et `public.z_after_*`, table `public.z_pack_migrations` |
| `V001` | `db_contact`, `tr_email_import` |
| `V002` | `tr_import_log`, `tr_mail_propose` |
| `V003` | `tr_mail_envoye`, `z_mail_config` |
| `V004` | colonnes `corps_texte`, `corps_html` et 9 colonnes d'épuration sur `tr_email_import` |
| `V005` | `tr_activation` (1.4.0) |
| `V999` | prompt `contextual_mail` dans `public.z_config_ia`, si une table `z_config_ia` est visible |

Le schéma doit exister avant le démarrage, et le rôle de l'app doit pouvoir écrire dans `public`
(V000). Script d'initialisation à confier au Hub (`initScript` du manifeste) ou à jouer une fois :

```sql
CREATE SCHEMA IF NOT EXISTS schema_monapp AUTHORIZATION app_monapp;
-- V000 crée une extension et des objets dans public : sur PostgreSQL ≥ 15, public n'est plus
-- ouvert en écriture à tous. Sans ces deux lignes, l'application ne démarre pas.
GRANT CREATE ON SCHEMA public TO app_monapp;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- par un rôle qui en a le droit
```

`application.yml` de l'hôte — déclarer explicitement les variables utiles : le pack n'embarque aucun
`application.yml`, et une déclaration explicite rend la configuration lisible et vérifiable.

```yaml
spring:
  datasource:
    url: ${DATABASE_URL}
    username: ${DATABASE_USER}
    password: ${DATABASE_PASSWORD}

socle:
  mail:
    schema: ${SOCLE_MAIL_SCHEMA:schema_monapp}
    app-name: ${SOCLE_MAIL_APP_NAME:Mon application}
    epuration:
      enabled: ${SOCLE_MAIL_EPURATION_ENABLED:true}
```

---

## 6. Étape 4 — Clés de l'application (socle 5.9 et +)

Les actions du pack sont des actions MCP de l'app. Depuis le socle 5.9 (5.10.0 compris), `MCP_API_KEY` vide **ferme**
`/mcp` et fait **refuser le démarrage** ; il en va de même pour `ADMIN_API_KEY`.

```bash
MCP_API_KEY=<depuis Vault, soclehub/apps/monapp/mcp>
ADMIN_API_KEY=<depuis Vault, soclehub/apps/monapp/admin>
ADMIN_AUTH_ENABLED=true
SOCLE_MAIL_SCHEMA=schema_monapp
# pack-ai : au moins un fournisseur LLM — voir HOWTO AI-01
```

---

## 7. Étape 5 — Vérifier

Journal de démarrage attendu (extraits réels des classes du pack) :

```
[worker:pack-migration] Found 7 DDL scripts for socle-pack-mail
[worker:pack-migration] all migrations applied successfully
[pack:mail] aucun FournisseurTenant publié — mode mono-tenant
[pack:mail] dépôt d'épuration JDBC sur schema_monapp.tr_email_import (9 colonnes écrites)
[vault-resolver] Vault disabled — credentials must be passed in source_config
```

(et, si `SOCLE_MAIL_VAULT_ENABLED=true` : `Vault integration requested — worker resolved on first use` ; depuis la 1.5.0, le worker Vault est cherché au premier usage.)

Lister les actions (porte d'administration de l'app, en-tête `X-Admin-Key`) :

```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" https://monapp.thesocle.net/admin/actions \
  | grep -o 'mail_[a-z_]*_worker' | sort -u
# mail_epuration_worker, mail_generation_worker, mail_import_worker, mail_send_worker
```

Invoquer une action : `POST /mcp` de l'app, nom d'outil `<worker>__<action>`.

```bash
curl -s https://monapp.thesocle.net/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"mail_import_worker__get_status","arguments":{}}}'
```

La réponse porte la donnée **sous forme de chaîne JSON** dans `result.content[0].text`.

Tables créées :

```sql
SELECT c.relname
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'schema_monapp' AND c.relkind = 'r' ORDER BY 1;
-- db_contact, tr_activation, tr_email_import, tr_import_log, tr_mail_envoye, tr_mail_propose, z_mail_config
```

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | Démarrer l'app sur une base neuve | 7 scripts appliqués, 7 tables, 4 workers « contacts » au tableau de bord |
| 2 | Redémarrer | aucun script rejoué (`z_pack_migrations`) |
| 3 | Lister les beans (`/actuator/beans` ou journal DEBUG) | `mailPackMigrationRunner` et `aiPackMigrationRunner` côte à côte, aucun `packMigrationRunner` |
| 4 | Retirer `socle-pack-ai` du pom | échec au chargement de `MailGenerationWorker` |
| 5 | Démarrer sans `SOCLE_MAIL_BOITE_HOTE` ni `SOCLE_MAIL_ACTIVATION_ENABLED` | ni `boite_applicative_worker`, ni `hub_iam_gateway_worker`, ni route `/activation` |
| 6 | `mvn clean verify` sur le pack | 145 tests, 0 échec, 0 sauté, règle enforcer `socle-versions-testees` passée (Docker pour le test de démarrage pgvector ; PostgreSQL 17 sur `127.0.0.1:55461` pour les autres) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Mélanger les lignées : pack-mail 1.5.0 / 1.6.0 avec pack-ai 2.7.x ou socle 5.9 / Boot 4.0.6 (ou l'inverse) | compile, puis `NoSuchMethodError` / `ClassNotFoundException` (OkHttp 4 ↔ 5) à l'exécution | 1.6.0 et 1.5.0 = socle 5.10.x-5.11.x + Boot 4.1.2 + pack-ai 2.8.0/2.9.0 ; 1.4.0 = socle 5.9 + Boot 4.0.6 + pack-ai 2.7.x |
| Pack-mail **1.4.0** avec pack-ai 2.7.x : deux beans `packMigrationRunner` / `vaultCredentialResolver` | `ConflictingBeanDefinitionException`, l'app ne démarre pas | Corrigé en 1.5.0 (beans `mail*`) ; en 1.4.0, générateur de noms qualifiés (§4) |
| Pack-mail **1.4.0** dans une vraie app | `NoUniqueBeanDefinitionException … type 'java.lang.Object'` sur `vaultCredentialResolver`, démarrage refusé | Corrigé en 1.5.0 (le worker Vault n'est plus injecté par `Object`) |
| Pack-mail **1.4.0**, `SOCLE_MAIL_ACTIVATION_ENABLED=true` | `No default constructor found` sur `ActivationController`, démarrage refusé | Corrigé en 1.5.0 (constructeur `@Autowired`) |
| Pack-mail **1.4.0** : `mail_epuration_worker` absent du tableau de bord et de `/mcp` | aucune erreur, le worker n'existe pas | Corrigé en 1.5.0 (`@ConditionalOnBean(DataSource)` évalué trop tôt, retiré) |
| pack-comm 2.1.0 dans la même app | deux copies de `jakarta.mail.*` (`com.sun.mail` 2.0.1 et `jakarta.mail-api` 2.1.5) | Exclure `com.sun.mail:jakarta.mail` de pack-comm (§3) |
| `socle-pack-ai` absent du pom de l'hôte | `NoClassDefFoundError: eu/lmvi/socle/pack/ai/GenerationWorker` | Le déclarer : il est `provided` dans le pack |
| Rôle `app_<nom>` sans droit sur `public` (PostgreSQL ≥ 15) | `permission denied for schema public` sur V000, démarrage refusé | `GRANT CREATE ON SCHEMA public`, extension `pgcrypto` posée par un rôle habilité |
| Deux schémas de la même base reçoivent le pack | le second ne reçoit aucune migration | `z_pack_migrations` est tenue **par pack**, pas par schéma : une base par app |
| Base où l'ancienne `V999` aurait été jouée | `checksum mismatch on V999__seed_prompt.sql — skipping` (WARN) | Sans conséquence : la 1.4.0 corrige le quotage `$$` → `$prompt$` |
| `V999` qui ne pose pas le prompt | `mail_generation_worker` échoue faute de prompt `contextual_mail` | `V999` teste `information_schema.tables`, **filtré par les droits**, et écrit dans `public.z_config_ia` : vérifier où pack-ai range ses prompts (MAIL-04). Si pack-mail migre avant pack-ai (cas observé au démarrage 1.5.0), V999 ne pose rien |
| Ajouter pack-mail à une app dont pack-ai a **déjà** créé `z_config_ia` dans un schéma ≠ `public` | `Migration V999__seed_prompt.sql failed`, démarrage refusé | Défaut ouvert (1.5.0, 1.6.0) : créer `public.z_config_ia` vide de même structure, ou poser le prompt à la main et inscrire `V999` dans `public.z_pack_migrations` |
| Appeler `/api/actions/<worker>/<action>` sur l'app | 404 | C'est la porte **du Hub** ; une app s'appelle par `POST /mcp` |
| `POST /mcp` sans `Accept: application/json, text/event-stream` | 400 / -32601 | Ajouter l'en-tête (SDK MCP embarqué depuis 5.8.5) |
| `MCP_API_KEY` ou `ADMIN_API_KEY` vide | refus de démarrer (socle 5.9 et +) | Poser les deux clés depuis Vault |
| Chercher le pack sur `maven.thesocle.net` | 404 | 1.4.0, 1.5.0 et 1.6.0 n'existent que dans `~/.m2` de la box de build (et en tags git) : les vendoriser |
| Déclarer une `<configuration>` sur `maven-enforcer-plugin` dans le pom de l'app (liste `bannedDependencies/excludes`, `combine.self="override"`, `<skip>true</skip>`) | aucun message : la liste redéclarée **remplace** celle du parent, ou la règle est coupée — les bornes de `socle-versions-testees` disparaissent | Ne jamais configurer le plugin dans l'app. Une règle de plus = une autre `<execution>` avec son propre `<id>` |
| Redéclarer `h2.version`, `jedis.version`, `kafka.version`, `mysql.version` ou `mariadb.version` sous la version du socle dans une app au parent `socle-v005-parent` | build en échec à `validate` (règle `socle-versions-testees`) | Voulu : retirer la surcharge, la version vient du parent |
| App au parent `spring-boot-starter-parent` sans `socle-v005-bom` (ou avec le BOM sans les cinq propriétés) | l'app reçoit gRPC 1.84.1, H2 2.4.240, Jedis 7.4.1 de Boot au lieu des versions du socle | Parent `socle-v005-parent` 5.11.0 ; sinon BOM + cinq propriétés (§3) — corrigé côté socle en 5.10.1 (BOM étendu) et 5.11.0 (parent) |

---

## 10. Pour aller plus loin

- [[howto-ai-01-integrer-le-pack|HOWTO AI-01]] — intégrer socle-pack-ai, prérequis de ce pack
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]] — parcours générique (daté : socle 5.7.2 ; son chemin Vault `…/users/{userId}/mail/*` et la « RLS bi-axe » qu'il prête au pack ne correspondent pas au code)
- [[howto-24-creer-une-app-socle-from-scratch|HOWTO 24]] — squelette d'app
- [[howto-03-installer-une-app|HOWTO 03]] — installation par le Hub, `initScript`, autofill `db.*`
- [[howto-mail-02-importer-une-boite-utilisateur|MAIL-02]] — première fonction à essayer
