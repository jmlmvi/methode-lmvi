<!-- KIT-VERSION: 1.4.2 -->
# USAGE — démarrer un nouveau chantier

> Le mode d'emploi : **quoi faire, dans quel ordre, quel prompt lancer**. La théorie est dans
> [`conception/METHODE-Besoin2Plan.md`](conception/METHODE-Besoin2Plan.md) — ici on exécute.
> Les prompts sont écrits pour un agent type Claude Code ayant accès au chantier. Une fois le kit
> copié en `_kit/` (§1), **tous les templates se lisent depuis `_kit/`**.

---

## La carte avant la route

```
┌─ 1 · CADRAGE & SPEC ──────┐ ┌─ 2 · ARBITRAGE ─┐ ┌─ 3 · PLAN ─────────┐ ┌─ 4·5·6 · PAR PHASE P-x (répété) ──────────┐
│ M0 vision → M1 spec       │ │ M4 décisions    │ │ M5 phasage         │ │ M7 câblage, puis pour CHAQUE P-x :        │
│ (+ RG + habilitations)    │→│ (spike possible)│→│ → M6 plan+matrice  │→│  développement (code + tests auto)        │
│ → M2 US → M3 épics        │ │                 │ │   + plan de test   │ │  → RECETTE (gate = démo au commanditaire) │
│ 🧪 matière des tests :    │ │ 🚫 on ne code   │ │ 🧪 quoi automatiser│ │  → LIVRAISON (build→registre→déploiement) │
│ CA des US + ex./contre-ex.│ │ pas avant       │ │ vs démontrer       │ │  → phase suivante                          │
└───────────────────────────┘ └─────────────────┘ └────────────────────┘ └────────────────────────────────────────────┘
        que du papier                décisions            plan                    le code n'existe qu'ici
```

Chaque phase P-x est un **mini-cycle complet** : dev + tests, puis recette = la gate (démo +
non-régression), puis livraison. Jamais de tunnel de dev suivi d'une grande recette finale.

**Piliers** : ce déroulé utilise [`conception/`](conception/) (qui contient toute la chaîne M0→M7).
Le casting M0 active en plus [`conformite/`](conformite/) (PV de recette à chaque gate, RGPD en M1,
risques au cadrage, fiche d'avenant à chaque changement) et [`run/`](run/) (environnements et CI en
M7, dossier d'exploitation avant la prod, doc livrée avec chaque gate) — leurs README indiquent le
maillon de branchement de chaque artefact ; le prompt pilote les applique automatiquement.

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
# 1. Récupérer le kit (dernier tag)
git clone git@github.com:jmlmvi/methode-lmvi.git /tmp/methode-lmvi

# 2. Créer le dossier d'instance du chantier dans l'app
APP=/opt/.../APP-XX-MONAPP ; CHANTIER=$APP/docs/mon-chantier
mkdir -p $CHANTIER/{M0-vision,M1-spec-besoins,M4-arbitrages,M5-phasage,M6-plan-technique,M7-execution,inputs,tracking}

# 3. Vendorer le kit de conception + noter la version copiée
cp -r /tmp/methode-lmvi/conception $CHANTIER/_kit
grep -m1 KIT-VERSION $CHANTIER/_kit/METHODE-Besoin2Plan.md   # → noter dans le README du chantier
```

Arborescence cible de l'instance (modèle : Régie `APP-16-REGIES/docs/atelier-decomposition/`) :

```
<app>/docs/<chantier>/
├── _kit/                         ← copie de conception/ (KIT-VERSION notée)
├── us-data.yml                   ← SOURCE DE VÉRITÉ des US/RG/rôles (modèle : _kit/us-data.example.yml)
├── M0-vision/README.md
├── M1-spec-besoins/SPEC-<X>.md
│   ├── RG/                       ← GÉNÉRÉ : 1 fiche par règle de gestion + index
│   └── matrice-habilitations.generated.md   ← GÉNÉRÉ : à qualifier puis reporter dans la SPEC
├── M2-user-stories/              ← GÉNÉRÉ : 1 fiche par US + index
├── M3-epics/                     ← GÉNÉRÉ : 1 fiche par épic
├── M4-arbitrages/README.md
├── M5-phasage/README.md
├── M6-plan-technique/README.md   ← matrice de couverture = source de vérité du mapping
├── M7-execution/README.md
├── tests-squelettes/             ← GÉNÉRÉ : Gherkin @US-x / @RG-x, à déplacer dans le repo de code
├── inputs/                       ← slots 0→8 instanciés (cf. inputs-corpus/) + inputs métier
└── tracking/<P-x>/               ← STATE / JOURNAL / BLOCKERS / DECISIONS / tasks
```

Tout ce qui est marqué GÉNÉRÉ sort de `python3 _kit/gen-fiches-us.py us-data.yml` — on édite le
YAML, jamais les fichiers générés.

---

## 2. Dérouler la chaîne M0→M7

### Mode normal : LE prompt pilote (un seul prompt pour tout le chantier)

Colle le prompt de [`conception/PROMPT-PILOTE.md`](conception/PROMPT-PILOTE.md) (copié dans
`_kit/PROMPT-PILOTE.md`) avec ton besoin dedans : **l'agent enchaîne lui-même M0→M7** — livrables,
YAML, générateur, DoD, relectures adversariales — et ne s'arrête qu'aux **6 points de décision**
qui te reviennent : ① confirmer la vision · ② signer RG + habilitations · ③ trancher les
arbitrages · ④ valider le phasage · ⑤ valider le plan · ⑥ donner le go du code. Il tient
`PILOTAGE.md` à jour ; si la session casse : *« Lis PILOTAGE.md et continue le chantier. »*

### Mode manuel : les prompts unitaires (secours & reprise)

Pour reprendre **un maillon isolé**, corriger après relecture, ou travailler avec un autre agent.
**Un maillon à la fois** ; on vérifie la DoD (en bas de chaque template) avant de passer au suivant.
Relecture **requise** après M1, M4 et M6 (par le relecteur du casting, dans une session séparée).

### M0 · Vision

```text
Lis _kit/TEMPLATE-M0-vision.md et _kit/METHODE-Besoin2Plan.md (§0 et §1·M0).
Voici mon besoin, en vrac : <<< ...verbatim du commanditaire... >>>
Reformule en : vision 3–5 lignes, principe directeur, acteurs (personas), casting du chantier
(commanditaire, relecteur, métier/PO, dev, recetteur — cumul possible) et piliers activés
(conception / conformité / run). Écris M0-vision/README.md depuis le template.
NE PASSE PAS à M1 : attends ma confirmation « oui, c'est ça ».
```

### M1 · Spec de besoins

```text
La vision M0 est confirmée. Lis _kit/TEMPLATE-M1-spec-besoins.md.
Écris M1-spec-besoins/SPEC-<X>.md : concepts & vocabulaire, modèle d'entités (+ mermaid erDiagram),
règles de gestion numérotées (RG-1…), exigences non fonctionnelles (volumétrie, latence, coût par
run LLM inclus, rétention, quotas — N/A seulement si justifié), points [À ARBITRER] numérotés
(Q-1…), section Révisions vide, et un §Récapitulatif des US pressenties.
Le QUOI, jamais le comment. Aucune brique technique, aucun nom de worker.
```

### M1 · RG en fiches

```text
Lis _kit/TEMPLATE-RG.md. Pour chaque règle de gestion de la SPEC, remplis la section rg: de
us-data.yml : titre, énoncé (une phrase impérative et testable), type
(invariant/calcul/contrainte/droit_acces/workflow), source, exceptions, et surtout ≥ 1 exemple
conforme + ≥ 1 contre-exemple rejeté (ils deviendront les tests @RG-x). Zéro invention.
```

### M1 · Habilitations

```text
Lis _kit/TEMPLATE-HABILITATIONS.md. À partir des acteurs M0 : propose les rôles métier
(acteur ≠ rôle ; toujours un rôle admin du tenant), remplis la section roles: de us-data.yml,
lance le générateur, puis QUALIFIE M1-spec-besoins/matrice-habilitations.generated.md : plus
aucune cellule en « ? » — chaque ⛔ devient un test négatif (403), chaque ⚠️ pointe une RG
droit_acces. Reporte la matrice qualifiée dans la SPEC M1 : c'est un artefact que le métier signe.
```

### 🔍 Relecture M1 (requise, session séparée)

```text
Tu es relecteur adversarial. Lis M1-spec-besoins/ (SPEC + fiches RG + matrice d'habilitations)
SANS regarder le code du projet.
1) Réexplique le domaine avec tes mots — si tu n'y arrives pas, la spec échoue sa DoD.
2) Traque : termes non définis ou définis deux fois, RG ambiguës/contradictoires ou sans
   contre-exemple, cellules d'habilitation incohérentes, décisions déguisées en descriptions
   (→ [À ARBITRER]), NFR manquantes, COMMENT qui a fui dans le QUOI.
Rends une liste de défauts priorisée, rien d'autre.
```

### M2 + M3 · User Stories & Épics (générés)

```text
Lis _kit/PROMPT-generer-fiches-US.md (voie 1) et _kit/us-data.example.yml (modèle).
À partir de la SPEC M1 (récapitulatif des US), complète us-data.yml : chantier, root, spec (lien
relatif + ancres), epics (lettre → note/titre/intention), us (code → epic, titre, acteur, veux,
afin, deps, rg, ctx, ca). NE REMPLIS PAS phase/brique (on ne les connaît qu'après M5/M6).
Zéro invention : chaque US vient de la spec.
```

```bash
python3 $CHANTIER/_kit/gen-fiches-us.py $CHANTIER/us-data.yml
```

### M4 · Arbitrages

```text
Lis _kit/TEMPLATE-M4-arbitrages.md. Prends tous les [À ARBITRER] de la SPEC M1 + les questions
ouvertes apparues depuis (dont les arbitrages types d'habilitations, §4 de
_kit/TEMPLATE-HABILITATIONS.md). Pour chaque question : 2–3 options, avantages/inconvénients, TA
recommandation argumentée. Présente-les-moi UNE PAR UNE pour que je tranche.
Après mes décisions : écris M4-arbitrages/README.md (décision + pourquoi + impact) et rapatrie
chaque décision dans la SPEC M1 (section Révisions mise à jour).
```

🔍 **Relecture M4 (requise, session séparée)** : *« chaque décision a-t-elle une raison écrite ?
une décision structurante reste-t-elle ouverte ? tout est-il reporté dans la spec ? »*

### M5 · Phasage gaté

```text
Lis _kit/TEMPLATE-M5-phasage.md et _kit/METHODE-Besoin2Plan.md (§1·M5). À partir des épics (M3)
et des décisions (M4), propose un phasage P-0…P-n : P-0 = socle qui débloque le reste ; chaque
phase = un lot d'épics/US à valeur démontrable SEULE ; chaque gate formulée comme une DÉMO
(« on voit X marcher »), jamais comme une tâche. Déclare le préfixe de phase. Ré-estime ×2.
Écris M5-phasage/README.md et attends ma validation.
```

### M6 · Plan technique + matrice + plan de test

```text
Lis _kit/TEMPLATE-M6-plan-technique.md, _kit/TEMPLATE-TESTS.md, le CONTRAT-ARCHITECTURE.md du
repo méthode, et les inputs/ du chantier. Pour chaque phase de M5, écris
M6-plan-technique/README.md :
1) réutilisation plateforme (ce qu'on NE code PAS — contrat d'architecture §10) ;
2) briques nouvelles choisies PAR NATURE (arbre V005), jamais par épic ;
3) modèle de données (standard THESOCLE) ;
4) la MATRICE DE COUVERTURE US→épic→phase→brique→tests→gate + colonne Statut/révisé le
   (c'est ICI et seulement ici que vit le mapping ; reporte phase/brique dans us-data.yml et
   relance le générateur pour obtenir le brouillon matrice-couverture.generated.md à fusionner) ;
5) le PLAN DE TEST par phase (_kit/TEMPLATE-TESTS.md) : tagging @US-x/@RG-x/@neg, niveau API par
   défaut (UI réservé aux @pivot), gate en une commande, non-régression — pars des squelettes
   générés dans tests-squelettes/ ;
6) le mapping habilitations → IAM (§3 de _kit/TEMPLATE-HABILITATIONS.md) : rôles métier →
   rôles/scopes manifest.json, mode SSO par route, compte de service.
DoD : chaque US a une ligne AVEC sa colonne Tests remplie ; aucune brique sans US.
```

🔍 **Relecture M6 (requise, session séparée)** : *« lis la matrice verticalement (une ligne par US
du YAML ? compare les listes) puis horizontalement (chaque brique sert-elle une US ?). Vérifie que
rien de ce que le contrat d'architecture fournit n'est re-codé, et qu'aucun ⛔ d'habilitation n'est
sans test négatif. »*

### M7 · Exécution & câblage — puis le code

```text
Lis _kit/TEMPLATE-M7-execution.md. Écris M7-execution/README.md : où va le code (app/module,
repo), les inputs/ rassemblés (slots + versions copiées), les outils Hub/MCP nécessaires
(db_worker, iam, vault, storage, APIM, proxy, install…), la cible d'exécution
(build → registre → déploiement). Crée tracking/<P-0>/ (STATE, JOURNAL, BLOCKERS, DECISIONS,
tasks/). Puis on code la P-0 par incréments atomiques — zéro mock, preuve réelle à la gate
(démo + re-run des gates précédentes).
```

---

## 3. Pendant la réalisation — les boucles de retour (méthode §2)

- **Gate échouée** → *« La gate de <P-x> a échoué : <constat>. Applique METHODE §2.1 : consigne
  dans tracking/<P-x>/BLOCKERS.md, propose-moi redémo / descope / retour M4 ou M6 avec ta
  recommandation, journalise ma décision dans DECISIONS.md. »*
- **Un apprentissage invalide la spec** → §2.2 : entrée datée dans la section **Révisions** de la
  SPEC + ligne de matrice mise à jour (colonne « Statut / révisé le »).
- **US à splitter/abandonner** → §2.3 : jamais de suppression ; `splittée → US-x.1/x.2` (dans le
  YAML puis régénérer) ou `abandonnée` avec raison en M4, ligne barrée dans la matrice.
- **À chaque gate passée** : colonne Statut de la matrice à jour + preuve réelle archivée dans
  `tracking/<P-x>/`.

---

## 4. Resync du kit (quand le canonique évolue)

1. Comparer la `KIT-VERSION` de `_kit/` au [`CHANGELOG.md`](CHANGELOG.md) du repo canonique
   (`github.com/jmlmvi/methode-lmvi`, prendre les tags).
2. Reporter les changements pertinents dans `_kit/` ; toute divergence volontaire = décision M4.
3. Mettre à jour les marqueurs `KIT-VERSION` resyncés.

---

## 5. Les non-négociables (rappel)

**Zéro mock / simulation / régression** (sans dépendance réelle → état honnête `en_attente`) ·
**gate = démo**, pas une coche · **décisions avant plan** (M4 bloquant) · **un artefact = un axe**
(le mapping vit dans la matrice M6) · **réutilisation plateforme** (le contrat d'architecture ne se
redécide pas, il s'hérite) · **relecture requise M1/M4/M6**.
