<!-- KIT-VERSION: 1.8.0 -->
# Méthode AgileIA

AgileIA est une méthode pour construire une application : partir d'un besoin, le clarifier, décider ce
qu'on fait, puis le réaliser par morceaux qu'on peut montrer et livrer au fur et à mesure. Elle est
pensée pour être menée avec un agent IA, qui déroule les étapes et s'arrête pour vous faire trancher
quand une décision vous revient.

Ce n'est pas une méthode « légère » : elle demande d'écrire les choses avant de coder, et de décider
avant de construire. En échange, on sait à tout moment où on en est, et on évite de découvrir trop
tard qu'on a construit la mauvaise chose.

---

## L'idée de fond

Le fil conducteur tient en une phrase :

> **Rien n'est acquis sans une preuve qui vient d'ailleurs que de soi-même.**

Une exigence tient par son test. Une règle métier, par un contre-exemple. Une phase, par une démo qui
marche vraiment. Un document bien tourné qui n'est appuyé sur rien reste une opinion. Tout le reste de
la méthode découle de là. Concrètement, ça donne quelques habitudes simples :

- **On mesure au lieu d'affirmer.** « C'est complet » ne suffit pas : on le montre dans la matrice de couverture.
- **On ne triche pas sur la technique.** Pas de faux résultat quand une dépendance manque : on affiche un état honnête plutôt qu'un vert de façade.
- **On décide avant de construire.** Un doute se pose noir sur blanc, se tranche, et se code ensuite — pas l'inverse.
- **Une étape est validée par une démo réelle**, pas par une case cochée. Et la démo suivante rejoue les précédentes.
- **On ne réécrit pas ce que la plateforme fournit déjà.**
- **Quand le terrain contredit le papier, on met le papier à jour** — daté, sans effacer ce qui a été décidé avant.

---

## Comment ça se déroule : M0 à M7

La méthode avance en huit étapes. Chacune a une entrée, un livrable, et une condition pour passer à la
suivante. On ne saute pas d'étape.

| Étape | Nom | Ce qu'on y fait |
|---|---|---|
| **M0** | Vision | Ce qu'on veut faire, pour qui, avec qui, et jusqu'où. |
| **M1** | Spécification | Le *quoi* : les concepts, les données, les règles de gestion, les droits d'accès, les contraintes (performance, sécurité…). Pas encore le comment. |
| **M2** | User Stories | Les besoins réécrits en petites histoires vérifiables, du point de vue métier. |
| **M3** | Features & Épics | On regroupe ces histoires en features — des capacités qu'on peut démontrer d'un bloc — puis les features par grand sujet : les épics, chacun avec un responsable. |
| **M4** | Arbitrages | On tranche les choix qui structurent la suite, en écrivant *pourquoi*. Tant qu'une décision importante est ouverte, on n'avance pas. |
| **M5** | Découpage en phases | On découpe en phases livrables une par une. Chaque phase se termine par une démo, pas par une liste de tâches. |
| **M6** | Plan technique | Les briques à utiliser, et un tableau qui relie chaque besoin à sa brique, son test et sa démo — pour ne rien oublier et ne rien coder en trop. |
| **M7** | Réalisation | On câble, puis on code, phase après phase. |

C'est en **M4** que se joue le plus gros risque des projets : les décisions repoussées. Ici on les
prend tôt, à froid, plutôt que dans le code sous la pression.

---

## Le rythme : par petits cycles

On ne fait pas tout le développement d'un bloc pour tout recetter à la fin. Chaque phase est un cycle
complet :

1. **Développement** — le code et ses tests, par petits pas.
2. **Recette** — une démo réelle, validée par la personne qui a commandé le travail.
3. **Livraison** — la mise à disposition de ce qui vient d'être montré.

La phase suivante recommence, et vérifie au passage que ce qui marchait avant marche encore. Rien n'est
« fini » sur parole.

---

## Ce qu'on active selon le projet

La conception (les étapes M0→M7) est toujours là. Autour, deux volets s'ajoutent quand le projet le demande :

- **Conformité** — ce qui rend le travail opposable : recette signée, RGPD, risques, avenants, traçabilité.
- **Run** — ce qui fait vivre l'application après la livraison : environnements, exploitation, intégration continue, documentation et formation.

---

## Pourquoi « AgileIA »

- **Agile**, parce qu'on livre par incréments, qu'on valide par la démonstration, et qu'on garde des boucles de retour — la façon de travailler, pas une doctrine.
- **IA**, parce que la méthode est faite pour être conduite par un agent : il déroule les étapes, génère les documents répétitifs, et fait relire le travail par un autre modèle qui joue l'avocat du diable.

Elle sait entrer de deux manières : à partir d'un **besoin exprimé** (quelqu'un décrit ce qu'il veut),
ou à partir d'un **cahier des charges existant** — même long, ou reconstitué depuis un système déjà en
place — qu'elle ingère, ses zones floues devenant les points à arbitrer.
