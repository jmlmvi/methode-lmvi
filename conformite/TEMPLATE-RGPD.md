<!-- KIT-VERSION: 1.5.0 -->
# RGPD / données personnelles — {{nom du chantier}}

> Template du **volet données personnelles** (pilier conformité). Se remplit avec la SPEC **M1**
> (chaque entité du modèle est passée en revue) et alimente le registre des traitements du client.
> Les choix non triviaux passent en **M4** (arbitrages).

## 1. Inventaire — chaque entité M1 est passée en revue
| Entité / champ | Donnée personnelle ? | Catégorie | Finalité | Base légale | Rétention | Effacement |
|---|---|---|---|---|---|---|
| {{entité.champ}} | oui / **non** | {{identité, contact, usage…}} | {{pourquoi on la traite}} | {{contrat / intérêt légitime / consentement}} | {{durée}} | {{comment (RG-x)}} |

**Règle** : « non » est une réponse valide mais **explicite** — aucune entité sans ligne.

## 2. Le cas LLM (spécifique plateforme)
Les prompts partent via l'**APIM du Hub** (contrat d'architecture §2) vers un provider externe.
- Des données personnelles partent-elles dans les prompts ? {{oui/non — si oui : lesquelles}}
- Mesure : {{anonymisation / pseudonymisation avant appel / aucune (justifier)}} → **arbitrage M4**.
- Providers concernés + localisation : {{minimax, fallback…}}.

## 3. Droits des personnes
| Droit | Comment l'app l'honore |
|---|---|
| Accès / portabilité | {{export — US/RG concernées}} |
| Rectification | {{…}} |
| **Effacement** | {{RG-x — attention : concilier avec « jamais de suppression » des US/RG : effacement = données personnelles, pas artefacts méthode}} |

## 4. Mesures techniques (héritées plateforme — référencer, pas redécrire)
Isolation tenant `x_partition` · secrets Vault · TLS (acme) · habilitations (matrice M1, cellules
« données perso visibles par rôle ») · sauvegardes chiffrées ({{destination}}) · uploads scannés (clamav).

## 5. Definition of Done
- [ ] Chaque entité M1 a sa ligne (oui **ou** non explicite)
- [ ] Le cas LLM est tranché (M4) — jamais de données perso dans les prompts « par défaut »
- [ ] Rétention/effacement cohérents avec les NFR M1 et outillés (RG + tests)
- [ ] Relu par le client (c'est **son** registre des traitements qu'on alimente)
