[0m
> build · MiniMax-M3
[0m
</think>
[0m$ [0mls /opt/2026-TheHub4TheSocle/docs/methode-lmvi/
AnalyseFable
CHANGELOG.md
CONTRAT-ARCHITECTURE.md
ESSENTIEL.md
ExempleCdc.md
README.md
USAGE.md
conception
conformite
inputs-corpus
run
[0m
[0m→ [0mRead ESSENTIEL.md
**Philosophie en 3 phrases :**
La méthode exige que tout artefact soit prouvé par un élément qui lui est extérieur (test, contre-exemple, démo, restauration, rejouabilité, relecteur indépendant) et que son éventuelle mise à jour reste tracée. Elle range tout le travail le long de trois axes orthogonaux (Métier, Technique, Livraison) qui ne se croisent qu'en un seul point — la matrice de couverture — où chaque promesse est reliée à sa brique, son test et sa démo. Enfin, elle impose de trancher les décisions structurantes avant de coder, de livrer en mini-cycles se concluant par une démo réelle (jamais une checklist) et de refuser toute forme d'état inventé, y compris en n'appliquant la méthode qu'à ce qui en a réellement besoin.

---

**Liste de défauts priorisée**

**P0 — Bloquants (la page ne permet pas de l'appliquer)**
1. **« Phase » et « gate » sont les briques du §4 mais ne sont ni définies ni bornées ici.** Qu'est-ce qui ouvre/ferme une phase ? Quel artefact matérialise la gate au-delà de « une démo réelle » ?
2. **`[À ARBITRER]` n'a aucune règle de sortie.** Qui tranche, selon quel critère, sous quel délai ? Le slogan « jamais enfoui » est inopérant sans cela.
3. **Contradiction interne §1 ↔ §4.** §1 exige une preuve extérieure par artefact ; §4 autorise « le papier se met à jour, tracé » quand le réel contredit. Une preuve qui évolue n'est plus une preuve : aucune règle ne dit quand la nouvelle preuve invalide rétroactivement l'ancienne.
4. **Contradiction §2 ↔ matrice de couverture.** « On ne les mélange jamais » sauf à la matrice — mais la matrice n'est pas définie : qui la tient, à quel rythme, et comment vérifier que la pureté d'axe n'y est pas violée ?
5. **« Rejouabilité » d'une doc non définie.** Une doc rejouable n'est pas une doc valide ; la confusion entre reproductibilité et preuve n'est pas levée.
6. **« Mini-cycle complet » — quel est le critère de complétude ?** Sinon chaque équipe déclarera « complet » à son seuil d'épuisement.

**P1 — Importants (rendent la méthode inapplicable sans compléments externes)**
7. **Aucun rôle défini.** Qui est « le relecteur qui ne l'a pas écrit » ? Qui est le décideur des bloquants ? Qui arrête un chantier ? (La phrase « qui sait arrêter un chantier proprement » est creuse sans ce rôle.)
8. **« Honnêteté technique » liste des interdits mais ignore les exceptions réelles** (stubs d'environnement, contract tests en double, fakes d'API externes). Aucun distinguo n'est posé.
9. **Pas de seuil d'entrée dans la méthode.** §5 dit de ne pas l'appliquer « à ce qui n'en a pas besoin », mais aucun critère de besoin n'est donné — un tiers ne sait pas s'il doit ou non la déployer.
10. **La matrice de couverture ignore la capacité et le temps.** §3 parle de « décisions structurantes » mais capacité/charge n'apparaît ni comme axe, ni dans la matrice.
11. **Aucun « done » par phase.** Sans définition de sortie, les gates deviennent déclaratives.

**P2 — Style creux ou affirmations invérifiables**
12. **« Ce qui n'a pas de preuve externe est une opinion bien formatée »** — slogan rhétorique ; aucun seuil de preuve n'est défini (une review interne compte-t-elle ? un test unitaire du dev lui-même ?).
13. **« La méthode elle-même par ses chantiers réels »** — boucle d'auto-validation circulaire : on prouve la méthode par ce qu'elle produit, sans règle de réfutation possible.
14. **« Tranché »** — verbe d'autorité sans sujet ; confondu avec « argumenté ».
15. **Le §2 décrit la structure de la matrice mais pas sa règle de mise à jour** — risque que la matrice devienne elle-même le « tunnel » que la méthode interdit.

**Verdict** : La page est un manifeste lisible mais pas un mode d'emploi. Un tiers ne peut pas démarrer sans avoir lu au minimum `USAGE.md` + `conception/METHODE-Besoin2Plan.md` ; elle-même le concède implicitement en fin de document. Tant que les points P0 ne sont pas intégrés (définitions in-page de phase, gate, `[À ARBITRER]`, complétude, règle de mise à jour d'une preuve), la promesse « en une page » n'est pas tenue.
