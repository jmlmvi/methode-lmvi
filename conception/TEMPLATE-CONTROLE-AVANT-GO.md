# Contrôle avant go — `<APP>`

> **Quand** : à l'arrêt ⑥, juste avant le go du développement. Après M6, avant la première ligne
> de code.
>
> **Ce que ça contrôle** : que ce qui vient d'être conçu respecte ce que la plateforme impose.
> La référence est le **`CONTRAT-ARCHITECTURE.md`** du kit — une app ne redécide pas ces points,
> elle s'y conforme. Cette grille ne réénonce pas les règles : elle les **interroge**.
>
> **Règle d'usage** : **tout écart non levé bloque le go.** Un écart peut être levé de deux façons,
> et de deux seulement — on corrige la conception, ou on en fait une **décision d'arbitrage M4
> explicite et datée**. « On verra plus tard » n'est pas une levée.
>
> **Moitié du travail est mécanique** : `./controle-avant-go.sh <dossier-app>` rend un verdict sur
> les points marqués 🤖. Lance-le d'abord, puis remplis à la main ce qu'il ne sait pas juger.

| | |
|---|---|
| Application | `<APP>` |
| Chantier | `docs/chantier/` |
| Contrôlé le | `<date>` |
| Contrôlé par | `<qui>` |
| Version du kit | `<KIT-VERSION>` |
| Verdict global | ☐ GO ☐ GO SOUS RÉSERVE ☐ NO-GO |

**Verdicts possibles par ligne** : `OK` · `ÉCART` · `S.O.` (sans objet, avec la raison) ·
`À VÉRIFIER` (le contrôle n'a pas pu être fait — compte comme un écart).

---

## 1. Données — nomenclature et standard THESOCLE

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 1.1 | Un seul schéma, `schema_<app>`, et l'app n'écrit que dedans | | |
| 1.2 | 🤖 Toute table porte un préfixe `z_` (paramétrage), `db_` (référentiel) ou `tr_` (transactionnel) | | |
| 1.3 | 🤖 Les 13 colonnes `x_*` sont présentes, **dans l'ordre**, et `datas jsonb` ferme la table | | |
| 1.4 | 🤖 Le trigger `update_changed_fields` est en **`BEFORE UPDATE`** | | |
| 1.5 | 🤖 Les 3 triggers d'audit sont créés puis `DISABLE` | | |
| 1.6 | 🤖 Aucun `ALTER … OWNER TO admin` — la table appartient à `app_<app>` | | |
| 1.7 | 🤖 Les 4 fonctions de trigger sont dans le schéma de l'app, pas dans `public` | | |
| 1.8 | Le multi-tenant passe par `x_partition`, jamais par une colonne maison | | |
| 1.9 | PostgreSQL, sauf décision M4 contraire | | |
| 1.10 | Si séries temporelles : hypertables Timescale **hors standard**, et c'est écrit dans M4 | | |
| 1.11 | 🤖 Les migrations sont rejouables (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) | | |
| 1.12 | Aucune donnée binaire en base : seulement la référence S3 (`bucket`, `key`) | | |

> Le nom d'une table se lit sans la documentation. Si un lecteur doit demander à quoi sert
> `tr_data2`, le nom est mauvais, même s'il respecte le préfixe.

---

## 2. Identité — tout passe par l'IAM

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 2.1 | 🤖 Aucune table d'utilisateurs, de mots de passe, de sessions dans l'app | | |
| 2.2 | L'identité est lue dans `X-SSO-User` / `X-SSO-Email` / `X-SSO-Scopes` / `X-SSO-Tenant` | | |
| 2.3 | Le tenant vient de `X-SSO-Tenant` et alimente `x_partition` | | |
| 2.4 | 🤖 Rôles et scopes de l'app sont déclarés dans le `manifest.json` (`iam.roles`, `iam.scopes`) | | |
| 2.5 | Le mode SSO de chaque route est décidé (`none` / `optional` / `required`) et justifié | | |
| 2.6 | **Aucune autorisation ne repose sur un rôle SSO** : le SSO n'injecte aucun rôle | | |
| 2.7 | Les chemins publics sont énumérés (`sso.publicPaths`), et on sait pourquoi chacun est public | | |
| 2.8 | Le mapping habilitations US → scopes est rempli (`TEMPLATE-HABILITATIONS.md`) | | |
| 2.9 | Les appels machine à machine valident le jeton contre `IAM_JWKS_URL` | | |
| 2.10 | L'interface traite l'expiration de session à 900 s comme un cas prévu, pas comme une panne | | |

---

## 3. Exposition — tout ce qui sort passe par l'APIM ou le proxy

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 3.1 | Toute API ouverte à un tiers est publiée sur l'**APIM**, jamais exposée en direct | | |
| 3.2 | 🤖 L'app ne vérifie **aucune clé d'API elle-même** : elle lit les en-têtes `X-APIM-*` | | |
| 3.3 | Les scopes d'API suivent `api:<app>:<action>` | | |
| 3.4 | Les appels sortants et inter-apps passent par le Hub — aucun couplage direct app↔app | | |
| 3.5 | 🤖 Aucune clé ni URL de fournisseur LLM en dur : tout passe par la passerelle du Hub | | |
| 3.6 | 🤖 La route proxy vise le **nom du conteneur**, jamais une adresse IP | | |
| 3.7 | L'app écoute en HTTP clair sur son port interne — ni TLS, ni certificat, ni redirection | | |
| 3.8 | Les quotas et la facturation, s'il y en a, sont des réglages APIM, pas du code | | |

---

## 4. Secrets

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 4.1 | 🤖 Aucun secret dans le dépôt : ni `application.yml`, ni `Dockerfile`, ni doc, ni fixture | | |
| 4.2 | Tout secret vient de Vault, sous `soclehub/apps/<app>/…` | | |
| 4.3 | L'absence de `VAULT_TOKEN` fait échouer le démarrage — pas de repli silencieux | | |
| 4.4 | 🤖 Aucun mot de passe en clair dans les fichiers du chantier eux-mêmes | | |

---

## 5. Ce qui ne doit pas être réécrit

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 5.1 | Aucune brique de M6 ne refait un **service du Hub** (`10-TOOLS2USE.md`) : mail, fichiers, antivirus, signature, horodatage, LLM, messagerie, sauvegarde, DNS, TLS, cache | | |
| 5.2 | Aucune brique de M6 ne refait un **mécanisme du socle** (`11-SOCLE-EN-EXECUTION.md`) : ordonnanceur, disjoncteur, réessai, sémaphore, file d'échec, registre d'état, supervision, métriques, corrélation, arrêt | | |
| 5.3 | Les fichiers vont sur S3 via `storage_worker`, jamais sur le disque du conteneur | | |
| 5.4 | Chaque worker de M6 porte une logique **que seule cette app connaît** | | |
| 5.5 | L'interface vient de `@lmvi/ui` par étiquette npm — aucune copie de composant dans l'app | | |

> C'est la ligne la plus rentable de cette grille. Un service réécrit ne se voit pas à la revue de
> code : il se voit trois mois plus tard, quand les deux versions ont divergé.

---

## 6. Architecture applicative

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 6.1 | 🤖 Package `eu.lmvi` | | |
| 6.2 | Chaque worker de M6 correspond à un **template** du socle, nommé dans le plan | | |
| 6.3 | 🤖 Aucun `@Scheduled`, `new Thread()`, `while(true)` prévu dans un worker | | |
| 6.4 | Tout appel externe passe par un `GatewayWorker`, avec ses prédicats d'exception définis | | |
| 6.5 | 🤖 Log4j2, et `spring-boot-starter-logging` exclu de **chaque** starter | | |
| 6.6 | 🤖 `scanBasePackages` contient `eu.lmvi.socle` | | |
| 6.7 | 🤖 Le parent Spring Boot n'est pas figé à la main | | |
| 6.8 | 🤖 `-Xmx` reste sous la cage mémoire déclarée au manifeste | | |
| 6.9 | Les actions MCP exposées sont nommées et décrites dans M6 | | |
| 6.10 | 🤖 Le `/mcp` de l'app répond en `GET` (`status: ready`) et en `POST` | | |

---

## 7. Exploitation

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 7.1 | 🤖 Le manifeste déclare tout ce dont l'app a besoin : `envTemplate` complet | | |
| 7.2 | 🤖 `healthCheckPath` vise `/health`, jamais `/admin/health` | | |
| 7.3 | La supervision métier est prévue — le Hub ne sonde pas l'app en HTTP | | |
| 7.4 | L'arrêt en douceur est pensé : où est sauvegardé le travail en cours | | |
| 7.5 | La durée de vidange est cohérente avec la requête la plus longue de l'app | | |
| 7.6 | La stratégie de sauvegarde est nommée (ce qui est sauvegardé, à quelle fréquence, où) | | |
| 7.7 | Les volumes déclarés correspondent à ce que l'app écrit réellement | | |

---

## 8. Traçabilité — le lien entre le besoin et le code

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 8.1 | 🤖 Chaque exigence de M1 se retrouve dans au moins une US de M2 | | |
| 8.2 | 🤖 Chaque US de M2 est couverte par une brique de M6 (matrice de couverture) | | |
| 8.3 | 🤖 La colonne Tests de la matrice est remplie — aucune US sans test | | |
| 8.4 | Chaque arbitrage de M4 a une décision datée, pas une intention | | |
| 8.5 | Le phasage M5 livre quelque chose d'utilisable à la fin de chaque phase | | |
| 8.6 | Les données à reprendre, s'il y en a, ont leur volumétrie et leur format (`TEMPLATE-INTERFACES-REPRISE.md`) | | |

---

## 9. Qualité — la clause LMVI

| # | Ce qu'on impose | Verdict | Preuve / écart |
|---|---|---|---|
| 9.1 | Aucun simulacre prévu : pas de bouchon, pas de fausse donnée, pas de « en dur pour l'instant » | | |
| 9.2 | Sans dépendance réelle, l'état affiché est **honnête** (`en_attente`), jamais un faux résultat | | |
| 9.3 | Chaque phase se termine par une **démonstration réelle**, pas par une case cochée | | |
| 9.4 | Ce qui n'est pas faisable maintenant est écrit comme tel, pas contourné en silence | | |

---

## Écarts relevés

| # | Ligne | Écart constaté | Levée choisie | Décision M4 ? | Date |
|---|---|---|---|---|---|
| | | | ☐ corriger ☐ arbitrer | | |

---

## Conclusion

> **Go** : aucune ligne en ÉCART ni en À VÉRIFIER.
> **Go sous réserve** : des écarts subsistent, tous rattachés à une décision M4 datée, et aucun ne
> touche les sections 2 (identité), 3 (exposition) ou 4 (secrets) — celles-là ne se négocient pas.
> **No-go** : tout le reste.

Signé : `<qui>` — `<date>`
