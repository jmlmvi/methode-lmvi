# CHANGELOG — méthode AgileIA (kit Besoin2Plan)

> Semver (convention LMVI). Chaque instance note la `KIT-VERSION` copiée et resynce via ce fichier
> (procédure : README racine, « Resync d'une instance »). Ce fichier est auto-versionné par ses
> entrées (pas de marqueur `KIT-VERSION`, cf. charte U-DOCS §3).

## 1.8.0 — 2026-07-22

**Niveau Feature** — la hiérarchie métier devient **Épic → Feature → US**, obligatoire (petit
chantier → une **feature-enveloppe** par épic). **Décision commanditaire du 2026-07-22** :
dérogation explicite au gel posé en 1.7.0, journalisée ici ; la règle « 1 version = 1 RETEX »
reprend après cette entrée — le niveau Feature reste **⚗️ non prouvé** tant qu'un chantier réel
(BilanSocle) ne l'a pas éprouvé.

- **METHODE** : §0.2 axe métier à 3 étages (la hiérarchie vit dans les fiches — le mapping
  inter-axes reste dans la seule matrice M6) ; §1·M3 « Features & Épics » réécrit (feature =
  capacité démontrable d'un bloc, granularité repère 2–8 US ; US transverse → une seule feature
  propriétaire, épic dérivé) ; §1·M5 phase = lot de **features**/US ; §3 matrice + colonne Feature ;
  §7 checklist.
- **TEMPLATE-FEATURE.md** (nouveau) ; TEMPLATE-US (feature propriétaire, tags `feature/x`),
  TEMPLATE-EPIC (regroupe ses features), TEMPLATE-M2/M3/M5/M6 alignés. Les `PROUVE-SUR` des
  templates modifiés repassent « — » (honnêteté : la variante features n'est prouvée sur rien).
- **Générateur** : section `features:` **requise** (erreur explicite sinon), `feature:` par US avec
  épic **dérivé** (un `epic:` incohérent = erreur), validation de la hiérarchie + alerte features
  vides, fiches feature (M3), colonne Feature dans la matrice générée, tags Gherkin `@feat-x`,
  index M2 par épic → features. **Prouvé** : run réel sur les données Régie (42 US + 10
  features-enveloppes + 10 épics générés, gardes d'erreur testées).
- **us-data.example.yml** : schéma v1.8 (10 features-enveloppes — Régie est antérieure au niveau
  Feature) ; ESSENTIEL / PRESENTATION / README / USAGE / prompts alignés.

## 1.7.1 — 2026-07-22

**Correctifs de cohérence** (aucune évolution de méthode — le gel 1.7.0 est respecté) :

- **Marqueurs remis en vérité** : README, USAGE, METHODE et conception/README avaient été modifiés
  en 1.7.0 **sans bump** de leur `KIT-VERSION` (resync d'instance trompé) ; `KIT-VERSION` **ajouté
  aux 13 fichiers qui n'en portaient pas** (CONTRAT-ARCHITECTURE, ExempleCdc, corpus 0→8) ;
  versionite purgée (« Statut : v1.1 » retiré de METHODE — un fichier n'a qu'une version, sa
  KIT-VERSION) ; CHANGELOG retitré « méthode AgileIA ». Exemptions actées (charte §3) :
  CHANGELOG et archives datées (`AnalyseFable/`).
- **URL de clone corrigée** : le remote réel est `github.com/jmlmvi/methode-lmvi.git`
  (USAGE §1 et §4 — la première commande du mode d'emploi échouait).
- **Vendoring `_kit/` complété** : `CONTRAT-ARCHITECTURE.md` copié dans `_kit/` (le prompt M6 le
  lisait « dans le repo méthode », inexistant côté instance) ; profil **client** → `conformite/` et
  `run/` vendorés aussi (le PROMPT-PILOTE les promettait sans qu'ils soient installés).
- **Renvois chapeau U-DOCS** : section dédiée dans le README (DOCTRINE, GLOSSAIRE, CHARTE) +
  caveat sur les liens `../../` quand le kit est cloné seul ou vendoré ; README complété des
  sections « non-négociables » (squelette charte §1).

## 1.7.0 — 2026-07-06

**Transformation « préparation au premier cas pratique réel »** (plan `AnalyseFable/06`, lot A —
issu de l'analyse Gestalt `AnalyseFable/05`). Après ce tag : **canonique GELÉ** jusqu'à la fin du
cas pratique (BilanSocle) ; règle de cadence : **1 version = 1 RETEX de chantier réel**.

- **T-1 Principe unificateur** : METHODE §0.1 « tout artefact doit être prouvé par quelque chose
  d'extérieur à lui » + table de déclinaison (y compris : le kit → chantier réel). Les 3 axes
  deviennent §0.2. **ESSENTIEL.md** (T-7) : la philosophie en 1 page, à lire en premier.
- **T-2 `conception/PROFILS.md`** : 2 dimensions — **mode d'entrée** (besoin exprimé / **CdC
  fourni** : ingestion tracée §CdC→US/RG, les trous du CdC = les `[À ARBITRER]`) × **profil**
  (express 3 arrêts / solo / client). Règle d'or : un profil ne contraint JAMAIS la taille des
  documents (correction commanditaire : un CdC de 36 pages est un mode d'entrée, pas une lourdeur).
- **T-3 Seuil d'entrée** (« un message + un test → aucune méthode ») + METHODE **§2.4 arrêter un
  chantier** (kill criterion, le pilote propose, le commanditaire tranche, RETEX obligatoire).
- **T-4 Relecteur hors-famille** : relectures M1/M4/M6 par un autre modèle — le pilote **pilote
  opencode** (décision commanditaire) et archive les sorties en preuve. Prouvé ce jour :
  `AnalyseFable/preuves/relecture-opencode-essentiel.md` (MiniMax-M3, relecture réelle).
- **T-5 Dispositif de preuve terrain** : `TEMPLATE-RETEX.md`, marqueur `PROUVE-SUR:` sur les 25
  templates (honnêteté : chaîne M0→M7/US/EPIC = Régie v1.0 ; le reste = « — »), gel + journal
  `KIT-FRICTIONS.md` tenu par le pilote.
- **T-6 Instrumentation** : PILOTAGE.md mesure durées/allers-retours/latences par maillon →
  section « économie » du RETEX.
- PROMPT-PILOTE v2 : profil + mode CdC + opencode + mesures + proposition d'arrêt §2.4.

## 1.6.0 — 2026-07-06

Pilier **run/** livré (la vie après la livraison, D-12/14/17/20) — les 3 piliers sont complets :
- **TEMPLATE-ENVIRONNEMENTS** : dev/staging/recette client/prod (recette ≠ prod, toujours), 4 règles
  de promotion, **même image du staging à la prod**, jeu de test réaliste (volumétrie NFR).
- **TEMPLATE-EXPLOITATION** : qui opère + SLA, sauvegardes avec **restauration réellement prouvée**
  (un backup jamais restauré n'est pas un backup), indicateurs métier avec seuils, top 5 runbooks.
- **TEMPLATE-CI-REVUE** : incréments atomiques bornés, revue (adversariale en solo, PR en équipe —
  obligatoire sur pivots et code d'habilitations), CI 6 étapes exécutant les suites taggées du
  pilier conception, versionnage pom+build.properties+tag Docker en une fois.
- **TEMPLATE-DOC-FORMATION** : doc **due à chaque gate** (ligne dans la matrice), organisée par rôle
  métier (matrice d'habilitations), formations calées sur les recettes, boucle support→doc.
- README racine et USAGE alignés (3 piliers livrés).

## 1.5.0 — 2026-07-06

Pilier **conformite/** livré (le contractuel & légal, D-11/13/18/19/21) + brownfield/UX dans
conception (D-15/D-16) :
- **TEMPLATE-PV-RECETTE** : PV adossé à la gate — réserves qualifiées (bloquante = gate refusée),
  délais, garantie, non-régression jointe en preuve.
- **TEMPLATE-RGPD** : revue de chaque entité M1 (oui/non explicite), **cas LLM = arbitrage M4
  obligatoire** (données perso dans les prompts via APIM ?), droits des personnes outillés par RG.
- **TEMPLATE-RISQUES** : registre proactif, 7 familles types évaluées au cadrage, relu à chaque gate.
- **TEMPLATE-AVENANT** : fiche d'impact de tout changement de périmètre (4 axes dont budget) —
  prolonge la boucle §2.2 côté contractuel, pas de dérive silencieuse.
- **TEMPLATE-AUDIT-TRAIL** : événements auditables (M1) → table immuable `tr_audit_*` (M6),
  identité SSO, consultation habilitée, prouvé par tests.
- **conception/TEMPLATE-PARCOURS-MAQUETTES** (D-15) : parcours des US pivots maquettés (Penpot,
  charte contrat §7) et **validés avant M6** — états vide/erreur/`en_attente` inclus.
- **conception/TEMPLATE-INTERFACES-REPRISE** (D-16) : contrats IF-x (via Hub/APIM, source de
  vérité, indisponibilité honnête) + reprise legacy = **phase dédiée** avec gate et rapport de rejets.

## 1.4.3 — 2026-07-06

**PROMPT-PILOTE** (`conception/PROMPT-PILOTE.md`) : le mode normal devient UN SEUL prompt — l'agent
enchaîne M0→M7 seul (livrables, YAML, générateur, DoD, relectures adversariales en agent séparé) et
ne s'arrête qu'aux **6 décisions du commanditaire** (① vision ② signature RG/habilitations
③ arbitrages un par un ④ phasage ⑤ plan ⑥ go du code). Journal `PILOTAGE.md` pour reprise de
session (« Lis PILOTAGE.md et continue »). Les prompts unitaires de USAGE §2 deviennent le mode
manuel (secours, reprise d'un maillon, autre agent).

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
