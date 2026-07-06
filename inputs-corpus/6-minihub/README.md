# Slot · MiniHub (déploiement distribué)

- **Source canonique** : doc minihub + mémoires `reference_minihub_*`
- **Ce que l'app y prend** : Voie gérée (apps_local, tunnel gRPC sortant, IP jamais exposée), install/update distribué, pièges (REFERENCE no-op → SSH recreate).
- **Instancier** : Noter la cible (quel minihub), la procédure build→registre→install, et le piège d'update.

> Générique — pour une app, copier ici (dans son `inputs/`) les fichiers de référence nécessaires.
