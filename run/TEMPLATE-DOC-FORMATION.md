<!-- KIT-VERSION: 1.6.0 -->
<!-- PROUVE-SUR: — -->
# Documentation utilisateur & formation — {{nom du chantier}}

> Template du **volet doc & formation** (pilier run). Principe : **la doc se livre avec la gate**
> — une ligne dans la matrice de couverture par phase — sinon elle n'existera jamais. La formation
> client se cale sur les recettes.

## 1. La doc par phase (raccroché à la matrice M6)
| Phase | Capacités livrées | Doc due à la gate | Forme | État |
|---|---|---|---|---|
| {{P-1}} | {{US couvertes}} | {{guide « {{parcours}} » mis à jour}} | {{markdown / aide in-app}} | à faire |

**Source d'écriture** : les fiches US (histoire + CA) et les parcours maquettés — la doc raconte
les parcours validés, elle ne s'invente pas. Un agent IA la rédige bien à partir de ces artefacts ;
le recetteur la relit pendant la recette (si la doc ne permet pas de rejouer la démo, elle est fausse).

## 2. Organisation de la doc
- **Par rôle métier** (reprendre les rôles de la matrice d'habilitations — chacun ne lit que ce
  qu'il peut faire) : {{guide metteur en scène, guide admin…}}.
- Où elle vit : {{storage S3 + lien in-app / page d'aide de l'app}} ; versionnée avec l'app
  (une version d'app = sa doc).

## 3. Formation (contexte client)
| Session | Public (rôle) | Quand | Support | Fait le |
|---|---|---|---|---|
| {{1}} | {{utilisateurs — rôle X}} | à la recette de {{P-x}} (l'env de recette sert de bac à sable) | doc + démo | |
| {{2}} | {{admin tenant}} | avant la mise en prod | dossier d'exploitation §5 + doc admin | |

## 4. Support post-livraison
Canal : {{mail/canal dédié}} · qui répond : {{…}} · les questions récurrentes alimentent la doc
(une question posée deux fois = un paragraphe manquant) et, si c'est un manque produit, une fiche
`conformite/TEMPLATE-AVENANT.md`.

## 5. Definition of Done
- [ ] Chaque phase a sa ligne « doc due » (et la gate la vérifie)
- [ ] Doc organisée par rôle métier, versionnée avec l'app
- [ ] Formations planifiées sur le calendrier des recettes (client)
- [ ] Boucle support → doc en place
