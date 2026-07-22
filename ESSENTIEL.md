<!-- KIT-VERSION: 1.8.0 -->
# L'essentiel de la méthode — en une page

> La philosophie, sans un seul template. À lire avant tout le reste.

## 1. La preuve externe (comment croire)

**Tout artefact doit être prouvé par quelque chose d'extérieur à lui.** Une exigence par son test,
une règle métier par son contre-exemple, une phase par sa démo, un backup par sa restauration, une
doc par sa rejouabilité, une spec par un relecteur qui ne l'a pas écrite — et la méthode elle-même
par ses chantiers réels. Ce qui n'a pas de preuve externe est une opinion bien formatée.

## 2. Les 3 axes orthogonaux (comment ranger)

**Métier** (ce qu'on promet : les US, groupées en features, elles-mêmes groupées en épics) · **Technique** (avec quoi on le fait :
les briques) · **Livraison** (quand et comment on le démontre : les phases et leurs gates).
On ne les mélange jamais : un artefact ne porte qu'un axe ; le seul lieu où les trois se croisent
est la **matrice de couverture** — chaque promesse y est tracée jusqu'à sa brique, son test et sa
démo. Verticalement elle prouve qu'on n'a rien oublié ; horizontalement, qu'on n'a rien codé en trop.

## 3. Décider avant de construire

Les décisions structurantes se prennent **avant** le plan, s'écrivent avec leur *pourquoi*, et
rien ne se code tant qu'une décision bloquante est ouverte. Le doute n'est pas interdit — il est
**visible** (`[À ARBITRER]`) puis tranché, jamais enfoui dans le code.

## 4. Livrer en mini-cycles

Pas de tunnel. Chaque phase est un **mini-cycle complet** — développement + tests, puis recette
(la gate : une démo réelle, jamais une liste cochée), puis livraison. La phase suivante re-vérifie
les précédentes. Et quand le réel contredit le papier, le papier se met à jour, tracé — la méthode
a des boucles de retour, y compris celle qui sait **arrêter** un chantier proprement.

## 5. L'honnêteté technique

Zéro mock, zéro simulation, zéro faux vert : sans dépendance réelle, un état honnête
(`en_attente`) — jamais un résultat inventé. On ne recode pas ce que la plateforme fournit. Et on
n'applique pas la méthode à ce qui n'en a pas besoin : si l'intention tient dans un message et se
prouve par un test, on fait, on prouve, on n'instrumente pas.

---

*La suite, dans l'ordre : [`USAGE.md`](USAGE.md) (comment démarrer) →
[`conception/PROFILS.md`](conception/PROFILS.md) (quel niveau d'outillage) →
[`conception/METHODE-Besoin2Plan.md`](conception/METHODE-Besoin2Plan.md) (la référence).*
