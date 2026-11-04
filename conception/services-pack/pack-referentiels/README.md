# socle-pack-referentiels — référentiels métiers ESCO et ROME

> **Version documentée : 0.1.1** — dépôt `jmlmvi/socle-pack-referentiels`, branche locale
> `feat/motifs-refus-bilingues-0.1.1` (non poussée, non taguée au 2026-11-04 ; 0.1.0 = tag `v0.1.0`), jar
> vendorisé dans `mvn-repo/eu/lmvi/socle-pack-referentiels/0.1.1/`. Vérifié au code le **2026-11-04**. Coordonnées Maven : `eu.lmvi:socle-pack-referentiels:0.1.1` —
> 0.1.1 : refus de chargement codés (`MotifRefus`, 31 codes stables), libellés FR et EN (`ChargementRefuse.message(Locale)`) —
> Spring Boot 4.1.2, parent `eu.lmvi:socle-v005-parent` 5.11.2, compilé contre `socle-v005` 5.11.2 en
> `provided` (minimum 5.10.0). Prérequis K-1 d'APP-36-TheBeneficiaire.

## Le pack en cinq lignes

1. Il charge, **version par version**, ESCO (Commission européenne, FR et EN), le ROME 4.0 (France
   Travail) et la table de correspondance ROME ↔ ESCO, depuis les fichiers officiels tels quels.
2. Il vérifie la licence et la provenance au chargement, et garde licence et mention avec la version.
3. Il propose métiers et compétences **à la frappe**, sans accents ni casse (< 0,3 s mesuré).
4. Il ne réécrit jamais une version chargée : un rattachement fait par une app (code + version) se
   relit tel qu'il a été fait, et le pack dit s'il est à jour, modifié ou retiré.
5. Il ne rattache rien lui-même (le rattachement vit dans l'app) et ne télécharge rien : l'administrateur
   dépose les fichiers officiels.

## Ce que fait le pack, ce que fait le Hub, ce que fait l'app

| Côté **Hub** | Côté **pack** | Côté **app** |
|---|---|---|
| pose le schéma de l'app (`db_worker.create_app_schema`) | y crée ses six tables `db_*` | — |
| pose (ou non) l'extension `pg_trgm` dans la base | ajoute des index trigrammes si elle existe | — |
| remplit les variables `SOCLE_REFERENTIELS_*` | les lit par `socle.referentiels.*` | les déclare au manifeste |
| SSO, second facteur de l'administrateur | — | écran G1, contrôle d'accès, appel de `ReferentielsService` |
| — | recherche, versions, états des rattachements | tables de rattachement (`tr_rattachement_*`), RG-04, RG-05 |

## Besoin → howto

| Besoin | Howto |
|---|---|
| Ajouter le pack, le configurer, charger une version officielle (ESCO, ROME, correspondance) | [[howto-referentiels-01-integrer-le-pack\|referentiels-01 — Intégrer le pack et charger une version]] |
| Proposer à la frappe, rattacher, relire après rechargement, écran d'administration | [[howto-referentiels-02-rechercher-et-rattacher\|referentiels-02 — Chercher à la frappe et rattacher]] |

## Sources officielles (relevées le 2026-11-04)

| Référentiel | Où | Dernière sortie | Licence |
|---|---|---|---|
| ESCO | `esco.ec.europa.eu/fr/use-esco/download` — paquet « classification », CSV, une langue par paquet, lien envoyé par courriel | v1.2.1 (10/12/2025) | décision 2011/833/UE ; mention « Ce service utilise la classification ESCO de la Commission européenne. » |
| ROME 4.0 | `api.francetravail.fr/api-nomenclatureemploi/v1/open-data/csv` (`RefRomeCsv.zip`), jeu data.gouv.fr ROME | v62 — 26M10 (19/10/2026) | Licence Ouverte 2.0 (Etalab) |
| Correspondance ROME ↔ ESCO | `esco.ec.europa.eu/fr/use-esco/eures-countries-mapping-tables` → `EURESmapping_occs_FR.csv` | V1.1 du 19.11.2025 (ESCO 1.0.9 ↔ ROME 25M06) | décision 2011/833/UE ; auteur France Travail |

## Licence de la correspondance

**Licence de la correspondance — décision du commanditaire (2026-11-04)** : la table ROME ↔ ESCO est reprise sous la licence de la **Commission européenne, décision 2011/833/UE** (`CE-2011-833`), parce que c'est la Commission qui la publie (tables EURES) ; l'auteur, France Travail, est cité dans la mention.

## Actions MCP

Lecture seule (recherche, statistiques, versions, états de rattachements, comparaison). Le chargement passe par `ReferentielsService` depuis l'écran d'administration de l'app (décision du 2026-11-04).

## Dépendances

| Dépendance | Portée | Pourquoi |
|---|---|---|
| `eu.lmvi:socle-v005` | `provided` | `Worker`, `ActionProvider`, `ActionContext` |
| `spring-boot-starter-jdbc` + `DataSource` PostgreSQL | `provided` | tables du pack dans le schéma de l'app |
| `spring-boot-starter-log4j2` | `provided` | journalisation de l'app |

Aucune dépendance en `compile` : CSV, ZIP et normalisation sont écrits en Java pur.

## Apps consommatrices (au 2026-11-04)

| App | Pack | Socle | Usage |
|---|---|---|---|
| APP-36-TheBeneficiaire (P-0) | 0.1.1 | 5.11.x | `ReferencementService` (B3, B5, B6, B10), `AdminReferentiels` (G1) |

## Écarts relevés entre la documentation du pack et son code

| # | Documentation | Code |
|---|---|---|
| 1 | squelette du modèle : 8 colonnes `x_*` | 13 colonnes du standard THESOCLE (M6 § 4) — le pack suit M6 |
| 2 | gabarit des colonnes du paquet CSV ESCO | lu par nom ; à confirmer sur le premier paquet officiel téléchargé (les tests utilisent un extrait reconstitué depuis l'API ESCO, voir howto-01 § Pièges) |
