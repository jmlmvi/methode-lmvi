---
id: UC-CTR-06
titre: "Vérifier qu'un backend est indiscernable d'un autre"
theme: "UC-CTR · Contrats et conformité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "indiscernabilité, Gateway, clients, suite croisée, périmètre porté"
---

# UC-CTR-06 — Vérifier qu'un backend est indiscernable d'un autre

## Questions auxquelles répond ce cas d'usage
1. Que signifie « indiscernable » dans ce chantier, et jusqu'où va la promesse ?
2. Un client écrit pour un backend Java fonctionne-t-il contre un backend Python ?
3. Sur quoi porte l'indiscernabilité — et sur quoi ne porte-t-elle pas ?
4. Comment le vérifier autrement qu'en croyant la documentation ?
5. Que faire quand on découvre une différence de comportement ?
6. Les performances font-elles partie de la promesse ?

## Mots-clés
indiscernable, équivalence, Gateway, clients, outils, suite croisée,
périmètre porté, hors périmètre, différence de comportement, écart,
performance, formats, codes d'erreur, 401, tenant

## Ce que c'est, et quand s'en servir
La promesse du chantier : **pour le périmètre porté**, un backend Python doit être indiscernable
d'un backend Java vu de l'extérieur — pour la Gateway, pour un frontend, pour un client MCP, pour
les outils de la base technique.

La limite est aussi claire : l'indiscernabilité ne porte que sur le périmètre porté. Un backend
Python ne fait pas de pipelines, de gRPC ni de JDM — ces fonctions sont absentes, pas différentes.

## Ce que le socle fait · ce qu'il interdit
Ce sont la suite de conformité (UC-CTR-02) et les contrats (UC-CTR-01) qui portent la vérification.
Les performances **ne font pas partie** de la promesse : les moteurs n'ont pas les mêmes
caractéristiques, et le contrat porte sur le comportement observable, pas sur le temps de réponse.

Quand une différence apparaît, l'ordre des opérations compte : la reproduire, décider lequel des
deux comportements est le bon, puis corriger **et** compléter la suite pour que le cas soit tenu.
Corriger sans ajouter le test revient à attendre la prochaine occurrence.

## Exemples
### Le même client, contre deux moteurs
```bash
for port in 18080 18282; do          # Java, puis Python/Django
  curl -s -o /dev/null -w "$port %{http_code}\n" localhost:$port/health/ready
  curl -s -H "X-Admin-Key: $KEY" localhost:$port/admin/workers | jq -S 'keys'
done
```

### Ce qui doit être identique
```
routes et codes HTTP · champs des réponses · codes de refus · comportement sans titre d'accès (401)
clés de configuration · sujets du bus · schéma techdb_* · noms des outils MCP
```

### Ce qui peut légitimement différer
```
temps de réponse · structure interne · bibliothèques · format des journaux internes
fonctions hors périmètre (pipelines, gRPC, JDM, Kafka…)
```

## Pièges courants
- **Attendre l'équivalence hors périmètre** : certaines fonctions n'existent pas, et c'est écrit.
- **Comparer les performances** comme un critère de conformité : ce n'est pas la promesse.
- **Corriger un écart sans ajouter de test** : il reviendra.
- **Supposer l'équivalence sans la jouer** : la suite existe pour ça.
- **Diverger « temporairement »** : une divergence non tenue par un test devient définitive.

## Cas d'usage voisins
- UC-CTR-02 — jouer la suite de conformité croisée
- UC-CTR-01 — écrire un contrat hors du code
- UC-INT-06 — s'insérer derrière la Gateway
- UC-CTR-05 — faire évoluer un contrat dans les trois moteurs
