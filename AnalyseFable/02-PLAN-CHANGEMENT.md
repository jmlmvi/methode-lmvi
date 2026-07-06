# Plan de changement — évolution du kit méthode Besoin2Plan (v1 → v1.1)

> **Source** : [01-ANALYSE.md](01-ANALYSE.md) (défauts D-1…D-7) ·
> **Vérification** : [03-MATRICE-VERIFICATION.md](03-MATRICE-VERIFICATION.md)
>
> Découpage en **change-sets atomiques** (C-x), ordonnés par priorité. Chaque C-x est livrable et
> vérifiable seul. Les lots A/B/C proposent un ordre de réalisation ; aucun C-x ne dépend d'un
> lot ultérieur.

---

## Lot A — Corrections mécaniques (rapides, sans décision à prendre)

### C-1 · Corriger les incohérences de numérotation et de nommage — *répond à D-4*
| Fichier | Action |
|---|---|
| `methode/METHODE-Besoin2Plan.md` §1 | « La chaîne en 6 maillons » → « La chaîne en 8 maillons (M0→M7) » |
| `methode/README.md` | « (M0→M6, 3 axes, …) » → « (M0→M7, 3 axes, …) » |
| `methode/METHODE-Besoin2Plan.md` §M5, `methode/TEMPLATE-M5-phasage.md` | Unifier le nommage des phases sur **une seule convention** — recommandation : `P-x` générique dans le kit, l'instance choisit son préfixe (`PA-x` chez Régie) et le déclare dans M5. Ajouter une ligne « Convention de nommage des phases : `{{préfixe}}` » dans TEMPLATE-M5 |
| `methode/TEMPLATE-US.md` | Aligner `{{PA-x}}` → `{{P-x}}` (ou `{{phase}}`) + tags `"phase/{{P-x}}"` |
| `/opt/2026-TheHub4TheSocle/CLAUDE.md` | Corriger `docs/01-docsV2/` → `docs/docs-socleV005/01-docsV2/` (chemin réel vérifié) |

**DoD** : `grep -rn "6 maillons\|M0→M6" docs/methode-lmvi/` ne retourne rien ; une seule
convention de phase dans le kit ; le chemin CLAUDE.md existe sur disque.

### C-2 · Dé-Régie-iser les templates — *répond à D-3 (partie templates)*
| Fichier | Action |
|---|---|
| `methode/TEMPLATE-US.md` | Remplacer le lien en dur `SPEC-ATELIER-DECOMPOSITION.md#11-…` par un placeholder `{{lien-spec}}` |
| `methode/METHODE-Besoin2Plan.md` | Marquer les règles issues du seul chantier Régie (« P-0 = socle », « ré-estimer × 2 ») d'un badge `⚗️ règle candidate (N=1, à confirmer sur instance 2)` |

**DoD** : `grep -rn "ATELIER-DECOMPOSITION\|APP-16" methode/TEMPLATE-*.md` ne retourne rien ;
les règles candidates sont identifiables d'un coup d'œil.

---

## Lot B — Changements structurels (cœur de l'évolution)

### C-3 · Découpler la fiche US des décisions M5/M6 — *répond à D-1* ⚠️ décision à trancher d'abord

**Option A (recommandée)** — la fiche US ne porte que l'axe métier :
- `TEMPLATE-US.md` : retirer les lignes « Phase » et « Brique (M6) » de la table ; les remplacer
  par un renvoi « Rattachement phase/brique : voir [matrice de couverture](../M6-plan-technique/README.md) ».
- La **matrice M6 devient l'unique source de vérité** du mapping US→phase→brique.
- `gen-fiches-us.py` : `ph=`/`br=` deviennent optionnels ; s'ils sont présents, le script les émet
  dans la matrice M6 (générée), pas dans la fiche US.

**Option B (minimale)** — assumer la double passe :
- Documenter dans METHODE §1 : « M2 se remplit en 2 passes : passe 1 (après M1) = histoire/CA/RG ;
  passe 2 (après M6) = rattachement phase/brique reporté depuis la matrice ».
- Le générateur devient re-runnable en passe 2 sans perdre la passe 1.

**Décision** : à arbitrer (maillon M4 du kit lui-même 🙂) avant d'implémenter.

**DoD** : la chaîne affichée M0→M7 est exécutable dans l'ordre sans information venant d'un
maillon aval, OU la double passe est explicitement documentée.

### C-4 · Définir la boucle de retour — *répond à D-2*
- `methode/METHODE-Besoin2Plan.md` : nouvelle section **« Boucles de retour »** (après §1) :
  1. **Gate échouée** : la phase ne se ferme pas ; consigner dans `tracking/<P-x>/BLOCKERS.md` ;
     décision explicite (redémo / descope / retour M4 ou M6) journalisée dans `DECISIONS.md`.
  2. **Rétro-propagation** : tout apprentissage M7 qui invalide un livrable amont déclenche une
     mise à jour *tracée* (spec M1 : section « Révisions » ; matrice M6 : ligne modifiée avec date).
     La matrice reste source de vérité à tout moment, pas seulement au moment du plan.
  3. **Cycle de vie d'une US** : `à faire → en cours → livrée` + états d'exception
     `splittée (→ US-x.1, US-x.2)`, `abandonnée (raison en M4)`. Jamais de suppression : une US
     abandonnée reste dans la matrice, barrée, avec sa raison.
- `methode/TEMPLATE-US.md` : le champ « Statut » énumère ces états.
- `methode/TEMPLATE-M6-plan-technique.md` : ajouter à la matrice une colonne « Statut / révisé le ».

**DoD** : pour chacun des 3 scénarios (gate KO, spec invalidée, US splittée), la méthode donne une
procédure en ≤ 5 lignes désignant qui met à jour quel fichier.

### C-5 · Externaliser les données du générateur — *répond à D-3 (partie script)*
- `gen-fiches-us.py` : extraire `ROOT`, `EPICS`, `US` vers un fichier de données
  (`us-data.yml` ou `.json`) passé en argument : `python3 gen-fiches-us.py <chemin/us-data.yml>`.
- Fournir `us-data.example.yml` = les données Régie actuelles (elles deviennent l'exemple, plus
  le code).
- Clarifier le contrat écrasement/préservation (D-7) : le script régénère **tout** ce qui est
  entre marqueurs `<!-- gen:start -->…<!-- gen:end -->` et préserve le reste ; ou à défaut,
  documenter clairement « toute fiche US est régénérée intégralement, ne pas éditer à la main ».
- `methode/PROMPT-generer-fiches-US.md` + `methode/README.md` : mettre à jour le mode d'emploi.

**DoD** : lancer le script sur un YAML minimal de 2 US fictives dans un dossier de test produit
2 fiches + 1 fiche épic + index, sans toucher au code Python.

---

## Lot C — Complétude (versionnage, NFR, tests)

### C-6 · Versionner le kit et définir le resync — *répond à D-5*
- Créer `methode/CHANGELOG.md` ; version de départ **1.1.0** (la v1 actuelle = 1.0.0).
- Ajouter en tête de chaque template et de METHODE : `<!-- KIT-VERSION: 1.1.0 -->`.
- `README.md` racine : section **« Resync d'une instance »** (3 étapes : comparer sa
  `KIT-VERSION` au CHANGELOG → reporter les changements pertinents → noter la nouvelle version
  dans l'instance).
- `inputs-corpus/README.md` : chaque `inputs/` d'instance note la version copiée de chaque slot.

**DoD** : `grep -L "KIT-VERSION" methode/TEMPLATE-*.md methode/METHODE-*.md` vide ; le CHANGELOG
liste les change-sets C-1…C-8.

### C-7 · Donner un domicile aux NFR et à la stratégie de test — *répond à D-6*
- `methode/TEMPLATE-M1-spec-besoins.md` : section **« Exigences non fonctionnelles »**
  (volumétrie, latence, coût par run — LLM inclus, rétention, quotas) — avec mention « N/A
  accepté si justifié ».
- `methode/TEMPLATE-M6-plan-technique.md` : ligne **« Stratégie de test »** par phase (quels
  tests automatisés protègent la non-régression des gates précédentes ; quels CA sont couverts
  par test vs par démo manuelle).
- `methode/TEMPLATE-M7-execution.md` §4 : la preuve de gate inclut « les gates précédentes
  re-vérifiées » (re-démo rapide ou suite de tests).
- `methode/METHODE-Besoin2Plan.md` §M5 : expliciter le statut de l'estimation : « pas de sizing
  formel en contexte solo+agents ; la règle ×2 est le seul mécanisme, assumé ».

**DoD** : les templates M1/M6/M7 contiennent les nouvelles sections ; la checklist express (§6
de METHODE) est mise à jour en conséquence.

### C-8 · Points mineurs restants — *répond à D-7*
- `methode/METHODE-Besoin2Plan.md` §5 : règle de choix Besoin2Plan vs FromSpec2Plan en 3
  questions fermées (Le domaine est-il déjà cadré ? Vend-on une spec contractuelle ? Le
  périmètre dépasse-t-il ~1 app ?) avec orientation par réponse.
- `methode/METHODE-Besoin2Plan.md` §M3 + `TEMPLATE-M3-epics.md` : règle US transverse — un seul
  épic *propriétaire*, épics secondaires possibles via tags `epic/x` (frontmatter), la matrice ne
  compte que le propriétaire.
- Clarté des rôles : dans M0, définir `{{commanditaire}}` et `{{relecteur}}` (en solo :
  commanditaire = soi ; relecteur = un agent IA en revue adversariale, à défaut d'un tiers
  humain). La relecture par maillon devient **requise** pour M1, M4, M6 (les maillons porteurs
  de décisions).

**DoD** : les 3 points sont écrits ; la checklist express reflète la relecture requise M1/M4/M6.

---

## Ordre d'exécution et effort

| Lot | Change-sets | Effort estimé | Risque |
|---|---|---|---|
| A | C-1, C-2 | ~30 min | Nul (mécanique) |
| B | C-3 (après arbitrage A/B), C-4, C-5 | ~2-3 h | Moyen — C-3 modifie le contrat des fiches ; l'instance Régie vendorée n'est PAS migrée (elle resync à son rythme, cf. C-6) |
| C | C-6, C-7, C-8 | ~1-2 h | Faible |

**Règle de livraison** (cohérente avec la méthode elle-même) : 1 change-set = 1 commit ; la gate
du plan = la [matrice de vérification](03-MATRICE-VERIFICATION.md) entièrement verte, preuve à
l'appui (sorties `grep` / exécution du script de test).

**Point d'arbitrage bloquant avant lot B** : choix Option A vs Option B du C-3.
→ **Tranché le 2026-07-06 (commanditaire) : Option A.** Plan exécuté intégralement le même jour —
statuts et preuves dans la [matrice de vérification](03-MATRICE-VERIFICATION.md).
