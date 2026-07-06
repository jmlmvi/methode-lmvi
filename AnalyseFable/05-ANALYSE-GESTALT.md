# Analyse Gestalt — la méthode comme un tout (kit v1.6.0)

> **Date** : 2026-07-06 · **Objet** : non plus les défauts de détail (passes 1 et 2, D-1…D-21,
> tous traités) mais **la forme d'ensemble** : ce que la méthode est devenue, les tensions qui
> émergent du tout, et ce que le processus de construction lui-même révèle. Autocritique incluse.

---

## 1. Ce que le tout est devenu (le constat de forme)

La v1.0 se définissait « **méthode légère, orientée produit** ». La v1.6.0, prise comme un tout,
est autre chose : **un système de gouvernance de chantier complet** — 3 piliers, ~25 templates,
générateur, pilote, RGPD, PV, SLA, CI, audit trail, avenants. Chaque pièce est individuellement
légère (40–50 lignes) ; **le tout ne l'est plus**. Un chantier client « piliers complets » produit
une vingtaine d'artefacts autour du code.

Ce n'est pas un échec — c'est ce qu'exige le contexte client. Mais deux conséquences ne sont pas
assumées par les textes :
- Le **positionnement §6** (« Besoin2Plan léger vs FromSpec2Plan lourd ») est érodé : Besoin2Plan
  full-piliers *est* lourd. La frontière entre les deux méthodes redevient floue.
- Il n'existe **aucun mode express** : même en solo, le minimum est tout `conception/`. La méthode
  ne sait pas répondre à « c'est une feature de 3 jours » autrement que par elle-même tout entière.
  La règle de choix compare Besoin2Plan à FromSpec2Plan, jamais à « ne pas dérouler de méthode ».

## 2. L'inversion épistémologique (la critique la plus sérieuse)

La légitimité de la v1.0 tenait en un mot : **distillée**. Chaque règle venait d'un chantier réel
(Régie). La v1.6.0 inverse le ratio : sur ~25 templates, **~5 ont déjà été joués en vrai** ; les
piliers conformité et run sont de la **spéculation bien raisonnée encodée en templates** — écrits
en quelques heures, jamais instanciés, même à blanc. Le marqueur ⚗️ « règle candidate » existe…
et n'a été appliqué qu'à deux règles, alors que par son propre critère, des piliers entiers
devraient le porter.

Pire : la méthode interdit le mock dans le code, mais son kit contient des **mocks
méthodologiques** — des templates qui sont des interfaces sans implémentation. Et la discipline de
preuve du kit lui-même s'est **dégradée en cours de route** : la v1.1 a été fermée par une gate
réelle (mini-chantier fictif M0→M6, matrice de vérification, preuves P-1…P-10) ; les v1.4→v1.6 ont
été livrées sur relecture seule. Nous sommes allés de plus en plus vite et de moins en moins
prouvé — exactement la dérive que la méthode combat chez les autres.

## 3. Le public déclaré s'est élargi, le public opérationnel s'est rétréci

La journée a « dé-solo-isé » les textes (casting, rôles, estimation paramétrable) pour viser les
clients. Mais **tous les mécanismes opérationnels supposent un agent LLM compétent aux commandes** :
PROMPT-PILOTE, relectures adversariales par agent, générateur YAML, squelettes Gherkin. Une équipe
cliente sans Claude Code (ou équivalent) ne peut pas *opérer* cette méthode — elle ne peut que la
subir en lisant les templates. Tension de fond : la figure (système qualité livrable à un client)
ne correspond pas au fond (un workflow interne LMVI+IA). À trancher un jour : la méthode est-elle
un **produit** (alors il faut un mode d'emploi sans agent) ou un **avantage compétitif interne**
(alors on assume, et le client reçoit les artefacts, pas la méthode) ?

## 4. Le centre de gravité a glissé de la pensée vers le processus

L'âme de la v1.0, ce sont **trois idées profondes** : les 3 axes orthogonaux (« un artefact = un
axe »), la matrice comme unique lieu de mapping, gate = démo. Tout le reste de la journée a ajouté
de la **conformité de processus** (qui signe quoi, quand). Le risque Gestalt : la couche checklist
enterre la couche pensée. Un nouveau venu rencontre 25 templates avant de rencontrer l'idée qui
justifie tout. Il manque une **hiérarchie intellectuelle explicite** : ESSENTIEL (les 3 idées) /
STRUCTURANT (chaîne, piliers) / OUTILLAGE (templates, générateur) — et un ordre de lecture qui la
respecte.

## 5. Versionite et l'illusion du resync

**8 tags en une journée.** Le semver est là, la procédure de resync est écrite… et l'unique
instance réelle (Régie, v1.0.0) a pris 6 versions de retard **en un jour**. Prédiction honnête :
au rythme actuel du canonique, **aucune instance ne resyncera jamais** — elles forkeront. Deux
sorties cohérentes : (a) **caler la cadence du canonique sur les chantiers réels** — une version
par post-mortem de chantier, pas une version par conversation ; ou (b) assumer le fork-and-forget
et retirer la promesse de resync. L'option (a) est la bonne : elle re-synchronise la méthode avec
sa propre épistémologie (distiller, pas inventer).

## 6. Qui garde les gardiens

La méthode s'auto-vérifie beaucoup (relectures adversariales, DoD, matrices) — mais **tous les
vérificateurs sont de la même famille cognitive** que le producteur (le même modèle, dans une
autre session). La journée l'a prouvé empiriquement : les manques majeurs (tests, RG,
habilitations) ont été vus par **JM**, pas par mes relectures. Le seul relecteur réellement
hors-distribution du système, c'est le commanditaire humain. Pour les chantiers clients, la règle
devrait être : le relecteur de M1/M4/M6 est **différent en nature** (un humain métier, un autre
modèle, un expert externe) — pas seulement en session.

## 7. Ce que le tout a de fort (à protéger absolument)

En cherchant la forme d'ensemble, une **unité réelle** apparaît, jamais nommée dans les textes :

> **Tout artefact doit être prouvé par quelque chose d'extérieur à lui.**
> L'US par son test d'acceptation · la RG par son contre-exemple · la matrice par ses deux
> lectures · la phase par sa démo · le backup par sa restauration · la doc par sa rejouabilité ·
> la spec par un relecteur qui ne l'a pas écrite.

C'est LE principe unificateur de la méthode — sa vraie Gestalt. Il mérite d'être écrit en tête de
METHODE §0, au-dessus même des 3 axes : les 3 axes disent comment *ranger*, ce principe dit
comment *croire*. Le squelette (3 idées + boucles de retour + piliers) est bon ; l'entrée
(USAGE + PILOTE) est bonne ; la structure a donné une forme au sprawl. Rien de ce qui précède ne
remet cela en cause.

## 8. Ce qui manque encore au niveau du tout

- **Un seuil d'entrée** : quand ne PAS dérouler la méthode (feature triviale, spike, urgence
  incident). Sans lui, la méthode sera contournée en silence — ce qui la tuera plus sûrement
  qu'une critique.
- **Un critère d'arrêt projet** : les gates savent échouer, la méthode ne sait pas *abandonner*
  un chantier (kill criterion, sunk cost). C'est une décision M4 permanente qui n'est écrite
  nulle part.
- **L'économie de la méthode elle-même** : combien coûte le déroulé (temps commanditaire, tokens,
  délais de relecture) rapporté à la taille du projet — à mesurer sur le prochain chantier réel,
  pas à estimer.

## 9. Recommandations (v1.7 candidate — à décider APRÈS un chantier réel)

1. **Nommer le principe unificateur** (preuve externe) en tête de METHODE §0. *(seul changement
   documentaire qui mériterait de ne pas attendre)*
2. **Profils d'activation** : `express` (M0 + M1-mini + M5 + matrice M6 — retrouver la légèreté
   comme mode de premier rang, avec seuil d'entrée) / `solo` (conception) / `client` (3 piliers).
3. **Gate du kit** : aucun template ne se livre sans avoir été instancié au moins à blanc
   (s'appliquer sa propre médecine — les piliers conformité/run le doivent encore).
4. **Cadence** : geler le canonique ; une version par **post-mortem de chantier réel**. Le
   prochain chantier (avec PILOTE + piliers) est le vrai test de la v1.6.0 — c'est lui qui dira
   ce qui est ⚗️ et ce qui est prouvé.
5. **Relecteur hors-famille** pour M1/M4/M6 en contexte client (humain métier ou autre modèle).

---

*Méta : cette analyse est elle aussi produite par le même agent qui a construit le kit — elle vaut
comme introspection structurée, pas comme revue indépendante. La revue indépendante, c'est le
prochain chantier réel qui la fera.*
