---
id: UC-DOM-08
titre: "Générer et appliquer les migrations d'une application métier"
theme: "UC-DOM · Domaine applicatif et couches"
moteurs:
  java: na
  socle-py: na
  socle-py-django: ok
contrat: "5.9"
mecanismes: "socle.manage makemigrations, installed-apps, application au démarrage"
---

# UC-DOM-08 — Générer et appliquer les migrations d'une application métier

## Questions auxquelles répond ce cas d'usage
1. Quelle commande génère la migration après modification d'un modèle ?
2. Où est déclarée mon application pour que l'ORM la connaisse ?
3. Qui applique les migrations en production ?
4. Dois-je relire le fichier de migration généré ?
5. Pourquoi ma migration n'est-elle pas générée alors que j'ai modifié le modèle ?
6. Comment mes migrations cohabitent-elles avec celles du socle ?
7. Faut-il commiter les fichiers de migration ?

## Mots-clés
`makemigrations`, `python -m socle.manage`, migration applicative, `installed-apps`,
`socle.python.django.installed-apps`, génération, application au démarrage, relecture,
`make migrations`, commit des migrations, dépendances, numérotation

## Ce que c'est, et quand s'en servir
Le geste quotidien dès qu'on touche à un modèle : générer la migration, la relire, la livrer. Le
socle l'appliquera au démarrage de l'instance — en développement comme en production.

Le projet généré en fait une cible de son fichier de commandes, parce que c'est l'oubli le plus
fréquent : on modifie un modèle, l'instance démarre sans broncher, et la première requête échoue.

## Ce que le socle fait · ce qu'il interdit
Le socle configure l'ORM depuis la configuration (la liste des applications installées), applique
les migrations au démarrage, dans l'ordre, et journalise. Les migrations du socle et les vôtres sont
séparées : chacune dans son paquet.

Une migration est **du code livré** : elle se relit, se commite, et ne se modifie plus une fois
partie. Les fichiers générés font partie du dépôt — une application dont les migrations ne sont pas
versionnées n'est pas déployable deux fois de la même façon.

## Exemples
### Déclarer l'application
```yaml
socle:
  python:
    django:
      installed-apps: ${SOCLE_PYTHON_DJANGO_INSTALLED_APPS:mon_app.orders}
```

### Générer après modification
```bash
.venv/bin/python -m socle.manage makemigrations orders
make migrations          # la cible du projet généré fait la même chose
```

### Relire ce qui a été produit
```python
# src/mon_app/orders/migrations/0002_ajout_devise.py
class Migration(migrations.Migration):
    dependencies = [("orders", "0001_orders")]
    operations = [migrations.AddField("order", "currency",
                                      models.CharField(max_length=3, default="EUR"))]
```

### Constater l'application au démarrage
```
… INFO socle.techdb.migrations - [step:techdb_migrations_applied] orders.0002_ajout_devise
```

## Pièges courants
- **Oublier de générer** : l'instance démarre, la requête échoue plus tard, sur un message de
  colonne inconnue.
- **Modèle non réexporté** par le paquet des modèles : rien n'est détecté, aucune migration n'est
  produite (UC-DOM-01).
- **Ne pas relire le fichier généré** : un renommage mal interprété devient une suppression suivie
  d'une création — et les données partent.
- **Ne pas commiter les migrations** : chaque environnement se retrouve avec un schéma différent.
- **Modifier une migration déjà livrée** : les bases divergent en silence.

## Cas d'usage voisins
- UC-DB-03 — migrations tracées
- UC-DOM-01 — modéliser une entité métier avec l'ORM
- UC-CFG-01 — configurer par fichier
- UC-DEV-02 — obtenir un squelette complet en couches
