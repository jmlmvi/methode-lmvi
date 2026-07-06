<!-- KIT-VERSION: 1.4.0 -->
# USAGE — démarrer un nouveau chantier avec le kit Besoin2Plan

> Le mode d'emploi opérationnel : **quoi faire, dans quel ordre, et quel prompt lancer** à chaque
> maillon. La théorie est dans [`methode/METHODE-Besoin2Plan.md`](methode/METHODE-Besoin2Plan.md) —
> ici, on exécute. Les prompts sont écrits pour un agent type Claude Code ayant accès au repo.

---

## La carte avant la route — où tu es, ce qui vient après

Le déroulé complet, en phases projet classiques. Repère-toi ici à tout moment :

```
┌─ 1 · CONCEPTION ──────────┐ ┌─ 2 · ARBITRAGE ─┐ ┌─ 3 · PLAN ─────────┐ ┌─ 4·5·6 · PAR PHASE P-x (répété) ──────────┐
│ M0 vision → M1 spec       │ │ M4 décisions    │ │ M5 phasage         │ │ M7 câblage, puis pour CHAQUE P-x :        │
│ → M2 US → M3 épics        │→│ (spike possible)│→│ → M6 plan+matrice  │→│  développement (code + tests auto)        │
│                           │ │                 │ │   +stratégie tests │ │  → RECETTE (gate = démo au commanditaire) │
│ 🧪 les CA (M2) = la       │ │ 🚫 on ne code   │ │ 🧪 on décide quoi  │ │  → LIVRAISON (build→registre→déploiement) │
│ matière des futurs tests  │ │ pas avant       │ │ tester/automatiser │ │  → phase suivante                          │
└───────────────────────────┘ └─────────────────┘ └────────────────────┘ └────────────────────────────────────────────┘
        que du papier                 décisions            plan                    le code n'existe qu'ici
```

**Les tests entrent en scène trois fois** : leur *matière* s'écrit en conception (les critères
d'acceptation de chaque US, M2, + les exemples/contre-exemples des RG) ; leur *stratégie* se décide
au plan (M6.5 : automatisé vs démo, non-régression) ; leur *code* s'écrit pendant le développement,
en même temps que les briques (squelettes Gherkin **générés** depuis le YAML). La **recette** n'est
pas une phase finale : c'est la **gate** de chaque P-x (démo réelle validée par le commanditaire +
re-vérification des gates précédentes). La **livraison** est incrémentale : chaque gate passée se
déploie. Le cycle en V est **replié dans chaque P-x** — jamais de tunnel de dev suivi d'une grande
recette finale.

**Les 3 piliers** : la chaîne est la colonne vertébrale ; [`conception/`](conception/) (RG ·
habilitations · tests), [`conformite/`](conformite/) et [`run/`](run/) s'y branchent. Le casting M0
déclare lesquels sont actifs — solo : `conception/` au minimum ; client : les trois.

---

## 0. Est-ce la bonne méthode ? (30 secondes)

| # | Question | Oui → | Non → |
|---|---|---|---|
| 1 | Le domaine est-il déjà cadré (le commanditaire sait décrire ce qu'il veut) ? | Besoin2Plan | FromSpec2Plan |
| 2 | Vend-on une **spec contractuelle** (la spec est le livrable) ? | FromSpec2Plan | Besoin2Plan |
| 3 | Le périmètre dépasse-t-il ~1 app ? | FromSpec2Plan | Besoin2Plan |

Deux réponses sur trois orientent la même méthode → on la prend.

---

## 1. Installer le kit dans le projet

```bash
# 1. Récupérer le kit (repo canonique, prendre le dernier tag)
git clone git@github.com:jmlmvi/methode-lmvi.git /tmp/methode-lmvi

# 2. Créer le dossier d'instance du chantier dans l'app
APP=/opt/.../APP-XX-MONAPP ; CHANTIER=$APP/docs/mon-chantier
mkdir -p $CHANTIER/{M0-vision,M1-spec-besoins,M4-arbitrages,M5-phasage,M6-plan-technique,M7-execution,inputs,tracking}

# 3. Vendorer le kit (copie de travail) + noter la version copiée
cp -r /tmp/methode-lmvi/methode $CHANTIER/_kit
grep -m1 KIT-VERSION $CHANTIER/_kit/METHODE-Besoin2Plan.md   # → noter dans le README du chantier
```

Arborescence cible d'une instance (modèle : Régie `APP-16-REGIES/docs/atelier-decomposition/`) :

```
<app>/docs/<chantier>/
├── _kit/                    ← copie vendorée du kit (KIT-VERSION notée)
├── M0-vision/README.md
├── M1-spec-besoins/SPEC-<X>.md
├── M2-user-stories/         ← GÉNÉRÉ (script)
├── M3-epics/                ← GÉNÉRÉ (script)
├── M4-arbitrages/README.md
├── M5-phasage/README.md
├── M6-plan-technique/README.md   ← matrice = source de vérité du mapping
├── M7-execution/README.md
├── us-data.yml              ← source de vérité des US (copie de _kit/us-data.example.yml)
├── inputs/                  ← slots 0→8 instanciés (cf. inputs-corpus/) + inputs métier
└── tracking/<P-x>/          ← STATE / JOURNAL / BLOCKERS / DECISIONS / tasks
```

---

## 2. Dérouler la chaîne M0→M7 — les prompts à lancer

Règle générale : **un maillon à la fois**, on vérifie sa DoD (en bas de chaque template) avant de
passer au suivant. Relecture **requise** après M1, M4 et M6.

### M0 · Vision — prompt

```text
Lis _kit/TEMPLATE-M0-vision.md et _kit/METHODE-Besoin2Plan.md (§0 et §1·M0).
Voici mon besoin, en vrac : <<< ...verbatim du commanditaire... >>>
Reformule en : vision 3–5 lignes, principe directeur, acteurs, rôles du chantier
(commanditaire / relecteur). Écris M0-vision/README.md depuis le template.
NE PASSE PAS à M1 : attends ma confirmation « oui, c'est ça ».
```

### M1 · Spec de besoins — prompt

```text
La vision M0 est confirmée. Lis _kit/TEMPLATE-M1-spec-besoins.md.
Écris M1-spec-besoins/SPEC-<X>.md : concepts & vocabulaire, modèle d'entités (+ mermaid erDiagram),
règles de gestion numérotées (RG-1…), exigences non fonctionnelles (volumétrie, latence, coût par
run LLM inclus, rétention, quotas — N/A seulement si justifié), points [À ARBITRER] numérotés
(Q-1…), section Révisions vide, et un §Récapitulatif des US pressenties.
Le QUOI, jamais le comment. Aucune brique technique, aucun nom de worker.
```

### M1 · RG & habilitations (pilier conception) — prompts

```text
Lis conception/TEMPLATE-RG.md (dans le kit). Pour chaque règle de gestion de la SPEC, remplis la
section rg: de us-data.yml : titre, énoncé (une phrase impérative et testable), type
(invariant/calcul/contrainte/droit_acces/workflow), source, exceptions, et surtout ≥ 1 exemple
conforme + ≥ 1 contre-exemple rejeté (ils deviendront les tests @RG-x). Zéro invention.
```

```text
Lis conception/TEMPLATE-HABILITATIONS.md. À partir des acteurs M0 : propose les rôles métier
(acteur ≠ rôle, toujours un rôle admin du tenant), remplis la section roles: de us-data.yml,
puis lance le générateur et QUALIFIE le brouillon matrice-habilitations.generated.md : plus
aucune cellule en « ? » — chaque ⛔ devient un test négatif, chaque ⚠️ pointe une RG droit_acces.
Copie le résultat qualifié dans la SPEC M1 : c'est un artefact que le métier signe.
```

### 🔍 Relecture M1 (requise) — prompt à lancer dans une session/un agent SÉPARÉ

```text
Tu es relecteur adversarial. Lis M1-spec-besoins/SPEC-<X>.md SANS regarder le code du projet.
1) Réexplique le domaine avec tes mots — si tu n'y arrives pas, la spec échoue sa DoD.
2) Traque : termes non définis ou définis deux fois, RG ambiguës ou contradictoires, décisions
   déguisées en descriptions (elles doivent être en [À ARBITRER]), NFR manquantes, COMMENT qui a
   fui dans le QUOI. Rends une liste de défauts priorisée, rien d'autre.
```

### M2+M3 · User Stories & Épics — voie script (recommandée)

```text
Lis _kit/PROMPT-generer-fiches-US.md (voie 1) et _kit/us-data.example.yml (modèle).
À partir de la SPEC M1 (récapitulatif des US), écris us-data.yml : chantier, root, spec (lien
relatif + ancres), epics (lettre → note/titre/intention), us (code → epic, titre, acteur, veux,
afin, deps, rg, ctx, ca). NE REMPLIS PAS phase/brique (on ne les connaît qu'après M5/M6).
Zéro invention : chaque US vient de la spec.
```

Puis :

```bash
python3 $CHANTIER/_kit/gen-fiches-us.py $CHANTIER/us-data.yml
```

→ génère `M2-user-stories/` (1 fiche/US + index) et `M3-epics/` (1 fiche/épic). Les fiches sont
**régénérées intégralement** à chaque run : ne jamais les éditer à la main, éditer le YAML.
*(Voie sans script : `_kit/PROMPT-generer-fiches-US.md` voie 2.)*

### M4 · Arbitrages — prompt

```text
Lis _kit/TEMPLATE-M4-arbitrages.md. Prends tous les [À ARBITRER] de la SPEC M1 + les questions
ouvertes apparues depuis. Pour chaque question : 2–3 options, avantages/inconvénients, TA
recommandation argumentée. Présente-les-moi UNE PAR UNE pour que je tranche.
Après mes décisions : écris M4-arbitrages/README.md (décision + pourquoi + impact) et rapatrie
chaque décision dans la SPEC M1 (et note la mise à jour dans sa section Révisions).
```

### 🔍 Relecture M4 (requise) — même principe que M1, agent séparé : *« chaque décision a-t-elle une raison écrite ? une décision structurante reste-t-elle ouverte ? les décisions sont-elles reportées dans la spec ? »*

### M5 · Phasage gaté — prompt

```text
Lis _kit/TEMPLATE-M5-phasage.md et METHODE §1·M5. À partir des épics (M3) et des décisions (M4),
propose un phasage P-0…P-n : P-0 = socle qui débloque le reste ; chaque phase = un lot d'épics/US
qui apporte une valeur démontrable SEULE ; chaque gate formulée comme une DÉMO (« on voit X
marcher »), jamais comme une tâche. Déclare le préfixe de phase retenu. Ré-estime ×2.
Écris M5-phasage/README.md et attends ma validation.
```

### M6 · Plan technique + matrice — prompt

```text
Lis _kit/TEMPLATE-M6-plan-technique.md, le CONTRAT-ARCHITECTURE.md du kit, et les inputs/ du
chantier. Pour chaque phase de M5, écris M6-plan-technique/README.md :
1) réutilisation plateforme (ce qu'on NE code PAS — contrat d'architecture §10) ;
2) briques nouvelles choisies PAR NATURE (arbre V005), jamais par épic ;
3) modèle de données (standard THESOCLE) ;
4) la MATRICE DE COUVERTURE US→épic→phase→brique→gate + colonne Statut/révisé le
   (c'est ICI et seulement ici que vit le mapping ; reporte aussi phase/brique dans us-data.yml
   puis relance le générateur pour produire le brouillon matrice-couverture.generated.md à fusionner) ;
5) le PLAN DE TEST de chaque phase (conception/TEMPLATE-TESTS.md) : tagging @US-x/@RG-x/@neg,
   niveau API par défaut (UI réservé aux @pivot), gate en une commande, non-régression des
   phases précédentes — pars des squelettes générés dans tests-squelettes/ ;
6) le mapping habilitations → IAM (§3 de conception/TEMPLATE-HABILITATIONS.md) : rôles métier →
   rôles/scopes manifest.json, mode SSO par route, compte de service.
DoD : chaque US a une ligne AVEC sa colonne Tests remplie ; aucune brique sans US.
```

### 🔍 Relecture M6 (requise) — agent séparé : *« lis la matrice verticalement (une ligne par US du YAML ? compare les listes) puis horizontalement (chaque brique sert-elle une US ? une brique a-t-elle été inventée ?). Vérifie que rien de ce que le contrat d'architecture fournit n'est re-codé. »*

### M7 · Exécution & câblage — prompt

```text
Lis _kit/TEMPLATE-M7-execution.md. Écris M7-execution/README.md : où va le code (app/module,
repo), les inputs/ rassemblés (slots utilisés + versions copiées), les outils Hub/MCP nécessaires
(db_worker, iam, vault, storage, APIM, proxy, install…), la cible d'exécution
(build → registre → déploiement). Crée tracking/<P-0>/ avec STATE.md, JOURNAL.md, BLOCKERS.md,
DECISIONS.md, tasks/. Puis on code la P-0 par incréments atomiques — zéro mock, preuve réelle
à la gate.
```

---

## 3. Pendant l'exécution — les boucles de retour (méthode §2)

- **Gate échouée** → prompt : *« La gate de <P-x> a échoué : <constat>. Applique METHODE §2.1 :
  consigne dans tracking/<P-x>/BLOCKERS.md, propose-moi redémo / descope / retour M4 ou M6 avec ta
  recommandation, et journalise ma décision dans DECISIONS.md. »*
- **Un apprentissage invalide la spec** → §2.2 : entrée datée dans la section **Révisions** de la
  SPEC + ligne de matrice mise à jour (colonne « Statut / révisé le »). La matrice reste la source
  de vérité à tout moment.
- **US à splitter/abandonner** → §2.3 : jamais de suppression ; `splittée → US-x.1/x.2` (dans le
  YAML puis régénérer) ou `abandonnée` avec raison en M4, ligne barrée dans la matrice.
- **À chaque gate passée** : mettre à jour la colonne Statut de la matrice + preuve réelle dans
  `tracking/<P-x>/` (démo + re-vérification des gates précédentes).

---

## 4. Resync du kit (quand le canonique évolue)

1. Comparer la `KIT-VERSION` de `_kit/` avec [`methode/CHANGELOG.md`](methode/CHANGELOG.md) du repo
   canonique (`github.com/jmlmvi/methode-lmvi`, prendre les tags).
2. Reporter les changements pertinents dans `_kit/` (le CHANGELOG les décrit par change-set) ;
   toute divergence volontaire = décision M4 de l'instance.
3. Mettre à jour les marqueurs `KIT-VERSION` des fichiers resyncés.

---

## 5. Les non-négociables (rappel)

**Zéro mock / simulation / régression** (sans dépendance réelle → état honnête `en_attente`) ·
**gate = démo**, pas une coche · **décisions avant plan** (M4 bloquant) · **un artefact = un axe**
(le mapping vit dans la matrice M6) · **réutilisation plateforme** (le contrat d'architecture ne se
redécide pas, il s'hérite) · **relecture requise M1/M4/M6**.
