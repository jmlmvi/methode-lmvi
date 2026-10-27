---
id: UC-UI-06
titre: "Rendre une page avec un moteur de gabarits"
theme: "UC-UI · Pages et frontend"
moteurs:
  java: ok
  socle-py: ok
  socle-py-django: ok
contrat: "5.9"
mecanismes: "Thymeleaf, Jinja2, gabarits Django, @page, socle/base.html, échappement"
---

# UC-UI-06 — Rendre une page avec un moteur de gabarits

## Questions auxquelles répond ce cas d'usage
1. Comment produire une page HTML à partir de données, côté serveur ?
2. Quel moteur de gabarits est utilisé dans chaque moteur du socle ?
3. Comment éviter une faille d'injection dans une page rendue ?
4. Quelle logique a le droit de vivre dans un gabarit ?
5. Dans les moteurs Python, quel moteur de gabarits est configuré, et par qui ?
6. Quand préférer le rendu serveur à un frontend séparé ?
7. Peut-on reprendre la pile Thymeleaf + Alpine.js du Java dans les moteurs Python ?
8. Django Ninja sert-il à faire des pages ?

## Mots-clés
gabarit, template, Thymeleaf, Jinja2, gabarits Django, DTL, Alpine.js, Tailwind,
Django Ninja, rendu serveur, échappement, injection, XSS, logique dans le gabarit,
contexte de rendu, page, frontend séparé, zéro build, P-5, pages d'exploitation

## Ce que c'est, et quand s'en servir
Produire du HTML côté serveur à partir d'un gabarit et de données. C'est la bonne approche pour
quelques pages — un écran d'exploitation, une page de statut, un courriel formaté. Au-delà, un
frontend séparé (UC-UI-04) est plus maniable.

## Ce que le socle fait · ce qu'il interdit
Java : le rendu de pages est disponible et utilisé par les pages d'exploitation, avec Thymeleaf.

Moteurs Python : le **framework configure le moteur de gabarits** — gabarits Django (DTL) pour
socle-py-django, Jinja2 pour socle-py — avec l'échappement actif et un environnement **propre à
l'application** (plusieurs applications peuvent coexister dans un processus). Une page se déclare
par ``@page`` sur un worker (UC-OPS-07) ; les dossiers de gabarits viennent de
``socle.python.pages.template-dirs``, et ceux du framework sont cherchés en dernier — une
application qui crée son propre ``socle/refus.html`` remplace celui du Socle sans le modifier.

Le framework livre **un seul** jeu de gabarits pour les deux moteurs Python : ``socle/base.html``
et ses fragments (barre haute, menu, messages) sont le **même fichier**, parce qu'ils n'utilisent
que la syntaxe commune à DTL et à Jinja2 — ``extends``, ``block``, ``include``, ``if``, ``for`` et
l'interpolation. Un test vérifie cette identité. Pas de filtre à argument (``default:"x"`` contre
``default("x")``), pas de balise ``url``, pas de ``empty``.

**Django Ninja n'est pas une technologie d'IHM** : c'est la couche REST / OpenAPI du moteur Django,
elle produit du JSON. La pile d'IHM décidée en Java (Thymeleaf + Alpine.js + Tailwind par CDN, zéro
build) est reprise pour moitié telle quelle côté Python — Alpine et Tailwind sont du HTML et du
JavaScript, ils ne changent pas ; seul le moteur de gabarits est traduit. La doctrine, les
correspondances de syntaxe et ce que le framework livre :
`docs/01-docsV2/design-system/portage-python.md`.

Deux règles tiennent la qualité d'une page rendue : **l'échappement par défaut** — ne jamais insérer
une valeur venue d'un utilisateur sans échappement, sous peine d'injection dans le navigateur des
autres — et **pas de logique métier dans le gabarit** : il met en forme, il ne décide pas. Un
gabarit qui calcule est intestable.

## Exemples
### Un gabarit met en forme, il ne décide pas
```html
<!-- Bien : la décision est prise avant, le gabarit affiche -->
<span class="etat {{ classe_etat }}">{{ libelle_etat }}</span>

<!-- À éviter : la règle est dans la page -->
<span>{% if commande.montant > 100000 and client.segment == "KEY" %}remise{% endif %}</span>
```

### L'échappement n'est pas optionnel
```html
{{ reference }}            <!-- échappé : correct -->
{{ reference | safe }}     <!-- non échappé : à ne faire QUE sur du contenu maîtrisé -->
```

### Socle Java
```java
@GetMapping("/pages/status")
public String status(Model model) {
    model.addAttribute("workers", orchestrator.getWorkersStats());
    return "status";
}
```

### Moteurs Python — le gabarit hérite de celui du Socle
```html
{% extends "socle/base.html" %}

{% block contenu %}
<h1 class="text-2xl font-bold text-gray-900">{{ socle_title }}</h1>
{% if lignes %}
<ul>{% for ligne in lignes %}<li>{{ ligne.libelle }}</li>{% endfor %}</ul>
{% endif %}
{% endblock %}
```
Valeurs fournies par le framework à tout gabarit : ``socle_app``, ``socle_version``,
``socle_static``, ``socle_title``, ``socle_path``, ``socle_nav``, ``socle_user``, ``socle_tenant``.

## Pièges courants
- **Désactiver l'échappement** pour afficher du HTML stocké : faille d'injection directe.
- **De la logique métier dans le gabarit** : intestable, et dupliquée avec le serveur.
- **Des requêtes déclenchées depuis le gabarit** : une page qui fait cent requêtes.
- **Des gabarits sans tests** : la page casse en production sur un champ nul.
- **Écrire une balise de gabarit dans un commentaire HTML** : le moteur lit l'intérieur des
  commentaires et l'interprète — un ``extends`` cité en exemple fait échouer le rendu.
- **Un filtre à argument dans un gabarit partagé** : ``default:"x"`` (DTL) et ``default("x")``
  (Jinja2) ne s'écrivent pas pareil ; le fichier cesse d'être commun aux deux moteurs.

## Cas d'usage voisins
- UC-UI-04 — héberger un frontend FrontendShell
- UC-OPS-07 — servir une page HTML depuis un worker
- UC-UI-01 — servir le tableau de bord des workers
- UC-OPS-05 — servir des routes HTTP applicatives
