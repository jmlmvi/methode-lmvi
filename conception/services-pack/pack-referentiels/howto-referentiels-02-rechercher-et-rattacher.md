# HOWTO referentiels-02 — Chercher à la frappe, rattacher, relire après rechargement

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-referentiels:0.1.1` (recherche et rattachement inchangés depuis 0.1.0) · socle-v005 5.11.2 (minimum 5.10.0) · Spring Boot 4.1.2
**Vérifié au code :** 2026-11-04
**Prérequis :** [[howto-referentiels-01-integrer-le-pack|referentiels-01]] ; au moins une version ESCO et une version ROME chargées
**Temps estimé :** 30 min

---

## 1. Contexte

Trois règles du chantier TheBeneficiaire passent par ce howto :

- **RG-04** — le référentiel propose, la personne choisit : la recherche rend des propositions, et
  l'app ne garde un rattachement qu'après le clic de la personne ;
- **RG-19** — un rattachement garde sa version : l'app stocke `type + code + version_id`, jamais le
  libellé seul ; une nouvelle version ne réécrit rien ;
- **RG-20** — l'administrateur voit des nombres, pas des personnes.

Le rattachement vit dans les tables de l'app (`tr_rattachement_metier`, `tr_rattachement_competence`,
partitionnées par dossier). Le pack ne connaît aucun dossier.

---

## 2. Architecture

```
frappe « dévelop »  ──► ReferentielsService.rechercherMetiers("dévelop", "fr", 10)
                          │  ESCO en service (fr) + ROME en service (fiches, appellations)
                          ▼
                      List<Proposition>  (type, code, libellé, rang, version_id)
clic de la personne ──► l'app enregistre proposition.reference() = (type, code, version_id)
nouvelle sortie     ──► ReferentielsService.etats(refs) : A_JOUR | LIBELLE_MODIFIE | RETIRE | INCONNU
                        ReferentielsService.element(ref) : l'élément tel qu'il était
```

---

## 3. Étape 1 — Proposer à la frappe

```java
package eu.lmvi.thebeneficiaire.referencement;

import eu.lmvi.socle.pack.referentiels.ReferentielsService;
import eu.lmvi.socle.pack.referentiels.modele.Proposition;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ReferencementService {

    private final ReferentielsService referentiels;

    public ReferencementService(ReferentielsService referentiels) {
        this.referentiels = referentiels;
    }

    /** Propositions pour le champ « métier » : ESCO dans la langue, plus le ROME en français. */
    public List<Proposition> metiers(String frappe, String langue) {
        return referentiels.rechercherMetiers(frappe, langue, 10);
    }

    /** Propositions pour le champ « compétence » (ESCO). */
    public List<Proposition> competences(String frappe, String langue) {
        return referentiels.rechercherCompetences(frappe, langue, 10);
    }
}
```

Comportement (code 0.1.0) :

- accents, casse et ponctuation ignorés : « DÉVELOPPEUR web », « developpeur-web » donnent la même liste ;
- chaque mot frappé doit **commencer** un mot d'un libellé : « dev web » trouve « développeur web » ;
- synonymes compris (`altLabels` ESCO, libellé court du ROME) ; `libelleTrouve` dit lequel a répondu ;
- rang : 0 libellé identique, 1 libellé qui commence par la frappe, 2 tous les mots dans le libellé, 3 synonyme ;
  puis le plus court ;
- moins de 2 caractères utiles (`recherche-min-caracteres`) : liste vide, aucune requête ;
- en anglais, le ROME n'est pas proposé (il n'existe qu'en français).

---

## 4. Étape 2 — Rattacher après le choix (RG-04, RG-19)

```java
// La personne a cliqué sur la proposition p.
RattachementRef ref = p.reference();          // (type, code, versionId)
// L'app enregistre ref.type().code(), ref.code(), ref.versionId() dans tr_rattachement_competence,
// sous la partition du dossier. Jamais de rattachement sans clic, même pour une proposition unique.
```

Une expérience sans rattachement reste dans le dossier, marquée « non référencée » (RG-05) : c'est
l'app qui le fait, le pack n'en sait rien.

---

## 5. Étape 3 — Après une nouvelle sortie

```java
Map<RattachementRef, EtatRattachement> etats = referentiels.etats(refsDuDossier);
// LIBELLE_MODIFIE : signaler au bénéficiaire, proposer le nouveau libellé (elementEnService) ;
// RETIRE : signaler, ne rien supprimer (RG-19) ;
// A_JOUR : rien à faire.
Element tel = referentiels.element(ref).orElseThrow();   // l'élément tel qu'il a été choisi
```

Mesuré sur les vraies versions ESCO 1.1.2 → 1.2.1 : la compétence « Jboss » choisie en 1.1.2 se relit
« Jboss » et l'état dit `LIBELLE_MODIFIE` (« WildFly » en 1.2.1) ; « gérer des budgets » devient
« gérer les budgets » ; le métier « comptable » est `LIBELLE_MODIFIE` (synonymes anglais revus).

---

## 6. Étape 4 — Écran d'administration G1 (RG-20)

```java
Map<String, Object> stats = referentiels.statistiques();       // version, date, licence, mention, comptes
Map<String, Object> diff  = referentiels.comparer(ancienneId, nouvelleId, 20);   // ajoutés, retirés, modifiés
Map<EtatRattachement, Long> n = referentiels.compterEtats(tousLesRattachementsSansIdentite);
```

L'app lit ses rattachements **sans identité** (type, code, version) et passe la liste : le pack rend
des comptes. En lecture, la même chose existe en MCP : `referentiels_worker__etats_rattachements`
(1 000 rattachements au plus par appel). Mesure : 30 000 rattachements (10 000 dossiers × 3) comptés en 164 à 294 ms (§ 7).

---

## 7. Performance mesurée (`PerformanceRechercheTest`, 2026-11-04)

Volume réel : ROME 4.0 v62 complet (1 923 fiches, 14 330 appellations) et ESCO 1.2.1 complet (3 039
métiers, 13 939 compétences, FR et EN). Frappe rejouée lettre à lettre (chaque préfixe ≥ 2 lettres
est une requête), sur PostgreSQL 16 en conteneur, poste de build.

| Schéma | En série (673 requêtes) | 16 personnes à la fois (10 768 requêtes) | États de 30 000 rattachements |
|---|---|---|---|
| sans `pg_trgm` (parcours) | médiane 20,1 ms · p95 26,9 ms · p99 31,7 ms · max 58,9 ms | médiane 42,8 ms · p95 89,1 ms · p99 114,3 ms · max 250,4 ms | 294 ms |
| avec `pg_trgm` (index GIN) | médiane 19,5 ms · p95 25,7 ms · p99 37,7 ms · max 99,2 ms | médiane 30,8 ms · p95 86,6 ms · p99 123,1 ms · **max 305,9 ms** | 164 ms |

Le test exige p99 et max < 300 ms en série, et p95 < 300 ms à 16 en même temps. À 16 en même temps,
une requête sur 10 768 a dépassé 300 ms (305,9 ms, avec index) : le pire cas sous forte concurrence
touche le seuil. Chargement des trois référentiels complets : 21 à 23 s.

Les 10 000 dossiers ne changent pas la recherche (tables du référentiel, ni partition ni jointure
aux dossiers). La gate P-1 de l'app rejoue la mesure de bout en bout, derrière son API.

---

## 8. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Garder le libellé au lieu de la référence | après rechargement, impossible de dire si l'élément a changé | garder `type`, `code`, `version_id` (`Proposition.reference()`) |
| Retenir d'office la seule proposition | RG-04 violée | toujours un clic ; une proposition unique s'affiche aussi |
| Appeler la recherche dès la première lettre | requêtes inutiles | le pack rend `[]` sous 2 caractères ; garder un délai de frappe (≈ 150 ms) côté interface |
| Chercher le ROME en anglais | liste sans ROME | normal : le ROME n'est publié qu'en français |
| Compter les états avec l'identité | RG-20 | ne passer que (type, code, version) à `compterEtats` |
| Croire qu'un `RETIRE` doit être supprimé | perte de donnée du bénéficiaire | RG-19 : signaler, ne rien supprimer |

---

## 9. Pour aller plus loin

- [[howto-referentiels-01-integrer-le-pack|referentiels-01]] — intégrer et charger
- [[README|socle-pack-referentiels]]
