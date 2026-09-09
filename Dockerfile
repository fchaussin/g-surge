# syntax=docker/dockerfile:1

# Image de développement de Void Runner.
# Elle porte Node et un serveur statique, pour que rien n'ait besoin d'être
# installé sur l'hôte.
#
# Debian et non Alpine, délibérément. node_modules est monté depuis l'hôte, pas
# installé dans l'image, et il contient depuis l'outillage TypeScript des
# binaires natifs (rollup, esbuild) publiés séparément pour glibc et pour musl.
# Sous node:*-alpine, un node_modules installé sur un hôte glibc échoue au
# chargement avec un MODULE_NOT_FOUND sur @rollup/rollup-linux-x64-gnu.
FROM node:24-slim

# serve est épinglé et posé dans l'image plutôt que tiré par npx au démarrage :
# le conteneur monte hors ligne et sert toujours la même version.
RUN npm install --global serve@14.2.5

# Config du serveur de dev : dans l'image et non dans public/, qui est
# l'artefact déployé tel quel. Elle ne fait qu'une chose, forcer un
# Cache-Control: no-cache. Sans elle serve n'envoie aucun Cache-Control et le
# navigateur applique son cache heuristique : engine.js édité, page inchangée.
# Le schéma de serve refuse les clés inconnues, ce fichier ne peut pas être
# commenté de l'intérieur.
COPY docker/serve.json /etc/void-runner/serve.json

WORKDIR /app

# Pas de USER ici : l'uid qui convient dépend du démon, il est choisi dans
# compose.yaml. Voir le commentaire « user: » là-bas.

EXPOSE 5173

# Pas de --single : le jeu est une page unique mais les 404 doivent rester des
# 404, sinon une faute de frappe sur un chemin d'actif renvoie index.html.
CMD ["serve", "public", \
     "--config", "/etc/void-runner/serve.json", \
     "--listen", "tcp://0.0.0.0:5173", \
     "--no-clipboard", \
     "--no-port-switching"]
