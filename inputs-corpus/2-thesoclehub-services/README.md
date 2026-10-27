<!-- KIT-VERSION: 1.11.0 -->
# Slot · TheSocleHub — catalogue de services (APIs & agents)

- **Source canonique** : `APP-ZZ-TEMPLATE/docs/services-disponibles/` (43 guides, index
  `00-index.md`), copie de `docs/02-DocHub/use-cases/` ; à défaut, le MCP du Hub
- **Ce que l'app y prend** : Le catalogue des services Hub réutilisables : `iam`, `vault`, `storage (S3)`, `mail (James)`, `clamav`, `backup`, `apim`, `agentia`, `proxy`, `dns`, `acme`, `signature`, `tsa`, `nats`, `cache`, `cosmo`, `onlyoffice`, `status/techdb`.
- **Instancier** : Lister les services utilisés par l'app + leurs actions MCP ; ne recoder aucun.
  Chaque brique de M6 qui consomme un service cite son guide (`howto-NN`) dans la table de routage.

> Générique — pour une app, copier ici (dans son `inputs/`) les fichiers de référence nécessaires.
