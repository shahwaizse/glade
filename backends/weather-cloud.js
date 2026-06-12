const https = require("https");

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "glade-weather-widget" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Bad response from " + url));
          }
        });
      })
      .on("error", reject);
  });
}

const WEATHER_CODES = {
  0: ["Clear sky", "☀️"],
  1: ["Mainly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌧️"],
  61: ["Light rain", "🌧️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"],
  67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "🌨️"],
  75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "❄️"],
  80: ["Rain showers", "🌦️"],
  81: ["Rain showers", "🌧️"],
  82: ["Violent showers", "⛈️"],
  85: ["Snow showers", "🌨️"],
  86: ["Snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm + hail", "⛈️"],
  99: ["Thunderstorm + hail", "⛈️"],
};

module.exports = async function (payload, ctx) {
  // Locate the user by IP (no key needed); fall back to a sane default.
  let lat = 51.5072,
    lon = -0.1276,
    place = "London";
  try {
    const loc = await getJSON("https://ipapi.co/json/");
    if (loc && loc.latitude != null) {
      lat = loc.latitude;
      lon = loc.longitude;
      place = [loc.city, loc.country_name].filter(Boolean).join(", ") || place;
    }
  } catch (_) {
    /* keep default location */
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`;
  const data = await getJSON(url);
  if (!data.current) throw new Error("Weather service returned no data");

  const c = data.current;
  const [label, icon] = WEATHER_CODES[c.weather_code] || ["Unknown", "☁️"];
  return {
    place,
    temp: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    wind: Math.round(c.wind_speed_10m),
    label,
    icon,
    unit: data.current_units ? data.current_units.temperature_2m : "°C",
  };
};
