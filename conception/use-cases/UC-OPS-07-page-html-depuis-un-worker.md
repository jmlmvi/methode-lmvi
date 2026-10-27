---
id: UC-OPS-07
titre: "Servir une page HTML depuis un worker"
theme: "UC-OPS · Workers intégrés du framework"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "@page, PageProvider, PageResult, HtmlServerWorker, HtmlPageController, port dédié"
---

# UC-OPS-07 — Servir une page HTML depuis un worker

## Questions auxquelles répond ce cas d'usage
1. Comment servir une page d'écran depuis une application Socle ?
2. Faut-il un port dédié, ou la page peut-elle vivre sur le port principal ?
3. Qui protège cette page, et avec quel titre d'accès ?
4. Quelle différence avec l'hébergement d'un frontend complet ?
5. Dans les moteurs Python, comment déclare-t-on une page ?
6. Une page d'exploitation et une page métier relèvent-elles du même choix ?
7. Que se passe-t-il si une page prend le chemin d'une route du Socle ?
8. Une page peut-elle appeler la base de données ?

## Mots-clés
page HTML, `@page`, `PageProvider`, `PageResult`, `PageContext`, `HtmlServerWorker`,
`HtmlPageController`, Thymeleaf, Jinja2, gabarits Django, port dédié, gabarit,
rendu serveur, écran, exploitation, frontend, protection, chemin réservé,
fichiers statiques, FrontendShell

## Ce que c'est, et quand s'en servir
Servir une page rendue côté serveur : un écran d'exploitation, un formulaire simple, une page de
diagnostic. Dans le Socle Java, deux chemins — un worker qui tient son propre serveur sur un port
dédié, ou un contrôleur de page sur le port principal.

À distinguer de l'hébergement d'un frontend construit (UC-UI-04) : ici on parle de quelques pages
rendues par l'application, pas d'une application web complète.

## Ce que le socle fait · ce qu'il interdit
Java : les deux modèles existent et sont documentés ; la page suit la politique de sécurité de la
surface sur laquelle elle est servie.

Moteurs Python : une page se **déclare sur un worker**, comme une action — ``@page`` sur un worker
``PageProvider``. Le framework tient tout le reste : le chemin (une collision avec une route du
Socle fait **échouer le démarrage**, RG-26), l'identité (**fermé par défaut** : sans identité, la
page de refus en 403 ; ``public=True`` ouvre, ``required_scope=`` exige un scope), le rendu avec
échappement, le menu construit depuis les pages déclarées, et les fichiers statiques sous
``/static``. Le gestionnaire rend des **données** (``PageResult``), jamais du HTML : il reste
testable sans serveur.

Ce qui n'est **pas** offert : des routes HTTP quelconques (UC-OPS-05 — une capacité s'expose en
action), un port dédié (une page vit sur le port principal, donc sous la sécurité du Socle), et
l'hébergement d'un frontend construit à la racine (UC-UI-04).

Deux précautions valables partout : une page sur un port dédié **n'hérite pas** de la protection du
port principal — il faut la protéger explicitement ; et une page qui affiche des données
multi-tenant doit obtenir son tenant de l'identité, jamais d'un paramètre d'URL.

## Exemples
### Socle Java — page sur le port principal
```java
@Controller
public class StatusPageController {
    @GetMapping("/pages/status")
    public String status(Model model) {
        model.addAttribute("workers", orchestrator.getWorkersStats());
        return "status";                       // gabarit Thymeleaf
    }
}
```

### Moteurs Python — une page déclarée sur le worker
```python
from socle.pages import PageContext, PageProvider, PageResult, page


class OrdersWorker(Worker, ActionProvider, PageProvider):
    @page("/commandes", template="orders/liste.html", title="Commandes")
    def liste(self, context: PageContext) -> PageResult:
        book = services.OrderService.list_orders(store=self.kv_bus,
                                                 tenant_context=TenantContext(context.tenant_id))
        return PageResult.render(orders=book.orders)       # des données, pas du HTML
```

```html
{# orders/liste.html — hérite du gabarit du Socle (barre haute, menu, Alpine, Tailwind) #}
{% extends "socle/base.html" %}
{% block contenu %}<h1 class="text-2xl font-bold">{{ socle_title }}</h1>{% endblock %}
```

```yaml
socle:
  python:
    pages:
      template-dirs: src/mon_app/templates
      static-dirs: src/mon_app/static
```

### Une page qui lit la base : la garder synchrone
```python
    @page("/commandes", template="orders/liste.html")
    def liste(self, context: PageContext) -> PageResult:     # def, pas async def
        book = self.techdb.run(lambda: services.OrderService.list_orders(…))
        return PageResult.render(orders=book.orders)
```
Un gestionnaire synchrone est exécuté **hors de la boucle** : l'accès bloquant est permis, comme
pour une action synchrone. En ``async``, il immobiliserait le processus.

## Pièges courants
- **Un port dédié non protégé** : la page est ouverte alors que le reste est fermé.
- **Du métier dans le gabarit** : la règle finit dans la présentation, intestable.
- **Le tenant passé en paramètre d'URL** : chacun lit les données du voisin.
- **Confondre page d'exploitation et écran métier** : des publics et des protections différents.
- **Rendre du HTML depuis le gestionnaire** : il rend un ``PageResult``, et le framework rend la
  page. Sinon l'échappement et le gabarit commun sautent.
- **Appeler sa propre API en HTTP depuis la page** : la vue appelle le service dans le même
  processus ; un appel à soi-même ajoute une panne et une latence pour rien.
- **Une page `async` qui lit la base** : elle bloque la boucle. La revue le refuse (règle C15).

## Cas d'usage voisins
- UC-UI-04 — héberger un frontend FrontendShell
- UC-UI-06 — rendre une page avec un moteur de gabarits
- UC-SUP-12 — tableau de bord d'exploitation
- UC-OPS-05 — servir des routes HTTP applicatives
