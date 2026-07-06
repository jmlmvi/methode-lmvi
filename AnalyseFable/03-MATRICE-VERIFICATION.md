# Matrice de vérification des changements — kit méthode Besoin2Plan v1 → v1.1

> Le garde-fou du [plan de changement](02-PLAN-CHANGEMENT.md), sur le modèle de la matrice de
> couverture de la méthode elle-même. Lecture **verticale** : chaque défaut ([analyse](01-ANALYSE.md))
> est couvert par ≥ 1 change-set. Lecture **horizontale** : chaque change-set a un critère de
> vérification **objectif** et une méthode de preuve (pas de coche de tâche — clause LMVI).
>
> Statuts : `à faire` · `en cours` · `✅ vérifié (preuve jointe)` · `⛔ bloqué`
>
> **Exécution : 2026-07-06** — décision **Option A** actée par le commanditaire ; C-1…C-8 appliqués ;
> preuves en §4. **Chantier v1.1 : FERMÉ** (gate §3 passée).

---

## 1. Matrice défaut → changement → vérification

| Défaut | Change-set | Fichiers touchés | Critère de vérification (objectif) | Méthode de preuve | Statut |
|---|---|---|---|---|---|
| D-4 Incohérences numérotation/nommage | C-1 | `METHODE-Besoin2Plan.md`, `methode/README.md`, `TEMPLATE-M5`, `TEMPLATE-US`, `CLAUDE.md` racine | Plus aucune occurrence « 6 maillons » ni « M0→M6 » ; une seule convention de phase dans le kit ; chemin CLAUDE.md existant | `grep -rn "6 maillons\|M0→M6" docs/methode-lmvi/` → vide ; `grep "PA-" methode/TEMPLATE-*.md` → 0 ; `ls docs/docs-socleV005/01-docsV2` → OK | ✅ vérifié (P-1) |
| D-3 Fuites Régie (templates) | C-2 | `TEMPLATE-US.md`, `METHODE-Besoin2Plan.md` | Aucune référence Régie dans les templates ; règles N=1 marquées « candidate » | `grep -rn "Régie\|PA-\|APP-16\|ATELIER" methode/TEMPLATE-*.md` → vide ; `grep -c "règle candidate" METHODE` ≥ 2 | ✅ vérifié (P-2) |
| D-1 Fiche US couplée à M5/M6 | C-3 | `TEMPLATE-US.md`, `TEMPLATE-EPIC.md`, `TEMPLATE-M6`, `gen-fiches-us.py`, `METHODE-Besoin2Plan.md` | **Option A** (décision commanditaire 2026-07-06) : la fiche US générée ne contient ni phase ni brique ; la matrice M6 est l'unique mapping | Fiche générée sur jeu de test inspectée : ni champ Phase/Brique ni tag `phase/` ; brouillon matrice M6 généré à part | ✅ vérifié (P-3) |
| D-2 Pas de boucle de retour | C-4 | `METHODE-Besoin2Plan.md` (§2), `TEMPLATE-US.md` (statuts), `TEMPLATE-M6` (colonne révision) | Pour les 3 scénarios (gate KO, spec invalidée, US splittée), une procédure ≤ 5 lignes désigne qui met à jour quel fichier ; les états d'US sont énumérés | Relecture : méthode §2.1/2.2/2.3 déroulées — chaque scénario désigne fichier + action (BLOCKERS/DECISIONS, section Révisions M1, colonne matrice, US filles) | ✅ vérifié (P-4) |
| D-3 Fuites Régie (script) + D-7 ambiguïté écrasement | C-5 | `gen-fiches-us.py`, `us-data.example.yml` (nouveau), `PROMPT-generer-fiches-US.md`, `methode/README.md` | Le script tourne sur un YAML externe sans modification du code ; le contrat écrasement/préservation est écrit | Exécuté sur YAML mini (2 US fictives) → 2 fiches + 1 épic + index + matrice ; re-run idempotent ; exécuté sur l'exemple complet (42 US, 10 épics) vers le scratchpad ; contrat en docstring + PROMPT | ✅ vérifié (P-5) |
| D-5 Pas de versionnage/resync | C-6 | tous les `TEMPLATE-*.md`, `METHODE-*.md`, `CHANGELOG.md` (nouveau), `README.md` racine, `inputs-corpus/README.md` | Tout template porte `KIT-VERSION` ; CHANGELOG liste C-1…C-8 ; procédure de resync en 3 étapes écrite | `grep -L "KIT-VERSION" methode/TEMPLATE-*.md methode/METHODE-*.md` → vide ; CHANGELOG 1.1.0 relu (8 change-sets) ; README racine §Resync | ✅ vérifié (P-6) |
| D-6 NFR + tests sans domicile | C-7 | `TEMPLATE-M1`, `TEMPLATE-M6`, `TEMPLATE-M7`, `METHODE-Besoin2Plan.md` (§1·M5 + checklist §7) | M1 a une section NFR ; M6 une ligne « stratégie de test » par phase ; M7 exige la re-vérification des gates précédentes ; le statut de l'estimation est explicite | `grep -l "non fonctionnelles" TEMPLATE-M1*` ; `grep -l "Stratégie de test" TEMPLATE-M6*` ; `grep -l "gates précédentes" TEMPLATE-M7*` — les 3 non vides | ✅ vérifié (P-7) |
| D-7 Choix de méthode, US transverses, rôles | C-8 | `METHODE-Besoin2Plan.md` (§1·M0/M3, §4, §6, §7), `TEMPLATE-M3`, `TEMPLATE-M0` | Règle de choix en 3 questions fermées ; règle « épic propriétaire + tags secondaires » écrite ; rôles commanditaire/relecteur définis ; relecture requise M1/M4/M6 | Contrôle de la règle sur 2 cas connus (méthode §6) : Régie → Besoin2Plan ✓ ; socle-pack-ai (spec 50k) → FromSpec2Plan ✓ | ✅ vérifié (P-8) |

---

## 2. Contre-lectures (couverture inverse)

### 2.1 Chaque défaut est-il couvert ?

| Défaut (analyse) | Couvert par | Complet ? |
|---|---|---|
| D-1 Orthogonalité violée | C-3 | ✅ (Option A actée et appliquée) |
| D-2 Pas de boucle de retour | C-4 | ✅ |
| D-3 Fuites Régie / N=1 | C-2 + C-5 | ✅ (templates + script + marquage règles) |
| D-4 Incohérences internes | C-1 | ✅ |
| D-5 Vendoring sans resync | C-6 | ✅ |
| D-6 NFR / tests / estimation / rôles flous | C-7 (NFR, tests, estimation) + C-8 (rôles) | ✅ — réparti sur 2 change-sets, volontairement |
| D-7 Points mineurs | C-5 (écrasement script) + C-8 (choix méthode, US transverses) | ✅ |

### 2.2 Aucun change-set orphelin ?

Chaque C-x (C-1…C-8) référence ≥ 1 défaut D-x ci-dessus → **aucun changement « en trop »**
(anti-extrapolation, principe transverse de la méthode).

### 2.3 Non-régression des points forts (F-1…F-7 de l'analyse)

| Point fort préservé | Risque introduit par | Garde-fou de vérification | Statut |
|---|---|---|---|
| F-1 3 axes orthogonaux | C-3 | C-3 *renforce* F-1 ; aucun champ technique restant dans TEMPLATE-US (grep P-3) | ✅ |
| F-3 Matrice de couverture | C-3, C-4 | La matrice M6 garde ses 5 colonnes d'origine ; l'ajout (« Statut / révisé le ») est additif | ✅ |
| F-4 Gate = démo | C-7 | La re-vérification des gates précédentes **s'ajoute** à la démo (TEMPLATE-M7 §4), ne la remplace pas | ✅ |
| F-7 Kit léger | C-4, C-6, C-7 | **Budget de volume** : max mesuré = 54 lignes (TEMPLATE-M7), sous le plafond ~70 (`wc -l`, P-9) | ✅ |
| F-6 Séparation générique/instance | tous | Aucun fichier de `APP-16-REGIES/` écrit par ce chantier (les modifications visibles au `git status` préexistaient à la session — travail app en cours, hors périmètre) | ✅ |

---

## 3. Gate de clôture du chantier

Le chantier « kit v1.1 » est **fermé** quand :

- [x] Toutes les lignes de la matrice §1 sont `✅ vérifié` avec preuve jointe (§4) ;
- [x] Les 5 garde-fous de non-régression §2.3 sont verts ;
- [x] `CHANGELOG.md` en version **1.1.0** décrit C-1…C-8 ;
- [x] **Démo** (gate au sens de la méthode) : kit v1.1 instancié à blanc sur un mini-chantier fictif
      (2 US, 1 épic, 1 phase) de M0 à M6 — M0/M1/M4/M5/M6 remplis depuis les templates, M2/M3/matrice
      générés par le vrai script — sans ambiguïté ni référence Régie (grep final vide, P-10).

> Clause LMVI respectée : la démo de clôture a été faite avec le vrai script et les vrais templates
> (scratchpad `test-kit/chantier-mini/`), pas une simulation.

---

## 4. Preuves (exécution 2026-07-06)

- **P-1** : `grep -rn "6 maillons\|M0→M6" docs/methode-lmvi/ --include="*.md"` → seule occurrence
  restante : le CHANGELOG **décrivant** la correction (légitime). `grep "PA-" methode/TEMPLATE-*.md`
  → 0. `ls docs/docs-socleV005/01-docsV2` → existe ; 4 occurrences corrigées dans CLAUDE.md.
- **P-2** : `grep -rn "Régie\|PA-\|APP-16\|ATELIER" methode/TEMPLATE-*.md` → **exit 1 (vide)** ;
  `grep -c "règle candidate" METHODE-Besoin2Plan.md` → **3**.
- **P-3** : fiche générée `A1-premiere-capacite.md` (test) : table = Nom/Code/Épic/RG/Statut
  uniquement, tag `epic/A` seul, renvoi « Phase & brique → matrice » ; idem sur l'exemple 42 US
  (`C2-citation-source.md` : 1 renvoi matrice, 0 tag `phase/`).
- **P-4** : méthode §2.1 (gate KO → BLOCKERS + décision DECISIONS : redémo/descope/retour M4-M6),
  §2.2 (invalidation → Révisions M1 + ligne matrice datée), §2.3 (cycle : à faire/en cours/livrée/
  splittée/abandonnée, jamais de suppression).
- **P-5** : `python3 gen-fiches-us.py us-data-mini.yml` → `OK : 2 fiches US + 1 fiches épic + index
  M2 + matrice M6 (1 lignes)` ; re-run → identique (idempotent) ; exemple complet →
  `OK : 42 fiches US + 10 fiches épic + index M2 + matrice M6 (42 lignes)`.
- **P-6** : `grep -L "KIT-VERSION" methode/TEMPLATE-*.md methode/METHODE-*.md` → **vide** ;
  CHANGELOG 1.1.0 = 8 change-sets ; README racine § « Resync d'une instance » (3 étapes).
- **P-7** : les 3 `grep -l` retournent respectivement TEMPLATE-M1, TEMPLATE-M6, TEMPLATE-M7 ;
  estimation explicitée méthode §1·M5 (« statut assumé »).
- **P-8** : méthode §6 : 3 questions + contrôle sur les 2 cas connus (Régie oui/non/non →
  Besoin2Plan ; socle-pack-ai non/oui/oui → FromSpec2Plan).
- **P-9** : `wc -l methode/TEMPLATE-*.md` → max 54 (TEMPLATE-M7), total 390 pour 10 templates.
- **P-10** : arborescence du chantier fictif : M0/M1/M4/M5/M6 + M2 (2 fiches + index générés) +
  M3 (1 fiche générée) + matrice générée ; `grep -rl "Régie\|PA-"` sur le chantier → **exit 1 (vide)**.
