# socle-pack-tenant — la fiche société du tenant, lue par l'application

> **Version documentée : 0.6.0** — dépôt `/opt/2026-TheHub4TheSocle/socle-pack-tenant/`, branche
> `main`, tag `v0.6.0`, commit `c3b70e3` (« 0.6.0 — socle 5.10.0 et Spring Boot 4.1.2 »,
> 2026-10-28). Vérifié au code le **2026-10-28**.
> Coordonnées Maven : `eu.lmvi:socle-pack-tenant:0.6.0` — Boot **4.1.2**, compilé contre
> `socle-v005` **5.10.0** en `provided`.

| Pack | Socle V005 | Spring Boot | Client HTTP |
|---|---|---|---|
| **0.6.0** | 5.10.x | 4.1.2 | `okhttp-jvm` 5.5.1 du socle (`provided`) |
| 0.5.0 (commit `bcddf0e`, sans tag) | 5.8.x – 5.9.x | 4.0.6 | `okhttp` 4.12.0 embarqué |

L'API (beans injectés, propriétés, actions MCP, tables) est identique de 0.5.0 à 0.6.0. Ce qui
change pour l'app : l'appariement socle ↔ pack, les **noms de beans** préfixés `tenant…`
(`tenantFicheService`, `tenantFicheCache`, `tenantHubClient`… — sans effet pour une injection par
type), et la lecture double qui démarre enfin avec `enabled=true`.

## Le pack en cinq lignes

1. Il donne à une application **la société derrière le tenant courant** : identité, identité légale,
   coordonnées, dirigeant, éditeur, marque, domaine, équipe — sans table locale ni client HTTP maison.
2. Il lit le Hub par REST (`GET /api/iam/tenant/{slug}/fiche|membres|logo`) avec la **clé APIM de
   l'application**, garde les fiches dans un cache LRU validé par `ETag`, et les revalide toutes les 30 s.
3. Quand le Hub se tait, il sert la dernière fiche connue **avec son âge** ; sans fiche, il lève
   `TenantSansFiche` — jamais de marque par défaut.
4. Il rend la marque prête à l'emploi : variables CSS injectées dans le `<head>` Thymeleaf, objet
   `#tenant`, URL signée du logo, octets du logo pour les PDF.
5. Il outille la migration d'une table locale vers la fiche : **lecture double (P4)**, journal des
   écarts en PostgreSQL, critère de bascule (P5) relevé par action MCP.

## Ce que fait le pack, ce que fait le Hub

| Côté **Hub** (IAM — [[howto-34-gerer-les-tenants-iam\|HOWTO 34]]) | Côté **app** (ce pack) |
|---|---|
| crée, active, suspend les tenants (`iam.db_tenants`, StrictMode, quotas) | ne crée ni ne modifie aucun tenant |
| porte et écrit la fiche (`iam.db_tenant_fiches`, `upsert_tenant_fiche`, `import_tenant`, `set_tenant_logo`) | **lit** la fiche, jamais d'écriture |
| porte l'équipe (`iam.db_tenant_membres`, `upsert_tenant_membre`) | lit l'équipe |
| compose `mention_legale` (seul à lire la porteuse d'une enseigne) | l'imprime telle quelle |
| contrôle l'accès : `ApiAuthFilter`, `grant_tenant_access` | annonce le tenant de l'appel (`X-Active-Tenant`) si on le lui demande |
| sert le logo par URL signée | relaie l'URL, met les octets en cache disque |

Point de couture avec le code de l'app : le tenant courant arrive par l'identité déléguée du Hub
(`X-SSO-Tenant`, fiches `UC-SEC-05` et `UC-SEC-06` de `APP-ZZ-TEMPLATE/docs/use-cases/`) ; le pack,
lui, le lit **dans le MDC, clé `tenant_id`** — et c'est à l'application de l'y poser
([[howto-tenant-02-poser-le-tenant-courant|HOWTO tenant-02]]).

## Besoin → howto

| Besoin | Howto |
|---|---|
| Ajouter le pack à une app, le configurer, vérifier qu'il démarre | [[howto-tenant-01-integrer-le-pack\|tenant-01 — Intégrer le pack]] |
| Faire savoir au pack quel tenant sert la requête (HTTP, action, worker) | [[howto-tenant-02-poser-le-tenant-courant\|tenant-02 — Poser le tenant courant]] |
| Imprimer raison sociale, SIREN, mention légale, coordonnées | [[howto-tenant-03-lire-la-fiche-societe\|tenant-03 — Lire la fiche société]] |
| Rendre une page ou un PDF aux couleurs et au logo du tenant | [[howto-tenant-04-rendre-la-marque\|tenant-04 — Rendre la marque]] |
| Afficher une page équipe, une signature, filtrer par rôle | [[howto-tenant-05-lire-l-equipe\|tenant-05 — Lire l'équipe]] |
| Une app qui sert plusieurs tenants | [[howto-tenant-06-servir-plusieurs-tenants\|tenant-06 — Servir plusieurs tenants]] |
| Régler la fraîcheur, superviser le cache, comprendre le mode dégradé | [[howto-tenant-07-fraicheur-cache-et-mode-degrade\|tenant-07 — Fraîcheur, cache et mode dégradé]] |
| Remplacer une table locale par la fiche sans casse (P4 → P5) | [[howto-tenant-08-migrer-une-table-locale-p4-p5\|tenant-08 — Migrer une table locale]] |

## Dépendances

| Dépendance | Portée | Pourquoi |
|---|---|---|
| `eu.lmvi:socle-v005` 5.10.x | `provided` | `TenantContext`, `Worker`, `ActionProvider`, `KvBus` |
| `spring-boot-starter-web`, `-log4j2`, `jackson-databind` | `provided` | fournis par l'app hôte |
| `com.squareup.okhttp3:okhttp-jvm` 5.5.1 | `provided` (apporté par le socle 5.10.0) | le seul client HTTP du chantier — l'app n'en déclare aucun ; en 0.5.0 : `okhttp` 4.12.0 en `compile` |
| `spring-boot-starter-thymeleaf` | `provided`, facultatif | dialecte de marque, conditionné à la présence de Thymeleaf |
| `spring-boot-starter-jdbc` + une `DataSource` PostgreSQL | `provided`, facultatif | journal des écarts de la lecture double |
| Hub ≥ 3.63.0 | service | routes `/api/iam/tenant/{slug}/…` (déployées le 2026-10-02 ; non re-mesurées le 2026-10-28) |
| une clé APIM `apim_<env>_<40hex>` | secret | [[howto-39-provisionner-une-cle-apim-pour-une-app\|HOWTO 39]] |

## Apps consommatrices (au 2026-10-28)

| App | Pack | Socle | Usage |
|---|---|---|---|
| `APP-28-Your360` | **0.5.0** | 5.9.4 | multi-cabinets, `envoyer-tenant-actif: true`, **passée en P5** le 2026-10-09 (`SocieteDuTenant`, `EquipeDuTenant`) |
| `APP-24-TheSociety` | 0.2.1 | 5.9.0 | lecture de fiche, marque, équipe ; filtre MDC de référence (`ContexteAppelantFilter`) |
| `APP-25-UniqPersonnality` | 0.2.1 | 5.8.9 | P4 câblé (`CabinetLocal`, 18 champs), `lecture-double.enabled=false` |

## Écarts relevés entre la documentation du pack et son code

Le code fait foi ; les howtos suivent le code.

**Corrigés en 0.6.0** (documentation du pack réalignée sur le code) : `fraicheur-max` 1 h et
`revalidation` 30 s dans le README et le manifeste ; `socle-pack.json` exact (0.6.0,
`minSocleVersion` 5.10.0, deux workers, deux tables) ; le README et le `CLAUDE.md` disent que
l'application pose `tenant_id` dans le MDC — **le socle 5.10.0 ne le fait toujours pas** ; l'état P4/P5 (Your360 passée en P5) est à jour ; la clé
APIM « par Vault » est décrite telle qu'elle marche (bean `*Vault*Worker*` requis, absent du socle).
Corrigé aussi en 0.6.0 : `lecture-double.enabled=true` empêchait le démarrage (constructeur
`MigrationEcarts` non désigné).

Restent ouverts :

| # | Documentation | Code (0.6.0) |
|---|---|---|
| 5 | Javadoc `TenantMembres.membresDe` : « jamais une exception » | lève `TenantSansFiche` si le Hub ne sert pas la fiche du slug et que le cache est vide |
| 6 | Javadoc `FicheCache` / `TenantFicheWorker` : invalidation KvBus essentielle, « pas de TTL » | depuis 0.2.1 la fraîcheur vient de la revalidation `ETag` ; l'abonnement KvBus reste posé mais n'est alimenté par aucune autre JVM (`docs/ECART-CONTRAT-KVBUS.md`) |
| 8 | Contrat §4 | le Hub sert aussi `liens` sur un membre ; `Membre` ne le modélise pas |

Fonctionnalités incomplètes : P5 n'a pas d'outillage propre dans le pack (c'est un retrait de colonnes
côté app) ; l'invalidation par événement est inerte entre JVM ; `HubTenantClientIntegrationTest`
(6 tests) reste sauté sans Hub ni clé APIM. Depuis 0.6.0, `JournalEcartsIntegrationTest` (14) et
`DemarrageContexteSpringTest` (vrai contexte Boot 4.1 + socle 5.10) tournent sur un PostgreSQL
Testcontainers — 91 tests, 85 verts, 6 sautés.
