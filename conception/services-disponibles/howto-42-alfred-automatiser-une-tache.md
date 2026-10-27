---
id: HOWTO-42
titre: "Alfred : confier une tâche à un agent, sans lui donner les clés"
theme: "AUT · Automatisation et agents"
surface: [alfred_admin, AlfredAdminWorker, AlfredExecutorWorker, AlfredSchedulerWorker, AlfredToolBridge, AlfredDenyList, AlfredCron, AlfredRunService, WorkerActionRegistry]
tables: [alfred.z_alfred_task, alfred.z_alfred_run, alfred.z_alfred_run_step]
actions_mcp: 27
routes: ["/hub/alfred", "/hub/alfred/a2a"]
etat_verifie:
  hub: "3.70.3"
  socle: "5.9.4"
  le: "2026-10-16"
  comment: "lu au code et mesuré sur admin.thesocle.net — 12 tâches, 152 runs"
depend_de: "Hub >= 3.70.1 — avant cette version les 27 actions n'étaient pas exposées en MCP (bug 003)"
voisins: [HOWTO-27, HOWTO-41, HOWTO-13]
---

# HOWTO 42 — Alfred : confier une tâche à un agent, sans lui donner les clés

> **Niveau** : avancé | **Prérequis** : SocleHub Hub **≥ 3.70.1** (avant cette version les 27 actions n'étaient pas exposées — voir §1), une clé MCP, un fournisseur LLM provisionné dans AgentIA avec son secret dans Vault | **Temps estimé** : 30 min

Ce guide montre comment **créer une tâche Alfred, lui donner exactement les outils qu'il faut et pas
un de plus, la déclencher, et lire ce qu'elle a fait**. Alfred est l'agent d'exécution du Hub : il
reçoit une consigne en langage naturel, choisit ses outils dans une **liste blanche**, et travaille
sous quatre garde-fous — étapes, jetons, délai, cadence.

La partie qui mérite le plus d'attention n'est pas la création d'une tâche, c'est **le calcul de ce
qu'Alfred peut réellement invoquer** : il traverse une liste blanche, un registre, une liste
d'interdits et des réglages d'exécution, et le résultat n'est pas celui qu'on croit. §5 et le
piège 3 y sont consacrés.

État de référence : Hub **3.70.3**, socle **5.9.4**, mesuré sur `admin.thesocle.net` le
**2026-10-16**. En production : **12 tâches**, 152 exécutions, 3,54 M de jetons sur la journée pour
un budget de 20 M.

---

## Questions auxquelles répond cette fiche

1. Comment confier une tâche récurrente à un agent, en langage naturel ?
2. Comment limiter ce qu'un agent peut faire — et comment savoir ce qu'il peut *vraiment* faire ?
3. Que vaut exactement le marqueur `@readonly` dans une liste blanche ?
4. Ma tâche `CRON` est activée et son expression est valable : pourquoi ne part-elle jamais ?
5. Pourquoi `next_run` affiche-t-il une heure décalée de deux heures par rapport à mon cron ?
6. Une tâche `EVENT` suffit-elle à être déclenchée, ou faut-il autre chose ?
7. Comment déclencher sur l'arrivée d'un mail, d'un message KvBus ou d'une file JetStream ?
8. Quels sont les plafonds par défaut — étapes, jetons, délai — et que se passe-t-il à la limite ?
9. Que signifie le statut `stuck`, et comment savoir sur quoi l'agent a renoncé ?
10. Un `budget_exceeded` vient-il de ma tâche ou du budget global de la journée ?
11. Pourquoi Alfred est-il en pause alors que personne ne l'a mis en pause ?
12. Comment couper tout net en cas d'incident ?
13. La liste d'interdits garantit-elle qu'Alfred ne peut rien détruire ?
14. Où est stocké le secret du fournisseur LLM qu'Alfred consomme ?
15. Comment lire ce qu'une exécution a réellement fait, étape par étape ?
16. Pourquoi certaines tâches de production ont-elles été créées directement en base ?

## Mots-clés

Alfred, agent d'exécution, tâche, `create_task`, `run_now`, `abort_run`, `trigger_type`, `CRON`,
`EVENT`, `MANUAL`, `next_run`, `cron_expr`, cron 5 champs, `Europe/Paris`, `skip_next`,
liste blanche, whitelist, `@readonly`, `readOnly`, liste d'interdits, deny-list, `AlfredDenyList`,
préfixe interdit, `purge_`, `delete_`, registre d'actions, `WorkerActionRegistry`, bug 003,
`ObjectProvider`, garde-fou, `max_steps`, `budget_tokens`, `timeout_seconds`, `max_runs_per_hour`,
`BUDGET_EXCEEDED`, `TIMEOUT`, `STUCK`, enlisement, `max_consecutive_tool_errors`, kill-switch,
`pause_all`, `resume_all`, budget journalier, `budget.daily_tokens`, veille, watch, `add_mail_watch`,
`add_kvbus_watch`, `add_queue_watch`, E1, E2, E4, run, étape, `get_run`, `with_steps`, rétention,
AgentIA, MiniMax-M3, repli Haiku, Vault, `agentia/tenants/alfred`, A2A, pair, `ask_peer`,
tâche enfant, sous-run

---

## 1. Contexte — et pourquoi cette fiche n'existait pas avant aujourd'hui

Jusqu'au Hub **3.70.0**, les 27 actions d'`alfred_admin` étaient **déclarées dans le code et
publiées à personne**. Un `Worker` qui injecte `WorkerActionRegistry` à la construction déclenche le
`@PostConstruct` du registre, lequel s'indexe par `getBeansOfType(Worker.class)` — où Spring écarte
en silence un singleton en cours de création. Alfred s'excluait lui-même de son propre registre
(fiche `soclehub/docs/bugsExplicite/003-ActionsWorkerDeclareesNonExposeesEnMCP.md`).

**Ce détail d'histoire n'est pas anecdotique, il explique l'état de la production.** Pendant ces
mois, la seule façon de créer une tâche était d'écrire directement dans
`alfred.z_alfred_task` — ce qui **contourne la validation, le calcul de `next_run` et l'audit**.
Deux tâches de production en portent encore la trace, et le piège 1 montre laquelle ne peut
structurellement jamais partir.

Corrigé en **3.70.1**, cause racine en **socle 5.9.4** (Hub 3.70.3). Le compte d'outils MCP est
passé de 503 à **534**. Depuis, tout ce qui suit s'appelle normalement.

---

## 2. Architecture

**En une phrase, la vie d'une exécution.** Une tâche part de l'une de trois façons : l'ordonnanceur
la trouve due (`next_run ≤ maintenant`), une veille E1/E2/E4 la désigne, ou un humain fait
`run_now`. L'exécuteur vérifie d'abord le kill-switch puis le budget journalier global, puis il
**calcule les outils offerts** — la liste blanche développée, intersectée avec le registre
d'actions, moins la liste d'interdits. Il boucle ensuite au plus `max_steps` fois : à chaque tour il
contrôle le délai et les jetons consommés, appelle le LLM, et exécute l'outil demandé. Il sort sur
une réponse finale, un plafond atteint (`TIMEOUT`, `BUDGET_EXCEEDED`), ou un enlisement détecté
(`STUCK`). Tout est écrit dans `z_alfred_run` et `z_alfred_run_step`. Le schéma ci-dessous détaille
chacun de ces contrôles.

```
  ┌──────────────── DÉCLENCHEURS ────────────────┐
  │ CRON    AlfredSchedulerWorker                │
  │         next_run ≤ now, SELECT … FOR UPDATE   │
  │         SKIP LOCKED  ⚠️ piège 1               │
  │ EVENT   E1 boîte mail  (add_mail_watch)      │
  │         E2 topic KvBus (add_kvbus_watch)     │
  │         E4 file JetStream (add_queue_watch)  │
  │ MANUAL  run_now                              │
  └───────────────────┬──────────────────────────┘
                      │   AlfredTriggerService.fireTask()
                      ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ AlfredExecutorWorker — la boucle d'un run                   │
  │                                                             │
  │  0. kill-switch (pause_all) ? ────────────► rien ne part    │
  │  1. budget journalier global dépassé ? ───► BUDGET_EXCEEDED │
  │                                             + pause_all     │
  │  2. whitelist  ──► AlfredToolBridge.resolveEffective()      │
  │        @readonly ─┐                                         │
  │        ids nommés ┼─► ∩ registre ─ deny-list ─► outils      │
  │        marqueurs ─┘                  (§5)       offerts     │
  │                                                             │
  │  3. pour chaque étape, au plus max_steps (défaut 15) :      │
  │       ├─ délai dépassé (défaut 300 s) ? ──► TIMEOUT         │
  │       ├─ jetons ≥ budget (défaut 100 000) ? ► BUDGET_EXCEEDED│
  │       ├─ appel LLM (AgentIA → MiniMax-M3, repli Haiku 4.5)  │
  │       └─ appel d'outil → registre d'actions                 │
  │     sortie sans réponse finale ──► « max_steps atteint »    │
  │                                                             │
  │  garde-fous d'enlisement : 3 erreurs d'outil consécutives,  │
  │  8 outils distincts en échec ──► STUCK                      │
  └─────────────────────────────────────────────────────────────┘
                      │
                      ▼
      alfred.z_alfred_run + z_alfred_run_step
      (rétention : 90 j les runs, 30 j les étapes)
```

### Les trois natures de déclencheur

| `trigger_type` | Ce qui l'arme | `cron_expr` | Remarque |
|---|---|---|---|
| `CRON` | l'ordonnanceur, sur `next_run` | **obligatoire** | 5 champs ; voir le piège 2 pour le fuseau |
| `EVENT` | une veille E1/E2/E4 | — | la tâche ne part que si un `watch` la cible |
| `MANUAL` | `run_now` uniquement | — | pour une tâche jetable ou une recette |

`trigger_type` hors de ces trois valeurs est refusé net : `trigger_type ∈ {CRON,EVENT,MANUAL}`.

---

## 3. Étape 1 — Créer une liste blanche avant la tâche

Dans cet ordre, et pas l'inverse : une tâche sans liste blanche ne peut rien faire, et une liste
blanche trop large est le seul vrai risque de ce dispositif.

```bash
mcp__soclehub__alfred_admin__create_whitelist \
  whitelist_name="veille-rss" \
  whitelist_description="Lecture du catalogue RSS + invocation du MCP de l'app" \
  actions="@readonly,mcp_proxy_worker__mcp_proxy_invoke,mcp_proxy_worker__mcp_proxy_list_tools"
```

Les listes blanches livrées avec le Hub (`seeded: true`) servent de modèles. Celle nommée `apps`,
par exemple :

```json
{"id":3,"name":"apps","seeded":true,
 "description":"Lecture seule + cycle de vie non destructif des apps (restart/start) + invocation mcp_proxy.",
 "actions":["@readonly","docker_worker__restart_app","docker_worker__start_app",
            "mcp_proxy_worker__mcp_proxy_invoke","mcp_proxy_worker__mcp_proxy_list_apps"]}
```

Le motif est celui à reprendre : **`@readonly` pour tout voir, puis les quelques écritures
nommées une par une.** Jamais l'inverse.

```bash
mcp__soclehub__alfred_admin__list_whitelists
mcp__soclehub__alfred_admin__update_whitelist  whitelist_id="9"  actions="…"
mcp__soclehub__alfred_admin__delete_whitelist  whitelist_id="9"
```

---

## 4. Étape 2 — Créer la tâche

```bash
mcp__soclehub__alfred_admin__create_task \
  task_name="veille-rss-2h" \
  prompt="Relève les nouveautés du catalogue RSS et résume en dix lignes ce qui concerne le Hub." \
  trigger_type="CRON" \
  cron_expr="0 */2 * * *" \
  whitelist="veille-rss" \
  max_steps="12" \
  budget_tokens="80000" \
  timeout_seconds="240" \
  max_runs_per_hour="1" \
  notify_on_error="jm@henry.sh" \
  expires_at="2026-12-31T00:00:00Z"
# → {"task_id": 13, "next_run": "2026-10-16T18:00:00Z"}
```

**`create_task` rend `next_run` : c'est la preuve que la tâche partira.** Si ce champ revient
`null` sur une tâche `CRON`, la tâche est inerte — c'est tout le piège 1.

Les quatre garde-fous et leurs valeurs par défaut, lues dans l'exécuteur :

| Paramètre | Défaut si omis | Ce qui se passe à la limite |
|---|--:|---|
| `max_steps` | **15** | sortie avec `max_steps atteint sans réponse finale` |
| `timeout_seconds` | **300** | statut `TIMEOUT` |
| `budget_tokens` | **100 000** | statut `BUDGET_EXCEEDED` |
| `max_runs_per_hour` | — | déclenchements au-delà refusés |

Les défauts sont généreux. **Les réduire est le réflexe à prendre** : une tâche de veille qui lit
trois pages n'a pas besoin de 15 étapes ni de 100 000 jetons, et les plafonds serrés sont ce qui
transforme une erreur de consigne en échec propre plutôt qu'en facture.

```bash
mcp__soclehub__alfred_admin__pause_task   task_id="13"     # désactive
mcp__soclehub__alfred_admin__resume_task  task_id="13"
mcp__soclehub__alfred_admin__skip_next    task_id="13"     # saute une occurrence
mcp__soclehub__alfred_admin__delete_task  task_id="13"     # suppression logique
mcp__soclehub__alfred_admin__run_now      task="veille-rss-2h"  context="essai à la main"
mcp__soclehub__alfred_admin__abort_run    run="412"        # interrompt un run en cours
```

---

## 5. Comprendre ce qu'Alfred peut vraiment appeler

C'est le cœur du dispositif, et il se calcule en trois temps.

**1 — La liste blanche est développée.** `@readonly` ajoute **toutes les actions déclarées
`readOnly` de tous les workers du registre**. Les entrées nommées `worker__action` s'ajoutent, à
condition d'exister au registre.

**2 — L'intersection avec le registre.** Une action absente du registre n'est **pas** invocable,
même nommée explicitement dans la liste blanche. C'est pourquoi le défaut du §1 amputait aussi les
capacités d'Alfred : les 31 actions manquantes étaient invisibles de sa propre liste blanche.

**3 — La liste d'interdits, qui a le dernier mot.** `AlfredDenyList` est **codée en dur, non
configurable**, et s'applique **après** tout le reste : 30 noms d'action exacts, plus six préfixes
(`purge_`, `drop_`, `delete_`, `revoke_`, `uninstall_`, `destroy_`). Elle est volontairement
*fail-closed* : un identifiant nul ou vide est refusé.

```bash
# Ce que @readonly vaut aujourd'hui dépend du registre, donc de la version du Hub :
mcp__soclehub__scan_guard_worker__get_status   # exemple de worker dont les lectures entrent dans @readonly
```

> 💡 **Le défaut de `readOnly` est `false`** — vérifié au bytecode de `socle-v005-5.9.4.jar`
> (`ActionMetadata$Builder()` initialise le champ à `iconst_0`). Les **287 actions sur 475 qui ne
> déclarent pas `readOnly`** sont donc traitées comme des **écritures** et **n'entrent pas** dans
> `@readonly`. C'est le bon sens du défaut : `@readonly` sous-estime ses droits plutôt que de les
> sur-estimer. Mais c'est aussi pourquoi `@readonly` seul laisse Alfred plus démuni qu'on ne
> l'imagine, et pourquoi il faut nommer les lectures manquantes une par une.

---

## 6. Étape 3 — Déclencher sur un événement plutôt que sur l'heure

```bash
# E1 — une boîte mail : chaque message non lu déclenche la tâche
mcp__soclehub__alfred_admin__add_mail_watch \
  mailbox="nestor@thesocle.net"  poll_seconds="60"  task="13"  whitelist="veille-rss"

# E2 — un topic KvBus interne, avec filtre sur la charge utile
mcp__soclehub__alfred_admin__add_kvbus_watch \
  topic_pattern="app.*.incident"  payload_filter="severity=high"  task="13"

# E4 — une file JetStream
mcp__soclehub__alfred_admin__add_queue_watch \
  queue_subject="hub.incidents"  consumer_name="alfred-incidents"  whitelist="incident-app"

mcp__soclehub__alfred_admin__list_watches   type="mail"
mcp__soclehub__alfred_admin__update_watch   type="mail"  id="2"  enabled="false"
mcp__soclehub__alfred_admin__remove_watch   type="mail"  id="2"
```

⚠️ **Une veille mail consomme les messages qu'elle lit.** Si un autre dispositif relève la même
boîte — le scanner de pièces jointes, par exemple — l'un marque les messages lus et l'autre ne les
voit jamais. Ne pas partager une boîte entre deux relèves.

---

## 7. Étape 4 — Lire ce qui s'est passé

```bash
mcp__soclehub__alfred_admin__list_tasks   filter="enabled"
mcp__soclehub__alfred_admin__get_task     task="veille-rss-2h"
mcp__soclehub__alfred_admin__list_runs    task="13"  status="error"  limit="20"
mcp__soclehub__alfred_admin__get_run      run="412"  with_steps="true"
mcp__soclehub__alfred_admin__get_stats    period="day"
```

`get_stats` en production, le 2026-10-16 :

```json
{"runs_total":152,"runs_error":4,
 "by_status":{"success":146,"budget_exceeded":4,"stuck":2},
 "tokens":3542121,"daily_tokens_used":3542121,"daily_token_budget":20000000,"paused":false}
```

Les statuts à savoir lire : `success`, `budget_exceeded` (plafond de la tâche **ou** budget
journalier global), `timeout`, `stuck` (enlisement détecté — 3 erreurs d'outil consécutives, ou
8 outils distincts en échec), `aborted` (`abort_run`).

`get_run(with_steps=true)` donne le détail étape par étape : quel outil, quels arguments, quelle
réponse. **C'est la seule façon de comprendre un `stuck`** — le statut dit qu'Alfred a renoncé, les
étapes disent sur quoi.

### Le kill-switch

```bash
mcp__soclehub__alfred_admin__pause_all     # suspend TOUT déclenchement, immédiatement
mcp__soclehub__alfred_admin__resume_all
```

`pause_all` est aussi **déclenché automatiquement** quand le budget journalier global est dépassé.
Donc un `paused: true` inattendu n'est pas forcément un geste humain : vérifier
`daily_tokens_used` contre `daily_token_budget` avant de simplement reprendre.

### Les réglages d'exécution

```bash
mcp__soclehub__alfred_admin__get_settings
mcp__soclehub__alfred_admin__update_setting  setting_key="budget.daily_tokens"  setting_value="20000000"
```

Extrait de la production, qui montre ce qui est réglable à chaud :

```
llm.model = minimax/MiniMax-M3        llm.fallback = openrouter/anthropic/claude-haiku-4-5
llm.vault_path = agentia/tenants/alfred     llm.vault_key = api_key
budget.daily_tokens = 20000000        notify.default = jm@henry.sh
retention.days_runs = 90              retention.days_steps = 30
web.search_enabled = true             web.search_engines = mojeek,qwant,bing
web.fetch_endpoint = http://browserless:3000/content
guard.max_consecutive_tool_errors = 3 guard.max_distinct_failed_tools = 8
```

Le secret du LLM n'est **jamais** dans ces réglages : seul son chemin Vault y figure.

---

## 8. Validation

```bash
# 1. la tâche existe et porte un next_run
get_task task="veille-rss-2h"   → next_run non nul, enabled true

# 2. elle s'exécute à la demande
run_now task="veille-rss-2h"    → un run_id

# 3. le run est allé au bout, et avec les bons outils
get_run run="<id>" with_steps=true
  → status success, et AUCUNE étape « outil hors whitelist »

# 4. le compte global a bougé
get_stats period="day"          → runs_total +1
```

Le signe qui compte à l'étape 3 : une étape portant `outil hors whitelist` signifie que le LLM a
tenté un outil qu'on ne lui a pas donné. **Ce n'est pas une alerte de sécurité** — le garde-fou a
fonctionné — mais c'est le signe que la consigne et la liste blanche ne se correspondent pas, et que
les étapes partent en tentatives inutiles.

---

## 9. Pièges courants

### Piège 1 — 🔴 Une tâche `CRON` sans `next_run` ne partira jamais, et rien ne le signale

**Symptôme** : une tâche `CRON` avec une expression parfaitement valable, activée, qui ne s'exécute
pas. Aucune erreur, aucun run, aucune ligne de journal.

**Cause** : l'ordonnanceur sélectionne les tâches dues par
`WHERE enabled = TRUE AND trigger_type = 'CRON' AND next_run IS NOT NULL AND next_run <= ?`.
Une tâche à `next_run = NULL` **n'est jamais candidate**. Or `next_run` n'est calculé que par
`create_task`/`update_task` — une insertion directe en base ne le remplit pas.

**Mesuré** en production, parmi les 12 tâches : `sonde-alfred-vivant` (id 6), `trigger_type: CRON`,
`cron_expr: "* * * * *"`, **`next_run: null`**. Elle est inerte depuis sa création, quelle que soit
sa cadence.

**Résolution** : `update_task` sur la tâche — il recalcule `next_run` depuis `cron_expr`. Et la
règle générale : **ne jamais créer une tâche Alfred par écriture directe en base.** C'était la
seule voie avant le Hub 3.70.1 ; ça n'en est plus une. Pour auditer l'existant :

```bash
mcp__soclehub__alfred_admin__list_tasks
# toute ligne trigger_type=CRON avec next_run vide est à reprendre
```

### Piège 2 — Le cron se lit en heure de Paris, `next_run` s'écrit en UTC

**Symptôme** : une tâche réglée à `0 8 * * *` affiche `next_run: 2026-10-17T06:00:00Z` et on croit
à un décalage de deux heures.

**Cause** : les expressions sont évaluées dans `Europe/Paris` (`AlfredCron`), tandis que `next_run`
est un instant, donc rendu en UTC. 08:00 Paris en heure d'été = 06:00 UTC. **Mesuré** sur la tâche
`rssarchiver-compte-rendu-matin` : `cron = "0 8 * * *"`, `next_run = 2026-10-17T06:00:00Z`.

**Résolution** : aucune, c'est correct. Mais s'en souvenir en relisant un `next_run`, et savoir
que **le décalage change deux fois par an** : la même tâche basculera à `07:00:00Z` à l'heure
d'hiver.

### Piège 3 — 🔴 La liste d'interdits filtre un **préfixe de nom**, donc la convention de nommage décide

**Symptôme** : on croit qu'Alfred ne peut rien purger ni supprimer, puisque `purge_` et `delete_`
sont interdits.

**Cause** : `AlfredDenyList` extrait le **dernier segment** de `worker__action` et teste des
préfixes. Une action dont le verbe est en **suffixe** passe au travers. Conséquences vérifiables
sur les noms réellement publiés :

| Action | Verdict | Pourquoi |
|---|---|---|
| `nats_worker__purge_stream` | ❌ interdite | nom exact listé, et préfixe `purge_` |
| `cache_worker__cache_purge_all` | ✅ **autorisée** | ne *commence* pas par `purge_` |
| `storage_worker__storage_purge_trash` | ✅ **autorisée** | idem |
| `iam_worker__delete_tenant` | ❌ interdite | nom exact listé |
| `salon_worker__salon_type_delete` | ✅ **autorisée** | le verbe est en suffixe |

Le commentaire du code assume le choix du filtrage par nom seul (« plus restrictif qu'un couple
worker+action, pour barrer une action destructrice même si un autre worker venait à l'exposer sous
le même nom ») — ce qui est vrai, mais ne couvre pas le nommage en suffixe.

**Résolution** : ne pas considérer la liste d'interdits comme une garantie, mais comme un dernier
rempart. **La vraie protection est la liste blanche**, qui est une autorisation explicite. Ne jamais
écrire une liste blanche large en se disant que la liste d'interdits rattrapera.

### Piège 4 — `@readonly` donne beaucoup moins que son nom ne promet

**Symptôme** : une tâche avec `actions="@readonly"` échoue en boucle sur « outil hors whitelist »
pour des actions qui sont manifestement des lectures.

**Cause** : `@readonly` ne retient que les actions **déclarant** `readOnly(true)`. Le défaut du
framework est `false`, et **287 actions sur 475 ne le déclarent pas** — elles sont donc hors de
`@readonly`, qu'elles lisent ou non. `get_status`, par exemple, le déclare partout ; beaucoup de
`list_*` ne le déclarent pas.

**Résolution** : partir de `@readonly`, puis **lire les étapes du premier run** et ajouter
nommément les lectures refusées. L'annexe du catalogue
([[CATALOGUE-ANNEXE-ACTIONS-MCP|les 475 actions]]) porte la colonne `L` : `✓` lecture déclarée,
`✗` écriture, `?` non déclaré — les `?` sont exactement ceux qu'il faudra nommer.

### Piège 5 — Un `BUDGET_EXCEEDED` peut avoir deux causes très différentes

**Symptôme** : 4 runs en `budget_exceeded` sur 152. On augmente `budget_tokens` de la tâche, et rien
ne change.

**Cause** : deux plafonds distincts rendent le même statut — celui de la tâche
(`budget_tokens`, 100 000 par défaut) et le **budget journalier global**
(`budget.daily_tokens`, 20 M en production). Le second, en plus, **déclenche `pause_all`** : tout
Alfred s'arrête, pas seulement la tâche fautive.

**Résolution** : lire `get_stats` avant de toucher à la tâche. Si `daily_tokens_used` approche
`daily_token_budget`, le problème est global. Et si `paused: true`, vérifier que ce n'est pas la
mise en pause automatique avant de faire `resume_all` — sinon le budget se représente aussitôt.

### Piège 6 — Un `stuck` n'est pas un plantage, c'est un renoncement

**Symptôme** : statut `stuck`, aucune exception, aucun message d'erreur clair.

**Cause** : deux garde-fous d'enlisement, réglables à chaud —
`guard.max_consecutive_tool_errors` (3) et `guard.max_distinct_failed_tools` (8). Au-delà, Alfred
arrête de son propre chef plutôt que de brûler le budget en tâtonnant.

**Résolution** : `get_run(run, with_steps=true)` et regarder **quels** outils ont échoué. Dans la
grande majorité des cas, la cause est une liste blanche incomplète (piège 4) : Alfred tente, se fait
refuser, retente autrement, et atteint le plafond d'erreurs distinctes.

### Piège 7 — Une tâche `EVENT` sans `watch` est un piège silencieux

**Symptôme** : tâche `trigger_type: EVENT`, activée, qui ne part jamais.

**Cause** : `EVENT` ne décrit qu'une **aptitude** à être déclenchée. Ce qui déclenche est le
`watch` — et c'est le `watch` qui désigne la tâche, pas l'inverse. Une tâche `EVENT` sans aucun
`watch` pointant sur elle est aussi inerte qu'une tâche `CRON` sans `next_run`, pour une raison
entièrement différente. En production, `nestor-reception` (id 2) est la seule tâche `EVENT`.

**Résolution** : après `create_task` en `EVENT`, toujours `list_watches` et vérifier qu'un watch
porte bien le `task` voulu. Et noter que `whitelist` peut être redéfinie **au niveau du watch** :
c'est elle qui s'applique alors, pas celle de la tâche.

---

## 10. Pour aller plus loin

- [[CATALOGUE-FONCTIONS-TSH|Catalogue des fonctions mutualisées]] — §10, les 27 actions et la surface A2A,
- [[CATALOGUE-ANNEXE-ACTIONS-MCP|Annexe des 475 actions]] — la colonne `L`, pour composer une liste blanche sans tâtonner,
- [[howto-27-configurer-agentia-gateway|HOWTO 27 — AgentIA]] — le fournisseur LLM, les quotas et les tarifs qu'Alfred consomme,
- [[howto-41-salons-echanger-entre-sessions|HOWTO 41 — Salons]] — où Alfred rend compte, et le type `CARNET_DE_BORD`,
- `soclehub/docs/bugsExplicite/003-ActionsWorkerDeclareesNonExposeesEnMCP.md` — le défaut du §1, sa cause racine et sa sonde,
- `soclehub/src/main/java/eu/lmvi/soclehub/alfred/service/AlfredDenyList.java` — les 30 noms et 6 préfixes interdits, 104 lignes,
- `soclehub/src/main/java/eu/lmvi/soclehub/alfred/worker/AlfredExecutorWorker.java` — la boucle, les plafonds et leurs défauts.
