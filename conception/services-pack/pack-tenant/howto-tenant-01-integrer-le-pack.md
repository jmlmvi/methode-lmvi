# HOWTO tenant-01 — Intégrer socle-pack-tenant dans une application

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-tenant:0.5.0` (commit `bcddf0e`) · socle-v005 5.8.9 → 5.9.5 · Spring Boot 4.0.6
**Hub :** ≥ 3.63.0 (routes `/api/iam/tenant/{slug}/…`)
**Vérifié au code :** 2026-10-28
**Prérequis :** une app V005 qui démarre ; une clé APIM d'application ([[howto-39-provisionner-une-cle-apim-pour-une-app|HOWTO 39]]) ; le tenant et sa fiche existent au Hub ([[howto-34-gerer-les-tenants-iam|HOWTO 34]])
**Temps estimé :** 30 min

> Vue d'ensemble du pack : [[README|socle-pack-tenant]]
> Étape suivante obligatoire : [[howto-tenant-02-poser-le-tenant-courant|HOWTO tenant-02 — poser le tenant courant]]

---

## 1. Contexte

Une application qui affiche une marque, signe un courriel ou imprime un pied de page légal a besoin
de **la société derrière le tenant**. Sans le pack, chaque app recopie cette identité dans sa propre
table (`db_cabinet`, `z_politique_tenant`, `z_settings`…), écrit son propre client HTTP vers le Hub,
son propre cache et son propre comportement quand le Hub ne répond pas.

Le pack fait tout cela une fois. L'application **injecte trois beans** (`TenantProfile`,
`TenantBranding`, `TenantMembres`) et ne stocke rien.

Ce que le pack **ne fait pas** : gérer les tenants (c'est l'IAM du Hub), écrire la fiche (actions
d'administration `iam_worker`), ni résoudre lui-même le tenant de la requête (c'est l'app qui le
pose dans le MDC, cf. tenant-02).

Cas réel : `APP-28-Your360` (pack 0.5.0, socle 5.9.4).

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Application V005                                                      │
│                                                                      │
│  Filtre HTTP de l'app ──► MDC tenant_id = <slug>   (tenant-02)        │
│                                                                      │
│  Contrôleur / Worker                                                 │
│     profil.fiche()  marque.logoUrl()  equipe.membres()               │
│          │                                                           │
│  ┌───────▼──────────── socle-pack-tenant ─────────────────────────┐  │
│  │ TenantProfileService · TenantBrandingService · TenantMembres…  │  │
│  │ FicheService ── FicheCache (LRU, cache-max, ETag)              │  │
│  │ HubTenantClient (OkHttp, X-API-Key, read-timeout)              │  │
│  │ tenant_fiche_worker (PASSIVE : get_status, refresh_fiche…)     │  │
│  │ TenantBrandingDialect (si Thymeleaf)                           │  │
│  └───────┬────────────────────────────────────────────────────────┘  │
└──────────┼───────────────────────────────────────────────────────────┘
           │ GET /api/iam/tenant/{slug}/fiche   (If-None-Match → 304)
           │ GET /api/iam/tenant/{slug}/membres
           │ GET /api/iam/tenant/{slug}/logo    (302 → URL signée)
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ TheSocleHub — IAM : iam.db_tenant_fiches, iam.db_tenant_membres      │
│ ApiAuthFilter : auth.tenant = tenant du PROPRIÉTAIRE de la clé       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Dépendance Maven, artefact vendorisé

```xml
<properties>
    <java.version>21</java.version>
    <socle.version>5.9.4</socle.version>
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

    <!-- La société derrière le tenant, lue au Hub (PACK FIRST) -->
    <dependency>
        <groupId>eu.lmvi</groupId>
        <artifactId>socle-pack-tenant</artifactId>
        <version>0.5.0</version>
    </dependency>

    <!-- Facultatif : dialecte de marque #tenant (tenant-04) -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-thymeleaf</artifactId>
        <exclusions>
            <exclusion>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-logging</artifactId>
            </exclusion>
        </exclusions>
    </dependency>
</dependencies>
```

Le pack apporte **OkHttp 4.12.0** en `compile`. L'application ne déclare ni `okhttp` ni
`HttpClient` pour parler au Hub : leur présence dans le pom d'une app consommatrice est le signal
qu'un client parallèle a été réécrit.

Le pack n'est publié ni sur Maven Central ni sur `maven.thesocle.net`. Le construire puis le
**vendoriser** dans l'app :

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-tenant
mvn clean install -DskipTests          # pose 0.5.0 dans ~/.m2

APP=/opt/2026-TheHub4TheSocle/APP-XX-MonApp/monapp
DEST=$APP/mvn-repo/eu/lmvi/socle-pack-tenant/0.5.0
mkdir -p "$DEST"
cp target/socle-pack-tenant-0.5.0.jar "$DEST/"
cp pom.xml "$DEST/socle-pack-tenant-0.5.0.pom"
```

Le `@SpringBootApplication` doit balayer `eu.lmvi.socle` : les beans du pack vivent sous
`eu.lmvi.socle.pack.tenant`.

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

## 4. Étape 2 — Configuration `socle.tenant.*`

Toutes les propriétés, avec les **défauts du code** (`TenantProperties`, 0.5.0) :

```yaml
socle:
  tenant:
    hub-url: ${SOCLE_TENANT_HUB_URL:}               # obligatoire, ex. https://admin.thesocle.net
    cle-apim: ${SOCLE_TENANT_CLE_APIM:}             # obligatoire, apim_<env>_<40hex>
    cache-max: ${SOCLE_TENANT_CACHE_MAX:200}        # fiches gardées en mémoire (LRU)
    revalidation: ${SOCLE_TENANT_REVALIDATION:30s}  # rappel du Hub avec ETag (304 si inchangée)
    fraicheur-max: ${SOCLE_TENANT_FRAICHEUR_MAX:1h} # au-delà : donnée signalée périmée
    read-timeout: ${SOCLE_TENANT_READ_TIMEOUT:5s}   # connect/read/write ; callTimeout = 2×
    prechargement: ${SOCLE_TENANT_PRECHARGEMENT:true}
    envoyer-tenant-actif: ${SOCLE_TENANT_ENVOYER_TENANT_ACTIF:false}   # true si multi-tenant (tenant-06)
    logo-cache-disque: ${SOCLE_TENANT_LOGO_CACHE_DISQUE:/tmp/socle-tenant/logos}
    lecture-double:                                  # P4, tenant-08
      enabled: ${SOCLE_TENANT_LECTURE_DOUBLE_ENABLED:false}
      schema: ${SOCLE_TENANT_LECTURE_DOUBLE_SCHEMA:public}
      fenetre: 7d
      en-memoire: false
```

Variables d'environnement à déclarer dans le manifeste de l'app (le Hub les remplit depuis le coffre
de l'app au `install_app` / `update_app`, cf. `UC-SEC-12` et `UC-INT-08`) :

```bash
SOCLE_TENANT_HUB_URL=https://admin.thesocle.net
SOCLE_TENANT_CLE_APIM=<clé APIM de l'app, forme apim_prod_ suivie de 40 caractères hexadécimaux>
```

**Fournir la clé en clair, par l'environnement.** Le pack accepte aussi
`cle-apim: vault:<chemin>#<champ>`, mais `CleApimResolver` cherche alors dans le contexte Spring un
bean dont le nom de classe contient `Vault` **et** `Worker`, doté de `getSecret(String, String)`.
Le socle 5.9.5 n'en fournit aucun : dans une app V005 ordinaire, cette forme journalise
`aucun VaultWorker dans le contexte — aucune fiche ne sera lue`.

---

## 5. Étape 3 — Poser le tenant dans le MDC

Le pack lit le tenant par `TenantContext.fromMdc()` (clé `tenant_id`). **Aucune classe du socle ne
pose cette clé.** Sans le filtre décrit en [[howto-tenant-02-poser-le-tenant-courant|tenant-02]],
`profil.fiche()` lève `TenantSansFiche: aucun tenant résolu` et la route rend 500.

---

## 6. Étape 4 — Premier usage

```java
package eu.lmvi.web;

import eu.lmvi.socle.pack.tenant.api.TenantProfile;
import eu.lmvi.socle.pack.tenant.api.TenantSansFiche;
import eu.lmvi.socle.pack.tenant.model.Fiche;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class SocieteController {

    private final TenantProfile profil;

    public SocieteController(TenantProfile profil) {
        this.profil = profil;
    }

    @GetMapping("/api/societe")
    public ResponseEntity<Map<String, Object>> societe() {
        try {
            Fiche f = profil.fiche();
            Map<String, Object> corps = new LinkedHashMap<>();
            corps.put("slug", f.slug());
            corps.put("nom", f.nomAffiche());
            corps.put("mention_legale", f.mentionAImprimer());
            corps.put("perimee", profil.perimee());
            corps.put("age", profil.age().toString());
            return ResponseEntity.ok(corps);
        } catch (TenantSansFiche e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("erreur", e.getMessage()));
        }
    }
}
```

---

## 7. Vérifier

**Le worker est enregistré.** Sur l'app, administration par `X-Admin-Key` :

```bash
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" https://monapp.thesocle.net/admin/actions \
  | grep -o 'tenant_fiche_worker[^"]*' | sort -u
```

Attendu : `get_status`, `list_fiches_cache`, `refresh_fiche`, `invalidate_fiche`.

**La fiche se charge.** Depuis le Hub, par le relais MCP (nom d'outil complet, arguments en chaîne
JSON dans `params`) :

```bash
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/mcp_proxy_worker/mcp_proxy_invoke \
  -d '{"tool":"monapp__tenant_fiche_worker__refresh_fiche",
       "params":"{\"slug\":\"atelier-des-parcours\"}"}'
```

Attendu : `{"slug":"atelier-des-parcours","nom":"L'Atelier des Parcours","etag":"W/\"…\"","confirmee_le":"2026-…"}`.

```bash
curl -sk -H "X-Api-Key: $HUB_KEY" -H "Content-Type: application/json" \
  -X POST https://admin.thesocle.net/api/actions/mcp_proxy_worker/mcp_proxy_invoke \
  -d '{"tool":"monapp__tenant_fiche_worker__get_status","params":"{}"}'
```

Attendu : `"configure": true`, `"fiches_en_cache" ≥ 1`, `"revalidation":"PT30S"`, `"fraicheur_max":"PT1H"`.

**Au démarrage**, les journaux ne portent ni `socle.tenant.cle-apim absente` ni
`la clé APIM ne commence pas par « apim_ »`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | `mvn dependency:tree \| grep -i okhttp` | une seule occurrence, tirée par `socle-pack-tenant` |
| 2 | Clone frais, `mvn -o package` | compile : l'artefact est vendorisé |
| 3 | `GET /api/societe` avec `X-SSO-Tenant` posé par le proxy | 200, `mention_legale` non vide |
| 4 | Même appel sans tenant | 503 « aucun tenant résolu » |
| 5 | `get_status` | `configure: true` |
| 6 | App sans Thymeleaf sur le classpath | démarre (le dialecte est conditionnel) |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Tenant jamais posé dans le MDC | `TenantSansFiche: aucun tenant résolu` → 500, alors que l'en-tête `X-SSO-Tenant` est là | filtre de [[howto-tenant-02-poser-le-tenant-courant\|tenant-02]] |
| `cle-apim: vault:…#…` dans une app V005 | `aucun VaultWorker dans le contexte` ; aucune fiche | clé en clair par variable d'environnement, remplie par le Hub |
| Clé tenant UUID au lieu d'une clé APIM | WARN au démarrage, puis 401 `auth_missing` traité en mode dégradé | clé `apim_<env>_<40hex>` |
| Pack seulement dans `~/.m2` | compile sur le poste, échoue en CI / clone frais | vendoriser `mvn-repo/eu/lmvi/socle-pack-tenant/0.5.0/` |
| `scanBasePackages` sans `eu.lmvi.socle` | aucun bean `TenantProfile` à injecter | `{"eu.lmvi.socle", "eu.lmvi"}` |
| Se fier au README pour les défauts | `fraicheur-max` attendu à 24 h, réel 1 h ; `revalidation` ignorée | la référence est `TenantProperties` (tableau §4) |
| App multi-tenant avec la configuration par défaut | 3 tenants sur 4 servent « Hub muet » sans erreur | [[howto-tenant-06-servir-plusieurs-tenants\|tenant-06]] |
| Invoquer l'action par `/api/actions/…` sur l'app | 404 | `POST /mcp` sur l'app, ou `mcp_proxy_invoke` depuis le Hub |

---

## 10. Pour aller plus loin

- [[howto-tenant-02-poser-le-tenant-courant|tenant-02]] — le MDC `tenant_id`
- [[howto-tenant-03-lire-la-fiche-societe|tenant-03]] — tout ce que porte la fiche
- [[howto-34-gerer-les-tenants-iam|HOWTO 34]] — créer le tenant au Hub
- [[howto-28-integrer-un-socle-pack-dans-une-app|HOWTO 28]] — intégration générique d'un pack
- `socle-pack-tenant/docs/CONTRAT-REST.md` — ce que le pack attend du Hub
