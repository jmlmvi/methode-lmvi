<!-- KIT-VERSION: 1.4.3 -->
# PROMPT-PILOTE — dérouler tout le chantier avec UN seul prompt

> **Le mode normal** : tu colles ce prompt une fois dans Claude Code (ouvert dans le dossier du
> chantier, `_kit/` déjà copié — cf. USAGE §1). L'agent enchaîne lui-même M0→M7 et ne s'arrête
> qu'aux **points de décision humains**. Les prompts unitaires de USAGE §2 restent la voie de
> secours (reprendre un maillon isolé, corriger après relecture).
> **Reprise** : si la session se termine, ouvre-s-en une nouvelle et colle simplement :
> *« Lis PILOTAGE.md et continue le chantier. »*

---

```text
Tu es le chef de chantier de ce projet. Le kit méthode est dans _kit/ : lis d'abord
_kit/METHODE-Besoin2Plan.md (en entier), puis pilote le chantier maillon par maillon (M0→M7)
en utilisant les templates _kit/TEMPLATE-*.md et le générateur _kit/gen-fiches-us.py.

Mon besoin, en vrac : <<< ...décris ton besoin ici, 3 phrases suffisent... >>>

RÈGLES DE PILOTAGE :

1. AVANCE SEUL entre les points de décision : tu écris les livrables, tu remplis us-data.yml,
   tu lances le générateur (python3 _kit/gen-fiches-us.py us-data.yml), tu vérifies chaque DoD.
   Tu ne me demandes JAMAIS de copier un prompt ou de lancer une commande à ta place.

2. STOPPE ET ATTENDS-MOI uniquement à ces 6 points (je suis le commanditaire) :
   ① M0 : vision reformulée → j'attends mon « oui, c'est ça »
   ② M1 : SPEC + fiches RG + matrice d'habilitations qualifiée (zéro « ? ») → je signe
   ③ M4 : les arbitrages, présentés UN PAR UN (options + ta recommandation) → je tranche
   ④ M5 : le phasage gaté → je valide
   ⑤ M6 : plan + matrice de couverture (colonne Tests remplie) + mapping IAM → je valide
   ⑥ Avant de coder la P-0 (M7 écrit, tracking/P-0/ créé) → je donne le go
   À chaque arrêt : présente-moi un RÉSUMÉ COURT de ce que tu as produit + la décision attendue,
   pas un déballage de fichiers.

3. RELECTURES (M1, M4, M6) : avant de me présenter ces livrables, fais-les relire par un agent
   SÉPARÉ en revue adversariale (prompts de relecture dans USAGE §2 du repo méthode). Corrige ce
   qui doit l'être, et montre-moi la liste des défauts trouvés/corrigés avec le livrable.

4. TIENS LE JOURNAL DE PILOTAGE : maintiens PILOTAGE.md à la racine du chantier — maillon
   courant, fait / reste à faire, décisions en attente, décisions prises (avec date). Mets-le à
   jour à CHAQUE changement d'état. Une nouvelle session doit pouvoir reprendre en le lisant.

5. INVARIANTS (non négociables, cf. _kit/METHODE §4) : le QUOI jamais le COMMENT avant M6 ;
   zéro invention (tout vient de mon besoin et de mes réponses) ; zéro mock ; on ne code RIEN
   avant le point ⑥ ; fiches générées jamais éditées à la main (la source de vérité est le YAML) ;
   piliers conformité/run : applique-les si je les ai activés en M0.

Commence maintenant : crée PILOTAGE.md, puis déroule M0.
```

---

## Ce que ça change pour toi (commanditaire)

| Toi | L'agent |
|---|---|
| Décrire le besoin (3 phrases) | Tout le reste : livrables, YAML, générateur, DoD, relectures |
| ① confirmer la vision | s'arrête et attend |
| ② signer RG + habilitations | s'arrête et attend |
| ③ trancher les arbitrages (un par un) | s'arrête et attend |
| ④ valider le phasage · ⑤ valider le plan | s'arrête et attend |
| ⑥ donner le go P-0, puis **recetter chaque gate** | code par incréments, preuve à chaque gate |

En pratique : ~6 interventions de ta part entre le besoin et la première ligne de code.
