# HOWTO documents-02 — Déposer, lire, lister et supprimer un fichier depuis le code de l'app

**Niveau :** Intermédiaire
**Cible :** `eu.lmvi:socle-pack-documents:0.1.0` (tag `v0.1.0`, vendorisé dans `mvn-repo/`) · socle-v005 5.11.2 (minimum 5.10.0) · Spring Boot 4.1.2
**Vérifié au code :** 2026-11-04
**Prérequis :** le pack intégré et configuré ([[howto-documents-01-integrer-le-pack|documents-01]])
**Temps estimé :** 30 min

> Vue d'ensemble du pack : [[README|socle-pack-documents]]

---

## 1. Contexte

TheBeneficiaire reçoit des fichiers par trois portes : le bénéficiaire dépose une pièce (B9), un CV
ou un export LinkedIn à importer (C1, C2), un cabinet dépose dans un dossier partagé (F4). Les trois
passent par RG-26 (antivirus avant garde) et par les plafonds de M4 Q13. Le dossier exporte ses
fichiers (RG-16) et les efface à 14 jours (RG-15). Ce howto montre les appels ; le **contrôle
d'accès** (qui peut déposer dans quel dossier, RG-01, RG-25) reste dans l'app, **avant** l'appel au
pack.

Le **propriétaire** est l'unité de quota et d'isolement : pour TheBeneficiaire, l'identifiant du
dossier (M6 § 4, partition = dossier). Toute lecture le demande ; un autre propriétaire ne voit rien,
pas même que le fichier existe.

---

## 2. Architecture d'un dépôt

```
deposer(DemandeDepot)
  │ 1. paramètres, plafond 20 Mo ──────────────► REFUSE_INVALIDE / REFUSE_TROP_GROS   (aucun appel)
  │ 2. quota (lecture) ────────────────────────► REFUSE_QUOTA                        (aucune analyse)
  │ 3. antivirus (GatewayWorker) ──────────────► REFUSE_INFECTE / ANALYSE_IMPOSSIBLE
  │ 4. réservation du quota sous verrou ───────► REFUSE_QUOTA                        (course perdue)
  │ 5. PUT S3 + SSE AES256 (GatewayWorker) ────► STOCKAGE_IMPOSSIBLE / CHIFFREMENT_NON_GARANTI
  │ 6. confirmation en base
  ▼
GARDE (201) + FichierGarde {id, bucket, cle, sha256, chiffrement, antivirus…}
```

Chaque refus laisse le stockage et la base comme avant. Une réservation laissée par une app arrêtée
en pleine écriture expire au bout de 15 minutes et se nettoie au dépôt suivant du même propriétaire.

---

## 3. Étape 1 — Déposer

```java
package eu.lmvi.thebeneficiaire.dossier;

import eu.lmvi.socle.pack.documents.fichiers.DemandeDepot;
import eu.lmvi.socle.pack.documents.fichiers.FichiersService;
import eu.lmvi.socle.pack.documents.fichiers.ResultatDepot;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

@Service
public class DepotService {

    private final FichiersService fichiers;

    public DepotService(FichiersService fichiers) {
        this.fichiers = fichiers;
    }

    /** L'appelant a déjà vérifié que cette personne peut déposer dans ce dossier (RG-01, RG-25). */
    public ResponseEntity<Map<String, Object>> deposer(String dossierId, MultipartFile f, String iamUserId)
            throws IOException {
        ResultatDepot r = fichiers.deposer(new DemandeDepot(
                dossierId, f.getOriginalFilename(), f.getContentType(), f.getBytes(), iamUserId));
        if (r.garde()) {
            // ranger la référence dans la table de l'app (tr_fichier) : r.fichier().id(), bucket(), cle()
        }
        return ResponseEntity.status(r.codeHttp()).body(r.versMap());
    }
}
```

Réponse d'un refus (`r.versMap()`), prête à afficher :

```json
{
  "statut": "refuse_trop_gros",
  "message": "Ce fichier dépasse la limite de 20,0 Mo par fichier.",
  "conseil": "Réduisez le fichier (PDF compressé, image redimensionnée) ou découpez-le, puis déposez-le de nouveau.",
  "taille_octets": 20971521,
  "taille_max_octets": 20971520
}
```

| Statut | HTTP | Détails rendus | Message type |
|---|---|---|---|
| `garde` | 201 | `fichier` | « Le fichier est gardé. » |
| `refuse_invalide` | 400 | — | « Le fichier est vide. » |
| `refuse_trop_gros` | 400 | `taille_octets`, `taille_max_octets` | « Ce fichier dépasse la limite de 20,0 Mo par fichier. » |
| `refuse_quota` | 400 | `taille_octets`, `utilise_octets`, `quota_octets` | « Ce fichier (14,0 Mo) dépasse l'espace restant : 2,0 Mo sur 30,0 Mo. » |
| `refuse_infecte` | 400 | `menace` | « L'antivirus a trouvé « Eicar-Test-Signature » dans ce fichier : il n'est pas gardé. » |
| `analyse_impossible` | 503 | `motif` | « L'antivirus n'a pas pu analyser ce fichier : il n'est donc pas gardé. » |
| `chiffrement_non_garanti` | 503 | `motif` | « Le stockage ne garantit pas le chiffrement au repos : le fichier n'est pas gardé. » |
| `stockage_impossible` | 503 | `motif` | « Le stockage ne répond pas : le fichier n'est pas gardé. » |
| `indisponible` | 503 | — | « Le dépôt de fichiers n'est pas configuré. » |

Les textes sont en français. L'interface en anglais (Q11) traduit à partir du `statut` et des
détails chiffrés ; le `motif` est technique, pour le journal, pas pour la personne.

---

## 4. Étape 2 — Afficher le quota

```java
Occupation o = fichiers.occupation(dossierId);
// o.utiliseOctets(), o.quotaOctets(), o.restantOctets(), o.tailleMaxOctets(), o.fichiers()
```

`occupation` compte les fichiers gardés et les dépôts en cours. Elle sert l'affichage « 28 Mo sur
200 Mo » (M4 Q13) et ne fait aucun appel au stockage.

---

## 5. Étape 3 — Relire et servir un fichier

```java
@GetMapping("/api/dossiers/{dossierId}/fichiers/{id}")
ResponseEntity<byte[]> telecharger(@PathVariable String dossierId, @PathVariable UUID id) {
    // contrôle d'accès de l'app d'abord
    return fichiers.lire(dossierId, id)
            .map(lu -> ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(lu.fichier().typeMime()))
                    .header("Content-Disposition", ContentDisposition.attachment()
                            .filename(lu.fichier().nomOrigine(), StandardCharsets.UTF_8).build().toString())
                    .body(lu.contenu()))
            .orElse(ResponseEntity.notFound().build());
}
```

`lire` vérifie l'empreinte SHA-256 : un objet altéré sur le stockage lève `FichiersIndisponibles`
(l'app répond 503), il n'est jamais rendu. L'app sert les octets elle-même : même origine, son
contrôle d'accès, aucune adresse présignée.

---

## 6. Étape 4 — Lister, exporter, supprimer

```java
List<FichierGarde> liste = fichiers.lister(dossierId);           // export RG-16 : boucler sur lire()
boolean retire = fichiers.supprimer(dossierId, id);              // objet S3, puis la ligne
int n = fichiers.supprimerTout(dossierId);                       // effacement à 14 jours, RG-15
```

`supprimer` retire d'abord l'objet du stockage. Si le stockage refuse ou ne répond pas, la ligne
reste et `FichiersIndisponibles` est levée : rien n'est déclaré supprimé qui existe encore.

---

## 7. Vérifier

Dans les journaux de l'app, un dépôt écrit une ligne sans contenu ni nom de fichier :

```
[documents][step:depot] propriétaire=<dossier> statut=GARDE taille=48213
```

Une menace : `[documents][step:antivirus] menace « … » dans un dépôt de <dossier> : refusé`.
Un antivirus en panne : `[gateway:documents_antivirus][step:analyse] analyse impossible : …`.

---

## 8. Validation

| # | Test | Attendu |
|---|---|---|
| 1 | dépôt d'un PDF sain par le bénéficiaire | 201, la pièce apparaît dans la liste, le téléchargement rend les mêmes octets |
| 2 | dépôt d'EICAR | 400 `refuse_infecte`, rien dans la liste, rien sur le stockage |
| 3 | dépôt de 21 Mo | 400 `refuse_trop_gros` (et l'app refuse avant si `max-request-size` est posé) |
| 4 | dossier à 199 Mo, dépôt de 2 Mo | 400 `refuse_quota` |
| 5 | lecture du fichier d'un dossier par un autre dossier | 404 |
| 6 | antivirus coupé | 503 `analyse_impossible`, rien de gardé |

---

## 9. Pièges courants

| Piège | Symptôme | Correction |
|---|---|---|
| Contrôle d'accès oublié avant l'appel | un consultant dépose dans un dossier qui ne lui est pas partagé | le pack ne connaît pas les partages : l'app vérifie RG-25 **avant** `deposer` |
| Propriétaire mal choisi (le cabinet, l'utilisateur) | le quota est partagé entre dossiers, ou un dossier voit les fichiers d'un autre | propriétaire = identifiant du **dossier** |
| `ANALYSE_IMPOSSIBLE` affiché comme « fichier infecté » | la personne croit son fichier dangereux | deux messages distincts : 400 menace, 503 réessayer plus tard |
| Référence rangée avant `GARDE` | une ligne de l'app pointe vers un objet qui n'existe pas | ranger `id`/`bucket`/`cle` seulement si `r.garde()` |
| Nom de fichier dans la clé S3 | donnée personnelle dans un identifiant technique | le pack ne l'y met pas ; ne pas construire de clé soi-même |
| `lire` attrapé comme « absent » | un stockage en panne devient « fichier introuvable » | `Optional.empty()` = absent pour ce propriétaire ; `FichiersIndisponibles` = 503 |

---

## 10. Pour aller plus loin

- [[howto-documents-01-integrer-le-pack|documents-01]] — configuration, prérequis du Hub
- M6 APP-36 § 3 (`DossierService`, `DepotService`, `ExportDossierService`), § 7.1 (acceptation K-2)
