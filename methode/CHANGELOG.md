# CHANGELOG — kit méthode Besoin2Plan

> Semver (convention LMVI). Chaque instance note la `KIT-VERSION` copiée et resynce via ce fichier
> (procédure : README racine, « Resync d'une instance »).

## 1.3.0 — 2026-07-06

- **Vue globale du cycle de vie** (retour commanditaire) : README racine § « Vue globale » (table
  phases projet classiques ↔ maillons + mermaid) et USAGE.md § « La carte avant la route » (schéma
  ASCII + entrée en scène des tests en 3 temps : CA en M2, stratégie en M6, code des tests en P-x).
  Message clé : dev/tests/recette/livraison ne sont pas des phases finales — le cycle en V est
  **replié dans chaque P-x** (recette = gate, livraison incrémentale à chaque gate).

## 1.2.0 — 2026-07-06

- **USAGE.md** (racine du repo) : mode d'emploi opérationnel pour un nouveau chantier — choix de
  méthode (3 questions), installation/vendoring du kit (`_kit/` + arborescence d'instance), **prompts
  prêts à coller par maillon** (M0→M7, dont les 3 relectures adversariales requises), prompts des
  boucles de retour, procédure de resync. Aucun autre fichier modifié (leurs `KIT-VERSION` restent
  1.1.0) ; référencé depuis le README racine.

## 1.1.0 — 2026-07-06

Révision issue de la revue Fable (`../AnalyseFable/` : analyse, plan C-1…C-8, matrice de vérification).
**Décision structurante : Option A** — la fiche US est purement métier ; le mapping US→phase→brique
vit uniquement dans la matrice de couverture (M6).

- **C-1** Corrections d'incohérences : « chaîne en 6 maillons » → 8 (M0→M7) ; `methode/README` M0→M6
  → M0→M7 ; convention de préfixe de phase unifiée (`P-x` kit, préfixe d'instance déclaré en M5) ;
  chemin doc corrigé dans le CLAUDE.md racine.
- **C-2** Dé-Régie-isation des templates : lien spec en placeholder `{{lien-spec}}` ; règles issues du
  seul chantier Régie marquées « ⚗️ règle candidate » (N=1).
- **C-3 (Option A)** TEMPLATE-US et TEMPLATE-EPIC sans phase/brique (renvoi matrice M6) ; méthode §0
  corollaire « un artefact = un axe » ; la matrice M6 est la seule source de vérité du mapping.
- **C-4** Boucles de retour (méthode §2) : gate échouée, rétro-propagation (section Révisions en M1,
  colonne « Statut / révisé le » dans la matrice), cycle de vie d'une US (splittée/abandonnée).
- **C-5** Générateur générique : données externalisées en YAML (`gen-fiches-us.py <us-data.yml>`,
  modèle `us-data.example.yml` = Régie) ; contrat d'écrasement explicite ; génère un brouillon de
  matrice M6 si `phase`/`brique` fournis.
- **C-6** Versionnage : `KIT-VERSION` en tête de chaque fichier du kit + ce CHANGELOG + procédure de
  resync (README racine) ; les instances notent la version copiée par slot (corpus).
- **C-7** NFR dans TEMPLATE-M1 ; stratégie de test dans TEMPLATE-M6 (livrable 5) ; re-vérification des
  gates précédentes dans TEMPLATE-M7 ; statut de l'estimation explicité (méthode §1·M5).
- **C-8** Règle de choix Besoin2Plan vs FromSpec2Plan (3 questions fermées, méthode §6) ; US
  transverses (épic propriétaire + tags secondaires, §1·M3) ; rôles commanditaire/relecteur (M0) ;
  relecture requise M1/M4/M6.

## 1.0.0 — 2026-07-05

Version initiale (v1), distillée de la conception réelle de l'Atelier de décomposition de Régie
(APP-16) : méthode M0→M7, 10 templates, générateur (données inline), prompt, corpus 9 slots, contrat
d'architecture.
