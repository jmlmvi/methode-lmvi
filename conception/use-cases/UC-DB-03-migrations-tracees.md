---
id: UC-DB-03
titre: "Faire évoluer le schéma par migrations tracées"
theme: "UC-DB · TechDB"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "migrations, jamais rejouées, makemigrations, application au démarrage"
---

# UC-DB-03 — Faire évoluer le schéma par migrations tracées

## Questions auxquelles répond ce cas d'usage
1. Comment ajouter une colonne sans casser les instances déjà déployées ?
2. Qui applique les migrations — un script d'exploitation, ou l'application elle-même ?
3. Une migration peut-elle être rejouée deux fois par erreur ?
4. Comment générer une migration après avoir modifié un modèle ?
5. Que faire d'une migration qui a échoué au milieu ?
6. Les migrations du socle et celles de mon application sont-elles mélangées ?
7. Comment savoir quelles migrations sont déjà passées sur une instance ?

## Mots-clés
migration, migrations tracées, jamais rejouée, idempotent, `makemigrations`, `manage`,
schéma, colonne, application au démarrage, journal des migrations, version de schéma,
réversibilité, `django_migrations`, ordre, `0001_…`

## Ce que c'est, et quand s'en servir
Toute évolution du schéma passe par une **migration tracée** : elle porte un numéro, elle est
enregistrée une fois appliquée, et elle ne repasse jamais. C'est ce qui permet de livrer une
nouvelle version sur une base existante sans intervention manuelle.

Le besoin arrive dès la deuxième livraison : ajouter une colonne, un index, une contrainte, une
table. On ne modifie jamais une migration déjà livrée — on en écrit une nouvelle.

## Ce que le socle fait · ce qu'il interdit
Le socle applique les migrations **au démarrage de l'instance**, dans l'ordre, et consigne ce qui a
été fait. Les migrations du socle (tables `techdb_*`) et celles de l'application sont distinctes :
chacune vit dans son paquet et suit son propre numéro.

Interdit : modifier une migration déjà appliquée ailleurs (les bases divergent sans que rien ne le
signale), et faire évoluer le schéma à la main en production — la trace manquerait, et la migration
suivante trouverait un état qu'elle n'attend pas.

## Exemples
### socle-py-django — générer après modification d'un modèle
```bash
.venv/bin/python -m socle.manage makemigrations orders
# puis relire le fichier produit : il fait partie du code, il se relit comme du code
make migrations        # le projet généré en fait une cible
```

### Une migration d'application
```python
# src/mon_app/orders/migrations/0002_ajout_devise.py
class Migration(migrations.Migration):
    dependencies = [("orders", "0001_orders")]
    operations = [migrations.AddField("order", "currency",
                                      models.CharField(max_length=3, default="EUR"))]
```

### Constater l'application
```
… INFO socle.techdb.migrations - [step:techdb_migrations_applied] orders.0002_ajout_devise
```

### Socle Java
Les migrations TechDB du socle sont portées par le framework et appliquées au démarrage ; une
application ajoute les siennes selon le même principe.

## Pièges courants
- **Rendre une colonne obligatoire d'un coup** sur une table pleine : la migration échoue, ou
  verrouille longtemps. Ajouter avec un défaut, remplir, puis contraindre.
- **Modifier une migration livrée** : les instances déjà migrées ne la rejoueront pas, et les
  nouvelles auront un autre schéma.
- **Oublier de générer la migration** après avoir changé un modèle : l'instance démarre, et la
  requête échoue à la première utilisation.
- **Migrer les données dans la même migration que le schéma** sur de gros volumes : le démarrage
  s'allonge. Séparer.
- **Supposer un ordre entre applications** sans le déclarer : les dépendances entre migrations
  existent pour ça.

## Cas d'usage voisins
- UC-DB-01 — persister l'état technique
- UC-DOM-08 — générer et appliquer les migrations d'une application métier
- UC-DB-02 — choisir le moteur
- UC-CTR-05 — faire évoluer un contrat dans les trois moteurs
