---
id: HOWTO-40
titre: "ScanGuard : bloquer les scans hostiles, et savoir ce qui n'est pas protégé"
theme: "SEC · Sécurité du plan de requête"
surface: [scan_guard_worker, BotnetScanFilter, ScanGuardBuiltinCategories, ApimScanGuardHandler, ScanGuardApiController, PortalScanGuardController]
tables: [security.z_scan_guard_patterns, security.z_scan_guard_builtin_exceptions, security.z_scan_guard_disable_events]
actions_mcp: 13
routes: ["/api/security/scan-guard/**", "/hub/scan-guard"]
etat_verifie:
  hub: "3.70.3"
  socle: "5.9.4"
  le: "2026-10-16"
  comment: "lu au code et mesuré sur admin.thesocle.net"
voisins: [HOWTO-21, HOWTO-30, HOWTO-43]
---

# HOWTO 40 — ScanGuard : bloquer les scans hostiles, et savoir ce qui n'est pas protégé

> **Niveau** : intermédiaire | **Prérequis** : SocleHub Hub ≥ 3.70.1, accès admin au portail (`/hub/scan-guard`) ou une clé MCP, schéma `security` provisionné | **Temps estimé** : 15 min pour la lecture, 5 min pour ajouter un motif

Ce guide montre comment **lire, régler et mettre en défaut** le ScanGuard du Hub : les deux jeux de motifs (catégories câblées et motifs en base), l'ordre dans lequel ils sont évalués, les 13 actions MCP du `scan_guard_worker`, la désactivation temporisée pour une recette, et les exceptions par hôte. Il dit aussi, mesures à l'appui, **les trois endroits où le ScanGuard ne protège rien** — c'est la partie qui manque partout ailleurs.

État de référence : **Hub 3.70.3**, socle **5.9.4**, mesuré sur `admin.thesocle.net` le **2026-10-16**.

---

## Questions auxquelles répond cette fiche

1. Comment voir ce que le ScanGuard bloque réellement, et depuis quand ?
2. Pourquoi une app servie par le Hub reçoit-elle des requêtes `/wp-login.php` alors que le Hub les bloque ?
3. Quelle est la différence entre les catégories câblées et les motifs en base, et laquelle gagne ?
4. Comment ajouter un motif de blocage, et quel type de correspondance choisir ?
5. Comment désactiver le ScanGuard le temps d'une recette, sans l'ouvrir indéfiniment ?
6. Comment laisser passer une seule catégorie sur un seul hôte, plutôt que tout désactiver ?
7. Pourquoi un motif affiche-t-il `hit_count = 0` — est-il inutile ?
8. Le ScanGuard s'applique-t-il aux API publiées par l'APIM ?
9. Que se passe-t-il si la base de données tombe — le Hub reste-t-il protégé ?
10. Pourquoi ne vois-je jamais de blocage sur les charges utiles `${jndi:` ou `<?php` en query string ?
11. Où lire les compteurs : MCP, REST ou portail ?
12. Comment savoir si le ScanGuard est actuellement désactivé, et par qui ?

## Mots-clés

ScanGuard, botnet, scan hostile, blocage 403, `X-SocleHub-Scan-Guard`, motif de blocage,
`match_type`, exact, prefix, regex, query, catégorie câblée, catégorie built-in, exception par hôte,
glob de nom d'hôte, désactivation temporisée, kill-switch, réactivation automatique, `hit_count`,
`total_blocked`, `db_blocked`, `regex_blocked`, hôte routé, contournement, table de routage, APIM,
`scanGuardEnabled`, Log4Shell, `jndi`, injection PHP, XDEBUG, dotfile, WordPress, phpMyAdmin,
faux négatif, plan de requête, filtre servlet, `HIGHEST_PRECEDENCE`, repli sur regex,
`security.z_scan_guard_patterns`

---

## 1. Contexte

Le ScanGuard est le **deuxième filtre** de la chaîne de requête du Hub, juste après la redirection
HTTPS, et donc **avant toute authentification**. Son rôle est de renvoyer un 403 aux requêtes
typées scan-bot — `/.env`, `/wp-login.php`, `/phpmyadmin/`, `${jndi:` — sans les laisser atteindre
l'applicatif, et sans écrire une ligne d'ERROR qui polluerait l'`ErrorReportWorker`.

Deux faits qui conditionnent tout le reste :

1. **Il ne bloque pas par liste noire d'IP, mais par forme d'URL.** Aucune notion de réputation, de
   géographie ou de débit — c'est le rôle du `RateLimitFilter`, étape 9, pas du sien.
2. **Un hôte routé par le proxy du Hub le contourne entièrement.** C'est volontaire (une app gère
   sa propre authentification), mais c'est l'inverse de ce qu'on suppose en lisant « protège tout le
   Hub ». Voir le piège 1, c'est le plus important de cette fiche.

Le volume réel : **434 requêtes bloquées en 25 minutes** sur le Hub de production, soit environ
17 par minute en régime de fond. Ce n'est pas un dispositif décoratif.

---

## 2. Architecture

**En une phrase, l'ordre des cinq règles du filtre.** Le ScanGuard est le deuxième filtre de la
chaîne, en `@Order(HIGHEST_PRECEDENCE)`, et il décide dans cet ordre : *(a)* s'il est désactivé
temporairement, il laisse tout passer ; *(b)* si le nom d'hôte figure dans la table de routage du
proxy, il laisse tout passer — c'est le contournement du piège 1 ; *(c)* il essaie les **12
catégories câblées** (8 sur l'URI, 4 sur la query string) ; *(d)* seulement si aucune ne correspond,
il essaie les **motifs en base** ; *(e)* si quelque chose a correspondu et qu'aucune exception ne
couvre la catégorie pour cet hôte, il répond **403** avec une page Thymeleaf et l'en-tête
`X-SocleHub-Scan-Guard: blocked`. Le schéma ci-dessous dit la même chose en détail.

```
   requête entrante
        │
        ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │ 1. HttpsRedirectFilter                                            │
  ├───────────────────────────────────────────────────────────────────┤
  │ 2. BotnetScanFilter  ← LE SCANGUARD  (@Order HIGHEST_PRECEDENCE)  │
  │                                                                   │
  │    (a) service.isActive() == false ?  ──────────► PASSE (tout)    │
  │             désactivation temporisée en cours                     │
  │                                                                   │
  │    (b) routingTable.get(hostname) != null ? ────► PASSE (tout)    │
  │             l'hôte est une app routée  ⚠️ piège 1                 │
  │                                                                   │
  │    (c) catégories CÂBLÉES (8 URI + 4 query)  ─── match ─┐         │
  │             ScanGuardBuiltinCategories.java              │        │
  │                      │ pas de match                      │        │
  │                      ▼                                    │        │
  │    (d) motifs EN BASE (exact / prefix / regex / query) ──┤        │
  │             security.z_scan_guard_patterns                │        │
  │                      │ pas de match                      │        │
  │                      ▼                                    ▼        │
  │                   PASSE                      (e) exception        │
  │                                                   par hôte ?      │
  │                                                   │ oui → PASSE   │
  │                                                   ▼ non           │
  │                                       403 + page Thymeleaf        │
  │                                       en-tête X-SocleHub-Scan-Guard│
  ├───────────────────────────────────────────────────────────────────┤
  │ 3..10  ApiAuth, RequestId, Apim, DomainContext, DynamicProxy,     │
  │        TenantContext (RLS), RateLimit, OidcMcpAuth                │
  └───────────────────────────────────────────────────────────────────┘
```

**L'ordre (c) avant (d) est la clé de lecture des compteurs.** Une catégorie câblée qui couvre le
même terrain qu'un motif en base gagne toujours : le compteur de la catégorie monte, celui du motif
en base reste figé. Un motif en base à `hit_count = 0` n'est donc **pas** forcément inutile — il
peut simplement être masqué par son jumeau câblé.

### Les deux jeux de motifs

| | Catégories câblées | Motifs en base |
|---|---|---|
| **Où** | `filter/ScanGuardBuiltinCategories.java` | `security.z_scan_guard_patterns` |
| **Combien** | 8 URI + 4 query, figés | 31 en production (5 exact, 18 prefix, 4 regex, 4 query) |
| **Modifiable** | non — il faut livrer | oui, à chaud |
| **Évalué** | en premier | en second |
| **Compteur** | RAM, remis à zéro au redémarrage | `hit_count` en base, cumulatif |
| **Désactivable** | par **exception** (catégorie + hôte) | par `set_enabled false` |
| **Vu par l'APIM** | ❌ **non** — voir piège 3 | ✅ oui |

Les 8 catégories URI : `php-extension`, `asp-extension`, `script-extension`, `wordpress`,
`wordpress-json`, `scanner-tools`, `cve-exploit-tmui`, `dotfile`.
Les 4 catégories query : `query-array`, `query-xdebug`, `query-php-inject`, `query-jndi`.

---

## 3. Étape 1 — Lire l'état réel

```bash
# MCP — la seule lecture qui donne les deux jeux de compteurs d'un coup
mcp__soclehub__scan_guard_worker__get_status
```

Réponse mesurée en production le 2026-10-16 :

```json
{
  "active": true,
  "patterns_loaded": 31,
  "exact_count": 5, "prefix_count": 18, "regex_count": 4, "query_count": 4,
  "total_blocked": 434,
  "regex_blocked": 434,          ← tout vient des catégories câblées
  "db_blocked": 0,               ← aucun motif en base n'a tiré depuis le boot
  "builtin_category_hits": { "script-extension": 283, "dotfile": 106, "php-extension": 45 },
  "builtin_exceptions_active": 0,
  "last_blocked_uri": "/.git/config",
  "last_reload": "2026-10-16T15:08:40Z",
  "hit_buffer_size": 0
}
```

**Comment lire ces chiffres.** `total_blocked = regex_blocked + db_blocked`, tous trois en RAM et
remis à zéro à chaque redémarrage. `hit_count` par motif, lui, est en base et cumulatif : il survit
aux redémarrages, donc un motif peut afficher 4 196 coups historiques et 0 depuis ce boot.
`hit_buffer_size` est le nombre de motifs dont les coups attendent d'être écrits en base — le vidage
est asynchrone, **toutes les 30 secondes**. Un compteur qui semble en retard de 30 s est normal.

Les trois autres lectures utiles :

```bash
mcp__soclehub__scan_guard_worker__list_patterns            # les 31 motifs + hit_count à jour
mcp__soclehub__scan_guard_worker__get_top_hits  limit=35   # les mêmes, triés par coups
mcp__soclehub__scan_guard_worker__list_builtin_categories  # les 12 catégories + regex + coups
```

En REST, même chose en lecture seule, **authentification obligatoire** (vérifié : `401` sans jeton) :

```bash
curl -H "Authorization: Bearer $CLE" https://admin.thesocle.net/api/security/scan-guard/status
curl -H "Authorization: Bearer $CLE" https://admin.thesocle.net/api/security/scan-guard/patterns
```

Au portail : **`/hub/scan-guard`** — motifs, catégories câblées en lecture seule, exceptions,
historique des désactivations.

---

## 4. Étape 2 — Ajouter un motif

Quatre types de correspondance, et le choix n'est pas indifférent :

| `match_type` | Sémantique | Coût | Quand l'employer |
|---|---|---|---|
| `exact` | égalité stricte de l'URI | O(1) table de hachage | une URL précise : `/xmlrpc.php` |
| `prefix` | `uri.startsWith(motif)` | O(n) balayage | une arborescence : `/phpmyadmin/` |
| `regex` | `Pattern.matches()` — **ancré, l'URI entière** | O(n) + coût regex | une famille d'extensions |
| `query` | `query.contains(motif)` — **littéral, pas une regex** | O(n) | une charge utile : `XDEBUG_SESSION_START=` |

```bash
mcp__soclehub__scan_guard_worker__add_pattern \
  pattern="/autodiscover/" \
  match_type="prefix" \
  category="scanner" \
  description="Sonde Exchange/Outlook — 87 coups constatés"
```

`add_pattern` appelle `reload()` tout seul : le motif est actif immédiatement, inutile d'enchaîner
avec `reload_patterns`. Le `category` est **libre et purement documentaire** — il ne sert qu'au tri
dans l'IHM, aucun code ne s'en sert. Ne pas le confondre avec le nom d'une catégorie câblée, qui est
lui un identifiant contrôlé.

Pour désactiver sans perdre l'historique de coups, préférer `set_enabled` à `remove_pattern` :

```bash
mcp__soclehub__scan_guard_worker__set_enabled  x_id="8"  enabled="false"
```

⚠️ **`remove_pattern` est un `DELETE`, pas une désactivation logique** — le `hit_count` cumulatif
part avec la ligne. Sur ce point le ScanGuard s'écarte de la convention `x_active` du socle.

---

## 5. Étape 3 — Désactiver le temps d'une recette

Un scanner de conformité, un test de pénétration autorisé, une recette qui poste du
`<?php` légitime : il faut pouvoir ouvrir, mais pas indéfiniment.

```bash
mcp__soclehub__scan_guard_worker__disable_temporarily \
  duration_minutes="30" \
  reason="Recette APP-14 — import de gabarits contenant <?php (ticket 1842)"
```

Les garde-fous, tous dans `ScanGuardService.disableTemporarily()` :

- **1 à 240 minutes**, bornes incluses. Hors bornes → `bad_request`.
- **`reason` obligatoire**, moins de 200 caractères, écrite en base avec l'appelant
  (`x_createdby` = `callerId` du contexte MCP).
- **Refus si déjà désactivé** → `already_disabled`. Pas de prolongation en douce : il faut
  `enable_now` puis redésactiver, et les deux gestes sont tracés.
- **Réactivation automatique** par un ordonnanceur qui vérifie toutes les 30 secondes. Donc la
  réouverture effective peut arriver **jusqu'à 30 s après l'échéance** — à prévoir si la sonde qui
  suit est serrée.

```bash
mcp__soclehub__scan_guard_worker__enable_now     # réactivation immédiate
```

L'historique se lit au portail `/hub/scan-guard`, section désactivations
(table `security.z_scan_guard_disable_events`).

> 💡 **Préférer l'exception à la désactivation.** Désactiver ouvre *tout* le Hub à *tous* les
> motifs. Si le besoin est « laisser passer les `.php` sur ce seul hôte », l'exception ciblée de
> l'étape 4 est le bon outil et ne baisse pas la garde ailleurs.

---

## 6. Étape 4 — Excepter une catégorie pour un hôte

Les catégories câblées ne se suppriment pas, mais s'exceptent — par catégorie, et
facultativement par hôte :

```bash
mcp__soclehub__scan_guard_worker__add_builtin_exception \
  category="php-extension" \
  hostname_glob="*.legacy.exemple.fr" \
  reason="Site WordPress hérité, migration prévue T4" \
  duration_minutes="10080"          # 7 jours ; vide ou 0 = permanent
```

- `category` doit être **un nom exact** de `list_builtin_categories` — sinon
  `unknown built-in category`. C'est le seul garde-fou qui empêche la faute de frappe silencieuse.
- `hostname_glob` : **seul `*` est un métacaractère**, et il couvre 0 à n caractères.
  Insensible à la casse. Vide ⇒ **exception globale, tous hôtes** — à n'employer qu'en connaissance
  de cause.
- Les exceptions sont rechargées en RAM à chaque `reload()` et à chaque ajout/retrait.

```bash
mcp__soclehub__scan_guard_worker__list_builtin_exceptions
mcp__soclehub__scan_guard_worker__remove_builtin_exception  x_id="3"
```

⚠️ **Une exception ne couvre que les catégories câblées.** Elle n'a aucun effet sur un motif en
base : pour celui-là, c'est `set_enabled false`, et c'est global.

---

## 7. Validation

Les quatre vérifications, telles qu'elles ont réellement répondu le 2026-10-16 :

```bash
# 1. un chemin hostile sur le Hub → 403 + en-tête
curl -sS -o /dev/null -w '%{http_code} %header{X-SocleHub-Scan-Guard}\n' \
  https://admin.thesocle.net/.git/config
# → 403 blocked          (catégorie câblée « dotfile »)

# 2. un chemin couvert par la base SEULE → 403 aussi
curl -sS -o /dev/null -w '%{http_code} %header{X-SocleHub-Scan-Guard}\n' \
  https://admin.thesocle.net/autodiscover/autodiscover.xml
# → 403 blocked          (motif prefix en base ; aucune catégorie câblée ne le couvre)

# 3. une charge utile en query, caractères licites → 403
curl -sS -o /dev/null -w '%{http_code} %header{X-SocleHub-Scan-Guard}\n' \
  'https://admin.thesocle.net/hub?XDEBUG_SESSION_START=1'
# → 403 blocked          (catégorie « query-xdebug »)

# 4. l'API en lecture sans jeton → 401, la liste noire ne fuit pas
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://admin.thesocle.net/api/security/scan-guard/patterns
# → 401
```

Et le compteur qui doit bouger :

```bash
mcp__soclehub__scan_guard_worker__get_status   # total_blocked a augmenté de 3
```

> ⚠️ **Ne pas tester avec `curl` sans `-g`.** Les accolades sont des métacaractères de *globbing*
> curl : `curl '…?x=${jndi:ldap://x}'` envoie `x=$jndi:ldap://x`, pas la charge utile voulue, et on
> conclut à tort que le ScanGuard a laissé passer. C'est exactement l'erreur commise en rédigeant
> cette fiche. Toujours `curl -g` pour les charges utiles à accolades.

---

## 8. Pièges courants

### Piège 1 — 🔴 Un hôte routé par le proxy n'est pas protégé du tout

**Symptôme** : une app servie par le Hub sur `app.exemple.fr` reçoit `/wp-login.php`,
`/.env`, `/phpmyadmin/` sans aucun 403, alors que le même chemin est bloqué sur
`admin.thesocle.net`.

**Mesuré** le 2026-10-16, sur trois des 77 hôtes routés en production, contre le Hub en témoin :

| Hôte | `/.git/config` | `/toto.php` | En-tête `X-SocleHub-Scan-Guard` |
|---|---|---|---|
| `thedash.thesocle.net` (routé) | `302` | `302` | absent |
| `repository.thesocle.net` (routé) | `404` | `404` | absent |
| `seance.thesocle.net` (routé) | `404` | `404` | absent |
| `admin.thesocle.net` (**non** routé) | **`403`** | **`403`** | **`blocked`** |

Les 302 et 404 sont des réponses de l'**application** : la requête hostile l'a atteinte. Aucun
en-tête ScanGuard, donc aucune évaluation de motif. Le contournement n'est pas une hypothèse de
lecture de code, il est observable de l'extérieur.

**Cause** : `BotnetScanFilter`, règle (b) — `if (routingTable.get(hostname) != null) → chain.doFilter()`.
Dès qu'un hôte figure dans la table de routage du proxy, **la requête sort du ScanGuard avant toute
évaluation de motif**. C'est un choix d'architecture assumé (« l'app gère son authentification »),
mais il signifie que le ScanGuard protège **le Hub lui-même et les hôtes inconnus, pas les apps**.

**Résolution** : il n'y a rien à régler dans le ScanGuard — c'est le comportement voulu. Ce qui
protège une app routée, c'est, dans l'ordre : son APIM si elle est publiée (avec
`scanGuardEnabled` — voir piège 3), son propre `ApiAuthFilter`, et le `RateLimitFilter`. **La
conclusion à retenir est documentaire** : ne jamais écrire ni croire que « le ScanGuard protège les
apps du Hub ». Il n'en voit pas le trafic.

### Piège 2 — 🔴 Quatre motifs `regex` en base ne peuvent structurellement rien matcher

**Symptôme** : les motifs `regex` `.*\\.php$`, `.*\\.aspx?$`, `.*\\.jsp$`, `.*\\.cgi$` affichent
`hit_count = 0` depuis toujours, alors que les `.php` arrivent par dizaines.

**Cause** : **ils contiennent deux barres obliques inverses, pas une.** Vérifié au caractère près
sur la valeur stockée (`length(pattern) = 9` pour `.*\\.php$`). En regex Java, `\\.` signifie
« une barre oblique inverse littérale, puis n'importe quel caractère » — et non « un point
littéral ». Le motif réclame donc une URI de la forme `…\Xphp`, qui n'existe pas. Une barre de trop
à la saisie, probablement un échappement JSON appliqué deux fois.

**Résolution** : ces quatre lignes sont mortes, mais **inoffensives** — les catégories câblées
`php-extension`, `asp-extension` et `script-extension` couvrent exactement le même terrain avec la
bonne regex (`.*\.php$`), et ce sont elles qui comptent les 45 + 283 coups observés. À supprimer
pour la propreté, sans urgence. **La leçon est générale** : un motif `regex` ajouté par MCP ou par
l'API passe par une couche JSON ; vérifier la valeur stockée avec `list_patterns` après l'ajout, et
ne pas se fier à ce qu'on croit avoir envoyé.

### Piège 3 — Dans l'APIM, les catégories câblées ne s'appliquent pas

**Symptôme** : un appel qui serait bloqué sur le Hub passe à travers une API publiée par l'APIM,
même avec `scanGuardEnabled = true`.

**Cause** : `ApimScanGuardHandler` (étape 3 du pipeline APIM) appelle `scanGuard.match(path, query)`
— c'est-à-dire **les motifs en base uniquement**. Il ne passe jamais par
`ScanGuardBuiltinCategories`. Les 12 catégories câblées sont donc invisibles de l'APIM.

**Résolution** : pour une protection valable côté APIM, le motif doit exister **en base**. C'est la
raison d'être des 24 motifs en base qui doublonnent les catégories câblées : ils semblent
redondants sur le Hub (masqués par l'ordre (c) avant (d)) mais ils sont **le seul jeu actif dans
l'APIM**. Ne pas les supprimer au motif qu'ils affichent 0 coup.

### Piège 4 — Le balayage du corps de requête APIM se fait sur une URI factice

**Symptôme** : un motif `exact` ou `prefix` sur `/` bloque **toutes** les requêtes APIM porteuses
d'un corps.

**Cause** : `ApimScanGuardHandler` balaie le corps en appelant `scanGuard.match("/", extrait)` — le
corps est passé en *position query*, et l'URI vaut littéralement `"/"`. Un motif `exact` sur `/`, ou
un `prefix` sur `/`, matche donc sur cet appel, pour n'importe quel contenu.

**Résolution** : ne jamais déclarer de motif `exact` ou `prefix` égal à `/`. Et retenir que seuls
les motifs de type `query` inspectent réellement le corps — par `contains`, en littéral, sur les
**64 premiers kilo-octets** seulement.

### Piège 5 — Les catégories query `jndi` et `php-inject` ne se déclenchent jamais

**Symptôme** : `builtin_category_hits` ne contient jamais `query-jndi` ni `query-php-inject`, quelle
que soit la durée d'observation.

**Cause** : mesurée, et c'est une pince à deux branches.
- Charge utile **brute** : `?x=${jndi:ldap://x}` contient `{`, `}`, `<` — caractères illicites en
  query string. **Le connecteur répond 400 avant même la chaîne de filtres** ; le ScanGuard ne voit
  rien. Vérifié : `HTTP 400`.
- Charge utile **encodée** : `?x=%24%7Bjndi%3A…` traverse le connecteur, mais `getQueryString()`
  rend la forme encodée, et la regex `\$\{jndi:` n'y correspond pas. **La requête passe.**
  Vérifié : `HTTP 302`, aucun blocage.

**Résolution** : ne pas compter sur ces deux catégories. La forme brute est bloquée — par le
connecteur, avec un 400, ce qui est acceptable mais n'est ni compté ni tracé. La forme encodée
**n'est pas filtrée**, et c'est le vrai trou : un motif efficace devrait décoder la query avant de
comparer, ce que ne fait ni le filtre ni le service. À ce jour aucune parade dans le Hub ; la
protection effective contre Log4Shell repose sur le fait qu'aucune version vulnérable de Log4j2
n'est embarquée, pas sur le ScanGuard. `query-array` et `query-xdebug`, eux, fonctionnent (vérifié
403) parce que leurs charges utiles n'emploient que des caractères licites.

### Piège 6 — Un `hit_count` à 0 ne veut pas dire « motif inutile »

**Symptôme** : on nettoie les motifs à 0 coup, et la couverture APIM se dégrade sans alerte.

**Cause** : trois raisons distinctes mènent à un 0, et elles n'appellent pas la même décision —
le motif est masqué par une catégorie câblée évaluée avant lui (piège 3 : il reste vital côté
APIM) ; le motif est syntaxiquement mort (piège 2) ; ou la menace n'est simplement jamais passée.

**Résolution** : avant de supprimer, croiser avec `list_builtin_categories`. Si une catégorie
câblée couvre le même terrain, **le motif est masqué, pas mort** — le garder. Et se souvenir que
`db_blocked` est un compteur de boot : sur un Hub redémarré il y a 25 minutes, `db_blocked = 0`
n'est pas une mesure, c'est une fenêtre trop courte.

### Piège 7 — Si la base tombe, le ScanGuard ne tombe pas

**Symptôme** : `patterns_loaded = 0` après un incident PostgreSQL, et pourtant les `.php` sont
toujours bloqués.

**Cause** : par construction (`ScanGuardService.reload()` en `try`/`catch`, `match()` sur des
structures vides). Les catégories câblées sont en code, donc insensibles à l'état de la base.
Le Hub se replie dessus.

**Résolution** : aucun geste. C'est le comportement voulu, et c'est une bonne nouvelle. Mais noter
que dans cet état la couverture **APIM** tombe à zéro (piège 3) : le pipeline APIM ne consulte que
la base. Après rétablissement, `reload_patterns` et vérifier `patterns_loaded`.

---

## 9. Pour aller plus loin

- [[CATALOGUE-FONCTIONS-TSH|Catalogue des fonctions mutualisées]] — §20, les 10 filtres du plan de requête et leur ordre,
- [[howto-21-clamav-mail-scan|HOWTO 21 — ClamAV et le scan des pièces jointes]] — l'autre volet de la défense, sur le contenu et non sur l'URL,
- [[howto-30-publier-une-api-apim|HOWTO 30 — Publier une API dans l'APIM]] — où `scanGuardEnabled` se règle, et ce qu'il couvre vraiment,
- `soclehub/src/main/java/eu/lmvi/soclehub/filter/BotnetScanFilter.java` — les cinq règles dans l'ordre, 176 lignes à lire en entier,
- `soclehub/src/main/java/eu/lmvi/soclehub/filter/ScanGuardBuiltinCategories.java` — les 12 catégories et leurs regex, source de vérité.
