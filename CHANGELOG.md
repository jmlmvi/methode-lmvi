# CHANGELOG — kit méthode Besoin2Plan

> Semver (convention LMVI). Chaque instance note la `KIT-VERSION` copiée et resynce via ce fichier
> (procédure : README racine, « Resync d'une instance »).

## 1.4.2 — 2026-07-06

**README et USAGE réécrits à neuf** (ils étaient devenus des empilements de retouches 1.1→1.4.1) :
- levée de l'ambiguïté « conception » : le **pilier** `conception/` (le kit : chaîne M0→M7 +
  RG/habilitations/tests) ≠ l'**étape** du cycle de vie, renommée « Cadrage & spécification » ;
- README : arborescence commentée du repo, articulation kit→instance→app, cycle de vie 6 étapes ;
- USAGE : chemins unifiés sur `_kit/` dans tous les prompts, arborescence d'instance complétée
  (RG/ générés, matrice-habilitations, tests-squelettes/), prompt M0 aligné casting+piliers,
  relecture M1 étendue aux fiches RG et à la matrice d'habilitations.

## 1.4.1 — 2026-07-06

**Restructuration (⚠️ cassante pour les chemins)** : le dossier `methode/` est **fusionné à plat
dans `conception/`** (décision commanditaire — la chaîne M0→M7 EST la conception). `conception/`
devient LE kit de conception : METHODE + templates M0→M7/US/EPIC + générateur + YAML exemple +
prompt + TEMPLATE-RG/HABILITATIONS/TESTS. Ce CHANGELOG remonte à la **racine** du repo (il couvre
tous les piliers). Vendoring d'instance : copier `conception/` en `_kit/` (USAGE §1 mis à jour).
Aucun contenu supprimé ; liens internes corrigés.

## 1.4.0 — 2026-07-06

Pilier **conception/** + seconde passe d'analyse. Structuration actée : 3 piliers à la racine
(`conception/` v1.4 · `conformite/` v1.5 · `run/` v1.6), branchés sur la chaîne M0→M7, activables
via le casting M0 (cf. `AnalyseFable/04-ANALYSE-SECONDE-PASSE.md`, D-8…D-21).

- **conception/TEMPLATE-RG.md** : les RG deviennent des citoyennes de 1ʳᵉ classe — 1 fiche par RG
  (type, source, cycle de vie actif/modifié/abrogé, US concernées, exemples/contre-exemples → tests).
- **conception/TEMPLATE-HABILITATIONS.md** : acteurs→rôles métier, matrice rôle × US (✅/⛔/⚠️→RG
  `droit_acces`) signée par le métier en M1, mapping IAM/manifest en M6, tests négatifs + cross-tenant.
  Doctrine : RBAC gros grain = IAM Hub ; conditions fines = RG en code ; pas d'ABAC maison.
- **conception/TEMPLATE-TESTS.md** : plan de test par phase — tests alignés sur les 3 axes (US→
  acceptation, RG→conforme+rejet, épic→rollup, brique→unitaires, phase→gate scriptée, app→E2E),
  tagging `@US-x`/`@RG-x`/`@neg`, gate en une commande, rapport archivé comme preuve.
- **Générateur** : sections YAML optionnelles `rg:`/`roles:` → fiches RG (`M1-spec-besoins/RG/` +
  index + détection des RG orphelines), brouillon `matrice-habilitations.generated.md`, squelettes
  Gherkin `tests-squelettes/` (1 scénario par CA, + conforme/rejet par RG). Rétro-compatible.
- **Matrice de couverture** : + colonne **Tests** (METHODE §3, TEMPLATE-M6).
- **Dé-solo-isation** (D-6 rôles) : casting complet en M0 (commanditaire, relecteur, métier/PO, dev,
  recetteur — cumul possible), piliers activés déclarés en M0, estimation paramétrable en M5.
- `conformite/` et `run/` : README de périmètre (placeholders v1.5/v1.6).
- USAGE : prompts RG + habilitations (M1) et plan de test (M6) ; piliers dans la carte.

## 1.3.0 — 2026-07-06

- **Vue globale du cycle de vie** (retour commanditaire) : README racine § « Vue globale » (table
  phases projet classiques ↔ maillons + mermaid) et USAGE.md § « La carte avant la route » (schéma
  ASCII + entrée en scène des tests en 3 temps : CA en M2, stratégie en M6, code des tests en P-x).
  Message clé : dev/tests/recette/livraison ne sont pas des phases finales — chaque P-x est un
  **mini-cycle complet** (recette = gate, livraison incrémentale à chaque gate).

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
