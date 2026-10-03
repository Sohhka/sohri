// Services publics que l'appli contacte toute seule (taux du jour, météo, nouvelle version
// Android) : coupés dans les tests, pour des résultats toujours identiques (taux 184,50...).
const EXTERNAL = /^https:\/\/(api\.frankfurter\.dev|cdn\.jsdelivr\.net|api\.open-meteo\.com|geocoding-api\.open-meteo\.com|api\.github\.com)\//;
module.exports = async function blockExternal(context) {
  await context.route(EXTERNAL, route => route.abort('internetdisconnected'));
  return context;
};
module.exports.EXTERNAL = EXTERNAL;
