# HOWTO documents-01 — Intégrer socle-pack-documents dans une application

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-documents:0.1.0` (tag `v0.1.0`, vendorisé dans `mvn-repo/`) · socle-v005 5.11.2 (minimum 5.10.0) · Spring Boot 4.1.2
**Vérifié au code :** 2026-11-04
**Prérequis :** une app V005 Boot 4.1.2 / socle ≥ 5.10.0 qui démarre ; un schéma PostgreSQL d'app posé par le Hub ; un Hub dont le MinIO a une clé KMS (voir § 4)
**Temps estimé :** 30 min

> Vue d'ensemble du pack : [[README|socle-pack-documents]] · usage dans le code : [[howto-documents-02-deposer-lire-supprimer|documents-02]]

---

## 1. Contexte

Une app qui reçoit des fichiers de l'extérieur (CV, pièces justificatives, dépôts d'un cabinet) doit
les **analyser avant de les garder** (RG-26), les **chiffrer au repos** (M4 Q12), **plafonner** leur
taille et l'espace de chaque propriétaire (M4 Q13), et ne jamais mettre de binaire en base (M6 § 4).
Sans pack, chaque app recodait un client S3, un client antivirus et un quota — et le même piège
revenait : APP-23-Carousel envoyait `content_base64` à `scan_bytes`, tous les fichiers étaient
refusés ; une variante plus grave aurait été de les déclarer sains.

Le pack fait ces quatre choses ; il ne fait pas le contrôle d'accès (l'app vérifie que la personne
peut déposer dans ce dossier avant d'appeler le pack) et pas encore les documents produits.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Application V005 (schema_<appId>)                                    │
│                                                                      │
│  Contrôleur REST de l'app ── contrôle d'accès ──► FichiersService     │
│                                                       │              │
│  ┌──────────────── socle-pack-documents ──────────────┼───────────┐  │
│  │ FichiersRepository → <schéma>.tr_documents_fichier ◄┤           │  │
│  │ AntivirusGateway (GatewayWorker documents_antivirus)◄┤           │  │
│  │ StockageGateway  (GatewayWorker documents_stockage) ◄┘           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────┬──────────────────────────────┬─────────────────────────┘
             │ INSTREAM tcp/3310             │ S3 (SigV4, SSE-S3 AES256)
             ▼                               ▼
     soclehub-clamav (Hub)           soclehub-minio:9000 (Hub, clé KMS)
```

---

## 3. Étape 1 — Dépendance Maven, artefact vendorisé

Voie recommandée : le parent du socle. Il apporte Spring Boot 4.1.2, `${socle.version}`, la nomenclature
`socle-v005-bom` (gRPC, Testcontainers, pilotes aux versions testées) et la règle enforcer
`socle-versions-testees`.

```xml
<parent>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-v005-parent</artifactId>
    <version>5.11.2</version>
    <relativePath/>
</parent>

<properties>
    <java.version>21</java.version>
    <!-- socle.version vient du parent : ne pas la redéclarer -->
</properties>

<repositories>
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
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-documents</artifactId>
        <version>0.1.0</version>
    </dependency>
</dependencies>
```

Une app qui **garde son propre parent** importe `eu.lmvi:socle-v005-bom:5.11.2` (`<scope>import</scope>`) dans
son `dependencyManagement` et surcharge les cinq propriétés de Spring Boot que l'import ne peut pas
battre : `h2.version` 2.5.252, `jedis.version` 8.0.2, `kafka.version` 4.4.0, `mysql.version` 26.10.0,
`mariadb.version` 4.0.0.

Le pack n'est servi par aucun dépôt distant : le construire puis le **vendoriser** dans l'app.

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-documents
mvn -q clean install

APP=/opt/2026-TheHub4TheSocle/APP-XX-MonApp/monapp
DEST=$APP/mvn-repo/eu/lmvi/socle-pack-documents/0.1.0
mkdir -p "$DEST"
cp target/socle-pack-documents-0.1.0.jar "$DEST/"
cp pom.xml "$DEST/socle-pack-documents-0.1.0.pom"
```

Le `@SpringBootApplication` balaie `eu.lmvi.socle` : les beans du pack vivent sous
`eu.lmvi.socle.pack.documents`.

```java
package eu.lmvi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {"eu.lmvi.socle", "eu.lmvi"})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

---

## 4. Étape 2 — Prérequis côté Hub

| Prérequis | Comment le vérifier (lecture seule) | Si absent |
|---|---|---|
| MinIO avec clé KMS (chiffrement au repos) | `docker inspect soclehub-minio` : `MINIO_KMS_SECRET_KEY` (ou `_FILE` pointant un fichier qui existe) | tout dépôt rend `CHIFFREMENT_NON_GARANTI` — 🔴 cas de `.net` au 2026-11-04 |
| Seau de l'app (`thebeneficiaire`) | `storage_worker.storage_browse {"bucket":"thebeneficiaire"}` | `STOCKAGE_IMPOSSIBLE`, motif `NoSuchBucket` |
| Identifiants S3 de l'app dans Vault | `soclehub/apps/<app>/…` | pack non configuré : `INDISPONIBLE` |
| clamd joignable depuis l'app (réseau `soclehub-net`) | `get_status` du pack : `antivirus.connected: true` | `ANALYSE_IMPOSSIBLE` (rien n'est gardé) |

La clé KMS et le seau sont des écritures sur le Hub : elles relèvent de l'exploitation du Hub, pas
de l'app.

---

## 5. Étape 3 — Configuration `socle.documents.*`

Toutes les propriétés, avec les **défauts du code** (`DocumentsProperties`, 0.1.0) :

```yaml
socle.documents:
  enabled: ${SOCLE_DOCUMENTS_ENABLED:true}
  schema: ${SOCLE_DOCUMENTS_SCHEMA:schema_monapp}            # le schéma de l'app, posé par le Hub
  fichiers:
    taille-max-octets: ${SOCLE_DOCUMENTS_FICHIERS_TAILLE_MAX_OCTETS:20971520}           # 20 Mo
    quota-proprietaire-octets: ${SOCLE_DOCUMENTS_FICHIERS_QUOTA_PROPRIETAIRE_OCTETS:209715200}  # 200 Mo
    prefixe-cle: ${SOCLE_DOCUMENTS_FICHIERS_PREFIXE_CLE:fichiers}
  stockage:
    endpoint: ${SOCLE_DOCUMENTS_STOCKAGE_ENDPOINT:http://soclehub-minio:9000}
    region: ${SOCLE_DOCUMENTS_STOCKAGE_REGION:us-east-1}
    access-key: ${SOCLE_DOCUMENTS_STOCKAGE_ACCESS_KEY:}       # Vault
    secret-key: ${SOCLE_DOCUMENTS_STOCKAGE_SECRET_KEY:}       # Vault
    bucket: ${SOCLE_DOCUMENTS_STOCKAGE_BUCKET:monapp}
    creer-seau: ${SOCLE_DOCUMENTS_STOCKAGE_CREER_SEAU:false}  # vrai en développement seulement
    exiger-chiffrement: ${SOCLE_DOCUMENTS_STOCKAGE_EXIGER_CHIFFREMENT:true}
    delai-connexion-ms: 5000
    delai-reponse-ms: 60000
  antivirus:
    transport: ${SOCLE_DOCUMENTS_ANTIVIRUS_TRANSPORT:clamd}   # clamd | hub
    clamd-hote: ${SOCLE_DOCUMENTS_ANTIVIRUS_CLAMD_HOTE:soclehub-clamav}
    clamd-port: ${SOCLE_DOCUMENTS_ANTIVIRUS_CLAMD_PORT:3310}
    hub-url: ${SOCLE_DOCUMENTS_ANTIVIRUS_HUB_URL:http://soclehub:80}   # transport hub seulement
    hub-api-key: ${SOCLE_DOCUMENTS_ANTIVIRUS_HUB_API_KEY:}            # clé IAM, X-Api-Key
    delai-connexion-ms: 5000
    delai-reponse-ms: 60000
  reprises:
    max: 2                        # nouvelles tentatives après la première (délai, connexion, 5xx)
    delai-initial-ms: 500
    delai-max-ms: 5000
    seuil-disjoncteur: 5
    reouverture-disjoncteur-ms: 30000
```

Les plafonds se règlent par app ; ils ne se règlent pas par propriétaire en 0.1.0.

**Requête HTTP de l'app** : le plafond du pack s'applique aux octets reçus. L'app plafonne aussi la
requête, sinon un envoi de 2 Go est lu en mémoire avant d'être refusé :
`spring.servlet.multipart.max-file-size: 21MB` et `max-request-size: 21MB`. Un dépôt de 20 Mo tient
en mémoire quelques dizaines de Mo le temps de l'appel (octets reçus, copie multipart) ; le
transport `hub` y ajoute le base64 (+ 33 %).

---

## 6. Vérifier

```bash
curl -s -X POST https://monapp.thesocle.net/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"documents_worker__get_status","arguments":{}}}'
```

Attendu : `"enabled": true`, `"migrations_appliquees": ["V001"]`, `stockage.connected: true`,
`stockage.exiger_chiffrement: true`, `antivirus.connected: true`, `antivirus.transport: "clamd"`,
`taille_max_octets: 20971520`, `quota_proprietaire_octets: 209715200`. `get_status` ne rend que des
totaux (`fichiers_gardes_total`, `octets_gardes_total`) : aucun nom, aucun propriétaire.

---

## 7. Validation

Rejoués par `mvn clean verify` du pack (39 tests, conteneurs PostgreSQL, MinIO avec et sans KMS,
clamd), et à rejouer par la gate de P-0 contre le Hub de recette :

| # | Test | Attendu |
|---|---|---|
| 1 | fichier sain | `GARDE`, `chiffrement: AES256`, en-tête SSE sur l'objet, contenu illisible sur le disque de MinIO |
| 2 | signature EICAR | `REFUSE_INFECTE` (400), aucune ligne, aucun objet |
| 3 | 20 Mo + 1 octet | `REFUSE_TROP_GROS` (400), aucun appel sortant ; 20 Mo pile : `GARDE` |
| 4 | quota dépassé | `REFUSE_QUOTA` (400), pas d'analyse ; deux dépôts simultanés : un seul passe |
| 5 | antivirus injoignable ou muet | `ANALYSE_IMPOSSIBLE` (503), 3 tentatives, rien de gardé |
| 6 | S3 en 503 puis 500 puis 200 | `GARDE` après 3 tentatives |
| 7 | S3 en 403 / 404 | `STOCKAGE_IMPOSSIBLE`, 1 seule tentative |
| 8 | MinIO sans KMS | `CHIFFREMENT_NON_GARANTI`, 1 tentative (`501 NotImplemented — … KMS is not configured`) |

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| MinIO du Hub sans clé KMS | tout dépôt : `CHIFFREMENT_NON_GARANTI`, journal `chiffrement au repos non garanti` | poser la clé KMS sur le Hub (exploitation) ; ne **pas** couper `exiger-chiffrement` en recette ou production |
| Transport `hub` choisi pour des données personnelles | le fichier, en base64, apparaît dans le journal du Hub (`REST action: clamav_worker/scan_bytes … params={data_base64=…}`) | garder `clamd` (défaut) |
| `content_base64` au lieu de `data_base64` vers `scan_bytes` | tout refusé | le pack envoie `data_base64` ; ne pas réécrire l'appel |
| Le Hub rend `clean:false` avec `virus_name:""` | lu comme menace par certaines apps | c'est un **échec d'analyse** (`raw_response: "scan error: …"`) : le pack rend `ANALYSE_IMPOSSIBLE` |
| URL présignée rendue au navigateur | lien mort (`soclehub-minio:9000`), et la signature ne se réécrit pas | `lire()` rend les octets ; l'app les sert elle-même |
| Seau absent | `STOCKAGE_IMPOSSIBLE`, motif `NoSuchBucket` | créer le seau sur le Hub ; `creer-seau: true` seulement en développement |
| Schéma de l'app absent ou mal nommé | l'app ne démarre pas : `schéma « … » absent` | poser le schéma par le Hub, corriger `socle.documents.schema` |
| Pack seulement dans `~/.m2` | compile sur le poste, échoue en CI / clone frais | vendoriser `mvn-repo/eu/lmvi/socle-pack-documents/0.1.0/` |
| `scanBasePackages` sans `eu.lmvi.socle` | aucun bean du pack | `{"eu.lmvi.socle", "eu.lmvi"}` |
| Une `<configuration>` sur `maven-enforcer-plugin` dans le pom de l'app | les bornes du socle ne s'appliquent plus, sans message | ne jamais configurer ce plugin ; une **autre** `<execution>` au besoin |

---

## 9. Pour aller plus loin

- [[README|socle-pack-documents]] — vue d'ensemble, contrat réel du Hub
- [[howto-documents-02-deposer-lire-supprimer|documents-02]] — l'API dans le code de l'app
- `docs/02-DocHub/use-cases/howto-16-storage-s3-quotas.md`, `howto-21-clamav-mail-scan.md` — les services du Hub
- [[../00-creer-ou-amender-un-pack|Créer ou amender un pack]] — faire évoluer ce pack
