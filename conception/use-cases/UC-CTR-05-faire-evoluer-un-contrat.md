---
id: UC-CTR-05
titre: "Faire évoluer un contrat dans les trois moteurs"
theme: "UC-CTR · Contrats et conformité"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "évolution de contrat, livraison coordonnée, version, rétrocompatibilité"
---

# UC-CTR-05 — Faire évoluer un contrat dans les trois moteurs

## Questions auxquelles répond ce cas d'usage
1. J'ai besoin d'un nouveau champ dans une réponse : quelle est la procédure ?
2. Peut-on livrer l'évolution dans un seul moteur d'abord ?
3. Comment ajouter sans casser les clients existants ?
4. Quand faut-il incrémenter la version de contrat ?
5. Comment retirer un champ ou une route devenue inutile ?
6. Qui arbitre une évolution de contrat ?
7. Qu'est-ce qui, au contraire, ne touche pas au contrat ?

## Mots-clés
évolution de contrat, livraison coordonnée, trois implémentations, ajout,
retrait, dépréciation, rétrocompatibilité, version, arbitrage, note de version,
clients existants, suite de conformité, migration

## Ce que c'est, et quand s'en servir
Toute modification du **comportement observable** — une route, un champ, un format, une clé de
configuration, un sujet du bus, une table technique — est une évolution de contrat. Elle se décide,
puis se livre dans les trois moteurs.

Ce qui n'y touche pas : une correction interne, un gain de performance, un refactoring, un
changement de bibliothèque — tant que ce qui sort est identique.

## Ce que le socle fait · ce qu'il interdit
La règle du chantier est explicite : routes, formats JSON, tables techniques et clés ne changent pas
sans évolution du contrat **livrée dans les trois implémentations**. La suite de conformité est ce
qui rend la règle effective — elle échoue tant qu'une implémentation n'a pas suivi.

La manière de procéder compte autant que la règle. **Ajouter** est presque toujours
rétrocompatible : un champ nouveau ne gêne pas un client qui l'ignore. **Retirer** ne l'est jamais :
il faut déprécier, annoncer, attendre, puis retirer. Et un retrait se documente dans une note de
version — on l'a vu avec la fermeture par défaut des surfaces (UC-SEC-07), qui a cassé des appelants
qui profitaient de routes ouvertes : le changement était souhaitable, et il a demandé une note
explicite.

## Exemples
### Ajouter un champ — rétrocompatible
```json
// avant
{"success": true, "data": {"id": 1, "reference": "C-1"}}
// après : un client qui ignore le champ nouveau continue de fonctionner
{"success": true, "data": {"id": 1, "reference": "C-1", "currency": "EUR"}}
```

### Retirer — jamais d'un coup
```python
@action("old_export", description="Export historique", deprecated=True,
        deprecation_message="Utilisez export_orders depuis la 5.9")
```

### La procédure
```
1. écrire l'évolution dans contracts/ (et incrémenter VERSION si le comportement change)
2. compléter la suite de conformité : elle doit échouer avant la livraison
3. livrer dans les trois moteurs
4. jouer la gate : 72/72 (ou le nouveau total) contre chaque implémentation
5. note de version, surtout si le changement casse quelque chose
```

## Pièges courants
- **Livrer dans un seul moteur** : la conformité devient rouge, et le parc divergent.
- **Retirer sans déprécier** : des clients cassent sans préavis.
- **Oublier la suite de conformité** : l'évolution n'est vérifiée par rien.
- **Changer un format « compatible »** sans le penser : un champ renommé n'est pas un ajout.
- **Pas de note de version** pour un changement qui casse : les exploitants découvrent en
  production.

## Cas d'usage voisins
- UC-CTR-01 — écrire un contrat hors du code
- UC-CTR-03 — annoncer sa version de contrat
- UC-CTR-04 — faire échouer la CI sur une régression
- UC-CFG-02 — partager les mêmes clés entre les moteurs
