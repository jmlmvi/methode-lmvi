# AnalyseFable — revue critique du kit méthode Besoin2Plan

> Revue externe du kit `docs/methode-lmvi/` réalisée le **2026-07-06** par Claude Fable 5, en vue
> de l'évolution **v1 → v1.1**.

| Document | Rôle |
|---|---|
| [`01-ANALYSE.md`](01-ANALYSE.md) | L'analyse critique : 7 points forts (F-1…F-7) à préserver, 7 défauts (D-1…D-7) priorisés |
| [`02-PLAN-CHANGEMENT.md`](02-PLAN-CHANGEMENT.md) | Le plan : 8 change-sets atomiques (C-1…C-8) en 3 lots, avec DoD chacun |
| [`03-MATRICE-VERIFICATION.md`](03-MATRICE-VERIFICATION.md) | Le garde-fou : matrice défaut→changement→preuve + non-régression des points forts + gate de clôture |
| [`04-ANALYSE-SECONDE-PASSE.md`](04-ANALYSE-SECONDE-PASSE.md) | 2ᵉ passe (complétude cycle de vie, contexte client) : D-8 tests · D-9 RG · D-10 habilitations + D-11…D-21 ; structuration en 3 piliers (conception v1.4 / conformité v1.5 / run v1.6) |
| [`05-ANALYSE-GESTALT.md`](05-ANALYSE-GESTALT.md) | 3ᵉ passe (la forme d'ensemble, v1.6.0) : inversion distillé→spéculé, légèreté perdue, public opérationnel = agents IA, versionite, gardiens de même famille ; le principe unificateur (**preuve externe**) |
| [`06-PLAN-TRANSFORMATION.md`](06-PLAN-TRANSFORMATION.md) | Le plan T-1…T-7 : préparer la méthode au **premier cas pratique réel** — lot A avant (v1.7.0 : principe, profils express/solo/client, seuils, relecteur hors-famille, RETEX+PROUVE-SUR, mesures, ESSENTIEL.md), lot B pendant (gel + frictions), lot C après (v1.8.0 distillée du RETEX) |

**Décision (2026-07-06, commanditaire)** : **Option A** retenue pour C-3 — la fiche US est purement
métier ; le mapping US→phase→brique vit uniquement dans la matrice de couverture (M6).

**Statut : chantier v1.1 EXÉCUTÉ et FERMÉ le 2026-07-06** — C-1…C-8 appliqués, matrice de
vérification entièrement verte (preuves P-1…P-10), gate de clôture passée (mini-chantier fictif
M0→M6 instancié à blanc avec le vrai script). Kit publié en **1.1.0** (`methode/CHANGELOG.md`).
