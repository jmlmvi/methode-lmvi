<!-- KIT-VERSION: 1.8.0 -->
# Méthode AgileIA — Besoin → Plan (Spec de besoins → US → Features → Épics → Phasage → Plan technique)

> **But** : passer proprement d'un **besoin métier exprimé** à un **plan technique exécutable**, sans
> trou et sans big-bang. Méthode **orientée produit** : on part d'un besoin (déjà cadré, ou fourni
> sous forme de CdC) et on le déroule en incréments livrables. C'est **la** méthode forward AgileIA ;
> le cas « spec contractuelle de grande ampleur » est couvert par le **mode d'entrée « CdC fourni »**
> (`PROFILS.md`), pas par une méthode séparée.
>
> **Origine** : distillée de la conception réelle de l'**Atelier de décomposition** de
> Régie (APP-16), révisée suite à la revue Fable (`../AnalyseFable/`). Réutilisable pour toute
> feature/app portée par un besoin métier. Les règles issues du seul chantier Régie sont marquées
> **⚗️ règle candidate** (N=1, à confirmer sur instance 2).

---

## 0. Les principes fondateurs

### 0.1 Premier principe — la preuve externe (comment croire)

> **Tout artefact doit être prouvé par quelque chose d'extérieur à lui.**

| Artefact | Sa preuve externe |
|---|---|
| US | son test d'acceptation (`@US-x`) |
| RG | son contre-exemple rejeté (`@RG-x`) |
| Matrice de couverture | ses deux lectures (verticale : couverture ; horizontale : chemin) |
| Phase | sa gate = démo réelle + non-régression |
| Backup | sa restauration exécutée |
| Doc utilisateur | sa rejouabilité (elle permet de refaire la démo) |
| Spec | un relecteur **qui ne l'a pas écrite** (différent en nature, cf. §1) |
| **Le kit lui-même** | un **chantier réel** (RETEX — un template jamais instancié reste ⚗️) |

Un artefact sans preuve externe est une opinion bien formatée.

### 0.2 Deuxième principe — les 3 axes orthogonaux (comment ranger)

On ne mélange jamais ces trois axes.

| Axe | Objet | Répond à |
|---|---|---|
| **Métier** | **Épic → Feature → US** (l'épic regroupe des features ; la feature, des US) | *quelle capacité on promet à l'utilisateur* |
| **Technique** | Worker / service / stage / package | *avec quelles briques on le fait* |
| **Livraison** | **Phase** (avec une *gate* démontrable) | *quand, et comment on le démontre* |

Un épic **traverse** plusieurs briques ; une brique (ex. un moteur de pipeline) **sert** plusieurs épics.
→ **Jamais de mapping 1:1 « épic = worker ».**

**Corollaire (artefacts)** : chaque artefact ne porte **que son axe**. La hiérarchie
**Épic → Feature → US** est interne à l'axe métier : elle vit dans les fiches (M2/M3). La fiche US
reste purement métier ; le rattachement US → phase → brique, lui, vit **uniquement** dans la
**matrice de couverture (M6)**, seule source de vérité du mapping entre les 3 axes.

**Les 3 piliers** : la chaîne M0→M7 vit dans le pilier **`conception/`** (ce dossier), avec les
artefacts signables (fiches RG · matrice d'habilitations · plan de test — `TEMPLATE-RG`,
`TEMPLATE-HABILITATIONS`, `TEMPLATE-TESTS`). Les deux autres piliers s'y branchent, **activables
selon le contexte** (déclaré dans le casting M0) — [`conformite/`](../conformite/) (recette
formelle, RGPD, risques, budget — le contractuel & légal) et [`run/`](../run/) (environnements,
exploitation, CI, doc — la vie après la livraison). En solo : `conception/` au minimum ; chez un
client : les trois.

---

## 1. La chaîne en 8 maillons (M0→M7)

```
M0 Besoin & Vision  →  M1 Spec de besoins  →  M2 User Stories  →  M3 Features & Épics  →  M4 Arbitrages
        →  M5 Phasage gaté  →  M6 Plan technique  →  M7 Exécution & câblage  →  (Code + suivi par phase)
```

Chaque maillon a une **entrée**, un **livrable**, des **règles**, et une **définition de fini (DoD)**.
Chaque livrable est relisible ; la relecture est **requise** pour **M1, M4 et M6** — par un relecteur
**différent en nature** du producteur (humain métier, ou **autre modèle LLM** : opencode/minimax,
glm47 via APIM…) : une autre session du même modèle est une relecture de confort, insuffisante seule.

**Deux modes d'entrée** (déclarés en M0, cf. `PROFILS.md`) :
- **besoin exprimé** (vrac, oral) → M0/M1 s'écrivent en reformulant ;
- **CdC / spec fourni** (document existant, même volumineux) → M0/M1 s'**extraient** : la SPEC
  méthodique est produite **depuis** le CdC avec **traçabilité** (chaque US/RG référence son § du
  CdC), les trous et contradictions du CdC deviennent les `[À ARBITRER]`. Le CdC reste la référence
  contractuelle ; la SPEC devient l'artefact opératoire. Zéro invention : rien qui ne soit dans le
  CdC ou tranché en M4.

### M0 — Besoin & Vision
- **Entrée** : ce que dit le commanditaire (souvent oral, désordonné).
- **Livrable** : 3–5 lignes de vision + le **principe directeur** + la liste des **acteurs** (personas
  métier — ils donneront les **rôles métier** des habilitations : acteur ≠ rôle, une personne cumule) +
  le **casting du chantier** (commanditaire, relecteur(s) — dont le relecteur hors-famille,
  métier/PO, dev(s), recetteur — une personne peut cumuler) + le **profil** (express / solo / client,
  cf. `PROFILS.md`) + le **mode d'entrée** (besoin exprimé / CdC fourni) + les **piliers activés**.
- **Règle** : reformuler et **faire confirmer** avant d'écrire quoi que ce soit d'autre.
- **DoD** : le commanditaire dit « oui, c'est ça ».

### M1 — Spécification de besoins (SPEC fonctionnelle)
- **Entrée** : la vision M0.
- **Livrable** : `SPEC-*.md` — **concepts & vocabulaire**, **modèle d'entités**, **règles de gestion
  en fiches** (1 fiche/RG typée et tracée, pilier conception `TEMPLATE-RG.md` — générables), la
  **matrice d'habilitations** rôle × US (✅/⛔/⚠️→RG `droit_acces`, pilier conception
  `TEMPLATE-HABILITATIONS.md` — le métier la signe), contrat métier, **exigences non fonctionnelles**
  (volumétrie, latence, coût par run — LLM inclus, rétention, quotas ; « N/A » accepté si justifié).
  **Le QUOI, jamais le comment.**
- **Règles** : tout terme est défini une fois ; les points non tranchés sont marqués `[À ARBITRER]`
  (deviennent M4) ; la spec **complète** l'existant, ne l'écrase pas.
- **DoD** : un tiers (le relecteur) comprend le domaine sans connaître le code. **Relecture requise.**

### M2 — User Stories
- **Entrée** : la spec M1.
- **Livrable** : des US `En tant que <acteur>, je veux <capacité>, afin de <bénéfice>` + **critères
  d'acceptation** sur les pivots.
- **Règles** : une US = une intention **testable** ; pas de solution technique dans l'US ; numérotées
  (traçabilité) ; **la fiche US ne porte ni phase ni brique** — ce rattachement vit dans la matrice de
  couverture (M6), cf. §0.
- **DoD** : chaque US est démontrable par un test d'acceptation.

### M3 — Features & Épics (le regroupement, à deux étages)
- **Entrée** : les US M2.
- **Livrable** : les US rangées en **features** — une feature = une **capacité démontrable d'un
  bloc**, plus fine que l'épic, plus large que l'US — elles-mêmes rangées en **épics** (thèmes de
  valeur), ex. A–H. La hiérarchie **Épic → Feature → US est obligatoire** : un petit chantier crée
  au minimum une **feature-enveloppe** par épic (même périmètre que l'épic, déclarée comme telle
  dans sa fiche).
- **Règle importante** : c'est une **relation de regroupement**, pas une étape temporelle stricte.
  On itère : on esquisse les épics comme thèmes, on détaille les US, on regroupe en features.
  (Bottom-up **ou** top-down — les deux marchent.)
- **Granularité** (repère, pas dogme) : une feature = 2–8 US démontrables ensemble ; un épic =
  1–5 features. Au-delà, splitter ; en deçà, la feature-enveloppe suffit.
- **US transverse** : une US a toujours **une seule feature propriétaire** — et donc un seul épic
  propriétaire, celui de sa feature (c'est ce que compte la matrice) ; des regroupements
  secondaires sont possibles via les tags `feature/x` / `epic/x` du frontmatter.
- **DoD** : toute US a exactement une feature propriétaire ; toute feature a exactement un épic ;
  aucune feature ni aucun épic vide.

### M4 — Arbitrages (décisions tranchées)  ← *maillon souvent oublié*
- **Entrée** : les `[À ARBITRER]` de M1 + les questions ouvertes.
- **Livrable** : un journal de **décisions** (option retenue + pourquoi), rapatrié dans la spec.
- **Règle** : **on ne passe pas au plan tant qu'une décision structurante est ouverte.** On propose des
  options, on recommande, on fait trancher.
- **DoD** : plus aucune décision bloquante ; les décisions sont écrites, pas dans les têtes.
  **Relecture requise.**

### M5 — Phasage gaté
- **Entrée** : features & épics (M3) + décisions (M4).
- **Livrable** : des **phases**, chacune = un sous-ensemble de features/US livré ensemble (la
  feature — capacité démontrable — est l'unité naturelle de découpage), avec une
  **gate = démo vérifiable** (« on voit X marcher »). **Convention de nommage** : `P-0, P-1…` dans le
  kit ; une instance peut choisir son préfixe (ex. `PA-x` chez Régie) mais il est **unique** pour le
  chantier et **déclaré** dans le livrable M5.
- **Règles** : chaque phase apporte de la valeur **démontrable** seule ; ⚗️ *règle candidate* — la P-0
  est le socle qui débloque le reste ; ⚗️ *règle candidate* — ré-estimer × 2 (honnêteté budget).
- **Estimation (paramétrable selon le casting)** : la règle × 2 est le plancher ; en solo + agents IA
  elle suffit (assumé) ; en équipe cliente, un sizing peut s'y ajouter (t-shirt ou autre), **déclaré**
  dans le livrable M5 — jamais imposé par le kit.
- **DoD** : chaque phase a une gate formulée comme une démo, pas comme une tâche.

### M6 — Plan technique + matrice de couverture
- **Entrée** : phasage + spec.
- **Livrable**, pour chaque phase :
  1. **Réutilisation plateforme** — ce qu'on **ne code pas** (iam/vault/storage/agentia/db/pipeline…).
  2. **Briques nouvelles** — workers / services / stages / packages, **choisis par nature** (cf. arbre
     V005), pas par épic.
  3. **Modèle de données** (tables, standard THESOCLE).
  4. **Matrice de couverture** `US → épic → phase → brique → tests` (le garde-fou, **source de
     vérité du mapping**, cf. §0 et §3 — colonne Tests : tags `@US-x`/`@RG-x`/`@neg`).
  5. **Plan de test** (pilier conception `TEMPLATE-TESTS.md`) — tests alignés sur les 3 axes (US→
     acceptation, RG→conforme+rejet, brique→unitaires, phase→gate scriptée + non-régression, app→E2E),
     squelettes Gherkin générables depuis le YAML.
  6. **Mapping habilitations → IAM** — rôles métier → rôles/scopes `manifest.json`, mode SSO par
     route, compte de service (pilier conception, doctrine : RBAC gros grain = IAM Hub, conditions
     fines = RG `droit_acces` en code).
- **DoD** : chaque US est tracée jusqu'à une brique ; aucune brique orpheline ; aucune US oubliée.
  **Relecture requise.**

### M7 — Exécution & câblage
- **Entrée** : phasage (M5) + plan (M6).
- **Livrable** : le **câblage concret** — *où* va le code (app/module, repo), *quels* **inputs techniques
  rassemblés** (dans un dossier `inputs/` : framework, packs, baseline), *quels* **outils plateforme**
  (Hub/MCP), *quelle* **cible d'exécution** (build → registre → run) ; **+ un dossier de suivi par phase**
  (`tracking/<P-x>/` : `STATE / JOURNAL / BLOCKERS / DECISIONS / tasks`).
- **Règles** : code par **incréments atomiques** ; **preuve réelle à chaque gate** — démo de la phase
  **+ re-vérification des gates précédentes** (re-démo rapide ou suite de tests, cf. M6.5) ; **zéro
  mock** ; **double-track** — chaque phase produit code + trace de suivi + raffinement du kit méthode.
- **DoD** : on sait *où / avec quoi / sur quoi* on exécute ; le suivi de la 1ʳᵉ phase est en place.

---

## 2. Les boucles de retour (encaisser le réel)

La chaîne se lit de gauche à droite, mais **le réel remonte**. Trois procédures :

### 2.1 Gate échouée
La phase **ne se ferme pas**. Consigner l'échec dans `tracking/<P-x>/BLOCKERS.md`, puis décision
explicite journalisée dans `tracking/<P-x>/DECISIONS.md` : **redémo** (correction locale), **descope**
(US déplacées → mettre à jour la matrice M6), ou **retour à un maillon** (M4 si une décision est en
cause, M6 si c'est le découpage technique).

### 2.2 Rétro-propagation (un apprentissage M7 invalide un livrable amont)
Toute invalidation déclenche une mise à jour **tracée** : la spec M1 gagne une entrée dans sa section
**« Révisions »** (date + quoi + pourquoi) ; la ligne concernée de la matrice M6 est modifiée avec sa
colonne **« Statut / révisé le »** renseignée. La matrice reste source de vérité **à tout moment**,
pas seulement au moment du plan.

### 2.3 Cycle de vie d'une US
`à faire → en cours → livrée`, plus deux états d'exception : **`splittée`** (→ `US-x.1`, `US-x.2` ;
la fiche d'origine pointe vers ses filles) et **`abandonnée`** (raison consignée en M4). **Jamais de
suppression** : une US abandonnée reste dans la matrice, barrée, avec sa raison.

### 2.4 Arrêter un chantier (kill criterion)
La méthode sait échouer une gate ; elle doit aussi savoir **abandonner**. Déclencheurs : **2 gates
consécutives ajournées sur la même phase**, ou budget consommé sans valeur démontrée, ou décision
du commanditaire. Procédure : le pilote **propose** l'arrêt (jamais ne le décide), le commanditaire
tranche (décision M4 finale) ; post-mortem obligatoire (`TEMPLATE-RETEX.md`) ; artefacts archivés,
jamais effacés. Un chantier arrêté proprement vaut mieux qu'un chantier zombie.

---

## 3. La matrice de couverture (le garde-fou)

C'est l'artefact qui **relie les 3 axes** et prouve qu'on n'a rien oublié ni codé en trop.

| US | Feature | Épic (métier) | Phase (livraison) | Brique (technique) | Tests | Gate | Statut / révisé le |
|----|---------|---------------|-------------------|--------------------|-------|------|--------------------|
| B2 | F-B1 | B — Bibliothèque | P-1 | `prompts` service + UI | `@US-B2 @pivot` | « je vois le contrat de sortie avant de lancer » | à faire |
| C1 | F-C1 | C — Exécution | P-1 | stage `agentia` (pack pipeline) | `@US-C1 @RG-A2` | « 1 prompt → propositions » | à faire |
| F1 | F-F1 | F — Aperçu/commit | P-1 | stage `Human` + service commit | `@US-F1 @neg` | « je valide avant écriture » | à faire |
| … | … | … | … | … | … | … | … |

*(Exemple issu de Régie, antérieure au niveau Feature — colonnes illustrées avec ses
features-enveloppes.)*

Lecture : **verticalement** on vérifie la couverture (chaque US a une ligne) ; **horizontalement** on
voit le chemin besoin→code→démo. C'est **ici** — et seulement ici — que vit le mapping US→phase→brique.

---

## 4. Principes transverses (non négociables)

- **Réutilisation plateforme** : on n'écrit aucune brique déjà fournie (auth, secrets, storage, LLM,
  pipeline…). Anti-extrapolation.
- **Aucun mock, aucune simulation, aucune régression** (clause AgileIA). Sans dépendance réelle → état
  **honnête** (`en_attente`), jamais un faux résultat.
- **Contrat de sortie explicite** : à chaque étape, on sait **ce qu'elle produit** avant de la lancer.
  (Vrai pour un prompt… et pour chaque maillon de cette méthode.)
- **Décisions avant plan** : M4 est un vrai maillon, pas une note de bas de page.
- **Gate = démo** : une phase se valide en **montrant**, pas en cochant des tâches — et les gates
  précédentes sont re-vérifiées (§1·M7).
- **Chaque livrable est relisible** : pas de big-bang ; relecture **requise** M1/M4/M6.
- **Un artefact = un axe** : le mapping inter-axes vit dans la matrice (M6), nulle part ailleurs.

---

## 5. Exemple appliqué — Atelier de décomposition (Régie APP-16)

| Maillon | Ce qu'on a produit |
|---|---|
| **M0** | Vision : « le metteur en scène dépose un texte et pilote la décomposition avec **ses** prompts ; l'IA propose, il valide ». |
| **M1** | `docs/regies/SPEC-ATELIER-DECOMPOSITION.md` (concepts, entités, ancrage 3 tiers, RG). |
| **M2** | 42 US (A1…J2) avec critères d'acceptation. |
| **M3** | 10 épics : A Source · B Bibliothèque · C Exécution · D Entités · E Pipeline · F Aperçu/commit · G Traçabilité · H Pont vidéo · I Visualisation in-app · J Passerelle LLM APIM. |
| **M4** | Décisions : types+champs libres · aperçu→commit · ancrage 3 tiers + granularité paramétrable · bibliothèque par tenant + seed. |
| **M5** | PA-0 Socle · PA-1 Biblio+1 recette bout-en-bout · PA-2 Kit complet · PA-3 Enchaînement+traçabilité · PA-4 Pont vidéo (préfixe d'instance : `PA-x`). |
| **M6** | Réutilise `socle-pack-pipeline` (prompt=stage, aperçu=stage H, enchaînement=DAG), LLM via APIM, `storage` ; briques nouvelles = parseur théâtre, adaptateurs de stages, CRUD, front ; **~0 nouveau worker**. |
| **M7** | Câblage : code dans `APP-16-REGIES/regies/` ; inputs rassemblés (`inputs/` : pack + framework + baseline) ; outils Hub (db/iam/vault/storage/APIM/proxy/install) ; cible minihub minim4 → `regie.thesocle.net` ; suivi `tracking/PA-0…PA-4`. |

> Note : l'instance Régie a été conçue avec le kit v1 (fiches US portant phase/brique) — et elle
> est antérieure au niveau **Feature** (kit ≥ 1.8) : ses épics regroupent directement les US. Au
> resync, des features-enveloppes (1 par épic) suffisent. (Cf. « Resync d'une instance », README racine.)

---

## 6. Positionnement : un seul forward, deux modes d'entrée

`methode-AgileIA` est **la** méthode forward AgileIA. Elle absorbe, via ses deux **modes d'entrée**
(`PROFILS.md`), les deux cas qu'on distinguait autrefois par deux méthodes séparées :

- **Mode « besoin exprimé »** (léger) : une feature/app portée par un **besoin déjà cadré**, déroulé
  en incréments.
- **Mode « CdC fourni »** (lourd) : un **cahier des charges existant** ou une **spec contractuelle de
  grande ampleur** — dont la **rétro-spec d'un existant** produite par `RefonteApplication` — ingéré
  avec traçabilité §CdC→US/RG, ses trous devenant les `[À ARBITRER]`. Correspondance des artefacts
  d'une rétro-spec → maillons M0→M7 : `../../GLOSSAIRE.md` §3 *(chapeau U-DOCS ; kit vendoré ou
  cloné seul → voir le repo `2026-U-DOCS`)*.

Dans les deux cas, mêmes invariants : **phasage gaté**, **anti-extrapolation**, gate = démo.

> Note historique : ces deux modes remplacent l'ancien couple de méthodes distinctes (`Besoin2Plan`
> léger / `FromSpec2Plan` lourd). **`FromSpec2Plan` est déprécié** — son usage est entièrement
> couvert par le mode « CdC fourni ».

---

## 7. Checklist express

- [ ] M0 Vision reformulée et **confirmée** ; **casting** complet ; **piliers activés** déclarés
- [ ] M1 Spec de besoins écrite (QUOI), termes définis, **NFR posées**, **fiches RG** +
      **matrice d'habilitations signée** (pilier conception), `[À ARBITRER]` posés — **relue**
- [ ] M2 US testables et numérotées, **sans phase ni brique dans la fiche**
- [ ] M3 US regroupées en **features**, features en épics (une propriétaire chacune, aucune vide)
- [ ] M4 **Toutes** les décisions structurantes tranchées et écrites — **relues**
- [ ] M5 Phases avec **gate = démo** ; préfixe de phase déclaré ; P-0 = socle *(⚗️ candidate)*
- [ ] M6 Plan technique + **matrice de couverture** (US→épic→phase→brique→**tests**, colonne statut) +
      **plan de test** + **mapping habilitations→IAM** — **relu**
- [ ] M7 Câblage : **inputs rassemblés** (`inputs/`), outils Hub, cible d'exécution, build/deploy
- [ ] M7 Suivi : un dossier `tracking/<P-x>/` par phase (`STATE/JOURNAL/tasks`), **preuve à chaque
      gate + gates précédentes re-vérifiées**, zéro mock
