<!-- KIT-VERSION: 1.11.2 -->
# Slot · TheSocleHub — catalogue de services (APIs & agents)

- **Source canonique** : `docs/02-DocHub/use-cases/` (45 guides, index `00-index.md`) ; copie
  livrée avec le squelette : `APP-ZZ-TEMPLATE/docs/services-disponibles/` — c'est elle que lit
  `controle-avant-go.sh`. À défaut, le MCP du Hub.
- **Table « besoin → guide »** des 45 guides : [`conception/CATALOGUE-SERVICES.md`](../../conception/CATALOGUE-SERVICES.md)
  (dans `conception/` pour voyager avec le kit vendoré et la skill).
- **Instancier** : lister les services utilisés par l'app et leurs actions MCP ; n'en recoder aucun.
  Chaque brique de M6 qui consomme un service cite son guide (`howto-NN`) dans la table de routage
  (§3 bis de `TEMPLATE-M6-plan-technique.md`).
