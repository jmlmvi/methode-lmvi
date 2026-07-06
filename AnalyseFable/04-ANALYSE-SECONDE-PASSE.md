# Seconde passe d'analyse — complétude face au cycle de vie complet

> **Date** : 2026-07-06 · **Déclencheur** : retour du commanditaire — la 1ʳᵉ analyse
> ([01-ANALYSE.md](01-ANALYSE.md)) a audité la **cohérence interne** du kit (incohérences, boucles,
> couplages, N=1) mais pas sa **complétude face au cycle de vie complet d'une livraison**, surtout en
> contexte **client** (équipes, contractuel) et non solo. Cette passe balaie une grille de domaines
> et relève ce qui manque. Défauts numérotés à la suite de la 1ʳᵉ passe (D-8 →).

---

## 1. Les 3 manques relevés par le commanditaire

### D-8 · Tests : aucune organisation, aucun template, aucun pont vers l'automatisation
Le kit v1.1 dit *où* décider la stratégie de test (M6.5) mais pas *comment l'organiser*. Piège évité
de justesse : le mapping naïf « US→unitaires, épic→intégration » reproduirait l'erreur « 1 épic =
1 worker ». Le bon modèle, aligné sur les 3 axes : **US → tests d'acceptation** (ses CA, taggés
`@US-x`) ; **épic → rollup** de suites (pas un niveau de test) ; **brique → unitaires/intégration
technique** ; **phase → gate scriptée** (acceptation de la phase + non-régression des phases
précédentes) ; **app → E2E/smoke**. Les CA étant déjà structurés dans le YAML, les squelettes de
tests sont **générables**.

### D-9 · Règles de gestion : non isolées, citoyennes de seconde zone
Les RG ne sont qu'une liste dans la SPEC M1. Pas de fiche, pas de type, pas de cycle de vie
(active/modifiée/abrogée), pas de source (vision ? décision M4 ?), pas de traçabilité descendante
RG→US→brique→test : l'impact d'un changement de RG est introuvable. Or les RG sont **l'artefact que
le client métier signe** — les invariants du domaine, ce qui survit aux refontes. Elles méritent le
traitement des US (fiches générées, liens croisés, matrice de conformité RG→US→tests). Bonus
plateforme : une RG de type « décision » peut pointer un modèle JDM (règle exécutable).

### D-10 · Habilitations / RBAC / scopes : la plomberie existe, la conception n'existe pas
Le contrat d'architecture (§5) règle le *où* (IAM, manifest.json, SSO proxy, x_partition). Mais rien
ne dit *comment concevoir* le modèle d'autorisation : les scopes sortent du manifest sans validation
métier. Manquent : distinction **acteur ≠ rôle métier** (M0), **matrice d'habilitation rôle × US**
(`✅/⛔/⚠️→RG-x`, en M1, signable client), arbitrages types (M4), **mapping rôles→IAM/manifest** (M6),
et les **tests négatifs systématiques** (chaque ⛔ = un 403 attendu, + étanchéité cross-tenant).
Frontière doctrinale : RBAC gros grain dans l'IAM Hub ; conditions fines (ownership…) dans les RG,
appliquées en code — pas de moteur ABAC maison.

---

## 2. Les manques supplémentaires révélés par la grille

| # | Domaine | Constat | Piste |
|---|---|---|---|
| D-11 | **Données personnelles / RGPD** | Rien n'identifie les données personnelles dans le modèle d'entités, ni finalité/durée/effacement. Légal, pas optionnel, chez un client FR | Tag « donnée personnelle » sur les entités M1 + volet rétention/effacement NFR + arbitrage type M4 |
| D-12 | **Environnements & promotion** | « build→registre→déploiement » comme s'il n'existait qu'une cible. Dev/staging/recette/prod jamais mentionnés | Section environnements en M7 |
| D-13 | **Recette client formelle** | La gate-démo suffit en solo, pas en contractuel : PV de recette, réserves qualifiées, délais, garantie | Template PV de recette adossé à la gate |
| D-14 | **Exploitation / run** | La méthode s'arrête à la livraison : quoi sauvegarder, quoi monitorer côté métier, runbook, qui opère, SLA | Dossier d'exploitation en M7 (ou M8 léger de transfert) |
| D-15 | **UX / maquettes** | On saute des US textuelles au code ; le client valide sur des écrans, pas du Gherkin (outillage existant : Penpot+MCP, pattern appdemo) | Artefact optionnel « parcours + maquettes des US pivots » entre M2 et M5 |
| D-16 | **Brownfield / reprise de l'existant** | Méthode implicitement greenfield : ni migration de données legacy, ni contrats d'interface avec les systèmes existants | Template contrats d'interface + volet reprise de données M6 (souvent une P-x dédiée) |
| D-17 | **Revue de code / CI** | « Incréments atomiques » sans définition du flux qualité : règles de PR, qui relit, ce que la CI exécute | Section M7 |
| D-18 | **Risques projet** | BLOCKERS.md est réactif ; aucun registre proactif au cadrage | Table de risques M0/M5, revue à chaque gate |
| D-19 | **Budget & avenants** | « ×2 » ne survit pas au 1ᵉʳ changement de périmètre client ; la rétro-propagation §2.2 gère le documentaire, pas le contractuel | Sortie « impact budget » dans la boucle §2.2 en contexte client |
| D-20 | **Doc utilisateur & formation** | Zéro : qui écrit le guide, quand, la formation client est-elle une phase ? | Ligne « doc livrée avec la gate » dans la matrice |
| D-21 | **Audit trail métier** | Qui-a-fait-quoi opposable (≠ logs techniques TechDB), souvent contractuel ; se conçoit en M1 (événements auditables) | Se raccroche aux RG/habilitations |

**Lecture d'ensemble** : le kit est fort sur le chemin **besoin→code** et faible sur tout ce qui
**entoure** le code — la preuve (tests), le droit (RG, habilitations, RGPD, recette), la vie après
(exploitation, doc, formation). Profil typique d'une méthode née d'un chantier interne solo.

---

## 3. Décision de structuration (commanditaire, 2026-07-06)

Trois **piliers** à la racine du kit, branchés sur la colonne vertébrale M0→M7 (qui ne bouge pas),
**activables selon le contexte** (déclaré dans le casting M0) :

| Pilier | Version | Couvre |
|---|---|---|
| `conception/` | **v1.4** | D-8 tests · D-9 RG · D-10 habilitations (+ dé-solo-isation D-6-rôles) |
| `conformite/` | v1.5 | D-11 RGPD · D-13 recette formelle · D-18 risques · D-19 budget/avenants · D-21 audit trail |
| `run/` | v1.6 | D-12 environnements · D-14 exploitation · D-17 CI/revue · D-20 doc/formation |

Restent à placer en v1.5/v1.6 au moment du détail : D-15 UX/maquettes (probablement `conception/`,
v1.5) et D-16 brownfield (probablement `conformite/` ou `conception/`, v1.5).

**Doctrine templates vs checklists** : template uniquement pour ce que le client **signe** (RG,
habilitations, PV de recette, contrats d'interface) ; checklist dans les maillons pour le reste —
préserve la légèreté du kit (point fort F-7).

---

## 4. Leçon de méthode (pour l'analyste)

Une revue critique doit faire **deux passes orthogonales** : cohérence interne (ce qui est écrit
est-il juste ?) **et** complétude externe (qu'est-ce qui n'est écrit nulle part ?) — la seconde
exige une grille de domaines indépendante du document relu. La 1ʳᵉ passe seule reproduit le biais
qu'elle dénonce : vérifier les lignes existantes de la matrice, jamais les lignes manquantes.
