---
id: UC-DOM-02
titre: "Séparer les couches de l'application"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "models, selectors, mutators, exchanges, services, interface"
---

# UC-DOM-02 — Séparer les couches de l'application

## Questions auxquelles répond ce cas d'usage
1. Quelles couches exige la convention, et dans quel ordre se dépendent-elles ?
2. Où va une règle de gestion, et où va une requête ?
3. Puis-je créer mes propres noms de dossiers, ou les noms sont-ils imposés ?
4. Quelle couche a le droit de toucher l'accès aux données de l'ORM ?
5. Comment cette séparation est-elle vérifiée autrement qu'à la relecture ?
6. Un worker peut-il appeler un sélecteur directement ?
7. Que gagne-t-on concrètement, au-delà du rangement ?

## Mots-clés
couches, architecture en couches, `models/`, `selectors/`, `mutators/`, `exchanges/`,
`services/`, `workers/`, interface, domaine, accès aux données, sens des dépendances,
un seul appel au service, revue de code, C06, C07, C08

## Ce que c'est, et quand s'en servir
La convention du commanditaire impose un sens de lecture, de bas en haut : **données** (modèles),
**accès aux données** (lecture et écriture, les seules couches qui touchent l'ORM), **domaine**
(les règles), **interface** (le worker ou la vue, qui traduit). Les échanges (UC-DOM-03) circulent
entre interface et domaine.

Les noms de dossiers ne sont pas libres : la revue de code déduit la couche du chemin. Un dossier
appelé autrement n'est plus contrôlé — on perd la vérification en même temps que la lisibilité.

Ce qu'on y gagne est très concret : les règles se testent sans base ni serveur, l'accès aux données
se change sans toucher aux règles, et une relecture sait où chercher.

## Ce que le socle fait · ce qu'il interdit
Le socle n'impose pas les couches techniquement — c'est la revue de code qui le fait, et le projet
généré qui en livre un exemplaire complet. Les contrôles portent sur le sens des dépendances (une
couche basse n'importe pas une couche haute), sur l'accès à l'ORM réservé aux couches d'accès, et
sur l'absence de règle dans l'interface.

Interdit : un worker qui lit un modèle, un service qui lit la configuration ou l'horloge
(UC-DOM-05), un sélecteur qui décide, un modèle qui appelle un service.

## Exemples
### L'arborescence
```
src/mon_app/orders/
├── models/              données : champs, Meta, contraintes, fabriques
├── selectors/           accès en lecture  ─┐ seules couches à toucher
├── mutators/            accès en écriture ─┘ Model.objects
├── exchanges/           ce qui franchit interface ↔ domaine (immuable)
├── services/            les règles de gestion, et elles seules
└── migrations/
src/mon_app/workers/orders_worker.py     interface : traduire, un appel, traduire
```

### Le trajet d'un appel
```python
# interface : traduit, appelle UNE fois, traduit
request = exchanges.OrderRequest(reference=params["reference"], amount_cents=params["amount_cents"])
view = self.techdb.run(lambda: services.OrderService.create_order(
    tenant_context=ctx, request=request, limits=self.limits))
return ActionResult.ok(view.as_json())
```
```python
# domaine : décide, et délègue l'accès aux données
if request.amount_cents > limits.max_amount_cents:
    raise OrderRuleViolation("AMOUNT_ABOVE_LIMIT", f"Montant {request.amount_cents} au-dessus…")
order = mutators.OrderMutator.create(tenant_context=tenant_context, reference=request.reference,
                                     amount_cents=request.amount_cents)
```

### Socle Java
Même découpage : modèles, sélecteurs/mutateurs, services, puis vues et workers. Les conventions
sont communes aux deux langages.

## Pièges courants
- **Renommer les dossiers** : la revue ne reconnaît plus la couche, et les règles cessent de
  s'appliquer sans que rien ne le dise.
- **Un « petit `if` métier » dans l'action** : c'est le début de la dispersion des règles.
- **Un service qui construit une réponse JSON** : la forme de sortie appartient à l'interface, via
  un échange.
- **Un sélecteur qui filtre selon une règle** (« les commandes valides ») : la définition de
  « valide » est une règle, donc du domaine.
- **Tout mettre dans le service** : si un service dépasse quelques centaines de lignes, c'est que
  plusieurs domaines s'y cachent.

## Cas d'usage voisins
- UC-DOM-03 — échanges immuables
- UC-DOM-04 — porter les règles de gestion dans un service
- UC-DEV-04 — contrôler son code contre les conventions
- UC-ACT-01 — déclarer une action
