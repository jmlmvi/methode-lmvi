#!/usr/bin/env bash
# Contrôle avant go — les points mécaniques de TEMPLATE-CONTROLE-AVANT-GO.md
#
#   ./controle-avant-go.sh <dossier-app>        ex. ./controle-avant-go.sh /opt/.../APP-23-Carousel
#
# Rend un verdict par point : OK, ECART, S.O. ou A VERIFIER.
# Sortie 0 si aucun écart, 1 sinon — utilisable en garde-fou.
#
# Ce script ne juge QUE ce qui se vérifie sans interprétation. Tout le reste
# (architecture, habilitations, traçabilité du besoin) reste à l'œil humain :
# un script qui prétendrait trancher ces points-là donnerait une fausse assurance.

set -uo pipefail

APP_DIR="${1:-}"
[ -n "$APP_DIR" ] && [ -d "$APP_DIR" ] || { echo "usage: $0 <dossier-app>" >&2; exit 2; }
APP_DIR="$(cd "$APP_DIR" && pwd)"

OK=0; ECARTS=0; SO=0; INCONNU=0
VERT=$'\033[32m'; ROUGE=$'\033[31m'; JAUNE=$'\033[33m'; GRIS=$'\033[90m'; RAZ=$'\033[0m'

ok()      { printf "  ${VERT}OK${RAZ}         %-6s %s\n" "$1" "$2"; OK=$((OK+1)); }
ecart()   { printf "  ${ROUGE}ECART${RAZ}      %-6s %s\n" "$1" "$2"; ECARTS=$((ECARTS+1)); }
so()      { printf "  ${GRIS}S.O.${RAZ}       %-6s %s\n" "$1" "$2"; SO=$((SO+1)); }
inconnu() { printf "  ${JAUNE}A VERIFIER${RAZ} %-6s %s\n" "$1" "$2"; INCONNU=$((INCONNU+1)); }
titre()   { printf "\n\033[1m%s\033[0m\n" "$1"; }

# --- repérage des fichiers -----------------------------------------------------
# Une app suit la structure APP-XX-Nom/<appid>/ : on prend le premier sous-dossier
# qui porte un pom.xml, sinon la racine.
SRC_DIR="$(dirname "$(find "$APP_DIR" -maxdepth 2 -name pom.xml -not -path '*/target/*' | head -1)" 2>/dev/null)"
[ -d "${SRC_DIR:-}" ] || SRC_DIR="$APP_DIR"
MANIFEST="$(find "$APP_DIR" -maxdepth 3 -name manifest.json -not -path '*/node_modules/*' | head -1)"
SQL_FILES="$(find "$APP_DIR" -path '*/sql/*.sql' -not -path '*/target/*' 2>/dev/null)"
POM="$SRC_DIR/pom.xml"
CHANTIER="$APP_DIR/docs/chantier"

echo "Contrôle avant go — $(basename "$APP_DIR")"
echo "  sources : ${SRC_DIR#$APP_DIR/}"
echo "  manifeste : ${MANIFEST:-absent}"
echo "  SQL : $(echo "$SQL_FILES" | grep -c . ) fichier(s)"

# =============================================================== 1. Données ====
titre "1. Données"

if [ -z "$SQL_FILES" ]; then
  so "1.2-1.7" "aucun fichier SQL — app sans base ?"
else
  # 1.2 préfixes de table
  MAUVAIS=$(grep -hoiE 'CREATE TABLE (IF NOT EXISTS )?[a-z_]+\.([a-z_]+)' $SQL_FILES 2>/dev/null \
            | sed -E 's/.*\.//' | grep -vE '^(z_|db_|tr_)' | sort -u)
  [ -z "$MAUVAIS" ] && ok "1.2" "toutes les tables ont un préfixe z_/db_/tr_" \
                    || ecart "1.2" "préfixe manquant : $(echo $MAUVAIS | tr '\n' ' ')"

  # 1.3 colonnes techniques
  MANQUE=""
  for c in x_id x_dateCreated x_dateChanged x_sub x_partition x_version x_active \
           x_createdBy x_updatedBy x_comment x_keyhash x_hash x_datas; do
    grep -qi "$c" $SQL_FILES 2>/dev/null || MANQUE="$MANQUE $c"
  done
  [ -z "$MANQUE" ] && ok "1.3" "les 13 colonnes x_* sont présentes" \
                   || ecart "1.3" "colonnes absentes :$MANQUE"

  # 1.4 le moment du trigger — le piège silencieux
  MAUVAIS_MOMENT=$(grep -hiB2 'update_changed_fields' $SQL_FILES 2>/dev/null | grep -ci 'AFTER UPDATE')
  BON_MOMENT=$(grep -hiB2 'update_changed_fields' $SQL_FILES 2>/dev/null | grep -ci 'BEFORE UPDATE')
  if [ "$MAUVAIS_MOMENT" -gt 0 ]; then
    ecart "1.4" "update_changed_fields en AFTER UPDATE — x_dateChanged et x_version resteront vides"
  elif [ "$BON_MOMENT" -gt 0 ]; then
    ok "1.4" "update_changed_fields en BEFORE UPDATE"
  else
    inconnu "1.4" "trigger update_changed_fields introuvable"
  fi

  # 1.5 audit désactivé
  NB_AUDIT=$(grep -hoiE 'CREATE TRIGGER after_(insert|update|delete)_audit' $SQL_FILES 2>/dev/null | wc -l)
  NB_DISABLE=$(grep -hoi 'DISABLE TRIGGER' $SQL_FILES 2>/dev/null | wc -l)
  if [ "${NB_AUDIT:-0}" -eq 0 ]; then inconnu "1.5" "aucun trigger d'audit trouvé"
  elif [ "${NB_DISABLE:-0}" -ge "${NB_AUDIT:-0}" ]; then ok "1.5" "$NB_AUDIT triggers d'audit, tous désactivés"
  else ecart "1.5" "$NB_AUDIT triggers d'audit pour seulement $NB_DISABLE DISABLE"; fi

  # 1.6 propriétaire
  if grep -qiE '^[^-]*ALTER (TABLE|SEQUENCE).*OWNER TO admin' $SQL_FILES 2>/dev/null; then
    ecart "1.6" "ALTER OWNER TO admin — échoue quand l'app exécute son init.sql"
  else ok "1.6" "aucun ALTER OWNER TO admin"; fi

  # 1.7 fonctions hors public
  if grep -qiE 'FUNCTION public\.(z_after|update_changed)' $SQL_FILES 2>/dev/null; then
    ecart "1.7" "fonctions de trigger dans public — l'utilisateur de l'app n'a pas ce droit"
  else ok "1.7" "fonctions de trigger dans le schéma de l'app"; fi

  # 1.11 migrations rejouables
  MIG=$(find "$APP_DIR" -path '*migrations*' -name '*.sql' 2>/dev/null)
  if [ -z "$MIG" ]; then so "1.11" "aucune migration"
  else
    NON_REJOUABLE=$(grep -lEi '^[[:space:]]*(CREATE TABLE|ALTER TABLE [a-z_.]+ ADD COLUMN)[[:space:]]+(?!IF NOT EXISTS)' $MIG 2>/dev/null | head -3)
    NON_REJOUABLE=$(grep -lE '^[[:space:]]*CREATE TABLE [^I]' $MIG 2>/dev/null | head -3)
    [ -z "$NON_REJOUABLE" ] && ok "1.11" "migrations rejouables (IF NOT EXISTS)" \
                            || ecart "1.11" "migration non rejouable : $(basename $(echo "$NON_REJOUABLE"|head -1))"
  fi
fi

# =============================================================== 2. Identité ===
titre "2. Identité"

USERS=$(grep -hoiE 'CREATE TABLE (IF NOT EXISTS )?[a-z_]*\.?(z_|db_|tr_)?(users?|utilisateurs?|accounts?|sessions?|passwords?)\b' $SQL_FILES 2>/dev/null | sort -u)
[ -z "$USERS" ] && ok "2.1" "aucune table d'utilisateurs / sessions / mots de passe" \
               || ecart "2.1" "table d'identité dans l'app : $(echo $USERS | tr '\n' ' ')"

if [ -n "$MANIFEST" ]; then
  if grep -q '"iam"' "$MANIFEST" && grep -qE '"(roles|scopes)"' "$MANIFEST"; then
    ok "2.4" "rôles et scopes déclarés au manifeste"
  else ecart "2.4" "ni roles ni scopes dans manifest.json"; fi
else inconnu "2.4" "manifest.json introuvable"; fi

# ============================================================= 3. Exposition ===
titre "3. Exposition"

if [ -d "$SRC_DIR/src" ]; then
  # On cherche l'app qui LIT une clé entrante pour la valider, pas celle qui en
  # ENVOIE une au Hub sur un appel sortant (parfaitement légitime, cf. 10-TOOLS2USE §3).
  if grep -rqE '(getHeader|@RequestHeader)[^)]*[Xx]-[Aa]pi-[Kk]ey' "$SRC_DIR/src" --include=*.java 2>/dev/null \
     && ! grep -rq 'X-APIM-' "$SRC_DIR/src" --include=*.java 2>/dev/null; then
    ecart "3.2" "l'app valide une clé d'API entrante au lieu de lire les en-têtes X-APIM-*"
  else ok "3.2" "aucune validation de clé maison (un envoi de clé vers le Hub est normal)"; fi

  if grep -rqE 'api\.(openai|anthropic)\.com|sk-[A-Za-z0-9]{20}' "$SRC_DIR/src" "$SRC_DIR/src/main/resources" 2>/dev/null; then
    ecart "3.5" "URL ou clé de fournisseur LLM en dur"
  else ok "3.5" "aucun fournisseur LLM en dur"; fi
else inconnu "3.2/3.5" "pas de sources Java à ce stade (normal avant le go)"; fi

if [ -n "$MANIFEST" ] && grep -qE '"target_host"[[:space:]]*:[[:space:]]*"[0-9]{1,3}\.[0-9]{1,3}\.' "$MANIFEST" 2>/dev/null; then
  ecart "3.6" "adresse IP dans target_host"
else ok "3.6" "aucune IP figée en cible de route"; fi

# ================================================================ 4. Secrets ===
titre "4. Secrets"

FUITES=$(grep -rlEi '(password|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9/+_-]{16,}' \
         "$APP_DIR" --include=*.yml --include=*.yaml --include=*.properties --include=*.json --include=*.md \
         --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git 2>/dev/null \
         | grep -vE '(\$\{|example|sample|CHANGEME|xxx|<.*>)' | head -5)
[ -z "$FUITES" ] && ok "4.1/4.4" "aucun secret apparent dans le dépôt" \
                 || { ecart "4.1/4.4" "secret possible dans :"; echo "$FUITES" | sed "s|$APP_DIR/|             |"; }

# =========================================================== 6. Architecture ===
titre "6. Architecture"

if [ -d "$SRC_DIR/src" ]; then
  if grep -rq 'package eu\.lmvi' "$SRC_DIR/src" --include=*.java 2>/dev/null; then
    ok "6.1" "package eu.lmvi"
  else ecart "6.1" "package autre que eu.lmvi"; fi

  INTERDITS=$(grep -rlE '@Scheduled|new Thread\(|while[[:space:]]*\([[:space:]]*true' "$SRC_DIR/src" --include=*.java 2>/dev/null | head -3)
  [ -z "$INTERDITS" ] && ok "6.3" "ni @Scheduled, ni new Thread, ni while(true)" \
                      || { ecart "6.3" "construction interdite dans :"; echo "$INTERDITS" | sed "s|$SRC_DIR/|             |"; }

  if grep -rq 'scanBasePackages' "$SRC_DIR/src" --include=*.java 2>/dev/null; then
    grep -rq 'eu\.lmvi\.socle' "$SRC_DIR/src" --include=*.java 2>/dev/null \
      && ok "6.6" "scanBasePackages contient eu.lmvi.socle" \
      || ecart "6.6" "scanBasePackages sans eu.lmvi.socle — le MOP ne démarrera pas"
  else inconnu "6.6" "pas d'Application.java à ce stade"; fi
else
  so "6.1/6.3/6.6" "pas encore de code — c'est le but d'un contrôle avant go"
fi

if [ -f "$POM" ]; then
  grep -q 'spring-boot-starter-log4j2' "$POM" && ok "6.5" "Log4j2 déclaré" || ecart "6.5" "spring-boot-starter-log4j2 absent du pom"
  NB_STARTERS=$(grep -c 'spring-boot-starter-\(web\|jdbc\|thymeleaf\|test\)' "$POM")
  NB_EXCL=$(grep -c 'spring-boot-starter-logging' "$POM")
  [ "$NB_EXCL" -ge "$NB_STARTERS" ] && ok "6.5b" "logging exclu de chaque starter" \
    || ecart "6.5b" "$NB_STARTERS starters pour $NB_EXCL exclusions de spring-boot-starter-logging"
else inconnu "6.5" "pom.xml introuvable"; fi

# ============================================================ 7. Exploitation ==
titre "7. Exploitation"

if [ -n "$MANIFEST" ]; then
  if grep -q '"healthCheckPath"' "$MANIFEST"; then
    grep -q '"healthCheckPath"[[:space:]]*:[[:space:]]*"/admin/health"' "$MANIFEST" \
      && ecart "7.2" "healthCheckPath = /admin/health — route du Hub, 404 sur une app" \
      || ok "7.2" "healthCheckPath ne vise pas /admin/health"
  else inconnu "7.2" "healthCheckPath non déclaré"; fi

  grep -q '"env"' "$MANIFEST" && ok "7.1" "bloc env déclaré au manifeste" \
                             || ecart "7.1" "aucun bloc env — les variables n'existeront pas au démarrage"
else inconnu "7.1/7.2" "manifest.json introuvable"; fi

# =========================================================== 8. Traçabilité ====
titre "8. Traçabilité"

# La source de vérité est le README de M6 ; le fichier .generated est un brouillon.
MATRICE="$CHANTIER/M6-plan-technique/README.md"
[ -f "$MATRICE" ] || MATRICE=$(find "$CHANTIER" -name 'matrice-couverture*' 2>/dev/null | head -1)

if [ -n "${MATRICE:-}" ] && [ -f "$MATRICE" ]; then
  ok "8.2" "matrice de couverture : ${MATRICE#$CHANTIER/}"
  # On lit l'en-tête pour trouver les colonnes Tests et Gate, puis on ne contrôle
  # QUE celles-là : la colonne Statut vaut « à faire » avant le go, c'est normal.
  RESULTAT=$(awk -F'|' '
    /^\|/ && !entete {
      for (i=1; i<=NF; i++) {
        c=$i; gsub(/^[ \t]+|[ \t]+$/,"",c)
        if (c ~ /^Tests?$/) ct=i
        if (c ~ /^Gate$/)   cg=i
      }
      if (ct) { entete=1; next }
    }
    entete && /^\|[ \t]*(US-)?[A-Z][0-9]/ {
      n++
      t=(ct?$ct:""); g=(cg?$cg:"")
      gsub(/^[ \t]+|[ \t]+$/,"",t); gsub(/^[ \t]+|[ \t]+$/,"",g)
      vide = (t=="" || t=="-" || t ~ /compl[ée]ter|à d[ée]finir|TODO/)
      if (cg && (g=="" || g=="-" || g ~ /compl[ée]ter|à d[ée]finir/)) vide=1
      if (vide) k++
    }
    END { printf "%d %d", n+0, k+0 }' "$MATRICE")
  LIGNES_US=$(echo "$RESULTAT" | cut -d' ' -f1)
  NON_RENSEIGNE=$(echo "$RESULTAT" | cut -d' ' -f2)
  if [ "${LIGNES_US:-0}" -eq 0 ]; then
    inconnu "8.3" "aucune colonne Tests trouvée dans la matrice"
  elif [ "${NON_RENSEIGNE:-0}" -eq 0 ]; then
    ok "8.3" "$LIGNES_US US, colonnes Tests et Gate renseignées"
  else
    ecart "8.3" "$NON_RENSEIGNE US sur $LIGNES_US sans test ou sans gate"
  fi
else
  ecart "8.2" "aucune matrice de couverture dans docs/chantier — M6 incomplet"
fi

for m in M1-spec-besoins M2-user-stories M4-arbitrages M5-phasage M6-plan-technique; do
  [ -d "$CHANTIER/$m" ] && ok "8.x" "$m présent" || ecart "8.x" "$m absent du chantier"
done

# ================================================================== verdict ====
titre "Verdict"
printf "  %d OK · %s%d écart(s)%s · %d à vérifier · %d sans objet\n" \
       "$OK" "$ROUGE" "$ECARTS" "$RAZ" "$INCONNU" "$SO"

if [ "$ECARTS" -gt 0 ] || [ "$INCONNU" -gt 0 ]; then
  echo
  echo "  Les points marqués ECART bloquent le go tant qu'ils ne sont pas levés"
  echo "  (corrigés, ou arbitrés par une décision M4 datée)."
  echo "  Les points A VERIFIER comptent comme des écarts : un contrôle non fait"
  echo "  n'est pas un contrôle réussi."
  exit 1
fi
echo "  Rien ne s'oppose au go sur les points mécaniques."
echo "  Reste à remplir à la main les lignes non marquées du TEMPLATE-CONTROLE-AVANT-GO.md."
