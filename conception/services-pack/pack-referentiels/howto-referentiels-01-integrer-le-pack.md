# HOWTO referentiels-01 — Intégrer socle-pack-referentiels et charger une version officielle

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-referentiels:0.1.1` (branche `feat/motifs-refus-bilingues-0.1.1`, non publiée au 2026-11-04 ; vendorisée dans `mvn-repo/`) · socle-v005 5.11.2 (minimum 5.10.0) · Spring Boot 4.1.2
**Vérifié au code :** 2026-11-04
**Prérequis :** une app V005 Boot 4.1.2 / socle ≥ 5.10.0 qui démarre ; un schéma PostgreSQL d'app posé par le Hub
**Temps estimé :** 30 min (plus le téléchargement des fichiers officiels)

> Vue d'ensemble du pack : [[README|socle-pack-referentiels]] · suite : [[howto-referentiels-02-rechercher-et-rattacher|referentiels-02]]

---

## 1. Contexte

Une app qui fait dire à une personne ses métiers et ses compétences doit s'appuyer sur un référentiel
public, à jour, dans les deux langues, et garder la trace de la version dans laquelle chaque choix a
été fait. Sans le pack, chaque app réécrit un lecteur ESCO, un lecteur ROME, une recherche tolérante
aux accents, et finit par écraser ses anciennes données à chaque sortie.

Le pack charge les fichiers **tels que les éditeurs les publient**, vérifie la licence et la
provenance, garde chaque version et met la dernière en service. Il ne télécharge rien : le
téléchargement reste un geste de l'administrateur (ESCO l'exige : formulaire, captcha, courriel).

Cas réel : APP-36-TheBeneficiaire, prérequis K-1 (M4 Q1 : dernières versions, rechargées à chaque sortie).

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Application V005 (schema_<appId>)                                  │
│                                                                    │
│  Écran admin G1 (SSO + 2e facteur) ──► ReferentielsService         │
│  ReferencementService (frappe)      ──► ReferentielsService        │
│                                                                    │
│  ┌──────────────────── socle-pack-referentiels ──────────────────┐ │
│  │ Lecteurs : LecteurEsco · LecteurRome · LecteurCorrespondance  │ │
│  │ ReferentielsService  → charger / rechercher / états / stats   │ │
│  │ ReferentielsRepository → db_version_referentiel, db_esco_*,   │ │
│  │                          db_rome_metier, db_correspondance_*  │ │
│  │ referentiels_worker (PASSIVE) → 7 actions MCP, lecture seule  │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Étape 1 — Dépendance Maven, artefact vendorisé

```xml
<parent>
    <groupId>eu.lmvi</groupId>
    <artifactId>socle-v005-parent</artifactId>
    <version>5.11.2</version>
    <relativePath/>
</parent>

<repositories>
    <repository>
        <id>project-local</id>
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
        <artifactId>socle-pack-referentiels</artifactId>
        <version>0.1.1</version>
    </dependency>
</dependencies>
```

Le pack n'est servi par aucun dépôt distant : le construire, puis le vendoriser.

```bash
cd /opt/2026-TheHub4TheSocle/socle-pack-referentiels
mvn -q clean install
DEST=<app>/mvn-repo/eu/lmvi/socle-pack-referentiels/0.1.1
mkdir -p "$DEST"
cp target/socle-pack-referentiels-0.1.1.jar "$DEST/"
cp pom.xml "$DEST/socle-pack-referentiels-0.1.1.pom"
```

Le `@SpringBootApplication` balaie `eu.lmvi.socle` : `scanBasePackages = {"eu.lmvi.socle", "eu.lmvi"}`.

---

## 4. Étape 2 — Configuration `socle.referentiels.*`

Défauts du code (`ReferentielsProperties`, 0.1.1, inchangés depuis 0.1.0) :

```yaml
socle.referentiels:
  enabled: ${SOCLE_REFERENTIELS_ENABLED:true}
  schema: ${SOCLE_REFERENTIELS_SCHEMA:schema_monapp}        # schéma de l'app, posé par le Hub
  langues: ${SOCLE_REFERENTIELS_LANGUES:fr,en}              # fr et en seulement
  recherche-limite: ${SOCLE_REFERENTIELS_RECHERCHE_LIMITE:10}
  recherche-limite-max: ${SOCLE_REFERENTIELS_RECHERCHE_LIMITE_MAX:50}
  recherche-min-caracteres: ${SOCLE_REFERENTIELS_RECHERCHE_MIN_CARACTERES:2}
  lot-insertion: ${SOCLE_REFERENTIELS_LOT_INSERTION:1000}
```

Recherche rapide sur gros volume : demander au Hub de poser `CREATE EXTENSION pg_trgm` dans la base
**avant** le premier démarrage (la migration ajoute alors des index trigrammes). Sans elle, la
recherche reste sous 0,3 s sur le volume réel (mesure : howto-02 § 6), par parcours.

---

## 5. Étape 3 — Télécharger les fichiers officiels

| Référentiel | Geste | Fichiers à déposer |
|---|---|---|
| ESCO | `https://esco.ec.europa.eu/fr/use-esco/download` : version (ex. *ESCO dataset - v1.2.1*), contenu *classification*, type *csv*, langue *fr* → « Ajouter », puis langue *en* → « Ajouter » ; « Exporter », formulaire (courriel, conditions), lien reçu par courriel | les deux archives, une par langue (elles contiennent `occupations_fr.csv`, `skills_fr.csv`, `occupationSkillRelations_fr.csv`…) |
| ROME | `curl -L -o RefRomeCsv.zip https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/csv` | `RefRomeCsv.zip` tel quel (il contient `version.txt`) |
| Correspondance | `https://esco.ec.europa.eu/fr/use-esco/eures-countries-mapping-tables` → « France » | `EURESmapping_occs_FR.csv` tel quel |

**Licence de la correspondance — décision du commanditaire (2026-11-04)** : la table ROME ↔ ESCO est reprise sous la licence de la **Commission européenne, décision 2011/833/UE** (`CE-2011-833`), parce que c'est la Commission qui la publie (tables EURES) ; l'auteur, France Travail, est cité dans la mention.

Ne rien ouvrir dans un tableur avant le chargement : l'enregistrement change l'encodage ou les
séparateurs, et l'empreinte de la sortie.

---

## 6. Étape 4 — Charger depuis l'app (écran d'administration)

```java
package eu.lmvi.thebeneficiaire.admin;

import eu.lmvi.socle.pack.referentiels.ReferentielsService;
import eu.lmvi.socle.pack.referentiels.modele.BilanChargement;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.List;

@Service
public class AdminReferentiels {

    private final ReferentielsService referentiels;

    public AdminReferentiels(ReferentielsService referentiels) {
        this.referentiels = referentiels;
    }

    /** Appelé par l'écran G1, après contrôle du rôle admin_plateforme et du second facteur. */
    public BilanChargement chargerEsco(String version, Path paquetFr, Path paquetEn, String admin) {
        return referentiels.chargerEsco(version, List.of(paquetFr, paquetEn), "CE-2011-833", admin);
    }

    public BilanChargement chargerRome(Path refRomeZip, String admin) {
        return referentiels.chargerRome(List.of(refRomeZip), "etalab-2.0", admin);
    }

    public BilanChargement chargerCorrespondance(Path csv, String admin) {
        return referentiels.chargerCorrespondance(List.of(csv), "CE-2011-833", admin);
    }
}
```

Ce que fait chaque chargement, dans une seule transaction : licence vérifiée, provenance contrôlée,
version neuve créée et mise en service, ancienne version passée à `remplacee` (lisible, jamais
modifiée), comptes enregistrés. Une `ChargementRefuse` dit quoi corriger ; rien n'a été écrit.

**Afficher le refus dans la langue de l'interface (0.1.1).** `ChargementRefuse` porte un code stable
(`e.code()`, ex. `licence_non_reconnue`, `rome_version_txt_absent`), ses paramètres
(`e.parametres()`) et ses deux libellés (`e.message(Locale.FRENCH)`, `e.message(Locale.ENGLISH)`).
Le plus simple pour une app bilingue : rendre les deux et laisser l'écran choisir.

```java
} catch (ChargementRefuse e) {
    // corps : {code: "chargement_refuse", motif: e.code(), message_fr, message_en}
    throw new RefusAdmin(400, "chargement_refuse", e.code(), e.message(Locale.FRENCH), e.message(Locale.ENGLISH));
}
```

L'écran affiche `message_<langue>` et peut tester `motif` (ex. surligner le champ licence sur
`licence_non_reconnue`). `getMessage()` reste le texte français de 0.1.0. Les 31 codes sont dans
`MotifRefus` ; un code ne change jamais.

**Le chargement ne passe pas par MCP** (décision du commanditaire du 2026-11-04) : aucune action du
worker n'écrit. La porte MCP s'ouvre par une clé de plateforme ; charger relève de l'administrateur,
sous SSO et second facteur. L'écran d'administration de l'app est donc le seul chemin.

---

## 7. Vérifier

`referentiels_worker__statistiques` (ou `ReferentielsService.statistiques()`) rend, par référentiel :
`version_source`, `date_publication`, `charge_le`, `licence_id`, `mention_fr`, `mention_en`, `comptes`,
`versions_gardees`, et `recherche_indexee_trigrammes`. Attendu après le ROME v62 :
`"version_source": "62"`, `"date_publication": "2026-10-19"`, `"comptes": {"appellations": 14330, "fiches": 1923}`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | démarrage de l'app | `[worker:referentiels_worker] schéma … à jour`, aucune `ConflictingBeanDefinitionException` |
| 2 | chargement avec `licence` faux | `ChargementRefuse` `licence_non_reconnue` nommant la bonne licence, en FR et en EN ; aucune ligne écrite |
| 3 | même `RefRomeCsv.zip` chargé deux fois | `deja_chargee: true`, une seule version |
| 4 | nouvelle sortie | deux versions, la neuve `en_service`, l'ancienne `remplacee`, ses lignes inchangées |
| 5 | `statistiques` | licence et mention de chaque version en service, aucune valeur nulle |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Un seul paquet ESCO (une langue) | `occupations_en.csv absent` | ajouter le paquet de chaque langue de `socle.referentiels.langues` |
| Refus affiché par `getMessage()` dans une interface anglaise | texte français à l'écran (RG-23) | `e.message(Locale)` ou `message_fr`/`message_en` (0.1.1) ; ne pas traduire côté app à partir du texte |
| App qui teste le texte du refus | casse au premier libellé amélioré | tester `e.code()`, stable |
| Gabarit du paquet CSV ESCO non confirmé | colonne « … » absente au premier chargement réel | le lecteur lit les colonnes **par nom** (`conceptUri`, `preferredLabel`, `altLabels`, `hiddenLabels`, `status`, `code`, `iscoGroup`, `description`, `skillType`, `reuseLevel` ; relations `occupationUri`, `relationType`, `skillType`, `skillUri`). Les tests du pack 0.1.0 tournent sur un extrait **reconstitué depuis l'API ESCO** (le paquet officiel exige le formulaire) : au premier paquet réel, rejouer `LecteursOfficielsTest` dessus |
| `RefRomeCsv.zip` décompressé puis rezippé sans `version.txt` | `version.txt absent` | déposer l'archive telle que France Travail la publie |
| Correspondance ouverte et réenregistrée dans un tableur | encodage ou séparateur changé, empreinte différente | redéposer le fichier téléchargé ; le lecteur accepte UTF-8 ou Windows-1252, `,` ou `;` |
| Même version déclarée avec d'autres fichiers | `déjà chargée avec d'autres fichiers` | une version chargée n'est jamais réécrite : vérifier la source et le numéro déclaré |
| Chercher une action MCP de chargement | `action inconnue` | normal : le chargement passe par `ReferentielsService`, derrière l'écran admin |
| La correspondance et ESCO ne sont pas de la même version | correspondance V1.1 = ESCO 1.0.9 ↔ ROME 25M06 | `versions_liees` le dit ; les URI ESCO sont stables d'une version à l'autre, une correspondance vers un métier retiré ne trouve plus de libellé en service |
| Afficher un intitulé sans la mention | conditions de réutilisation non tenues | afficher `mention_fr` / `mention_en` de la version en service là où les intitulés apparaissent |
| Schéma de l'app absent | `schéma « … » absent` au démarrage | poser le schéma par le Hub |
| Une `<configuration>` sur `maven-enforcer-plugin` | bornes du socle coupées sans message | jamais ; une autre `<execution>` au besoin |

---

## 10. Pour aller plus loin

- [[howto-referentiels-02-rechercher-et-rattacher|referentiels-02]] — frappe, rattachements, écran G1
- [[README|socle-pack-referentiels]] — sources, licences, tables
- [[../00-creer-ou-amender-un-pack|Créer ou amender un pack]]
